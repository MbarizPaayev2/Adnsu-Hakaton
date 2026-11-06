import { summarizeAiUsage } from './ai-usage-report';
import { collectAiUsage, estimateUsd, inStage, parsePriceTable, recordAiCall, reportedTokens, type AiCallEvent } from '../../resumes/tailor/ai-usage';

const ev = (o: Partial<Parameters<typeof summarizeAiUsage>[0][number]> = {}) => ({ resumeId: 'r1', provider: 'groq', model: 'openai/gpt-oss-120b', stage: 'writing', outcome: 'ok', latencyMs: 1000, inputTokens: 1000, outputTokens: 500, ...o });

describe('AI usage records', () => {
  it('retains paid attempts when generation fails, without mixing concurrent documents', async () => {
    const failed: AiCallEvent[] = [], successful: AiCallEvent[] = [];
    const attempt = (model: string) => recordAiCall({ provider: 'groq', model, outcome: 'ok', httpStatus: 200, latencyMs: 5, inputTokens: 1000, outputTokens: 500 });
    const results = await Promise.allSettled([
      collectAiUsage(async () => { await Promise.resolve(); attempt('failed-document'); throw new Error('quality rejection'); }, failed),
      collectAiUsage(async () => { attempt('successful-document'); await Promise.resolve(); }, successful),
    ]);
    expect(results.map(r => r.status)).toEqual(['rejected', 'fulfilled']);
    expect(failed.map(c => c.model)).toEqual(['failed-document']);
    expect(successful.map(c => c.model)).toEqual(['successful-document']);
  });
  it('collects calls with their stage inside a scope and ignores calls outside it', async () => {
    recordAiCall({ provider: 'x', model: 'y', outcome: 'ok', httpStatus: 200, latencyMs: 1, inputTokens: 1, outputTokens: 1 });
    const { calls } = await collectAiUsage(async () => {
      await inStage('translation', async () => recordAiCall({ provider: 'groq', model: 'm', outcome: 'ok', httpStatus: 200, latencyMs: 5, inputTokens: reportedTokens(undefined), outputTokens: reportedTokens(12) }));
      recordAiCall({ provider: 'groq', model: 'm', stage: 'structured', outcome: 'timeout', httpStatus: null, latencyMs: 9, inputTokens: null, outputTokens: null });
    });
    expect(calls.map((c) => [c.stage, c.outcome, c.inputTokens, c.outputTokens])).toEqual([['translation', 'ok', null, 12], ['structured', 'timeout', null, null]]);
  });

  it('estimates only priced calls with reported tokens, and counts the rest as unknown', () => {
    const prices = parsePriceTable('{"groq/openai/gpt-oss-120b":[0.15,0.6],"bad":[1]}');
    expect(prices).toEqual({ 'groq/openai/gpt-oss-120b': [0.15, 0.6] });
    const r = estimateUsd([ev(), ev({ inputTokens: null }), ev({ provider: 'nvidia', model: 'n' })], prices);
    expect(r).toEqual({ usd: (1000 * 0.15 + 500 * 0.6) / 1e6, pricedCalls: 1, unpricedCalls: 1, unknownUsageCalls: 1 });
  });

  it('reports drafts versus candidate-approved documents and keeps unknowns visible', () => {
    const report = summarizeAiUsage(
      [ev(), ev({ resumeId: 'r2' }), ev({ resumeId: 'r3', outcome: 'rate_limited', inputTokens: null, outputTokens: null })],
      [
        { resumeId: 'r1', docKind: 'RESUME', result: 'NEEDS_REVIEW', queueMs: 100, generationMs: 30_000, renderMs: 400 },
        { resumeId: 'r2', docKind: 'LETTER', result: 'NEEDS_REVIEW', queueMs: 200, generationMs: 50_000, renderMs: 300 },
        { resumeId: 'r3', docKind: 'RESUME', result: 'FAILED', queueMs: null, generationMs: 9_000, renderMs: null },
      ],
      new Set(['r1']),
      { 'groq/openai/gpt-oss-120b': [0.15, 0.6] },
      1.7,
    );
    expect(report.documents).toMatchObject({ runs: 3, failed: 1, generatedDrafts: 2, approvedByCandidate: 1 });
    expect(report.totals.callsWithUnknownUsage).toBe(1);
    expect(report.documents.estimatedUsdPerApproved).toBeCloseTo(2 * 0.00045, 9);
    expect(report.models[0].byOutcome).toEqual({ ok: 2, rate_limited: 1 });
    expect(JSON.stringify(report)).not.toMatch(/content|prompt|text/i);
  });
});
