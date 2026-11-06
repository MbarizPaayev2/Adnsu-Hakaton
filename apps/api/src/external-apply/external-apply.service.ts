import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, ExternalApplicationStatus as S } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../database/database.service';
import { activePlanOverrides, effectivePlan } from '../billing/entitlement';
import { isJobActionable } from '../jobs/jobs.service';
import { LocalStorageService } from '../resumes/local-storage.service';
import { PostHogService } from '../common/posthog.service';
import { ApplyWorkerClient, ApplyWorkerError } from './apply-worker.client';
import { applyYourselfUrl, destinationCapability, DestinationCapability, ExternalDestination, ExternalDestinationRegistry } from './destinations';
import { FeatureFlagsService } from '../operations/feature-flags.service';
import { SubmitAnswersDto } from './dto/submit-answers.dto';
import { ConfirmSubmitDto } from './dto/confirm-submit.dto';
import { SubmitOtpDto } from './dto/submit-otp.dto';
import { GrantConsentDto } from './dto/grant-consent.dto';
import {
  ConfirmSubmitResponse,
  GlorriFillData,
  OtpResponse,
  SessionResponse,
} from './external-apply.types';

type ExternalApplicationRow = Prisma.ExternalApplicationGetPayload<{}>;

// Rows that still have a preparation or send in progress for their match.
const IN_PROGRESS: S[] = [S.DRAFT, S.FILLING, S.NEEDS_INPUT, S.READY_FOR_REVIEW, S.AWAITING_OTP, S.SUBMITTING];
// Something may already have reached the destination; never start another
// automated application for the same match on top of these.
const MAY_HAVE_BEEN_SENT: S[] = [S.SUBMITTED, S.DELIVERY_UNCONFIRMED];
// Ended after the final control was activated (the destination may hold the
// data awaiting an OTP): treated like a possible send, never re-applied
// automatically.
const ENDED_AFTER_ACTIVATION = ['OTP_SESSION_LOST_AFTER_SEND', 'OTP_SESSION_EXPIRED_AFTER_SEND', 'OTP_ATTEMPTS_EXHAUSTED', 'CANCELLED_AFTER_SEND_PENDING_OTP'];
const mayHaveBeenSent = (row: { status: S; stateReason: string | null }) =>
  MAY_HAVE_BEEN_SENT.includes(row.status) || ENDED_AFTER_ACTIVATION.includes(row.stateReason ?? '');
// No further work happens on these; their retained files can expire.
const ENDED: S[] = [S.SUBMITTED, S.SUBMITTED_DRY_RUN, S.DELIVERY_UNCONFIRMED, S.FAILED, S.EXPIRED, S.CANCELLED];
// Cancelling stops AISE; it never withdraws anything already transmitted.
const CANCELLABLE: S[] = [S.DRAFT, S.FILLING, S.NEEDS_INPUT, S.READY_FOR_REVIEW, S.AWAITING_OTP];
// States backed by a live worker browser session.
const SESSION_BACKED: S[] = [S.NEEDS_INPUT, S.READY_FOR_REVIEW];

const MAX_OTP_ATTEMPTS = 5;
// Worker replies that provably come from its auth guard / validation pipe,
// before any handler could touch the page. Anything else (409 in-flight, 5xx,
// proxy 408/502/504) may follow a side effect and is left uncertain.
const WORKER_REFUSED_BEFORE_HANDLER = [400, 401, 403, 413, 415, 422];
const PRIVACY_FIELD_KEY = 'isDataPrivacyAccepted';
const JOB_NOT_ACTIONABLE = 'Bu elan artıq aktiv deyil — müraciət etmək mümkün deyil';

const MESSAGES: Record<string, string> = {
  OPERATOR_PAUSED:
    'Avtomatik xarici müraciət operator tərəfindən müvəqqəti dayandırılıb. Vakansiyaya mənbə saytda özünüz müraciət edə bilərsiniz.',
  LIVE_GATE_OFF:
    'Avtomatik xarici müraciət hazırda dayandırılıb. Vakansiyaya mənbə saytda özünüz müraciət edə bilərsiniz.',
  NOT_PILOT: 'Avtomatik xarici müraciət hazırda yalnız dəvət olunmuş pilot istifadəçilər üçün açıqdır.',
  PLAN_REQUIRED:
    'Avtomatik xarici müraciətlər yalnız Limitsiz planında əlçatandır. Zəhmət olmasa planınızı yüksəldin.',
  NOTICE_NOT_CAPTURED:
    'Qəbul edən saytın məlumatların işlənməsi bəyanatı AISE-də qeydə alınmayıb, ona görə sizə göstərib razılığınızı ala bilmirik. Mənbə saytda özünüz müraciət edin.',
  UNSUPPORTED_SOURCE: 'Bu vakansiyaya avtomatik müraciət etmək mümkün deyil',
  DESTINATION_DATA_MISSING: 'Bu vakansiyada avtomatik müraciət üçün lazımi məlumatlar yoxdur',
  DESTINATION_NOT_ALLOWED: 'Bu vakansiyanın müraciət ünvanı icazəli təyinatlar siyahısında deyil',
  NOT_ACTIONABLE: JOB_NOT_ACTIONABLE,
  DAILY_LIMIT: 'Son 24 saat üçün avtomatik göndəriş limitinə çatmısınız. Sonra yenidən cəhd edin.',
  CONSENT_MISSING: 'Bu müraciət üçün qeydə alınmış razılığınız yoxdur. Müraciəti ləğv edib yenidən başlayın.',
  CONSENT_REVOKED: 'Bu müraciət üçün razılığınız geri götürülüb. Heç nə göndərilmədi.',
  NOTICE_CHANGED:
    'Qəbul edən saytın bəyanatı razılıq verdiyiniz versiyadan fərqlənir. Heç nə göndərilmədi; yeni bəyanatı görmək üçün yenidən başlayın.',
  DESTINATION_CHANGED: 'Müraciət ünvanı razılıq verdiyiniz təyinatla uyğun gəlmir. Heç nə göndərilmədi.',
};

// Why a preparation stopped; each one means nothing was finally sent.
const FILL_FAILURE_MESSAGES: Record<string, string> = {
  NOTICE_CHANGED: MESSAGES.NOTICE_CHANGED,
  MANUAL_INTERVENTION_REQUIRED:
    'Sayt insan yoxlaması (CAPTCHA) tələb edir. AISE bunu keçməyə çalışmır; heç nə göndərilmədi. Müraciəti saytda özünüz edin.',
  UPLOAD_FAILED: 'Sayt sənədin yüklənməsini qəbul etmədi. Heç nə göndərilmədi.',
  REVIEW_NOT_REACHED: 'Saytdakı forma gözlənilən yoxlama addımına çatmadı (forma dəyişmiş ola bilər). Heç nə göndərilmədi.',
};

// The worker is certain it did not activate the final control.
const SEND_NOT_STARTED_MESSAGES: Record<string, string> = {
  MANUAL_INTERVENTION_REQUIRED: FILL_FAILURE_MESSAGES.MANUAL_INTERVENTION_REQUIRED,
  CONFIRM_CONTROL_MISSING: 'Saytda göndəriş düyməsi tapılmadı. Heç nə göndərilmədi.',
  CONFIRM_CONTROL_DISABLED: 'Saytdakı göndəriş düyməsi aktiv deyil. Heç nə göndərilmədi.',
};

export interface Capability {
  available: boolean;
  reason: string | null;
  message: string | null;
  applicationId?: string;
  applicationStatus?: string;
  /** What the posting's destination can do; absent for postings no destination handles. */
  destination?: DestinationCapability;
  /** The posting's own page on the destination, for applying there yourself. */
  applyYourselfUrl?: string | null;
}

