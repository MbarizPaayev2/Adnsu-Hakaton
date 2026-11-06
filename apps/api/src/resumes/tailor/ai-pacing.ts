/**
 * Shared pacing for a hosted model's per-minute token budget.
 *
 * Measured 16 October 2026 on the production Groq account: `x-ratelimit-limit-tokens: 8000` (per minute) and `x-ratelimit-limit-requests: 1000`.
 * One Azerbaijani letter (two writer attempts and a fact check) needs roughly 6,000 tokens, so two documents in the same minute exhausted the budget
 * and 14 of 26 requests in a small evaluation came back HTTP 429; the old fixed retry (at most 8 s, twice) then gave up and the document fell back to
 * the template. Here every call first waits, within its own deadline, until the provider's last reported budget can hold it, and a 429 is retried
 * after the provider's own Retry-After instead of a guess. Nothing is sent faster than the provider allows and no key is ever switched.
 */

type Budget = { remainingTokens: number | null; refillPerMs: number | null; notedAt: number; tokensResetAt: number; remainingRequests: number | null; requestsResetAt: number };
const budgets = new Map<string, Budget>();
/** One queue per provider: callers wait their turn instead of all retrying at the same moment. */
const queues = new Map<string, Promise<unknown>>();

/** "547ms", "7.66s", "1m26.4s", "2h3m" → milliseconds; null when unreadable. */
export function parseResetDuration(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = String(raw).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000); // plain seconds (Retry-After style)
  let ms = 0, matched = false;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const n = Number(m[1]);
    ms += m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60_000 : n * 3_600_000;
  }
  return matched ? Math.round(ms) : null;
}

/** Tokens per millisecond the budget comes back at: what is missing from the limit, over the time until it is full. Null when unknown. */
function refillRate(limit: number | null, remaining: number | null, resetMs: number | null): number | null {
  if (limit === null || remaining === null || !resetMs || resetMs <= 0 || remaining >= limit) return null;
  return (limit - remaining) / resetMs;
}

/** Records what the provider reported about its remaining budget (OpenAI-compatible `x-ratelimit-*` headers). */
export function noteRateHeaders(provider: string, headers: { get(name: string): string | null }, now = Date.now()): void {
  const num = (name: string) => { const v = Number(headers.get(name)); return Number.isFinite(v) && headers.get(name) !== null ? v : null; };
  const remainingTokens = num('x-ratelimit-remaining-tokens');
  const remainingRequests = num('x-ratelimit-remaining-requests');
  if (remainingTokens === null && remainingRequests === null) return;
  budgets.set(provider, {
    remainingTokens,
    refillPerMs: refillRate(num('x-ratelimit-limit-tokens'), remainingTokens, parseResetDuration(headers.get('x-ratelimit-reset-tokens'))),
    notedAt: now,
    tokensResetAt: now + (parseResetDuration(headers.get('x-ratelimit-reset-tokens')) ?? 60_000),
    remainingRequests,
    requestsResetAt: now + (parseResetDuration(headers.get('x-ratelimit-reset-requests')) ?? 60_000),
  });
}

/** Rough token cost of a request before it is sent: characters / 3.5 for the prompt (Azerbaijani tokenises densely) plus the output cap. */
export function estimateTokens(messages: { content: string }[], maxTokens: number): number {
  return Math.ceil(messages.reduce((n, m) => n + String(m.content ?? '').length, 0) / 3.5) + maxTokens;
}

/**
 * How long to wait before sending `estimate` tokens: 0 when the last reported budget holds it (or nothing is known), else until the provider said it
 * resets. Null when that is later than `latestStart` (the caller's deadline): the caller should not send at all rather than send into a certain 429.
 */
export function waitBeforeSend(provider: string, estimate: number, now: number, latestStart: number): number | null {
  const b = budgets.get(provider);
  if (!b) return 0;
  let until = now;
  if (b.remainingTokens !== null && now < b.tokensResetAt && b.remainingTokens < estimate) {
    // The budget refills continuously (Groq: "reset" is when it is FULL again). With the limit known, wait only until enough of it is back for this
    // call instead of until it is full: waiting for a full minute every time made a second document sit idle for most of its deadline.
    const enough = b.refillPerMs ? b.notedAt + Math.ceil((estimate - b.remainingTokens) / b.refillPerMs) : b.tokensResetAt;
    until = Math.max(until, Math.min(enough, b.tokensResetAt));
  }
  if (b.remainingRequests !== null && now < b.requestsResetAt && b.remainingRequests < 1) until = Math.max(until, b.requestsResetAt);
  if (until > latestStart) return null;
  return until - now;
}

/** After the wait the budget is spent locally, so the next queued caller does not assume the same tokens are still free. */
function spend(provider: string, estimate: number) {
  const b = budgets.get(provider);
  if (b && b.remainingTokens !== null) b.remainingTokens -= estimate;
  if (b && b.remainingRequests !== null) b.remainingRequests -= 1;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `send` in the provider's queue once its budget allows. Returns null (without sending) when the wait would pass `deadline`.
 * The queue only orders the start of requests: it is released once this request's tokens are booked, so requests themselves run in parallel.
 */
export async function paced<T>(provider: string, estimate: number, deadline: number, send: () => Promise<T>): Promise<T | null> {
  const previous = queues.get(provider) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((r) => { release = r; });
  queues.set(provider, previous.then(() => turn));
  await previous.catch(() => undefined);
  let wait: number | null;
  try {
    wait = waitBeforeSend(provider, estimate, Date.now(), deadline - 1_000);
    if (wait !== null && wait > 0) await sleep(wait);
    if (wait !== null) spend(provider, estimate);
  } finally {
    release(); // the next caller may start as soon as this one's tokens are booked; requests still run in parallel
  }
  return wait === null ? null : send();
}

/** Retry-After for a 429, bounded by the caller's remaining time; null when waiting would not leave time for the retry. */
export function retryAfterMs(headers: { get(name: string): string | null }, attempt: number, timeLeftMs: number): number | null {
  const stated = parseResetDuration(headers.get('retry-after')) ?? parseResetDuration(headers.get('x-ratelimit-reset-tokens'));
  const wait = Math.min(stated ?? 2_000 * 2 ** attempt, 65_000);
  return wait + 2_000 < timeLeftMs ? wait : null;
}

/** Test helper. */
export function resetPacing() { budgets.clear(); queues.clear(); }
