import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { JobsService } from './jobs.service';
import type { ImportRunReportDto } from './dto/import-run.dto';
import { collectionOutcome } from './collection-outcome';
import { COLLECTOR_KEYS } from '../scrapers/public-jobs/collector-registry';
import { SourceLeaseService } from './source-lease.service';

// A posting is closed only after this many CONSECUTIVE complete listings
// lacked it. One miss can be a transient source gap; deadline-less postings
// have no other signal that they ended.
export const CLOSE_AFTER_COMPLETE_MISSES = 2;
// A "complete" listing far smaller than the last complete one is more likely
// a source hiccup than mass closure; such a run closes nothing.
export const MIN_LISTED_SHARE_FOR_CLOSURE = 0.5;
const MAX_RUN_AGE_MS = 6 * 60 * 60 * 1000;

export type OperationalStatus = 'COOLING_DOWN' | 'RUNNING' | 'HEALTHY' | 'DEGRADED' | 'CIRCUIT_BROKEN' | 'BLOCKED' | 'RATE_LIMITED' | 'PAUSED' | 'DISABLED' | 'RESTRICTED' | 'OVERDUE' | 'IDLE';

export function computeOperationalStatus(s: {
  enabled: boolean;
  schedulePausedAt: Date | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastRunStatus: string | null;
  scheduled: boolean;
  /** A live lease: a run is in progress right now. */
  runningNow?: boolean;
  cooldownUntil?: Date | null;
  cooldownReason?: string | null;
  /** The access review: a restricted source is never collected, so it can never be reported as working. */
  accessReview?: string;
  intervalMinutes?: number;
  /** When the last run started (any status). */
  lastRunAt?: Date | null;
}, now = new Date()): { status: OperationalStatus; action: string } {
  if (!s.enabled) {
    return { status: 'DISABLED', action: 'Mənbə sistemdə söndürülüb (enabled=false).' };
  }
  if (s.accessReview === 'RESTRICTED') {
    return { status: 'RESTRICTED', action: 'Mənbədə məhdudiyyət qeyd olunub; nə cədvəllə, nə əl ilə icra edilmir. Əvvəlki məlumatlar köhnə ola bilər.' };
  }
  if (s.schedulePausedAt) {
    return { status: 'PAUSED', action: 'Mənbə cədvəli operator tərəfindən dayandırılıb. Bərpa etmək üçün davam etdirin.' };
  }
  if (s.cooldownUntil && s.cooldownUntil > now) {
    return { status: 'COOLING_DOWN', action: `Mənbə ${s.cooldownUntil.toISOString().slice(0, 16).replace('T', ' ')} UTC-yə qədər soyutma rejimindədir (${(s.cooldownReason ?? 'səbəb qeyd olunmayıb').slice(0, 120)}). Bu vaxt keçəndə mənbə bir yoxlama icrası edəcək; səbəb aradan qalxıbsa, “Bərpa et” ilə soyutmanı dərhal sıfırlaya bilərsiniz. Bloklanma varsa, onu aşmağa cəhd etməyin.` };
  }
  if (s.runningNow) {
    return { status: 'RUNNING', action: 'Mənbə hazırda icra olunur; nəticə bitəndən sonra görünəcək.' };
  }
  if (s.consecutiveFailures >= 5) {
    return { status: 'CIRCUIT_BROKEN', action: 'Mənbə ardıcıl 5+ dəfə uğursuz oldu. Şəbəkə qaydalarını və parseri yoxlayın.' };
  }
  if (s.lastError) {
    const err = s.lastError.toLowerCase();
    if (err.includes('403') || err.includes('forbidden') || err.includes('blocked')) {
      return { status: 'BLOCKED', action: 'Mənbə 403 Forbidden və ya bot qorunması qaytarır. Giriş icazəsini yoxlayın.' };
    }
    if (err.includes('429') || err.includes('rate limit')) {
      return { status: 'RATE_LIMITED', action: 'Mənbə sorğu limitinə düşdü. İntervalı artırın və ya səhifə sayını azaldın.' };
    }
  }
  // The last run failed: still a fault after an operator reset the failure counter, until a run succeeds.
  if (s.consecutiveFailures > 0 || s.lastRunStatus === 'FAILED') {
    return { status: 'DEGRADED', action: 'Sonuncu icra uğursuz oldu. Avtomatik eksponensial gözləmə tətbiq olunur; növbəti uğurlu icradan sonra düzələcək.' };
  }
  // A bounded run that listed postings without error is PARTIAL by design (it proves nothing about absence) and is not a fault.
  if (s.lastRunStatus === 'SUCCEEDED' || s.lastRunStatus === 'PARTIAL') {
    // "Healthy" is a claim about NOW: only a scheduled source whose last run is recent enough is working. A source nobody collects automatically, or one
    // whose schedule stopped producing runs, must not borrow the green of an old success.
    if (!s.scheduled) {
      return { status: 'IDLE', action: 'Mənbə yalnız əl ilə yenilənir; göstərilən məlumat son əl icrasının nəticəsidir və köhnə ola bilər.' };
    }
    const lateAfterMs = 2 * (s.intervalMinutes ?? 1440) * 60_000 + 15 * 60_000;
    if (s.lastRunAt && now.getTime() - s.lastRunAt.getTime() > lateAfterMs) {
      return { status: 'OVERDUE', action: 'Cədvəl üzrə sonuncu icra gecikib (cədvəllə yenilənmə söndürülü ola bilər). Mənbənin işlədiyinə əmin olmaq üçün “İndi işlət” ilə yoxlayın.' };
    }
    return { status: 'HEALTHY', action: 'Kollektor normal işləyir.' };
  }
  return { status: 'IDLE', action: 'Mənbə hazır vəziyyətdədir; hələ icra olmayıb.' };
}

