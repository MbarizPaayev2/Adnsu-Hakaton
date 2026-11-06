import { COOLDOWN_AFTER_FAILURES, failureSettlement } from './source-scheduler.service';

describe('source scheduler failure policy', () => {
  const now = new Date('2026-10-27T12:00:00.000Z');
  const source = { intervalMinutes: 360, cooldownCount: 0 };

  it('does not treat message wording as proof of a block or change backoff', () => {
    const ordinary = failureSettlement(source, 1, 'UPSTREAM_UNAVAILABLE', 'request failed', now);
    const blockLikeText = failureSettlement(source, 1, 'UPSTREAM_UNAVAILABLE', 'HTTP 403 Cloudflare blocked', now);
    expect(blockLikeText).toEqual(ordinary);
    expect(blockLikeText.cooldownUntil).toBeNull();
  });

  it('uses finite backoff and cools down after repeated failures', () => {
    const settled = failureSettlement(source, COOLDOWN_AFTER_FAILURES, 'UNKNOWN_ERROR', 'unclassified', now);
    expect(settled.cooldownUntil).toEqual(new Date(now.getTime() + 24 * 3_600_000));
    expect(settled.cooldownCount).toBe(1);
  });
});
