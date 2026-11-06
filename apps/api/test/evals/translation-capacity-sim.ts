/**
 * Real-time simulation of one Azerbaijani CV translation against an emulated provider set-up like production's (Groq gpt-oss-120b with an
 * 8,000 tokens/minute budget, NVIDIA as the second writer model that never answers within its timeout). The provider answers with the reference
 * translations in translation-fixtures.ts, so every rejection or untranslated field here comes from capacity, deadlines or our own gates, not from
 * translation quality. No network is used.
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only test/evals/translation-capacity-sim.ts [--nvidia-ok] [--runs=2]
 */
import { ResumeTailorService } from '../../src/resumes/tailor/resume-tailor.service';
import { untranslatedItems } from '../../src/resumes/tailor/az-translate';
import { resetPacing } from '../../src/resumes/tailor/ai-pacing';
import { founderCv, AZ } from './translation-fixtures';

const args = process.argv.slice(2);
const nvidiaOk = args.includes('--nvidia-ok');
/** --flaky: the first answer for every third field is rejected-quality (left in English), as real models sometimes do; the second answer is right. */
const flaky = args.includes('--flaky');
const seen = new Map<string, number>();
const runs = Number(args.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 1);
const TPM = Number(process.env.SIM_TPM ?? 8000);

let tokens = TPM, lastRefill = Date.now();
const refill = () => { const now = Date.now(); tokens = Math.min(TPM, tokens + ((now - lastRefill) / 60_000) * TPM); lastRefill = now; };
const log: { at: number; host: string; model: string; status: number | string; prompt: number; completion: number; items: number; ms: number }[] = [];
const t0 = Date.now();

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })); });
});

(global as any).fetch = async (url: string, init: { body: string; signal?: AbortSignal }) => {
  const body = JSON.parse(init.body);
  const started = Date.now();
  const userMsg = body.messages.find((m: any) => m.role === 'user')?.content ?? '';
  const prompt = Math.ceil(body.messages.reduce((n: number, m: any) => n + String(m.content).length, 0) / 4);
  let payload: any = {};
  try { payload = JSON.parse(userMsg); } catch { /* not a translation request */ }
  const items: { id: string; text: string }[] = Array.isArray(payload.items) ? payload.items : [];
  if (String(url).includes('nvidia')) {
    if (!nvidiaOk) {
      try { await sleep(120_000, init.signal); } catch (e) { log.push({ at: started - t0, host: 'nvidia', model: body.model, status: 'timeout', prompt, completion: 0, items: items.length, ms: Date.now() - started }); throw e; }
    }
  } else {
    refill();
    if (tokens < prompt + body.max_tokens) { // Groq admits a request only when the minute budget holds its prompt and max_tokens
      const wait = ((prompt + body.max_tokens - tokens) / TPM) * 60_000;
      log.push({ at: started - t0, host: 'groq', model: body.model, status: 429, prompt, completion: 0, items: items.length, ms: 0 });
      return new Response('{"error":"rate_limit"}', { status: 429, headers: { 'retry-after': String(Math.ceil(wait / 1000)), 'x-ratelimit-remaining-tokens': String(Math.floor(tokens)), 'x-ratelimit-reset-tokens': `${(wait / 1000).toFixed(2)}s`, 'x-ratelimit-limit-tokens': String(TPM), 'x-ratelimit-remaining-requests': '999', 'x-ratelimit-reset-requests': '1m' } });
    }
  }
  const out = { items: items.map((i) => { const n = (seen.get(i.text) ?? 0) + 1; seen.set(i.text, n); const bad = flaky && n === 1 && [...seen.keys()].indexOf(i.text) % 3 === 0; return { id: i.id, text: bad ? i.text : AZ[i.text] ?? i.text }; }) };
  const text = JSON.stringify(out);
  const completion = Math.ceil(text.length / 3) + 250; // + low-effort reasoning
  await sleep(800 + completion * 2, init.signal); // ≈500 tokens/s
  if (!String(url).includes('nvidia')) { refill(); tokens -= prompt + completion; }
  log.push({ at: started - t0, host: String(url).includes('nvidia') ? 'nvidia' : 'groq', model: body.model, status: 200, prompt, completion, items: items.length, ms: Date.now() - started });
  const full = ((TPM - tokens) / TPM) * 60;
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: prompt, completion_tokens: completion } }), {
    status: 200,
    headers: { 'x-ratelimit-remaining-tokens': String(Math.max(0, Math.floor(tokens))), 'x-ratelimit-reset-tokens': `${full.toFixed(2)}s`, 'x-ratelimit-limit-tokens': String(TPM), 'x-ratelimit-remaining-requests': '999', 'x-ratelimit-reset-requests': '1m' },
  });
};

const env: Record<string, string> = {
  AI_PROVIDER: 'groq', GROQ_API_KEY: 'sim', AI_MODEL: 'openai/gpt-oss-120b',
  AI_WRITER_MODELS: 'openai/gpt-oss-120b,nvidia@nvidia/nemotron-3-ultra-550b-a55b', NVIDIA_API_KEY: 'sim', NIM_API_URL: 'https://integrate.api.nvidia.com/v1/chat/completions',
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('TAILOR_')) as [string, string][]),
};
const svc = new ResumeTailorService({ get: (k: string) => env[k] } as any);

(async () => {
  resetPacing();
  for (let r = 1; r <= runs; r++) {
    const started = Date.now();
    if (args.includes('--fresh-per-run')) seen.clear();
    const result = await svc.translateCvText(founderCv());
    const left = untranslatedItems(result.content);
    if (process.env.SIM_PDF) require('node:fs').writeFileSync(process.env.SIM_PDF.replace('.pdf', `-${r}.pdf`), svc.compileDocumentPdf(result.content));
    if (process.env.SIM_DEBUG) console.log(JSON.stringify(result.issues.filter((i) => /Stakeholder|ünsiyyət/.test(i.detail))));
    console.log(JSON.stringify({ run: r, elapsedMs: Date.now() - started, calls: result.calls, promptTokens: result.promptTokens, completionTokens: result.completionTokens, untranslated: left.length, untranslatedFields: left.map((f) => f.path), outcomes: result.outcomes }, null, 1));
  }
  console.log('provider log:');
  for (const l of log) console.log(`${(l.at / 1000).toFixed(1).padStart(6)}s ${l.host.padEnd(6)} ${String(l.status).padEnd(7)} items=${l.items} prompt=${l.prompt} completion=${l.completion} ${l.ms}ms`);
  process.exit(0);
})();
