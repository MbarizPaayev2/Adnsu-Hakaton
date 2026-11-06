import { ResumeTailorService } from './resume-tailor.service';
import { resetPacing } from './ai-pacing';
import { untranslatedItems } from './az-translate';
import type { TailoredContent } from './resume-tailor.types';
import { memoryKey, withTranslationMemory } from './translation-memory';

/** Provider capacity behaviour of CV translation: a dead fallback model and a busy token budget must not leave fields in English. */
const cv = (): TailoredContent => ({
  language: 'az',
  basics: { name: 'N', headline: '', email: '', phone: '', location: '', website: { url: '', label: '' } },
  summary: '',
  experience: [{ company: 'Codveda Technologies', position: 'Machine Learning Intern', location: '', period: 'Jan 2025 - Mar 2025', highlights: ['Cleaned a sales dataset of 10,000 rows with Python.'] }],
  education: [], skills: [], languages: [], projects: [], certifications: [],
});
const AZ: Record<string, string> = {
  'Machine Learning Intern': 'Maşın öyrənməsi üzrə təcrübəçi',
  'Cleaned a sales dataset of 10,000 rows with Python.': 'Python ilə 10,000 sətirlik satış məlumatlarını təmizlədim.',
};
const answer = (body: any, translate = true, headers: Record<string, string> = {}) => {
  const items = JSON.parse(body.messages[1].content).items as { id: string; text: string }[];
  const content = JSON.stringify({ items: items.map((i) => ({ id: i.id, text: translate ? AZ[i.text] : i.text })) });
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 900, completion_tokens: 200 } }), { status: 200, headers });
};
const svc = (env: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    AI_PROVIDER: 'groq', GROQ_API_KEY: 'k', AI_MODEL: 'openai/gpt-oss-120b',
    AI_WRITER_MODELS: 'openai/gpt-oss-120b,nvidia@nvidia/nemotron-3-ultra-550b-a55b', NVIDIA_API_KEY: 'k',
    TAILOR_AZ_WRITER_TIMEOUT_MS: '300', TAILOR_AZ_TRANSLATE_DEADLINE_MS: '60000', ...env,
  };
  return new ResumeTailorService({ get: (k: string) => values[k] } as any);
};
const hang = (init: { signal?: AbortSignal }) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))));

describe('translation capacity', () => {
  beforeEach(() => resetPacing());
  afterEach(() => jest.restoreAllMocks());

  it('tries a fallback model that timed out once, then skips it for the next documents; the first model is never skipped', async () => {
    const hosts: string[] = [];
    let groqAnswers = 0;
    jest.spyOn(global, 'fetch').mockImplementation(async (url: any, init: any) => {
      const host = String(url).includes('nvidia') ? 'nvidia' : 'groq';
      hosts.push(host);
      if (host === 'nvidia') return hang(init);
      // The first answer of every document is still English, so the translator moves on to the next model.
      return answer(JSON.parse(init.body), groqAnswers++ % 2 === 1);
    });
    const s = svc();
    const first = await s.translateCvText(cv());
    expect(untranslatedItems(first.content)).toEqual([]);
    expect(hosts).toEqual(['groq', 'nvidia', 'groq']);
    hosts.length = 0;
    const second = await s.translateCvText(cv());
    expect(untranslatedItems(second.content)).toEqual([]);
    expect(hosts).toEqual(['groq', 'groq']); // no second wait on the dead fallback
  });

  it('waits for the token budget within the document deadline instead of dropping the call', async () => {
    const sent: number[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (_url: any, init: any) => {
      sent.push(Date.now());
      // Budget reported as nearly spent, back in 1.5 s: longer than the 300 ms call timeout, well inside the document deadline.
      return answer(JSON.parse(init.body), true, { 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '1.5s' });
    });
    const s = svc();
    await s.translateCvText(cv());
    const second = await s.translateCvText(cv());
    expect(untranslatedItems(second.content)).toEqual([]);
    expect(sent).toHaveLength(2);
    expect(sent[1] - sent[0]).toBeGreaterThanOrEqual(300);
  });
});

describe('translation memory', () => {
  beforeEach(() => resetPacing());
  afterEach(() => jest.restoreAllMocks());
  const memory = () => {
    const rows = new Map<string, string>();
    return { rows, store: { get: async (keys: string[]) => new Map(keys.filter((k) => rows.has(k)).map((k) => [k, rows.get(k)!])), put: async (e: { key: string; text: string }[]) => { for (const x of e) rows.set(x.key, x.text); } } };
  };

  it('reuses verified translations for the next document without a model call, and translates only what changed', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_u: any, init: any) => answer(JSON.parse(init.body)));
    const { store, rows } = memory();
    const s = svc();
    const first = await withTranslationMemory(store, () => s.translateCvText(cv()));
    expect(untranslatedItems(first.content)).toEqual([]);
    expect(rows.size).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await withTranslationMemory(store, () => s.translateCvText(cv()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.content.experience[0].highlights[0]).toBe(AZ['Cleaned a sales dataset of 10,000 rows with Python.']);
    expect(second.outcomes).toContain('translate:memory:2/2');

    // A changed bullet is a different key: only it is sent.
    const changed = cv();
    changed.experience[0].highlights[0] = 'Cleaned a sales dataset of 12,000 rows with Python.';
    AZ['Cleaned a sales dataset of 12,000 rows with Python.'] = 'Python ilə 12,000 sətirlik satış məlumatlarını təmizlədim.';
    await withTranslationMemory(store, () => s.translateCvText(changed));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sent = JSON.parse(JSON.parse((fetchMock.mock.calls[1][1] as any).body).messages[1].content).items;
    expect(sent.map((i: any) => i.text)).toEqual(['Cleaned a sales dataset of 12,000 rows with Python.']);
  });

  it('re-checks a remembered translation and does not reuse one that fails today\'s checks', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_u: any, init: any) => answer(JSON.parse(init.body)));
    const { store, rows } = memory();
    const s = svc();
    await withTranslationMemory(store, () => s.translateCvText(cv()));
    for (const k of rows.keys()) rows.set(k, 'Python ilə 99 sətir təmizlədim.'); // wrong number: must not be reused
    const again = await withTranslationMemory(store, () => s.translateCvText(cv()));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(again.content.experience[0].highlights[0]).toBe(AZ['Cleaned a sales dataset of 10,000 rows with Python.']);
  });

  it('keys on the configured model and the prompt version', () => {
    const item = { text: 'Built dashboards.', kind: 'bullet' as const };
    expect(memoryKey(item, 'a', 'v1')).not.toBe(memoryKey(item, 'b', 'v1'));
    expect(memoryKey(item, 'a', 'v1')).not.toBe(memoryKey(item, 'a', 'v2'));
    expect(memoryKey(item, 'a', 'v1')).not.toBe(memoryKey({ ...item, current: true }, 'a', 'v1'));
  });
});
