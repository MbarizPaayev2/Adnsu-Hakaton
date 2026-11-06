import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { TranslateItem } from './az-translate';

/**
 * Reuse of verified translations of the candidate's own text across documents.
 *
 * Every CV and letter for the same profile used to translate the same bullets again (each call resends ~1,100 tokens of instructions and waits on the
 * provider's per-minute budget). A translation that passed every check is remembered under a key made of the source text, its kind, the target language,
 * the configured model and the prompt version; the next document reuses it after re-running the current checks on it. A changed source, model or prompt
 * gives a different key, so nothing stale is reused. The canonical profile is never changed: the memory only feeds generated documents.
 */
export interface TranslationStore {
  get(keys: string[]): Promise<Map<string, string>>;
  put(entries: { key: string; text: string }[]): Promise<void>;
}

const stores = new AsyncLocalStorage<TranslationStore>();

/** Runs `fn` with the candidate's translation memory available to the translators inside it. */
export function withTranslationMemory<T>(store: TranslationStore, fn: () => Promise<T>): Promise<T> {
  return stores.run(store, fn);
}

export function currentTranslationMemory(): TranslationStore | undefined {
  return stores.getStore();
}

export function memoryKey(item: Pick<TranslateItem, 'text' | 'kind' | 'current'>, model: string, promptVersion: string, language = 'az'): string {
  return createHash('sha256').update(JSON.stringify([promptVersion, model, language, item.kind, !!item.current, item.text.trim()])).digest('hex');
}

type Db = {
  translationMemory: {
    findMany(args: { where: { userId: string; key: { in: string[] } }; select: { key: true; text: true } }): Promise<{ key: string; text: string }[]>;
    upsert(args: { where: { userId_key: { userId: string; key: string } }; create: { userId: string; key: string; text: string }; update: { text: string; usedAt: Date } }): Promise<unknown>;
    updateMany(args: { where: { userId: string; key: { in: string[] } }; data: { usedAt: Date } }): Promise<unknown>;
  };
};

/** The database store for one candidate. A failure to read or write never affects the document: it is a cache miss. */
export function prismaTranslationStore(db: Db, userId: string): TranslationStore {
  return {
    async get(keys) {
      if (!keys.length) return new Map();
      try {
        const rows = await db.translationMemory.findMany({ where: { userId, key: { in: keys } }, select: { key: true, text: true } });
        if (rows.length) await db.translationMemory.updateMany({ where: { userId, key: { in: rows.map((r) => r.key) } }, data: { usedAt: new Date() } }).catch(() => undefined);
        return new Map(rows.map((r) => [r.key, r.text]));
      } catch {
        return new Map();
      }
    },
    async put(entries) {
      for (const e of entries) {
        await db.translationMemory.upsert({ where: { userId_key: { userId, key: e.key } }, create: { userId, key: e.key, text: e.text }, update: { text: e.text, usedAt: new Date() } }).catch(() => undefined);
      }
    },
  };
}
