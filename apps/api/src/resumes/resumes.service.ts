import { activePlanOverrides, effectivePlan } from '../billing/entitlement';
import { Optional } from '@nestjs/common';
import { Logger, Injectable, ForbiddenException, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/database.service';
import { LocalStorageService } from './local-storage.service';
import { parseCv, parseLinkedInProfile, type ParsedCv } from './cv-parser';
import { extractCvDocument, type LayoutLine } from './cv-extract';
import { validateLinkedInProfileUrl } from './linkedin-url-extract';
import { readPublicLinkedInProfile } from './linkedin-public-reader';
import { isJobActionable } from '../jobs/jobs.service';
import { ResumeTailorService } from './tailor/resume-tailor.service';
import { CareerEntriesService } from '../career/career-entries.service';
import { fullCareerSections } from '../career/career-selection';
import { applyLetterEdits, applyReviewEdits, TailorOutputError } from './tailor/tailor-facts';
import { untranslatedItems } from './tailor/az-translate';
import { prismaTranslationStore, withTranslationMemory } from './tailor/translation-memory';
import { isLetter, type DocumentContent, type LetterContent, type TailoredContent } from './tailor/resume-tailor.types';
import { DocumentsService } from '../documents/documents.service';
import { recordSnapshot, sha256Hex } from '../documents/snapshots';

@Injectable()
export class ResumesService {
  private readonly logger = new Logger(ResumesService.name);
  // Queues same-user uploads in this process so a double submit replaces in
  // order instead of losing the compare-and-set below. Correctness does not
  // depend on it: other processes are still guarded by that compare-and-set.
  private readonly baseUploadGates = new Map<string, Promise<unknown>>();

  constructor(
    private prisma: PrismaService,
    private storageService: LocalStorageService,
    private tailorService: ResumeTailorService,
    private documents: DocumentsService,
    // Suggestions read from the upload (projects, certifications, languages…) wait for the candidate's confirmation.
    @Optional() private career?: CareerEntriesService,
  ) {}

  /** Marks tailored rows whose worker never finished as failed (retryable) and returns their allowance unit. */
  private async failStalePending(userId: string) {
    await this.documents.releaseStalePending(userId);
  }

  async getResumes(userId: string) {
    await this.failStalePending(userId);
    return this.prisma.resume.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async uploadBaseResume(userId: string, file: Express.Multer.File) {
    const previous = this.baseUploadGates.get(userId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.uploadBaseResumeSerialized(userId, file));
    this.baseUploadGates.set(userId, current);
    try {
      return await current;
    } finally {
      if (this.baseUploadGates.get(userId) === current) {
        this.baseUploadGates.delete(userId);
      }
    }
  }

  /** Pasted profile text or LinkedIn profile URL → structured fields for review (no file, nothing stored). */
  async parseImportedText(userId: string, text: string, allowPublicReader = false) {
    const clean = text.replace(/\u0000/g, '').trim();
    if (/^(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?linkedin\.com\/in\/\S+$/i.test(clean)) {
      return this.parseImportedUrl(userId, clean, allowPublicReader);
    }
    if (/^\s*https?:\/\/\S+\s*$/.test(clean)) {
      throw new BadRequestException('Keçid yalnız rəsmi LinkedIn profil ünvanı (məs: https://www.linkedin.com/in/ad-soyad) ola bilər.');
    }
    if (clean.length < 40) throw new BadRequestException('Mətn çox qısadır. LinkedIn profilinizin mətnini (Təcrübə, Təhsil, Bacarıqlar) tam kopyalayın.');
    if (clean.length > 60_000) throw new BadRequestException('Mətn çox uzundur (maksimum 60 000 simvol).');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    const parsed = parseCv(clean, { name: user?.name, email: user?.email });
    if (parsed.extracted.length === 0) throw new BadRequestException('Mətndən heç bir məlumat çıxarıla bilmədi. Təcrübə və Təhsil bölmələri ilə birlikdə kopyalayın.');
    return { parsedContent: parsed, source: 'text' };
  }

  /** Extracts profile from a public LinkedIn profile URL for review and merging. */
  async parseImportedUrl(userId: string, url: string, allowPublicReader = false) {
    const validated = validateLinkedInProfileUrl(url);
    if (!validated.valid || !validated.normalizedUrl) {
      throw new BadRequestException(validated.error || 'Düzgün LinkedIn profil keçidi daxil edin');
    }
    const { profile, method } = await readPublicLinkedInProfile(validated.normalizedUrl, allowPublicReader);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    const parsed = parseLinkedInProfile(profile, { name: user?.name, email: user?.email });
    if (parsed.extracted.length === 0) {
      throw new BadRequestException('LinkedIn profilindən heç bir məlumat çıxarıla bilmədi. Profil mətnini kopyalayıb yapışdırın və ya PDF yükləyin.');
    }
    return { parsedContent: parsed, source: 'url', importMethod: method };
  }

  /** An uploaded PDF read for review and merging: nothing is stored and the base CV is untouched. */
  async parseImportedFile(userId: string, file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Fayl boşdur. LinkedIn-dən saxladığınız PDF-i yükləyin.');
    let doc: { text: string; lines?: LayoutLine[] };
    try {
      doc = await extractCvDocument(file.buffer, file.mimetype);
    } catch (error) {
      this.logger.warn(`İdxal faylı oxunmadı (userId=${userId}): ${error instanceof Error ? error.message : String(error)}`);
      throw new BadRequestException('PDF oxuna bilmədi. LinkedIn profilinizdə “Save to PDF” ilə saxladığınız faylı yükləyin.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    const parsed = parseCv(doc.text, { name: user?.name, email: user?.email }, doc.lines);
    if (parsed.extracted.length === 0) throw new BadRequestException('Fayldan heç bir məlumat çıxarıla bilmədi. Skan edilmiş PDF-lər oxunmur; mətnli PDF yükləyin.');
    return { parsedContent: parsed, source: 'file' };
  }

  private async uploadBaseResumeSerialized(userId: string, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Fayl təqdim edilməyib');
    }
    if (!file.buffer?.length) {
      throw new BadRequestException('Fayl boşdur. PDF və ya DOCX yükləyin (maksimum 10MB).');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true, planOverrides: activePlanOverrides() },
    });

    const plan = effectivePlan(user);

    let parsedContent: ParsedCv;
    try {
      const doc = await extractCvDocument(file.buffer, file.mimetype);
      parsedContent = parseCv(doc.text, { name: user?.name, email: user?.email }, doc.lines);
      if (parsedContent.extracted.length === 0) {
        this.logger.warn(
          `CV-dən heç bir məlumat çıxarılmadı (userId=${userId}, mime=${file.mimetype}) — ehtimal ki, skan edilmiş sənəddir`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `CV mətni çıxarıla bilmədi (userId=${userId}, mime=${file.mimetype}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException(
        'CV oxuna bilmədi. Fayl zədələnmiş ola bilər — PDF və ya DOCX yükləyin və yenidən cəhd edin.',
      );
    }

    const existingBaseResumes = await this.prisma.resume.findMany({
      where: { userId, isBase: true },
      orderBy: { createdAt: 'desc' },
    });

    const usableBase = existingBaseResumes.find((resume) =>
      this.storageService.fileExists(resume.fileUrl),
    );

    const fileUrl = await this.storageService.uploadFile(file);

    const staleBaseResume = existingBaseResumes.find(
      (resume) => !this.storageService.fileExists(resume.fileUrl),
    );

    const replaced = plan !== 'Limitsiz' ? usableBase ?? staleBaseResume : undefined;
    try {
      if (!replaced) {
        const created = await this.prisma.resume.create({
          data: {
            userId,
            isBase: true,
            fileUrl,
            parsedContent: parsedContent as any,
            version: 1,
            status: 'READY',
            statusError: null,
          },
        });
        await this.suggestCareerEntries(userId, parsedContent, created.id);
        return (await this.prisma.resume.findUnique({ where: { id: created.id } })) ?? created;
      }
      // Compare-and-set on the file we read: if another request replaced or
      // deleted this row meanwhile, fail instead of overwriting its result.
      const { count } = await this.prisma.resume.updateMany({
        where: { id: replaced.id, userId, fileUrl: replaced.fileUrl },
        data: {
          fileUrl,
          parsedContent: parsedContent as any,
          version: { increment: 1 },
          status: 'READY',
          statusError: null,
        },
      });
      if (count === 0) {
        throw new ConflictException('CV eyni vaxtda dəyişdirildi. Səhifəni yeniləyin və yenidən cəhd edin.');
      }
    } catch (error) {
      await this.storageService.deleteFile(fileUrl).catch(() => undefined);
      throw error;
    }

    // Committed: the row no longer points at the old file, so it is ours to
    // release. A failure here only leaves an orphaned file behind.
    if (replaced.fileUrl && replaced.fileUrl !== fileUrl) {
      await this.releaseUnreferencedFile(replaced.fileUrl).catch((error) => {
        this.logger.warn(`Köhnə CV faylı silinmədi (userId=${userId}): ${error instanceof Error ? error.message : error}`);
      });
    }
    const updated = await this.prisma.resume.findUnique({ where: { id: replaced.id } });
    if (!updated) {
      throw new ConflictException('CV eyni vaxtda silindi. Səhifəni yeniləyin və yenidən cəhd edin.');
    }
    await this.suggestCareerEntries(userId, parsedContent, updated.id);
    return (await this.prisma.resume.findUnique({ where: { id: updated.id } })) ?? updated;
  }

  /** Never fails the upload: suggestions are a convenience, and the document itself is already stored. */
  private async suggestCareerEntries(userId: string, parsed: ParsedCv, resumeId: string) {
    try {
      const out = await this.career?.addSuggestionsFromUpload(userId, parsed.careerSuggestions, resumeId);
      if (out && out.limited > 0) {
        // New suggestions that did not fit under the entry limit are added to what the parser already reported as left out, so the candidate is told.
        const row = await this.prisma.resume.findUnique({ where: { id: resumeId }, select: { parsedContent: true } });
        const content = (row?.parsedContent ?? {}) as Record<string, any>;
        const omitted = { ...(content.omitted ?? {}), careerSuggestions: (content.omitted?.careerSuggestions ?? 0) + out.limited };
        await this.prisma.resume.update({ where: { id: resumeId }, data: { parsedContent: { ...content, omitted } as any } });
      }
    } catch (error) {
      this.logger.warn(`Karyera təklifləri saxlanmadı (userId=${userId}): ${error instanceof Error ? error.message : error}`);
    }
  }

  async deleteResume(userId: string, id: string) {
    const resume = await this.prisma.resume.findUnique({
      where: { id },
    });

    if (!resume) {
      throw new NotFoundException('CV tapılmadı');
    }

    if (resume.userId !== userId) {
      throw new ForbiddenException('Bu CV-ni silmək səlahiyyətiniz yoxdur');
    }

    // Delete the row only if it still points at the file we read, and release
    // that file afterwards — never a file a newer replacement just installed.
    const { count } = await this.prisma.resume.deleteMany({
      where: { id, userId, fileUrl: resume.fileUrl },
    });
    if (count === 0) {
      throw new ConflictException('CV eyni vaxtda dəyişdirildi. Səhifəni yeniləyin və yenidən cəhd edin.');
    }
    if (resume.fileUrl) {
      await this.releaseUnreferencedFile(resume.fileUrl).catch((error) => {
        this.logger.warn(`Silinmiş CV faylı silinmədi (userId=${userId}): ${error instanceof Error ? error.message : error}`);
      });
    }
    return resume;
  }

  // New applications attach their own copy of the CV (JobApplicationsService),
  // so only applications created before that change still point at a resume's
  // file. Keep those readable.
  private async releaseUnreferencedFile(fileUrl: string): Promise<void> {
    const [applicationFiles, applicationAnswers] = await Promise.all([
      this.prisma.applicationFile.count({ where: { fileUrl } }),
      this.prisma.applicationAnswer.count({ where: { fileUrl } }),
    ]);
    if (applicationFiles + applicationAnswers > 0) return;
    await this.storageService.deleteFile(fileUrl).catch(() => undefined);
  }

  /**
   * Requests a tailored CV for one of the candidate's own matches (the original single-document endpoint). It is the documents pipeline with one CV
   * item: the same validation, the same atomic allowance reservation, the same in-flight dedupe. No provider call or file happens here.
   */
  async createTailoredResume(userId: string, data: any) {
    const { matchId, baseResumeId } = data;
    if (!matchId) {
      throw new BadRequestException('Uyğunluq ID-si tələb olunur');
    }
    const result = await this.documents.generate(
      userId,
      { matchId, items: [{ kind: 'CV' }], expectedUnits: 1 },
      { legacyBaseResumeId: baseResumeId, skipCostCheck: true },
    );
    return result.documents[0];
  }

  private async ownedTailored(userId: string, id: string) {
    await this.failStalePending(userId);
    const resume = await this.prisma.resume.findFirst({
      where: { id, userId, isBase: false },
      include: { match: { include: { job: true, vacancy: { include: { company: true } } } } },
    });
    // Another candidate's id is indistinguishable from a missing one.
    if (!resume) throw new NotFoundException('CV tapılmadı');
    return resume;
  }

  /** English prose still present in an Azerbaijani CV (empty for other languages, letters and documents without content). */
  private untranslatedOf(resume: { language: string | null; docKind: string; parsedContent: unknown }) {
    const content = resume.parsedContent as DocumentContent | null;
    if (resume.language !== 'az' || !content) return [];
    return untranslatedItems(content);
  }

  async getTailoredResume(userId: string, id: string) {
    const resume = await this.ownedTailored(userId, id);
    const posting = resume.match?.job ?? resume.match?.vacancy;
    const privateVacancy = resume.privateVacancy as { title?: string; company?: string | null; location?: string | null; sourceUrl?: string | null; deadline?: string | null } | null;
    const [snapshots, charge] = await Promise.all([
      this.prisma.documentSnapshot.findMany({
        where: { resumeId: id },
        orderBy: [{ revision: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, revision: true, kind: true, contentHash: true, fileSha256: true, createdAt: true },
      }),
      this.prisma.documentCharge.findUnique({ where: { resumeId: id }, select: { status: true, periodKey: true } }),
    ]);
    return {
      id: resume.id,
      // A private pasted vacancy is deliberately not represented by a shared Match row.
      matchId: resume.matchId ?? null,
      kind: resume.docKind,
      language: resume.language,
      bundleId: resume.bundleId,
      status: resume.status,
      statusError: resume.statusError,
      version: resume.version,
      fileUrl: resume.status === 'READY' ? resume.fileUrl : null,
      reviewedAt: resume.reviewedAt,
      createdAt: resume.createdAt,
      content: resume.parsedContent,
      reviewNotes: resume.reviewNotes,
      // What is still English in an Azerbaijani document (path, text, section); returned in draft and ready states.
      untranslated: this.untranslatedOf(resume),
      // How long the document is as it would be approved (a draft only), so a concise resume that has grown past one page is flagged in review, not discovered in the PDF.
      layout: resume.parsedContent && resume.status === 'NEEDS_REVIEW' ? this.tailorService.layoutFor(resume.parsedContent as unknown as DocumentContent, resume.docKind as 'CV' | 'RESUME' | 'LETTER') : null,
      generation: resume.generationMeta
        ? { calls: (resume.generationMeta as any).calls, model: (resume.generationMeta as any).model }
        : privateVacancy ? {
            title: privateVacancy.title ?? 'Vakansiya',
            company: privateVacancy.company ?? null,
            location: privateVacancy.location ?? null,
            sourceUrl: privateVacancy.sourceUrl ?? null,
            actionable: !privateVacancy.deadline || new Date(privateVacancy.deadline).getTime() >= Date.now(),
          } : null,
      privateVacancy,
      // Where the facts came from: the vacancy reference (and a hash of its text), the career entries used, language, template, parent document.
      provenance: resume.provenance,
      letterInputs: resume.docKind === 'LETTER' ? this.publicLetterInputs(resume.letterInputs) : null,
      // Every version ever generated, edited or approved, with hashes. The PDF is only produced at approval.
      snapshots,
      allowance: charge ? { status: charge.status, period: charge.periodKey } : null,
      posting: posting
        ? {
            title: posting.title,
            company: resume.match?.job ? resume.match.job.company : resume.match?.vacancy?.company.name,
            actionable: resume.match?.job ? isJobActionable(resume.match.job) : resume.match?.vacancy?.status === 'ACTIVE',
          }
        : privateVacancy
          ? {
              title: privateVacancy.title ?? 'Vakansiya',
              company: privateVacancy.company ?? null,
              actionable: !privateVacancy.deadline || new Date(privateVacancy.deadline).getTime() >= Date.now(),
            }
          : null,
    };
  }

  private publicLetterInputs(inputs: unknown) {
    const v = (inputs ?? {}) as { motivation?: string; companyReason?: string; formative?: string; contribution?: string; storyIds?: string[] };
    return { motivation: v.motivation ?? null, companyReason: v.companyReason ?? null, formative: v.formative ?? null, contribution: v.contribution ?? null, storyIds: v.storyIds ?? [] };
  }

  private async personaFor(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: { experiences: { orderBy: { startDate: 'desc' } }, education: true },
    });
    // Review may add back any confirmed entry, so it sees all of them (generation selects; review chooses).
    const sections = fullCareerSections((await this.career?.confirmedFor(userId)) ?? []);
    return this.tailorService.buildPersonaFromProfile(user, profile, sections);
  }

  /**
   * Saves the candidate's review edits. Identity facts are re-applied from the
   * saved profile. Editing an approved document returns it to review and
   * withdraws its PDF until it is approved again. Every save appends an EDITED
   * snapshot; editing is free (it never touches the allowance).
   */
  async updateTailoredContent(userId: string, id: string, edits: Record<string, unknown>) {
    const resume = await this.ownedTailored(userId, id);
    if (resume.status !== 'NEEDS_REVIEW' && resume.status !== 'READY') {
      throw new ConflictException('Bu sənəd hələ yoxlanmağa hazır deyil');
    }
    let next: DocumentContent;
    try {
      const persona = await this.personaFor(userId);
      next = isLetter(resume.parsedContent)
        ? applyLetterEdits(resume.parsedContent as unknown as LetterContent, persona, edits)
        : applyReviewEdits(persona, resume.parsedContent as unknown as TailoredContent, edits);
    } catch (error) {
      if (error instanceof TailorOutputError) throw new BadRequestException(error.message);
      throw error;
    }
    const notes = (resume.reviewNotes ?? {}) as { issues?: unknown[]; revision?: number };
    const revision = notes.revision ?? 0;
    const saved = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.resume.updateMany({
        where: { id, userId, status: resume.status, reviewNotes: { path: ['revision'], equals: revision } },
        data: {
          parsedContent: next as any,
          reviewNotes: { ...notes, revision: revision + 1 } as any,
          status: 'NEEDS_REVIEW',
          reviewedAt: null,
          fileUrl: null,
        },
      });
      if (!count) return false;
      await recordSnapshot(tx, id, revision + 1, 'EDITED', next, resume.provenance);
      return true;
    });
    if (!saved) throw new ConflictException('Sənəd eyni vaxtda dəyişdirildi. Səhifəni yeniləyin.');
    if (resume.status === 'READY' && resume.fileUrl) {
      await this.releaseUnreferencedFile(resume.fileUrl).catch(() => undefined);
    }
    return this.getTailoredResume(userId, id);
  }

  /**
   * Asks again for the translation of the English text that is still in an Azerbaijani draft. Only text that still reads as English is sent; what is
   * accepted replaces it (through the normal edit path, so the revision and its snapshot are recorded) and the review notes are refreshed. Costs no
   * document allowance: it is part of the same draft.
   */
  async retranslateTailored(userId: string, id: string) {
    const resume = await this.ownedTailored(userId, id);
    if (resume.status !== 'NEEDS_REVIEW') throw new ConflictException('Yalnız yoxlanmamış qaralama yenidən tərcümə edilə bilər');
    if (resume.language !== 'az' || !resume.parsedContent) {
      throw new BadRequestException('Bu sənəd üçün tərcümə tələb olunmur');
    }
    const content = resume.parsedContent as unknown as DocumentContent;
    if (!untranslatedItems(content).length) return this.getTailoredResume(userId, id);
    const result = await withTranslationMemory(prismaTranslationStore(this.prisma as any, userId), () => this.tailorService.translateDocumentText(content));
    const translated = result.issues.filter((i) => i.code === 'translated').length;
    const notes = (resume.reviewNotes ?? {}) as { issues?: { code?: string }[]; revision?: number };
    const revision = notes.revision ?? 0;
    const kept = (notes.issues ?? []).filter(i => !['translated', 'not_translated', 'check_wording'].includes(i.code ?? ''));
    const nextNotes = { ...notes, revision: revision + (translated ? 1 : 0), issues: [...kept, ...result.issues] };
    const saved = await this.prisma.$transaction(async tx => {
      const { count } = await tx.resume.updateMany({
        where: { id, userId, status: 'NEEDS_REVIEW', reviewNotes: { path: ['revision'], equals: revision } },
        data: { ...(translated ? { parsedContent: result.content as any } : {}), reviewNotes: nextNotes as any },
      });
      if (count && translated) await recordSnapshot(tx, id, revision + 1, 'EDITED', result.content, resume.provenance);
      return count;
    });
    if (!saved) throw new ConflictException('Sənəd eyni vaxtda dəyişdirildi. Səhifəni yeniləyin.');
    return this.getTailoredResume(userId, id);
  }

  /**
   * The candidate approves the reviewed draft: only now is the PDF produced.
   * The write is conditional on the reviewed revision, so a concurrent edit
   * or second approval cannot mark a stale PDF as final; a losing attempt
   * removes the file it uploaded. The APPROVED snapshot records the exact
   * content and the SHA-256 of the PDF that was approved.
   */
  async approveTailoredResume(
    userId: string,
    id: string,
    dto?: { acknowledgeUntranslated?: boolean; reviewedRevision?: number },
  ) {
    const resume = await this.ownedTailored(userId, id);
    if (resume.status === 'READY') return this.getTailoredResume(userId, id);
    if (resume.status !== 'NEEDS_REVIEW') throw new ConflictException('Bu sənəd təsdiqlənməyə hazır deyil');
    const notes = (resume.reviewNotes ?? {}) as { issues?: unknown[]; revision?: number };
    const revision = notes.revision ?? 0;

    // An Azerbaijani CV must be Azerbaijani: English paragraphs that could not be translated reliably are listed in the review.
    // The candidate can either translate/rewrite them or acknowledge partial translations to proceed.
    const pending = this.untranslatedOf(resume);
    if (pending.length) {
      if (!dto?.acknowledgeUntranslated) {
        throw new ConflictException(`Sənədin ${pending.length} hissəsi hələ Azərbaycan dilinə çevrilməyib. Onları tərcümə edin, öz sözlərinizlə yazın və ya yenidən cəhd edin. (NOT_TRANSLATED)`);
      }
      if (dto.reviewedRevision === undefined || dto.reviewedRevision !== revision) {
        throw new ConflictException('Sənəd dəyişdirildi. Zəhmət olmasa yenilənmiş versiyanı yoxlayın.');
      }
    }

    let pdf: Buffer;
    try {
      pdf = this.tailorService.compileDocumentPdf(resume.parsedContent as unknown as DocumentContent);
    } catch {
      throw new BadRequestException('PDF yaradıla bilmədi. Məzmunu yoxlayıb yenidən cəhd edin. (PDF_FAILED)');
    }
    const fileUrl = await this.storageService.uploadBuffer(pdf, 'application/pdf');
    const nextReviewNotes = {
      ...notes,
      ...(dto?.acknowledgeUntranslated ? { untranslatedAcknowledged: true, acknowledgedUntranslatedCount: pending.length } : {}),
    };
    const approved = await this.prisma
      .$transaction(async (tx) => {
        const { count } = await tx.resume.updateMany({
          where: { id, userId, status: 'NEEDS_REVIEW', reviewNotes: { path: ['revision'], equals: revision } },
          data: { status: 'READY', fileUrl, reviewedAt: new Date(), statusError: null, reviewNotes: nextReviewNotes as any },
        });
        if (!count) return false;
        await recordSnapshot(tx, id, revision, 'APPROVED', resume.parsedContent, resume.provenance, sha256Hex(pdf));
        return true;
      })
      .catch(async (error) => {
        await this.storageService.deleteFile(fileUrl).catch(() => undefined);
        throw error;
      });
    if (!approved) {
      await this.storageService.deleteFile(fileUrl).catch(() => undefined);
      const current = await this.ownedTailored(userId, id);
      if (current.status === 'READY') return this.getTailoredResume(userId, id);
      throw new ConflictException('Sənəd eyni vaxtda dəyişdirildi. Səhifəni yeniləyin.');
    }
    return this.getTailoredResume(userId, id);
  }

  /**
   * The PDF of a document as it is now: the stored approved file once approved, otherwise the draft compiled by the same call approval uses
   * — so what the candidate previews is what they download. Free (no allowance), owner-only, never cached.
   */
  async previewPdf(userId: string, id: string): Promise<{ bytes: Buffer; approved: boolean }> {
    const resume = await this.ownedTailored(userId, id);
    if (resume.status === 'READY' && resume.fileUrl && this.storageService.fileExists(resume.fileUrl)) {
      return { bytes: await this.storageService.readUpload(resume.fileUrl), approved: true };
    }
    if (resume.status !== 'NEEDS_REVIEW' && resume.status !== 'READY') throw new ConflictException('Bu sənəd hələ yoxlanmağa hazır deyil');
    try {
      return { bytes: this.tailorService.compileDocumentPdf(resume.parsedContent as unknown as DocumentContent), approved: false };
    } catch {
      throw new BadRequestException('PDF yaradıla bilmədi. Məzmunu yoxlayıb yenidən cəhd edin. (PDF_FAILED)');
    }
  }

  async updateResumeContent(userId: string, id: string, parsedContent: any) {
    const resume = await this.prisma.resume.findUnique({
      where: { id },
    });

    if (!resume) {
      throw new NotFoundException('CV tapılmadı');
    }

    if (resume.userId !== userId) {
      throw new ForbiddenException('Bu CV-ni dəyişmək səlahiyyətiniz yoxdur');
    }
    // Tailored CVs change only through the fact-checked review path.
    if (!resume.isBase) {
      throw new BadRequestException('Fərdiləşdirilmiş CV yalnız yoxlama bölməsində redaktə edilir');
    }

    return this.prisma.resume.update({
      where: { id },
      data: {
        parsedContent,
      },
    });
  }
}
