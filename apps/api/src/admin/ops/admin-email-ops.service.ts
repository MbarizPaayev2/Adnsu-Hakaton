import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { EmailDeliveryState, RecruitmentState } from '@prisma/client';
import { PrismaService } from '../../database/database.service';
import { FeatureFlagsService } from '../../operations/feature-flags.service';
import { EMAIL_APPLY_CONFIG } from '../../email-applications/email-apply.tokens';
import type { EmailApplyConfig } from '../../email-applications/email-apply.config';
import { EMPLOYER_TARGETS } from '../../scrapers/public-jobs/employer-registry';
import { coverageSummary } from '../../jobs/job-source.service';
import { SourceScheduler, MIN_INTERVAL_MINUTES, defaultCollectorFactory } from '../../jobs/source-scheduler.service';

const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();
const maskEmail = (email: string) => `${email.slice(0, 1)}***@${domainOf(email)}`;
const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/**
 * Operator views over source coverage and e-mail application delivery. They show aggregates and
 * metadata only: no letter, subject, CV or full recipient address. Looking at one application is audited.
 */
@Injectable()
export class AdminEmailOpsService {
  constructor(
    private prisma: PrismaService,
    private flags: FeatureFlagsService,
    @Inject(EMAIL_APPLY_CONFIG) private cfg: EmailApplyConfig,
    private scheduler: SourceScheduler,
  ) {}

  /** Measured per-source coverage. "Registered" is never reported as "integrated". */
  sources() {
    return coverageSummary(this.prisma, EMPLOYER_TARGETS);
  }

