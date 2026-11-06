import { premiumEmailAccess } from './email-premium';
import { AUTOMATION_CONSENT_VERSION } from './email-automation.service';
import { applicationInstructionBlock } from '../jobs/job-facts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EmailApplication } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { LocalStorageService } from '../resumes/local-storage.service';
import { FeatureFlagsService } from '../operations/feature-flags.service';
import { isJobActionable } from '../jobs/jobs.service';
import { EMAIL_APPLY_CONFIG, EMAIL_TRANSPORT } from './email-apply.tokens';
import { recipientAllowed, type EmailApplyConfig } from './email-apply.config';
import type { EmailTransport, TransportResult } from './email-transport';
import { payloadHash, payloadPartsOf, sha256Hex, stateFromEvidence } from './email-application-state';
import { singleLine } from './email-application-draft';

interface Stop { result: SendResult; reason: string }

export type SendResult =
  | 'skipped' // not queued, already claimed, or not due
  | 'held' // put back in the queue for a stated reason
  | 'cancelled'
  | 'failed'
  | 'provider_accepted'
  | 'retry_scheduled'
  | 'uncertain';

const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
const STALE_SENDING_MS = 10 * 60_000;
const HOLD_MS = 5 * 60_000;
const LIMIT_HOLD_MS = 30 * 60_000;

/** Address part of `Name <addr>` or a bare address. */
export function addressOf(from: string): string {
  const match = /<([^<>]+)>\s*$/.exec(from);
  return (match ? match[1] : from).trim();
}

/**
 * Sends one approved application. Everything that must hold at the moment of
 * sending is re-checked here, not trusted from approval time. The provider is
 * called at most once per claim, and an outcome nobody can confirm is recorded
 * as uncertain and is never retried by this code.
 */
@Injectable()
export class EmailApplicationSender {
  private readonly logger = new Logger(EmailApplicationSender.name);

  constructor(
    private prisma: PrismaService,
    private storage: LocalStorageService,
    private flags: FeatureFlagsService,
    @Inject(EMAIL_APPLY_CONFIG) private cfg: EmailApplyConfig,
    @Inject(EMAIL_TRANSPORT) private transport: EmailTransport,
  ) {}

