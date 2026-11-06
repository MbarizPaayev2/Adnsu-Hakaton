import { randomUUID } from 'node:crypto';
import type { DiscoveryCursor } from '../scrapers/public-jobs/public-job-collector';

/**
 * Durable discovery coverage for the scheduled sources, as pure rules (the scheduler stores and reads the state).
 *
 * A job board is far larger than one bounded run can read. Three kinds of run share the work and never confuse each other's authority:
 *  - HEAD refresh (incremental, or reconciliation when no complete listing exists for a while): from the first page, cheap and frequent. It is the only kind
 *    that can ever walk a whole listing from its start in one run, so it is the only kind a closure can come from (JobSourceService.recordRun).
 *  - DEEP segments: continue a stored traversal from where the last segment stopped, so bounded runs keep going beyond the same head pages. A resumed
 *    segment is always reported as a segment and can NEVER close anything, however far it got; an interrupted segment (crash, lease lost, hard error) stores nothing.
 *  - REVALIDATION: a small number of stored postings per run, oldest detail check first, are fetched again instead of being skipped as "known" for ever.
 *
 * Shifting listings: positional cursors (page numbers, listing URLs) are resumed one page EARLIER than they stopped, and every segment stores the postings it
 * saw last (`anchors`). The next resumed segment must see at least one of them in its first postings; if it does not, the listing moved under the cursor
 * and the traversal restarts (with a recorded reason) instead of trusting a stale page number.
 */
export interface SourceBudget { maxPages: number; maxJobs: number; delayMs: number }

export const INCREMENTAL_BUDGET_BOARDS: SourceBudget = { maxPages: 4, maxJobs: 80, delayMs: 1500 };
export const RECONCILIATION_BUDGET_BOARDS: SourceBudget = { maxPages: 12, maxJobs: 200, delayMs: 2000 };
export const DEEP_BUDGET_BOARDS: SourceBudget = { maxPages: 12, maxJobs: 120, delayMs: 2000 };
/**
 * One employer's own feed or ATS tenant: walked completely every run. 5 pages / 150 postings stopped ABB's feed (11 pages of 10, 106 postings on 11 October) at 50
 * for ever, so 55 postings were never collected and the listing was never complete enough to close anything. Still bounded: 20 pages at 1.5 s spacing.
 */
export const EMPLOYER_BUDGET: SourceBudget = { maxPages: 20, maxJobs: 300, delayMs: 1500 };

/** The job boards (large, paginated, newest first). Everything else with a collector is an employer feed or ATS tenant: small, walked completely every run. */
export const BOARD_SOURCES: ReadonlySet<string> = new Set(['hellojob', 'work', 'boss', 'smartjob', 'ejob', 'jobsearch', 'hrin', 'linkedin', 'banker']);
/** A board is reconciled (a deeper head walk that can prove a complete listing) when it has had none for this many intervals. */
export const RECONCILE_AFTER_INTERVALS = 3;
/** A new deep traversal starts when the last completed one is older than this. */
export const DEEP_EVERY_MS = 7 * 24 * 3_600_000;
/** Between a head refresh and the next, deep segments are spaced at least this far apart (never faster than the source's own six-hour floor). */
export const DEEP_GAP_MS = 6 * 3_600_000;
/** A stored posting whose detail page was last fetched longer ago than this is eligible to be fetched again. */
export const REVALIDATE_AFTER_MS = 14 * 24 * 3_600_000;
/** How many eligible postings one run may fetch again (on top of the new ones), by run kind. Bounded so revalidation never crowds out discovery. */
export const REVALIDATE_PER_RUN: Record<RunMode, number> = { incremental: 10, reconciliation: 10, deep: 20, employer: 25 };
/** Revalidation may use at most this share of a run's job budget, so refreshing old postings can never starve the discovery of new ones (a collector's budget is shared). */
export const REVALIDATE_MAX_SHARE = 0.25;
export const revalidationQuota = (mode: RunMode, budget: SourceBudget): number => Math.min(REVALIDATE_PER_RUN[mode], Math.floor(budget.maxJobs * REVALIDATE_MAX_SHARE));
export const ANCHOR_COUNT = 10;
/** How many of the postings a run saw (in listing order) are kept to check a resumed segment against the stored anchors. It must exceed one real page (about 50 postings) several times over: a segment resumes one page EARLIER, so the anchors are somewhere in its first page or two, not in its first few postings. */
export const HEAD_SAMPLE = 600;

