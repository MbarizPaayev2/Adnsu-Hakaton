import { BOARD_SOURCES, EMPLOYER_BUDGET, DEEP_BUDGET_BOARDS, DEEP_EVERY_MS, DEEP_GAP_MS, INCREMENTAL_BUDGET_BOARDS, RECONCILIATION_BUDGET_BOARDS, REVALIDATE_AFTER_MS, Revalidation, REVALIDATE_PER_RUN, revalidationQuota, advance, continuity, deepWanted, freshState, nextRunAfterSuccess, planRun, type DiscoveryState } from './source-discovery';

const t0 = new Date('2026-10-04T12:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const H = 3_600_000;
const source = { intervalMinutes: 1440 };
const state = (over: Partial<DiscoveryState> = {}): DiscoveryState => ({ ...freshState(), lastHeadAt: t0, lastDeepCompletedAt: t0, ...over });
const facts = (over: Record<string, unknown> = {}) => ({ mode: 'incremental' as const, startedAt: at(1000), finishedAt: at(2000), reportCursor: undefined as any, discovered: 40, head: ['a1', 'a2', 'a3'], tail: ['z1', 'z2'], resumed: false, ...over });

describe('planRun: head refresh, deep segments, employer feeds', () => {
  it('classifies HRIN as a board with bounded discovery traversal', () => {
    expect(BOARD_SOURCES.has('hrin')).toBe(true);
    expect(planRun('hrin', source, null, null, t0).mode).toBe('reconciliation');
  });
  it('employer feeds are always a complete walk with their own budget', () => {
    expect(planRun('abb', source, null, null, t0).mode).toBe('employer');
    expect(planRun('xsolla', source, state({ cursor: { kind: 'page', page: 3 } }), t0, at(30 * H)).mode).toBe('employer');
  });
  it('a board with no progress, or a due head refresh, starts at the head (reconciliation until a complete listing exists)', () => {
    expect(planRun('work', source, null, null, t0)).toMatchObject({ mode: 'reconciliation', budget: RECONCILIATION_BUDGET_BOARDS });
    expect(planRun('work', source, state({ cursor: { kind: 'page', page: 4 } }), t0, at(25 * H))).toMatchObject({ mode: 'incremental', budget: INCREMENTAL_BUDGET_BOARDS }); // head due beats a pending cursor
  });
  it('between head refreshes a stored cursor is continued, a due traversal is started, and otherwise the head is refreshed', () => {
    const cursor = { kind: 'page', page: 4 } as const;
    expect(planRun('work', source, state({ cursor }), t0, at(6 * H))).toEqual({ mode: 'deep', budget: DEEP_BUDGET_BOARDS, resume: cursor });
    expect(planRun('work', source, state({ lastDeepCompletedAt: at(-DEEP_EVERY_MS - H) }), t0, at(6 * H))).toMatchObject({ mode: 'deep', startsTraversal: true });
    expect(planRun('work', source, state({ restartReason: 'listing_shifted', lastDeepCompletedAt: t0 }), t0, at(6 * H))).toMatchObject({ mode: 'deep', startsTraversal: true });
    expect(planRun('work', source, state(), t0, at(6 * H)).mode).toBe('incremental'); // nothing pending
  });
  it('every budget stays inside the polite floor', () => {
    for (const b of [DEEP_BUDGET_BOARDS, INCREMENTAL_BUDGET_BOARDS, RECONCILIATION_BUDGET_BOARDS]) { expect(b.delayMs).toBeGreaterThanOrEqual(1500); expect(b.maxPages).toBeLessThanOrEqual(12); expect(b.maxJobs).toBeLessThanOrEqual(200); }
  });
});

describe('a board that does not fit one head run is not reconciled again and again', () => {
  it('after a head run that did not reach the end, head refreshes stay cheap; before anything is learned, and after a finished traversal, one reconciliation tries again', () => {
    expect(planRun('work', source, state({ headReachedEnd: false, lastDeepCompletedAt: t0 }), null, at(25 * H))).toMatchObject({ mode: 'incremental', budget: INCREMENTAL_BUDGET_BOARDS });
    expect(planRun('work', source, state({ headReachedEnd: true }), null, at(25 * H)).mode).toBe('reconciliation');
    expect(planRun('work', source, state({ headReachedEnd: null }), null, at(25 * H)).mode).toBe('reconciliation');
    expect(planRun('work', source, null, null, t0).mode).toBe('reconciliation');
  });
  it('a head run records whether it reached the end; a completed traversal clears the finding so the next head run learns it again', () => {
    expect(advance(state(), facts({ reportCursor: { kind: 'page', page: 13 } })).headReachedEnd).toBe(false);
    expect(advance(state(), facts({ reportCursor: null })).headReachedEnd).toBe(true);
    const done = advance(state({ cursor: { kind: 'page', page: 30 }, anchors: ['a1'], headReachedEnd: false }), facts({ mode: 'deep', resumed: true, reportCursor: null, head: ['a1'] }));
    expect(done.headReachedEnd).toBeNull();
  });
});

describe('continuity: a positional cursor must overlap what was read last', () => {
  it('a page or url cursor needs at least one anchor among the first postings of the resumed segment', () => {
    expect(continuity({ kind: 'page', page: 5 }, ['a', 'b'], ['x', 'b', 'y'])).toEqual({ ok: true });
    expect(continuity({ kind: 'url', url: 'u' }, ['a', 'b'], ['x', 'y'])).toEqual({ ok: false, reason: 'listing_shifted' });
    expect(continuity({ kind: 'page', page: 5 }, [], ['x'])).toEqual({ ok: true }); // nothing recorded to compare with
  });
  it('item-anchored cursors and shard queues do not depend on position', () => {
    expect(continuity({ kind: 'cursor', value: 'c' }, ['a'], ['x'])).toEqual({ ok: true });
    expect(continuity({ kind: 'queue', pending: ['s'] }, ['a'], ['x'])).toEqual({ ok: true });
  });
});

describe('advance: durable progress through a large listing', () => {
  it('a head run that stopped early seeds the deep traversal with its cursor and anchors', () => {
    const next = advance(state({ lastDeepCompletedAt: null }), facts({ mode: 'reconciliation', reportCursor: { kind: 'page', page: 13 } }));
    expect(next).toMatchObject({ cursor: { kind: 'page', page: 13 }, anchors: ['z1', 'z2'], segments: 0, listedInGeneration: 40, lastHeadAt: at(1000) });
  });
  it('a head run that walked everything (or a collector with no cursors) leaves nothing to traverse', () => {
    expect(advance(state({ lastDeepCompletedAt: null }), facts({ reportCursor: null }))).toMatchObject({ cursor: null, lastDeepCompletedAt: at(2000) });
    expect(advance(state({ lastDeepCompletedAt: null }), facts({ reportCursor: undefined }))).toMatchObject({ cursor: null, lastDeepCompletedAt: at(2000) });
  });
  it('a head run does not disturb a traversal already in progress', () => {
    const s = state({ cursor: { kind: 'page', page: 8 }, anchors: ['q'], segments: 2 });
    expect(advance(s, facts({ reportCursor: { kind: 'page', page: 5 } }))).toMatchObject({ cursor: { kind: 'page', page: 8 }, anchors: ['q'], segments: 2, lastHeadAt: at(1000) });
  });
  it('a resumed segment that overlaps advances the cursor, the anchors and the counters; reaching the end completes the traversal', () => {
    const s = state({ cursor: { kind: 'page', page: 5 }, anchors: ['a1'], segments: 1, listedInGeneration: 40, lastDeepCompletedAt: null });
    const moved = advance(s, facts({ mode: 'deep', resumed: true, reportCursor: { kind: 'page', page: 9 }, head: ['a1', 'a2'] }));
    expect(moved).toMatchObject({ cursor: { kind: 'page', page: 9 }, anchors: ['z1', 'z2'], segments: 2, listedInGeneration: 80, generation: s.generation });
    const done = advance(moved, facts({ mode: 'deep', resumed: true, reportCursor: null, head: ['z1'] }));
    expect(done).toMatchObject({ cursor: null, segments: 0, lastDeepCompletedAt: at(2000), restartReason: null });
  });
  it('a segment that does not overlap means the listing shifted: the traversal restarts with a new generation and a recorded reason', () => {
    const s = state({ cursor: { kind: 'page', page: 5 }, anchors: ['a1', 'a2'], segments: 3, listedInGeneration: 120 });
    const out = advance(s, facts({ mode: 'deep', resumed: true, reportCursor: { kind: 'page', page: 9 }, head: ['n1', 'n2'] }));
    expect(out).toMatchObject({ cursor: null, anchors: [], segments: 0, listedInGeneration: 0, restartReason: 'listing_shifted' });
    expect(out.generation).not.toBe(s.generation);
    expect(deepWanted(out, at(3000))).toBe(true); // and the next run starts a fresh traversal
  });
  it('employer feeds keep no traversal state', () => {
    const s = state();
    expect(advance(s, facts({ mode: 'employer', reportCursor: { kind: 'page', page: 2 } }))).toEqual(s);
  });
});

describe('scheduling after a healthy run', () => {
  const floor = 6 * H;
  it('while a traversal is pending the next run is a deep segment soon (never inside the floor); otherwise at the head refresh time', () => {
    const pending = state({ cursor: { kind: 'page', page: 3 }, lastHeadAt: t0 });
    expect(nextRunAfterSuccess(source, pending, at(1 * H), floor).getTime()).toBe(at(1 * H + DEEP_GAP_MS).getTime());
    expect(nextRunAfterSuccess(source, pending, at(23 * H), floor).getTime()).toBe(at(24 * H).getTime() > at(23 * H + floor).getTime() ? at(24 * H).getTime() : at(23 * H + floor).getTime());
    expect(nextRunAfterSuccess(source, state(), at(1 * H), floor).getTime()).toBe(at(24 * H).getTime());
  });
});

describe('revalidation: known postings are not skipped for ever', () => {
  const known = new Set(['k1', 'k2', 'k3', 'k4']);
  it('only eligible known postings are fetched again, at most the quota per run; the rest are skipped as known; unknown ones are never skipped', () => {
    const r = new Revalidation(new Set(['k1', 'k2', 'k3']), 2);
    expect(r.isKnown(known, 'k1')).toBe(false); // revalidated
    expect(r.isKnown(known, 'k2')).toBe(false);
    expect(r.isKnown(known, 'k3')).toBe(true); // over the quota
    expect(r.isKnown(known, 'k4')).toBe(true); // not eligible
    expect(r.isKnown(known, 'new')).toBe(false); // unknown
    expect([...r.ids]).toEqual(['k1', 'k2']);
    expect(r.isKnown(known, 'k1')).toBe(false); // asked again for the same one: still revalidated, not double counted
    expect(r.ids.size).toBe(2);
  });
  it('the age that makes a posting eligible is two weeks', () => expect(REVALIDATE_AFTER_MS).toBe(14 * 24 * H));
});

describe('revalidation never starves discovery', () => {
  it('uses at most a quarter of the run\'s job budget, and the planned quota for the real budgets', () => {
    expect(revalidationQuota('incremental', { maxPages: 1, maxJobs: 10, delayMs: 1500 })).toBe(2); // a tiny budget keeps almost all of it for new postings
    expect(revalidationQuota('deep', { maxPages: 1, maxJobs: 0, delayMs: 1500 })).toBe(0);
    expect(revalidationQuota('incremental', INCREMENTAL_BUDGET_BOARDS)).toBe(REVALIDATE_PER_RUN.incremental);
    expect(revalidationQuota('deep', DEEP_BUDGET_BOARDS)).toBe(REVALIDATE_PER_RUN.deep);
    for (const b of [INCREMENTAL_BUDGET_BOARDS, RECONCILIATION_BUDGET_BOARDS, DEEP_BUDGET_BOARDS]) expect(revalidationQuota('deep', b)).toBeLessThanOrEqual(b.maxJobs / 4);
  });

  it('an employer feed gets room for a complete walk: ABB (11 pages of 10) and Kapital (63 postings) fit one run', () => {
    expect(EMPLOYER_BUDGET.maxPages).toBeGreaterThanOrEqual(15);
    expect(EMPLOYER_BUDGET.maxJobs).toBeGreaterThanOrEqual(250);
    expect(EMPLOYER_BUDGET.delayMs).toBeGreaterThanOrEqual(1500); // spacing is unchanged
  });
});
