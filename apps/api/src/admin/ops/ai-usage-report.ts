import { estimateUsd, type PriceTable } from '../../resumes/tailor/ai-usage';

type Event = { resumeId: string | null; provider: string; model: string; stage: string; outcome: string; latencyMs: number; inputTokens: number | null; outputTokens: number | null };
type Run = { resumeId: string; docKind: string; result: string; queueMs: number | null; generationMs: number; renderMs: number | null };

const pct = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const sumKnown = (vals: (number | null)[]) => vals.reduce<number>((n, v) => n + (v ?? 0), 0);

/**
 * Cost report from usage records only: measured counts, an estimate where both prices and reported tokens exist, and what is unknown. Nothing here
 * reads document content. "Approved" counts drafts the candidate approved (status READY); a deleted draft is neither.
 */
export function summarizeAiUsage(events: Event[], runs: Run[], approvedResumeIds: Set<string>, prices: PriceTable, usdToAzn: number | null) {
  const byModel = new Map<string, Event[]>();
  for (const e of events) {
    const key = `${e.provider}/${e.model}`;
    byModel.set(key, [...(byModel.get(key) ?? []), e]);
  }
  const models = [...byModel.entries()].map(([key, list]) => {
    const est = estimateUsd(list, prices);
    return {
      model: key,
      calls: list.length,
      byStage: Object.fromEntries([...new Set(list.map((e) => e.stage))].map((s) => [s, list.filter((e) => e.stage === s).length])),
      byOutcome: Object.fromEntries([...new Set(list.map((e) => e.outcome))].map((o) => [o, list.filter((e) => e.outcome === o).length])),
      inputTokensReported: sumKnown(list.map((e) => e.inputTokens)),
      outputTokensReported: sumKnown(list.map((e) => e.outputTokens)),
      callsWithUnknownUsage: est.unknownUsageCalls,
      priced: !!prices[key],
      estimatedUsd: prices[key] ? Number(est.usd.toFixed(6)) : null,
      latencyMsP50: pct(list.map((e) => e.latencyMs), 50),
      latencyMsP90: pct(list.map((e) => e.latencyMs), 90),
    };
  });
  const total = estimateUsd(events, prices);
  const generated = runs.filter((r) => r.result === 'NEEDS_REVIEW');
  const approved = generated.filter((r) => approvedResumeIds.has(r.resumeId));
  const generatedIds = new Set(generated.map((r) => r.resumeId));
  const usdForDocs = (ids: Set<string>) => estimateUsd(events.filter((e) => e.resumeId && ids.has(e.resumeId)), prices).usd;
  const perDoc = (usd: number, n: number) => (n ? Number((usd / n).toFixed(6)) : null);
  return {
    models,
    totals: {
      calls: events.length,
      callsWithUnknownUsage: total.unknownUsageCalls,
      callsWithoutPrice: total.unpricedCalls,
      // A lower bound: calls with unknown usage or no configured price add nothing.
      estimatedUsdLowerBound: Number(total.usd.toFixed(6)),
      estimatedAznLowerBound: usdToAzn ? Number((total.usd * usdToAzn).toFixed(6)) : null,
    },
    documents: {
      runs: runs.length,
      failed: runs.filter((r) => r.result === 'FAILED').length,
      generatedDrafts: generated.length,
      approvedByCandidate: approved.length,
      // Cost of all calls (including failed runs and retries) spread over drafts, and over approved documents.
      estimatedUsdPerDraft: perDoc(total.usd, generated.length),
      estimatedUsdPerApproved: perDoc(total.usd, approved.length),
      estimatedUsdOfDraftsAlone: Number(usdForDocs(generatedIds).toFixed(6)),
      latencyMs: {
        queueP50: pct(runs.map((r) => r.queueMs).filter((v): v is number => v !== null), 50),
        generationP50: pct(runs.map((r) => r.generationMs), 50),
        generationP90: pct(runs.map((r) => r.generationMs), 90),
        renderP50: pct(runs.map((r) => r.renderMs).filter((v): v is number => v !== null), 50),
      },
    },
    notes: [
      'Token counts are those the provider reported; calls without reported usage are counted as unknown, not zero.',
      'Estimates use the configured price table (AI_PRICE_USD_PER_MTOK) and exclude hosting, email, storage, payment fees, support and sales.',
    ],
  };
}
