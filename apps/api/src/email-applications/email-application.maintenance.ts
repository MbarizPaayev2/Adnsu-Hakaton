import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/database.service';
import { LocalStorageService } from '../resumes/local-storage.service';
import { EMAIL_APPLY_CONFIG } from './email-apply.tokens';
import type { EmailApplyConfig } from './email-apply.config';
import { EmailApplicationSender } from './email-application.sender';
import { EmailApplicationsService } from './email-applications.service';
import { EmailService } from '../common/email.service';
import { EmailAutomationService } from './email-automation.service';
import { formatInterview } from './format-az';

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Periodic housekeeping. Every step is idempotent and none of them sends anything by itself. */
@Injectable()
export class EmailApplicationMaintenance {
  private readonly logger = new Logger(EmailApplicationMaintenance.name);

  constructor(
    private prisma: PrismaService,
    private storage: LocalStorageService,
    private sender: EmailApplicationSender,
    private service: EmailApplicationsService,
    private email: EmailService,
    private automation: EmailAutomationService,
    @Inject(EMAIL_APPLY_CONFIG) private cfg: EmailApplyConfig,
  ) {}

  async sweep(now = new Date()) {
    if (!this.cfg.enabled) return { reclaimed: 0, enqueued: 0, purged: 0, reminders: 0, automated: { users: 0, applied: 0, skipped: 0 } };
    const automated = await this.automation.runAll(now).catch(() => ({ users: 0, applied: 0, skipped: 0 }));
    const reclaimed = await this.sender.reclaimStale(now);
    const due = await this.sender.dueIds(now);
    let enqueued = 0;
    for (const { id } of due) {
      try { await this.service.enqueue(id); enqueued++; } catch (error) { this.logger.warn(`Could not enqueue ${id}: ${error instanceof Error ? error.message : error}`); }
    }
    const purged = await this.purgeExpiredSnapshots(now);
    // Events that never matched an application (for example after an account was deleted) hold no personal data but are not kept.
    await this.prisma.emailDeliveryEvent.deleteMany({ where: { emailApplicationId: null, receivedAt: { lt: new Date(now.getTime() - 7 * 24 * 3600_000) } } });
    const reminders = await this.sendDueReminders(now);
    return { reclaimed, enqueued, purged, reminders, automated };
  }

  /** Removes the stored CV and letter copies of applications whose retention period ended. The application record itself stays. */
  async purgeExpiredSnapshots(now = new Date(), limit = 100): Promise<number> {
    const cutoff = new Date(now.getTime() - this.cfg.retentionDays * 24 * 3600_000);
    const rows = await this.prisma.emailApplication.findMany({
      where: { OR: [{ cvSnapshotUrl: { not: null } }, { letterSnapshotUrl: { not: null } }], deliveryState: { notIn: ['QUEUED', 'SENDING', 'UNCERTAIN'] }, updatedAt: { lt: cutoff } },
      select: { id: true, cvSnapshotUrl: true, letterSnapshotUrl: true }, take: limit,
    });
    for (const row of rows) {
      for (const key of [row.cvSnapshotUrl, row.letterSnapshotUrl]) if (key) await this.storage.deletePrivate(key);
      await this.prisma.emailApplication.update({ where: { id: row.id }, data: { cvSnapshotUrl: null, letterSnapshotUrl: null } });
    }
    return rows.length;
  }

  /**
   * One reminder, to the candidate only, 24 hours or less before an interview they scheduled and
   * opted in for. The reminder is claimed first so it cannot be sent twice; a failed send is released
   * to be tried again.
   */
  async sendDueReminders(now = new Date(), limit = 50): Promise<number> {
    const due = await this.prisma.emailApplication.findMany({
      where: { reminderOptIn: true, recruitmentState: 'INTERVIEW_SCHEDULED', reminderSentAt: null, interviewAt: { gt: now, lte: new Date(now.getTime() + 24 * 3600_000) } },
      include: { user: { select: { email: true } } }, take: limit,
    });
    let sent = 0;
    for (const app of due) {
      const claimed = await this.prisma.emailApplication.updateMany({ where: { id: app.id, reminderSentAt: null, reminderOptIn: true, recruitmentState: 'INTERVIEW_SCHEDULED' }, data: { reminderSentAt: now } });
      if (!claimed.count) continue;
      try {
        const when = formatInterview(app.interviewAt!, app.interviewTimezone ?? 'UTC');
        await this.email.send(app.user.email, `Müsahibə xatırlatması: ${app.jobTitle}`.slice(0, 200), `<p>Müsahibəniz üçün xatırlatma.</p><p><strong>${escapeHtml(app.jobTitle)}</strong> — ${escapeHtml(app.jobCompany)}</p><p>${escapeHtml(when)}</p><p>Bu xatırlatmanı siz özünüz aktivləşdirmisiniz; AISE-də müraciətin səhifəsindən söndürə bilərsiniz.</p>`);
        sent++;
      } catch {
        await this.prisma.emailApplication.updateMany({ where: { id: app.id }, data: { reminderSentAt: null } });
        this.logger.warn(`Reminder for application ${app.id} could not be sent; it will be retried`);
      }
    }
    return sent;
  }
}
