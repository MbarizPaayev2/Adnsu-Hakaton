import { premiumEmailAccess } from './email-premium';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import type { EmailApplySettings, Job } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { FeatureFlagsService } from '../operations/feature-flags.service';
import { actionableJobWhere } from '../jobs/jobs.service';
import { foldText } from '../jobs/job-location.util';
import { EMAIL_APPLY_CONFIG } from './email-apply.tokens';
import type { EmailApplyConfig } from './email-apply.config';
import { EmailApplicationsService } from './email-applications.service';
import { EXTRA_REQUIREMENTS, cleanBody, singleLine } from './email-application-draft';

export const AUTOMATION_CONSENT_VERSION = '2026-10-email-automation-v2-premium-alias';
const MAX_TERMS = 20;
const MAX_TERM_LENGTH = 60;
const MAX_TEMPLATE_CHARS = 2000;
const PLACEHOLDERS = new Set(['title', 'company', 'reference', 'name']);

const COUNTRY_ONLY = new Set(['azerbaijan', 'azerbaycan', 'azerbaijan republic', '']);

export type SkipReason =
  | 'ROLE_NOT_ALLOWED' | 'LOCATION_UNKNOWN' | 'LOCATION_NOT_ALLOWED' | 'EMPLOYER_NOT_ALLOWED' | 'EXCLUDED_EMPLOYER'
  | 'EXCLUDED_KEYWORD' | 'EXTRA_REQUIREMENTS' | 'NO_CV' | 'NOT_ELIGIBLE' | 'PREPARE_FAILED' | 'ALREADY_EXISTS';

/** How many prepared applications may wait for the candidate at once: the queue stops adding when they are not being reviewed. */
export const REVIEW_QUEUE_MAX_PENDING = 10;

export interface AutomationInput {
  enabled?: boolean;
  consent?: boolean;
  allowedRoles?: string[];
  allowedLocations?: string[];
  allowedEmployers?: string[];
  excludedEmployers?: string[];
  excludedKeywords?: string[];
  dailyLimit?: number;
  cvResumeId?: string;
  letterTemplate?: string;
  /** Review queue: prepare matching applications in the background for the candidate to approve one by one. */
  reviewQueue?: boolean;
}

const terms = (value: unknown, field: string): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_TERMS || value.some((v) => typeof v !== 'string' || !singleLine(v) || singleLine(v).length > MAX_TERM_LENGTH)) {
    throw new BadRequestException(`${field} siyahısı yanlışdır. (RULES_INVALID)`);
  }
  return [...new Set(value.map((v: string) => singleLine(v)))];
};

/** Pure: whether a posting may be applied to automatically under the candidate's rules. Unknown facts stop it. */
export function evaluateJob(job: Pick<Job, 'title' | 'company' | 'location' | 'description'>, rules: Pick<EmailApplySettings, 'allowedRoles' | 'allowedLocations' | 'allowedEmployers' | 'excludedEmployers' | 'excludedKeywords'>): { ok: true } | { ok: false; reason: SkipReason } {
  const title = foldText(job.title);
  const company = foldText(job.company);
  const location = foldText(job.location);
  const has = (haystack: string, list: string[]) => list.some((t) => haystack.includes(foldText(t)));
  if (rules.excludedEmployers.length && has(company, rules.excludedEmployers)) return { ok: false, reason: 'EXCLUDED_EMPLOYER' };
  if (rules.excludedKeywords.length && has(`${title} ${foldText(job.description)}`, rules.excludedKeywords)) return { ok: false, reason: 'EXCLUDED_KEYWORD' };
  if (!has(title, rules.allowedRoles)) return { ok: false, reason: 'ROLE_NOT_ALLOWED' };
  if (rules.allowedEmployers.length && !has(company, rules.allowedEmployers)) return { ok: false, reason: 'EMPLOYER_NOT_ALLOWED' };
  if (rules.allowedLocations.length) {
    if (COUNTRY_ONLY.has(location)) return { ok: false, reason: 'LOCATION_UNKNOWN' };
    if (!has(location, rules.allowedLocations)) return { ok: false, reason: 'LOCATION_NOT_ALLOWED' };
  }
  if (EXTRA_REQUIREMENTS.test(job.description)) return { ok: false, reason: 'EXTRA_REQUIREMENTS' };
  return { ok: true };
}

