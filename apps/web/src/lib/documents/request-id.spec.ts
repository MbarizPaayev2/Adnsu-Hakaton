import { describe, expect, it } from 'vitest';
import { createRequestIdKeeper, newRequestId } from './request-id';

describe('document request ids', () => {
  it('are valid for the server (8-64 characters) and unique', () => {
    const ids = new Set(Array.from({ length: 50 }, newRequestId));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id.length).toBeGreaterThanOrEqual(8);
      expect(id.length).toBeLessThanOrEqual(64);
    }
  });

  it('keeps the key for an identical request until an answer is received (a retry after an unknown outcome is replayed, not charged twice)', () => {
    const keeper = createRequestIdKeeper();
    const first = keeper.forRequest({ matchId: 'm1', kind: 'CV', language: 'az' });
    expect(keeper.forRequest({ matchId: 'm1', kind: 'CV', language: 'az' })).toBe(first);
  });

  it('starts a new key when anything about the request changes', () => {
    const keeper = createRequestIdKeeper();
    const first = keeper.forRequest({ matchId: 'm1', kind: 'CV', language: 'az' });
    for (const changed of [{ matchId: 'm2', kind: 'CV', language: 'az' }, { matchId: 'm1', kind: 'RESUME', language: 'az' }, { matchId: 'm1', kind: 'CV', language: 'en' }]) {
      expect(keeper.forRequest(changed)).not.toBe(first);
      keeper.forRequest({ matchId: 'm1', kind: 'CV', language: 'az' });
    }
  });

  it('starts a new key after the outcome is known, so a failed or finished attempt is never replayed', () => {
    const keeper = createRequestIdKeeper();
    const parts = { matchId: 'm1', kind: 'LETTER', language: 'az', motivation: 'x' };
    const first = keeper.forRequest(parts);
    keeper.settle();
    expect(keeper.forRequest(parts)).not.toBe(first);
  });
});