export interface SourceHealth {
  key: string; name: string; employer: string | null; homepageUrl: string; collectionMethod: string; scope: string;
  accessReview: string; accessNote: string | null; reviewedAt: Date | null; applicationMethods: string[];
  enabled: boolean; scheduled: boolean;
  schedule: { mode: string; intervalMinutes: number; nextRunAt: Date | null; consecutiveFailures: number; staleness: string; isPaused: boolean; leaseUntil: Date | null; cooldownUntil: Date | null; cooldownReason: string | null; cooldownCount: number };
  operationalStatus: OperationalStatus; recommendedAction: string;
  /** How far the deeper traversal of a large board has got (null: the source keeps none, or has not run yet). */
  discovery: { traversalInProgress: boolean; segments: number; listedInGeneration: number; lastHeadAt: Date | null; lastSegmentAt: Date | null; lastDeepCompletedAt: Date | null; restartReason: string | null; headReachedEnd: boolean | null } | null;
  lastRunAt: Date | null; lastRunStatus: string | null; lastSuccessAt: Date | null; lastCompleteListingAt: Date | null; lastError: string | null;
  lastRun: { discovered: number; pages: number; accepted: number; rejected: number; skipped: number; expired: number; failed: number; closed: number; listingComplete: boolean; closureSkipped: string | null; outcome: string | null } | null;
  /**
   * What the last runs prove about the listing. `verified_complete`: the last successful run walked the whole listing with no failures, so
   * postings seen in it are known to be listed. `bounded_or_partial`: the last run stopped at a limit or had failures: nothing may be inferred
   * about postings it did not see. `failed`: the last run failed. `never_run`: no run is recorded. Never inferred from zero failures alone.
   */
  completeness: 'verified_complete' | 'bounded_or_partial' | 'failed' | 'never_run';
  counts: { active: number; open: number; expiredByDeadline: number; closed: number; hidden: number; duplicates: number; emailApplicable: number; total: number;
    /** Open postings that were present in the source's latest verified-complete listing: their being listed is known as of that run. */
    openVerifiedInCompleteListing: number;
    /** Open postings with no such proof (no complete listing exists, or the posting was last seen in a bounded run). Not "closed", not "known open". */
    openFreshnessUnknown: number };
}

@Injectable()
export class JobSourceService {
  private readonly logger = new Logger(JobSourceService.name);

  /** The one lease every collector of a source takes (scheduler, run-now, import CLI). Built here so every holder of this service shares it without extra wiring. */
  readonly lease: SourceLeaseService;
  constructor(private prisma: PrismaService, private jobs: JobsService) { this.lease = new SourceLeaseService(prisma); }

