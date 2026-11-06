import { premiumEmailAccess, senderAlias } from './email-premium';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, type EmailApplication, type Job, type RecruitmentState } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { LocalStorageService } from '../resumes/local-storage.service';
import { FeatureFlagsService } from '../operations/feature-flags.service';
import { isJobActionable } from '../jobs/jobs.service';
import { applicationInstructionBlock, needsExtraMaterial, type ApplicationEmailEvidence } from '../jobs/job-facts';
import { EMAIL_APPLY_CONFIG } from './email-apply.tokens';
import { EmailAllowanceService } from './email-allowance.service';
import { recipientAllowed, type EmailApplyConfig } from './email-apply.config';
import { CANCELLABLE_STATES, CONSENT_VERSION, LIVE_STATES, canTransition, payloadHash, payloadPartsOf, sha256Hex } from './email-application-state';
import { MAX_BODY_CHARS, MAX_CV_BYTES, MAX_SUBJECT_CHARS, attachmentName, buildDraft, cleanBody, letterAttachmentName, singleLine, EXTRA_REQUIREMENTS } from './email-application-draft';

export const EMAIL_APPLICATION_QUEUE = 'email-application';

/** How many times a candidate may re-send one application whose outcome stayed unknown. Each re-send may be a duplicate at the employer. */
export const MAX_UNCERTAIN_RETRIES = 2;

export type Ineligible = 'FEATURE_DISABLED' | 'JOB_NOT_OPEN' | 'LISTING_STALE' | 'NO_EMAIL_APPLICATION' | 'RECIPIENT_SUPPRESSED';

interface ResolvedCv {
  resumeId: string;
  kind: 'base' | 'tailored';
  fileName: string;
  mimeType: string;
  sha256: string;
  bytes: number;
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const isValidTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$|^UTC$/.test(zone);
  } catch {
    return false;
  }
};

@Injectable()
export class EmailApplicationsService {
  private readonly logger = new Logger(EmailApplicationsService.name);

  constructor(
    private prisma: PrismaService,
    private storage: LocalStorageService,
    private flags: FeatureFlagsService,
    @Inject(EMAIL_APPLY_CONFIG) private cfg: EmailApplyConfig,
    @InjectQueue(EMAIL_APPLICATION_QUEUE) private queue: Queue,
    private allowance: EmailAllowanceService,
  ) {}

  // ── Capabilities and eligibility ──────────────────────────────────────────
  async allowanceFor(userId: string) {
    return { ...(await this.allowance.view(userId)), dailyLimit: this.cfg.userDailyLimit };
  }

  async capabilities(userId: string) {
    const [paused, settings] = await Promise.all([
      this.flags.isPaused('email_apply.sending'),
      this.prisma.emailApplySettings.findUnique({ where: { userId } }),
    ]);
    return {
      enabled: this.cfg.enabled,
      // In sink mode nothing leaves this machine; the UI says so.
      testMode: this.cfg.transport === 'sink',
      emergencyPaused: paused,
      sendingPaused: !!settings?.sendingPausedAt,
      automationAvailable: this.cfg.enabled && this.cfg.automationEnabled && (await premiumEmailAccess(this.prisma, userId)).included,
      // Background preparation for the candidate's review sends nothing itself, so it needs only e-mail applications and Premium.
      reviewQueueAvailable: this.cfg.enabled && (await premiumEmailAccess(this.prisma, userId)).included,
      automationPremiumRequired: !(await premiumEmailAccess(this.prisma, userId)).included,
      inboundEnabled: this.cfg.enabled && this.cfg.inboundEnabled,
    };
  }

  private async suppressed(email: string) {
    return !!(await this.prisma.emailSuppression.findUnique({ where: { email: email.trim().toLowerCase() } }));
  }

  async eligibility(userId: string, jobId: string) {
    if (!this.cfg.enabled) return { eligible: false as const, reason: 'FEATURE_DISABLED' as Ineligible };
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    const reason = job ? await this.ineligibleReason(job) : 'JOB_NOT_OPEN';
    const existing = job ? await this.prisma.emailApplication.findUnique({ where: { userId_jobId: { userId, jobId } }, select: { id: true, deliveryState: true } }) : null;
    return { eligible: !reason, ...(reason ? { reason } : {}), ...(existing ? { existing } : {}) };
  }

  /** A listing no import has seen for `listingMaxAgeDays` is not trusted to still be open, even if nothing has closed it. */
  private listingStale(job: Pick<Job, 'lastSeenAt'>, now = new Date()): boolean {
    return now.getTime() - job.lastSeenAt.getTime() > this.cfg.listingMaxAgeDays * 24 * 3600_000;
  }

  private async ineligibleReason(job: Job): Promise<Ineligible | null> {
    if (!isJobActionable(job)) return 'JOB_NOT_OPEN';
    if (this.listingStale(job)) return 'LISTING_STALE';
    if (job.applicationMethod !== 'EMAIL' || !job.applicationEmail || !job.applicationEmailEvidence) return 'NO_EMAIL_APPLICATION';
    if (await this.suppressed(job.applicationEmail)) return 'RECIPIENT_SUPPRESSED';
    return null;
  }

  /** This posting plus every posting linked to it as a cross-source repeat of the same vacancy. */
  private async sameVacancyIds(job: Job): Promise<string[]> {
    const primaryId = job.duplicateOfId ?? job.id;
    const linked = await this.prisma.job.findMany({ where: { OR: [{ id: primaryId }, { duplicateOfId: primaryId }] }, select: { id: true } });
    return [...new Set([job.id, primaryId, ...linked.map((j) => j.id)])];
  }

