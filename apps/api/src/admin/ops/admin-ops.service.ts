import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, SubscriptionPlan } from '@prisma/client';
import { readFile } from 'fs/promises';
import { PrismaService } from '../../database/database.service';
import { parsePriceTable } from '../../resumes/tailor/ai-usage';
import { summarizeAiUsage } from './ai-usage-report';
import { EmailService } from '../../common/email.service';
import { FeatureFlagKey, FEATURE_FLAGS, FeatureFlagsService } from '../../operations/feature-flags.service';

// Queues whose failed jobs are provably safe to run again: matching is
// idempotent (unique match rows, conditional quota writes). Tailoring,
// e-mail and external-application queues are never retried from here.
const SAFE_RETRY_QUEUES = ['job-ingested', 'profile-onboarded'] as const;
/** Document generation health for the operator: counts by outcome and the failure CODES (never the candidate's text or the model's output). */
export function summarizeDocuments(rows: { status: string; statusError: string | null }[]) {
  const failedByCode: Record<string, number> = {};
  for (const r of rows) {
    if (r.status !== 'FAILED') continue;
    const code = /\(([A-Z_]+)\)\s*$/.exec(r.statusError ?? '')?.[1] ?? 'UNKNOWN';
    failedByCode[code] = (failedByCode[code] ?? 0) + 1;
  }
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  return { total: rows.length, pending: count('PENDING'), needsReview: count('NEEDS_REVIEW'), ready: count('READY'), failed: count('FAILED'), failedByCode };
}

const OBSERVED_QUEUES = ['job-ingested', 'profile-onboarded', 'resume-tailor', 'match-created', 'glorri-scrape', 'external-apply'] as const;
type QueueName = (typeof OBSERVED_QUEUES)[number];

const PLANS: SubscriptionPlan[] = ['FREE', 'BASIC', 'STANDARD', 'Limitsiz'];
const MAX_OVERRIDE_DAYS = 365;

/** Strips anything that looks like an e-mail, URL or long token from an error before showing it. */
export function redactError(text: string | null | undefined): string | null {
  if (!text) return null;
  return text
    .replace(/[^\s@]+@[^\s@]+/g, '[e-poçt]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[gizli]')
    .slice(0, 300);
}

@Injectable()
export class AdminOpsService {
  private readonly logger = new Logger(AdminOpsService.name);
  private readonly queueByName: Record<QueueName, Queue>;

  constructor(
    private prisma: PrismaService,
    private flags: FeatureFlagsService,
    private email: EmailService,
    @InjectQueue('job-ingested') jobIngested: Queue,
    @InjectQueue('profile-onboarded') profileOnboarded: Queue,
    @InjectQueue('resume-tailor') resumeTailor: Queue,
    @InjectQueue('match-created') matchCreated: Queue,
    @InjectQueue('glorri-scrape') glorriScrape: Queue,
    @InjectQueue('external-apply') externalApply: Queue,
  ) {
    this.queueByName = {
      'job-ingested': jobIngested,
      'profile-onboarded': profileOnboarded,
      'resume-tailor': resumeTailor,
      'match-created': matchCreated,
      'glorri-scrape': glorriScrape,
      'external-apply': externalApply,
    };
  }

  private audit(actorId: string, action: string, targetType: string, targetId: string, metadata?: Record<string, unknown>) {
    return this.prisma.adminAuditLog.create({ data: { adminUserId: actorId, action, targetType, targetId, metadata: metadata as any } });
  }

  // --------------------------------------------------------------- overview --

  async aiUsage(days: number) {
    const since = new Date(Date.now() - Math.min(Math.max(1, days), 365) * 86_400_000);
    const [events, runs] = await Promise.all([
      this.prisma.aiUsageEvent.findMany({ where: { createdAt: { gte: since } }, select: { resumeId: true, provider: true, model: true, stage: true, outcome: true, latencyMs: true, inputTokens: true, outputTokens: true }, take: 50_000 }),
      this.prisma.documentRun.findMany({ where: { createdAt: { gte: since } }, select: { resumeId: true, docKind: true, result: true, queueMs: true, generationMs: true, renderMs: true }, take: 20_000 }),
    ]);
    const approved = await this.prisma.resume.findMany({ where: { id: { in: runs.map((r) => r.resumeId) }, status: 'READY' }, select: { id: true } });
    const rate = Number(process.env.USD_TO_AZN);
    return { since, ...summarizeAiUsage(events, runs, new Set(approved.map((r) => r.id)), parsePriceTable(process.env.AI_PRICE_USD_PER_MTOK), Number.isFinite(rate) && rate > 0 ? rate : null) };
  }