  /** Immediate out-of-schedule run of a source by an operator. */
  async runNow(actorId: string, key: string) {
    const res = await this.scheduler.runSourceNow(key);
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId: actorId,
        action: 'SOURCE_RUN_TRIGGERED',
        targetType: 'JobSource',
        targetId: key,
        metadata: { status: res.status },
      },
    });
    return res;
  }

  /**
   * The operator's recovery path for a source in cooldown (or with a failure streak): clears the cooldown and the failure count so the schedule tries it
   * again at once, and optionally starts that run now. Deliberate and audited; it does not touch what the source returned, so a block that is still
   * there will simply put the source back in cooldown (with a longer one) after the next run.
   */
  async recoverSource(actorId: string, key: string, run = false) {
    const source = await this.prisma.jobSource.findUnique({ where: { key } });
    if (!source) throw new NotFoundException('Mənbə tapılmadı');
    if (key === 'glorri') throw new BadRequestException('Glorri öz idxal cədvəlini saxlayır');
    await this.prisma.$transaction([
      this.prisma.jobSource.update({ where: { key }, data: { cooldownUntil: null, cooldownReason: null, cooldownCount: 0, consecutiveFailures: 0, nextRunAt: null } }),
      this.prisma.adminAuditLog.create({ data: { adminUserId: actorId, action: 'SOURCE_COOLDOWN_RESET', targetType: 'JobSource', targetId: key, metadata: { hadCooldownUntil: source.cooldownUntil?.toISOString() ?? null, reason: source.cooldownReason, consecutiveFailures: source.consecutiveFailures, run } } }),
    ]);
    const started = run ? await this.scheduler.runSourceNow(key) : null;
    return { key, reset: true, run: started };
  }

  /** Global kill switch / pause for scheduled vacancy ingestion. */
  async setGlobalSchedulerPause(actorId: string, paused: boolean, reason?: string) {
    await this.flags.set('import.scheduled', paused, reason, actorId);
    return { paused };
  }

  /** Per-source schedule control. A source without a reviewed collector (and Glorri) can never be scheduled here. */
  async updateSchedule(actorId: string, key: string, dto: { scheduled?: boolean; paused?: boolean; intervalMinutes?: number }) {
    const source = await this.prisma.jobSource.findUnique({ where: { key } });
    if (!source) throw new NotFoundException('Mənbə tapılmadı');
    if (key === 'glorri') throw new BadRequestException('Glorri öz idxal cədvəlini saxlayır');
    if (dto.scheduled && !defaultCollectorFactory(key)) throw new BadRequestException('Bu mənbə üçün yoxlanmış kollektor yoxdur');
    if (dto.scheduled && !source.enabled) throw new BadRequestException('Söndürülmüş mənbə cədvələ salına bilməz');
    if (dto.scheduled && source.accessReview === 'RESTRICTED') throw new BadRequestException('Məhdudiyyətli mənbə cədvələ salına bilməz');
    if (dto.intervalMinutes !== undefined && (!Number.isInteger(dto.intervalMinutes) || dto.intervalMinutes < MIN_INTERVAL_MINUTES || dto.intervalMinutes > 7 * 24 * 60)) {
      throw new BadRequestException(`İnterval ${MIN_INTERVAL_MINUTES} dəqiqədən az ola bilməz`);
    }
    const data = {
      ...(dto.scheduled !== undefined ? { scheduled: dto.scheduled, ...(dto.scheduled ? {} : { nextRunAt: null, leaseUntil: null }) } : {}),
      ...(dto.paused !== undefined ? { schedulePausedAt: dto.paused ? new Date() : null } : {}),
      ...(dto.intervalMinutes !== undefined ? { intervalMinutes: dto.intervalMinutes } : {}),
    };
    await this.prisma.$transaction([
      this.prisma.jobSource.update({ where: { key }, data }),
      this.prisma.adminAuditLog.create({ data: { adminUserId: actorId, action: 'SOURCE_SCHEDULE_CHANGED', targetType: 'JobSource', targetId: key, metadata: dto as object } }),
    ]);
    return { key, ...dto };
  }

  async emailHealth(now = new Date()) {
    const day = new Date(now.getTime() - 24 * 3600_000);
    const week = new Date(now.getTime() - 7 * 24 * 3600_000);
    const [byState, byStateDay, held, oldestQueued, staleSending, accepted7d, delivered7d, bounced7d, complained7d, suppressions, attemptsDay, failureCodes, allFlags, uncertain] = await Promise.all([
      this.prisma.emailApplication.groupBy({ by: ['deliveryState'], _count: true }),
      this.prisma.emailApplication.groupBy({ by: ['deliveryState'], where: { updatedAt: { gte: day } }, _count: true }),
      this.prisma.emailApplication.groupBy({ by: ['holdReason'], where: { deliveryState: 'QUEUED', holdReason: { not: null } }, _count: true }),
      this.prisma.emailApplication.findFirst({ where: { deliveryState: 'QUEUED' }, orderBy: { queuedAt: 'asc' }, select: { queuedAt: true } }),
      this.prisma.emailApplication.count({ where: { deliveryState: 'SENDING', lockedAt: { lt: new Date(now.getTime() - 10 * 60_000) } } }),
      this.prisma.emailApplication.count({ where: { providerAcceptedAt: { gte: week } } }),
      this.prisma.emailApplication.count({ where: { providerAcceptedAt: { gte: week }, deliveredAt: { not: null } } }),
      this.prisma.emailApplication.count({ where: { providerAcceptedAt: { gte: week }, bouncedAt: { not: null } } }),
      this.prisma.emailApplication.count({ where: { providerAcceptedAt: { gte: week }, complainedAt: { not: null } } }),
      this.prisma.emailSuppression.count(),
      this.prisma.emailSendAttempt.count({ where: { startedAt: { gte: day }, outcome: { in: ['PENDING', 'ACCEPTED', 'AMBIGUOUS'] } } }),
      this.prisma.emailSendAttempt.groupBy({ by: ['errorCode'], where: { startedAt: { gte: day }, errorCode: { not: null } }, _count: true }),
      this.flags.list(),
      this.uncertain(),
    ]);
    const states = (rows: { deliveryState: EmailDeliveryState; _count: number }[]) => Object.fromEntries(rows.map((r) => [r.deliveryState, r._count]));
    return {
      config: {
        enabled: this.cfg.enabled, transport: this.cfg.transport, realRecipientsAuthorized: this.cfg.realRecipients, recipientAllowlistSize: this.cfg.recipientAllowlist.length,
        automationAvailable: this.cfg.enabled && this.cfg.automationEnabled, inboundEnabled: this.cfg.inboundEnabled,
        limits: { perUserPerDay: this.cfg.userDailyLimit, globalPerDay: this.cfg.globalDailyLimit, perRecipientPerDay: this.cfg.recipientDailyLimit, maxAttempts: this.cfg.maxAttempts },
      },
      flags: allFlags.filter((f) => f.key.startsWith('email_apply.')),
      queue: {
        queued: states(byState).QUEUED ?? 0, sending: states(byState).SENDING ?? 0, staleSending,
        oldestQueuedAgeMinutes: oldestQueued?.queuedAt ? Math.round((now.getTime() - oldestQueued.queuedAt.getTime()) / 60_000) : null,
        held: Object.fromEntries(held.map((h) => [h.holdReason ?? 'unknown', h._count])),
      },
      states: { total: states(byState), changedLast24h: states(byStateDay) },
      delivery7d: {
        providerAccepted: accepted7d, delivered: delivered7d, bounced: bounced7d, complained: complained7d,
        deliveredPercent: rate(delivered7d, accepted7d), bouncedPercent: rate(bounced7d, accepted7d), complainedPercent: rate(complained7d, accepted7d),
        note: 'Provider acceptance is not delivery, and delivery is not review by the employer.',
      },
      sendingToday: { attempts: attemptsDay, globalLimit: this.cfg.globalDailyLimit },
      attemptFailures24h: Object.fromEntries(failureCodes.map((f) => [f.errorCode ?? 'unknown', f._count])),
      suppressedAddresses: suppressions,
      uncertain,
    };
  }

  /** Outcomes nobody could confirm: they are never re-sent automatically and wait for the candidate. */
  async uncertain(now = new Date()) {
    const rows = await this.prisma.emailApplication.findMany({
      where: { deliveryState: 'UNCERTAIN' }, orderBy: { uncertainAt: 'asc' }, take: 50,
      select: { id: true, uncertainAt: true, failureCode: true, attemptCount: true, jobTitle: true, jobCompany: true, recipient: true, user: { select: { email: true } } },
    });
    return rows.map((r) => ({
      id: r.id, since: r.uncertainAt, ageMinutes: r.uncertainAt ? Math.round((now.getTime() - r.uncertainAt.getTime()) / 60_000) : null, reason: r.failureCode, attempts: r.attemptCount,
      jobTitle: r.jobTitle, jobCompany: r.jobCompany, recipientDomain: domainOf(r.recipient), candidate: maskEmail(r.user.email),
    }));
  }

  /**
   * How far applications get, counted from events inside the window and with no personal data.
   * "Viewed" is measured only by the consent-aware browser analytics, never here.
   */
  async funnel(days = 30, now = new Date()) {
    const since = new Date(now.getTime() - Math.min(Math.max(Math.floor(days) || 30, 1), 365) * 24 * 3600_000);
    const stages: Record<string, RecruitmentState[]> = {
      replied: ['ACKNOWLEDGED', 'INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED', 'OFFER', 'REJECTED', 'HIRED'],
      interview: ['INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED'], offer: ['OFFER'], hired: ['HIRED'],
    };
    const [prepared, preparedAutomatic, approved, providerAccepted, delivered, events, inbound] = await Promise.all([
      this.prisma.emailApplication.count({ where: { createdAt: { gte: since } } }),
      this.prisma.emailApplication.count({ where: { createdAt: { gte: since }, mode: 'AUTOMATIC' } }),
      this.prisma.emailApplication.count({ where: { approvedAt: { gte: since } } }),
      this.prisma.emailApplication.count({ where: { providerAcceptedAt: { gte: since } } }),
      this.prisma.emailApplication.count({ where: { deliveredAt: { gte: since } } }),
      this.prisma.applicationStatusEvent.findMany({ where: { createdAt: { gte: since }, toState: { in: Object.values(stages).flat() } }, select: { emailApplicationId: true, toState: true } }),
      this.prisma.emailInboundMessage.findMany({ where: { receivedAt: { gte: since }, emailApplicationId: { not: null } }, select: { emailApplicationId: true }, distinct: ['emailApplicationId'] }),
    ]);
    const distinct = (states: RecruitmentState[], extra: string[] = []) => new Set([...events.filter((e) => states.includes(e.toState)).map((e) => e.emailApplicationId), ...extra]).size;
    return {
      windowDays: Math.round((now.getTime() - since.getTime()) / 86_400_000),
      stages: [
        { stage: 'viewed', count: null, note: 'Measured only by consent-aware browser analytics' },
        { stage: 'prepared', count: prepared, ofWhichAutomatic: preparedAutomatic },
        { stage: 'approved', count: approved },
        { stage: 'provider_accepted', count: providerAccepted },
        { stage: 'delivered', count: delivered },
        { stage: 'replied', count: distinct(stages.replied, inbound.map((i) => i.emailApplicationId!)) },
        { stage: 'interview', count: distinct(stages.interview) },
        { stage: 'offer', count: distinct(stages.offer) },
        { stage: 'hired', count: distinct(stages.hired) },
      ],
    };
  }

  /** Metadata for one application. Letters, subjects and CVs are not available to operators; the lookup is audited. */
  async detail(actorId: string, id: string) {
    const row = await this.prisma.emailApplication.findUnique({
      where: { id },
      include: { attempts: { orderBy: { startedAt: 'asc' } }, deliveryEvents: { orderBy: { occurredAt: 'asc' } }, statusEvents: { orderBy: { createdAt: 'asc' } }, user: { select: { email: true } } },
    });
    if (!row) throw new NotFoundException('Müraciət tapılmadı');
    await this.prisma.adminAuditLog.create({ data: { adminUserId: actorId, action: 'EMAIL_APPLICATION_VIEWED', targetType: 'EmailApplication', targetId: id, metadata: { deliveryState: row.deliveryState } } });
    return {
      id: row.id, mode: row.mode, deliveryState: row.deliveryState, recruitmentState: row.recruitmentState, holdReason: row.holdReason, failureCode: row.failureCode,
      candidate: maskEmail(row.user.email), recipientDomain: domainOf(row.recipient), jobTitle: row.jobTitle, jobCompany: row.jobCompany,
      approvedAt: row.approvedAt, providerAcceptedAt: row.providerAcceptedAt, deliveredAt: row.deliveredAt, bouncedAt: row.bouncedAt, complainedAt: row.complainedAt, uncertainAt: row.uncertainAt,
      attempts: row.attempts.map((a) => ({ number: a.number, generation: a.generation, outcome: a.outcome, httpStatus: a.httpStatus, errorCode: a.errorCode, startedAt: a.startedAt, finishedAt: a.finishedAt })),
      events: row.deliveryEvents.map((e) => ({ type: e.type, occurredAt: e.occurredAt, applied: e.applied, detail: e.detail })),
      statusHistory: row.statusEvents.map((s) => ({ from: s.fromState, to: s.toState, evidence: s.evidence, at: s.createdAt })),
      contentAvailableToOperators: false,
    };
  }
}
