import { collectionOutcome, isHealthyCollectorRun } from './collection-outcome';

describe('structured collection outcomes', () => {
  const report = (overrides: Record<string, unknown> = {}) => ({
    complete: false, discovered: 10, accepted: 8, failed: 0, ...overrides,
  }) as any;

  it('treats an explicitly bounded but productive snapshot as healthy regardless of operator-facing copy', () => {
    const bounded = report({ outcome: 'BOUNDED_PROGRESS', error: 'Initial snapshot only; more pages may be available' });
    expect(collectionOutcome(bounded)).toBe('BOUNDED_PROGRESS');
    expect(isHealthyCollectorRun('PARTIAL', bounded)).toBe(true);
  });

  it('infers productive bounded progress from report fields without interpreting explanatory copy', () => {
    const bounded = report({ error: 'Initial snapshot only; active census not proven' });
    expect(collectionOutcome(bounded)).toBe('BOUNDED_PROGRESS');
    expect(isHealthyCollectorRun('PARTIAL', bounded)).toBe(true);
  });

  it('keeps network and access failures on failure backoff even after partial progress', () => {
    const failed = report({ outcome: 'UPSTREAM_FAILURE', error: 'fetch failed', accepted: 3 });
    expect(isHealthyCollectorRun('PARTIAL', failed)).toBe(false);
  });

  it('does not let an explicit bounded label hide failed detail records', () => {
    const inconsistent = report({ outcome: 'BOUNDED_PROGRESS', failed: 2 });
    expect(isHealthyCollectorRun('PARTIAL', inconsistent)).toBe(false);
  });

  it('allows a small share of identified invalid details without treating them as a source outage', () => {
    const details = report({ outcome: 'INVALID_DETAIL', failed: 1, error: 'One detail could not be parsed' });
    expect(isHealthyCollectorRun('PARTIAL', details, 0.1)).toBe(true);
    expect(isHealthyCollectorRun('PARTIAL', { ...details, failed: 3 }, 0.1)).toBe(false);
  });

  it('fails closed when a legacy collector has detail failures but no structured classification', () => {
    const untyped = report({ failed: 1, error: 'A vacancy detail could not be validated' });
    expect(collectionOutcome(untyped)).toBe('UPSTREAM_FAILURE');
    expect(isHealthyCollectorRun('PARTIAL', untyped)).toBe(false);
  });

  it('does not reset backoff for a bounded run that yielded no posting evidence', () => {
    expect(isHealthyCollectorRun('FAILED', report({ outcome: 'BOUNDED_PROGRESS', discovered: 0, accepted: 0 }))).toBe(false);
  });

  it('separates a verified empty census from an upstream failure', () => {
    expect(collectionOutcome(report({ complete: true, discovered: 0, accepted: 0, error: undefined }))).toBe('NO_OPENINGS');
    expect(collectionOutcome(report({ error: 'Source HTTP 503', discovered: 0, accepted: 0 }))).toBe('UPSTREAM_FAILURE');
    expect(isHealthyCollectorRun('SUCCEEDED', report({ outcome: 'NO_OPENINGS', complete: true, discovered: 0, accepted: 0 }))).toBe(true);
  });
});
