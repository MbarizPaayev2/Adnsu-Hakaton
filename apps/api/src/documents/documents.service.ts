import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import type { DocumentKind, Resume } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { isJobActionable } from '../jobs/jobs.service';
import { UsageService } from '../billing/usage.service';
import { ResumeTailorService } from '../resumes/tailor/resume-tailor.service';
import type { LetterInputs } from '../resumes/tailor/resume-tailor.processor';
import { isLetter, type LetterContent, type LetterParagraph } from '../resumes/tailor/resume-tailor.types';
import { AllowanceError, DocumentAllowanceService, SYSTEM_REASON } from './document-allowance.service';
import type { GenerateDocumentsDto, PrivateVacancyContextDto, QuoteDocumentsDto, RegenerateDocumentDto, RequestedKind } from './documents.dto';
import { detectLanguage } from './language';
import type { TailorJobInput } from '../resumes/tailor/resume-tailor.types';

export interface GenerateResult {
  bundleId: string;
  created: boolean;
  documents: Resume[];
  units: number;
}

/**
 * Starts document generation: validates the vacancy and the candidate's profile, then — in one transaction under the account's locks — creates the
 * PENDING rows and RESERVES their allowance units. Nothing is generated here (the worker does that); a request the allowance cannot cover creates
 * nothing. A repeated request (same `requestId`, or the same document already running for the match) returns what exists and charges nothing.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('resume-tailor') private queue: Queue,
    private allowance: DocumentAllowanceService,
    private tailorService: ResumeTailorService,
    @Optional() private usage?: UsageService,
  ) {}

  /** Optional hard ceiling (documents created in 24 hours) an operator may set; unset means only the plan's transparent protections apply. */
  private dailyCeiling(): number | null {
    const raw = Number(process.env.TAILOR_DAILY_LIMIT);
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }

  private async actionableMatch(userId: string, matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, userId },
      include: { job: true, vacancy: { include: { company: true } } },
    });
    if (!match) throw new NotFoundException('Uyğunluq tapılmadı');
    const actionable = match.job
      ? isJobActionable(match.job)
      : !!match.vacancy &&
        match.vacancy.status === 'ACTIVE' &&
        match.vacancy.company.status === 'APPROVED' &&
        (!match.vacancy.deadline || match.vacancy.deadline.getTime() >= Date.now());
    if (!actionable) throw new BadRequestException('Bu elan artıq aktiv deyil — onun üçün sənəd hazırlamaq mümkün deyil');
    return match;
  }

  /**
   * The match a saved posting is written against. A candidate who saved a posting may prepare documents for it whatever its match score: when no
   * match exists (the score was below the recommendation threshold, so none was stored) a hidden one is created with an honest "not scored" marker.
   * Recommendation lists only show matches at or above the threshold, so this never shows up as a recommendation; allowances apply as usual.
   */
  async matchForSavedJob(userId: string, ref: string) {
    const m = /^(imported|native):([A-Za-z0-9_-]{1,64})$/.exec(ref || '');
    if (!m) throw new BadRequestException('Vakansiya istinadı yanlışdır');
    const [, kind, id] = m;
    const saved = await this.prisma.savedJob.findFirst({ where: kind === 'imported' ? { userId, jobId: id } : { userId, vacancyId: id } });
    if (!saved) throw new NotFoundException('Bu vakansiya saxlanmış elanlarınızda yoxdur');
    const existing = await this.prisma.match.findFirst({ where: kind === 'imported' ? { userId, jobId: id } : { userId, vacancyId: id }, select: { id: true } });
    const matchId =
      existing?.id ??
      (
        await this.prisma.match.create({
          data: { userId, ...(kind === 'imported' ? { jobId: id } : { vacancyId: id }), score: 0, status: 'VIEWED', details: { origin: 'saved_job', scored: false } as any },
          select: { id: true },
        })
      ).id;
    // The same actionability rule as any other document request (a closed or expired posting is refused with the usual message).
    const match = await this.actionableMatch(userId, matchId);
    const posting = match.job ?? match.vacancy;
    return { matchId, title: posting?.title ?? 'Vakansiya', company: match.job ? match.job.company : match.vacancy?.company.name ?? '' };
  }

  private vacancyText(match: Awaited<ReturnType<DocumentsService['actionableMatch']>>): string {
    const input = match.job ? this.tailorService.buildJobInput(match.job) : this.tailorService.buildVacancyInput(match.vacancy as any);
    return [input.position, input.description, input.requirements, input.responsibilities].join('\n');
  }

  private privateVacancyInput(context: PrivateVacancyContextDto): TailorJobInput {
    const originalText = String(context.originalText ?? '');
    const searchableText = originalText.trim();
    const position = String(context.title ?? '').trim();
    if (!position || !searchableText || searchableText.length < 50 || originalText.length > 40_000) {
      throw new BadRequestException('Vakansiyanın adı və ən azı 50 simvolluq ilkin mətni tələb olunur');
    }
    if (context.deadline && new Date(context.deadline).getTime() < Date.now()) {
      throw new BadRequestException('Elanın son müraciət tarixi keçib; sənəd hazırlamaq mümkün deyil');
    }
    return {
      id: `candidate-paste:${createHash('sha256').update(originalText).digest('hex').slice(0, 24)}`,
      position,
      company: String(context.company ?? '').trim(),
      location: String(context.location ?? '').trim(),
      education: '', experience: '', salary_from: '', salary_to: '', category: '',
      description: String(context.description ?? originalText).trim(),
      requirements: String(context.requirements ?? '').trim(),
      responsibilities: String(context.responsibilities ?? '').trim(),
    };
  }

  private async targetFor(userId: string, dto: QuoteDocumentsDto | GenerateDocumentsDto) {
    if (Boolean(dto.matchId) === Boolean(dto.privateVacancy)) {
      throw new BadRequestException('Bir vakansiya uyğunluğu və ya şəxsi vakansiya mətni seçin');
    }
    if (dto.privateVacancy) {
      const input = this.privateVacancyInput(dto.privateVacancy);
      return { match: null, input, privateVacancy: { ...dto.privateVacancy, title: input.position, company: input.company || null, location: input.location || null, originalText: String(dto.privateVacancy.originalText) } };
    }
    const match = await this.actionableMatch(userId, dto.matchId!);
    const input = match.job ? this.tailorService.buildJobInput(match.job) : this.tailorService.buildVacancyInput(match.vacancy as any);
    return { match, input, privateVacancy: null };
  }

  private normalize(items: QuoteDocumentsDto['items']) {
    const seen = new Set<string>();
    for (const it of items) {
      if (seen.has(it.kind)) throw new BadRequestException('Eyni növ sənəd bir sorğuda iki dəfə istənilə bilməz');
      seen.add(it.kind);
    }
    if (seen.has('CV') && seen.has('RESUME')) throw new BadRequestException('CV və qısa rezümeni eyni sorğuda istəmək olmaz: birini seçin');
    return items;
  }

  /** The cost shown before the candidate generates. Writes nothing. */
  async quote(userId: string, dto: QuoteDocumentsDto) {
    const target = await this.targetFor(userId, dto);
    const items = this.normalize(dto.items);
    const privateHash = target.privateVacancy ? createHash('sha256').update(JSON.stringify(target.privateVacancy)).digest('hex') : null;
    const inFlight = await this.prisma.resume.findMany({ where: {
      userId, matchId: target.match?.id ?? null, isBase: false, status: 'PENDING',
      ...(privateHash ? { provenance: { path: ['privateVacancyHash'], equals: privateHash } } : {}),
      docKind: { in: items.map((i) => i.kind as DocumentKind) },
    }, select: { docKind: true } });
    const reused = new Set(inFlight.map((r) => r.docKind as string));
    const units = items.filter((i) => !reused.has(i.kind)).length;
    const detected = detectLanguage(target.privateVacancy ? [target.input.position, target.input.description, target.input.requirements, target.input.responsibilities].join('\n') : this.vacancyText(target.match!));
    const allowance = await this.allowance.view(userId);
    const check = await this.allowance.check(userId, units);
    return {
      matchId: target.match?.id ?? null,
      items: items.map((i) => ({ kind: i.kind, language: i.language ?? detected, alreadyRunning: reused.has(i.kind) })),
      detectedLanguage: detected,
      units,
      affordable: check.affordable,
      refusal: check.refusal,
      allowance,
      remainingAfter: allowance.remaining == null ? null : Math.max(0, allowance.remaining - units),
    };
  }

  async generate(userId: string, dto: GenerateDocumentsDto, opts: { legacyBaseResumeId?: string; skipCostCheck?: boolean; parentId?: string; previousParagraphs?: LetterParagraph[] } = {}): Promise<GenerateResult> {
    const target = await this.targetFor(userId, dto);
    const match = target.match;
    const matchId = match?.id ?? null;
    const privateHash = target.privateVacancy ? createHash('sha256').update(JSON.stringify(target.privateVacancy)).digest('hex') : null;
    const items = this.normalize(dto.items);
    if (opts.legacyBaseResumeId) {
      const base = await this.prisma.resume.findFirst({ where: { id: opts.legacyBaseResumeId, userId, isBase: true } });
      if (!base) throw new NotFoundException('Əsas CV tapılmadı');
    }
    // Generation always reads the saved profile (the candidate's corrected facts), never the raw extraction of an uploaded file.
    const profile = await this.prisma.profile.findUnique({ where: { userId }, include: { experiences: true } });
    if (!profile || (!profile.headline && profile.experiences.length === 0 && profile.skills.length === 0)) {
      throw new BadRequestException('Sənəd yaratmaq üçün zəhmət olmasa əvvəlcə profilinizi (başlıq, bacarıqlar, iş təcrübəsi) doldurun');
    }
    if (dto.letter?.storyIds?.length) {
      // Only the candidate's own confirmed stories can be chosen; anything else is refused rather than silently ignored.
      const owned = await this.prisma.careerEntry.count({ where: { userId, kind: 'STORY', status: 'CONFIRMED', id: { in: dto.letter.storyIds } } });
      if (owned !== new Set(dto.letter.storyIds).size) throw new BadRequestException('Seçilmiş hekayələrdən biri sizin təsdiqlənmiş qeydlərinizə aid deyil');
    }
    if (dto.selectedCareerEntryIds != null) {
      const owned = await this.prisma.careerEntry.count({ where: {
        userId, status: 'CONFIRMED',
        kind: { in: ['PROJECT', 'VOLUNTEERING', 'LEADERSHIP', 'EXTRACURRICULAR', 'AWARD', 'CERTIFICATION'] },
        id: { in: dto.selectedCareerEntryIds },
      } });
      if (owned !== new Set(dto.selectedCareerEntryIds).size) throw new BadRequestException('Seçilmiş qeydlərdən biri sizin təsdiqlənmiş məlumatlarınıza aid deyil');
    }
    const detected = detectLanguage(target.privateVacancy ? [target.input.position, target.input.description, target.input.requirements, target.input.responsibilities].join('\n') : this.vacancyText(match!));
    const bundleId = dto.requestId ? `req_${createHash('sha256').update(`${userId}:${dto.requestId}`).digest('hex').slice(0, 24)}` : `bnd_${createHash('sha256').update(`${userId}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 24)}`;
    const letterInputs: LetterInputs | undefined = dto.letter ? { motivation: dto.letter.motivation?.trim() || undefined, companyReason: dto.letter.companyReason?.trim() || undefined, formative: dto.letter.formative?.trim() || undefined, contribution: dto.letter.contribution?.trim() || undefined, storyIds: dto.letter.storyIds } : undefined;

    await this.releaseStalePending(userId);
    const ceiling = this.dailyCeiling();
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`resume-tailor:${userId}`}))`;
      if (dto.requestId) {
        const replay = await tx.resume.findMany({ where: { userId, bundleId }, orderBy: { createdAt: 'asc' } });
        if (replay.length) return { documents: replay, created: [] as Resume[], units: 0 };
      }
      const documents: Resume[] = [];
      const created: Resume[] = [];
      const toCreate: { kind: RequestedKind; language?: string }[] = [];
      for (const item of items) {
        const inFlight = await tx.resume.findFirst({ where: {
          userId, matchId, isBase: false, status: 'PENDING',
          ...(privateHash ? { provenance: { path: ['privateVacancyHash'], equals: privateHash } } : {}),
          docKind: item.kind as DocumentKind,
        }, orderBy: { createdAt: 'desc' } });
        if (inFlight) documents.push(inFlight);
        else toCreate.push(item);
      }
      if (!opts.skipCostCheck && dto.expectedUnits !== toCreate.length) {
        throw new ConflictException({ statusCode: 409, code: 'COST_MISMATCH', message: 'Sənədlərin dəyəri dəyişib. Yenidən yoxlayın.', expectedUnits: dto.expectedUnits, actualUnits: toCreate.length });
      }
      if (ceiling != null) {
        const recent = await tx.resume.count({ where: { userId, isBase: false, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
        if (recent + toCreate.length > ceiling) throw new HttpException(`Gündəlik fərdiləşdirmə limiti (${ceiling}) dolub. Sabah yenidən cəhd edin.`, HttpStatus.TOO_MANY_REQUESTS);
      }
      for (const item of toCreate) {
        const existing = await tx.resume.count({ where: {
          userId, matchId, docKind: item.kind as DocumentKind,
          ...(privateHash ? { provenance: { path: ['privateVacancyHash'], equals: privateHash } } : {}),
        } });
        const row = await tx.resume.create({
          data: {
            userId, isBase: false, fileUrl: null, version: existing + 1, matchId, privateVacancy: target.privateVacancy as any, status: 'PENDING',
            docKind: item.kind as DocumentKind, language: item.language ?? detected, bundleId,
            letterInputs: item.kind === 'LETTER' && (letterInputs || opts.previousParagraphs) ? ({ ...(letterInputs ?? {}), ...(opts.previousParagraphs ? { previous: opts.previousParagraphs } : {}) } as any) : undefined,
            provenance: {
              bundleId, requestedLanguage: item.language ?? null,
              ...(privateHash ? { privateVacancyHash: privateHash, privateVacancy: { title: target.input.position, company: target.input.company || null, location: target.input.location || null, sourceUrl: target.privateVacancy?.sourceUrl ?? null, deadline: target.privateVacancy?.deadline ?? null } } : {}),
              ...(dto.selectedCareerEntryIds != null ? { selectedCareerEntryIds: [...new Set(dto.selectedCareerEntryIds)] } : {}), ...(opts.parentId ? { parentId: opts.parentId } : {}),
            } as any,
          },
        });
        created.push(row);
        documents.push(row);
      }
      if (created.length) {
        await this.allowance.lock(tx, userId);
        await this.allowance.reserve(tx, userId, created.map((r) => r.id));
      }
      return { documents, created, units: created.length };
    });

    for (const row of outcome.created) {
      await this.usage?.record(userId, row.docKind === 'LETTER' ? 'tailored.cover_letter' : 'tailored.cv', 'month');
    }
    const enqueued: string[] = [];
    try {
      for (const row of outcome.created) {
        // jobId = row id: a repeated enqueue of the same row is a no-op.
        await this.queue.add('tailor-resume', { resumeId: row.id }, { jobId: row.id, removeOnComplete: true, removeOnFail: { age: 24 * 60 * 60 } });
        enqueued.push(row.id);
      }
    } catch {
      const failed = outcome.created.filter((r) => !enqueued.includes(r.id));
      await this.prisma.$transaction(async (tx) => {
        for (const row of failed) {
          await tx.resume.update({ where: { id: row.id }, data: { status: 'FAILED', statusError: 'Növbəyə əlavə edilmədi. Yenidən cəhd edin. (QUEUE_UNAVAILABLE)' } });
          await this.allowance.refund(tx, row.id, `${SYSTEM_REASON}queue_unavailable`);
        }
      });
      throw new ServiceUnavailableException('Sənəd hazırlama növbəsi əlçatan deyil. Bir az sonra yenidən cəhd edin.');
    }
    return { bundleId: outcome.documents[0]?.bundleId ?? bundleId, created: outcome.created.length > 0, documents: outcome.documents, units: outcome.units };
  }

  /**
   * A new draft of an existing document (another language, different wording). It is a new generation and costs one unit; the earlier
   * document — and any approval — is untouched until the candidate approves the new draft. For a letter, paragraphs the candidate marked approved
   * are kept word for word.
   */
  async regenerate(userId: string, id: string, dto: RegenerateDocumentDto): Promise<GenerateResult> {
    const source = await this.prisma.resume.findFirst({ where: { id, userId, isBase: false } });
    if (!source || (!source.matchId && !source.privateVacancy)) throw new NotFoundException('Sənəd tapılmadı');
    if (source.status === 'PENDING' || source.status === 'FAILED') throw new ConflictException('Bu sənəd hələ yoxlanmağa hazır deyil');
    const letterSource = isLetter(source.parsedContent) ? (source.parsedContent as unknown as LetterContent) : null;
    const prevInputs = ((source.letterInputs ?? {}) as LetterInputs) || {};
    const letter = source.docKind === 'LETTER'
      ? { motivation: dto.letter?.motivation ?? prevInputs.motivation, companyReason: dto.letter?.companyReason ?? prevInputs.companyReason, formative: dto.letter?.formative ?? prevInputs.formative, contribution: dto.letter?.contribution ?? prevInputs.contribution, storyIds: dto.letter?.storyIds ?? prevInputs.storyIds }
      : undefined;
    return this.generate(
      userId,
      { ...(source.matchId ? { matchId: source.matchId } : { privateVacancy: source.privateVacancy as any }), items: [{ kind: source.docKind as RequestedKind, language: dto.language ?? source.language ?? undefined }], expectedUnits: dto.expectedUnits, requestId: dto.requestId, letter, selectedCareerEntryIds: dto.selectedCareerEntryIds ?? (source.provenance as any)?.selectedCareerEntryIds },
      { parentId: source.id, previousParagraphs: letterSource?.paragraphs },
    );
  }

  /** The candidate's own documents (newest first), optionally for one match and/or kind. */
  async list(userId: string, filter: { matchId?: string; kind?: DocumentKind } = {}) {
    await this.releaseStalePending(userId);
    const rows = await this.prisma.resume.findMany({
      where: { userId, isBase: false, ...(filter.matchId ? { matchId: filter.matchId } : {}), ...(filter.kind ? { docKind: filter.kind } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.summary(r));
  }

  /**
   * The answers of the candidate's most recent letter that stay true across vacancies (which experience made the interest clearer, the contribution to notice), so
   * the questions are not asked again from scratch. Reasons that belong to one vacancy (what attracts them to THIS work, what caught their eye at THIS employer)
   * are not returned. Only the candidate's own rows; the candidate may edit everything before sending.
   */
  async latestReusableLetterAnswers(userId: string): Promise<{ formative: string | null; contribution: string | null; fromDocumentId: string | null }> {
    const rows = await this.prisma.resume.findMany({
      where: { userId, isBase: false, docKind: 'LETTER', status: { in: ['NEEDS_REVIEW', 'READY'] } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, letterInputs: true },
    });
    for (const r of rows) {
      const v = ((r.letterInputs ?? {}) as LetterInputs) || {};
      const formative = (v.formative ?? '').trim();
      const contribution = (v.contribution ?? '').trim();
      if (formative || contribution) return { formative: formative || null, contribution: contribution || null, fromDocumentId: r.id };
    }
    return { formative: null, contribution: null, fromDocumentId: null };
  }

  summary(r: Resume) {
    return {
      id: r.id, kind: r.docKind, language: r.language, status: r.status, statusError: r.statusError, bundleId: r.bundleId,
      matchId: r.matchId, version: r.version, createdAt: r.createdAt, reviewedAt: r.reviewedAt, fileUrl: r.status === 'READY' ? r.fileUrl : null,
    };
  }

  /** Rows whose worker was lost become FAILED and give their unit back (see DocumentAllowanceService.sweep). */
  async releaseStalePending(userId: string, now = new Date()): Promise<void> {
    await this.prisma.resume.updateMany({
      where: { userId, isBase: false, status: 'PENDING', createdAt: { lt: new Date(now.getTime() - 15 * 60 * 1000) } },
      data: { status: 'FAILED', statusError: 'CV hazırlanması vaxtında tamamlanmadı. Yenidən cəhd edin. (STALE)' },
    });
    await this.allowance.sweep(userId, now);
  }
}
