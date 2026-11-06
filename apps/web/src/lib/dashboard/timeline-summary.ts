/**
 * Dashboard summary over `GET /applications/timeline` (the authoritative read model for e-mail, native and external applications).
 * `null` input means the request failed: callers must show "unavailable", never zero. Dry runs are not real applications and are not counted.
 * Employer-confirmed and candidate-reported evidence are kept apart and never summed.
 */
export type TimelineEvidence = 'SYSTEM' | 'PROVIDER' | 'EMPLOYER_CONFIRMED' | 'CANDIDATE_REPORTED';

export interface TimelineStageLike { key: string; at?: string | null; evidence: TimelineEvidence }
export interface TimelineEntryLike {
  id: string;
  title?: string;
  company?: string;
  channel?: string;
  dryRun?: boolean;
  stages?: TimelineStageLike[];
  problem?: { key: string; evidence?: TimelineEvidence } | null;
  nextActions?: { key: string }[];
}

export interface TimelineSummary {
  total: number;
  /** Applications with a delivery problem or an unconfirmed outcome that needs the candidate's attention. */
  needsAttention: number;
  /** A message arrived at the reply address (system-observed). */
  replyReceived: number;
  /** The employer changed the status inside AISE (review, interview, hired, rejected). */
  employerConfirmed: number;
  /** The candidate entered or confirmed a reply, interview or offer. */
  candidateReported: number;
}

const REPLY_KEYS = new Set(['REPLY_RECEIVED', 'IN_REVIEW', 'INTERVIEW', 'OFFER', 'HIRED']);
const ATTENTION_PROBLEMS = new Set(['BOUNCED', 'COMPLAINED', 'FAILED', 'UNCERTAIN', 'UNCONFIRMED']);

export function summarizeTimeline(data: unknown): TimelineSummary | null {
  if (!Array.isArray(data)) return null;
  const entries = (data as TimelineEntryLike[]).filter((e) => e && typeof e === 'object' && e.dryRun !== true);
  const s: TimelineSummary = { total: entries.length, needsAttention: 0, replyReceived: 0, employerConfirmed: 0, candidateReported: 0 };
  for (const e of entries) {
    if (e.problem && ATTENTION_PROBLEMS.has(e.problem.key)) s.needsAttention += 1;
    const replies = (e.stages ?? []).filter((st) => REPLY_KEYS.has(st.key));
    if (replies.some((st) => st.evidence === 'EMPLOYER_CONFIRMED')) s.employerConfirmed += 1;
    if (replies.some((st) => st.evidence === 'CANDIDATE_REPORTED')) s.candidateReported += 1;
    if (replies.some((st) => st.key === 'REPLY_RECEIVED' && st.evidence === 'SYSTEM')) s.replyReceived += 1;
  }
  return s;
}
