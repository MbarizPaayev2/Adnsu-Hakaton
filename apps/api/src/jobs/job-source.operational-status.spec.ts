import { computeOperationalStatus } from './job-source.service';

const now = new Date('2026-10-04T12:00:00Z');
const h = (n: number) => new Date(now.getTime() - n * 3_600_000);
const base = { enabled: true, schedulePausedAt: null, consecutiveFailures: 0, lastError: null, lastRunStatus: 'SUCCEEDED', scheduled: true, intervalMinutes: 60, lastRunAt: h(0.2), accessReview: 'ROBOTS_ALLOWED_TERMS_PENDING' };

describe('operational status: only a source that is working now reads HEALTHY', () => {
  it('a scheduled source whose last run succeeded (or was a healthy bounded run) recently is healthy', () => {
    expect(computeOperationalStatus(base, now).status).toBe('HEALTHY');
    expect(computeOperationalStatus({ ...base, lastRunStatus: 'PARTIAL' }, now).status).toBe('HEALTHY');
  });

  it.each([
    ['disabled', { enabled: false }, 'DISABLED'],
    ['restricted by the access review (even after a success)', { accessReview: 'RESTRICTED' }, 'RESTRICTED'],
    ['paused', { schedulePausedAt: h(1) }, 'PAUSED'],
    ['cooling down', { cooldownUntil: new Date(now.getTime() + 3_600_000), cooldownReason: 'repeated failure' }, 'COOLING_DOWN'],
    ['five failures in a row', { consecutiveFailures: 5, lastRunStatus: 'FAILED' }, 'CIRCUIT_BROKEN'],
    ['blocked', { consecutiveFailures: 1, lastRunStatus: 'FAILED', lastError: 'HTTP 403 forbidden' }, 'BLOCKED'],
    ['rate limited', { consecutiveFailures: 1, lastRunStatus: 'FAILED', lastError: 'HTTP 429' }, 'RATE_LIMITED'],
    ['failed once', { consecutiveFailures: 1, lastRunStatus: 'FAILED' }, 'DEGRADED'],
    ['last run failed although an operator reset the failure counter', { consecutiveFailures: 0, lastRunStatus: 'FAILED' }, 'DEGRADED'],
    ['scheduled but its last run is older than two intervals', { lastRunAt: h(30) }, 'OVERDUE'],
    ['collected by hand only (an old success is not a live one)', { scheduled: false, lastRunAt: h(24 * 30) }, 'IDLE'],
    ['never run', { lastRunStatus: null, lastRunAt: null }, 'IDLE'],
  ] as const)('%s is never healthy', (_name, over, expected) => {
    const out = computeOperationalStatus({ ...base, ...over } as never, now);
    expect(out.status).toBe(expected);
    expect(out.status).not.toBe('HEALTHY');
    expect(out.action).not.toMatch(/normal işləyir/);
  });

  it('is running while a lease is live, and stays unavailable if the source is restricted or disabled', () => {
    expect(computeOperationalStatus({ ...base, runningNow: true }, now).status).toBe('RUNNING');
    expect(computeOperationalStatus({ ...base, runningNow: true, accessReview: 'RESTRICTED' }, now).status).toBe('RESTRICTED');
  });

  it('a source that runs on its schedule stays healthy up to two intervals plus a margin, then turns overdue', () => {
    expect(computeOperationalStatus({ ...base, lastRunAt: h(2.1) }, now).status).toBe('HEALTHY');
    expect(computeOperationalStatus({ ...base, lastRunAt: h(2.4) }, now).status).toBe('OVERDUE');
  });
});
