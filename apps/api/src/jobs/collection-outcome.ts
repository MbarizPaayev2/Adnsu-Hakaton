/** Structured collector result; human-readable error text is never used to choose scheduler backoff. */
export type CollectionOutcome =
  | 'COMPLETE_CENSUS'
  | 'BOUNDED_PROGRESS'
  | 'UPSTREAM_FAILURE'
  | 'INVALID_DETAIL'
  | 'NO_OPENINGS';

export interface CollectionOutcomeInput {
  complete: boolean;
  discovered: number;
  accepted: number;
  failed: number;
  error?: string;
  outcome?: CollectionOutcome;
}

/** Compatibility inference for older/manual collectors. Never inspect human-readable messages. Untyped failures fail closed. */
export function collectionOutcome(report: CollectionOutcomeInput): CollectionOutcome {
  if (report.outcome) return report.outcome;
  if (report.complete && !report.error && report.failed === 0) {
    return report.discovered === 0 ? 'NO_OPENINGS' : 'COMPLETE_CENSUS';
  }
  if (report.failed > 0) return 'UPSTREAM_FAILURE';
  if (!report.complete && (report.discovered > 0 || report.accepted > 0)) return 'BOUNDED_PROGRESS';
  return 'UPSTREAM_FAILURE';
}

export function isHealthyCollectorRun(
  recordedStatus: string,
  report: CollectionOutcomeInput,
  contentFailureTolerance = 0.1,
): boolean {
  if (recordedStatus === 'SUCCEEDED') return true;
  if (recordedStatus !== 'PARTIAL') return false;
  const outcome = collectionOutcome(report);
  if (report.failed > 0 && outcome !== 'INVALID_DETAIL') return false;
  if (outcome === 'COMPLETE_CENSUS' && (!report.complete || report.failed > 0 || !!report.error)) return false;
  if (outcome === 'NO_OPENINGS' && (!report.complete || report.discovered > 0 || report.accepted > 0 || !!report.error)) return false;
  const sawPostings = report.accepted > 0 || report.discovered > 0;
  const detailFailuresAreLimited = outcome === 'INVALID_DETAIL' && report.failed > 0 &&
    report.failed <= Math.max(1, Math.floor(report.discovered * contentFailureTolerance));
  if (outcome === 'UPSTREAM_FAILURE' || (outcome === 'INVALID_DETAIL' && !detailFailuresAreLimited)) return false;
  return sawPostings && ['COMPLETE_CENSUS', 'BOUNDED_PROGRESS', 'INVALID_DETAIL'].includes(outcome);
}