  /** An application to any listing of the same vacancy counts: a repeat listing must not produce a second application. */
  private async assertNoApplicationToSameVacancy(userId: string, job: Job, exceptId?: string, db: Pick<PrismaService, 'emailApplication' | 'job'> = this.prisma) {
    const clash = await db.emailApplication.findFirst({
      where: {
        userId, deliveryState: { in: [...LIVE_STATES] }, ...(exceptId ? { id: { not: exceptId } } : {}),
        // Linked repeats, or (links can be released when a primary closes) the same title sent to the same address.
        OR: [{ jobId: { in: await this.sameVacancyIds(job) } }, { recipient: job.applicationEmail ?? '', jobTitle: { equals: job.title, mode: 'insensitive' } }],
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`Siz artıq bu vakansiyaya müraciət etmisiniz. (ALREADY_APPLIED:${clash.id})`);
    // The browser agent is another route to the same vacancy: a live agent application for it counts as having applied.
    const agent = await db.job.findFirst({ where: { id: { in: await this.sameVacancyIds(job) }, agentApplications: { some: { userId, state: { in: ['QUEUED', 'PREPARING', 'AWAITING_INPUT', 'READY', 'SUBMITTING', 'SUBMITTED', 'UNCERTAIN'] } } } }, select: { id: true } });
    if (agent) throw new ConflictException('Siz artıq bu vakansiyaya brauzer agenti ilə müraciət edirsiniz. (ALREADY_APPLIED:AGENT)');
  }

  private requireEnabled() {
    if (!this.cfg.enabled) throw new ForbiddenException('E-poçtla müraciət bu mühitdə aktiv deyil. (FEATURE_DISABLED)');
  }

  // ── Document selection (CV and optional motivation letter) ────────────────
  /**
   * The CV must be the candidate's own, finished and usable. A tailored CV must
   * also be approved by the candidate and made for this very vacancy; someone
   * else's CV id is indistinguishable from a missing one. A letter is never a CV.
   */
  private async resolveCv(userId: string, job: Job, resumeId?: string): Promise<ResolvedCv> {
    const select = { id: true, isBase: true, docKind: true, status: true, fileUrl: true, reviewedAt: true, match: { select: { jobId: true } } } as const;
    let resume;
    if (resumeId) {
      resume = await this.prisma.resume.findFirst({ where: { id: resumeId, userId }, select });
      if (!resume) throw new NotFoundException('CV tapılmadı');
      if (resume.docKind === 'LETTER') throw new BadRequestException('Motivasiya məktubu CV kimi göndərilə bilməz. (WRONG_DOCUMENT_KIND)');
    } else {
      resume =
        (await this.prisma.resume.findFirst({
          where: { userId, isBase: false, docKind: { not: 'LETTER' }, status: 'READY', reviewedAt: { not: null }, fileUrl: { not: null }, match: { jobId: job.id } },
          orderBy: { createdAt: 'desc' },
          select,
        })) ??
        (await this.prisma.resume.findFirst({ where: { userId, isBase: true, status: 'READY', fileUrl: { not: null } }, orderBy: { createdAt: 'desc' }, select }));
      if (!resume) throw new BadRequestException('Müraciət üçün əvvəlcə CV yükləyin. (NO_CV)');
    }
    if (resume.status !== 'READY' || !resume.fileUrl) throw new BadRequestException('Bu CV hazır deyil və göndərilə bilməz. (CV_NOT_READY)');
    if (!resume.isBase && (!resume.reviewedAt || resume.match?.jobId !== job.id)) {
      throw new BadRequestException('Fərdiləşdirilmiş CV bu vakansiya üçün təsdiqlənməyib. (CV_NOT_APPROVED)');
    }
    return this.readApproved(userId, resume.id, resume.fileUrl, 'cv', resume.isBase ? 'base' : 'tailored');
  }

  /**
   * An approved motivation letter written for THIS vacancy. It must be the candidate's own, READY (approved), and the file must be the one the
   * candidate approved (the APPROVED snapshot's SHA-256), so an edited or regenerated letter can never be attached under an old approval.
   */
  private async resolveLetter(userId: string, job: Job, letterId: string): Promise<ResolvedCv> {
    const letter = await this.prisma.resume.findFirst({
      where: { id: letterId, userId, isBase: false },
      select: { id: true, docKind: true, status: true, fileUrl: true, reviewedAt: true, match: { select: { jobId: true } } },
    });
    if (!letter) throw new NotFoundException('Motivasiya məktubu tapılmadı');
    if (letter.docKind !== 'LETTER') throw new BadRequestException('Seçilmiş sənəd motivasiya məktubu deyil. (WRONG_DOCUMENT_KIND)');
    if (letter.status !== 'READY' || !letter.fileUrl || !letter.reviewedAt) throw new BadRequestException('Motivasiya məktubu təsdiqlənməyib. (LETTER_NOT_APPROVED)');
    if (letter.match?.jobId !== job.id) throw new BadRequestException('Motivasiya məktubu bu vakansiya üçün yazılmayıb. (LETTER_WRONG_JOB)');
    return this.readApproved(userId, letter.id, letter.fileUrl, 'letter', 'tailored');
  }

  private async readApproved(userId: string, resumeId: string, fileUrl: string, role: 'cv' | 'letter', kind: 'base' | 'tailored'): Promise<ResolvedCv> {
    let bytes: Buffer;
    try {
      bytes = await this.storage.readUpload(fileUrl);
    } catch {
      throw new BadRequestException(role === 'cv' ? 'CV faylı tapılmadı. CV-nizi yenidən yükləyin. (CV_FILE_MISSING)' : 'Motivasiya məktubunun faylı tapılmadı. (LETTER_FILE_MISSING)');
    }
    if (bytes.length === 0 || bytes.length > MAX_CV_BYTES) throw new BadRequestException(role === 'cv' ? 'CV faylının ölçüsü uyğun deyil. (CV_SIZE)' : 'Motivasiya məktubunun ölçüsü uyğun deyil. (LETTER_SIZE)');
    const sha256 = sha256Hex(bytes);
    // A document generated here has an append-only approval history: the file must be one the candidate approved.
    const approvals = await this.prisma.documentSnapshot.findMany({ where: { resumeId, kind: 'APPROVED' }, select: { fileSha256: true } });
    if (approvals.length && !approvals.some((a) => a.fileSha256 === sha256)) {
      throw new BadRequestException(role === 'cv' ? 'CV-nin bu faylı təsdiqlənmiş versiya deyil. (CV_NOT_APPROVED)' : 'Motivasiya məktubunun bu faylı təsdiqlənmiş versiya deyil. (LETTER_NOT_APPROVED)');
    }
    const ext = fileUrl.endsWith('.docx') ? '.docx' : '.pdf';
    return { resumeId, kind, fileName: '', mimeType: role === 'letter' ? MIME['.pdf'] : MIME[ext], sha256, bytes: bytes.length };
  }

  private async sender(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
    if (!user.emailVerified) throw new ForbiddenException('Müraciət göndərmək üçün e-poçt ünvanınızı təsdiqləyin. (EMAIL_NOT_VERIFIED)');
    const name = singleLine(user.name ?? '');
    if (!name) throw new BadRequestException('Müraciət üçün profilinizdə adınız olmalıdır. (NAME_REQUIRED)');
    return { user, name };
  }

  // ── Prepare / edit / preview ──────────────────────────────────────────────
  async prepare(userId: string, jobId: string, dto: { resumeId?: string; letterId?: string }, options: { automatic?: { body: string }; agent?: { body?: string } } = {}) {
    this.requireEnabled();
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Vakansiya tapılmadı');
    const reason = await this.ineligibleReason(job);
    if (reason) throw new ConflictException(`Bu vakansiyaya e-poçtla müraciət mümkün deyil. (${reason})`);
    // The CV is checked first: a new candidate with no CV needs to hear that before anything about their profile.
    const cv = await this.resolveCv(userId, job, dto.resumeId);
    const { user, name } = await this.sender(userId);
    const evidence = job.applicationEmailEvidence as unknown as ApplicationEmailEvidence;
    // What the candidate is shown (and later approves) says where the address came from: the listing page, what the posting said, and when we last saw it.
    const shownEvidence = this.evidenceOf(job, evidence);

    await this.assertNoApplicationToSameVacancy(userId, job);
    // Told before the candidate invests time in a preview: the hard check is again made at approval, under the account lock.
    // The review queue prepares without spending anything: the allowance is checked when the candidate approves, as for any draft.
    if (!options.automatic && !options.agent) await this.allowance.assertAvailable(userId);
    const existing = await this.prisma.emailApplication.findUnique({ where: { userId_jobId: { userId, jobId } } });
    // The agent never reopens or overwrites anything the candidate already has for this vacancy (a draft, a cancelled or a sent application).
    if (existing && options.agent) throw new ConflictException(`Bu vakansiya üçün müraciət artıq var. (ALREADY_EXISTS:${existing.id})`);
    if (existing && LIVE_STATES.includes(existing.deliveryState)) {
      throw new ConflictException(`Siz artıq bu vakansiyaya müraciət etmisiniz. (ALREADY_APPLIED:${existing.id})`);
    }

    cv.fileName = attachmentName(name, await this.extensionOf(userId, cv.resumeId));
    // A letter is attached only when the candidate chooses one (never by automation): either named now or already on the draft being reopened.
    const letterId = options.automatic ? undefined : dto.letterId ?? (existing?.deliveryState === 'AWAITING_APPROVAL' ? existing.letterResumeId ?? undefined : undefined);
    const letter = letterId ? await this.resolveLetter(userId, job, letterId) : null;
    if (letter) letter.fileName = letterAttachmentName(name);

    if (existing?.deliveryState === 'AWAITING_APPROVAL' && !options.automatic) {
      // Keep the candidate's edits; only the document identity can change underneath them.
      const refreshed = await this.prisma.emailApplication.update({
        where: { id: existing.id },
        data: {
          cvResumeId: cv.resumeId, cvKind: cv.kind, cvFileName: cv.fileName, cvMimeType: cv.mimeType, cvPreviewSha256: cv.sha256,
          recipientEvidence: shownEvidence as unknown as Prisma.InputJsonObject,
          instructions: applicationInstructionBlock(job.description, job.applicationEmail!) ?? evidence.excerpt,
          ...this.letterColumns(letter),
        },
      });
      return this.view(refreshed);
    }

    const draft = buildDraft({ title: job.title, description: job.description, senderName: name, evidence, savedLetter: user.profile?.defaultCoverLetter });
    // Mode B uses the letter the candidate wrote for automatic applications, never a generated one.
    if (options.automatic) draft.body = cleanBody(options.automatic.body).slice(0, MAX_BODY_CHARS);
    // The review queue uses the candidate's own template when they wrote one; otherwise the ordinary draft, which they read and edit before approving.
    if (options.agent?.body) draft.body = cleanBody(options.agent.body).slice(0, MAX_BODY_CHARS);
    const data = {
      jobTitle: job.title.slice(0, 500), jobCompany: job.company.slice(0, 256), jobUrl: job.url,
      mode: (options.automatic ? 'AUTOMATIC' : 'REVIEW_AND_SEND') as 'AUTOMATIC' | 'REVIEW_AND_SEND', deliveryState: 'AWAITING_APPROVAL' as const, recruitmentState: 'NOT_SENT' as const, holdReason: null,
      recipient: job.applicationEmail!, recipientEvidence: shownEvidence as unknown as Prisma.InputJsonObject,
      // The whole instruction block (its heading and the task before the address), not only the sentence that names the address.
      instructions: applicationInstructionBlock(job.description, job.applicationEmail!) ?? evidence.excerpt, reference: evidence.reference ?? null,
      subject: draft.subject, subjectSource: draft.subjectSource, body: draft.body, bodySha256: sha256Hex(draft.body), copyToSelf: true,
      replyTo: user.email, senderName: name,
      senderEmail: this.cfg.candidateAliasesEnabled ? await senderAlias(this.prisma, userId, name) : null,
      cvResumeId: cv.resumeId, cvKind: cv.kind, cvFileName: cv.fileName, cvMimeType: cv.mimeType, cvPreviewSha256: cv.sha256,
      ...this.letterColumns(letter),
      preparedByAgentAt: options.agent ? new Date() : null,
      cvSnapshotUrl: null, cvSha256: null, cvBytes: null, letterSnapshotUrl: null, letterSha256: null, letterBytes: null, payloadSha256: null, consentVersion: null, approvedAt: null, queuedAt: null,
      nextAttemptAt: null, lockedAt: null, attemptCount: 0, cancelRequestedAt: null, cancelledAt: null,
      providerMessageId: null, providerAcceptedAt: null, deliveredAt: null, bouncedAt: null, complainedAt: null, providerFailedAt: null,
      failedAt: null, failureCode: null, uncertainAt: null,
    };
    let row: EmailApplication;
    if (existing) {
      for (const key of [existing.cvSnapshotUrl, existing.letterSnapshotUrl]) if (key) await this.storage.deletePrivate(key).catch(() => undefined);
      row = await this.prisma.emailApplication.update({ where: { id: existing.id }, data });
    } else {
      try {
        row = await this.prisma.emailApplication.create({ data: { ...data, userId, jobId } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Müraciət artıq hazırlanır. Səhifəni yeniləyin. (ALREADY_PREPARING)');
        throw error;
      }
    }
    return this.view(row);
  }

  /** The listing facts shown next to the recipient: the posting's own wording plus where and when AISE saw it. */
  private evidenceOf(job: Job, evidence: ApplicationEmailEvidence) {
    return { ...evidence, sourceUrl: job.url, observedAt: job.lastSeenAt.toISOString(), listedAt: job.postedAt.toISOString() };
  }

  /** Letter columns for the preview stage (null clears them). */
  private letterColumns(letter: ResolvedCv | null) {
    return letter
      ? { letterResumeId: letter.resumeId, letterFileName: letter.fileName, letterPreviewSha256: letter.sha256 }
      : { letterResumeId: null, letterFileName: null, letterPreviewSha256: null };
  }

  private async extensionOf(userId: string, resumeId: string): Promise<'.pdf' | '.docx'> {
    const r = await this.prisma.resume.findFirstOrThrow({ where: { id: resumeId, userId }, select: { fileUrl: true } });
    return r.fileUrl?.endsWith('.docx') ? '.docx' : '.pdf';
  }

  private async owned(userId: string, id: string): Promise<EmailApplication> {
    const row = await this.prisma.emailApplication.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Müraciət tapılmadı');
    return row;
  }

  async updateDraft(userId: string, id: string, dto: { body?: string; subject?: string; resumeId?: string; letterId?: string; removeLetter?: boolean; copyToSelf?: boolean }) {
    this.requireEnabled();
    const row = await this.owned(userId, id);
    if (row.deliveryState !== 'AWAITING_APPROVAL') throw new ConflictException('Təsdiqlənmiş müraciət dəyişdirilə bilməz. (NOT_EDITABLE)');
    const data: Prisma.EmailApplicationUpdateInput = {};
    if (dto.body !== undefined) {
      const body = cleanBody(dto.body);
      if (!body || body.length > MAX_BODY_CHARS) throw new BadRequestException(`Məktub 1–${MAX_BODY_CHARS} simvol olmalıdır. (BODY_LENGTH)`);
      data.body = body;
      data.bodySha256 = sha256Hex(body);
    }
    if (dto.subject !== undefined) {
      if (row.subjectSource === 'published') throw new BadRequestException('Vakansiyada göstərilən mövzu dəyişdirilə bilməz. (SUBJECT_LOCKED)');
      const subject = singleLine(dto.subject);
      if (!subject || subject.length > MAX_SUBJECT_CHARS) throw new BadRequestException(`Mövzu 1–${MAX_SUBJECT_CHARS} simvol olmalıdır. (SUBJECT_LENGTH)`);
      data.subject = subject;
      data.subjectSource = 'candidate';
    }
    if (dto.copyToSelf !== undefined) data.copyToSelf = !!dto.copyToSelf;
    if (dto.resumeId !== undefined) {
      const job = row.jobId ? await this.prisma.job.findUnique({ where: { id: row.jobId } }) : null;
      if (!job) throw new ConflictException('Vakansiya artıq mövcud deyil. (JOB_GONE)');
      const cv = await this.resolveCv(userId, job, dto.resumeId);
      data.cvResumeId = cv.resumeId;
      data.cvKind = cv.kind;
      data.cvMimeType = cv.mimeType;
      data.cvPreviewSha256 = cv.sha256;
      data.cvFileName = attachmentName(row.senderName, (await this.extensionOf(userId, cv.resumeId)));
    }
    if (dto.letterId !== undefined || dto.removeLetter) {
      if (dto.letterId !== undefined && dto.removeLetter) throw new BadRequestException('Məktubu eyni anda həm əlavə, həm də silmək olmaz. (LETTER_CONFLICT)');
      if (dto.removeLetter) Object.assign(data, this.letterColumns(null));
      else {
        const job = row.jobId ? await this.prisma.job.findUnique({ where: { id: row.jobId } }) : null;
        if (!job) throw new ConflictException('Vakansiya artıq mövcud deyil. (JOB_GONE)');
        const letter = await this.resolveLetter(userId, job, dto.letterId!);
        letter.fileName = letterAttachmentName(row.senderName);
        Object.assign(data, this.letterColumns(letter));
      }
    }
    // Only a draft the candidate still holds is edited, and never after approval.
    const updated = await this.prisma.emailApplication.updateMany({ where: { id, userId, deliveryState: 'AWAITING_APPROVAL' }, data: data as Prisma.EmailApplicationUpdateManyMutationInput });
    if (!updated.count) throw new ConflictException('Müraciətin vəziyyəti dəyişdi. Səhifəni yeniləyin. (STATE_CHANGED)');
    return this.view(await this.owned(userId, id));
  }

  // ── Approval ──────────────────────────────────────────────────────────────
  async approve(userId: string, id: string, dto: { payloadSha256: string; consent: boolean; instructionsAcknowledged?: boolean }) {
    this.requireEnabled();
    if (dto.consent !== true) throw new BadRequestException('Göndərməyə razılıq verilməyib. (CONSENT_REQUIRED)');
    const row = await this.owned(userId, id);
    if (row.deliveryState !== 'AWAITING_APPROVAL') throw new ConflictException('Bu müraciət artıq təsdiqlənib və ya ləğv edilib. (NOT_AWAITING_APPROVAL)');
    if (row.mode !== 'REVIEW_AND_SEND') throw new ConflictException('Avtomatik müraciət əl ilə təsdiqlənmir. (AUTOMATIC)');
    if (row.instructions && dto.instructionsAcknowledged !== true) throw new BadRequestException('Vakansiyanın müraciət göstərişlərini oxuduğunuzu təsdiqləyin. (INSTRUCTIONS_REQUIRED)');
    return this.approveCore(userId, row, dto.payloadSha256);
  }

  /** Mode B: the candidate's advance consent and rules stand in for the click; every other check is identical. */
  async approveAutomatic(userId: string, id: string) {
    this.requireEnabled();
    if (!(await premiumEmailAccess(this.prisma, userId)).included) throw new ForbiddenException('Avtomatik müraciət Premium planına daxildir. (PLAN_REQUIRED)');
    const row = await this.owned(userId, id);
    if (row.mode !== 'AUTOMATIC' || row.deliveryState !== 'AWAITING_APPROVAL') throw new ConflictException('Bu müraciət avtomatik göndərilə bilməz. (NOT_AUTOMATIC)');
    return this.approveCore(userId, row, payloadHash(payloadPartsOf(row, 'preview')));
  }

  private async approveCore(userId: string, row: EmailApplication, expectedPreviewHash: string) {
    const id = row.id;
    // What the candidate saw is what is approved: any change since the preview is refused.
    const previewHash = payloadHash(payloadPartsOf(row, 'preview'));
    if (expectedPreviewHash !== previewHash) throw new ConflictException('Müraciət önizləmədən sonra dəyişdi. Yenidən baxın. (PREVIEW_STALE)');

    const job = row.jobId ? await this.prisma.job.findUnique({ where: { id: row.jobId } }) : null;
    const reason = job ? await this.ineligibleReason(job) : 'JOB_NOT_OPEN';
    if (reason) throw new ConflictException(`Bu vakansiyaya artıq müraciət göndərilə bilməz. (${reason})`);
    await this.assertNoApplicationToSameVacancy(userId, job!, id);
    if (!recipientAllowed(this.cfg, row.recipient)) throw new ForbiddenException('Bu ünvana göndərmək hələ icazəli deyil. (RECIPIENT_NOT_AUTHORIZED)');
    await this.assertUserWithinDailyLimit(userId);

    // The snapshots are what is sent. Each must be byte-identical to the file that was previewed.
    const cv = await this.resolveCv(userId, job!, row.cvResumeId ?? undefined);
    if (cv.sha256 !== row.cvPreviewSha256) throw new ConflictException('CV önizləmədən sonra dəyişdi. Yenidən baxın. (CV_CHANGED)');
    const letter = row.letterResumeId ? await this.resolveLetter(userId, job!, row.letterResumeId) : null;
    if (letter && letter.sha256 !== row.letterPreviewSha256) throw new ConflictException('Motivasiya məktubu önizləmədən sonra dəyişdi. Yenidən baxın. (LETTER_CHANGED)');
    const resume = await this.prisma.resume.findFirstOrThrow({ where: { id: cv.resumeId, userId }, select: { fileUrl: true } });
    const letterResume = letter ? await this.prisma.resume.findFirstOrThrow({ where: { id: letter.resumeId, userId }, select: { fileUrl: true } }) : null;
    const snapshotKey = await this.storage.copyToPrivate(resume.fileUrl!);
    let letterKey: string | null = null;
    try {
      const snapshot = await this.storage.readPrivate(snapshotKey);
      if (sha256Hex(snapshot) !== row.cvPreviewSha256) throw new ConflictException('CV önizləmədən sonra dəyişdi. Yenidən baxın. (CV_CHANGED)');
      let letterSnapshot: Buffer | null = null;
      if (letterResume) {
        letterKey = await this.storage.copyToPrivate(letterResume.fileUrl!);
        letterSnapshot = await this.storage.readPrivate(letterKey);
        if (sha256Hex(letterSnapshot) !== row.letterPreviewSha256) throw new ConflictException('Motivasiya məktubu önizləmədən sonra dəyişdi. Yenidən baxın. (LETTER_CHANGED)');
      }
      const approvedHash = payloadHash({ ...payloadPartsOf(row, 'preview'), cvSha256: sha256Hex(snapshot), ...(letterSnapshot ? { letterSha256: sha256Hex(letterSnapshot), letterFileName: row.letterFileName } : {}) });
      const now = new Date();
      const approved = await this.prisma.$transaction(async (tx) => {
        // Serialises concurrent approvals by one candidate so two listings of one vacancy cannot both pass the check.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`ea-user:${userId}`}))`;
        await this.assertNoApplicationToSameVacancy(userId, job!, id, tx);
        // Exact under the lock: two approvals racing for the last unit cannot both pass. This row is not holding a unit yet (AWAITING_APPROVAL).
        await this.allowance.assertAvailable(userId, now, tx);
        return tx.emailApplication.updateMany({
        // The same fields the candidate saw: if anything moved, nothing is queued.
        where: { id, userId, deliveryState: 'AWAITING_APPROVAL', subject: row.subject, bodySha256: row.bodySha256, cvPreviewSha256: row.cvPreviewSha256, copyToSelf: row.copyToSelf, letterPreviewSha256: row.letterPreviewSha256 },
        data: {
          deliveryState: 'QUEUED', approvedAt: now, queuedAt: now, nextAttemptAt: now, consentVersion: CONSENT_VERSION, generation: { increment: 1 },
          attemptCount: 0, holdReason: null, cvSnapshotUrl: snapshotKey, cvSha256: sha256Hex(snapshot), cvBytes: snapshot.length, payloadSha256: approvedHash,
          ...(letterSnapshot ? { letterSnapshotUrl: letterKey, letterSha256: sha256Hex(letterSnapshot), letterBytes: letterSnapshot.length } : {}),
        },
      });
      });
      if (!approved.count) throw new ConflictException('Müraciətin vəziyyəti dəyişdi. Səhifəni yeniləyin. (STATE_CHANGED)');
    } catch (error) {
      await this.storage.deletePrivate(snapshotKey).catch(() => undefined);
      if (letterKey) await this.storage.deletePrivate(letterKey).catch(() => undefined);
      throw error;
    }
    await this.enqueue(id).catch((error) => this.logger.warn(`Queue add failed for ${id}; the sweeper will pick it up: ${error instanceof Error ? error.message : error}`));
    return this.view(await this.owned(userId, id));
  }

  /** The database row is the durable queue; this only wakes a worker sooner. A repeat add is a no-op. */
  async enqueue(id: string): Promise<void> {
    const row = await this.prisma.emailApplication.findUnique({ where: { id }, select: { generation: true, attemptCount: true } });
    if (!row) return;
    // Finished jobs are dropped at once so a later retry is never mistaken for a finished one; double-claims are impossible anyway.
    await this.queue.add('send', { id }, { jobId: `ea-${id}-${row.generation}-${row.attemptCount}`, removeOnComplete: true, removeOnFail: true });
  }

  private async assertUserWithinDailyLimit(userId: string) {
    const since = new Date(Date.now() - 24 * 3600_000);
    const used = await this.prisma.emailApplication.count({ where: { userId, deliveryState: { in: ['QUEUED', 'SENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'UNCERTAIN', 'BOUNCED', 'COMPLAINED'] }, approvedAt: { gte: since } } });
    if (used >= this.cfg.userDailyLimit) throw new ConflictException(`Gündəlik müraciət limiti (${this.cfg.userDailyLimit}) dolub. (DAILY_LIMIT)`);
  }

  // ── Cancel / uncertain / views ────────────────────────────────────────────
  async cancel(userId: string, id: string) {
    const row = await this.owned(userId, id);
    if (CANCELLABLE_STATES.includes(row.deliveryState)) {
      const cancelled = await this.prisma.emailApplication.updateMany({ where: { id, userId, deliveryState: { in: [...CANCELLABLE_STATES] } }, data: { deliveryState: 'CANCELLED', cancelledAt: new Date(), holdReason: null, cvSnapshotUrl: null, letterSnapshotUrl: null } });
      if (cancelled.count) {
        for (const key of [row.cvSnapshotUrl, row.letterSnapshotUrl]) if (key) await this.storage.deletePrivate(key).catch(() => undefined);
        return this.view(await this.owned(userId, id));
      }
    }
    // A worker holds it right now: it re-checks this flag immediately before calling the provider.
    const requested = await this.prisma.emailApplication.updateMany({ where: { id, userId, deliveryState: 'SENDING' }, data: { cancelRequestedAt: new Date() } });
    if (requested.count) return { ...(await this.view(await this.owned(userId, id))), cancelRequested: true };
    throw new ConflictException('Bu müraciət artıq göndərilib və ləğv edilə bilməz. (ALREADY_SENT)');
  }

  /** The candidate decides what to do with an outcome nobody could confirm. */
  async retryUncertain(userId: string, id: string, dto: { acknowledgeDuplicateRisk: boolean }) {
    this.requireEnabled();
    const row = await this.owned(userId, id);
    if (row.deliveryState !== 'UNCERTAIN') throw new ConflictException('Yalnız qeyri-müəyyən müraciət yenidən göndərilə bilər. (NOT_UNCERTAIN)');
    if (dto.acknowledgeDuplicateRisk !== true) throw new BadRequestException('Təkrar göndərmə riskini təsdiqləyin. (RISK_NOT_ACKNOWLEDGED)');
    if (row.uncertainRetries >= MAX_UNCERTAIN_RETRIES) throw new ConflictException(`Bu müraciət ${MAX_UNCERTAIN_RETRIES} dəfə təkrar göndərilib və nəticə hələ də bəlli deyil. Təkrar göndərmək mümkün deyil; işəgötürənlə birbaşa əlaqə saxlayın. (RETRY_LIMIT)`);
    if (!recipientAllowed(this.cfg, row.recipient) || (await this.suppressed(row.recipient))) throw new ForbiddenException('Bu ünvana göndərmək mümkün deyil. (RECIPIENT_BLOCKED)');
    const now = new Date();
    // Same approval generation while the provider still remembers the idempotency key: a repeat of an accepted message is recognised there.
    // The provider remembers a key for 24 h from the attempt whose outcome is unknown (not from approval); 4 h of margin.
    const withinWindow = !!row.uncertainAt && now.getTime() - row.uncertainAt.getTime() < 20 * 3600_000;
    const queued = await this.prisma.emailApplication.updateMany({
      where: { id, userId, deliveryState: 'UNCERTAIN', uncertainRetries: row.uncertainRetries, generation: row.generation },
      data: { deliveryState: 'QUEUED', nextAttemptAt: now, attemptCount: 0, holdReason: null, uncertainRetries: { increment: 1 }, ...(withinWindow ? {} : { generation: { increment: 1 } }) },
    });
    if (!queued.count) throw new ConflictException('Müraciətin vəziyyəti dəyişdi. (STATE_CHANGED)');
    await this.enqueue(id).catch(() => undefined);
    return this.view(await this.owned(userId, id));
  }

  async list(userId: string) {
    const rows = await this.prisma.emailApplication.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((row) => this.summary(row));
  }

  async get(userId: string, id: string) {
    const row = await this.owned(userId, id);
    const history = await this.prisma.applicationStatusEvent.findMany({ where: { emailApplicationId: id }, orderBy: { createdAt: 'asc' } });
    const replies = this.cfg.inboundEnabled ? await this.prisma.emailInboundMessage.findMany({ where: { emailApplicationId: id }, orderBy: { receivedAt: 'desc' }, take: 20 }) : [];
    // The latest recruitment change and who vouches for it. Delivery evidence (provider) and recruitment outcomes are separate facts: an outcome is
    // candidate-reported unless the candidate confirmed it from a reply that actually arrived at the tracking address (then it is backed by that
    // employer message, which is the only thing "employerConfirmed" means). Provider events can never produce an interview, offer or rejection.
    const latest = history.length ? history[history.length - 1] : null;
    const recruitment = { state: row.recruitmentState, evidence: latest?.evidence ?? null, employerConfirmed: latest?.evidence === 'REPLY_CONFIRMED_BY_CANDIDATE' && latest.toState === row.recruitmentState };
    return { ...this.view(row), recruitment, history: history.map((h) => ({ id: h.id, from: h.fromState, to: h.toState, evidence: h.evidence, note: h.note, at: h.createdAt })), replies: replies.map((r) => ({ id: r.id, subject: r.subject, receivedAt: r.receivedAt, suggestedState: r.suggestedState, suggestionReason: r.suggestionReason, status: r.status, attachmentCount: r.attachmentCount })) };
  }

  /** The candidate's own sent (or about-to-be-sent) document, never anyone else's. `role` is the attachment: the CV or the motivation letter. */
  async cvDownload(userId: string, id: string, role: 'cv' | 'letter' = 'cv'): Promise<{ bytes: Buffer; fileName: string; mimeType: string }> {
    const row = await this.owned(userId, id);
    const snapshot = role === 'cv' ? row.cvSnapshotUrl : row.letterSnapshotUrl;
    const resumeId = role === 'cv' ? row.cvResumeId : row.letterResumeId;
    let bytes: Buffer;
    if (snapshot) bytes = await this.storage.readPrivate(snapshot).catch(() => { throw new NotFoundException('Fayl tapılmadı'); });
    else if (resumeId) {
      const resume = await this.prisma.resume.findFirst({ where: { id: resumeId, userId }, select: { fileUrl: true } });
      if (!resume?.fileUrl) throw new NotFoundException('Fayl tapılmadı');
      bytes = await this.storage.readUpload(resume.fileUrl).catch(() => { throw new NotFoundException('Fayl tapılmadı'); });
    } else throw new NotFoundException('Fayl tapılmadı');
    return role === 'cv' ? { bytes, fileName: row.cvFileName, mimeType: row.cvMimeType } : { bytes, fileName: row.letterFileName ?? 'letter.pdf', mimeType: 'application/pdf' };
  }

  // ── Recruitment status (candidate controlled) ─────────────────────────────
  async updateRecruitment(
    userId: string,
    id: string,
    dto: { state?: RecruitmentState; note?: string; interviewAt?: string; interviewTimezone?: string; interviewNotes?: string; reminderOptIn?: boolean },
    evidence: 'CANDIDATE_REPORTED' | 'REPLY_CONFIRMED_BY_CANDIDATE' = 'CANDIDATE_REPORTED',
  ) {
    const row = await this.owned(userId, id);
    if (row.deliveryState === 'AWAITING_APPROVAL' || row.deliveryState === 'DRAFT' || row.deliveryState === 'CANCELLED' || row.deliveryState === 'QUEUED' || row.deliveryState === 'SENDING') {
      throw new ConflictException('Müraciət hələ göndərilməyib. (NOT_SENT_YET)');
    }
    const target = dto.state ?? row.recruitmentState;
    // An unconfirmed delivery may be corrected by the candidate only because a reply proves it arrived.
    const fromNotSent = row.recruitmentState === 'NOT_SENT';
    if (dto.state && dto.state !== row.recruitmentState) {
      const allowed = fromNotSent ? row.deliveryState === 'UNCERTAIN' && dto.state !== 'SENT' && dto.state !== 'NOT_SENT' && dto.state !== 'WITHDRAWN' : canTransition(row.recruitmentState, dto.state);
      if (!allowed) throw new BadRequestException('Bu status dəyişikliyi mümkün deyil. (INVALID_TRANSITION)');
    }
    const data: Prisma.EmailApplicationUpdateManyMutationInput = {};
    if (target === 'INTERVIEW_SCHEDULED' || dto.interviewAt !== undefined) {
      const at = dto.interviewAt ?? row.interviewAt?.toISOString();
      const zone = dto.interviewTimezone ?? row.interviewTimezone ?? undefined;
      if (!at || !zone) throw new BadRequestException('Müsahibə tarixi və saat qurşağı tələb olunur. (INTERVIEW_DETAILS_REQUIRED)');
      const when = new Date(at);
      if (Number.isNaN(when.getTime()) || !isValidTimeZone(zone)) throw new BadRequestException('Müsahibə tarixi və ya saat qurşağı yanlışdır. (INTERVIEW_INVALID)');
      data.interviewAt = when;
      data.interviewTimezone = zone;
      data.reminderSentAt = null;
    }
    if (dto.interviewNotes !== undefined) data.interviewNotes = cleanBody(dto.interviewNotes).slice(0, 2000) || null;
    if (dto.reminderOptIn !== undefined) data.reminderOptIn = !!dto.reminderOptIn;
    if (dto.state && dto.state !== row.recruitmentState) data.recruitmentState = dto.state;
    const note = dto.note ? cleanBody(dto.note).slice(0, 1000) : null;

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.emailApplication.updateMany({ where: { id, userId, recruitmentState: row.recruitmentState }, data });
      if (!changed.count) throw new ConflictException('Status artıq dəyişib. Səhifəni yeniləyin. (STATE_CHANGED)');
      if (dto.state && dto.state !== row.recruitmentState) {
        await tx.applicationStatusEvent.create({ data: { emailApplicationId: id, fromState: row.recruitmentState, toState: dto.state, evidence, note } });
      }
    });
    return this.get(userId, id);
  }

  /** A suggestion (for example from a reply) changes nothing until the candidate confirms it. */
  async confirmReplySuggestion(userId: string, id: string, replyId: string, dto: { accept: boolean; state?: RecruitmentState; interviewAt?: string; interviewTimezone?: string }) {
    const reply = await this.prisma.emailInboundMessage.findFirst({ where: { id: replyId, emailApplicationId: id, emailApplication: { userId } } });
    if (!reply) throw new NotFoundException('Cavab tapılmadı');
    if (reply.status !== 'PENDING_REVIEW') throw new ConflictException('Bu cavab artıq nəzərdən keçirilib. (ALREADY_REVIEWED)');
    if (dto.accept) {
      const state = dto.state ?? reply.suggestedState;
      if (!state) throw new BadRequestException('Status seçin. (STATE_REQUIRED)');
      await this.updateRecruitment(userId, id, { state, interviewAt: dto.interviewAt, interviewTimezone: dto.interviewTimezone }, 'REPLY_CONFIRMED_BY_CANDIDATE');
    }
    await this.prisma.emailInboundMessage.update({ where: { id: replyId }, data: { status: dto.accept ? 'CONFIRMED' : 'DISMISSED' } });
    return this.get(userId, id);
  }

  // ── Candidate controls ────────────────────────────────────────────────────
  async settings(userId: string) {
    const s = await this.prisma.emailApplySettings.findUnique({ where: { userId } });
    return { sendingPausedAt: s?.sendingPausedAt ?? null, consentRevokedAt: s?.consentRevokedAt ?? null, automationEnabled: !!s?.automationEnabled };
  }

  /** While paused nothing of theirs is sent; queued applications wait and are not lost. */
  async pause(userId: string) {
    await this.prisma.emailApplySettings.upsert({ where: { userId }, create: { userId, sendingPausedAt: new Date() }, update: { sendingPausedAt: new Date() } });
    return this.settings(userId);
  }

  async resume(userId: string) {
    await this.prisma.emailApplySettings.upsert({ where: { userId }, create: { userId }, update: { sendingPausedAt: null } });
    return this.settings(userId);
  }

  async cancelPending(userId: string) {
    const pending = await this.prisma.emailApplication.findMany({ where: { userId, deliveryState: { in: [...CANCELLABLE_STATES] } }, select: { id: true, cvSnapshotUrl: true, letterSnapshotUrl: true } });
    const cancelled = await this.prisma.emailApplication.updateMany({ where: { id: { in: pending.map((p) => p.id) }, deliveryState: { in: [...CANCELLABLE_STATES] } }, data: { deliveryState: 'CANCELLED', cancelledAt: new Date(), holdReason: null, cvSnapshotUrl: null, letterSnapshotUrl: null } });
    const sending = await this.prisma.emailApplication.updateMany({ where: { userId, deliveryState: 'SENDING' }, data: { cancelRequestedAt: new Date() } });
    for (const p of pending) for (const key of [p.cvSnapshotUrl, p.letterSnapshotUrl]) if (key) await this.storage.deletePrivate(key).catch(() => undefined);
    return { cancelled: cancelled.count, cancelRequested: sending.count };
  }

  /** Withdraws every permission given so far: pending applications are cancelled and automation is switched off. */
  async revokeConsent(userId: string) {
    const now = new Date();
    await this.prisma.emailApplySettings.upsert({
      where: { userId },
      create: { userId, consentRevokedAt: now, automationEnabled: false },
      update: { consentRevokedAt: now, automationEnabled: false },
    });
    return { ...(await this.cancelPending(userId)), settings: await this.settings(userId) };
  }

  // ── Presentation ──────────────────────────────────────────────────────────
  private summary(row: EmailApplication) {
    return {
      id: row.id, jobId: row.jobId, jobTitle: row.jobTitle, jobCompany: row.jobCompany, jobUrl: row.jobUrl, mode: row.mode,
      deliveryState: row.deliveryState, recruitmentState: row.recruitmentState, holdReason: row.holdReason, failureCode: row.failureCode,
      subject: row.subject, approvedAt: row.approvedAt, providerAcceptedAt: row.providerAcceptedAt, deliveredAt: row.deliveredAt,
      interviewAt: row.interviewAt, interviewTimezone: row.interviewTimezone, createdAt: row.createdAt, preparedByAgentAt: row.preparedByAgentAt,
    };
  }

  view(row: EmailApplication) {
    // Once approved the hashes of the private copies speak; before that, those of the previewed files.
    const previewHash = payloadHash(payloadPartsOf({ ...row, cvSha256: row.cvSha256 ?? row.cvPreviewSha256, letterSha256: row.letterSha256 ?? row.letterPreviewSha256 }, 'approved'));
    const cv = { role: 'cv' as const, resumeId: row.cvResumeId, kind: row.cvKind, fileName: row.cvFileName, mimeType: row.cvMimeType, sha256: row.cvSha256 ?? row.cvPreviewSha256, bytes: row.cvBytes };
    const letter = row.letterResumeId
      ? { role: 'letter' as const, resumeId: row.letterResumeId, kind: 'tailored', fileName: row.letterFileName, mimeType: 'application/pdf', sha256: row.letterSha256 ?? row.letterPreviewSha256, bytes: row.letterBytes }
      : null;
    return {
      ...this.summary(row),
      recipient: row.recipient, recipientEvidence: row.recipientEvidence, instructions: row.instructions, instructionsExtra: needsExtraMaterial(row.instructions),
      // What automatic mode stops on (salary expectation, diploma, references...): said next to the instructions so the candidate decides with it in view.
      asksMoreThanCv: EXTRA_REQUIREMENTS.test(row.instructions ?? ''), reference: row.reference,
      subjectSource: row.subjectSource, subjectLocked: row.subjectSource === 'published', body: row.body, copyToSelf: row.copyToSelf, replyTo: row.replyTo, senderName: row.senderName,
      cv, letter,
      // Every document that leaves with this application, with the hash the approval is bound to.
      attachments: letter ? [cv, letter] : [cv],
      payloadSha256: previewHash,
      consentVersion: row.consentVersion,
      // Plain statement of what leaves AISE with this application.
      senderAddress: row.senderEmail ?? null,
      sharing: ['Seçdiyiniz CV faylı', ...(letter ? ['Seçdiyiniz motivasiya məktubu (PDF)'] : []), 'Yuxarıdakı məktub mətni', `Adınız (${row.senderName}) və cavab ünvanınız (${row.replyTo})`, ...(row.copyToSelf ? ['Eyni məktubun sizə də surəti'] : [])],
      evidence: { providerAcceptedAt: row.providerAcceptedAt, deliveredAt: row.deliveredAt, bouncedAt: row.bouncedAt, complainedAt: row.complainedAt, uncertainAt: row.uncertainAt },
      reminderOptIn: row.reminderOptIn, interviewNotes: row.interviewNotes, attemptCount: row.attemptCount,
      ...(this.cfg.inboundEnabled && this.cfg.inboundDomain ? { inboundAddress: `track+${row.replyToken}@${this.cfg.inboundDomain}` } : {}),
    };
  }
}