export type RunMode = 'incremental' | 'reconciliation' | 'deep' | 'employer';

export interface DiscoveryState {
  cursor: DiscoveryCursor | null;
  anchors: string[];
  generation: string;
  segments: number;
  listedInGeneration: number;
  lastHeadAt: Date | null;
  lastSegmentAt: Date | null;
  lastDeepCompletedAt: Date | null;
  restartReason: string | null;
  /** Whether the last head run reached the end of the listing (the board fits one run); null = not learned yet. */
  headReachedEnd: boolean | null;
}

export const freshState = (): DiscoveryState => ({ cursor: null, anchors: [], generation: randomUUID(), segments: 0, listedInGeneration: 0, lastHeadAt: null, lastSegmentAt: null, lastDeepCompletedAt: null, restartReason: null, headReachedEnd: null });

export const deepWanted = (s: DiscoveryState | null, now: Date) =>
  !s || !!s.cursor || !!s.restartReason || !s.lastDeepCompletedAt || now.getTime() - s.lastDeepCompletedAt.getTime() >= DEEP_EVERY_MS;

/** Which head-family mode a board uses: reconciliation until it has a verified-complete listing, and again when the last one is too old. */
export function chooseRunMode(key: string, source: { intervalMinutes: number }, lastCompleteListingAt: Date | null, now: Date): { mode: RunMode; budget: SourceBudget } {
  if (!BOARD_SOURCES.has(key)) return { mode: 'employer', budget: EMPLOYER_BUDGET };
  const stale = !lastCompleteListingAt || now.getTime() - lastCompleteListingAt.getTime() > RECONCILE_AFTER_INTERVALS * source.intervalMinutes * 60_000;
  return stale ? { mode: 'reconciliation', budget: RECONCILIATION_BUDGET_BOARDS } : { mode: 'incremental', budget: INCREMENTAL_BUDGET_BOARDS };
}

export interface RunPlan { mode: RunMode; budget: SourceBudget; resume?: DiscoveryCursor; startsTraversal?: boolean }

/** What the next run of a source does. Employer feeds are always a complete walk; a board does a head refresh when one is due, otherwise a deep segment. */
export function planRun(key: string, source: { intervalMinutes: number }, state: DiscoveryState | null, lastCompleteListingAt: Date | null, now: Date): RunPlan {
  if (!BOARD_SOURCES.has(key)) return { mode: 'employer', budget: EMPLOYER_BUDGET };
  const headDue = !state?.lastHeadAt || now.getTime() - state.lastHeadAt.getTime() >= source.intervalMinutes * 60_000;
  if (!headDue && state) {
    if (state.cursor) return { mode: 'deep', budget: DEEP_BUDGET_BOARDS, resume: state.cursor };
    if (deepWanted(state, now)) return { mode: 'deep', budget: DEEP_BUDGET_BOARDS, startsTraversal: true };
  }
  const head = chooseRunMode(key, source, lastCompleteListingAt, now);
  // A board that did not fit the last head run's budget cannot be reconciled in one run: its head refresh stays cheap and the deep traversal covers the rest.
  if (head.mode === 'reconciliation' && state?.headReachedEnd === false) return { mode: 'incremental', budget: INCREMENTAL_BUDGET_BOARDS };
  return head;
}

/** Whether a resumed segment is still reading the same listing the cursor was taken from: positional cursors must overlap what was seen last (any anchor among the postings the segment read). */
export function continuity(cursor: DiscoveryCursor, anchors: string[], headSample: string[]): { ok: true } | { ok: false; reason: string } {
  if (cursor.kind === 'cursor' || cursor.kind === 'queue') return { ok: true }; // item-anchored or a queue of shards: not position-dependent
  if (!anchors.length) return { ok: true };
  return headSample.some((id) => anchors.includes(id)) ? { ok: true } : { ok: false, reason: 'listing_shifted' };
}