  /**
   * Postings may only be imported for a registered, enabled, unrestricted source: a quarantined or unknown source
   * cannot write jobs through the supported import path, whatever its collector reports.
   */
  async assertIngestable(externalId: string) {
    const key = externalId.split(':')[0];
    const source = await this.prisma.jobSource.findUnique({ where: { key }, select: { enabled: true, accessReview: true } });
    if (!source || !source.enabled || source.accessReview === 'RESTRICTED') throw new ForbiddenException('Source is not registered for import');
    if (key === 'linkedin' && source.accessReview !== 'TERMS_REVIEWED_ALLOWED') {
      throw new ForbiddenException('LinkedIn source is blocked until access terms are explicitly reviewed and approved');
    }
  }

  /**
   * Imports of a reviewed public collector's source write only while holding that source's lease (the same lease the scheduler, run-now and the import CLI
   * take), so a path that did not take it cannot write. Other sources (Glorri, synthetic ones) are not lease-managed here.
   */
  async assertLeaseHeld(sourceKey: string, token: string | undefined, now = new Date()) {
    if (!COLLECTOR_KEYS.includes(sourceKey)) return;
    const row = await this.prisma.jobSource.findUnique({ where: { key: sourceKey }, select: { leaseOwner: true, leaseUntil: true } });
    if (!token || !row || row.leaseOwner !== token || !row.leaseUntil || row.leaseUntil <= now) {
      throw new ConflictException({ code: 'SOURCE_LEASE_REQUIRED', message: `Importing ${sourceKey} requires that source's lease: acquire it first (another run may hold it)` });
    }
  }

