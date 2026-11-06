import { estimateTokens, noteRateHeaders, paced, parseResetDuration, resetPacing, retryAfterMs, waitBeforeSend } from './ai-pacing';

const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe('provider pacing', () => {
  beforeEach(() => resetPacing());

  it('reads Groq reset durations', () => {
    expect(parseResetDuration('547ms')).toBe(547);
    expect(parseResetDuration('7.66s')).toBe(7660);
    expect(parseResetDuration('1m26.4s')).toBe(86400);
    expect(parseResetDuration('12')).toBe(12000);
    expect(parseResetDuration('soon')).toBeNull();
  });

  it('waits for the token reset when the remaining budget cannot hold the next call, and refuses past the deadline', () => {
    noteRateHeaders('groq', headers({ 'x-ratelimit-remaining-tokens': '1500', 'x-ratelimit-reset-tokens': '20s', 'x-ratelimit-remaining-requests': '900', 'x-ratelimit-reset-requests': '1m' }), 1_000);
    expect(waitBeforeSend('groq', 1000, 1_000, 100_000)).toBe(0);
    expect(waitBeforeSend('groq', 2500, 1_000, 100_000)).toBe(20_000);
    expect(waitBeforeSend('groq', 2500, 1_000, 10_000)).toBeNull();
    expect(waitBeforeSend('nvidia', 99_999, 1_000, 2_000)).toBe(0); // nothing known: no wait
  });

  it('waits only until enough of a continuously refilling budget is back, never longer than the full reset', () => {
    // 2,000 of 8,000 left, full again in 60 s: 100 tokens per second come back. A 3,000-token call needs 1,000 more: 10 s, not 60 s.
    noteRateHeaders('groq', headers({ 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-tokens': '2000', 'x-ratelimit-reset-tokens': '60s' }), 0);
    expect(waitBeforeSend('groq', 3000, 0, 100_000)).toBe(10_000);
    expect(waitBeforeSend('groq', 9000, 0, 100_000)).toBe(60_000); // more than the limit: the full reset is the best known
    // Without the limit header the full reset is used, as before.
    noteRateHeaders('other', headers({ 'x-ratelimit-remaining-tokens': '2000', 'x-ratelimit-reset-tokens': '60s' }), 0);
    expect(waitBeforeSend('other', 3000, 0, 100_000)).toBe(60_000);
  });

  it('books tokens in order so two callers do not both spend the same budget', async () => {
    noteRateHeaders('groq', headers({ 'x-ratelimit-remaining-tokens': '3000', 'x-ratelimit-reset-tokens': '50ms' }));
    const order: string[] = [];
    const a = paced('groq', 2000, Date.now() + 10_000, async () => { order.push('a'); return 'a'; });
    const b = paced('groq', 2000, Date.now() + 10_000, async () => { order.push('b'); return 'b'; });
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
    expect(order).toEqual(['a', 'b']);
  });

  it('uses the provider Retry-After for a 429 within the remaining time', () => {
    expect(retryAfterMs(headers({ 'retry-after': '7' }), 0, 60_000)).toBe(7_000);
    expect(retryAfterMs(headers({ 'retry-after': '40' }), 0, 30_000)).toBeNull();
    expect(retryAfterMs(headers({}), 1, 60_000)).toBe(4_000);
  });

  it('estimates a request before sending it', () => {
    expect(estimateTokens([{ content: 'x'.repeat(3500) }], 1500)).toBe(2500);
  });
});
