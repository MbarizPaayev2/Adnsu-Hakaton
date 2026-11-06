import { Injectable, Logger, Optional, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { EmailService } from '../common/email.service';
import { escapeHtml, sanitizeHeaderValue } from '../common/text.util';
import { JobCatalogueService } from '../jobs/job-catalogue.service';
import { normalizeCompany } from '../jobs/job-dedup.util';
import { ProductService } from '../billing/product.service';
import { catalogueOptions } from '../jobs/job-catalogue.service';
import { rowMatchesCriteria } from './criteria-match';
import { bakuMinutes, PreferencesService, quietUntil } from './preferences.service';
import type { SearchCriteria } from '../saved/search-criteria';

const MAX_ATTEMPTS = 5;
const EMAIL_ITEMS = 10;
const BAKU_MS = 4 * 3_600_000;
const bakuDayStart = (now: Date) => new Date(Math.floor((now.getTime() + BAKU_MS) / 86_400_000) * 86_400_000 - BAKU_MS);

/** A transport sends one channel's batch for one user. EMAIL is built in; Telegram plugs in later and stays disabled until verified. */
export interface ChannelSender {
  channel: 'TELEGRAM';
  /** True only when the channel is enabled by configuration and this user has an active, private-chat link. */
  isActiveFor(userId: string): Promise<boolean>;
  send(userId: string, lines: { title: string; company: string; url: string }[]): Promise<void>;
}

/**
 * New-job alerts. Fan-out turns a newly ingested posting into at most ONE event per interested user (saved searches with alerts on, followed
 * companies), deduplicated by the canonical posting; dispatch re-reads preferences and posting state at send time. Reuses the existing queues,
 * the existing in-app Notification table and the existing EmailService (which is the sink/fake locally).
 */
@Injectable()
export class AlertsService implements OnApplicationBootstrap {
  private readonly log = new Logger(AlertsService.name);
  private telegram: ChannelSender | null = null;

  constructor(
    private prisma: PrismaService,
    private catalogue: JobCatalogueService,
    private prefs: PreferencesService,
    private products: ProductService,
    private email: EmailService,
    @InjectQueue('alert-dispatch') private dispatchQueue: Queue,
    @Optional() @InjectQueue('new-job-alert') private fanOutQueue?: Queue,
  ) {}

  registerChannel(sender: ChannelSender) { this.telegram = sender; }

  async onApplicationBootstrap() {
    // Daily digest of alerts, 09:00 Baku (05:00 UTC). Repeatable job: registering it again is a no-op.
    await this.dispatchQueue.add('daily-alert-digest', {}, { repeat: { pattern: '0 5 * * *' }, removeOnComplete: true }).catch((e) => this.log.error(`could not register the alert digest: ${e?.message}`));
  }

  // ── fan-out ─────────────────────────────────────────────────────────────────────────────────────────
  /** Creates the events for one new imported posting. Safe to run twice: the unique (user, canonical posting) key makes the second run a no-op. */
  async fanOutNewJob(jobId: string, now = new Date()) { return this.fanOut('imported', jobId, now); }

  /** The same for a newly published (or re-activated) employer vacancy. Follows match by the stable company id, never by name. */
  async fanOutNewVacancy(vacancyId: string, now = new Date()) { return this.fanOut('native', vacancyId, now); }

  private async fanOut(kind: 'imported' | 'native', id: string, now: Date) {
    const item = await this.catalogue.openItem(kind, id);
    if (!item) return { created: 0, reason: 'not_open' }; // closed, hidden, duplicate-linked, expired: nothing is announced
    const companyKey = normalizeCompany(item.company);
    const reasons = new Map<string, { searchIds: string[]; companyKey?: string; companyId?: string }>();
    const note = (userId: string) => reasons.get(userId) ?? reasons.set(userId, { searchIds: [] }).get(userId)!;

    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.savedSearch.findMany({ where: { alertsEnabled: true }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
      if (!batch.length) break;
      for (const s of batch) {
        let criteria: SearchCriteria;
        try { catalogueOptions(s.criteria as Record<string, string>); criteria = s.criteria as SearchCriteria; } catch { continue; } // an unreadable stored search never alerts
        if (rowMatchesCriteria(item, criteria)) note(s.userId).searchIds.push(s.id);
      }
      cursor = batch[batch.length - 1].id;
    }
    if (kind === 'native' && item.companyId) {
      for (const f of await this.prisma.companyFollow.findMany({ where: { companyId: item.companyId } })) note(f.userId).companyId = item.companyId;
    } else if (companyKey) {
      for (const f of await this.prisma.companyFollow.findMany({ where: { companyKey } })) note(f.userId).companyKey = companyKey;
    }

    let created = 0;
    for (const [userId, why] of reasons) {
      try { if (await this.createEvent(userId, { kind, id: item.id }, why, now)) created++; } catch (e: any) { this.log.error(`alert for one user failed: ${e?.message}`); } // one user's failure never blocks the others
    }
    return { created, interested: reasons.size };
  }

  private async createEvent(userId: string, target: { kind: 'imported' | 'native'; id: string }, why: { searchIds: string[]; companyKey?: string; companyId?: string }, now: Date): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, suspendedAt: true } });
    if (!user || user.suspendedAt) return false;
    const prefs = await this.prefs.get(userId);
    const wantsEmail = prefs.newJobEmail !== 'OFF' && prefs.emailEnabled;
    const wantsTelegram = prefs.newJobTelegram !== 'OFF' && !!(await this.telegram?.isActiveFor(userId));
    if (!prefs.newJobInApp && !wantsEmail && !wantsTelegram) return false;
    const item = await this.catalogue.openItem(target.kind, target.id);
    if (!item) return false;
    const ref = `${target.kind}:${target.id}`;

    let instant = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        const event = await tx.alertEvent.create({ data: { userId, kind: 'NEW_JOB', dedupeKey: target.kind === 'imported' ? `job:${target.id}` : `vacancy:${target.id}`, ...(target.kind === 'imported' ? { jobId: target.id } : { vacancyId: target.id }), reasons: why as unknown as Prisma.InputJsonValue } });
        if (prefs.newJobInApp) {
          await tx.notification.create({ data: { userId, type: 'NEW_JOB', message: `Yeni vakansiya: ${item.title} — ${item.company}`, payload: { jobId: target.id, ref, searchIds: why.searchIds, followed: !!(why.companyKey || why.companyId) } } });
          await tx.alertDelivery.create({ data: { eventId: event.id, channel: 'IN_APP', frequency: 'INSTANT', status: 'SENT', sentAt: now, attempts: 1 } });
        }
        if (wantsEmail) {
          await tx.alertDelivery.create({ data: { eventId: event.id, channel: 'EMAIL', frequency: prefs.newJobEmail } });
          instant = instant || prefs.newJobEmail === 'INSTANT';
        }
        if (wantsTelegram) await tx.alertDelivery.create({ data: { eventId: event.id, channel: 'TELEGRAM', frequency: prefs.newJobTelegram } });
      });
    } catch (e: any) {
      if (e?.code === 'P2002') return false; // already announced to this user (retry, overlapping search/follow, duplicate posting): suppressed
      throw e;
    }
    if (instant) await this.scheduleDispatch(userId, 'instant', 60_000);
    if (prefs.newJobTelegram === 'INSTANT' && wantsTelegram) await this.scheduleDispatch(userId, 'instant', 60_000, 'TELEGRAM');
    return true;
  }

  private async scheduleDispatch(userId: string, mode: 'instant' | 'daily', delayMs: number, channel: 'EMAIL' | 'TELEGRAM' = 'EMAIL') {
    await this.dispatchQueue.add('dispatch', { userId, mode, channel }, { jobId: `alert-${channel}-${mode}-${userId}-${Math.floor((Date.now() + delayMs) / 60_000)}`, delay: delayMs, attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true, removeOnFail: { age: 86_400 } })
      .catch((e) => this.log.error(`could not schedule an alert dispatch: ${e?.message}`));
  }

  // ── dispatch ────────────────────────────────────────────────────────────────────────────────────────
  async runDailyDigest(now = new Date()) {
    let sent = 0, failed = 0;
    const users = new Map<string, Set<'EMAIL' | 'TELEGRAM'>>();
    for (const channel of ['EMAIL', 'TELEGRAM'] as const) {
      const rows = await this.prisma.alertDelivery.findMany({ where: { channel, status: 'PENDING', frequency: 'DAILY' }, select: { event: { select: { userId: true } } } });
      for (const r of rows) (users.get(r.event.userId) ?? users.set(r.event.userId, new Set()).get(r.event.userId)!).add(channel);
    }
    for (const [userId, channels] of users) {
      for (const channel of channels) {
        try {
          const r = channel === 'EMAIL' ? await this.dispatchEmail(userId, 'daily', now) : await this.dispatchTelegram(userId, 'daily', now);
          if (r.sent > 0) sent++;
        } catch (e: any) { failed++; this.log.error(`digest for one user failed (${e?.code || 'error'}); it stays pending`); } // one user's or channel's failure never blocks another
      }
    }
    return { users: users.size, sent, failed };
  }

  /** Re-checks each pending delivery NOW: the subscription that caused it must still exist and the posting must still be open. */
  private async recheck(userId: string, batch: { id: string; event: { reasons: unknown; jobId: string | null; vacancyId?: string | null } }[], skip: (ids: string[], reason: string) => Promise<number>) {
    const live: { id: string; title: string; company: string; ref: string }[] = [];
    let skipped = 0;
    for (const d of batch) {
      const reasons = d.event.reasons as { searchIds?: string[]; companyKey?: string; companyId?: string };
      const stillWanted = (reasons.searchIds?.length ? (await this.prisma.savedSearch.count({ where: { id: { in: reasons.searchIds }, userId, alertsEnabled: true } })) > 0 : false) || (reasons.companyKey ? (await this.prisma.companyFollow.count({ where: { userId, companyKey: reasons.companyKey } })) > 0 : false) || (reasons.companyId ? (await this.prisma.companyFollow.count({ where: { userId, companyId: reasons.companyId } })) > 0 : false);
      if (!stillWanted) { skipped += await skip([d.id], 'subscription_removed'); continue; }
      const item = d.event.jobId ? await this.catalogue.openItem('imported', d.event.jobId) : d.event.vacancyId ? await this.catalogue.openItem('native', d.event.vacancyId) : null;
      if (!item) { skipped += await skip([d.id], 'posting_closed'); continue; }
      live.push({ id: d.id, title: item.title, company: item.company, ref: `${d.event.vacancyId ? 'native' : 'imported'}:${item.id}` });
    }
    return { live, skipped };
  }

  /** Telegram counterpart of dispatchEmail: same re-checks, same bounds; nothing happens unless the adapter is enabled and the user has an active private-chat link. */
  async dispatchTelegram(userId: string, mode: 'instant' | 'daily', now = new Date()): Promise<{ sent: number; deferredUntil?: Date; skipped: number }> {
    const skip = async (ids: string[], reason: string) => { if (ids.length) await this.prisma.alertDelivery.updateMany({ where: { id: { in: ids }, status: 'PENDING' }, data: { status: 'SKIPPED', skipReason: reason } }); return ids.length; };
    const pending = await this.prisma.alertDelivery.findMany({ where: { channel: 'TELEGRAM', status: 'PENDING', event: { userId } }, include: { event: true }, orderBy: { createdAt: 'asc' } });
    if (!pending.length) return { sent: 0, skipped: 0 };
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.suspendedAt) return { sent: 0, skipped: await skip(pending.map((p) => p.id), 'account_unavailable') };
    const prefs = await this.prefs.get(userId);
    if (prefs.newJobTelegram === 'OFF') return { sent: 0, skipped: await skip(pending.map((p) => p.id), 'telegram_alerts_off') };
    if (prefs.pausedUntil && prefs.pausedUntil > now) return { sent: 0, skipped: await skip(pending.map((p) => p.id), 'paused') };
    if (!this.telegram || !(await this.telegram.isActiveFor(userId))) return { sent: 0, skipped: await skip(pending.map((p) => p.id), 'telegram_not_active') };
    const quiet = quietUntil(prefs, now);
    if (quiet) { await this.scheduleDispatch(userId, mode, quiet.getTime() - now.getTime(), 'TELEGRAM'); return { sent: 0, skipped: 0, deferredUntil: quiet }; }
    let batch = mode === 'daily' ? pending : pending.filter((p) => p.frequency === 'INSTANT');
    if (mode === 'instant') {
      const grant = await this.products.grantForUser(userId, 'alerts.instant');
      const toDaily = async (rows: { id: string }[]) => { if (rows.length) await this.prisma.alertDelivery.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { frequency: 'DAILY' } }); };
      if (!grant?.enabled) { await toDaily(batch); return { sent: 0, skipped: 0 }; }
      const cap = Math.min(prefs.instantDailyCap, grant.limit ?? prefs.instantDailyCap);
      const sentToday = await this.prisma.alertDelivery.count({ where: { channel: 'TELEGRAM', frequency: 'INSTANT', status: 'SENT', sentAt: { gte: bakuDayStart(now) }, event: { userId } } });
      const room = Math.max(0, cap - sentToday);
      await toDaily(batch.slice(room));
      batch = batch.slice(0, room);
      if (!batch.length) return { sent: 0, skipped: 0 };
    }
    const { live, skipped } = await this.recheck(userId, batch, skip);
    if (!live.length) return { sent: 0, skipped };
    const front = process.env.FRONTEND_URL || '';
    try {
      await this.telegram.send(userId, live.slice(0, EMAIL_ITEMS).map((l) => ({ title: l.title, company: l.company, url: `${front}/jobs/${l.ref.split(':')[0]}/${encodeURIComponent(l.ref.split(':')[1])}` })));
    } catch (e: any) {
      const ids = live.map((l) => l.id);
      await this.prisma.alertDelivery.updateMany({ where: { id: { in: ids } }, data: { attempts: { increment: 1 }, lastError: String(e?.code || 'send_failed').slice(0, 100) } });
      await this.prisma.alertDelivery.updateMany({ where: { id: { in: ids }, attempts: { gte: MAX_ATTEMPTS } }, data: { status: 'FAILED' } });
      throw e;
    }
    await this.prisma.alertDelivery.updateMany({ where: { id: { in: live.map((l) => l.id) }, status: 'PENDING' }, data: { status: 'SENT', sentAt: now, attempts: { increment: 1 } } });
    return { sent: live.length, skipped };
  }

  /** Sends the user's pending alert e-mail for `mode`. Everything is re-checked NOW: account, preferences, quiet hours, subscription, posting state, caps. */
  async dispatchEmail(userId: string, mode: 'instant' | 'daily', now = new Date()): Promise<{ sent: number; deferredUntil?: Date; skipped: number }> {
    const skip = async (ids: string[], reason: string) => { if (ids.length) await this.prisma.alertDelivery.updateMany({ where: { id: { in: ids }, status: 'PENDING' }, data: { status: 'SKIPPED', skipReason: reason } }); return ids.length; };
    const pending = await this.prisma.alertDelivery.findMany({ where: { channel: 'EMAIL', status: 'PENDING', event: { userId } }, include: { event: true }, orderBy: { createdAt: 'asc' } });
    if (!pending.length) return { sent: 0, skipped: 0 };
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.suspendedAt) return { sent: 0, skipped: await skip(pending.map((p) => p.id), 'account_unavailable') };
    const prefs = await this.prefs.get(userId);
    if (!prefs.emailEnabled) return { sent: 0, skipped: await skip(pending.map((p) => p.id), 'unsubscribed') };
    if (prefs.pausedUntil && prefs.pausedUntil > now) return { sent: 0, skipped: await skip(pending.map((p) => p.id), 'paused') };
    if (prefs.newJobEmail === 'OFF') return { sent: 0, skipped: await skip(pending.map((p) => p.id), 'email_alerts_off') };
    const unsubscribe = this.prefs.unsubscribeToken(userId);
    if (!unsubscribe) { this.log.error('NOTIFICATION_LINK_SECRET is not configured: non-essential e-mail is not sent'); return { sent: 0, skipped: 0 }; }
    const quiet = quietUntil(prefs, now);
    if (quiet) { await this.scheduleDispatch(userId, mode, quiet.getTime() - now.getTime()); return { sent: 0, skipped: 0, deferredUntil: quiet }; }

    // Which pending deliveries belong to this run. A daily run takes every pending one (instant ones that could not go out fold into it); an instant run only its own.
    let batch = mode === 'daily' ? pending : pending.filter((p) => p.frequency === 'INSTANT');
    if (mode === 'instant') {
      const grant = await this.products.grantForUser(userId, 'alerts.instant');
      if (!grant?.enabled) { await this.prisma.alertDelivery.updateMany({ where: { id: { in: batch.map((b) => b.id) } }, data: { frequency: 'DAILY' } }); return { sent: 0, skipped: 0 }; } // plan no longer includes instant: they join the daily digest
      const cap = Math.min(prefs.instantDailyCap, grant.limit ?? prefs.instantDailyCap);
      const sentToday = await this.prisma.alertDelivery.count({ where: { channel: 'EMAIL', frequency: 'INSTANT', status: 'SENT', sentAt: { gte: bakuDayStart(now) }, event: { userId } } });
      // Bounded: at most the remaining allowance goes out now; anything beyond it waits for the daily digest.
      const room = Math.max(0, cap - sentToday);
      const overflow = batch.slice(room);
      if (overflow.length) await this.prisma.alertDelivery.updateMany({ where: { id: { in: overflow.map((b) => b.id) } }, data: { frequency: 'DAILY' } });
      batch = batch.slice(0, room);
      if (!batch.length) return { sent: 0, skipped: 0 };
    }

    const { live, skipped } = await this.recheck(userId, batch, skip);
    if (!live.length) return { sent: 0, skipped };
    const listed = live.slice(0, EMAIL_ITEMS);
    const more = live.length - listed.length;
    const front = process.env.FRONTEND_URL || '';
    const subject = sanitizeHeaderValue(live.length === 1 ? `Yeni vakansiya: ${listed[0].title} — ${listed[0].company}` : `${live.length} yeni vakansiya axtarışlarınıza uyğundur`);
    const html = `
      <h1>${live.length === 1 ? 'Yeni vakansiya' : `${live.length} yeni vakansiya`}</h1>
      <p>Saxladığınız axtarışlara və izlədiyiniz şirkətlərə uyğun yeni elanlar:</p>
      <ul>${listed.map((l) => `<li><strong>${escapeHtml(l.title)}</strong> — ${escapeHtml(l.company)} (<a href="${front}/jobs/${l.ref.split(':')[0]}/${encodeURIComponent(l.ref.split(':')[1])}">bax</a>)</li>`).join('')}</ul>
      ${more > 0 ? `<p>və daha ${more} elan.</p>` : ''}
      <p>Bu, uyğunluq balı deyil: elanlar yalnız axtarış və ya şirkət seçiminizə görə göndərilir.</p>
      <p><a href="${front}/dashboard/settings">Bildiriş seçimləri</a> · <a href="${process.env.API_PUBLIC_URL || ''}/notifications/unsubscribe?token=${encodeURIComponent(unsubscribe)}">Abunəlikdən çıx</a></p>`;
    try {
      await this.email.send(user.email, subject, html);
    } catch (e: any) {
      // Isolated and retry-safe: nothing is marked sent; the attempt count bounds the retries.
      const ids = live.map((l) => l.id);
      await this.prisma.alertDelivery.updateMany({ where: { id: { in: ids } }, data: { attempts: { increment: 1 }, lastError: String(e?.code || 'send_failed').slice(0, 100) } });
      await this.prisma.alertDelivery.updateMany({ where: { id: { in: ids }, attempts: { gte: MAX_ATTEMPTS } }, data: { status: 'FAILED' } });
      throw e;
    }
    // All of the e-mail's listed and folded postings are one delivery batch; the ones beyond the visible ten were named in the count, so they are done too.
    await this.prisma.alertDelivery.updateMany({ where: { id: { in: live.map((l) => l.id) }, status: 'PENDING' }, data: { status: 'SENT', sentAt: now, attempts: { increment: 1 } } });
    return { sent: live.length, skipped };
  }
}