  /**
   * Records one public-collector run and, only for a verified-complete one,
   * advances the missed-listing count of that source's active postings.
   */
  async recordRun(report: ImportRunReportDto, now = new Date()) {
    if (report.source === 'glorri') throw new BadRequestException('Glorri maintains its own lifecycle');
    const source = await this.prisma.jobSource.findUnique({ where: { key: report.source } });
    if (!source || !source.enabled) throw new NotFoundException('Unknown or disabled source');
    const startedAt = new Date(report.startedAt);
    if (!(startedAt.getTime() <= now.getTime() + 60_000) || now.getTime() - startedAt.getTime() > MAX_RUN_AGE_MS) {
      throw new BadRequestException('Run start time is out of range');
    }
    // A listing whose details failed to parse is incomplete: an unparsed posting is unknown, never absent.
    // A resumed or deep segment did not walk the whole listing from its start: it may never claim completeness, so it can never close anything.
    const runOutcome = collectionOutcome(report);
    const listingComplete = !report.segment && report.complete && ['COMPLETE_CENSUS', 'NO_OPENINGS'].includes(runOutcome) && !report.error && report.failed === 0;
    const runKey = `${report.source}@${startedAt.toISOString()}`;

    // One report at a time per source, and the closure counts and the run record commit together: a repeated report
    // returns the recorded result, and a failure while saving leaves no half-counted misses behind.
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`source-run:${report.source}`}))`;
      const existing = await tx.jobImportRun.findUnique({ where: { runKey } });
      if (existing && existing.status !== 'RUNNING') return { runId: existing.id, status: existing.status, closed: existing.closed, closureSkipped: existing.closureSkipped, replay: true };

      let closed = 0;
      let closureSkipped: string | null = null;
      let suspicious = false;
      if (listingComplete) {
        const previous = await tx.jobImportRun.findFirst({
          where: { source: report.source, status: 'SUCCEEDED', listingComplete: true },
          orderBy: { startedAt: 'desc' },
        });
        if (previous && previous.startedAt.getTime() >= startedAt.getTime()) { closureSkipped = 'out_of_order'; suspicious = true; }
        else if (previous && report.discovered < previous.discovered * MIN_LISTED_SHARE_FOR_CLOSURE) { closureSkipped = 'listing_shrank'; suspicious = true; }
        else closed = await this.reconcileClosures(tx, report.source, startedAt, now);
      } else {
        closureSkipped = report.segment ? 'resumed_segment' : 'listing_incomplete';
      }
      // A complete-looking listing that shrank sharply or arrived out of order is flagged, and never becomes the baseline.
      // A bounded or incomplete run that stored or confirmed postings is PARTIAL (it proves nothing about absence, but it did work); one that produced no evidence at all failed.
      const status = listingComplete && !suspicious ? 'SUCCEEDED' : report.accepted > 0 || report.unchanged > 0 || report.reopened > 0 || suspicious ? 'PARTIAL' : 'FAILED';
      let runId: string;
      if (existing) {
        await tx.jobImportRun.update({
          where: { id: existing.id },
          data: {
            status, finishedAt: now, listingComplete, pagesFetched: report.pages,
            outcome: runOutcome,
            listed: report.discovered, discovered: report.discovered, created: report.created, updated: report.updated,
            unchanged: report.unchanged, reopened: report.reopened, closed, detailFailures: report.failed,
            rejected: report.failed, skipped: report.skipped, expired: report.expired, closureSkipped,
            error: report.error?.slice(0, 300) ?? null,
          },
        });
        runId = existing.id;
      } else {
        const run = await tx.jobImportRun.create({
          data: {
            runKey, source: report.source, status, startedAt, finishedAt: now, listingComplete, pagesFetched: report.pages,
            outcome: runOutcome,
            listed: report.discovered, discovered: report.discovered, created: report.created, updated: report.updated,
            unchanged: report.unchanged, reopened: report.reopened, closed, detailFailures: report.failed,
            rejected: report.failed, skipped: report.skipped, expired: report.expired, closureSkipped,
            error: report.error?.slice(0, 300) ?? null,
          },
        });
        runId = run.id;
      }
      return { runId, status, closed, closureSkipped, replay: false };
    });
    if (outcome.closed && !outcome.replay) await this.jobs.releaseOrphanedDuplicates(now).catch((e) => this.logger.warn(`Duplicate release failed: ${e instanceof Error ? e.message : e}`));
    return { runId: outcome.runId, status: outcome.status, closed: outcome.closed, closureSkipped: outcome.closureSkipped };
  }

  /**
   * Records the start of an import run in RUNNING status so it is immediately visible
   * to operators and monitoring, and can be recovered if the worker process crashes.
   */
  async startRun(sourceKey: string, startedAt = new Date()): Promise<string> {
    const runKey = `${sourceKey}@${startedAt.toISOString()}`;
    const run = await this.prisma.jobImportRun.upsert({
      where: { runKey },
      create: {
        runKey,
        source: sourceKey,
        status: 'RUNNING',
        startedAt,
        listingComplete: false,
      },
      update: {},
    });
    return run.id;
  }

  /**
   * Closes a run that was started (RUNNING) but never recorded: the collector threw, or the worker died. It is FAILED, never a listing, so no closure can
   * follow from it. A run that was already recorded is left alone.
   */
  async failRun(sourceKey: string, startedAt: Date, error: string, now = new Date()): Promise<boolean> {
    const { count } = await this.prisma.jobImportRun.updateMany({
      where: { runKey: `${sourceKey}@${startedAt.toISOString()}`, status: 'RUNNING' },
      data: { status: 'FAILED', finishedAt: now, error: error.slice(0, 300) },
    });
    return count > 0;
  }

  /** Counts a miss for every active posting this complete run did not refresh, and closes repeat misses. */
  private async reconcileClosures(db: Pick<PrismaService, 'job'>, source: string, startedAt: Date, now: Date): Promise<number> {
    // Only postings this run never refreshed: one a concurrent collector refreshed after this run began is present, not absent.
    const notRefreshed = { externalId: { startsWith: `${source}:` }, status: 'ACTIVE' as const, lastSeenAt: { lt: startedAt } };
    await db.job.updateMany({ where: notRefreshed, data: { missedImports: { increment: 1 } } });
    const closed = await db.job.updateMany({
      where: { ...notRefreshed, missedImports: { gte: CLOSE_AFTER_COMPLETE_MISSES } },
      data: { status: 'CLOSED', closedAt: now, closedReason: 'source_removed_from_complete_listing' },
    });
    return closed.count;
  }

  health(now = new Date()): Promise<SourceHealth[]> { return sourceHealth(this.prisma, now); }
}

/** Registry rows with health computed from runs and postings (never from guesses). */
export async function sourceHealth(prismaClient: Pick<PrismaService, 'jobSource' | 'jobImportRun' | '$queryRaw' | 'sourceDiscoveryProgress'>, now = new Date()): Promise<SourceHealth[]> {
  const [sources, runs, counts, verified, progressRows] = await Promise.all([
    prismaClient.jobSource.findMany({ orderBy: { key: 'asc' } }),
    prismaClient.jobImportRun.findMany({ orderBy: { startedAt: 'desc' }, take: 2000 }),
    prismaClient.$queryRaw<{ source: string; total: number; active: number; open: number; expired: number; closed: number; hidden: number; duplicates: number; email: number }[]>(Prisma.sql`
      SELECT split_part("externalId", ':', 1) AS source, COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status='ACTIVE')::int AS active,
        COUNT(*) FILTER (WHERE status='ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline>=${now}))::int AS open,
        COUNT(*) FILTER (WHERE status='ACTIVE' AND deadline<${now})::int AS expired,
        COUNT(*) FILTER (WHERE status='CLOSED')::int AS closed,
        COUNT(*) FILTER (WHERE "hiddenAt" IS NOT NULL)::int AS hidden,
        COUNT(*) FILTER (WHERE "duplicateOfId" IS NOT NULL)::int AS duplicates,
        COUNT(*) FILTER (WHERE status='ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline>=${now}) AND "applicationMethod"='EMAIL')::int AS email
      FROM "Job" GROUP BY 1`),
    // Open postings seen at or after the start of their source's latest successful complete run.
    prismaClient.$queryRaw<{ source: string; verified: number }[]>(Prisma.sql`
      SELECT split_part(j."externalId", ':', 1) AS source, COUNT(*)::int AS verified
      FROM "Job" j
      JOIN LATERAL (SELECT max(r."startedAt") AS at FROM "JobImportRun" r WHERE r.source = split_part(j."externalId", ':', 1) AND r.status = 'SUCCEEDED' AND r."listingComplete") c ON true
      WHERE c.at IS NOT NULL AND j."lastSeenAt" >= c.at AND j.status = 'ACTIVE' AND j."hiddenAt" IS NULL AND j."duplicateOfId" IS NULL AND (j.deadline IS NULL OR j.deadline >= ${now})
      GROUP BY 1`),
    prismaClient.sourceDiscoveryProgress.findMany(),
  ]);
  return sources.map((s) => {
    const own = runs.filter((r) => r.source === s.key);
    const last = own[0] ?? null;
    const c = counts.find((row) => row.source === s.key);
    const op = computeOperationalStatus({
      enabled: s.enabled,
      schedulePausedAt: s.schedulePausedAt,
      consecutiveFailures: s.consecutiveFailures,
      lastError: last?.error ?? null,
      lastRunStatus: last?.status ?? null,
      scheduled: s.scheduled,
      runningNow: !!s.leaseUntil && s.leaseUntil > now,
      cooldownUntil: s.cooldownUntil,
      cooldownReason: s.cooldownReason,
      accessReview: s.accessReview,
      intervalMinutes: s.intervalMinutes,
      lastRunAt: last?.startedAt ?? null,
    }, now);
    return {
      key: s.key, name: s.name, employer: s.employer, homepageUrl: s.homepageUrl, collectionMethod: s.collectionMethod, scope: s.scope,
      accessReview: s.accessReview, accessNote: s.accessNote, reviewedAt: s.reviewedAt, applicationMethods: s.applicationMethods,
      enabled: s.enabled, scheduled: s.scheduled,
      // Honest label: "scheduled" only if the scheduler may run it; otherwise its data is that of its last manual run.
      schedule: {
        mode: s.key === 'glorri' ? 'scheduled' : !s.scheduled ? 'manual' : s.schedulePausedAt ? 'paused' : 'scheduled',
        intervalMinutes: s.intervalMinutes,
        nextRunAt: s.nextRunAt,
        consecutiveFailures: s.consecutiveFailures,
        staleness: s.key === 'glorri' ? 'own_importer' : ((): string => {
          const last = own.find((r) => r.status === 'SUCCEEDED' && r.listingComplete)?.finishedAt ?? null;
          return !s.scheduled ? 'not_scheduled' : !last ? 'never_completed' : now.getTime() - last.getTime() > 2 * s.intervalMinutes * 60_000 ? 'stale' : 'fresh';
        })(),
        isPaused: Boolean(s.schedulePausedAt),
        leaseUntil: s.leaseUntil,
        cooldownUntil: s.cooldownUntil && s.cooldownUntil > now ? s.cooldownUntil : null,
        cooldownReason: s.cooldownUntil && s.cooldownUntil > now ? s.cooldownReason : null,
        cooldownCount: s.cooldownCount,
      },
      operationalStatus: op.status,
      recommendedAction: op.action,
      discovery: ((p) => (p ? { traversalInProgress: !!p.cursor, segments: p.segments, listedInGeneration: p.listedInGeneration, lastHeadAt: p.lastHeadAt, lastSegmentAt: p.lastSegmentAt, lastDeepCompletedAt: p.lastDeepCompletedAt, restartReason: p.restartReason, headReachedEnd: p.headReachedEnd } : null))(progressRows.find((p) => p.sourceKey === s.key)),
      lastRunAt: last?.startedAt ?? null, lastRunStatus: last?.status ?? null,
      lastSuccessAt: own.find((r) => r.status === 'SUCCEEDED')?.finishedAt ?? null,
      lastCompleteListingAt: own.find((r) => r.status === 'SUCCEEDED' && r.listingComplete)?.finishedAt ?? null,
      lastError: last?.error ?? null,
      lastRun: last && { discovered: last.discovered || last.listed, pages: last.pagesFetched, accepted: last.created + last.updated + last.unchanged + last.reopened, rejected: last.rejected, skipped: last.skipped, expired: last.expired, failed: last.detailFailures, closed: last.closed, listingComplete: last.listingComplete, closureSkipped: last.closureSkipped, outcome: last.outcome ?? null },
      completeness: !last ? 'never_run' : last.status === 'FAILED' ? 'failed' : last.status === 'SUCCEEDED' && last.listingComplete && !last.detailFailures ? 'verified_complete' : 'bounded_or_partial',
      counts: {
        total: c?.total ?? 0, active: c?.active ?? 0, open: c?.open ?? 0, expiredByDeadline: c?.expired ?? 0, closed: c?.closed ?? 0, hidden: c?.hidden ?? 0, duplicates: c?.duplicates ?? 0, emailApplicable: c?.email ?? 0,
        openVerifiedInCompleteListing: Math.min(verified.find((row) => row.source === s.key)?.verified ?? 0, c?.open ?? 0),
        openFreshnessUnknown: (c?.open ?? 0) - Math.min(verified.find((row) => row.source === s.key)?.verified ?? 0, c?.open ?? 0),
      },
    };
  });
}

export interface CoverageSummary {
  generatedAt: Date;
  /** Employers on the curated target list. Registered is NOT integrated. */
  registeredEmployerTargets: number;
  employerTargetsWithAdapter: number;
  /** Registry sources with at least one open posting right now. */
  sourcesWithOpenPostings: number;
  openPostings: number;
  openPostingsWithEmailApplication: number;
  /** Open postings proven listed by a verified-complete run, and those with no such proof. They sum to openPostings. */
  openVerifiedInCompleteListing: number;
  openFreshnessUnknown: number;
  /** Postings linked as cross-source repeats of another posting (kept, but excluded from every open count above). */
  duplicateLinked: number;
  sources: SourceHealth[];
  caveats: string[];
}

export async function coverageSummary(
  prismaClient: Pick<PrismaService, 'jobSource' | 'jobImportRun' | '$queryRaw' | 'sourceDiscoveryProgress'>,
  targets: readonly { adapter: string | null }[],
  now = new Date(),
): Promise<CoverageSummary> {
  const sources = await sourceHealth(prismaClient, now);
  return {
    generatedAt: now,
    registeredEmployerTargets: targets.length,
    employerTargetsWithAdapter: targets.filter((t) => t.adapter).length,
    sourcesWithOpenPostings: sources.filter((s) => s.counts.open > 0).length,
    openPostings: sources.reduce((n, s) => n + s.counts.open, 0),
    openPostingsWithEmailApplication: sources.reduce((n, s) => n + s.counts.emailApplicable, 0),
    openVerifiedInCompleteListing: sources.reduce((n, s) => n + s.counts.openVerifiedInCompleteListing, 0),
    openFreshnessUnknown: sources.reduce((n, s) => n + s.counts.openFreshnessUnknown, 0),
    duplicateLinked: sources.reduce((n, s) => n + s.counts.duplicates, 0),
    sources,
    caveats: [
      'Counts cover only registered sources; this is not a complete inventory of Azerbaijani vacancies.',
      'Open postings are not unique jobs: cross-source duplicates are linked and excluded where detected.',
      'Open means "not known to be closed". Only openVerifiedInCompleteListing is backed by a verified-complete listing; openFreshnessUnknown is not evidence of being open.',
      'Only sources listed as scheduled are refreshed automatically; others hold the data of their last manual run.',
    ],
  };
}
