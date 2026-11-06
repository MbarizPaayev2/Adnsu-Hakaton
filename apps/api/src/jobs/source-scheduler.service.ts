import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { FeatureFlagsService } from '../operations/feature-flags.service';
import { JobsService } from './jobs.service';
import { JobSourceService } from './job-source.service';
import { collectionOutcome, isHealthyCollectorRun, type CollectionOutcome } from './collection-outcome';
import { LEASE_TTL_MS, LeaseLostError } from './source-lease.service';
import type { IngestJobDto } from './dto/ingest-job.dto';
import { collectorFor } from '../scrapers/public-jobs/collector-registry';
import type { CollectionOptions } from '../scrapers/public-jobs/public-job-collector';
import {
  ANCHOR_COUNT, HEAD_SAMPLE, REVALIDATE_AFTER_MS, Revalidation, revalidationQuota, advance, nextRunAfterSuccess, planRun,
  type DiscoveryState, type RunMode,
} from './source-discovery';
export {
  BOARD_SOURCES, DEEP_BUDGET_BOARDS, EMPLOYER_BUDGET, INCREMENTAL_BUDGET_BOARDS, RECONCILE_AFTER_INTERVALS, RECONCILIATION_BUDGET_BOARDS, chooseRunMode, planRun,
  type RunMode, type SourceBudget,
} from './source-discovery';

export const MIN_INTERVAL_MINUTES = 360; // never more often than every six hours
export const MAX_BACKOFF_MINUTES = 7 * 24 * 60;
// Bounded traffic per run, on top of each collector's own request spacing, timeouts and size limits.
// Employer sites are walked with EMPLOYER_BUDGET (source-discovery.ts: 20 pages / 300 postings, 1.5 s apart); boards stay at 12 pages / 200 postings.
export const SCHEDULED_LIMITS = { maxPages: 20, maxJobs: 300, delayMs: 1500 } as const;
const LEASE_MINUTES = LEASE_TTL_MS / 60_000;

/** A running collector renews its lease at most this often, so a slow run cannot be claimed by another process and overlap. */
export const LEASE_RENEW_EVERY_MS = 60_000;

/** Five failures in a row, or any block, put a source into a durable cooldown: nothing is claimed before cooldownUntil, whatever the process or restart. */
export const COOLDOWN_AFTER_FAILURES = 5;
export const COOLDOWN_BASE_MS = 24 * 3_600_000;
export const COOLDOWN_MAX_MS = MAX_BACKOFF_MINUTES * 60_000;
/** The cooldown doubles with each consecutive cooldown (24 h, 48 h, 96 h ... up to 7 days) and starts over after a success or an operator reset. */
export const cooldownLength = (priorCooldowns: number) => Math.min(COOLDOWN_BASE_MS * 2 ** Math.max(0, priorCooldowns), COOLDOWN_MAX_MS);

/** What to store after a failed run (or recovered abandoned one): increasing backoff and a durable cooldown after repeated failures. */
export function failureSettlement(
  source: { intervalMinutes: number; cooldownCount: number },
  failures: number,
  classification: SourceErrorClassification,
  detail: string,
  now: Date,
): { consecutiveFailures: number; nextRunAt: Date; cooldownUntil: Date | null; cooldownReason: string | null; cooldownCount: number } {
  const backoff = nextRunAfter(now, source.intervalMinutes, failures);
  if (failures >= COOLDOWN_AFTER_FAILURES) {
    const until = new Date(now.getTime() + cooldownLength(source.cooldownCount));
    return { consecutiveFailures: failures, nextRunAt: until > backoff ? until : backoff, cooldownUntil: until, cooldownReason: `${classification}: ${detail}`.slice(0, 240), cooldownCount: source.cooldownCount + 1 };
  }
  return { consecutiveFailures: failures, nextRunAt: backoff, cooldownUntil: null, cooldownReason: null, cooldownCount: source.cooldownCount };
}

export type SourceErrorClassification =
  | 'UPSTREAM_UNAVAILABLE'
  | 'PARSER_FAILURE'
  | 'UNKNOWN_ERROR';

/** At most this share of what a run listed may be postings whose detail pages do not validate for the run to still count as healthy. */
export const CONTENT_FAILURE_TOLERANCE = 0.1;

