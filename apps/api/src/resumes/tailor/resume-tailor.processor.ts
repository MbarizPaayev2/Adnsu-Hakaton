import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { Logger, Optional } from '@nestjs/common';
import { CareerEntriesService } from '../../career/career-entries.service';
import { experienceMonths, fullCareerSections, leftOutEntries, selectCareerSections } from '../../career/career-selection';
import { PrismaService } from '../../database/database.service';
import { DocumentAllowanceService, SYSTEM_REASON } from '../../documents/document-allowance.service';
import { recordSnapshot } from '../../documents/snapshots';
import { isJobActionable } from '../../jobs/jobs.service';
import { ResumeTailorService, TailorError } from './resume-tailor.service';
import type { DocumentContent, LetterParagraph } from './resume-tailor.types';
import { isLetter } from './resume-tailor.types';
import { collectAiUsage, type AiCallEvent } from './ai-usage';
import { prismaTranslationStore, withTranslationMemory } from './translation-memory';

interface ResumeTailorJobData {
  resumeId: string;
}

/** What the candidate typed or chose for a letter. The motivation counts as the candidate's own facts; it is never the vacancy text. */
/** 'writer' when a verified writer draft (letter) or at least one verified rewording (CV) is in the document; otherwise 'composed'. */
export function generationPath(outcomes: string[] = []): 'writer' | 'composed' {
  if (outcomes.includes('written')) return 'writer';
  const polish = outcomes.map((o) => /^polish:(\d+)\/(\d+)$/.exec(o)).find(Boolean);
  if (polish && Number(polish[1]) > 0) return 'writer';
  return 'composed';
}
/** The writer was asked (a letter attempt or a CV polish) and nothing it produced is in the document. */
export function wasWriterTried(outcomes: string[] = []): boolean {
  return outcomes.some((o) => o.startsWith('writer:') || o.startsWith('polish:') || o === 'polish-unavailable' || o.startsWith('polish-'));
}

export interface LetterInputs {
  motivation?: string;
  storyIds?: string[];
  companyReason?: string;
  formative?: string;
  contribution?: string;
  /** The letter being regenerated: its approved paragraphs are kept word for word. */
  previous?: LetterParagraph[];
}

/**
 * Generates a draft for a PENDING document row (CV, concise resume or job-specific letter). The draft is fact-checked and left in NEEDS_REVIEW
 * with no file: the PDF is produced only when the candidate approves it (ResumesService.approveTailoredResume).
 *
 * The draft, its GENERATED snapshot and the allowance COMMIT are one transaction, so a document exists exactly when its generation was counted;
 * a failure marks the row FAILED and REFUNDS the reserved unit in one transaction. Idempotent under BullMQ re-delivery (stalled job, duplicate
 * enqueue): only a row that is still PENDING is processed. Logs carry ids and error codes only — never CV content, model output or credentials.
 */
@Processor('resume-tailor')
export class ResumeTailorProcessor extends WorkerHost {
  private readonly logger = new Logger(ResumeTailorProcessor.name);

  constructor(
    private prisma: PrismaService,
    private tailorService: ResumeTailorService,
    @Optional() private career?: CareerEntriesService,
    @Optional() private allowance?: DocumentAllowanceService,
  ) {
    super();
  }