export interface RunFacts {
  mode: RunMode;
  startedAt: Date;
  finishedAt: Date;
  /** The cursor the collector reported: a cursor, null (it reached the listing's end) or undefined (this collector reports none). */
  reportCursor: DiscoveryCursor | null | undefined;
  discovered: number;
  /** The first postings seen this run, in listing order, and the last ones. */
  head: string[];
  tail: string[];
  resumed: boolean;
}

/** The stored progress after a run that was recorded and healthy. Pure; nothing here ever touches a posting. */
export function advance(state: DiscoveryState | null, f: RunFacts): DiscoveryState {
  const s: DiscoveryState = { ...(state ?? freshState()), anchors: [...(state?.anchors ?? [])] };
  if (f.mode === 'employer') return s;
  const complete = (): void => { s.cursor = null; s.anchors = []; s.segments = 0; s.listedInGeneration = 0; s.restartReason = null; s.lastDeepCompletedAt = f.finishedAt; };
  // A completed traversal may mean the board has shrunk to fit: let the next head run find out.
  const completedTraversal = (): void => { complete(); s.headReachedEnd = null; };

  if (f.mode === 'incremental' || f.mode === 'reconciliation') {
    s.lastHeadAt = f.startedAt;
    s.headReachedEnd = f.reportCursor === null || f.reportCursor === undefined;
    if (!s.cursor && deepWanted(state, f.finishedAt)) {
      if (f.reportCursor === undefined || f.reportCursor === null) complete(); // nothing beyond the head read (or no cursor support): nothing to traverse
      else { s.generation = randomUUID(); s.cursor = f.reportCursor; s.anchors = f.tail; s.segments = 0; s.listedInGeneration = f.discovered; s.restartReason = null; s.lastSegmentAt = f.finishedAt; }
    }
    return s;
  }

  // deep
  if (f.resumed && state?.cursor) {
    const c = continuity(state.cursor, state.anchors, f.head);
    if (!c.ok) {
      // The listing moved under the cursor: do not trust it. Start over (a new generation) and say why.
      return { ...s, cursor: null, anchors: [], generation: randomUUID(), segments: 0, listedInGeneration: 0, restartReason: c.reason, lastSegmentAt: f.finishedAt };
    }
  } else {
    s.generation = randomUUID();
    s.segments = 0;
    s.listedInGeneration = 0;
  }
  if (f.reportCursor === undefined || f.reportCursor === null) { completedTraversal(); s.lastSegmentAt = f.finishedAt; return s; }
  s.cursor = f.reportCursor; s.anchors = f.tail; s.segments += 1; s.listedInGeneration += f.discovered; s.lastSegmentAt = f.finishedAt; s.restartReason = null;
  return s;
}

/** When a healthy source next runs: the head refresh time, or sooner (but never within the six-hour floor) while a deep traversal is pending. */
export function nextRunAfterSuccess(source: { intervalMinutes: number }, state: DiscoveryState | null, now: Date, floorMs: number): Date {
  const headDueAt = (state?.lastHeadAt ?? now).getTime() + source.intervalMinutes * 60_000;
  const deepPending = !!state && (!!state.cursor || !!state.restartReason);
  const candidate = deepPending ? Math.min(headDueAt, now.getTime() + DEEP_GAP_MS) : headDueAt;
  return new Date(Math.max(candidate, now.getTime() + floorMs));
}

/**
 * Which stored postings a run fetches AGAIN instead of skipping as known: those whose detail page was last fetched longest ago (past REVALIDATE_AFTER_MS),
 * up to a per-run quota, in the order the listing presents them. Everything else known is only confirmed as listed.
 */
export class Revalidation {
  readonly ids = new Set<string>();
  constructor(private eligible: ReadonlySet<string>, private quota: number) {}
  /** The collector's isKnown: true = skip the detail fetch. */
  isKnown(known: ReadonlySet<string>, id: string): boolean {
    if (!known.has(id)) return false;
    if (this.eligible.has(id) && (this.ids.has(id) || this.ids.size < this.quota)) { this.ids.add(id); return false; }
    return true;
  }
}