function envList(name: string): string[] {
  return (process.env[name] || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
}

function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function formatDob(dob: Date | null | undefined): string {
  if (!dob) return '';
  const iso = dob.toISOString().slice(0, 10); // YYYY-MM-DD
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

@Injectable()
export class ExternalApplyService {
  private readonly logger = new Logger(ExternalApplyService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: LocalStorageService,
    private applyWorkerClient: ApplyWorkerClient,
    private postHogService: PostHogService,
    private registry: ExternalDestinationRegistry,
    private flags: FeatureFlagsService,
    @InjectQueue('external-apply') private fillQueue: Queue,
  ) {}

  // ---------------------------------------------------------------- gates --

  private liveGateOn(): boolean {
    return process.env.EXTERNAL_APPLY_LIVE_ENABLED === 'true';
  }

  private isPilot(user: { id: string; email: string }): boolean {
    return envList('EXTERNAL_APPLY_PILOT_USER_IDS').includes(user.id.toLowerCase())
      || envList('EXTERNAL_APPLY_PILOT_EMAILS').includes(user.email.toLowerCase());
  }

  /**
   * Account/destination/gate eligibility shared by capability display,
   * creation, consent, fill and every send. Returns the first blocking reason.
   */
  private async blockingReason(
    userId: string,
    job: { externalId: string; url?: string | null; rawPayload?: unknown; status: any; deadline: Date | null } | null,
  ): Promise<{ reason: string; destination?: ExternalDestination } | null> {
    if (!job) return { reason: 'UNSUPPORTED_SOURCE' };
    const resolved = this.registry.resolve(job);
    if (!resolved.ok) return { reason: resolved.reason };
    if (!isJobActionable(job as any)) return { reason: 'NOT_ACTIONABLE' };
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { subscription: true, planOverrides: activePlanOverrides() } });
    if (!user) return { reason: 'NOT_PILOT' };
    if (effectivePlan(user) !== 'Limitsiz') return { reason: 'PLAN_REQUIRED' };
    if (!this.liveGateOn()) return { reason: 'LIVE_GATE_OFF' };
    // Operator pause: stops new preparations, final sends and OTPs at once.
    if (await this.flags.isPaused('external_apply.submissions')) return { reason: 'OPERATOR_PAUSED' };
    if (!this.isPilot(user)) return { reason: 'NOT_PILOT' };
    if (!resolved.destination.notice) return { reason: 'NOTICE_NOT_CAPTURED' };
    return null;
  }

  private refuse(reason: string): never {
    const message = MESSAGES[reason] || MESSAGES.UNSUPPORTED_SOURCE;
    if (['UNSUPPORTED_SOURCE', 'DESTINATION_DATA_MISSING', 'DESTINATION_NOT_ALLOWED', 'NOT_ACTIONABLE'].includes(reason)) {
      throw new BadRequestException({ message, reason });
    }
    if (['CONSENT_MISSING', 'CONSENT_REVOKED', 'NOTICE_CHANGED', 'DESTINATION_CHANGED'].includes(reason)) {
      throw new ConflictException({ message, reason });
    }
    if (reason === 'DAILY_LIMIT') throw new HttpException({ message, reason }, 429);
    throw new ForbiddenException({ message, reason });
  }

  private async loadForSend(app: ExternalApplicationRow) {
    const match = await this.prisma.match.findUnique({ where: { id: app.matchId }, include: { job: true } });
    const job = match?.job ?? null;
    const blocked = await this.blockingReason(app.userId, job);
    if (blocked) return { blocked: blocked.reason } as const;
    const destination = this.registry.byKey(app.destinationKey);
    if (!destination || !app.destinationHost || !destination.hosts.includes(app.destinationHost)
      || !this.registry.isAllowedApplyUrl(destination, app.applyUrl)
      || new URL(app.applyUrl).hostname !== app.destinationHost) {
      return { blocked: 'DESTINATION_NOT_ALLOWED' } as const;
    }
    const consent = await this.prisma.externalApplicationConsent.findFirst({
      where: { externalApplicationId: app.id },
      orderBy: { grantedAt: 'desc' },
    });
    if (!consent) return { blocked: 'CONSENT_MISSING' } as const;
    if (consent.revokedAt) return { blocked: 'CONSENT_REVOKED' } as const;
    if (consent.userId !== app.userId || consent.jobId !== job!.id) return { blocked: 'CONSENT_MISSING' } as const;
    if (consent.destinationHost !== app.destinationHost || consent.applyUrl !== app.applyUrl) {
      return { blocked: 'DESTINATION_CHANGED' } as const;
    }
    if (consent.noticeHash !== this.registry.currentNoticeHash(destination)) return { blocked: 'NOTICE_CHANGED' } as const;
    return { blocked: null, destination, consent, job: job! } as const;
  }

  private async assertDailyLimit(userId: string) {
    const limit = envInt('EXTERNAL_APPLY_DAILY_SEND_LIMIT', 5);
    const used = await this.prisma.externalApplicationAttempt.count({
      where: { userId, kind: 'CONFIRM', dryRun: false, startedAt: { gt: new Date(Date.now() - 86_400_000) } },
    });
    if (used >= limit) this.refuse('DAILY_LIMIT');
  }

  // ------------------------------------------------------------ capability --

  async capabilities(userId: string, matchIds: string[]): Promise<Record<string, Capability>> {
    const ids = [...new Set(matchIds)].slice(0, 100);
    const matches = await this.prisma.match.findMany({ where: { id: { in: ids }, userId }, include: { job: true } });
    const latest = await this.prisma.externalApplication.findMany({
      where: { matchId: { in: matches.map((m) => m.id) }, userId },
      orderBy: { createdAt: 'desc' },
    });
    const result: Record<string, Capability> = {};
    for (const match of matches) {
      const destination = match.job ? this.registry.forJob(match.job) : undefined;
      const about = destination
        ? { destination: destinationCapability(destination), applyYourselfUrl: applyYourselfUrl(destination, match.job?.url) }
        : {};
      const existing = latest.find((a) => a.matchId === match.id);
      if (existing && (IN_PROGRESS.includes(existing.status) || mayHaveBeenSent(existing))) {
        result[match.id] = {
          available: IN_PROGRESS.includes(existing.status),
          reason: IN_PROGRESS.includes(existing.status) ? 'IN_PROGRESS' : 'ALREADY_SENT',
          message: null,
          applicationId: existing.id,
          applicationStatus: existing.status,
          ...about,
        };
        continue;
      }
      const blocked = await this.blockingReason(userId, match.job);
      result[match.id] = blocked
        ? { available: false, reason: blocked.reason, message: MESSAGES[blocked.reason] ?? null, ...about }
        : { available: true, reason: null, message: null, ...about };
    }
    return result;
  }

  // -------------------------------------------------------------- creation --

  /** Creates a DRAFT only. Nothing is transmitted until the candidate consents. */
  async create(userId: string, matchId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId }, include: { job: true } });
    if (!match || match.userId !== userId) throw new NotFoundException('Uyğunluq tapılmadı');
    if (!match.job) this.refuse('UNSUPPORTED_SOURCE');

    const blocked = await this.blockingReason(userId, match.job);
    if (blocked) this.refuse(blocked.reason);
    const resolved = this.registry.resolve(match.job!);
    if (!resolved.ok) this.refuse(resolved.reason);

    return this.prisma.$transaction(async (tx) => {
      // Serialises concurrent "start" clicks for the same match.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`external-apply:${matchId}`}))`;
      const latest = await tx.externalApplication.findFirst({ where: { matchId, userId }, orderBy: { createdAt: 'desc' } });
      if (latest && IN_PROGRESS.includes(latest.status)) return latest;
      if (latest && mayHaveBeenSent(latest)) {
        throw new ConflictException(
          latest.status === S.SUBMITTED
            ? 'Bu vakansiyaya müraciətiniz artıq göndərilib'
            : 'Əvvəlki müraciətin çatdırılması təsdiqlənməyib. Təkrar göndərməmək üçün əvvəlcə mənbə saytda yoxlayın.',
        );
      }
      return tx.externalApplication.create({
        data: {
          matchId,
          userId,
          applyUrl: resolved.applyUrl,
          destinationKey: resolved.destination.key,
          destinationHost: resolved.host,
          status: S.DRAFT,
        },
      });
    });
  }

  async findById(id: string, userId: string) {
    const app = await this.prisma.externalApplication.findUnique({ where: { id } });
    if (!app || app.userId !== userId) throw new NotFoundException('Xarici müraciət tapılmadı');
    const [consent, answers, match] = await Promise.all([
      this.prisma.externalApplicationConsent.findFirst({
        where: { externalApplicationId: id },
        orderBy: { grantedAt: 'desc' },
        select: { destinationHost: true, noticeVersion: true, noticeUrl: true, approvedFields: true, approvedDocuments: true, disclosure: true, grantedAt: true, revokedAt: true, revokedReason: true },
      }),
      this.prisma.externalApplicationAnswer.findMany({
        where: { externalApplicationId: id },
        orderBy: { createdAt: 'asc' },
        select: { fieldKey: true, label: true, value: true },
      }),
      this.prisma.match.findUnique({ where: { id: app.matchId }, select: { job: { select: { title: true, company: true, url: true } } } }),
    ]);
    const destination = this.registry.byKey(app.destinationKey);
    const disclosed = (consent?.disclosure as { fields?: Record<string, string> } | null)?.fields ?? {};
    // Internal storage paths and the in-flight marker are not for the client.
    const { cvSnapshotUrl: _cv, idDocumentSnapshotUrl: _id, activeAttemptId: _attempt, ...visible } = app;
    return {
      ...visible,
      vacancy: match?.job ?? null,
      destinationName: destination?.displayName ?? null,
      destinationCapability: destination ? destinationCapability(destination) : null,
      // The consented values, labelled in the destination's field order.
      disclosedFields: (destination?.fields ?? []).map((f) => ({ key: f.key, label: f.label, value: disclosed[f.key] ?? '' })),
      // Latest answer per question: exactly what the form now holds.
      answers: [...new Map(answers.map((a) => [a.fieldKey, a])).values()],
      // A SUBMITTED row without a validated reference predates receipt
      // evidence and must not be presented as a confirmed receipt.
      receiptConfirmed: app.status === S.SUBMITTED && !!app.receiptReference,
      consent,
    };
  }

  /**
   * The candidate's external applications for the "Müraciətlərim" list.
   * `receiptConfirmed` is the only field that may be presented as "the
   * employer's site confirmed receipt"; the reference is shown only then.
   */
  async listMine(userId: string) {
    const rows = await this.prisma.externalApplication.findMany({
      where: { userId, status: { not: S.CANCELLED } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, status: true, dryRun: true, createdAt: true, submittedAt: true, destinationKey: true, receiptReference: true,
        match: { select: { id: true, job: { select: { title: true, company: true } } } },
      },
    });
    return rows.map(({ receiptReference, destinationKey, match, ...row }) => {
      const receiptConfirmed = row.status === S.SUBMITTED && !!receiptReference;
      return {
        ...row,
        matchId: match.id,
        vacancy: match.job,
        destinationName: this.registry.byKey(destinationKey)?.displayName ?? null,
        receiptConfirmed,
        receiptReference: receiptConfirmed ? receiptReference : null,
      };
    });
  }

  async findByMatch(matchId: string, userId: string) {
    const app = await this.prisma.externalApplication.findFirst({ where: { matchId, userId }, orderBy: { createdAt: 'desc' } });
    if (!app) throw new NotFoundException('Xarici müraciət tapılmadı');
    return app;
  }

  // ----------------------------------------------------------- preparation --

  private async disclosureFor(userId: string, destination: ExternalDestination) {
    const [user, profile, base] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.profile.findUnique({ where: { userId } }),
      this.prisma.resume.findFirst({ where: { userId, isBase: true, status: 'READY', fileUrl: { not: null } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const nameParts = (user?.name || '').trim().split(/\s+/).filter(Boolean);
    const source: Record<string, string> = {
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' '),
      email: user?.email || '',
      phone: profile?.phone || '',
      address: profile?.address || '',
      citizenship: profile?.citizenship || '',
      dob: formatDob(profile?.dob),
      salary: profile?.salaryExpectation != null ? String(profile.salaryExpectation) : '',
      netGross: profile?.preferredNetGross || '',
      currency: profile?.preferredCurrency || '',
    };
    const fields = destination.fields.map((f) => ({ key: f.key, label: f.label, value: source[f.key] ?? '' }));
    const missingFields = fields.filter((f) => !f.value.trim()).map((f) => f.key);
    const disclosureHash = sha256(JSON.stringify(fields.map((f) => [f.key, f.value])));

    const documents: { kind: 'CV' | 'ID_DOCUMENT'; label: string; reason: string; fileUrl: string | null; sha256: string | null }[] = [];
    documents.push({
      kind: 'CV',
      label: 'Əsas CV',
      reason: 'Müraciət formasının CV sahəsi',
      fileUrl: base?.fileUrl ?? null,
      sha256: base?.fileUrl ? await this.storageService.sha256(base.fileUrl).catch(() => null) : null,
    });
    if (destination.identityDocument.required) {
      documents.push({
        kind: 'ID_DOCUMENT',
        label: 'Şəxsiyyət vəsiqəsinin şəkli',
        reason: destination.identityDocument.reason,
        fileUrl: profile?.idDocumentUrl ?? null,
        sha256: profile?.idDocumentUrl ? await this.storageService.sha256(profile.idDocumentUrl).catch(() => null) : null,
      });
    }
    return {
      fields,
      missingFields,
      disclosureHash,
      documents,
      motivationLetter: profile?.defaultCoverLetter || '',
      approvedFieldKeys: [...fields.map((f) => f.key), 'motivationLetter'],
    };
  }

  async getPreparation(id: string, userId: string) {
    const app = await this.findOwned(id, userId);
    const match = await this.prisma.match.findUnique({ where: { id: app.matchId }, include: { job: true } });
    const destination = this.registry.byKey(app.destinationKey);
    if (!match?.job || !destination) this.refuse('UNSUPPORTED_SOURCE');
    const blocked = await this.blockingReason(userId, match!.job);
    const disclosure = await this.disclosureFor(userId, destination!);
    const blockers = [
      ...(blocked ? [blocked.reason] : []),
      ...(disclosure.missingFields.length ? ['PROFILE_INCOMPLETE'] : []),
      ...disclosure.documents.filter((d) => !d.sha256).map((d) => `${d.kind}_MISSING`),
    ];
    const notice = destination!.notice;
    return {
      applicationId: app.id,
      status: app.status,
      destination: { key: destination!.key, displayName: destination!.displayName, host: app.destinationHost, applyUrl: app.applyUrl },
      destinationCapability: destinationCapability(destination!),
      employer: match!.job!.company,
      vacancyTitle: match!.job!.title,
      postingUrl: match!.job!.url,
      notice: notice
        ? { url: notice.url, version: notice.version, declarationText: notice.declarationText, hash: this.registry.currentNoticeHash(destination!) }
        : null,
      fields: disclosure.fields,
      missingFields: disclosure.missingFields,
      disclosureHash: disclosure.disclosureHash,
      approvedFieldKeys: disclosure.approvedFieldKeys,
      motivationLetter: disclosure.motivationLetter,
      documents: disclosure.documents.map(({ fileUrl: _f, ...d }) => d),
      blockers,
      blockerMessages: blockers.map((b) => MESSAGES[b] ?? null),
      canConsent: app.status === S.DRAFT && blockers.length === 0,
    };
  }

  /**
   * Records the candidate's scoped authority and only then starts preparation
   * (the first moment any data goes to the destination).
   */
  async grantConsent(id: string, userId: string, dto: GrantConsentDto) {
    const app = await this.findOwned(id, userId);
    if (app.status !== S.DRAFT) throw new ConflictException('Razılıq yalnız hazırlıq başlamazdan əvvəl verilə bilər');
    const match = await this.prisma.match.findUnique({ where: { id: app.matchId }, include: { job: true } });
    const blocked = await this.blockingReason(userId, match?.job ?? null);
    if (blocked) this.refuse(blocked.reason);
    const destination = this.registry.byKey(app.destinationKey)!;
    if (!destination || !this.registry.isAllowedApplyUrl(destination, app.applyUrl)) this.refuse('DESTINATION_NOT_ALLOWED');

    const changed = (what: string) => new ConflictException({
      message: `Göstərilən məlumat dəyişib (${what}). Yenidən nəzərdən keçirib təsdiqləyin.`,
      reason: 'PREPARATION_CHANGED',
    });
    const noticeHash = this.registry.currentNoticeHash(destination)!;
    if (dto.destinationHost !== app.destinationHost) throw changed('təyinat');
    if (dto.noticeHash !== noticeHash || dto.noticeVersion !== destination.notice!.version) throw changed('bəyanat');

    const disclosure = await this.disclosureFor(userId, destination);
    if (disclosure.missingFields.length) {
      throw new BadRequestException({ message: 'Profil tam deyil', missingProfileFields: disclosure.missingFields });
    }
    if (dto.disclosureHash !== disclosure.disclosureHash) throw changed('profil məlumatları');
    const expectedKeys = [...disclosure.approvedFieldKeys].sort();
    const approvedKeys = [...new Set(dto.approvedFields)].sort();
    if (JSON.stringify(expectedKeys) !== JSON.stringify(approvedKeys)) throw changed('sahələr');
    const expectedDocs = disclosure.documents;
    if (dto.approvedDocuments.length !== expectedDocs.length) throw changed('sənədlər');
    for (const doc of expectedDocs) {
      if (!doc.sha256 || !doc.fileUrl) throw new BadRequestException(`${doc.label} tapılmadı`);
      if (!dto.approvedDocuments.some((d) => d.kind === doc.kind && d.sha256 === doc.sha256)) throw changed(doc.label);
    }

    // Stable owned copies: replacing the base CV or ID later cannot change or
    // remove what this application transmits.
    const snapshots: Partial<Record<'CV' | 'ID_DOCUMENT', string>> = {};
    const discard = () => Promise.all(Object.values(snapshots).map((u) => this.storageService.deleteFile(u!).catch(() => undefined)));
    try {
      for (const doc of expectedDocs) {
        const copy = await this.storageService.copyFile(doc.fileUrl!);
        snapshots[doc.kind] = copy;
        if ((await this.storageService.sha256(copy)) !== doc.sha256) throw changed(doc.label);
      }
    } catch (error: any) {
      await discard();
      if (error?.code === 'ENOENT') throw changed('sənədlər');
      throw error;
    }

    const disclosureRecord = {
      fields: Object.fromEntries(disclosure.fields.map((f) => [f.key, f.value])),
      motivationLetter: dto.motivationLetter,
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.externalApplication.updateMany({
          where: { id, userId, status: S.DRAFT },
          data: {
            status: S.FILLING,
            cvSnapshotUrl: snapshots.CV,
            cvSnapshotSha256: expectedDocs.find((d) => d.kind === 'CV')!.sha256,
            idDocumentSnapshotUrl: snapshots.ID_DOCUMENT ?? null,
            stateReason: null,
            reviewVersion: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new ConflictException('Müraciət artıq dəyişib');
        await tx.externalApplicationConsent.create({
          data: {
            externalApplicationId: id,
            userId,
            jobId: match!.job!.id,
            destinationKey: destination.key,
            destinationHost: app.destinationHost!,
            applyUrl: app.applyUrl,
            noticeVersion: destination.notice!.version,
            noticeHash,
            noticeUrl: destination.notice!.url,
            approvedFields: approvedKeys,
            disclosure: disclosureRecord,
            disclosureHash: sha256(JSON.stringify(disclosureRecord)),
            approvedDocuments: expectedDocs.map((d) => ({ kind: d.kind, sha256: d.sha256, reason: d.reason })),
          },
        });
      });
    } catch (error) {
      await discard();
      throw error;
    }

    try {
      await this.fillQueue.add('fill', { applicationId: id }, { jobId: `fill-${id}`, removeOnComplete: true, removeOnFail: false });
    } catch (error) {
      this.logger.error(`external-apply fill enqueue failed for ${id}: ${(error as Error)?.message}`);
      await this.moveFrom(id, [S.FILLING], { status: S.FAILED, stateReason: 'QUEUE_UNAVAILABLE', errorMessage: 'Hazırlıq növbəyə əlavə edilmədi. Heç nə göndərilmədi.' });
    }
    this.postHogService.capture(userId, 'external_apply_consent_granted', { destination: destination.key });
    return this.findById(id, userId);
  }

  // ------------------------------------------------------------------ fill --

  // Called by ExternalApplyProcessor (BullMQ), never directly by a controller.
  async runFill(applicationId: string) {
    const app = await this.prisma.externalApplication.findUnique({ where: { id: applicationId } });
    if (!app || app.status !== S.FILLING) return; // cancelled, expired or already handled

    const ready = await this.loadForSend(app);
    if (ready.blocked !== null) {
      await this.moveFrom(applicationId, [S.FILLING], {
        status: S.FAILED,
        stateReason: ready.blocked,
        errorMessage: `${MESSAGES[ready.blocked] ?? ''} Hazırlıq başlamadı.`.trim(),
      });
      return;
    }
    const disclosure = ready.consent.disclosure as { fields: Record<string, string>; motivationLetter: string };
    const fillData: GlorriFillData = {
      firstName: disclosure.fields.firstName ?? '',
      lastName: disclosure.fields.lastName ?? '',
      email: disclosure.fields.email ?? '',
      phone: disclosure.fields.phone ?? '',
      address: disclosure.fields.address ?? '',
      citizenship: disclosure.fields.citizenship ?? '',
      dob: disclosure.fields.dob ?? '',
      salary: disclosure.fields.salary ?? '',
      netGross: disclosure.fields.netGross ?? '',
      currency: disclosure.fields.currency ?? '',
      resumeFilePath: this.storageService.resolveForRead(app.cvSnapshotUrl!),
      idPhotoFilePath: app.idDocumentSnapshotUrl ? this.storageService.resolveForRead(app.idDocumentSnapshotUrl) : '',
      motivationLetter: disclosure.motivationLetter,
    };

    let result: SessionResponse;
    try {
      result = await this.applyWorkerClient.createSession({
        applicationId,
        applyUrl: app.applyUrl,
        fillData,
        privacyAuthority: { noticeHash: ready.consent.noticeHash, noticeVersion: ready.consent.noticeVersion },
      });
    } catch (err) {
      this.logger.error(`apply-worker createSession failed for ${applicationId}: ${(err as Error)?.message}`);
      await this.moveFrom(applicationId, [S.FILLING], {
        status: S.FAILED,
        stateReason: 'FILL_FAILED',
        errorMessage: 'Müraciət forması hazırlana bilmədi. Yekun göndəriş edilmədi.',
      });
      return;
    }

    if (result.status === 'FAILED' && result.code === 'NOTICE_CHANGED') {
      await this.prisma.externalApplicationConsent.updateMany({
        where: { externalApplicationId: applicationId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'NOTICE_CHANGED' },
      });
    }
    const extra: Prisma.ExternalApplicationUpdateManyMutationInput = {};
    if (result.status !== 'FAILED') {
      extra.sessionExpiresAt = this.sessionTtlFromNow();
      try {
        const screenshot = await this.applyWorkerClient.getScreenshot(applicationId);
        extra.reviewScreenshotUrl = await this.storageService.uploadBuffer(screenshot, 'image/png');
      } catch (err) {
        this.logger.warn(`Review screenshot unavailable for ${applicationId}: ${(err as Error)?.message}`);
      }
    }
    const moved = await this.persistSessionResult(applicationId, [S.FILLING], result, extra);
    if (!moved) {
      // Cancelled (or expired) while the worker was filling: release it.
      if (extra.reviewScreenshotUrl) await this.storageService.deleteFile(extra.reviewScreenshotUrl as string).catch(() => undefined);
      await this.applyWorkerClient.deleteSession(applicationId).catch(() => undefined);
    }
  }

  async submitAnswers(id: string, userId: string, dto: SubmitAnswersDto) {
    const app = await this.findOwned(id, userId);
    if (app.status !== S.NEEDS_INPUT && app.status !== S.READY_FOR_REVIEW) {
      throw new ConflictException(`Müraciət "${app.status}" statusundadırkən cavab göndərmək mümkün deyil`);
    }
    const asked = new Map(((app.missingFields as any[]) || []).map((m: any) => [m?.fieldKey, m]));
    const previouslyAnswered = new Set(
      (await this.prisma.externalApplicationAnswer.findMany({ where: { externalApplicationId: id }, select: { fieldKey: true } }))
        .map((a) => a.fieldKey),
    );
    for (const answer of dto.answers) {
      // The recipient's declaration is covered only by the consent step.
      if (answer.fieldKey === PRIVACY_FIELD_KEY || (!asked.has(answer.fieldKey) && !previouslyAnswered.has(answer.fieldKey))) {
        throw new BadRequestException('Bu sual bu müraciət üçün soruşulmayıb');
      }
    }
    const ready = await this.loadForSend(app);
    if (ready.blocked !== null) this.refuse(ready.blocked);
    // Invalidate the reviewed version BEFORE the page changes: a confirm for
    // the version the candidate saw can no longer be claimed, and a confirm
    // already claimed makes this edit fail here instead of altering the form.
    const invalidated = await this.prisma.externalApplication.updateMany({
      where: { id, userId, status: { in: [S.NEEDS_INPUT, S.READY_FOR_REVIEW] } },
      data: { reviewVersion: { increment: 1 } },
    });
    if (!invalidated.count) throw new ConflictException('Müraciət bu arada dəyişdi');

    let result: SessionResponse;
    try {
      result = await this.applyWorkerClient.submitAnswers(id, { answers: dto.answers, motivationLetter: dto.motivationLetter });
    } catch (err) {
      this.logger.error(`apply-worker submitAnswers failed for ${id}: ${(err as Error)?.message}`);
      if (err instanceof ApplyWorkerError && err.kind === 'HTTP' && err.status === 404) {
        await this.moveFrom(id, [S.NEEDS_INPUT, S.READY_FOR_REVIEW], { status: S.EXPIRED, stateReason: 'SESSION_NOT_FOUND' });
        throw new ConflictException('Hazırlıq sessiyası bitib. Yekun göndəriş edilmədi; yenidən başlayın.');
      }
      throw new HttpException('Cavablar formaya yazıla bilmədi. Yekun göndəriş edilmədi; yenidən cəhd edin.', 502);
    }

    if (dto.answers.length) {
      await this.prisma.externalApplicationAnswer.createMany({
        data: dto.answers.map((a) => ({
          externalApplicationId: id,
          fieldKey: a.fieldKey,
          label: asked.get(a.fieldKey)?.label || a.fieldKey,
          value: a.value,
          source: 'HUMAN',
        })),
      });
    }
    const extra: Prisma.ExternalApplicationUpdateManyMutationInput = {};
    let freshScreenshot: string | undefined;
    if (result.status !== 'FAILED') {
      extra.sessionExpiresAt = this.sessionTtlFromNow();
      // The review must show the form as it is now, with these answers — not
      // the screenshot taken before the candidate answered.
      try {
        freshScreenshot = await this.storageService.uploadBuffer(await this.applyWorkerClient.getScreenshot(id), 'image/png');
        extra.reviewScreenshotUrl = freshScreenshot;
      } catch (err) {
        this.logger.warn(`Review screenshot unavailable for ${id}: ${(err as Error)?.message}`);
        extra.reviewScreenshotUrl = null;
      }
    }
    const moved = await this.persistSessionResult(id, [S.NEEDS_INPUT, S.READY_FOR_REVIEW], result, extra);
    if (!moved) {
      if (freshScreenshot) await this.storageService.deleteFile(freshScreenshot).catch(() => undefined);
      throw new ConflictException('Müraciət bu arada dəyişdi');
    }
    if (app.reviewScreenshotUrl && app.reviewScreenshotUrl !== freshScreenshot && result.status !== 'FAILED') {
      await this.storageService.deleteFile(app.reviewScreenshotUrl).catch(() => undefined);
    }
    return this.findById(id, userId);
  }

  // ------------------------------------------------------------------ send --

  /** A repeated attempt id is a replay: report the current state, never send again. */
  private async replay(attemptId: string, id: string, userId: string) {
    const attempt = await this.prisma.externalApplicationAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) return null;
    if (attempt.externalApplicationId !== id || attempt.userId !== userId) {
      throw new ConflictException('Bu cəhd identifikatoru artıq istifadə olunub');
    }
    return this.findById(id, userId);
  }

  /** Claims the application and persists the attempt atomically, before any worker call. */
  private async claim(
    app: ExternalApplicationRow,
    from: S,
    attempt: { id: string; kind: 'CONFIRM' | 'OTP'; dryRun: boolean },
    extraWhere: Prisma.ExternalApplicationWhereInput,
    extraData: Prisma.ExternalApplicationUpdateManyMutationInput,
  ): Promise<'claimed' | 'replay'> {
    try {
      return await this.claimOnce(app, from, attempt, extraWhere, extraData);
    } catch (error) {
      // The same attempt id racing itself (double-click, retried request):
      // whichever lost sees the winner's committed attempt and replays.
      if (error instanceof ConflictException
        && await this.prisma.externalApplicationAttempt.findFirst({ where: { id: attempt.id, externalApplicationId: app.id, userId: app.userId } })) {
        return 'replay';
      }
      throw error;
    }
  }

  private async claimOnce(
    app: ExternalApplicationRow,
    from: S,
    attempt: { id: string; kind: 'CONFIRM' | 'OTP'; dryRun: boolean },
    extraWhere: Prisma.ExternalApplicationWhereInput,
    extraData: Prisma.ExternalApplicationUpdateManyMutationInput,
  ): Promise<'claimed' | 'replay'> {
    try {
      await this.prisma.$transaction(async (tx) => {
        if (attempt.kind === 'CONFIRM' && !attempt.dryRun) {
          // Serialises this user's real sends so two confirms on different
          // applications cannot both pass the daily limit.
          await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`external-apply-send:${app.userId}`}))`;
          const limit = envInt('EXTERNAL_APPLY_DAILY_SEND_LIMIT', 5);
          const used = await tx.externalApplicationAttempt.count({
            where: { userId: app.userId, kind: 'CONFIRM', dryRun: false, startedAt: { gt: new Date(Date.now() - 86_400_000) } },
          });
          if (used >= limit) this.refuse('DAILY_LIMIT');
        }
        const claimed = await tx.externalApplication.updateMany({
          where: { id: app.id, userId: app.userId, status: from, ...extraWhere },
          data: { status: S.SUBMITTING, activeAttemptId: attempt.id, stateReason: null, ...extraData },
        });
        if (claimed.count !== 1) {
          throw new ConflictException('Bu müraciət artıq göndərilir və ya dəyişib. Səhifəni yeniləyin.');
        }
        await tx.externalApplicationAttempt.create({
          data: { id: attempt.id, externalApplicationId: app.id, userId: app.userId, kind: attempt.kind, dryRun: attempt.dryRun, status: 'IN_FLIGHT' },
        });
      });
      return 'claimed';
    } catch (error: any) {
      if (error?.code === 'P2002') return 'replay';
      throw error;
    }
  }

  async confirmSubmit(id: string, userId: string, dto: ConfirmSubmitDto) {
    const replayed = await this.replay(dto.attemptId, id, userId);
    if (replayed) return replayed;
    const app = await this.findOwned(id, userId);
    if (app.status !== S.READY_FOR_REVIEW) {
      throw new ConflictException(`Müraciət "${app.status}" statusundadırkən göndərişi təsdiqləmək mümkün deyil`);
    }
    // Dry-run fails CLOSED: an impossible rehearsal is refused, never
    // reinterpreted as a real send.
    if (dto.dryRun === true && process.env.ENABLE_SANDBOX !== 'true') {
      throw new BadRequestException(
        'Sınaq (dry-run) göndərişi tələb olundu, lakin serverdə sandbox rejimi aktiv deyil. Real göndərişə keçid etmək əvəzinə sorğu rədd edildi.',
      );
    }
    const dryRun = dto.dryRun === true;
    await this.assertSessionAlive(app, [S.READY_FOR_REVIEW]);
    if (dto.reviewVersion !== app.reviewVersion) {
      throw new ConflictException({ message: 'Müraciət məzmunu siz baxdıqdan sonra dəyişib. Yenidən nəzərdən keçirin.', reason: 'REVIEW_CHANGED' });
    }
    const ready = await this.loadForSend(app);
    if (ready.blocked !== null) this.refuse(ready.blocked);
    if (!dryRun) await this.assertDailyLimit(userId);
    await this.assertSnapshotsIntact(app, ready.consent);

    const attempt = { id: dto.attemptId, kind: 'CONFIRM' as const, dryRun };
    const claimed = await this.claim(app, S.READY_FOR_REVIEW, attempt, { reviewVersion: dto.reviewVersion }, { dryRun });
    if (claimed === 'replay') return (await this.replay(dto.attemptId, id, userId))!;

    let response: ConfirmSubmitResponse | ApplyWorkerError;
    try {
      response = await this.applyWorkerClient.confirmSubmit(id, { attemptId: attempt.id, dryRun });
    } catch (err) {
      response = err instanceof ApplyWorkerError ? err : new ApplyWorkerError('UNKNOWN', 'confirm-submit');
    }
    await this.settle(app, attempt, ready.destination, response);
    return this.findById(id, userId);
  }

  async submitOtp(id: string, userId: string, dto: SubmitOtpDto) {
    const replayed = await this.replay(dto.attemptId, id, userId);
    if (replayed) return replayed;
    const app = await this.findOwned(id, userId);
    if (app.status !== S.AWAITING_OTP) {
      throw new ConflictException(`Müraciət "${app.status}" statusundadırkən OTP kodu göndərmək mümkün deyil`);
    }
    // A rehearsal can never complete a real send, including through OTP.
    if (app.dryRun) throw new ConflictException('Sınaq (dry-run) müraciəti üçün OTP göndərilə bilməz');
    if (app.otpAttempts >= MAX_OTP_ATTEMPTS) throw new BadRequestException('Həddindən artıq cəhd edildi');
    await this.assertSessionAlive(app, [S.AWAITING_OTP]);
    const ready = await this.loadForSend(app);
    if (ready.blocked !== null) this.refuse(ready.blocked);

    const attempt = { id: dto.attemptId, kind: 'OTP' as const, dryRun: false };
    const claimed = await this.claim(app, S.AWAITING_OTP, attempt, { otpAttempts: { lt: MAX_OTP_ATTEMPTS }, dryRun: false }, { otpAttempts: { increment: 1 } });
    if (claimed === 'replay') return (await this.replay(dto.attemptId, id, userId))!;

    let response: OtpResponse | ApplyWorkerError;
    try {
      response = await this.applyWorkerClient.submitOtp(id, { attemptId: attempt.id, code: dto.code });
    } catch (err) {
      response = err instanceof ApplyWorkerError ? err : new ApplyWorkerError('UNKNOWN', 'otp');
    }
    await this.settle(app, attempt, ready.destination, response);
    return this.findById(id, userId);
  }

  private async assertSessionAlive(app: ExternalApplicationRow, from: S[]) {
    if (app.sessionExpiresAt && app.sessionExpiresAt.getTime() <= Date.now()) {
      const afterSend = app.status === S.AWAITING_OTP;
      await this.moveFrom(app.id, from, { status: S.EXPIRED, stateReason: afterSend ? 'OTP_SESSION_EXPIRED_AFTER_SEND' : 'SESSION_EXPIRED' });
      await this.applyWorkerClient.deleteSession(app.id).catch(() => undefined);
      throw new ConflictException({
        message: afterSend
          ? 'OTP üçün vaxt bitib. Məlumatlarınız saytda qala bilər, lakin müraciətin qəbul olunduğu təsdiqlənməyib.'
          : 'Hazırlıq sessiyasının vaxtı bitib. Heç nə göndərilmədi; yenidən başlayın.',
        reason: 'SESSION_EXPIRED',
      });
    }
  }

  private async assertSnapshotsIntact(app: ExternalApplicationRow, consent: { approvedDocuments: Prisma.JsonValue }) {
    const docs = (consent.approvedDocuments as { kind: string; sha256: string }[]) || [];
    const checks: [string | null, string | undefined][] = [
      [app.cvSnapshotUrl, app.cvSnapshotSha256 ?? undefined],
      [app.idDocumentSnapshotUrl, docs.find((d) => d.kind === 'ID_DOCUMENT')?.sha256],
    ];
    for (const [url, expected] of checks) {
      if (!url && !expected) continue;
      const actual = url ? await this.storageService.sha256(url).catch(() => null) : null;
      if (!actual || actual !== expected) {
        await this.moveFrom(app.id, [S.READY_FOR_REVIEW], { status: S.FAILED, stateReason: 'SNAPSHOT_CHANGED', errorMessage: 'Təsdiqlədiyiniz sənədin surəti dəyişib və ya tapılmadı. Heç nə göndərilmədi.' });
        throw new ConflictException('Təsdiqlədiyiniz sənədin surəti dəyişib. Heç nə göndərilmədi.');
      }
    }
  }

  /**
   * Maps a worker reply (or failure) to a truthful state. Only a receipt
   * validated against the destination contract becomes SUBMITTED; anything
   * that might have been sent without such evidence is DELIVERY_UNCONFIRMED.
   */
  private async settle(
    app: ExternalApplicationRow,
    attempt: { id: string; kind: 'CONFIRM' | 'OTP'; dryRun: boolean },
    destination: ExternalDestination,
    response: ConfirmSubmitResponse | OtpResponse | ApplyWorkerError,
  ) {
    const back = attempt.kind === 'CONFIRM' ? S.READY_FOR_REVIEW : S.AWAITING_OTP;
    const undoOtp: Prisma.ExternalApplicationUpdateManyMutationInput = attempt.kind === 'OTP' ? { otpAttempts: { decrement: 1 } } : {};
    let next: { status: S; stateReason: string; attemptStatus: string; data?: Prisma.ExternalApplicationUpdateManyMutationInput };

    if (response instanceof ApplyWorkerError) {
      if (response.kind === 'NOT_DELIVERED') {
        next = { status: back, stateReason: 'WORKER_UNREACHABLE', attemptStatus: 'NOT_SENT', data: undoOtp };
      } else if (response.kind === 'HTTP' && response.status === 404) {
        next = { status: S.EXPIRED, stateReason: 'SESSION_NOT_FOUND', attemptStatus: 'NOT_SENT' };
      } else if (response.kind === 'HTTP' && WORKER_REFUSED_BEFORE_HANDLER.includes(response.status!)) {
        // Rejected by the worker's guard/validation before its handler ran.
        next = { status: back, stateReason: 'WORKER_REJECTED_REQUEST', attemptStatus: 'NOT_SENT', data: undoOtp };
      } else {
        next = { status: S.DELIVERY_UNCONFIRMED, stateReason: 'WORKER_TIMEOUT_OR_ERROR', attemptStatus: 'UNCONFIRMED' };
      }
    } else {
      const allowed = attempt.kind === 'CONFIRM'
        ? ['NOT_SENT', 'SENT_OBSERVED', 'REJECTED', 'AWAITING_OTP', 'DRY_RUN_COMPLETE']
        : ['NOT_SENT', 'SENT_OBSERVED', 'REJECTED', 'OTP_INVALID'];
      const outcome = (response as any)?.outcome;
      if ((response as any)?.attemptId !== attempt.id || !allowed.includes(outcome)) {
        next = { status: S.DELIVERY_UNCONFIRMED, stateReason: 'MALFORMED_WORKER_RESPONSE', attemptStatus: 'UNCONFIRMED' };
      } else if (attempt.dryRun && outcome !== 'DRY_RUN_COMPLETE' && outcome !== 'NOT_SENT') {
        this.logger.error(`Dry-run attempt ${attempt.id} for ${app.id} reported ${outcome}`);
        next = { status: S.DELIVERY_UNCONFIRMED, stateReason: 'DRY_RUN_VIOLATION', attemptStatus: 'UNCONFIRMED' };
      } else if (outcome === 'DRY_RUN_COMPLETE') {
        next = attempt.dryRun
          ? { status: S.SUBMITTED_DRY_RUN, stateReason: 'DRY_RUN_COMPLETE', attemptStatus: 'DRY_RUN_COMPLETE' }
          : { status: S.DELIVERY_UNCONFIRMED, stateReason: 'INCONSISTENT_WORKER_OUTCOME', attemptStatus: 'UNCONFIRMED' };
      } else if (outcome === 'NOT_SENT') {
        const code = String((response as any).code || 'NOT_SENT').slice(0, 60);
        next = code === 'SESSION_NOT_FOUND'
          ? { status: S.EXPIRED, stateReason: code, attemptStatus: 'NOT_SENT' }
          : code === 'WORKER_GATE_OFF' || code === 'SESSION_BUSY'
            ? { status: back, stateReason: code, attemptStatus: 'NOT_SENT', data: undoOtp }
            : { status: S.FAILED, stateReason: code, attemptStatus: 'NOT_SENT', data: { errorMessage: SEND_NOT_STARTED_MESSAGES[code] ?? 'Göndəriş başlamadı. Heç nə göndərilmədi.' } };
      } else if (outcome === 'AWAITING_OTP') {
        next = { status: S.AWAITING_OTP, stateReason: 'OTP_REQUIRED', attemptStatus: 'AWAITING_OTP', data: { sessionExpiresAt: this.sessionTtlFromNow() } };
      } else if (outcome === 'OTP_INVALID') {
        const exhausted = app.otpAttempts + 1 >= MAX_OTP_ATTEMPTS;
        next = exhausted
          ? { status: S.FAILED, stateReason: 'OTP_ATTEMPTS_EXHAUSTED', attemptStatus: 'OTP_INVALID' }
          : { status: S.AWAITING_OTP, stateReason: 'OTP_INVALID', attemptStatus: 'OTP_INVALID', data: { sessionExpiresAt: this.sessionTtlFromNow() } };
      } else if (outcome === 'REJECTED') {
        // The control WAS activated and the page showed error-like text. Only
        // the destination's documented refusal counts as a known outcome;
        // anything else is a heuristic, so the recipient may still have
        // stored the application and it stays uncertain (blocking an
        // automatic re-application) rather than being reported as not sent.
        next = this.registry.isDocumentedRejection(destination, (response as any).observation)
          ? { status: S.FAILED, stateReason: 'DESTINATION_REJECTED', attemptStatus: 'REJECTED', data: { errorMessage: 'Qəbul edən sayt müraciəti rədd etdi.' } }
          : { status: S.DELIVERY_UNCONFIRMED, stateReason: 'DESTINATION_ERROR_OBSERVED', attemptStatus: 'REJECTED' };
      } else {
        const observation = (response as any).observation;
        const receipt = this.registry.validateReceipt(destination, observation);
        next = receipt
          ? {
              status: S.SUBMITTED,
              stateReason: 'RECEIPT_CONFIRMED',
              attemptStatus: 'RECEIPT_CONFIRMED',
              data: { receiptReference: receipt.reference, receiptEvidence: receipt.evidence, submittedAt: new Date() },
            }
          // The worker's error-text heuristic can miss a refusal worded
          // without "xəta"; the destination's documented refusal still counts.
          : this.registry.isDocumentedRejection(destination, observation)
            ? { status: S.FAILED, stateReason: 'DESTINATION_REJECTED', attemptStatus: 'REJECTED', data: { errorMessage: 'Qəbul edən sayt müraciəti rədd etdi.' } }
            : {
                status: S.DELIVERY_UNCONFIRMED,
                // The click raised a human-verification challenge that AISE does not pass.
                stateReason: (response as any).code === 'MANUAL_INTERVENTION_REQUIRED' ? 'CHALLENGE_AFTER_SEND' : 'NO_RECEIPT_EVIDENCE',
                attemptStatus: 'UNCONFIRMED',
              };
      }
    }

    const moved = await this.prisma.externalApplication.updateMany({
      where: { id: app.id, status: S.SUBMITTING, activeAttemptId: attempt.id },
      data: {
        status: next.status,
        stateReason: next.stateReason,
        activeAttemptId: null,
        errorMessage: null,
        ...(next.data ?? {}),
      },
    });
    await this.prisma.externalApplicationAttempt.update({
      where: { id: attempt.id },
      data: { status: next.attemptStatus, outcomeCode: next.stateReason, finishedAt: new Date() },
    });
    if (!moved.count) {
      this.logger.warn(`Attempt ${attempt.id} for ${app.id} settled after the row had moved on`);
      // The reconciler gave up on this attempt (STALE_IN_FLIGHT) before its
      // reply arrived. Only a validated receipt for the latest attempt may
      // upgrade that uncertainty; nothing else changes the row.
      if (next.status === S.SUBMITTED) {
        const latest = await this.prisma.externalApplicationAttempt.findFirst({
          where: { externalApplicationId: app.id },
          orderBy: { startedAt: 'desc' },
          select: { id: true },
        });
        if (latest?.id === attempt.id) {
          const upgraded = await this.moveFromWhere(
            { id: app.id, status: S.DELIVERY_UNCONFIRMED, stateReason: 'STALE_IN_FLIGHT' },
            { status: S.SUBMITTED, stateReason: next.stateReason, ...(next.data ?? {}) },
          );
          if (upgraded) await this.prisma.match.update({ where: { id: app.matchId }, data: { status: 'APPLIED' } });
        }
      }
      return;
    }
    if (next.status === S.SUBMITTED) {
      await this.prisma.match.update({ where: { id: app.matchId }, data: { status: 'APPLIED' } });
    }
    this.postHogService.capture(app.userId, 'external_apply_attempt_settled', {
      kind: attempt.kind,
      dryRun: attempt.dryRun,
      status: next.status,
      reason: next.stateReason,
    });
  }

  // ---------------------------------------------------------------- cancel --

  async cancel(id: string, userId: string) {
    const app = await this.findOwned(id, userId);
    const reason = app.status === S.AWAITING_OTP
      ? 'CANCELLED_AFTER_SEND_PENDING_OTP'
      : app.status === S.DRAFT ? 'CANCELLED_BEFORE_TRANSMISSION' : 'CANCELLED_DURING_PREPARATION';
    const moved = await this.prisma.externalApplication.updateMany({
      where: { id, userId, status: { in: CANCELLABLE } },
      data: { status: S.CANCELLED, stateReason: reason, activeAttemptId: null },
    });
    if (!moved.count) {
      const current = await this.findOwned(id, userId);
      if (current.status === S.CANCELLED) return this.findById(id, userId);
      if (current.status === S.SUBMITTING || MAY_HAVE_BEEN_SENT.includes(current.status)) {
        throw new ConflictException(
          'Müraciət artıq göndərilir və ya göndərilib. Ləğv etmək onu qəbul edən saytdan geri götürmür; lazım olsa, işəgötürənlə birbaşa əlaqə saxlayın.',
        );
      }
      throw new ConflictException(`Müraciət "${current.status}" statusundadırkən ləğv edilə bilməz`);
    }
    await this.prisma.externalApplicationConsent.updateMany({
      where: { externalApplicationId: id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'CANCELLED_BY_CANDIDATE' },
    });
    await this.applyWorkerClient.deleteSession(id).catch((err) => {
      this.logger.warn(`Best-effort apply-worker session delete failed for ${id}: ${(err as Error)?.message}`);
    });
    return this.findById(id, userId);
  }

  // ------------------------------------------------------------- reconcile --

  // Called by ExternalApplySweepProcessor on a repeatable schedule.
  async reconcile() {
    // An attempt still in flight long after the send timeout (API crash or
    // lost reply) may have reached the destination: unconfirmed, never resent.
    const staleBefore = new Date(Date.now() - envInt('EXTERNAL_APPLY_STALE_SUBMITTING_MS', 10 * 60 * 1000));
    const stale = await this.prisma.externalApplication.findMany({
      where: { status: S.SUBMITTING, updatedAt: { lt: staleBefore } },
      select: { id: true, activeAttemptId: true },
    });
    for (const row of stale) {
      const moved = await this.prisma.externalApplication.updateMany({
        where: { id: row.id, status: S.SUBMITTING, activeAttemptId: row.activeAttemptId },
        data: { status: S.DELIVERY_UNCONFIRMED, stateReason: 'STALE_IN_FLIGHT', activeAttemptId: null },
      });
      if (moved.count && row.activeAttemptId) {
        await this.prisma.externalApplicationAttempt.updateMany({
          where: { id: row.activeAttemptId, status: 'IN_FLIGHT' },
          data: { status: 'UNCONFIRMED', outcomeCode: 'STALE_IN_FLIGHT', finishedAt: new Date() },
        });
      }
    }

    await this.prisma.externalApplication.updateMany({
      where: { status: { in: [S.DRAFT] }, updatedAt: { lt: new Date(Date.now() - 24 * 3_600_000) } },
      data: { status: S.EXPIRED, stateReason: 'DRAFT_EXPIRED' },
    });
    await this.prisma.externalApplication.updateMany({
      where: { status: S.FILLING, updatedAt: { lt: new Date(Date.now() - envInt('EXTERNAL_APPLY_MAX_FILL_MS', 5 * 60 * 1000)) } },
      data: { status: S.EXPIRED, stateReason: 'FILL_TIMEOUT' },
    });

    await this.expireEvidence();

    let liveIds: string[];
    try {
      liveIds = await this.applyWorkerClient.listLiveIds();
    } catch (err) {
      // A transient blip must never mass-expire in-flight applications.
      this.logger.warn(`Skipping session reconcile: apply-worker unreachable (${(err as Error)?.message})`);
      return;
    }
    await this.prisma.externalApplication.updateMany({
      where: { status: { in: SESSION_BACKED }, id: { notIn: liveIds } },
      data: { status: S.EXPIRED, stateReason: 'SESSION_LOST' },
    });
    // The final control was already activated for these; the destination may
    // hold the data but never received the code.
    await this.prisma.externalApplication.updateMany({
      where: { status: S.AWAITING_OTP, id: { notIn: liveIds } },
      data: { status: S.EXPIRED, stateReason: 'OTP_SESSION_LOST_AFTER_SEND' },
    });
  }

  /**
   * Retained files (the form screenshot and the private CV/ID copies) hold
   * the candidate's personal data. Once an application has ended they are
   * kept for EXTERNAL_APPLY_EVIDENCE_RETENTION_DAYS (default 30) and then
   * deleted; the consent, attempts and receipt reference/hashes remain.
   */
  async expireEvidence(now = new Date()) {
    const days = envInt('EXTERNAL_APPLY_EVIDENCE_RETENTION_DAYS', 30);
    const rows = await this.prisma.externalApplication.findMany({
      where: {
        status: { in: ENDED },
        updatedAt: { lt: new Date(now.getTime() - days * 86_400_000) },
        OR: [{ reviewScreenshotUrl: { not: null } }, { cvSnapshotUrl: { not: null } }, { idDocumentSnapshotUrl: { not: null } }],
      },
      select: { id: true, status: true, reviewScreenshotUrl: true, cvSnapshotUrl: true, idDocumentSnapshotUrl: true },
      take: 200,
    });
    for (const row of rows) {
      // Clear the references first (only if the row is still ended), then the files.
      const cleared = await this.moveFromWhere(
        { id: row.id, status: row.status },
        { reviewScreenshotUrl: null, cvSnapshotUrl: null, idDocumentSnapshotUrl: null },
      );
      if (!cleared) continue;
      for (const url of [row.reviewScreenshotUrl, row.cvSnapshotUrl, row.idDocumentSnapshotUrl]) {
        if (url) await this.storageService.deleteFile(url).catch(() => undefined);
      }
    }
    return rows.length;
  }

  // --------------------------------------------------------------- helpers --

  /** Mirrors the worker's idle TTL, which it refreshes on every page action. */
  private sessionTtlFromNow(): Date {
    return new Date(Date.now() + envInt('EXTERNAL_APPLY_SESSION_TTL_MS', 1_200_000));
  }

  private async findOwned(id: string, userId: string): Promise<ExternalApplicationRow> {
    const app = await this.prisma.externalApplication.findUnique({ where: { id } });
    if (!app || app.userId !== userId) throw new NotFoundException('Xarici müraciət tapılmadı');
    return app;
  }

  private async moveFromWhere(where: Prisma.ExternalApplicationWhereInput, data: Prisma.ExternalApplicationUpdateManyMutationInput): Promise<boolean> {
    const moved = await this.prisma.externalApplication.updateMany({ where, data });
    return moved.count === 1;
  }

  private async moveFrom(id: string, from: S[], data: Prisma.ExternalApplicationUpdateManyMutationInput): Promise<boolean> {
    const moved = await this.prisma.externalApplication.updateMany({ where: { id, status: { in: from } }, data });
    return moved.count === 1;
  }

  private async persistSessionResult(
    applicationId: string,
    from: S[],
    result: SessionResponse,
    extra: Prisma.ExternalApplicationUpdateManyMutationInput = {},
  ): Promise<boolean> {
    const missingFields = Array.isArray(result?.missingFields)
      ? result.missingFields.filter((f) => f && typeof f.fieldKey === 'string' && f.fieldKey !== PRIVACY_FIELD_KEY)
      : [];
    let status = (['READY_FOR_REVIEW', 'NEEDS_INPUT', 'FAILED'] as const).includes(result?.status as any) ? result.status : 'FAILED';
    // Nothing the candidate can answer here (e.g. only the recipient's
    // declaration is still open): stop rather than show an empty question list.
    if (status === 'NEEDS_INPUT' && !missingFields.length) status = 'FAILED';
    return this.moveFrom(applicationId, from, {
      status: status as S,
      previewData: (result?.previewData as Prisma.InputJsonValue) ?? Prisma.DbNull,
      missingFields: missingFields.length ? (missingFields as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      stateReason: status === 'FAILED' ? String(result?.code || 'FILL_FAILED').slice(0, 60) : null,
      errorMessage: status === 'FAILED'
        ? (FILL_FAILURE_MESSAGES[result?.code ?? ''] ?? 'Müraciət forması hazırlana bilmədi. Yekun göndəriş edilmədi.')
        : null,
      reviewVersion: { increment: 1 },
      ...extra,
    });
  }
}