  async process(id: string, now = new Date()): Promise<SendResult> {
    // Exactly one worker can move QUEUED to SENDING; everyone else stops here.
    const claimed = await this.prisma.emailApplication.updateMany({
      where: { id, deliveryState: 'QUEUED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      data: { deliveryState: 'SENDING', lockedAt: now, attemptCount: { increment: 1 }, holdReason: null },
    });
    if (!claimed.count) return 'skipped';
    const row = await this.prisma.emailApplication.findUniqueOrThrow({ where: { id } });
    try {
      return await this.send(row, now);
    } catch (error) {
      // Anything unexpected after the claim: nothing is known to have been sent unless an attempt row says so.
      this.logger.error(`Unexpected failure for application ${id}: ${error instanceof Error ? error.name : 'error'}`);
      return this.recoverFromCrash(id, now);
    }
  }

  /** Test seam: runs after the first checks and before the last look, so a test can change the world in between. */
  onBeforeFinalCheck?: (id: string) => Promise<void>;

  private async send(row: EmailApplication, now: Date): Promise<SendResult> {
    const first = await this.gate(row, now);
    if (first) return this.apply(row.id, first, now);

    // Documents and fields are verified against what the candidate approved.
    let cv: Buffer;
    let letter: Buffer | null = null;
    try {
      cv = await this.storage.readPrivate(row.cvSnapshotUrl!);
      if (row.letterResumeId) letter = await this.storage.readPrivate(row.letterSnapshotUrl!);
    } catch {
      return this.fail(row.id, 'ATTACHMENT_MISSING', now);
    }
    const expected = payloadHash(payloadPartsOf(row, 'approved'));
    if (sha256Hex(cv) !== row.cvSha256 || (letter && sha256Hex(letter) !== row.letterSha256) || expected !== row.payloadSha256) return this.fail(row.id, 'INTEGRITY_MISMATCH', now);

    const attempt = await this.beginAttempt(row, now);
    if (attempt === 'limit') return this.hold(row.id, 'DAILY_LIMIT', new Date(now.getTime() + LIMIT_HOLD_MS));

    await this.onBeforeFinalCheck?.(row.id);
    // Last look, immediately before the provider is called: the SAME checks, on freshly read data. Cancellation
    // is only possible up to here. Once the request below has begun, the message cannot be recalled.
    const fresh = await this.prisma.emailApplication.findUnique({ where: { id: row.id } });
    const last = fresh ? await this.gate(fresh, now, true) : { result: 'skipped' as SendResult, reason: 'application_deleted' };
    if (last) {
      await this.prisma.emailSendAttempt.update({ where: { id: attempt.id }, data: { outcome: 'REJECTED', finishedAt: new Date(), errorCode: `stopped_before_send:${last.reason}` } }).catch(() => undefined);
      return this.apply(row.id, last, now);
    }

    const display = singleLine(`${row.senderName} via AISE`).replace(/["<>]/g, '');
    const alias = row.senderEmail ?? null;
    const from = `"${display}" <${alias ?? addressOf(this.cfg.from ?? 'applications@sink.invalid')}>`;
    const result = await this.transport.send({
      from, to: row.recipient, replyTo: row.replyTo, ...(row.copyToSelf ? { bcc: row.replyTo } : {}), subject: row.subject, text: row.body,
      attachments: [{ filename: row.cvFileName, content: cv, contentType: row.cvMimeType }, ...(letter ? [{ filename: row.letterFileName!, content: letter, contentType: 'application/pdf' }] : [])], applicationTag: row.id, idempotencyKey: attempt.idempotencyKey,
    });
    return this.record(row, attempt.id, result);
  }

  /** Turns a stop decision into the matching state change. */
  private apply(id: string, stop: Stop, now: Date): Promise<SendResult> {
    switch (stop.result) {
      case 'cancelled': return this.cancel(id, now, stop.reason);
      case 'failed': return this.fail(id, stop.reason, now);
      case 'held': return this.hold(id, stop.reason, new Date(now.getTime() + HOLD_MS));
      default: return Promise.resolve('skipped');
    }
  }

  /**
   * Every reason not to send, all re-read from the database each time. Used before the attempt is recorded and
   * again immediately before the provider call, with identical rules: nothing is checked only once.
   */
  private async gate(row: EmailApplication, now: Date, final = false): Promise<Stop | null> {
    const current = await this.prisma.emailApplication.findUnique({ where: { id: row.id }, select: { deliveryState: true, cancelRequestedAt: true, approvedAt: true, recipient: true, instructions: true, subject: true, body: true, bodySha256: true, payloadSha256: true, cvSha256: true, cvPreviewSha256: true, cvFileName: true, replyTo: true, senderName: true, senderEmail: true, copyToSelf: true, letterResumeId: true, letterFileName: true, letterPreviewSha256: true, letterSha256: true } });
    if (!current || current.deliveryState !== 'SENDING') return { result: 'skipped', reason: 'not_claimed' };
    if (current.cancelRequestedAt) return { result: 'cancelled', reason: 'CANDIDATE_CANCELLED' };
    if (!this.cfg.enabled) return { result: 'held', reason: 'FEATURE_DISABLED' };
    if (await this.flags.isPaused('email_apply.sending')) return { result: 'held', reason: 'EMERGENCY_PAUSE' };
    const settings = await this.prisma.emailApplySettings.findUnique({ where: { userId: row.userId } });
    if (settings?.consentRevokedAt && current.approvedAt && settings.consentRevokedAt >= current.approvedAt) return { result: 'cancelled', reason: 'CONSENT_REVOKED' };
    if (settings?.sendingPausedAt) return { result: 'held', reason: 'USER_PAUSED' };
    // A changed approved alias is an integrity failure, rather than merely a different plan/identity.
    if (current.senderEmail !== row.senderEmail) return { result: 'failed', reason: 'INTEGRITY_MISMATCH' };
    if (row.senderEmail && payloadHash(payloadPartsOf(current, 'approved')) !== current.payloadSha256) return { result: 'failed', reason: 'INTEGRITY_MISMATCH' };
    if (row.senderEmail) {
      const { user, included } = await premiumEmailAccess(this.prisma, row.userId, now);
      if (!this.cfg.candidateAliasesEnabled || !included || !user?.emailVerified || user.candidateMailAlias !== row.senderEmail) return { result: 'cancelled', reason: 'SENDER_ALIAS_UNAVAILABLE' };
    }
    if (row.mode === 'AUTOMATIC') {
      if (!settings?.automationEnabled) return { result: 'cancelled', reason: 'AUTOMATION_DISABLED' };
      if (!this.cfg.automationEnabled || (await this.flags.isPaused('email_apply.automation'))) return { result: 'held', reason: 'AUTOMATION_PAUSED' };
      if (settings.consentVersion !== AUTOMATION_CONSENT_VERSION) return { result: 'cancelled', reason: 'CONSENT_REQUIRED' };
      if (!(await premiumEmailAccess(this.prisma, row.userId, now)).included) return { result: 'cancelled', reason: 'PLAN_REQUIRED' };
    }

    const job = row.jobId ? await this.prisma.job.findUnique({ where: { id: row.jobId } }) : null;
    if (!job || !isJobActionable(job, now)) return { result: 'failed', reason: 'JOB_CLOSED' };
    // The listing must still be one an import has seen recently: an open-looking posting nobody has observed for weeks is not proof it is open.
    if (now.getTime() - job.lastSeenAt.getTime() > this.cfg.listingMaxAgeDays * 24 * 3600_000) return { result: 'failed', reason: 'LISTING_STALE' };
    // Nothing else may have been sent to this vacancy (any listing of it) since this application was approved.
    const primaryId = job.duplicateOfId ?? job.id;
    const sameVacancy = await this.prisma.job.findMany({ where: { OR: [{ id: primaryId }, { duplicateOfId: primaryId }] }, select: { id: true } });
    const alreadySent = await this.prisma.emailApplication.findFirst({
      where: {
        userId: row.userId, id: { not: row.id }, deliveryState: { in: ['PROVIDER_ACCEPTED', 'DELIVERED', 'UNCERTAIN', 'BOUNCED', 'COMPLAINED'] },
        OR: [{ jobId: { in: [...new Set([job.id, primaryId, ...sameVacancy.map((j) => j.id)])] } }, { recipient: current.recipient, jobTitle: { equals: job.title, mode: 'insensitive' } }],
      },
      select: { id: true },
    });
    if (alreadySent) return { result: 'failed', reason: 'DUPLICATE_APPLICATION' };
    const owner = await this.prisma.user.findUnique({ where: { id: row.userId }, select: { emailVerified: true } });
    if (!owner?.emailVerified) return { result: 'failed', reason: 'EMAIL_NOT_VERIFIED' };
    // The approved recipient and instructions must still be what the posting says.
    const evidence = job.applicationEmailEvidence as { excerpt?: string } | null;
    if (job.applicationMethod !== 'EMAIL' || job.applicationEmail?.toLowerCase() !== current.recipient.toLowerCase()) return { result: 'failed', reason: 'RECIPIENT_CHANGED' };
    // The candidate approved either the whole instruction block or (applications prepared before blocks were kept) the sentence naming the address.
    const block = job.applicationEmail ? applicationInstructionBlock(job.description, job.applicationEmail) : null;
    const stillSays = [block, evidence?.excerpt ?? null].filter((v): v is string => !!v);
    if (!stillSays.includes(current.instructions ?? '') && !((current.instructions ?? null) === null && !stillSays.length)) return { result: 'failed', reason: 'INSTRUCTIONS_CHANGED' };
    if (await this.prisma.emailSuppression.findUnique({ where: { email: current.recipient.toLowerCase() } })) return { result: 'failed', reason: 'RECIPIENT_SUPPRESSED' };
    if (!recipientAllowed(this.cfg, current.recipient)) return { result: 'failed', reason: 'RECIPIENT_NOT_AUTHORIZED' };
    if (final) {
      // What would be sent is exactly what was approved, as stored right now.
      if (current.payloadSha256 !== row.payloadSha256 || payloadHash(payloadPartsOf(current, 'approved')) !== current.payloadSha256) return { result: 'failed', reason: 'INTEGRITY_MISMATCH' };
    }
    return null;
  }

  /** Counts this application against the daily limits and records the attempt, atomically across workers. */
  private async beginAttempt(row: EmailApplication, now: Date): Promise<'limit' | { id: string; idempotencyKey: string }> {
    const since = new Date(now.getTime() - 24 * 3600_000);
    const idempotencyKey = `aise-ea-${row.id}-g${row.generation}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('ea-limit:global'))`;
      const counted = { startedAt: { gte: since }, outcome: { in: ['PENDING', 'ACCEPTED', 'AMBIGUOUS'] as ('PENDING' | 'ACCEPTED' | 'AMBIGUOUS')[] } };
      const [global, user, recipient] = await Promise.all([
        tx.emailSendAttempt.count({ where: counted }),
        tx.emailSendAttempt.count({ where: { ...counted, emailApplication: { userId: row.userId } } }),
        tx.emailSendAttempt.count({ where: { ...counted, emailApplication: { recipient: row.recipient } } }),
      ]);
      // A retry of an approval the provider may already know does not count twice.
      const sameApproval = await tx.emailSendAttempt.count({ where: { emailApplicationId: row.id, generation: row.generation, ...counted } });
      if (!sameApproval && (global >= this.cfg.globalDailyLimit || user >= this.cfg.userDailyLimit || recipient >= this.cfg.recipientDailyLimit)) return 'limit' as const;
      const number = (await tx.emailSendAttempt.count({ where: { emailApplicationId: row.id, generation: row.generation } })) + 1;
      const created = await tx.emailSendAttempt.create({ data: { emailApplicationId: row.id, generation: row.generation, number, idempotencyKey } });
      return { id: created.id, idempotencyKey };
    });
  }

  private async record(row: EmailApplication, attemptId: string, result: TransportResult): Promise<SendResult> {
    const finishedAt = new Date();
    if (result.kind === 'accepted') {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "EmailApplication" WHERE id = ${row.id} FOR UPDATE`;
        const fresh = await tx.emailApplication.findUniqueOrThrow({ where: { id: row.id } });
        const facts = { ...fresh, providerAcceptedAt: finishedAt };
        // A webhook may already have arrived: the state follows the strongest evidence, never just "accepted".
        const state = stateFromEvidence(facts, 'PROVIDER_ACCEPTED');
        await tx.emailSendAttempt.update({ where: { id: attemptId }, data: { outcome: 'ACCEPTED', finishedAt, httpStatus: 200, providerMessageId: result.messageId } });
        await tx.emailApplication.update({
          where: { id: row.id },
          data: {
            providerMessageId: result.messageId, providerAcceptedAt: finishedAt, deliveryState: state, lockedAt: null, nextAttemptAt: null, failureCode: null,
            ...(state === 'PROVIDER_ACCEPTED' || state === 'DELIVERED' ? { recruitmentState: fresh.recruitmentState === 'NOT_SENT' ? 'SENT' : fresh.recruitmentState } : {}),
          },
        });
        if (fresh.recruitmentState === 'NOT_SENT' && (state === 'PROVIDER_ACCEPTED' || state === 'DELIVERED')) {
          await tx.applicationStatusEvent.create({ data: { emailApplicationId: row.id, fromState: 'NOT_SENT', toState: 'SENT', evidence: 'PROVIDER_ACCEPTED', note: 'E-poçt xidməti qəbul etdi' } });
        }
      });
      return 'provider_accepted';
    }
    if (result.kind === 'rejected') {
      await this.prisma.emailSendAttempt.update({ where: { id: attemptId }, data: { outcome: 'REJECTED', finishedAt, httpStatus: result.status, errorCode: result.code } });
      return this.fail(row.id, `PROVIDER_${result.code.toUpperCase()}`.slice(0, 80), finishedAt);
    }
    if (result.kind === 'retryable') {
      await this.prisma.emailSendAttempt.update({ where: { id: attemptId }, data: { outcome: 'RETRYABLE', finishedAt, httpStatus: result.status ?? null, errorCode: result.code } });
      if (row.attemptCount >= this.cfg.maxAttempts) return this.fail(row.id, 'RETRIES_EXHAUSTED', finishedAt);
      const wait = Math.max(RETRY_BACKOFF_MS[Math.min(row.attemptCount - 1, RETRY_BACKOFF_MS.length - 1)], result.retryAfterMs ?? 0);
      await this.prisma.emailApplication.updateMany({ where: { id: row.id, deliveryState: 'SENDING' }, data: { deliveryState: 'QUEUED', lockedAt: null, nextAttemptAt: new Date(finishedAt.getTime() + wait), holdReason: 'RETRY_SCHEDULED', failureCode: result.code.slice(0, 80) } });
      return 'retry_scheduled';
    }
    await this.prisma.emailSendAttempt.update({ where: { id: attemptId }, data: { outcome: 'AMBIGUOUS', finishedAt, httpStatus: result.status ?? null, errorCode: result.code } });
    return this.uncertain(row.id, result.code, finishedAt);
  }

  private async uncertain(id: string, code: string, at: Date): Promise<SendResult> {
    await this.prisma.emailApplication.updateMany({
      where: { id, deliveryState: 'SENDING' },
      data: { deliveryState: 'UNCERTAIN', uncertainAt: at, lockedAt: null, failureCode: code.slice(0, 80), nextAttemptAt: null },
    });
    return 'uncertain';
  }

  private async fail(id: string, code: string, at: Date): Promise<SendResult> {
    await this.prisma.emailApplication.updateMany({ where: { id, deliveryState: 'SENDING' }, data: { deliveryState: 'FAILED', failedAt: at, failureCode: code, lockedAt: null, nextAttemptAt: null, holdReason: null } });
    return 'failed';
  }

  private async cancel(id: string, at: Date, reason = 'CANDIDATE_CANCELLED'): Promise<SendResult> {
    await this.prisma.emailApplication.updateMany({ where: { id, deliveryState: 'SENDING' }, data: { deliveryState: 'CANCELLED', cancelledAt: at, lockedAt: null, nextAttemptAt: null, holdReason: null, failureCode: reason } });
    return 'cancelled';
  }

  /** Back to the queue without using an attempt: the reason is shown to the candidate. */
  private async hold(id: string, reason: string, until: Date): Promise<SendResult> {
    await this.prisma.emailApplication.updateMany({ where: { id, deliveryState: 'SENDING' }, data: { deliveryState: 'QUEUED', lockedAt: null, nextAttemptAt: until, holdReason: reason, attemptCount: { decrement: 1 } } });
    return 'held';
  }

  /** After a crash mid-send: a provider call that may have started is uncertain; one that never started is not. */
  private async recoverFromCrash(id: string, now: Date): Promise<SendResult> {
    const row = await this.prisma.emailApplication.findUnique({ where: { id }, select: { generation: true, deliveryState: true } });
    if (!row || row.deliveryState !== 'SENDING') return 'skipped';
    const pending = await this.prisma.emailSendAttempt.findFirst({ where: { emailApplicationId: id, generation: row.generation, outcome: 'PENDING' } });
    if (pending) {
      await this.prisma.emailSendAttempt.update({ where: { id: pending.id }, data: { outcome: 'AMBIGUOUS', finishedAt: now, errorCode: 'worker_interrupted' } });
      return this.uncertain(id, 'worker_interrupted', now);
    }
    return this.hold(id, 'WORKER_INTERRUPTED', new Date(now.getTime() + HOLD_MS));
  }

  /** Releases a claim whose worker disappeared. Never re-sends: see recoverFromCrash. */
  async reclaimStale(now = new Date()): Promise<number> {
    const stale = await this.prisma.emailApplication.findMany({ where: { deliveryState: 'SENDING', lockedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } }, select: { id: true } });
    for (const { id } of stale) await this.recoverFromCrash(id, now);
    return stale.length;
  }

  /** Queued applications that are due, oldest first. */
  async dueIds(now = new Date(), limit = 50): Promise<{ id: string; generation: number; attemptCount: number }[]> {
    return this.prisma.emailApplication.findMany({
      where: { deliveryState: 'QUEUED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      orderBy: { nextAttemptAt: 'asc' }, take: limit, select: { id: true, generation: true, attemptCount: true },
    });
  }
}
