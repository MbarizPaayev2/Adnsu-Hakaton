import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/database.service';
import { LocalStorageService } from '../resumes/local-storage.service';
import { BillingService } from '../billing/billing.service';
import { ApplyWorkerClient } from '../external-apply/apply-worker.client';
import { PostHogService } from '../common/posthog.service';

// A send is in flight: deleting now would erase the only record of an
// application that may already have reached the employer.
const IN_FLIGHT = ['SUBMITTING', 'AWAITING_OTP'] as const;
// States that may hold an open browser session on the apply worker.
const LIVE = ['DRAFT', 'FILLING', 'NEEDS_INPUT', 'READY_FOR_REVIEW'] as const;

export type DeletionActor = { kind: 'self' } | { kind: 'admin'; adminUserId: string };

function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain ?? ''}`;
}

/**
 * The one deletion path for candidate accounts, used by self-service and by
 * operators alike. Order matters:
 *  1. refuse while an external application is being sent;
 *  2. stop billing at the provider (refuse if that cannot be confirmed);
 *  3. close apply-worker sessions (best effort);
 *  4. delete the database rows — the source of truth; everything owned cascades;
 *  5. remove the stored files; any that survive are logged for cleanup.
 * The operator audit entry survives the account.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private prisma: PrismaService,
    private storage: LocalStorageService,
    private billing: BillingService,
    private applyWorker: ApplyWorkerClient,
    private postHog: PostHogService,
  ) {}

  async deleteOwnAccount(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { hashedPassword: true } });
    if (!user) throw new UnauthorizedException('Hesab tapılmadı');
    if (!(await bcrypt.compare(password, user.hashedPassword))) {
      throw new UnauthorizedException('Şifrə yanlışdır');
    }
    return this.deleteUser(userId, { kind: 'self' });
  }

  async deleteUser(userId: string, actor: DeletionActor) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscription: true,
        resumes: { select: { fileUrl: true } },
        profile: { select: { idDocumentUrl: true } },
        applications: { select: { files: { select: { fileUrl: true } }, answers: { select: { fileUrl: true } } } },
        externalApplications: { select: { id: true, status: true, reviewScreenshotUrl: true, cvSnapshotUrl: true, idDocumentSnapshotUrl: true } },
        emailApplications: { select: { deliveryState: true, cvSnapshotUrl: true, letterSnapshotUrl: true } },
      },
    });
    if (!user) throw new NotFoundException('İstifadəçi tapılmadı');

    if (user.externalApplications.some((a) => (IN_FLIGHT as readonly string[]).includes(a.status))) {
      throw new ConflictException('Müraciətlərdən biri hazırda göndərilir. Nəticə bəlli olandan sonra hesabı silmək mümkün olacaq.');
    }

    // An e-mail is being handed to the provider right now: its outcome is not known yet.
    if ((user.emailApplications ?? []).some((a) => a.deliveryState === 'SENDING')) {
      throw new ConflictException('Müraciətlərdən biri hazırda e-poçtla göndərilir. Nəticə bəlli olandan sonra hesabı silmək mümkün olacaq.');
    }

    // Throws (and nothing is deleted) when the provider cannot confirm that
    // billing stopped — a deleted account must never keep being charged.
    await this.billing.cancelForDeletion(user.subscription);

    await Promise.all(
      user.externalApplications
        .filter((a) => (LIVE as readonly string[]).includes(a.status))
        .map((a) =>
          this.applyWorker.deleteSession(a.id).catch((err) => {
            this.logger.warn(`Best-effort apply-worker session delete failed for ${a.id}: ${(err as Error)?.message}`);
          }),
        ),
    );

    const fileUrls = [
      ...new Set(
        [
          ...user.resumes.map((r) => r.fileUrl),
          user.profile?.idDocumentUrl,
          ...user.applications.flatMap((a) => [...a.files.map((f) => f.fileUrl), ...a.answers.map((f) => f.fileUrl)]),
          ...user.externalApplications.flatMap((a) => [a.reviewScreenshotUrl, a.cvSnapshotUrl, a.idDocumentSnapshotUrl]),
        ].filter((url): url is string => !!url),
      ),
    ];

    let uncertainEmails = 0;
    // Every owned row (profile, resumes, matches, notifications, sessions,
    // subscription, applications, external applications, overrides) cascades.
    await this.prisma.$transaction(async (tx) => {
      // Coordinate with the e-mail sender: a worker claims an application with an UPDATE, which waits for this lock.
      // Whoever wins, either the claim happened first (refuse: a send is in flight) or the rows are gone before any claim.
      const locked = await tx.$queryRaw<{ deliveryState: string }[]>`SELECT "deliveryState" FROM "EmailApplication" WHERE "userId" = ${userId} FOR UPDATE`;
      if (locked.some((row) => row.deliveryState === 'SENDING')) {
        throw new ConflictException('Müraciətlərdən biri hazırda e-poçtla göndərilir. Nəticə bəlli olandan sonra hesabı silmək mümkün olacaq.');
      }
      uncertainEmails = locked.filter((row) => row.deliveryState === 'UNCERTAIN').length;

      // Anonymize and withdraw any AcademyEnrollment rows so no student PII survives account deletion (GDPR compliance)
      if ((tx as any).academyEnrollment) {
        const enrollments = await (tx as any).academyEnrollment.findMany({
          where: {
            OR: [
              { userId },
              { invitedEmail: user.email.toLowerCase().trim() },
            ],
          },
          select: { id: true },
        });

        for (const enr of enrollments) {
          await (tx as any).academyEnrollment.update({
            where: { id: enr.id },
            data: {
              userId: null,
              invitedEmail: `deleted-student-${enr.id.slice(0, 12)}@anonymized.invalid`,
              status: 'WITHDRAWN',
              withdrawnAt: new Date(),
            },
          });
        }
      }

      await tx.user.delete({ where: { id: userId } });
      if (actor.kind === 'admin') {
        await tx.adminAuditLog.create({
          data: {
            adminUserId: actor.adminUserId,
            action: 'USER_DELETED',
            targetType: 'User',
            targetId: userId,
            metadata: { email: maskEmail(user.email), files: fileUrls.length },
          },
        });
      }
    });

    // Private copies of CVs sent by e-mail (never reachable through /uploads).
    const privateKeys = (user.emailApplications ?? []).flatMap((a) => [a.cvSnapshotUrl, a.letterSnapshotUrl]).filter((key): key is string => !!key);
    await Promise.all(privateKeys.map((key) => this.storage.deletePrivate(key).catch(() => this.logger.error(`Account ${userId} deleted; a private CV copy could not be removed`))));

    // Files go after the rows: a failed unlink must never resurrect an
    // account. Survivors are reported so an operator can remove them.
    await Promise.all(fileUrls.map((url) => this.storage.deleteFile(url).catch(() => undefined)));
    const leftovers = fileUrls.filter((url) => this.storage.fileExists(url));
    if (leftovers.length) {
      this.logger.error(`Account ${userId} deleted; ${leftovers.length} stored file(s) could not be removed: ${leftovers.map((u) => u.split('/').pop()).join(', ')}`);
    }

    // Analytics is best effort: the account is already gone, so a failure here must never read as a failed deletion.
    try {
      this.postHog.capture(actor.kind === 'admin' ? actor.adminUserId : userId, actor.kind === 'admin' ? 'user_deleted' : 'user_account_deleted', { leftoverFiles: leftovers.length });
    } catch {
      this.logger.warn('Deletion analytics event was not sent');
    }
    // An e-mail whose outcome was never confirmed may have reached its recipient; deletion cannot recall it.
    return { success: true, leftoverFiles: leftovers.length, unconfirmedEmailApplications: uncertainEmails };
  }
}