  async process(job: Job<ResumeTailorJobData, any, string>): Promise<void> {
    const { resumeId } = job.data;
    const resume = await this.prisma.resume.findUnique({
      where: { id: resumeId },
      include: { user: true, match: { include: { job: true, vacancy: { include: { company: true } } } } },
    });
    if (!resume || resume.status !== 'PENDING') {
      this.logger.log(`resume-tailor ${resumeId}: nothing to do (${resume ? resume.status : 'missing'})`);
      return;
    }

    const startedAt = Date.now();
    const queueMs = typeof job.timestamp === 'number' && job.timestamp > 0 ? Math.max(0, startedAt - job.timestamp) : null;
    const calls: AiCallEvent[] = [];
    let renderMs: number | null = null;
    try {
      const match = resume.match;
      const privateVacancy = resume.privateVacancy as any;
      const posting = match?.job ?? match?.vacancy ?? privateVacancy;
      const actionable = match?.job
        ? isJobActionable(match.job)
        : match?.vacancy ?
          match.vacancy.status === 'ACTIVE' &&
          match.vacancy.company.status === 'APPROVED' &&
          (!match.vacancy.deadline || match.vacancy.deadline.getTime() >= Date.now())
          : !!privateVacancy?.title && typeof privateVacancy?.originalText === 'string' &&
            (!privateVacancy.deadline || new Date(privateVacancy.deadline).getTime() >= Date.now());
      if (!posting || !actionable) throw new TailorError('JOB_NOT_ACTIONABLE');

      // The saved (candidate-corrected) profile is the only source of facts.
      const profile = await this.prisma.profile.findUnique({
        where: { userId: resume.userId },
        include: { experiences: { orderBy: { startDate: 'desc' } }, education: true },
      });
      const input = match?.job
        ? this.tailorService.buildJobInput(match.job)
        : match?.vacancy
          ? this.tailorService.buildVacancyInput(match.vacancy as any)
          : {
              id: `candidate-paste:${createHash('sha256').update(privateVacancy.originalText).digest('hex').slice(0, 24)}`,
              position: String(privateVacancy.title), company: String(privateVacancy.company ?? ''), location: String(privateVacancy.location ?? ''),
              education: '', experience: '', salary_from: '', salary_to: '', category: '',
              description: String(privateVacancy.description || privateVacancy.originalText),
              requirements: String(privateVacancy.requirements ?? ''), responsibilities: String(privateVacancy.responsibilities ?? ''),
            };
      // Only the candidate's CONFIRMED career entries are facts; which of them fit this document is decided by selectCareerSections.
      const entries = (await this.career?.confirmedFor(resume.userId)) ?? [];
      const kind = resume.docKind;
      const language = resume.language ?? undefined;
      const letterInputs = ((resume.letterInputs ?? {}) as LetterInputs) || {};
      const sections = selectCareerSections(entries, {
        format: kind === 'CV' ? 'cv' : 'resume',
        experienceMonths: experienceMonths(profile?.experiences ?? []),
        jobText: [input.position, input.description, input.requirements, input.responsibilities].join('\n'),
        selectedCareerEntryIds: Array.isArray((resume.provenance as any)?.selectedCareerEntryIds)
          ? (resume.provenance as any).selectedCareerEntryIds : undefined,
      });
      if (kind === 'LETTER') {
        // Stories are letter material only. The candidate may choose which ones; none chosen means all confirmed stories.
        const stories = fullCareerSections(entries).stories;
        const chosen = letterInputs.storyIds?.length ? stories.filter((s) => letterInputs.storyIds!.includes(s.entryId)) : stories;
        sections.stories = chosen;
      }
      const persona = this.tailorService.buildPersonaFromProfile(resume.user, profile, sections);
      if (!persona.basics.headline && !persona.experience.length && !persona.skills.length) {
        throw new TailorError('PROFILE_INCOMPLETE');
      }

      let content: DocumentContent;
      let issues: unknown[];
      let meta: Awaited<ReturnType<ResumeTailorService['generate']>>['meta'];
      // Model calls are collected (provider, stage, outcome, duration, reported tokens; never content) and stored with the run below.
      // Translations this candidate already verified in earlier documents are reused (translation-memory.ts).
      const memory = prismaTranslationStore(this.prisma as any, resume.userId);
      type TailorResult = { content: DocumentContent; issues: unknown[]; meta: typeof meta; vacancyAnalysis?: any };
      const { result: out } = await collectAiUsage<TailorResult>(() => withTranslationMemory<TailorResult>(memory, () =>
        kind === 'LETTER'
          ? this.tailorService.generateLetter(persona, input, { language: language ?? 'en', motivation: letterInputs.motivation, companyReason: letterInputs.companyReason, formative: letterInputs.formative, contribution: letterInputs.contribution, previous: letterInputs.previous })
          : this.tailorService.generate(persona, input, { format: kind === 'CV' ? 'cv' : 'resume', language })),
        calls,
      );
      ({ content, issues, meta } = out);
      // Confirmed entries this document left out are named (the candidate may add any back in review), so nothing relevant disappears silently.
      if (kind !== 'LETTER') {
        for (const gone of leftOutEntries(entries, sections).slice(0, 8)) {
          (issues as unknown[]).push({ code: 'left_out_entry', severity: 'warning', section: 'career', detail: `${gone.kind}: ${gone.title}` });
        }
      }
      // Fail now, not at approval, if this draft cannot be rendered at all.
      const renderStarted = Date.now();
      this.tailorService.compileDocumentPdf(content);
      renderMs = Date.now() - renderStarted;

      const provenance = {
        ...((resume.provenance ?? {}) as Record<string, unknown>),
        kind,
        language: (content as { language?: string }).language ?? language ?? null,
        template: isLetter(content) ? 'letter-harvard-v1' : 'harvard-v1',
        // The vacancy is data: only a reference and a hash of its text are kept, never the text.
        job: {
          source: match?.job ? 'job' : match?.vacancy ? 'vacancy' : 'candidate-paste',
          id: match?.job ? match.job.id : match?.vacancy ? match.vacancy.id : input.id,
          title: input.position,
          company: input.company,
          textSha256: createHash('sha256').update([input.position, input.company, input.location, input.description, input.requirements, input.responsibilities].join('\n')).digest('hex'),
        },
        careerEntryIds: isLetter(content)
          ? [...sections.stories, ...sections.projects, ...sections.activities, ...sections.awards, ...sections.certifications, ...sections.languages].map((x) => x.entryId)
          : [...(content.projects ?? []), ...(content.activities ?? []), ...(content.awards ?? []), ...(content.certifications ?? []), ...(content.languages ?? [])].map((x) => x.entryId).filter(Boolean),
        // Which path produced the text: the evidence-first writer (verified draft used) or the composed text. A rejected writer draft is never recorded as writer output.
        generator: { model: meta.model, calls: meta.calls, path: generationPath(meta.outcomes), ...(wasWriterTried(meta.outcomes) && generationPath(meta.outcomes) === 'composed' ? { writerRefused: true } : {}) },
        ...(out?.vacancyAnalysis ? { vacancyAnalysis: out.vacancyAnalysis } : {}),
      };

      const saved = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.resume.updateMany({
          where: { id: resumeId, status: 'PENDING' },
          data: {
            status: 'NEEDS_REVIEW',
            parsedContent: content as any,
            reviewNotes: { issues, revision: 0, ...(out?.vacancyAnalysis ? { vacancyAnalysis: out.vacancyAnalysis } : {}) } as any,
            generationMeta: meta as any,
            provenance: provenance as any,
            language: provenance.language,
            statusError: null,
          },
        });
        if (!count) return false;
        await this.allowance?.commit(tx, resumeId);
        await recordSnapshot(tx, resumeId, 0, 'GENERATED', content, provenance);
        return true;
      });
      this.logger.log(
        `resume-tailor ${resumeId}: ${saved ? 'NEEDS_REVIEW' : 'superseded'} (${kind}, calls ${meta.calls}, issues ${issues.length}, ${meta.latencyMs} ms)`,
      );
      await this.recordRun(resumeId, kind, saved ? 'NEEDS_REVIEW' : 'SUPERSEDED', null, { queueMs, startedAt, renderMs }, calls);
    } catch (error) {
      const failure = error instanceof TailorError ? error : null;
      await this.prisma
        .$transaction(async (tx) => {
          const { count } = await tx.resume.updateMany({
            where: { id: resumeId, status: 'PENDING' },
            data: {
              status: 'FAILED',
              statusError: failure ? failure.userMessage : 'CV hazırlanarkən gözlənilməz xəta baş verdi. (INTERNAL)',
              generationMeta: (failure?.meta ?? {}) as any,
            },
          });
          // A generation that produced nothing costs nothing: the reserved unit goes back with the failure.
          if (count) await this.allowance?.refund(tx, resumeId, `${SYSTEM_REASON}${failure ? failure.code.toLowerCase() : 'internal'}`);
        })
        .catch(() => undefined);
      // Unexpected errors are logged by class only: their messages may quote content.
      this.logger.warn(`resume-tailor ${resumeId}: FAILED ${failure ? failure.code : (error as Error)?.constructor?.name ?? 'Error'}`);
      await this.recordRun(resumeId, resume.docKind, 'FAILED', failure ? failure.code : 'INTERNAL', { queueMs, startedAt, renderMs }, calls);
    }
  }

  /** Usage and timing for cost reporting. Ids, codes, durations and token counts only; a failure to record never affects the document. */
  private async recordRun(resumeId: string, docKind: string, result: string, errorCode: string | null, t: { queueMs: number | null; startedAt: number; renderMs: number | null }, calls: AiCallEvent[]) {
    try {
      await this.prisma.$transaction([
        this.prisma.documentRun.create({ data: { resumeId, docKind, result, errorCode, queueMs: t.queueMs, generationMs: Date.now() - t.startedAt - (t.renderMs ?? 0), renderMs: t.renderMs, calls: calls.length } }),
        ...(calls.length ? [this.prisma.aiUsageEvent.createMany({ data: calls.map((c) => ({ ...c, resumeId, docKind })) })] : []),
      ]);
    } catch (error) {
      this.logger.warn(`resume-tailor ${resumeId}: usage not recorded (${(error as Error)?.constructor?.name ?? 'Error'})`);
    }
  }
}