  async overview() {
    const now = new Date();
    const day = new Date(now.getTime() - 86_400_000);
    const week = new Date(now.getTime() - 7 * 86_400_000);
    const [users, verifiedUsers, suspendedUsers, companies, vacancies, jobs, hiddenJobs, nativeApps, externalApps, matches24h, tailoredFailed, lastImport, queueCounts] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { emailVerified: { not: null } } }),
      this.prisma.user.count({ where: { suspendedAt: { not: null } } }),
      this.prisma.company.groupBy({ by: ['status'], _count: true }),
      this.prisma.vacancy.groupBy({ by: ['status'], _count: true }),
      this.prisma.job.groupBy({ by: ['status'], _count: true }),
      this.prisma.job.count({ where: { hiddenAt: { not: null } } }),
      this.prisma.application.groupBy({ by: ['status'], _count: true }),
      this.prisma.externalApplication.groupBy({ by: ['status'], _count: true }),
      this.prisma.match.count({ where: { createdAt: { gt: day } } }),
      this.prisma.resume.count({ where: { status: 'FAILED', createdAt: { gt: week } } }),
      this.prisma.jobImportRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.queueCounts(),
    ]);
    const byStatus = (rows: { status: string; _count: number }[]) => Object.fromEntries(rows.map((r) => [r.status, r._count]));
    const email = this.email.getDeliveryRecords();
    return {
      users: { total: users, verified: verifiedUsers, suspended: suspendedUsers },
      companies: byStatus(companies as any),
      vacancies: byStatus(vacancies as any),
      jobs: { ...byStatus(jobs as any), hidden: hiddenJobs },
      applications: { native: byStatus(nativeApps as any), external: byStatus(externalApps as any) },
      matchesLast24h: matches24h,
      documentsLast7d: summarizeDocuments(await this.prisma.resume.findMany({ where: { isBase: false, createdAt: { gt: week } }, select: { status: true, statusError: true }, take: 5000 })),
      failures: {
        tailoredCvLast7d: tailoredFailed,
        externalUnconfirmed: (externalApps as any).find((r: any) => r.status === 'DELIVERY_UNCONFIRMED')?._count ?? 0,
        queues: queueCounts.filter((q) => q.failed > 0),
        // A queue that could not be read reports failed: 0 internally; it must not read as "no failures".
        queuesUnavailable: queueCounts.filter((q) => (q as { unavailable?: boolean }).unavailable).map((q) => q.name),
        // Delivery outcomes are kept in this API process's memory only.
        emailFailuresSinceRestart: email.filter((r) => r.outcome === 'failed').length,
      },
      lastImport: lastImport && { ...lastImport, error: redactError(lastImport.error) },
      features: await this.flags.list(),
    };
  }

  async health() {
    const check = async (fn: () => Promise<unknown>) => {
      const started = Date.now();
      try {
        await fn();
        return { ok: true, ms: Date.now() - started };
      } catch (error) {
        return { ok: false, ms: Date.now() - started, error: redactError((error as Error)?.message) };
      }
    };
    const fetchOk = async (url: string, headers: Record<string, string> = {}) => {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
      await res.body?.cancel().catch(() => undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    };
    const [database, redis, matching, applyWorker] = await Promise.all([
      check(() => this.prisma.$queryRaw`SELECT 1`),
      check(async () => { const client = (await this.queueByName['job-ingested'].client) as unknown as { ping(): Promise<string> }; await client.ping(); }),
      check(() => fetchOk(`${process.env.MATCHING_SERVICE_URL || 'http://localhost:8000'}/health`)),
      check(() => fetchOk(`${process.env.APPLY_WORKER_URL || 'http://localhost:8100'}/sessions`, process.env.APPLY_WORKER_TOKEN ? { Authorization: `Bearer ${process.env.APPLY_WORKER_TOKEN}` } : {})),
    ]);
    return {
      environment: process.env.APP_ENV || process.env.NODE_ENV || 'development',
      release: { sha: process.env.RELEASE_SHA || null, builtAt: process.env.RELEASE_BUILT_AT || null },
      uptimeSeconds: Math.round(process.uptime()),
      services: { database, redis, matching, applyWorker },
      backup: await this.backupStatus(),
    };
  }

  /**
   * Written by scripts/backup.sh and scripts/restore-test.sh on the host and
   * mounted read-only (BACKUP_STATUS_FILE). Missing means "unknown", never "ok".
   */
  private async backupStatus() {
    const path = process.env.BACKUP_STATUS_FILE;
    if (!path) return { known: false, reason: 'BACKUP_STATUS_FILE qurulmayıb' };
    try {
      const data = JSON.parse(await readFile(path, 'utf8'));
      const ageHours = (at?: string) => (at ? Math.round((Date.now() - new Date(at).getTime()) / 3_600_000) : null);
      return {
        known: true,
        lastBackupAt: data.lastBackupAt ?? null,
        lastBackupAgeHours: ageHours(data.lastBackupAt),
        lastRestoreTestAt: data.lastRestoreTestAt ?? null,
        lastRestoreTestAgeHours: ageHours(data.lastRestoreTestAt),
        lastRestoreTestResult: data.lastRestoreTestResult ?? null,
        lastRestoreTestNote: data.lastRestoreTestNote ?? null,
        // Verified copy in durable off-host storage (scripts/offhost-sync.sh).
        lastOffhostCopyAt: data.lastOffhostCopyAt ?? null,
        lastOffhostCopyAgeHours: ageHours(data.lastOffhostCopyAt),
        lastOffhostResult: data.lastOffhostResult ?? null,
        // Set by the daily job when a stage failed; cleared by the next success.
        lastBackupFailureAt: data.lastBackupFailureAt ?? null,
        lastBackupError: data.lastBackupError ?? null,
      };
    } catch {
      return { known: false, reason: 'Status faylı oxunmadı' };
    }
  }

  // ---------------------------------------------------------------- imports --

  async imports() {
    const runs = await this.prisma.jobImportRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 });
    return { runs: runs.map((r) => ({ ...r, error: redactError(r.error) })), paused: await this.flags.isPaused('import.glorri') };
  }

  /** One queued operator-requested import at a time; refused while one is running or paused. */
  async requestImport(actorId: string) {
    if (await this.flags.isPaused('import.glorri')) throw new ConflictException('Glorri idxalı dayandırılıb. Əvvəlcə davam etdirin.');
    const running = await this.prisma.jobImportRun.findFirst({ where: { source: 'glorri', status: 'RUNNING', startedAt: { gt: new Date(Date.now() - 30 * 60_000) } } });
    if (running) throw new ConflictException('İdxal artıq işləyir');
    const existing = await this.queueByName['glorri-scrape'].getJob('operator-import');
    if (existing && ['waiting', 'active', 'delayed'].includes(await existing.getState())) {
      return { queued: false, message: 'İdxal artıq növbədədir' };
    }
    await existing?.remove().catch(() => undefined);
    await this.queueByName['glorri-scrape'].add('glorri-scrape-job', {}, { jobId: 'operator-import', removeOnComplete: true, removeOnFail: true });
    await this.audit(actorId, 'IMPORT_REQUESTED', 'JobImport', 'glorri');
    return { queued: true };
  }

  // ----------------------------------------------------------------- queues --

  async queueCounts() {
    return Promise.all(OBSERVED_QUEUES.map(async (name) => {
      try {
        const c = await this.queueByName[name].getJobCounts('waiting', 'active', 'delayed', 'failed');
        return { name, ...c, retryable: (SAFE_RETRY_QUEUES as readonly string[]).includes(name) } as { name: string; waiting: number; active: number; delayed: number; failed: number; retryable: boolean };
      } catch {
        return { name, waiting: 0, active: 0, delayed: 0, failed: 0, retryable: false, unavailable: true } as any;
      }
    }));
  }

  async failedJobs() {
    const counts = await this.queueCounts();
    const failed = await Promise.all(OBSERVED_QUEUES.map(async (name) => {
      const jobs = await this.queueByName[name].getFailed(0, 19).catch(() => []);
      return jobs.map((j) => ({
        queue: name,
        id: j.id,
        name: j.name,
        attemptsMade: j.attemptsMade,
        failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
        reason: redactError(j.failedReason),
        retryable: (SAFE_RETRY_QUEUES as readonly string[]).includes(name),
      }));
    }));
    return { counts, failed: failed.flat() };
  }

  async retry(actorId: string, queue: string, jobId: string) {
    if (!(SAFE_RETRY_QUEUES as readonly string[]).includes(queue)) {
      throw new BadRequestException('Bu növbənin tapşırıqları buradan təkrarlanmır (təhlükəsiz təkrarlanması sübut olunmayıb)');
    }
    const job = await this.queueByName[queue as QueueName].getJob(jobId);
    if (!job || (await job.getState()) !== 'failed') throw new NotFoundException('Uğursuz tapşırıq tapılmadı');
    await job.retry();
    await this.audit(actorId, 'QUEUE_JOB_RETRIED', 'QueueJob', `${queue}:${jobId}`, { queue });
    return { retried: true };
  }

  // --------------------------------------------------------------- features --

  async setFeature(actorId: string, key: string, paused: boolean, reason?: string) {
    if (!(key in FEATURE_FLAGS)) throw new NotFoundException('Naməlum funksiya');
    if (paused && !reason?.trim()) throw new BadRequestException('Dayandırma səbəbi tələb olunur');
    return this.flags.set(key as FeatureFlagKey, paused, reason?.trim().slice(0, 300), actorId);
  }

  // --------------------------------------------------------------- listings --

  async listings(query: { q?: string; status?: string; hidden?: string; page?: number }) {
    const page = Math.max(1, Number(query.page) || 1);
    const where: Prisma.JobWhereInput = {
      ...(query.q ? { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { company: { contains: query.q, mode: 'insensitive' } }] } : {}),
      ...(query.status === 'ACTIVE' || query.status === 'CLOSED' ? { status: query.status } : {}),
      ...(query.hidden === 'true' ? { hiddenAt: { not: null } } : query.hidden === 'false' ? { hiddenAt: null } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip: (page - 1) * 25,
        take: 25,
        select: { id: true, externalId: true, title: true, company: true, url: true, status: true, deadline: true, lastSeenAt: true, closedAt: true, closedReason: true, hiddenAt: true, hiddenReason: true, duplicateOfId: true, duplicateReason: true, _count: { select: { matches: true } } },
      }),
      this.prisma.job.count({ where }),
    ]);
    return { data: items.map((j) => ({ ...j, source: j.externalId.split(':')[0] })), meta: { total, page, totalPages: Math.ceil(total / 25) } };
  }

  async setListingHidden(actorId: string, jobId: string, hidden: boolean, reason?: string) {
    if (hidden && !reason?.trim()) throw new BadRequestException('Gizlətmə səbəbi tələb olunur');
    const updated = await this.prisma.job.updateMany({
      where: { id: jobId, hiddenAt: hidden ? null : { not: null } },
      data: hidden ? { hiddenAt: new Date(), hiddenReason: reason!.trim().slice(0, 300) } : { hiddenAt: null, hiddenReason: null },
    });
    if (!updated.count) throw new ConflictException(hidden ? 'Elan artıq gizlidir və ya tapılmadı' : 'Elan gizli deyil və ya tapılmadı');
    await this.audit(actorId, hidden ? 'LISTING_HIDDEN' : 'LISTING_RESTORED', 'Job', jobId, { reason });
    return { success: true };
  }

  // ----------------------------------------------------------- applications --

  /** Status overview; no answers, files or identity documents. */
  async applications(kind: 'native' | 'external', status?: string, page = 1) {
    page = Math.max(1, Number(page) || 1);
    if (kind === 'external') {
      const where = status ? { status: status as any } : {};
      const [items, total] = await Promise.all([
        this.prisma.externalApplication.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip: (page - 1) * 25,
          take: 25,
          select: { id: true, status: true, stateReason: true, destinationHost: true, dryRun: true, receiptReference: true, createdAt: true, updatedAt: true, user: { select: { email: true } }, match: { select: { job: { select: { title: true, company: true } } } } },
        }),
        this.prisma.externalApplication.count({ where }),
      ]);
      return {
        data: items.map((a) => ({
          ...a,
          // Never retried: an uncertain delivery is reconciled with the destination by a person.
          needsReconciliation: a.status === 'DELIVERY_UNCONFIRMED',
        })),
        meta: { total, page, totalPages: Math.ceil(total / 25) },
      };
    }
    const where = status ? { status: status as any } : {};
    const [items, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 25,
        take: 25,
        select: { id: true, status: true, createdAt: true, updatedAt: true, user: { select: { email: true } }, vacancy: { select: { title: true, company: { select: { name: true } } } } },
      }),
      this.prisma.application.count({ where }),
    ]);
    return { data: items, meta: { total, page, totalPages: Math.ceil(total / 25) } };
  }

  // ------------------------------------------------------ accounts & plans --

  async setUserSuspended(actorId: string, userId: string, suspended: boolean, reason?: string) {
    if (suspended && !reason?.trim()) throw new BadRequestException('Dayandırma səbəbi tələb olunur');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, suspendedAt: true } });
    if (!user) throw new NotFoundException('İstifadəçi tapılmadı');
    if (!!user.suspendedAt === suspended) throw new ConflictException(suspended ? 'Hesab artıq dayandırılıb' : 'Hesab dayandırılmayıb');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: suspended ? { suspendedAt: new Date(), suspendedReason: reason!.trim().slice(0, 300) } : { suspendedAt: null, suspendedReason: null } }),
      ...(suspended ? [this.prisma.session.deleteMany({ where: { userId } })] : []),
    ]);
    await this.audit(actorId, suspended ? 'USER_SUSPENDED' : 'USER_RESTORED', 'User', userId, { reason });
    return { success: true };
  }

  async setCompanySuspended(actorId: string, companyId: string, suspended: boolean, reason?: string) {
    if (suspended && !reason?.trim()) throw new BadRequestException('Dayandırma səbəbi tələb olunur');
    const updated = await this.prisma.company.updateMany({
      where: { id: companyId, status: suspended ? 'APPROVED' : 'SUSPENDED' },
      data: suspended ? { status: 'SUSPENDED', suspendedReason: reason!.trim().slice(0, 300) } : { status: 'APPROVED', suspendedReason: null },
    });
    if (!updated.count) throw new ConflictException(suspended ? 'Yalnız təsdiqlənmiş şirkət dayandırıla bilər' : 'Şirkət dayandırılmayıb');
    await this.audit(actorId, suspended ? 'COMPANY_SUSPENDED' : 'COMPANY_RESTORED', 'Company', companyId, { reason });
    return { success: true };
  }

  async planOverrides(userId: string) {
    const [subscription, overrides] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { userId }, select: { plan: true, status: true, currentPeriodEnd: true, dodoSubscriptionId: true } }),
      this.prisma.planOverride.findMany({ where: { userId, academySeatGrantId: null }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const now = new Date();
    return {
      // The payment provider's contract; operators cannot edit it here.
      subscription: subscription && { plan: subscription.plan, status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd, providerManaged: !!subscription.dodoSubscriptionId },
      overrides: overrides.map((o) => ({ ...o, active: !o.revokedAt && o.expiresAt > now })),
    };
  }

  async grantPlanOverride(actorId: string, userId: string, plan: SubscriptionPlan, reason: string, days: number) {
    if (!PLANS.includes(plan)) throw new BadRequestException('Plan düzgün deyil');
    if (!reason?.trim()) throw new BadRequestException('Səbəb tələb olunur');
    if (!Number.isInteger(days) || days < 1 || days > MAX_OVERRIDE_DAYS) throw new BadRequestException(`Müddət 1–${MAX_OVERRIDE_DAYS} gün olmalıdır`);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('İstifadəçi tapılmadı');
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    const override = await this.prisma.$transaction(async (tx) => {
      // One active override at a time: a new grant replaces the previous one.
      await tx.planOverride.updateMany({ where: { userId, academySeatGrantId: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date(), revokedById: actorId } });
      return tx.planOverride.create({ data: { userId, plan, reason: reason.trim().slice(0, 300), expiresAt, createdById: actorId } });
    });
    await this.audit(actorId, 'PLAN_OVERRIDE_GRANTED', 'User', userId, { plan, days, expiresAt: expiresAt.toISOString(), reason: override.reason });
    return override;
  }

  async revokePlanOverride(actorId: string, userId: string, overrideId: string) {
    const revoked = await this.prisma.planOverride.updateMany({ where: { id: overrideId, userId, academySeatGrantId: null, revokedAt: null }, data: { revokedAt: new Date(), revokedById: actorId } });
    if (!revoked.count) throw new NotFoundException('Aktiv plan istisnası tapılmadı');
    await this.audit(actorId, 'PLAN_OVERRIDE_REVOKED', 'User', userId, { overrideId });
    return { success: true };
  }

  // ------------------------------------------------------------------ audit --

  async auditLog(query: { action?: string; targetType?: string; actor?: string; page?: number }) {
    const page = Math.max(1, Number(query.page) || 1);
    const where: Prisma.AdminAuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.actor ? { adminUser: { email: { contains: query.actor, mode: 'insensitive' } } } : {}),
    };
    const [items, total, actions] = await Promise.all([
      this.prisma.adminAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 50, take: 50, include: { adminUser: { select: { email: true } } } }),
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    ]);
    return {
      data: items.map((e) => ({ id: e.id, action: e.action, targetType: e.targetType, targetId: e.targetId, metadata: e.metadata, createdAt: e.createdAt, actor: e.adminUser?.email ?? (e.adminUserId ? 'silinmiş operator' : 'sistem / CLI') })),
      meta: { total, page, totalPages: Math.ceil(total / 50) },
      actions: actions.map((a) => a.action),
    };
  }
}