/** Fills only the placeholders the candidate may use; nothing about the candidate is invented. */
export function renderTemplate(template: string, values: { title: string; company: string; reference?: string | null; name: string }): string {
  return cleanBody(template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => (key === 'reference' ? (values.reference ?? '') : String((values as Record<string, unknown>)[key] ?? '')))).replace(/\(\s*\)/g, '').replace(/[ \t]+\n/g, '\n');
}

/**
 * Mode B: opt-in automatic e-mail applications. Off unless the deployment enables it AND the candidate
 * opts in with rules. It uses exactly the same preparation, validation, snapshot and sender gates as a
 * reviewed application, and it stops (never guesses) whenever a fact the rules depend on is unknown.
 */
@Injectable()
export class EmailAutomationService {
  private readonly logger = new Logger(EmailAutomationService.name);

  constructor(
    private prisma: PrismaService,
    private flags: FeatureFlagsService,
    private applications: EmailApplicationsService,
    @Inject(EMAIL_APPLY_CONFIG) private cfg: EmailApplyConfig,
  ) {}

  async get(userId: string) {
    const { included } = await premiumEmailAccess(this.prisma, userId);
    const s = await this.prisma.emailApplySettings.findUnique({ where: { userId } });
    const decisions = await this.prisma.emailAutomationDecision.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 });
    return {
      available: this.cfg.enabled && this.cfg.automationEnabled && included,
      premiumRequired: !included,
      enabled: !!s?.automationEnabled && included && s.consentVersion === AUTOMATION_CONSENT_VERSION,
      consentedAt: s?.automationConsentedAt ?? null,
      rules: {
        allowedRoles: s?.allowedRoles ?? [], allowedLocations: s?.allowedLocations ?? [], allowedEmployers: s?.allowedEmployers ?? [],
        excludedEmployers: s?.excludedEmployers ?? [], excludedKeywords: s?.excludedKeywords ?? [], dailyLimit: s?.dailyLimit ?? 3,
        cvResumeId: s?.cvResumeId ?? null, letterTemplate: s?.letterTemplate ?? '',
      },
      reviewQueue: {
        available: this.cfg.enabled && included,
        enabled: !!s?.reviewQueueEnabled && included,
        since: s?.reviewQueueSince ?? null,
        pending: await this.prisma.emailApplication.count({ where: { userId, preparedByAgentAt: { not: null }, deliveryState: 'AWAITING_APPROVAL' } }),
        maxPending: REVIEW_QUEUE_MAX_PENDING,
      },
      decisions: decisions.map((d) => ({ jobId: d.jobId, outcome: d.outcome, reason: d.reason, at: d.createdAt })),
    };
  }

  async save(userId: string, input: AutomationInput) {
    // The review queue sends nothing by itself, so it needs only e-mail applications; automatic sending also needs the deployment's automation switch.
    const wantsAutomatic = input.enabled === true;
    if (!this.cfg.enabled || (wantsAutomatic && !this.cfg.automationEnabled)) throw new ForbiddenException('Avtomatik müraciət bu mühitdə aktiv deyil. (AUTOMATION_DISABLED)');
    if (!this.cfg.automationEnabled && input.reviewQueue === undefined) throw new ForbiddenException('Avtomatik müraciət bu mühitdə aktiv deyil. (AUTOMATION_DISABLED)');
    if (!(await premiumEmailAccess(this.prisma, userId)).included) throw new ForbiddenException('Avtomatik e-poçt müraciətləri Premium planına daxildir. (PLAN_REQUIRED)');
    const existing = await this.prisma.emailApplySettings.findUnique({ where: { userId } });
    const allowedRoles = terms(input.allowedRoles, 'Vəzifə');
    const allowedLocations = terms(input.allowedLocations, 'Şəhər');
    const dailyLimit = input.dailyLimit ?? existing?.dailyLimit ?? 3;
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 10 || dailyLimit > this.cfg.userDailyLimit) throw new BadRequestException('Gündəlik limit 1–10 arasında olmalıdır. (LIMIT_INVALID)');
    const template = cleanBody(input.letterTemplate ?? existing?.letterTemplate ?? '');
    // Automatic sending needs the candidate's own letter; the review queue can use the ordinary draft, which the candidate reads before approving.
    const automaticOn = input.enabled ?? existing?.automationEnabled ?? false;
    if ((automaticOn && !template) || template.length > MAX_TEMPLATE_CHARS) throw new BadRequestException('Avtomatik məktub 1–2000 simvol olmalıdır. (TEMPLATE_INVALID)');
    for (const m of template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) if (!PLACEHOLDERS.has(m[1])) throw new BadRequestException('Məktubda yalnız {{title}}, {{company}}, {{reference}}, {{name}} istifadə oluna bilər. (TEMPLATE_INVALID)');
    const cvResumeId = input.cvResumeId ?? existing?.cvResumeId ?? undefined;
    if (!cvResumeId) throw new BadRequestException('Avtomatik müraciət üçün CV seçin. (NO_CV)');
    // Only the candidate's own finished base CV: a tailored CV is approved per vacancy, which automation cannot do.
    const cv = await this.prisma.resume.findFirst({ where: { id: cvResumeId, userId, isBase: true, status: 'READY', fileUrl: { not: null } }, select: { id: true } });
    if (!cv) throw new BadRequestException('Avtomatik müraciət yalnız əsas CV ilə göndərilə bilər. (CV_NOT_USABLE)');
    if (!allowedRoles.length) throw new BadRequestException('Ən azı bir vəzifə qaydası təyin edin. (ROLE_REQUIRED)');
    if (!allowedLocations.length) throw new BadRequestException('Ən azı bir şəhər qaydası təyin edin. (LOCATION_REQUIRED)');

    const enabling = input.enabled === true && (!existing?.automationEnabled || existing.consentVersion !== AUTOMATION_CONSENT_VERSION);
    if (enabling) {
      if (input.consent !== true) throw new BadRequestException('Avtomatik göndərməyə açıq razılıq verilməyib. (CONSENT_REQUIRED)');
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerified: true, name: true } });
      if (!user.emailVerified || !singleLine(user.name ?? '')) throw new ForbiddenException('E-poçtunuzu təsdiqləyin və adınızı profilə əlavə edin. (PROFILE_INCOMPLETE)');
    }
    const enabled = input.enabled ?? existing?.automationEnabled ?? false;
    const reviewOn = input.reviewQueue ?? existing?.reviewQueueEnabled ?? false;
    // Turning the queue on starts from now: postings seen before are not swept up at once.
    const reviewSince = reviewOn ? (existing?.reviewQueueEnabled && existing.reviewQueueSince ? existing.reviewQueueSince : new Date()) : null;
    const data = {
      allowedRoles, allowedLocations, allowedEmployers: terms(input.allowedEmployers, 'İşəgötürən'), excludedEmployers: terms(input.excludedEmployers, 'İstisna'),
      excludedKeywords: terms(input.excludedKeywords, 'İstisna söz'), dailyLimit, cvResumeId, letterTemplate: template, automationEnabled: enabled,
      reviewQueueEnabled: reviewOn, reviewQueueSince: reviewSince,
      ...(enabling ? { automationConsentedAt: new Date(), consentVersion: AUTOMATION_CONSENT_VERSION, consentRevokedAt: null } : {}),
    };
    await this.prisma.emailApplySettings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return this.get(userId);
  }

  async disable(userId: string) {
    await this.prisma.emailApplySettings.updateMany({ where: { userId }, data: { automationEnabled: false } });
    return this.get(userId);
  }

  /** Stops the review queue at once. Prepared drafts stay for the candidate to approve or discard; nothing was or will be sent from them by AISE. */
  async stopReviewQueue(userId: string) {
    await this.prisma.emailApplySettings.updateMany({ where: { userId }, data: { reviewQueueEnabled: false, reviewQueueSince: null } });
    return this.get(userId);
  }

  /** One pass for every opted-in candidate. Safe to repeat: each posting is judged once per candidate. */
  async runAll(now = new Date()) {
    if (!this.cfg.enabled) return { users: 0, applied: 0, skipped: 0, prepared: 0 };
    let applied = 0;
    let skipped = 0;
    let prepared = 0;
    let count = 0;
    if (this.cfg.automationEnabled && !(await this.flags.isPaused('email_apply.automation'))) {
      const users = await this.prisma.emailApplySettings.findMany({ where: { automationEnabled: true, consentRevokedAt: null, sendingPausedAt: null, automationConsentedAt: { not: null } }, take: 200 });
      count += users.length;
      for (const settings of users) {
        try {
          const result = await this.runForUser(settings, now);
          applied += result.applied;
          skipped += result.skipped;
        } catch (error) {
          this.logger.warn(`Automation pass failed for one candidate: ${error instanceof Error ? error.name : 'error'}`);
        }
      }
    }
    // The review queue runs after automatic sending, so a posting automatic mode stopped on (for example one asking for more than a CV) can still be
    // prepared for the candidate to look at.
    if (!(await this.flags.isPaused('agent.review_queue'))) {
      const reviewers = await this.prisma.emailApplySettings.findMany({ where: { reviewQueueEnabled: true, reviewQueueSince: { not: null }, consentRevokedAt: null }, take: 500 });
      count += reviewers.length;
      for (const settings of reviewers) {
        try {
          const result = await this.prepareForReview(settings, now);
          prepared += result.prepared;
          skipped += result.skipped;
        } catch (error) {
          this.logger.warn(`Review queue pass failed for one candidate: ${error instanceof Error ? error.name : 'error'}`);
        }
      }
    }
    if (count === 0) return { users: 0, applied: 0, skipped: 0, prepared: 0 };
    return { users: count, applied, skipped, prepared };
  }

  async runForUser(settings: EmailApplySettings, now = new Date()) {
    const userId = settings.userId;
    if (!this.cfg.enabled || !this.cfg.automationEnabled || !settings.automationEnabled || settings.consentRevokedAt || settings.sendingPausedAt || settings.consentVersion !== AUTOMATION_CONSENT_VERSION || !settings.automationConsentedAt || !(await premiumEmailAccess(this.prisma, userId, now)).included || await this.flags.isPaused('email_apply.automation')) return { applied: 0, skipped: 0 };
    const since = new Date(now.getTime() - 24 * 3600_000);
    let remaining = settings.dailyLimit - (await this.prisma.emailApplication.count({ where: { userId, mode: 'AUTOMATIC', approvedAt: { gte: since } } }));
    const result = { applied: 0, skipped: 0 };
    if (remaining <= 0) return result;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

    const minLastSeen = new Date(now.getTime() - this.cfg.listingMaxAgeDays * 24 * 3600_000);
    // Only postings that appeared after the candidate opted in, are fresh, and that candidate hasn't dismissed or applied to yet.
    const candidates = await this.prisma.job.findMany({
      where: {
        ...actionableJobWhere(now), applicationMethod: 'EMAIL', applicationEmail: { not: null }, ingestedAt: { gte: settings.automationConsentedAt! },
        lastSeenAt: { gte: minLastSeen },
        NOT: [
          { emailApplications: { some: { userId } } },
          { agentApplications: { some: { userId } } },
          { matches: { some: { userId, status: 'DISMISSED' } } },
        ],
      },
      orderBy: { ingestedAt: 'desc' }, take: 100,
    });
    const judged = new Set((await this.prisma.emailAutomationDecision.findMany({ where: { userId, jobId: { in: candidates.map((c) => c.id) } }, select: { jobId: true } })).map((d) => d.jobId));
    for (const job of candidates) {
      if (remaining <= 0) break;
      if (judged.has(job.id)) continue;
      const verdict = evaluateJob(job, settings);
      if (!verdict.ok) {
        // Left for the review queue to prepare: the candidate may well be able to add what the posting asks for.
        if (verdict.reason === 'EXTRA_REQUIREMENTS' && settings.reviewQueueEnabled) continue;
        await this.record(userId, job.id, 'SKIPPED', verdict.reason); result.skipped++; continue;
      }
      try {
        const evidence = job.applicationEmailEvidence as { reference?: string } | null;
        const body = renderTemplate(settings.letterTemplate ?? '', { title: job.title, company: job.company, reference: evidence?.reference, name: user?.name ?? '' });
        const prepared = await this.applications.prepare(userId, job.id, { resumeId: settings.cvResumeId ?? undefined }, { automatic: { body } });
        await this.applications.approveAutomatic(userId, prepared.id);
        await this.record(userId, job.id, 'APPLIED', 'RULES_MATCHED');
        result.applied++;
        remaining--;
      } catch (error) {
        const reason: SkipReason = error instanceof ConflictException ? 'NOT_ELIGIBLE' : error instanceof BadRequestException ? 'NO_CV' : 'PREPARE_FAILED';
        await this.record(userId, job.id, 'SKIPPED', reason);
        result.skipped++;
      }
    }
    return result;
  }

  /**
   * Review queue, one candidate: finds new e-mail postings that meet the candidate's rules and prepares an application for each, up to the daily
   * limit and while fewer than REVIEW_QUEUE_MAX_PENDING wait. Nothing is approved or sent here; the candidate approves the exact payload later.
   * Expired, duplicate and already-applied postings are excluded by the same checks a manual application uses. Safe to repeat: each posting is
   * judged once per candidate, and the unique (candidate, vacancy) application row makes concurrent passes prepare it once.
   */
  async prepareForReview(settings: EmailApplySettings, now = new Date()) {
    // One pass per candidate at a time (two workers, or a restart overlapping a slow pass): the second one does nothing rather than double the limit.
    return this.prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`review-queue:${settings.userId}`})) AS locked`;
      if (!locked) return { prepared: 0, skipped: 0 };
      // Re-read under the lock: the candidate may have stopped the queue a moment ago.
      const current = await this.prisma.emailApplySettings.findUnique({ where: { userId: settings.userId } });
      return current ? this.prepareForReviewLocked(current, now) : { prepared: 0, skipped: 0 };
    }, { timeout: 120_000, maxWait: 10_000 });
  }

  private async prepareForReviewLocked(settings: EmailApplySettings, now: Date) {
    const userId = settings.userId;
    const result = { prepared: 0, skipped: 0 };
    if (!this.cfg.enabled || !settings.reviewQueueEnabled || !settings.reviewQueueSince || settings.consentRevokedAt) return result;
    if (!(await premiumEmailAccess(this.prisma, userId, now)).included || await this.flags.isPaused('agent.review_queue')) return result;
    const pending = await this.prisma.emailApplication.count({ where: { userId, preparedByAgentAt: { not: null }, deliveryState: 'AWAITING_APPROVAL' } });
    const since = new Date(now.getTime() - 24 * 3600_000);
    const today = await this.prisma.emailAutomationDecision.count({ where: { userId, outcome: 'PREPARED', createdAt: { gte: since } } });
    let room = Math.min(REVIEW_QUEUE_MAX_PENDING - pending, settings.dailyLimit - today);
    if (room <= 0) return result;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const minLastSeen = new Date(now.getTime() - this.cfg.listingMaxAgeDays * 24 * 3600_000);
    const candidates = await this.prisma.job.findMany({
      where: {
        ...actionableJobWhere(now), applicationMethod: 'EMAIL', applicationEmail: { not: null }, ingestedAt: { gte: settings.reviewQueueSince },
        lastSeenAt: { gte: minLastSeen },
        NOT: [
          { emailApplications: { some: { userId } } },
          { agentApplications: { some: { userId } } },
          { matches: { some: { userId, status: 'DISMISSED' } } },
        ],
      },
      orderBy: { ingestedAt: 'desc' }, take: 100,
    });
    const judged = new Set((await this.prisma.emailAutomationDecision.findMany({ where: { userId, jobId: { in: candidates.map((c) => c.id) } }, select: { jobId: true } })).map((d) => d.jobId));
    const ids: string[] = [];
    for (const job of candidates) {
      if (room <= 0) break;
      if (judged.has(job.id)) continue;
      const verdict = evaluateJob(job, settings);
      // A posting that asks for more than a CV is still prepared: the candidate sees what it asks for before approving.
      if (!verdict.ok && verdict.reason !== 'EXTRA_REQUIREMENTS') { await this.record(userId, job.id, 'SKIPPED', verdict.reason); result.skipped++; continue; }
      try {
        const evidence = job.applicationEmailEvidence as { reference?: string } | null;
        const body = settings.letterTemplate ? renderTemplate(settings.letterTemplate, { title: job.title, company: job.company, reference: evidence?.reference, name: user?.name ?? '' }) : undefined;
        // Reuses existing approved tailored documents matching this vacancy when available, falling back to candidate's base CV.
        // It does not autonomously generate unreviewed tailored documents in the background.
        const tailoredCv = await this.prisma.resume.findFirst({
          where: { userId, isBase: false, docKind: { not: 'LETTER' }, status: 'READY', reviewedAt: { not: null }, fileUrl: { not: null }, match: { jobId: job.id } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        const tailoredLetter = await this.prisma.resume.findFirst({
          where: { userId, isBase: false, docKind: 'LETTER', status: 'READY', reviewedAt: { not: null }, fileUrl: { not: null }, match: { jobId: job.id } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        const resumeId = tailoredCv?.id ?? settings.cvResumeId ?? undefined;
        const letterId = tailoredLetter?.id;
        const prepared = await this.applications.prepare(userId, job.id, { resumeId, letterId }, { agent: { body } });
        await this.record(userId, job.id, 'PREPARED', verdict.ok ? 'RULES_MATCHED' : 'EXTRA_REQUIREMENTS');
        ids.push(prepared.id);
        result.prepared++;
        room--;
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const reason: SkipReason = /ALREADY_EXISTS|ALREADY_APPLIED|ALREADY_PREPARING/.test(message) ? 'ALREADY_EXISTS' : error instanceof ConflictException ? 'NOT_ELIGIBLE' : error instanceof BadRequestException ? 'NO_CV' : 'PREPARE_FAILED';
        await this.record(userId, job.id, 'SKIPPED', reason);
        result.skipped++;
      }
    }
    if (ids.length) {
      // One notice per pass that found something new; repeated passes with nothing new say nothing.
      await this.prisma.notification.create({
        data: {
          userId, type: 'AGENT_REVIEW',
          message: ids.length === 1 ? 'AISE bir müraciət hazırladı. Göndərilmədən əvvəl yoxlayıb təsdiqləyin.' : `AISE ${ids.length} müraciət hazırladı. Göndərilmədən əvvəl hər birini yoxlayıb təsdiqləyin.`,
          payload: { applicationIds: ids, link: '/dashboard/applications?review=1' },
        },
      });
    }
    return result;
  }

  private async record(userId: string, jobId: string, outcome: 'APPLIED' | 'SKIPPED' | 'PREPARED', reason: string) {
    await this.prisma.emailAutomationDecision.upsert({ where: { userId_jobId: { userId, jobId } }, create: { userId, jobId, outcome, reason }, update: {} });
  }
}