export interface CollectorLike {
  collect(options: CollectionOptions | { maxPages: number; maxJobs: number; delayMs: number }, accept: (job: IngestJobDto) => Promise<void>): Promise<{
    source: string; complete: boolean; pages: number; discovered: number; fetched: number; accepted: number; expired: number; skipped?: number; failed: number; error?: string; outcome?: CollectionOutcome;
  }>;
}
/** What one scheduled or operator-started run did, in numbers. */
export interface RunSummary {
  source: string; mode: RunMode; status: string; outcome: CollectionOutcome; ok: boolean; durationMs: number; pages: number; discovered: number; fetched: number;
  created: number; updated: number; confirmedListed: number; reopened: number; failed: number; complete: boolean; resumed: boolean;
  /** Stored postings fetched again this run (revalidation), and whether their content had changed. */
  revalidated: { fetchedAgain: number; changed: number; unchanged: number };
  duplicatesLinked: number; cursorAfter: unknown; segments: number; restartReason: string | null; nextRunAt: string;
  /** The postings whose detail page failed this run (first 20), with the reason: they are retried every run until the source's page validates. */
  failedDetails: { id: string; error: string }[];
}
export type CollectorFactory = (key: string) => CollectorLike | null;

/** The reviewed collectors only (the same list the import CLI uses). A source without one can never be scheduled, and Glorri keeps its own importer. */
export const defaultCollectorFactory: CollectorFactory = (key) => collectorFor(key);

