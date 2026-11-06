export type VerifyOutcome = {
  status: 'success' | 'error';
  message: string;
  retryable: boolean;
};

type Slot = {
  promise: Promise<VerifyOutcome>;
  storedAt: number;
  terminal: boolean;
};

const MAX_ENTRIES = 32;
const TTL_MS = 10 * 60 * 1000;
const slots = new Map<string, Slot>();

export function resetVerifyOnceCache() {
  slots.clear();
}

async function hashToken(token: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv-${(hash >>> 0).toString(16)}`;
}

function prune(now = Date.now()) {
  for (const [key, slot] of slots) {
    if (now - slot.storedAt > TTL_MS) slots.delete(key);
  }
  while (slots.size > MAX_ENTRIES) {
    const oldest = slots.keys().next().value;
    if (!oldest) break;
    slots.delete(oldest);
  }
}

function isRetryableStatus(status: number) {
  return status >= 500 || status === 429 || status === 408;
}

export async function verifyEmailOnce(
  token: string,
  post: () => Promise<Response>,
): Promise<VerifyOutcome> {
  prune();
  const key = await hashToken(token);
  const existing = slots.get(key);
  if (existing) return existing.promise;

  const promise = (async (): Promise<VerifyOutcome> => {
    try {
      const res = await post();
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return {
          status: 'success',
          message: data.message || 'E-poçtunuz uğurla təsdiqləndi.',
          retryable: false,
        };
      }
      const retryable = isRetryableStatus(res.status);
      return {
        status: 'error',
        message: data.message || 'Təsdiq linki etibarsızdır və ya vaxtı bitib.',
        retryable,
      };
    } catch {
      return {
        status: 'error',
        message: 'Təsdiq zamanı xəta baş verdi.',
        retryable: true,
      };
    }
  })();

  slots.set(key, { promise, storedAt: Date.now(), terminal: false });
  const outcome = await promise;
  if (outcome.retryable) {
    slots.delete(key);
  } else {
    slots.set(key, { promise: Promise.resolve(outcome), storedAt: Date.now(), terminal: true });
  }
  return outcome;
}
