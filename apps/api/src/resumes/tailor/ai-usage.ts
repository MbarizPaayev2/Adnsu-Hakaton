import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Privacy-preserving usage records for hosted-model calls: which provider and model, what the call was for, how it ended, how long it took and
 * the token counts the provider reported. Never a prompt, a response, CV text, a vacancy text or a credential. A provider that does not report
 * usage leaves the counts null ("unknown"), never zero.
 */
export type AiStage = 'structured' | 'writing' | 'translation' | 'other';
export type AiOutcome = 'ok' | 'http_error' | 'rate_limited' | 'retry_param' | 'timeout' | 'network' | 'empty' | 'too_large';

export interface AiCallEvent {
  provider: string;
  model: string;
  stage: AiStage;
  outcome: AiOutcome;
  httpStatus: number | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

const events = new AsyncLocalStorage<AiCallEvent[]>();
const stages = new AsyncLocalStorage<AiStage>();

/** Runs `fn` collecting the model calls it makes (including those of nested writers and translators). */
export async function collectAiUsage<T>(fn: () => Promise<T>, calls: AiCallEvent[] = []): Promise<{ result: T; calls: AiCallEvent[] }> {
  // A caller-owned sink remains available if generation throws after paid calls.
  const result = await events.run(calls, fn);
  return { result, calls };
}

/** Labels the calls made inside `fn` with what they are for. */
export function inStage<T>(stage: AiStage, fn: () => Promise<T>): Promise<T> {
  return stages.run(stage, fn);
}

/** Records one HTTP attempt. Outside a collection scope (tests, scripts) it is a no-op. */
export function recordAiCall(e: Omit<AiCallEvent, 'stage'> & { stage?: AiStage }): void {
  const sink = events.getStore();
  if (!sink || sink.length >= 500) return;
  sink.push({ ...e, stage: e.stage ?? stages.getStore() ?? 'other' });
}

/** A reported token count, or null when the provider did not report one. */
export const reportedTokens = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/** USD per million tokens for a provider/model, from configuration (`AI_PRICE_USD_PER_MTOK`, JSON: {"groq/openai/gpt-oss-120b": [0.15, 0.6]}). */
export type PriceTable = Record<string, [number, number]>;

export function parsePriceTable(raw: string | undefined): PriceTable {
  if (!raw) return {};
  try {
    const table = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(table).filter(([, v]) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n >= 0)) as [string, [number, number]][],
    );
  } catch {
    return {};
  }
}

/**
 * Estimated USD for calls with known prices and reported tokens. Calls whose price or token counts are unknown are counted separately and add
 * nothing to the estimate, so the result is a lower bound that says how much it does not cover.
 */
export function estimateUsd(calls: Pick<AiCallEvent, 'provider' | 'model' | 'inputTokens' | 'outputTokens'>[], prices: PriceTable): { usd: number; pricedCalls: number; unpricedCalls: number; unknownUsageCalls: number } {
  let usd = 0, pricedCalls = 0, unpricedCalls = 0, unknownUsageCalls = 0;
  for (const c of calls) {
    if (c.inputTokens === null || c.outputTokens === null) { unknownUsageCalls++; continue; }
    const price = prices[`${c.provider}/${c.model}`];
    if (!price) { unpricedCalls++; continue; }
    usd += (c.inputTokens * price[0] + c.outputTokens * price[1]) / 1_000_000;
    pricedCalls++;
  }
  return { usd, pricedCalls, unpricedCalls, unknownUsageCalls };
}