export function nextRunAfter(now: Date, intervalMinutes: number, failures: number): Date {
  // Success: the normal interval. Each consecutive failure doubles the wait, up to a week.
  const minutes = failures === 0 ? intervalMinutes : Math.min(intervalMinutes * 2 ** Math.min(failures, 8), MAX_BACKOFF_MINUTES);
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Optional, disabled-by-default refresh of the reviewed public sources. One source per tick, claimed with a lease so
 * overlapping processes cannot run it twice, with conservative limits and exponential backoff after failures.
 * It reuses the same ingestion and run recording as the manual CLI.
 */
@Injectable()
export class SourceScheduler {
  private readonly logger = new Logger(SourceScheduler.name);
  collectors: CollectorFactory = defaultCollectorFactory;
  /** Operator-started runs in progress (they run in the background, never inside the HTTP request). */
  private inFlight = new Set<Promise<unknown>>();
  leaseRenewMs = LEASE_RENEW_EVERY_MS;

  /** Resolves when no operator-started run is in progress (used by tests and by a graceful shutdown). */
  async idle(): Promise<void> { while (this.inFlight.size) await Promise.allSettled([...this.inFlight]); }

  constructor(private prisma: PrismaService, private jobs: JobsService, private sources: JobSourceService, private flags: FeatureFlagsService) {}
  private get lease() { return this.sources.lease; }

  static enabled(env: NodeJS.ProcessEnv = process.env): boolean { return env.SOURCE_SCHEDULE_ENABLED?.trim().toLowerCase() === 'true'; }

  /**
   * Recovers runs where the worker process crashed or the lease expired.
   * Marks in-flight JobImportRun rows as FAILED, resets leaseUntil to null,
   * advances consecutiveFailures, and calculates exponential backoff.
   */
  async recoverAbandonedRuns(now = new Date()): Promise<number> {
    const stale = await this.prisma.jobSource.findMany({ where: { leaseUntil: { not: null, lt: now } } });
    let recovered = 0;
    for (const source of stale) {
      const won = await this.prisma.$transaction(async (tx) => {
        // Only one recoverer wins a given expired lease (compare-and-set on the lease value): two workers must not both count the failure.
        const failures = source.consecutiveFailures + 1;
        const claimed = await tx.jobSource.updateMany({
          where: { key: source.key, leaseUntil: source.leaseUntil, leaseOwner: source.leaseOwner },
          data: { leaseUntil: null, leaseOwner: null, leaseHeartbeatAt: null, ...failureSettlement(source, failures, 'UNKNOWN_ERROR', 'worker process terminated or lease expired', now) },
        });
        if (!claimed.count) return false;
        await tx.jobImportRun.updateMany({
          where: { source: source.key, status: 'RUNNING' },
          data: { status: 'FAILED', finishedAt: now, error: 'Worker process terminated or lease expired' },
        });
        return true;
      });
      if (!won) continue;
      recovered++;
      this.logger.warn(`Recovered abandoned lease for source ${source.key}; consecutiveFailures set to ${source.consecutiveFailures + 1}`);
    }
    // A run row left RUNNING with no live lease behind it (the lease was cleared by a later step, or never taken) can never finish: close it as FAILED.
    const orphans = await this.prisma.jobImportRun.findMany({ where: { status: 'RUNNING', startedAt: { lt: new Date(now.getTime() - LEASE_MINUTES * 60_000) } }, select: { id: true, source: true } });
    for (const run of orphans) {
      const live = await this.prisma.jobSource.findFirst({ where: { key: run.source, leaseUntil: { gt: now } }, select: { key: true } });
      if (live) continue;
      await this.prisma.jobImportRun.updateMany({ where: { id: run.id, status: 'RUNNING' }, data: { status: 'FAILED', finishedAt: now, error: 'Run never finished and holds no lease' } });
    }
    return recovered;
  }

  async tick(now = new Date()): Promise<{ ran: string | null; result?: string }> {
    if (!SourceScheduler.enabled() || (await this.flags.isPaused('import.scheduled'))) return { ran: null };
    await this.recoverAbandonedRuns(now);
    const claim = await this.claim(now);
    if (!claim) return { ran: null };
    return { ran: claim.key, result: await this.runClaimed(claim.key, now, claim.token) };
  }

  /** Atomically leases the most overdue eligible source, or none. */
  private async claim(now: Date): Promise<{ key: string; token: string } | null> {
    const due = await this.prisma.jobSource.findMany({
      where: {
        key: { not: 'glorri' }, enabled: true, scheduled: true, schedulePausedAt: null, accessReview: { not: 'RESTRICTED' },
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }], AND: [
          { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
          { OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }] },
          // A generic enable/schedule toggle must never override LinkedIn's separate access-review gate.
          { OR: [{ key: { not: 'linkedin' } }, { key: 'linkedin', accessReview: 'TERMS_REVIEWED_ALLOWED' }] },
        ],
      },
      orderBy: [{ nextRunAt: 'asc' }, { key: 'asc' }], take: 5,
    });
    for (const source of due) {
      if (!this.collectors(source.key)) continue; // no reviewed collector: never scheduled
      const token = await this.lease.acquire(source.key, 'scheduler', now);
      if (token) return { key: source.key, token };
    }
    return null;
  }

  /**
   * Starts an immediate out-of-schedule run of one source for an operator. It is checked like a scheduled run (enabled, not restricted, has a reviewed
   * collector, no live lease) and holds the same lease, so it can never overlap a scheduled or another manual run of that source. The emergency pause
   * for scheduled imports also stops this. The collection runs in the BACKGROUND: the request returns at once and the run is visible as RUNNING.
   */
  async runSourceNow(key: string, now = new Date()): Promise<{ key: string; status: 'STARTED' }> {
    const source = await this.prisma.jobSource.findUnique({ where: { key } });
    if (!source) throw new NotFoundException('Mənbə tapılmadı');
    if (key === 'glorri') throw new BadRequestException('Glorri öz idxal cədvəlini saxlayır');
    if (!source.enabled) throw new BadRequestException('Söndürülmüş mənbə icra edilə bilməz');
    if (source.accessReview === 'RESTRICTED') throw new BadRequestException('Məhdudiyyətli mənbə icra edilə bilməz');
    if (key === 'linkedin' && source.accessReview !== 'TERMS_REVIEWED_ALLOWED') throw new BadRequestException('LinkedIn mənbəsi şərtlər açıq şəkildə yoxlanıb təsdiqlənənədək icra edilə bilməz');
    if (!this.collectors(key)) throw new BadRequestException('Bu mənbə üçün kollektor yoxdur');
    if (await this.flags.isPaused('import.scheduled')) throw new ConflictException('Vakansiya idxalı operator tərəfindən dayandırılıb; əvvəlcə davam etdirin');
    if (source.cooldownUntil && source.cooldownUntil > now) throw new ConflictException('Mənbə soyutma rejimindədir; səbəbi yoxlayıb əvvəlcə soyutmanı sıfırlayın (bərpa)');

    const token = await this.lease.acquire(key, 'operator', now);
    if (!token) {
      const holder = await this.lease.describe(key, now);
      throw new ConflictException(`Mənbə hal-hazırda başqa proses (${holder?.holder ?? 'naməlum'}) tərəfindən icra olunur`);
    }

    const run = this.runClaimed(key, now, token).catch((error) => this.logger.error(`Manual run of ${key} crashed: ${error instanceof Error ? error.message : error}`));
    this.inFlight.add(run);
    void run.finally(() => this.inFlight.delete(run));
    return { key, status: 'STARTED' };
  }

  /** What the last run of each source did, in numbers (for operators, tests and the acquisition trial). Memory only; the durable record is the JobImportRun row. */
  readonly summaries = new Map<string, RunSummary>();

  private async loadProgress(key: string): Promise<DiscoveryState | null> {
    const row = await this.prisma.sourceDiscoveryProgress.findUnique({ where: { sourceKey: key } });
    if (!row) return null;
    return {
      cursor: (row.cursor as unknown as DiscoveryState['cursor']) ?? null, anchors: Array.isArray(row.anchors) ? (row.anchors as string[]) : [], generation: row.generation, segments: row.segments,
      listedInGeneration: row.listedInGeneration, lastHeadAt: row.lastHeadAt, lastSegmentAt: row.lastSegmentAt, lastDeepCompletedAt: row.lastDeepCompletedAt, restartReason: row.restartReason, headReachedEnd: row.headReachedEnd,
    };
  }

  private async saveProgress(key: string, s: DiscoveryState): Promise<void> {
    const data = {
      generation: s.generation, cursor: (s.cursor ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull, anchors: s.anchors as Prisma.InputJsonValue, segments: s.segments,
      listedInGeneration: s.listedInGeneration, lastHeadAt: s.lastHeadAt, lastSegmentAt: s.lastSegmentAt, lastDeepCompletedAt: s.lastDeepCompletedAt, restartReason: s.restartReason, headReachedEnd: s.headReachedEnd,
    };
    await this.prisma.sourceDiscoveryProgress.upsert({ where: { sourceKey: key }, create: { sourceKey: key, ...data }, update: data });
  }

  /**
   * Runs one already-leased source. The lease is ALWAYS released and the next run always scheduled, whatever happens; a run that started (RUNNING) and
   * did not record is closed as FAILED so it cannot stay "running" forever, and neither a crash nor a bounded or incomplete run can close any posting
   * (only a recorded, verified-complete listing can, inside JobSourceService.recordRun). Progress through a large listing is stored only after a run was
   * recorded and healthy, so an interrupted segment leaves the stored cursor where it was.
   */
  private async runClaimed(key: string, now: Date, token: string): Promise<string> {
    const source = await this.prisma.jobSource.findUniqueOrThrow({ where: { key } });
    const startedAt = new Date();
    const tally = { created: 0, updated: 0, unchanged: 0, reopened: 0 };
    let ok = false;
    let status = 'FAILED';
    let caughtError: unknown;
    let report: any;
    let recordedRun = false;
    let mode: RunMode = 'employer';
    let state: DiscoveryState | null = null;
    let nextState: DiscoveryState | null = null;
    let revalidation: Revalidation | undefined;
    let refreshed = { fetchedAgain: 0, changed: 0, unchanged: 0 };
    let duplicatesBefore = 0;
    let resumed = false;
    const failedDetails: { id: string; error: string }[] = [];

    try {
      await this.sources.startRun(key, startedAt);
      const collector = this.collectors(key)!;
      const lastComplete = await this.prisma.jobImportRun.findFirst({ where: { source: key, status: 'SUCCEEDED', listingComplete: true }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } });
      state = await this.loadProgress(key);
      const plan = planRun(key, source, state, lastComplete?.finishedAt ?? null, now);
      mode = plan.mode;
      resumed = !!plan.resume;
      // Progress is in the database, not in memory or a temp file: what earlier runs stored is known, so a restarted or bounded run fetches only what is still missing.
      const stored = await this.prisma.job.findMany({ where: { externalId: { startsWith: `${key}:` } }, select: { externalId: true, status: true, detailFetchedAt: true, ingestedAt: true } });
      const knownSet = new Set(stored.map((j) => j.externalId));
      // Known postings are not skipped for ever: the ones whose detail page was fetched longest ago are fetched again, a few per run.
      const cutoff = startedAt.getTime() - REVALIDATE_AFTER_MS;
      const eligible = new Set(stored.filter((j) => j.status === 'ACTIVE' && (j.detailFetchedAt ?? j.ingestedAt).getTime() < cutoff).sort((x, y) => (x.detailFetchedAt ?? x.ingestedAt).getTime() - (y.detailFetchedAt ?? y.ingestedAt).getTime()).map((j) => j.externalId));
      revalidation = new Revalidation(eligible, revalidationQuota(mode, plan.budget));
      duplicatesBefore = await this.prisma.job.count({ where: { externalId: { startsWith: `${key}:` }, duplicateOfId: { not: null } } });

      let lastRenewal = Date.now();
      const heartbeat = async () => {
        if (Date.now() - lastRenewal < this.leaseRenewMs) return;
        lastRenewal = Date.now();
        if (!(await this.lease.renew(key, token))) throw new LeaseLostError(key);
      };

      const seen: string[] = []; // listing order: the first HEAD_SAMPLE (the continuity check of a resumed segment) and the last ANCHOR_COUNT (the next anchors) are kept
      const sawId = (id: string) => { if (seen.length < HEAD_SAMPLE) seen.push(id); tail.push(id); if (tail.length > ANCHOR_COUNT) tail.shift(); };
      const tail: string[] = [];

      const confirmedBatch: string[] = [];
      const flushConfirmed = async () => {
        if (!confirmedBatch.length) return;
        const batch = confirmedBatch.splice(0, confirmedBatch.length);
        const res = await this.jobs.confirmListed(batch, startedAt);
        tally.reopened += res.reopened;
        tally.unchanged += res.confirmed - res.reopened;
      };

      const options: CollectionOptions = {
        ...plan.budget,
        ...(plan.resume ? { resume: plan.resume } : {}),
        isKnown: (id: string) => revalidation!.isKnown(knownSet, id),
        onFailedDetail: (id: string, error: string) => {
          if (failedDetails.length < 20) failedDetails.push({ id, error: error.slice(0, 160) });
        },
        onListed: async (id: string) => {
          sawId(id);
          confirmedBatch.push(id);
          if (confirmedBatch.length >= 50) await flushConfirmed();
          await heartbeat();
        },
      };

      report = await collector.collect(options, async (job) => {
        sawId(job.externalId);
        // The detail page was fetched for this posting just now: that time is what decides when it is next eligible for revalidation.
        const res = await this.jobs.upsertJob({ ...job, detailFetchedAt: job.detailFetchedAt ?? startedAt.toISOString() }, startedAt);
        tally[res.outcome]++;
        if (revalidation!.ids.has(job.externalId)) { refreshed.fetchedAgain++; if (res.outcome === 'updated' || res.outcome === 'reopened') refreshed.changed++; else refreshed.unchanged++; }
        await heartbeat();
      });
      await flushConfirmed();
      report.outcome = collectionOutcome(report);

      if (!(await this.lease.owns(key, token))) throw new LeaseLostError(key); // never record a result (or close anything) after the source was taken over
      const recorded = await this.sources.recordRun({
        source: key, startedAt: startedAt.toISOString(), complete: report.complete, outcome: report.outcome, pages: report.pages, discovered: report.discovered, fetched: report.fetched,
        accepted: report.accepted, ...tally, expired: report.expired, skipped: report.skipped ?? 0, failed: report.failed,
        ...(report.error ? { error: report.error.slice(0, 300) } : {}),
        ...(plan.resume ? { segment: true } : {}), // a resumed segment never claims to have walked the listing
      }, new Date());
      recordedRun = true;
      status = recorded.status;
      // A run bounded by its limits is not a failure and must not trigger backoff; an error, a parse failure or a block is. A source with nothing new is
      // not failing either: a bounded run that listed postings (new, refreshed or confirmed) and had no hard error is healthy. Staleness stays honest
      // because only complete listings count as fresh.
      // A few postings whose own detail page does not validate (the same ones every run) are not the source failing: the run still listed and stored what it
      // could, so it is healthy and its progress is kept. It stays incomplete (nothing is closed from it) and the unparsed postings are named in the log and
      // in the run's failure count. Transport failures (a block, a rate limit, a timeout) and a large share of unparsed pages are failures as before.
      ok = isHealthyCollectorRun(recorded.status, report, CONTENT_FAILURE_TOLERANCE);
      // Progress moves only for a recorded, healthy run; an interrupted or failed segment leaves the stored cursor exactly where it was.
      if (ok) {
        nextState = advance(state, { mode, startedAt, finishedAt: new Date(), reportCursor: report.cursor, discovered: report.discovered, head: seen, tail: [...tail], resumed });
        await this.saveProgress(key, nextState);
      }
    } catch (error) {
      caughtError = error;
      this.logger.warn(`Scheduled run of ${key} failed: ${error instanceof Error ? error.message : 'error'}`);
    }

    try {
      if (!recordedRun) await this.sources.failRun(key, startedAt, caughtError instanceof Error ? caughtError.message : 'Run ended without recording a result');
    } finally {
      const durationMs = Date.now() - startedAt.getTime();
      const failures = ok ? 0 : source.consecutiveFailures + 1;
      const outcome = report ? collectionOutcome(report) : null;
      const classification: SourceErrorClassification = ok ? 'UNKNOWN_ERROR'
        : outcome === 'UPSTREAM_FAILURE' ? 'UPSTREAM_UNAVAILABLE'
          : outcome === 'INVALID_DETAIL' ? 'PARSER_FAILURE' : 'UNKNOWN_ERROR';
      const settlement = ok
        ? { consecutiveFailures: 0, nextRunAt: mode === 'employer' ? nextRunAfter(new Date(), source.intervalMinutes, 0) : nextRunAfterSuccess(source, nextState, new Date(), MIN_INTERVAL_MINUTES * 60_000), cooldownUntil: null, cooldownReason: null, cooldownCount: 0 }
        : failureSettlement(source, failures, classification, report?.error || (caughtError instanceof Error ? caughtError.message : 'run failed'), new Date());
      const nextRun = settlement.nextRunAt;
      // Only the current owner of the lease settles the source: a run whose lease was lost (expired and recovered or taken over) must not overwrite what the new owner decides.
      const settled = await this.prisma.jobSource.updateMany({ where: { key, leaseOwner: token }, data: { ...settlement, leaseUntil: null, leaseOwner: null, leaseHeartbeatAt: null } });
      if (!settled.count) this.logger.warn(JSON.stringify({ event: 'source_run_lease_lost', source: key, mode }));

      const duplicatesAfter = await this.prisma.job.count({ where: { externalId: { startsWith: `${key}:` }, duplicateOfId: { not: null } } }).catch(() => duplicatesBefore);
      const summary: RunSummary = {
        source: key, mode, status, outcome: report?.outcome ?? 'UPSTREAM_FAILURE', ok, durationMs, pages: report?.pages ?? 0, discovered: report?.discovered ?? 0, fetched: report?.fetched ?? 0, created: tally.created, updated: tally.updated,
        confirmedListed: tally.unchanged + tally.reopened, reopened: tally.reopened, failed: report?.failed ?? 0, complete: report?.complete ?? false, resumed,
        revalidated: refreshed, duplicatesLinked: Math.max(0, duplicatesAfter - duplicatesBefore), cursorAfter: nextState?.cursor ?? null, segments: nextState?.segments ?? state?.segments ?? 0,
        restartReason: nextState?.restartReason ?? null, nextRunAt: nextRun.toISOString(), failedDetails,
      };
      this.summaries.set(key, summary);

      if (!ok) {
        this.logger.warn(JSON.stringify({
          event: 'source_collection_failed', source: key, mode, phase: 'collection', durationMs, classification,
          error: report?.error || (caughtError instanceof Error ? caughtError.message : String(caughtError || 'failed')),
          consecutiveFailures: failures, nextRunAt: nextRun.toISOString(),
        }));
        if (settlement.cooldownUntil) {
          this.logger.error(JSON.stringify({ event: 'source_cooldown_started', source: key, consecutiveFailures: failures, classification, cooldownUntil: settlement.cooldownUntil.toISOString(), cooldownCount: settlement.cooldownCount, message: 'No further runs until the cooldown ends or an operator resets it (admin: Mənbələr).' }));
        }
      } else {
        this.logger.log(JSON.stringify({ event: 'source_collection_succeeded', ...summary }));
      }
    }
    return status;
  }

  /** Stale = scheduled but no verified-complete listing within twice its interval. Manual sources are never "stale", only unscheduled. */
  static staleness(source: { scheduled: boolean; intervalMinutes: number }, lastCompleteListingAt: Date | null, now = new Date()): 'not_scheduled' | 'never_completed' | 'stale' | 'fresh' {
    if (!source.scheduled) return 'not_scheduled';
    if (!lastCompleteListingAt) return 'never_completed';
    return now.getTime() - lastCompleteListingAt.getTime() > 2 * source.intervalMinutes * 60_000 ? 'stale' : 'fresh';
  }
}
