import { isRecommendationRelevant } from '../matching/recommendation-policy';
import { PLAN_DAILY_MATCH_QUOTAS, matchWeekStart, PLAN_PRICES_AZN } from '@aise/shared-types';
import { createHash } from 'node:crypto';
import { activePlanOverrides, effectivePlan } from '../billing/entitlement';
import { Injectable, NotFoundException, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { PreferencesService, quietUntil } from '../alerts/preferences.service';
import { PrismaService } from '../database/database.service';
import { EmailService } from '../common/email.service';
import { PostHogService } from '../common/posthog.service';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { escapeHtml, sanitizeHeaderValue } from '../common/text.util';
import { isJobActionable } from '../jobs/jobs.service';

// Paid offers receive one daily batch; Free retains its 48-hour gate.
// Both entry points share send history and never repeat a posting.
const BAKU_OFFSET_MS = 4 * 3_600_000; // UTC+4, no DST
const MATCH_EMAIL_LOOKBACK_MS = 14 * 24 * 3_600_000; // older unsent matches are never emailed
export const MATCH_EMAIL_INTERVAL_MS = 7 * 24 * 3_600_000;
export function matchEmailBatchSize(plan: string): number { return PLAN_DAILY_MATCH_QUOTAS[plan as keyof typeof PLAN_DAILY_MATCH_QUOTAS] ?? (plan === 'FREE' ? 3 : 5); }

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export function matchEmailMinScore(): number {
  return envNumber('MATCH_EMAIL_MIN_SCORE', 0.5, 0, 1);
}

export function matchEmailMaxPerDay(): number {
  return envNumber('MATCH_EMAIL_MAX_PER_DAY', 3, 1, 24);
}

/** Send slots as Baku hours, e.g. "9,14,19" (the default). */
export function matchEmailSlotsBaku(): number[] {
  const hours = (process.env.MATCH_EMAIL_SLOTS_BAKU || '9,14,19')
    .split(',')
    .map((h) => Number(h.trim()))
    .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
  return hours.length ? [...new Set(hours)].sort((a, b) => a - b) : [9, 14, 19];
}

/** Start of the current Baku calendar day, as a UTC instant. */
export function bakuDayStart(now: Date): Date {
  return new Date(Math.floor((now.getTime() + BAKU_OFFSET_MS) / 86_400_000) * 86_400_000 - BAKU_OFFSET_MS);
}

/** The first send slot strictly after `now`. */
export function nextMatchEmailSlot(now: Date, slots = matchEmailSlotsBaku()): Date {
  const dayStart = bakuDayStart(now).getTime();
  for (let day = 0; day < 2; day++) {
    for (const hour of slots) {
      const at = dayStart + day * 86_400_000 + hour * 3_600_000;
      if (at > now.getTime()) return new Date(at);
    }
  }
  return new Date(dayStart + 86_400_000 + slots[0] * 3_600_000);
}

@Injectable()
export class NotificationsService implements OnApplicationBootstrap {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private postHogService: PostHogService,
    @InjectQueue('digest-daily') private digestQueue: Queue,
    @InjectQueue('match-email-digest') private matchEmailDigestQueue: Queue,
    // Preference gating (alerts/preferences.service.ts). Defaults equal today's behaviour, so absence of a row changes nothing.
    @Optional() private preferences?: PreferencesService,
  ) {}

  async onApplicationBootstrap() {
    // Schedule repeatable job for daily digest (every day at midnight)
    await this.digestQueue.add(
      'daily-digest-job',
      {},
      {
        repeat: {
          pattern: '0 0 * * *',
        },
        removeOnComplete: true,
      },
    ).catch(err => console.error('Failed to register repeatable digest job', err));
    console.log('[CRON DIGEST] Repeatable daily digest job registered successfully');
    await this.rescheduleMatchEmailFlushes().catch(err => console.error('Failed to re-arm match-email flushes', err));
  }

  async getNotifications(userId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' },
    });
    const ids = notifications.filter((n) => n.type === 'NEW_MATCH')
      .map((n) => (n.payload as { matchId?: string } | null)?.matchId).filter((id): id is string => typeof id === 'string');
    if (!ids.length) return notifications;
    // Keep audit records; omit alerts whose underlying recommendation was rejected.
    const matches = await this.prisma.match.findMany({ where: { userId, id: { in: ids } }, select: { id: true, details: true } });
    const rejected = new Set(matches.filter((m) => !isRecommendationRelevant(m.details)).map((m) => m.id));
    return notifications.filter((n) => n.type !== 'NEW_MATCH' || !rejected.has((n.payload as { matchId?: string } | null)?.matchId ?? ''));
  }

  async setRead(userId: string, notificationId: string, read: boolean) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Bildiriş tapılmadı');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { read },
    });
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { success: true };
  }

  async handleMatchCreated(matchId: string, userId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        job: true,
        vacancy: { include: { company: true } },
      },
    });

    if (!match || match.suppressedRollout || !isRecommendationRelevant(match.details)) return; // a silent rollout's match is never announced
    if (['DISMISSED', 'APPLIED', 'ARCHIVED'].includes(match.status)) return;

    const now = new Date();
    if (match.job && !isJobActionable(match.job, now)) return;
    if (match.vacancy) {
      const v = match.vacancy as any;
      if (v.status !== 'ACTIVE' || v.company?.status !== 'APPROVED') return;
      if (v.deadline && new Date(v.deadline) <= now) return;
      if (v.expiresAt && new Date(v.expiresAt) <= now) return;
    }

    const title = match.job?.title || (match as any).vacancy?.title || 'Yeni vakansiya';
    const company = match.job?.company || (match as any).vacancy?.company?.name || '';
    const postingId = match.jobId || (match as any).vacancyId;
    const scorePct = Math.round(match.score * 100);

    // Prevent duplicate in-app alerts for the same match or posting
    const existing = await this.prisma.notification.findMany({
      where: { userId, type: 'NEW_MATCH' },
      select: { payload: true },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
    const alreadyNotified = existing.some((n: any) => {
      const p = n?.payload;
      return p && (p.matchId === match.id || (postingId && p.jobId === postingId));
    });
    if (alreadyNotified) return;

    // Preferences are read when the event happens AND again when the e-mail is sent. Match events are separate from new-job alerts.
    const prefs = await this.preferences?.get(userId);
    if (prefs && !prefs.matchInApp) {
      if (this.matchEmailAllowed(prefs) && match.score >= matchEmailMinScore()) await this.scheduleMatchEmailFlush(userId);
      return;
    }
    // In-app notification is created immediately — only the email is batched.
    await this.prisma.notification.create({
      data: {
        userId,
        type: 'NEW_MATCH',
        message: `Yeni uyğunluq: ${title} — ${company} (${scorePct}%)`,
        payload: {
          matchId: match.id,
          jobId: postingId,
          jobTitle: title,
          company,
          score: match.score,
        },
      },
    });

    // Only a match good enough to be emailed schedules a flush.
    if (match.score < matchEmailMinScore()) return;
    if (prefs && !this.matchEmailAllowed(prefs)) return;
    await this.scheduleMatchEmailFlush(userId);
  }

  private matchEmailAllowed(prefs: { matchEmail: boolean; emailEnabled: boolean; pausedUntil: Date | null }, now = new Date()): boolean {
    return prefs.matchEmail && prefs.emailEnabled && !(prefs.pausedUntil && prefs.pausedUntil > now);
  }

  // One flush per user, at the next send slot. Adding a job whose id is
  // already waiting/delayed is a no-op in BullMQ, so every match before that
  // slot folds into the flush that is already scheduled.
  async scheduleMatchEmailFlush(userId: string, now = new Date()) {
    const at = nextMatchEmailSlot(now);
    await this.matchEmailDigestQueue.add(
      'flush',
      { userId },
      {
        jobId: `flush-${userId}`,
        delay: Math.max(0, at.getTime() - now.getTime()),
        removeOnComplete: true,
        removeOnFail: true,
      },
    ).catch(err => console.error(`Failed to schedule match-email digest for user ${userId}`, err));
  }

  /** One recommendation batch per 48 hours. Failed sends keep matches pending. */
  async sendMatchEmailDigest(userId: string, now = new Date()): Promise<boolean> {
    // Both queue entry points share one per-user database lock and send history.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`match-email:${userId}`}))`;
      return this.sendMatchEmailDigestLocked(userId, now, tx);
    }, { timeout: 45_000 });
  }

  private async sendMatchEmailDigestLocked(userId: string, now: Date, db: any): Promise<boolean> {
    const user = await db.user.findUnique({ where: { id: userId }, include: { subscription: true, planOverrides: activePlanOverrides(now) } });
    if (!user || user.suspendedAt) return false;

    // Re-check preferences now, not when the match was created: unsubscribed, paused or switched off means nothing is sent; quiet hours defer to their end.
    const prefs = await this.preferences?.get(userId);
    if (prefs) {
      if (!this.matchEmailAllowed(prefs, now)) return false;
      const quiet = quietUntil(prefs, now);
      if (quiet) {
        await this.matchEmailDigestQueue.add('flush', { userId }, { jobId: `flush-${userId}`, delay: Math.max(0, quiet.getTime() - now.getTime()), removeOnComplete: true, removeOnFail: true }).catch(() => undefined);
        return false;
      }
    }

    // Include the old paid digest records and old flush timestamps so this policy starts immediately on upgrade.
    const [lastFlush, lastDigest] = await Promise.all([
      db.match.findFirst({ where: { userId, notifiedAt: { not: null } }, orderBy: { notifiedAt: 'desc' }, select: { notifiedAt: true } }),
      db.notification.findFirst({ where: { userId, type: 'DIGEST' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    const lastSent = Math.max(lastFlush?.notifiedAt?.getTime() || 0, lastDigest?.createdAt?.getTime() || 0);
    const dailyQuota = PLAN_DAILY_MATCH_QUOTAS[effectivePlan(user, now)];
    if (lastSent && (dailyQuota !== undefined ? lastSent >= bakuDayStart(now).getTime() : effectivePlan(user, now) === 'FREE' ? lastSent >= matchWeekStart(now).getTime() : now.getTime() - lastSent < 48 * 3_600_000)) return false;

    const candidates = await db.match.findMany({
      where: {
        userId,
        notifiedAt: null,
        suppressedRollout: null,
        score: { gte: matchEmailMinScore() },
        createdAt: { gte: new Date(now.getTime() - MATCH_EMAIL_LOOKBACK_MS) },
        status: { in: ['NEW', 'VIEWED'] },
      },
      include: { job: true, vacancy: { include: { company: true } } },
      orderBy: { score: 'desc' },
    });
    const open = candidates.filter((m: any) => isRecommendationRelevant(m.details)).filter((m: any) =>
      m.job ? isJobActionable(m.job, now) : m.vacancy ? m.vacancy.status === 'ACTIVE' && m.vacancy.company?.status === 'APPROVED' && (!m.vacancy.deadline || m.vacancy.deadline > now) && (!m.vacancy.expiresAt || m.vacancy.expiresAt > now) : false,
    );
    if (open.length === 0) return false;
    // Recomputed matches for a posting already sent must not re-announce it.
    const oldDigests = await db.notification.findMany({ where: { userId, type: 'DIGEST' }, select: { payload: true } });
    const oldIds = oldDigests.flatMap((n: any) => Array.isArray(n.payload?.matchIds) ? n.payload.matchIds : []).filter((id: unknown) => typeof id === 'string');
    const sent = await db.match.findMany({ where: { userId, OR: [{ notifiedAt: { not: null } }, { id: { in: oldIds } }] }, select: { id: true, jobId: true, vacancyId: true } });
    const ref = (m: any) => m.jobId ? `job:${m.jobId}` : m.vacancyId ? `vacancy:${m.vacancyId}` : m.id;
    const seen = new Set(sent.map(ref));
    const seenTitleCompany = new Set<string>();
    const fresh = open.filter((m: any) => {
      const key = ref(m);
      if (seen.has(key)) return false;
      seen.add(key);
      const title = (m.job?.title || m.vacancy?.title || '').trim().toLowerCase();
      const comp = (m.job?.company || m.vacancy?.company?.name || '').trim().toLowerCase();
      if (title && comp) {
        const pairKey = `${title}|${comp}`;
        if (seenTitleCompany.has(pairKey)) return false;
        seenTitleCompany.add(pairKey);
      }
      return true;
    });
    const listed = fresh.slice(0, matchEmailBatchSize(effectivePlan(user, now)));
    if (!listed.length) return false;


    const postingOf = (m: any) => ({
      title: m.job?.title || m.vacancy?.title || 'Vakansiya',
      company: m.job?.company || m.vacancy?.company?.name || '',
      location: m.job?.location || m.vacancy?.location || '',
    });
    const matchesHtml = listed.map((m: any) => {
      const p = postingOf(m);
      return `
      <li>
        <strong>${escapeHtml(p.title)}</strong> - ${escapeHtml(p.company)} (${Math.round(m.score * 100)}%)${p.location ? ` - <em>${escapeHtml(p.location)}</em>` : ''}
      </li>
    `;
    }).join('');

    const first = postingOf(listed[0]);
    const subject = sanitizeHeaderValue(
      listed.length === 1
        ? `Sizə uyğun vakansiya: ${first.title} - ${first.company} (${Math.round(listed[0].score * 100)}%)`
        : `${listed.length} yeni uyğun vakansiya (${Math.round(matchEmailMinScore() * 100)}%+ uyğunluq)`,
    );
    const html = `
      <h1>${listed.length === 1 ? 'Sizə uyğun yeni vakansiya' : `${listed.length} yeni uyğun vakansiya`}</h1>
      <p>Salam,</p>
      <p>Profilinizə ən azı ${Math.round(matchEmailMinScore() * 100)}% uyğun gələn ${listed.length === 1 ? 'yeni vakansiya' : 'ən yaxşı yeni vakansiyalar'}:</p>
      <ul>
        ${matchesHtml}
      </ul>

      <p><a href="${process.env.FRONTEND_URL}/dashboard/matches">Uyğunluqlarınıza baxın</a></p>
      <p>${dailyQuota !== undefined ? 'Yeni uyğun vakansiyalar olduqda gündə bir dəfə göndəririk.' : 'Yeni uyğun vakansiyalar olduqda həftədə bir dəfə göndəririk.'} Eyni elanı təkrar göndərmirik.</p>
      ${this.unsubscribeLine(userId)}
      <p>Hörmətlə,<br>AISE komandası</p>
    `;

    // A failed send throws before anything is marked, so these matches stay
    // pending and the next flush includes them.
    console.log(`[EMAIL DISPATCH] Sending match digest (${listed.length} match(es), ${listed.length} listed) to user ${userId}`);
    const key = createHash('sha256').update(`match-digest:${userId}:${lastSent}`).digest('hex');
    await this.emailService.send(user.email, subject, html, { idempotencyKey: `match-digest-${key}` });

    // Only displayed matches are marked sent; the rest remain eligible for a later batch.
    await db.match.updateMany({
      where: { id: { in: listed.map((m: any) => m.id) } },
      data: { notifiedAt: now },
    });

    await db.notification.create({ data: { userId, type: 'DIGEST', createdAt: now, message: `Yeni uyğun vakansiyalar: ${listed.length}`, payload: { matchIds: listed.map((m: any) => m.id), matchCount: listed.length } } });
    this.postHogService.capture(userId, 'match_digest_email_sent', { matchCount: listed.length });
    return true;
  }

  async sendPlanOffer(userId: string, now = new Date()): Promise<boolean> {
    const prefs = await this.preferences?.get(userId);
    if (!prefs?.planOffersEmail || !prefs.emailEnabled || (prefs.pausedUntil && prefs.pausedUntil > now) || quietUntil(prefs, now) || !this.preferences?.unsubscribeToken(userId)) return false;
    return this.prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`match-email:${userId}`}))`;
      const user = await db.user.findUnique({ where: { id: userId }, include: { subscription: true, planOverrides: activePlanOverrides(now) } });
      if (!user || user.suspendedAt || effectivePlan(user, now) !== 'FREE') return false;
      const last = await db.notification.findFirst({ where: { userId, type: 'PLAN_OFFER', createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } });
      const digest = await db.notification.findFirst({ where: { userId, type: 'DIGEST' }, orderBy: { createdAt: 'desc' } });
      if (last || !digest || now.getTime() - digest.createdAt.getTime() < 3 * 86_400_000) return false;
      const week = matchWeekStart(now).toISOString();
      await this.emailService.send(user.email, 'Daha çox uyğun vakansiya ilə tanış olun', `<h1>Karyeranız üçün növbəti addım</h1><p>Plus: ${PLAN_PRICES_AZN.PLUS} AZN/ay — gündə 1, Premium: ${PLAN_PRICES_AZN.PREMIUM} AZN/ay — gündə 5 yeni uyğun vakansiyaya qədər. Yeni uyğun elanlar olduqda.</p><p><a href="${process.env.FRONTEND_URL}/pricing">Planları müqayisə edin</a></p>${this.unsubscribeLine(userId)}`, { idempotencyKey: `plan-offer-${userId}-${week}` });
      await db.notification.create({ data: { userId, type: 'PLAN_OFFER', message: 'Plan üstünlükləri', payload: { week } } });
      return true;
    }, { timeout: 45_000 });
  }

  private unsubscribeLine(userId: string): string {
    const token = this.preferences?.unsubscribeToken(userId);
    return token ? `<p><a href="${process.env.API_PUBLIC_URL || ''}/notifications/unsubscribe?token=${encodeURIComponent(token)}">Abunəlikdən çıx</a></p>` : '';
  }

  /**
   * Re-arms flushes after a restart (and after the email queue is resumed):
   * one per user with an emailable pending match, at the next send slot.
   */
  async rescheduleMatchEmailFlushes(now = new Date()) {
    const pending = await this.prisma.match.findMany({
      where: {
        notifiedAt: null,
        suppressedRollout: null,
        score: { gte: matchEmailMinScore() },
        createdAt: { gte: new Date(now.getTime() - MATCH_EMAIL_LOOKBACK_MS) },
        status: { in: ['NEW', 'VIEWED'] },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    for (const { userId } of pending) await this.scheduleMatchEmailFlush(userId, now);
    return pending.length;
  }

  async runDailyDigest(now = new Date()) {
    // This queue checks eligibility daily; each person is emailed only every 48 hours.
    const users = await this.prisma.user.findMany({ where: { suspendedAt: null }, select: { id: true } });
    let sent = 0, failed = 0;
    for (const user of users) {
      try { if (await this.sendMatchEmailDigest(user.id, now)) sent++; await this.sendPlanOffer(user.id, now); }
      catch (err) { failed++; console.error(`[MATCH DIGEST] Send failed (${(err as { code?: string })?.code || 'error'}); no matches marked.`); }
    }
    return { sent, failed };
  }
}
