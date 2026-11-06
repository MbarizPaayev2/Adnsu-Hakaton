import { describe, expect, it } from 'vitest';
import { summarizeTimeline } from './timeline-summary';

const e = (over: Record<string, unknown>) => ({ id: 'x', stages: [], problem: null, dryRun: false, ...over });

describe('summarizeTimeline', () => {
  it('a failed or malformed response is unavailable, never zero', () => {
    expect(summarizeTimeline(null)).toBeNull();
    expect(summarizeTimeline({ error: 'x' })).toBeNull();
    expect(summarizeTimeline(undefined)).toBeNull();
  });

  it('an empty list is a real zero', () => {
    expect(summarizeTimeline([])).toEqual({ total: 0, needsAttention: 0, replyReceived: 0, employerConfirmed: 0, candidateReported: 0 });
  });

  it('dry runs are not applications', () => {
    expect(summarizeTimeline([e({ dryRun: true }), e({ id: 'y' })])?.total).toBe(1);
  });

  it('keeps employer-confirmed, candidate-reported and system-observed evidence apart', () => {
    const s = summarizeTimeline([
      e({ id: 'a', stages: [{ key: 'DELIVERED', evidence: 'SYSTEM' }, { key: 'INTERVIEW', evidence: 'EMPLOYER_CONFIRMED' }] }),
      e({ id: 'b', stages: [{ key: 'INTERVIEW', evidence: 'CANDIDATE_REPORTED' }] }),
      e({ id: 'c', stages: [{ key: 'REPLY_RECEIVED', evidence: 'SYSTEM' }] }),
      e({ id: 'd', stages: [{ key: 'DELIVERED', evidence: 'PROVIDER' }] }),
    ])!;
    expect(s).toMatchObject({ total: 4, employerConfirmed: 1, candidateReported: 1, replyReceived: 1 });
  });

  it('delivery by the provider alone is not a reply', () => {
    const s = summarizeTimeline([e({ stages: [{ key: 'PROVIDER_ACCEPTED', evidence: 'PROVIDER' }, { key: 'DELIVERED', evidence: 'PROVIDER' }] })])!;
    expect(s.employerConfirmed + s.candidateReported + s.replyReceived).toBe(0);
  });

  it('counts problems that need attention but not a rejection', () => {
    const s = summarizeTimeline([e({ problem: { key: 'BOUNCED' } }), e({ problem: { key: 'UNCONFIRMED' } }), e({ problem: { key: 'REJECTED' } })])!;
    expect(s.needsAttention).toBe(2);
  });
});
