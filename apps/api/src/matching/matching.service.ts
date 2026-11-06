import { isRecommendationRelevant } from './recommendation-policy';
import { activePlanOverrides, effectivePlan } from '../billing/entitlement';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/database.service';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { JobMatchingService, type MatchableVacancy } from './job-matching.service';
import { JobCatalogueService } from '../jobs/job-catalogue.service';
import { canonicalSkill } from '../jobs/job-skills';
import { cleanDisplayRole, plainCase, vacancyEvidenceScore, evidenceTerms } from '../resumes/tailor/az-compose';
import { needsTranslation } from '../resumes/tailor/az-document-fields';
import { analyzeVacancy } from '../resumes/tailor/az-vacancy-analysis';
import { PostHogService } from '../common/posthog.service';
import { actionableJobWhere, isJobActionable } from '../jobs/jobs.service';
import { PLAN_MATCH_QUOTAS, PLAN_DAILY_MATCH_QUOTAS, PLAN_WEEKLY_MATCH_QUOTAS, matchDayStart, matchWeekStart } from '@aise/shared-types';
import type { MatchScoreDetails } from '@aise/shared-types';
import { Prisma, type PlanOverride, type Subscription } from '@prisma/client';

// Monthly rolling window for the per-plan match quota — independent of Dodo's
// billing period, so it applies to FREE users too. See Subscription.quotaPeriodStart.
const QUOTA_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// Minimum score (0.0-1.0) for a pair to become a Match. The score is a
// suitability INDEX built from title, skill, concept and semantic similarity
// (apps/matching-service/pipeline.py score_job) — not a probability of being
// hired or shortlisted, and it is not calibrated against outcomes.
// 0.35 keeps clear misses out: on the synthetic evaluation set
// (docs/matching-evaluation.md) poor pairs have a median of about 0.22 and
// hard mismatches stay below 0.21. Do not raise or lower it on a hunch; re-run
// `python eval/run_eval.py` and compare, and tune from the matching_run_completed
// scoreP50/scoreMean distribution. Override without a deploy via
// MATCH_SCORE_THRESHOLD.
export const MATCH_SCORE_THRESHOLD = (() => {
  const raw = Number(process.env.MATCH_SCORE_THRESHOLD);
  // A typo'd env value must fall back to the default, never to NaN (every
  // `score < NaN` comparison is false, which would silently disable the
  // cutoff and match everyone against everything).
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.35;
})();

// Profiles carry everything the persona adapter needs, including the base
// resume's parsed skills (skill + language inference). Resume has no direct
// FK to Profile (only to User, which Profile 1:1s via userId), so the base
// resume is fetched through `user` and flattened back onto the profile
// object by attachResumes() — buildPersonaFromProfile expects it there.
const PROFILE_INCLUDE = {
  user: {
    include: {
      subscription: true,
      planOverrides: activePlanOverrides(),
      resumes: { where: { isBase: true }, select: { parsedContent: true } },
    },
  },
  experiences: true,
  education: true,
} as const;

function attachResumes(profile: any): any {
  return { ...profile, resumes: profile.user?.resumes };
}

const PROFILES_PAGE = 500;
// Premium can publish up to 150 matches in a 30-day window. Keep a buffer
// above that allowance while bounding stored JSON evidence per account.
const MAX_PENDING_CANDIDATES_PER_USER = 250;

type MatchTarget = { kind: 'job'; id: string } | { kind: 'vacancy'; id: string };

export interface MotivationSuggestionItem {
  id: string;
  type: 'role' | 'experience' | 'company' | 'contribution';
  title: string;
  text: string;
  field: 'whyRole' | 'formative' | 'whyCompany' | 'contribution';
  sourceText?: string;
  tip?: string;
}

export interface CandidateEvidenceItem {
  id: string;
  kind: 'PROJECT' | 'VOLUNTEERING' | 'LEADERSHIP' | 'EXTRACURRICULAR' | 'AWARD' | 'CERTIFICATION';
  title: string;
  organization?: string;
  role?: string;
  explanation: string;
}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);
  constructor(
    private prisma: PrismaService,
    private jobMatchingService: JobMatchingService,
    private postHogService: PostHogService,
    private jobCatalogueService: JobCatalogueService,
    @InjectQueue('match-created') private matchCreatedQueue: Queue,
  ) {}

  /**
   * Returns vacancy-specific skill guidance for a match (evidenced skills, missing required and preferred skills,
   * other requirements, and up to 3 actionable evidence prompts linking to profile sections).
   */
  async getMatchSkills(userId: string, matchId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        userId: true,
        jobId: true,
        vacancyId: true,
        job: { select: { title: true, company: true, description: true } },
        vacancy: { select: { title: true, description: true, requirements: true, responsibilities: true, company: { select: { name: true } } } },
      },
    });
    if (!match || match.userId !== userId) {
      throw new NotFoundException('Uyğunluq tapılmadı');
    }
    const kind = match.jobId ? 'imported' : 'native';
    const targetId = match.jobId || match.vacancyId;
    if (!targetId) throw new NotFoundException('Vakansiya tapılmadı');

    const guidance = await this.jobCatalogueService.skillGuidance(userId, kind, targetId);

    const targetTitle = match.job?.title || match.vacancy?.title || '';
    const targetCompany = match.job?.company || match.vacancy?.company?.name || '';
    const role = cleanDisplayRole(targetTitle);

    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { experiences: { select: { title: true, company: true, description: true } } },
    });
    const posting = match.job ?? match.vacancy;
    const targetJob = { position: targetTitle, description: posting?.description || '', company: targetCompany,
      requirements: match.vacancy?.requirements || '', responsibilities: match.vacancy?.responsibilities || '' } as any;
    const analysis = analyzeVacancy(targetJob);
    // Suggestions can ground the vacancy half of a reason, but only the candidate can
    // supply their personal motive or a researched reason for choosing the employer.
    const focus = [...(guidance.evidenced ?? []), ...(guidance.missingRequired ?? []), ...(guidance.missingPreferred ?? [])]
      .find((item) => item.requirement?.trim());
    const motivationSuggestions: MotivationSuggestionItem[] = [];

    const careerEntries = this.prisma.careerEntry?.findMany
      ? await this.prisma.careerEntry.findMany({
          where: {
            userId,
            status: 'CONFIRMED',
            kind: { in: ['PROJECT', 'VOLUNTEERING', 'LEADERSHIP', 'EXTRACURRICULAR', 'AWARD', 'CERTIFICATION'] },
          },
          select: { id: true, kind: true, title: true, organization: true, role: true, description: true, result: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        })
      : [];

    const facts = [
      ...(profile?.experiences ?? []).map((e) => ({ title: e.title || '', text: e.description || '' })),
      ...careerEntries.map((e) => ({ title: e.title, text: [e.description, e.result].filter(Boolean).join('. ') })),
    ].flatMap((item) => item.text.split(/(?<=[.!?])\s+|\n+/u).map((text) => ({ ...item, text: text.replace(/^\s*[-•–]\s*/, '').trim() })))
      .map((item, index) => ({ ...item, index, score: vacancyEvidenceScore(item.text, targetJob) }))
      .filter((item) => item.score > 0 && item.text.length >= 12 && item.text.length <= 650)
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const best = facts[0];
    const factualTerms = evidenceTerms(best?.text ?? '');
    const tasks = analysis.principalResponsibilities
      .map((text, index) => ({ text: text.replace(/[.;]+$/u, '').trim(), index,
        score: [...evidenceTerms(text)].filter((term) => factualTerms.has(term)).length }))
      .filter((task) => task.text.length <= 220 && !/@|https?:/i.test(task.text))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const lowerTask = plainCase;
    // AZ preparation must not insert English source prose into an AZ answer.
    const localTasks = tasks.filter((t) => !needsTranslation(t.text, 'bullet'));
    const task = localTasks[0]?.text;
    if (task || focus) motivationSuggestions.push({
      id: 'sug_role', type: 'role', title: 'Vəzifəyə maraq', field: 'whyRole',
      text: task
        ? `Bu vəzifədə “${task}” tapşırığı ilə maraqlanıram, çünki [bu tapşırığın sizi niyə cəlb etdiyini yazın].`
        : `${role || 'Bu vəzifə'} üzrə ${focus!.skill} bacarığını tətbiq etmək istəyirəm, çünki [öz səbəbinizi yazın].`,
    });
    // A role duty is not evidence about why a candidate chose an employer. Leave a
    // compact fill-in prompt that asks for a candidate-verified company detail.
    if (targetCompany) motivationSuggestions.push({
      id: 'sug_company', type: 'company', title: 'Bu elanı niyə seçirəm?', field: 'whyCompany',
      text: `«${targetCompany}» şirkətində işləmək istəyirəm, çünki [yoxladığınız konkret məhsul, xidmət və ya layihəni və bunun sizin üçün nə üçün əhəmiyyətli olduğunu yazın].`,
    });
    const localFacts = facts.filter((fact) => !needsTranslation(fact.text, 'bullet'));
    const localBest = localFacts[0];
    if (localBest) {
      const fact = localBest.text.replace(/[.;]+$/u, '').trim();
      const expText = task
        ? `${fact}. Bu təcrübəmi bu vəzifədə «${lowerTask(task)}» tapşırığının icrasında birbaşa tətbiq etmək niyyətindəyəm.`
        : `${fact}. Əldə etdiyim bu praktik nəticəni ${role ? `«${role}» vəzifəsi` : 'bu vəzifə'} üzrə qarşıya qoyulan işlərə töhfə kimi təqdim edirəm.`;
      motivationSuggestions.push({ id: 'sug_exp', type: 'experience', title: 'Əlaqəli təcrübə', field: 'formative',
        text: expText });
    }
    const supportedNeed = (guidance.evidenced ?? []).find((item) => item.requirement?.trim());
    if (supportedNeed) motivationSuggestions.push({
      id: 'sug_contrib', type: 'contribution', title: 'Töhfə və tətbiq', field: 'contribution',
      text: task
        ? `${supportedNeed.skill} üzrə biliklərimi bu vəzifədə ${lowerTask(task)} üçün tətbiq etmək istəyirəm.`
        : `${supportedNeed.skill} üzrə biliklərimi ${role || 'bu vəzifə'} üzrə işlərdə tətbiq etmək istəyirəm.`,
    });

    const tips = {
      whyRole: 'Mötərizədəki hissəni öz həqiqi səbəbinizlə əvəz edin. Səbəb tapa bilmirsinizsə, təklifi qəbul etməyin; bu cavab məktub üçün məcburi deyil.',
      whyCompany: 'Şirkət barədə yalnız özünüzün yoxladığınız məhsul, xidmət və ya layihə faktını yazın. Elan təkbaşına şirkətin mədəniyyəti və ya dəyərləri barədə sübut deyil.',
      formative: 'Bir nümunə kifayətdir: nə etdiniz, hansı üsuldan istifadə etdiniz, nəticə nə oldu? Rəqəmləri və təcrübənin iş, təcrübə proqramı və ya layihə olduğunu dəqiq saxlayın.',
      contribution: 'Elanın bir ehtiyacını bacarığınızla bağlayın. İlk dövrdə hansı işi görə biləcəyinizi izah edin; sübutsuz gəlir və ya nəticə vədi verməyin.',
    };
    for (const suggestion of motivationSuggestions) {
      suggestion.tip = tips[suggestion.field];
      suggestion.sourceText = suggestion.field === 'formative' ? localBest?.text
        : suggestion.field === 'whyCompany' ? undefined : task || focus?.requirement;
    }
    // A few alternatives, not a larger form: the editor shows one option per topic.
    for (const [index, item] of localTasks.slice(0, 3).entries()) {
      motivationSuggestions.push({ id: `sug_role_alt_${index}`, type: 'role', field: 'whyRole', title: 'Vəzifəyə maraq',
        text: `Elanınızdakı “${item.text}” tapşırığını seçməyimin səbəbi: [bu tapşırığın sizi niyə cəlb etdiyini yazın].`,
        sourceText: item.text, tip: tips.whyRole });
    }
    for (const [index, fact] of localFacts.slice(0, 3).entries()) {
      motivationSuggestions.push({ id: `sug_exp_alt_${index}`, type: 'experience', field: 'formative', title: 'Əlaqəli təcrübə',
        text: `${fact.text.replace(/[.;]+$/u, '')}. Bu nümunəni vəzifənin əlaqəli tapşırıqları üçün başlanğıc təcrübə kimi təqdim edirəm.`,
        sourceText: fact.text, tip: tips.formative });
    }
    if (supportedNeed) motivationSuggestions.push({ id: 'sug_contrib_alt', type: 'contribution', field: 'contribution', title: 'Töhfə və tətbiq',
      text: `${supportedNeed.skill} üzrə biliklərimi elanda bu bacarıqla bağlı göstərilən işlərə tətbiq etmək istəyirəm. Əvvəlcə komandanın mövcud iş qaydasını öyrənib həmin tapşırıqlarda iştirak etməyi planlaşdırıram.`,
      sourceText: supportedNeed.requirement, tip: tips.contribution });
    const motivationGuidance = [
      ...Object.entries(tips).map(([field, tip]) => ({ field, tip })),
      ...(guidance.missingRequired?.length ? [{ field: 'gaps', tip: `Profilinizdə təsdiqlənməyən tələblər: ${guidance.missingRequired.map((s) => s.skill).join(', ')}. Yalnız sahib olduğunuz bacarıqları əlavə edin; digər tələblər üzrə öyrənmə planınızı yaza bilərsiniz.` }] : []),
      ...(best && !localBest ? [{ field: 'translation', tip: 'Əlaqəli təcrübənizin mətni başqa dildədir. Onu Azərbaycan dilində öz sözlərinizlə yazın; rəqəmləri və təcrübənin məzmununu qoruyun.' }] : []),
    ];

    const candidateEvidenceItems: CandidateEvidenceItem[] = careerEntries
      .map((ce, index) => ({ ce, index, score: vacancyEvidenceScore([ce.title, ce.description, ce.result].filter(Boolean).join(' '), targetJob) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ ce, score }) => ({
        id: ce.id,
        kind: ce.kind as CandidateEvidenceItem['kind'],
        title: ce.title,
        organization: ce.organization || undefined,
        role: ce.role || undefined,
        explanation: score > 0
          ? 'Bu təsdiqlənmiş qeyddə vakansiyanın mətni ilə əlaqəli məlumat var. Uyğunluğunu yoxlayın.'
          : 'Təsdiqlənmiş profil qeydidir; bu vakansiya ilə əlaqəsi müəyyən edilməyib. Daxil etmək istədiyinizi seçin.',
      }));

    const buildProfileLink = (section: string) => {
      const returnTo = encodeURIComponent(`/dashboard/resumes?matchId=${encodeURIComponent(matchId)}`);
      return `/dashboard/profile?matchId=${encodeURIComponent(matchId)}&returnTo=${returnTo}#${section}`;
    };

    // Build up to 3 guided missing evidence prompts linking to profile sections
    const guidedPrompts: Array<{
      id: string;
      title: string;
      description: string;
      section: 'skills' | 'experience' | 'education' | 'projects';
      link: string;
    }> = [];

    for (const item of guidance.missingRequired || []) {
      if (guidedPrompts.length >= 3) break;
      const canon = canonicalSkill(item.skill);
      guidedPrompts.push({
        id: `skill_${canon.key}`,
        title: canon.label,
        description: `Elanda bu bacarıq tələb olunur, amma profilinizdə göstərilməyib. Sahib olduğunuz bacarıqları seçərək profilinizə əlavə edin.`,
        section: 'skills',
        link: buildProfileLink('skills'),
      });
    }

    for (const item of guidance.other || []) {
      if (guidedPrompts.length >= 3) break;
      const isEdu = item.kind === 'degree';
      const section = isEdu ? 'education' : 'experience';
      guidedPrompts.push({
        id: `other_${guidedPrompts.length + 1}`,
        title: item.text,
        description: isEdu
          ? 'Elanda təhsil tələbi qeyd olunub. Təhsil bölməsinə daxil olaraq dərəcənizi və ixtisasınızı dəqiqləşdirin.'
          : 'Elanda bu təcrübə göstərilib. Müvafiq təcrübənizi profilə əlavə edə bilərsiniz.',
        section,
        link: buildProfileLink(section),
      });
    }

    for (const item of guidance.missingPreferred || []) {
      if (guidedPrompts.length >= 3) break;
      const canon = canonicalSkill(item.skill);
      guidedPrompts.push({
        id: `pref_${canon.key}`,
        title: canon.label,
        description: `Elanda bu arzuolunan bacarıq qeyd edilib. Profilinizdə varsa, üstünlük qazana bilərsiniz.`,
        section: 'skills',
        link: buildProfileLink('skills'),
      });
    }

    return {
      matchId,
      kind,
      targetId,
      ...guidance,
      guidedPrompts,
      motivationSuggestions,
      motivationGuidance,
      candidateEvidenceItems,
    };
  }

  private scoreStats(scores: number[]) {
    if (!scores.length) return { scored: 0, mean: 0, p50: 0, max: 0 };
    const sorted = [...scores].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p50 = sorted[Math.floor(sorted.length / 2)];
    return { scored: sorted.length, mean: Math.round(mean * 1000) / 1000, p50, max: sorted[sorted.length - 1] };
  }

  private async *allProfiles(): AsyncGenerator<any, void, void> {
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.profile.findMany({
        where: { onboardingCompletedAt: { not: null } },
        include: PROFILE_INCLUDE as any,
        orderBy: { id: 'asc' },
        take: PROFILES_PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (!page.length) return;
      for (const p of page) yield attachResumes(p);
      if (page.length < PROFILES_PAGE) return;
      cursor = page[page.length - 1].id;
    }
  }

  private async collectProfiles(): Promise<any[]> {
    const out: any[] = [];
    for await (const p of this.allProfiles()) out.push(p);
    return out;
  }

  async runMatching(jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
    });

    // Closed or past-deadline jobs must not produce new recommendations.
    if (!job || !isJobActionable(job)) return;

    // Paginated (never loads the whole table at once) and chunked inside
    // scoreBatch (server caps at 500/batch) — a large user base can't fail
    // the whole run on one oversized request any more.
    const profiles = await this.collectProfiles();

    const scores = await this.jobMatchingService.scoreBatch(job as any, profiles);

    let created = 0;
    let staged = 0;
    const seen: number[] = [];
    for (const profile of profiles) {
      const details = scores.get(profile.id);
      if (!details) continue;
      seen.push(details.score);
      const outcome = await this.upsertOrStage(profile.userId, { kind: 'job', id: job.id }, details, profile.user.subscription, undefined, profile.user.planOverrides);
      if (outcome === 'created') created++;
      else if (outcome === 'staged') staged++;
    }

    if (scores.size < profiles.length) throw new Error('Incomplete job scoring; retry required');

    // Pipeline-health visibility + the distribution needed to keep the cutoff
    // calibrated (see MATCH_SCORE_THRESHOLD).
    this.postHogService.capture(jobId, 'matching_run_completed', {
      direction: 'job_to_profiles',
      jobId,
      profilesScored: profiles.length,
      matchesCreated: created,
      candidatesStaged: staged,
      threshold: MATCH_SCORE_THRESHOLD,
      ...this.scoreStats(seen),
    });
  }

  // Employer-posted vacancies score through the same pipeline (native vacancy
  // payload, same quota/threshold), triggered when a vacancy is created or
  // re-activated. See VacanciesService.
  async runVacancyMatching(vacancyId: string) {
    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id: vacancyId },
      include: { company: true },
    });

    if (!vacancy || vacancy.status !== 'ACTIVE' || vacancy.company.status !== 'APPROVED' || (vacancy.deadline && vacancy.deadline < new Date())) return;

    const profiles = await this.collectProfiles();

    let created = 0;
    let staged = 0;
    const seen: number[] = [];
    // One batched /score-profile call per profile would re-embed the vacancy
    // per profile; instead reuse the job-direction batching by scoring the
    // vacancy payload through scoreBatch-compatible path below. scoreBatch
    // takes a MatchableJob — build the equivalent via rawPayload passthrough:
    // parse_vacancy is selected server-side by shape (no `detail` block).
    const pseudoJob = {
      id: vacancy.id,
      externalId: `vacancy:${vacancy.id}`,
      title: vacancy.title,
      company: (vacancy.company as any)?.name || 'Unknown',
      description: [vacancy.description, vacancy.requirements, vacancy.responsibilities].filter(Boolean).join('\n\n'),
      location: vacancy.location || '',
      url: '',
      rawPayload: {
        id: vacancy.id,
        title: vacancy.title,
        company: { name: (vacancy.company as any)?.name || 'Unknown' },
        description: vacancy.description,
        requirements: vacancy.requirements,
        responsibilities: vacancy.responsibilities,
        skills: vacancy.skills,
        salaryMin: vacancy.salaryMin,
        salaryMax: vacancy.salaryMax,
        location: vacancy.location,
        workArrangement: vacancy.workArrangement,
        experienceLevel: vacancy.experienceLevel,
        status: vacancy.status,
        views: vacancy.views,
      },
    };
    const scores = await this.jobMatchingService.scoreBatch(pseudoJob as any, profiles);

    for (const profile of profiles) {
      const details = scores.get(profile.id);
      if (!details) continue;
      seen.push(details.score);
      const outcome = await this.upsertOrStage(profile.userId, { kind: 'vacancy', id: vacancy.id }, details, profile.user.subscription, undefined, profile.user.planOverrides);
      if (outcome === 'created') created++;
      else if (outcome === 'staged') staged++;
    }

    if (scores.size < profiles.length) throw new Error('Incomplete vacancy scoring; retry required');

    this.postHogService.capture(vacancyId, 'matching_run_completed', {
      direction: 'vacancy_to_profiles',
      vacancyId,
      profilesScored: profiles.length,
      matchesCreated: created,
      candidatesStaged: staged,
      threshold: MATCH_SCORE_THRESHOLD,
      ...this.scoreStats(seen),
    });
  }

  // Inverse direction of runMatching: scores one user's profile against every
  // Job row AND every active platform Vacancy already in the database, instead
  // of one job against every profile. Triggered once a user finishes
  // onboarding (see ProfileOnboardedProcessor) so they aren't limited to only
  // ever seeing vacancies ingested after their profile existed. Batched
  // /score-profile calls (persona embedded once per batch server-side), each
  // chunk isolated so one failure can't truncate the user's whole list.
  async runMatchingForProfile(userId: string, options: { silentRollout?: string } = {}): Promise<void> {
    // Single flight per user (and per rollout marker): the onboarding and re-score queues can both ask for the
    // same profile at once, and two overlapping passes would double the scorer load and race for the same quota.
    // A second caller shares the in-flight pass and its outcome instead of starting another one.
    const key = `${userId}:${options.silentRollout ?? ''}`;
    const running = this.profileRuns.get(key);
    if (running) return running;
    const run = this.scoreProfileAgainstInventory(userId, options).finally(() => this.profileRuns.delete(key));
    this.profileRuns.set(key, run);
    return run;
  }

  private readonly profileRuns = new Map<string, Promise<void>>();

  private async scoreProfileAgainstInventory(userId: string, options: { silentRollout?: string }): Promise<void> {
    const rawProfile = await this.prisma.profile.findUnique({
      where: { userId },
      include: PROFILE_INCLUDE as any,
    });

    if (!rawProfile) return;
    const profile = attachResumes(rawProfile);

    const [jobs, vacancies] = await Promise.all([
      this.prisma.job.findMany({ where: actionableJobWhere() }),
      this.prisma.vacancy.findMany({
        where: { status: 'ACTIVE', company: { status: 'APPROVED' }, AND: [{ OR: [{ deadline: null }, { deadline: { gte: new Date() } }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }] },
        include: { company: true },
      }),
    ]);

    const results = await this.jobMatchingService.scoreProfileBatch(
      profile as any,
      jobs as any[],
      vacancies.map((v) => this.toMatchableVacancy(v)),
    );

    // Complete or nothing. A plan's monthly quota is spent on the first new matches created, so persisting the
    // results of a partially scored run would give a free user the best of whichever chunks happened to finish
    // (and a retry could no longer improve on them). Nothing is stored for an incomplete run; the queue retries it.
    if (results.size < jobs.length + vacancies.length) {
      throw new Error(`Incomplete profile scoring; retry required (${results.size}/${jobs.length + vacancies.length} postings scored)`);
    }

    let created = 0;
    let staged = 0;
    const seen: number[] = [];
    // Best first. A plan's monthly quota is spent on the first new matches
    // created, so in posting order a free user's three matches would be whichever
    // postings happen to come first, not their best three.
    // Equal scores are common with the deterministic scorer, so ties are broken by the newer posting, then by id: the outcome is
    // deterministic and prefers the fresher vacancy.
    const postedAt = new Map<string, number>();
    for (const j of jobs as any[]) postedAt.set(`job:${j.id}`, j.postedAt ? new Date(j.postedAt).getTime() : 0);
    for (const v of vacancies as any[]) postedAt.set(`vacancy:${v.id}`, v.createdAt ? new Date(v.createdAt).getTime() : 0);
    const when = (r: { source: string; postingId: string }) => postedAt.get(`${r.source}:${r.postingId}`) ?? 0;
    // Refresh explicit rejections first, freeing slots held by historical
    // occupation mismatches before allocating this pass's best new matches.
    const bestFirst = [...results.values()].sort((a, b) =>
      Number(isRecommendationRelevant(a.details)) - Number(isRecommendationRelevant(b.details)) ||
      b.score - a.score || when(b) - when(a) || (a.postingId < b.postingId ? -1 : 1));
    for (const r of bestFirst) {
      seen.push(r.score);
      const target: MatchTarget = r.source === 'vacancy' ? { kind: 'vacancy', id: r.postingId } : { kind: 'job', id: r.postingId };
      const outcome = await this.upsertOrStage(userId, target, r.details, (profile as any).user.subscription, options.silentRollout, (profile as any).user.planOverrides);
      if (outcome === 'created') created++;
      else if (outcome === 'staged') staged++;
    }

    this.postHogService.capture(userId, 'matching_run_completed', {
      direction: 'profile_to_jobs',
      jobsScored: jobs.length,
      vacanciesScored: vacancies.length,
      matchesCreated: created,
      candidatesStaged: staged,
      threshold: MATCH_SCORE_THRESHOLD,
      ...this.scoreStats(seen),
    });
  }

  private toMatchableVacancy(vacancy: any): MatchableVacancy {
    return {
      id: vacancy.id,
      title: vacancy.title,
      companyName: vacancy.company?.name || 'Unknown',
      description: vacancy.description,
      requirements: vacancy.requirements,
      responsibilities: vacancy.responsibilities,
      skills: vacancy.skills || [],
      salaryMin: vacancy.salaryMin,
      salaryMax: vacancy.salaryMax,
      location: vacancy.location,
      workArrangement: vacancy.workArrangement,
      experienceLevel: vacancy.experienceLevel,
      status: vacancy.status,
      views: vacancy.views || 0,
    };
  }

  private async upsertOrStage(
    userId: string,
    target: MatchTarget,
    details: MatchScoreDetails,
    subscription: Subscription | null,
    silentRollout?: string,
    planOverrides?: PlanOverride[],
  ): Promise<'created' | 'staged' | false> {
    const overrides = planOverrides ?? await this.prisma.planOverride.findMany({
      where: { userId, ...activePlanOverrides().where },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const plan = effectivePlan({ subscription, planOverrides: overrides }, new Date());
    const hasBatchQuota = PLAN_DAILY_MATCH_QUOTAS[plan] !== undefined || PLAN_WEEKLY_MATCH_QUOTAS[plan] !== undefined;
    if (silentRollout) return (await this.upsertMatch(userId, target, details, subscription, silentRollout)) ? 'created' : false;
    if (!hasBatchQuota) {
      await this.prisma.matchCandidate.deleteMany({
        where: { userId, jobId: target.kind === 'job' ? target.id : null, vacancyId: target.kind === 'vacancy' ? target.id : null },
      });
      return (await this.upsertMatch(userId, target, details, subscription)) ? 'created' : false;
    }

    const where = target.kind === 'job'
      ? { userId_jobId: { userId, jobId: target.id } }
      : { userId_vacancyId: { userId, vacancyId: target.id } };
    const existing = await this.prisma.match.findUnique({ where } as any);
    if (existing) {
      // Existing recommendations remain visible and are refreshed in place;
      // only new rows wait for ranked slot allocation.
      await this.upsertMatch(userId, target, details, subscription);
      await this.prisma.matchCandidate.deleteMany({ where: { userId, jobId: target.kind === 'job' ? target.id : null, vacancyId: target.kind === 'vacancy' ? target.id : null } });
      return false;
    }

    if (details.score < MATCH_SCORE_THRESHOLD || !isRecommendationRelevant(details)) {
      await this.prisma.matchCandidate.deleteMany({
        where: { userId, jobId: target.kind === 'job' ? target.id : null, vacancyId: target.kind === 'vacancy' ? target.id : null },
      });
      return false;
    }

    const candidateWhere = target.kind === 'job'
      ? { userId_jobId: { userId, jobId: target.id } }
      : { userId_vacancyId: { userId, vacancyId: target.id } };
    await this.prisma.matchCandidate.upsert({
      where: candidateWhere as any,
      create: {
        userId,
        jobId: target.kind === 'job' ? target.id : null,
        vacancyId: target.kind === 'vacancy' ? target.id : null,
        score: details.score,
        details: { ...details, source: target.kind } as any,
      },
      update: { score: details.score, details: { ...details, source: target.kind } as any, scoredAt: new Date() },
    });
    return 'staged';
  }

  /**
   * Publish only the strongest actionable pending matches for the requested
   * plan cadence. Scoring and eligibility happen at ingest time; this stage
   * rechecks posting state and policy immediately before notifying candidates.
   */
  async publishRankedRecommendations(cadence: 'daily' | 'weekly', onlyUserId?: string): Promise<number> {
    const users = await this.prisma.matchCandidate.findMany({
      ...(onlyUserId ? { where: { userId: onlyUserId } } : {}),
      select: { userId: true }, distinct: ['userId'],
    });
    const oldest = new Date(Date.now() - 30 * 86_400_000);
    let published = 0;
    for (const { userId } of users) {
      const [subscription, overrides, pending] = await Promise.all([
        this.prisma.subscription.findUnique({ where: { userId } }),
        this.prisma.planOverride.findMany({ where: { userId, ...activePlanOverrides().where }, orderBy: { createdAt: 'desc' }, take: 20 }),
        this.prisma.matchCandidate.findMany({
          where: { userId, scoredAt: { gte: oldest } },
          include: { job: true, vacancy: { include: { company: true } } },
          orderBy: [{ score: 'desc' }, { scoredAt: 'desc' }, { id: 'asc' }],
          take: MAX_PENDING_CANDIDATES_PER_USER,
        }),
      ]);
      const plan = effectivePlan({ subscription, planOverrides: overrides }, new Date());
      const quota = cadence === 'daily' ? PLAN_DAILY_MATCH_QUOTAS[plan] : PLAN_WEEKLY_MATCH_QUOTAS[plan];
      if (quota === undefined) continue;

      // Keep the pending store bounded. Retain the strongest scored candidates
      // and discard every other in-window row; selection below then uses real
      // posting freshness to break equal-score ties.
      const retainedIds = pending.map((candidate: any) => candidate.id);
      await this.prisma.matchCandidate.deleteMany({
        where: { userId, scoredAt: { gte: oldest }, id: { notIn: retainedIds } },
      });
      const sorted = [...pending].sort((a: any, b: any) => {
        const aPosted = a.job?.postedAt ?? a.vacancy?.createdAt ?? a.scoredAt;
        const bPosted = b.job?.postedAt ?? b.vacancy?.createdAt ?? b.scoredAt;
        return b.score - a.score || new Date(bPosted).getTime() - new Date(aPosted).getTime() || a.id.localeCompare(b.id);
      });
      const start = cadence === 'daily' ? matchDayStart() : matchWeekStart();
      const end = new Date(start.getTime() + (cadence === 'daily' ? 1 : 7) * 86_400_000);
      const period = { userId, createdAt: { gte: start, lt: end } };
      const total = await this.prisma.match.count({ where: period });
      const rejected = total ? await this.prisma.match.count({
        where: { ...period, status: { not: 'APPLIED' }, details: { path: ['breakdown', 'filters', 'role_relevant'], equals: false } },
      }) : 0;
      let remaining = Math.max(0, quota - (total - rejected));
      if (!remaining) continue;

      for (const candidate of sorted) {
        if (!remaining) break;
        const target: MatchTarget | null = candidate.jobId
          ? { kind: 'job', id: candidate.jobId }
          : candidate.vacancyId ? { kind: 'vacancy', id: candidate.vacancyId } : null;
        const actionable = target?.kind === 'job'
          ? !!candidate.job && isJobActionable(candidate.job)
          : target?.kind === 'vacancy' && !!candidate.vacancy && candidate.vacancy.status === 'ACTIVE' && candidate.vacancy.company?.status === 'APPROVED' && (!candidate.vacancy.deadline || candidate.vacancy.deadline >= new Date()) && (!candidate.vacancy.expiresAt || candidate.vacancy.expiresAt > new Date());
        const details = candidate.details as unknown as MatchScoreDetails;
        if (!actionable || !target || candidate.score < MATCH_SCORE_THRESHOLD || !isRecommendationRelevant(details)) {
          await this.prisma.matchCandidate.deleteMany({ where: { id: candidate.id } });
          continue;
        }

        const created = await this.upsertMatch(userId, target, details, subscription);
        if (created) {
          published++;
          remaining--;
          await this.prisma.matchCandidate.deleteMany({ where: { id: candidate.id } });
        } else {
          const existing = target.kind === 'job'
            ? await this.prisma.match.findUnique({ where: { userId_jobId: { userId, jobId: target.id } }, select: { id: true } })
            : await this.prisma.match.findUnique({ where: { userId_vacancyId: { userId, vacancyId: target.id } }, select: { id: true } });
          if (existing) await this.prisma.matchCandidate.deleteMany({ where: { id: candidate.id } });
        }
      }
    }
    // Cascade handles deleted postings; discard scored items that have aged
    // beyond the useful recommendation window.
    await this.prisma.matchCandidate.deleteMany({ where: { ...(onlyUserId ? { userId: onlyUserId } : {}), scoredAt: { lt: oldest } } });
    this.logger.log(`Ranked ${cadence} selection completed: ${published} recommendations published for ${users.length} candidate accounts`);
    return published;
  }

  // Shared by all matching directions: creates a new Match (subject to
  // quota) or refreshes an existing one's score in place. Returns true only
  // when a brand-new Match row was created (used for run-summary counts).
  private async upsertMatch(
    userId: string,
    target: MatchTarget,
    details: MatchScoreDetails,
    subscription: Subscription | null,
    // A silent re-scoring rollout (scripts/rescore-profiles): the match is stored and shown in the app
    // as usual, but nothing is announced because of it — no match-created job, no in-app notification,
    // and the stored marker keeps the email flush and the daily digest away from it later.
    silentRollout?: string,
  ): Promise<boolean> {
    const score = details.score;
    const where =
      target.kind === 'job'
        ? { userId_jobId: { userId, jobId: target.id } }
        : { userId_vacancyId: { userId, vacancyId: target.id } };

    // A Match may already exist for this user/posting pair if the posting was
    // re-ingested (e.g. the scraper re-posts it with updated content), or if
    // a previous onboarding/ingest run already scored this pair. Re-score it
    // in place instead of creating a duplicate row and re-notifying the user.
    // Quota only gates brand-new matches, not refreshing the score of one
    // that already exists.
    const existing = await this.prisma.match.findUnique({ where } as any);

    if (existing) {
      // Refresh in place when either the score or its explanation changed
      // (e.g. the profile gained a matching skill without moving the score).
      const previous = existing.details as unknown as MatchScoreDetails | null;
      const explanationChanged =
        JSON.stringify(previous?.matchedKeywords ?? []) !== JSON.stringify(details.matchedKeywords ?? []) ||
        JSON.stringify(previous?.gaps ?? []) !== JSON.stringify(details.gaps ?? []) ||
        JSON.stringify(previous?.breakdown ?? {}) !== JSON.stringify(details.breakdown ?? {});
      const mustSuppress = !!silentRollout && existing.notifiedAt === null && existing.suppressedRollout !== silentRollout;
      if (existing.score !== score || explanationChanged || mustSuppress) {
        await this.prisma.match.update({
          where: { id: existing.id },
          // A refreshed score could lift an unsent match over the email floor; a silent rollout must not
          // be what makes it emailable.
          data: { score, details: { ...details, source: target.kind } as any, ...(mustSuppress ? { suppressedRollout: silentRollout } : {}) },
        });
      }
      // If the DB insert succeeded but Redis rejected its notification job,
      // the next matching retry must be able to recover that unsent alert.
      // The stable queue id plus the notification handler's DB dedupe makes
      // this safe when an earlier job is already pending or was processed.
      if (!silentRollout && !existing.suppressedRollout && !existing.notifiedAt && ['NEW', 'VIEWED'].includes(existing.status)) {
        await this.enqueueMatchNotification(existing.id, userId);
      }
      return false;
    }

    if (score < MATCH_SCORE_THRESHOLD || !isRecommendationRelevant(details)) return false;

    // Once a user's daily or monthly match quota is used up, they stop
    // receiving newly-ingested vacancies until the period rolls over or
    // they upgrade — this is the only enforcement point for that.
    let match: { id: string } | null;
    try {
      // Quota consumption and unique match insertion must commit together.
      // A competing profile/job worker may win after our initial lookup;
      // its unique-key conflict rolls this transaction's quota increment back.
      match = await this.prisma.$transaction(async (tx) => {
        if (!await this.consumeMatchQuota(userId, subscription, tx)) return null;
        return tx.match.create({
          data: {
            userId,
            jobId: target.kind === 'job' ? target.id : null,
            vacancyId: target.kind === 'vacancy' ? target.id : null,
            score,
            details: { ...details, source: target.kind } as any,
            status: 'NEW',
            ...(silentRollout ? { suppressedRollout: silentRollout } : {}),
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' &&
          await this.prisma.match.findUnique({ where } as any)) return false;
      throw error;
    }
    if (!match) return false;

    if (silentRollout) return true; // created, counted against the quota, never announced

    await this.enqueueMatchNotification(match.id, userId);

    return true;
  }

  private enqueueMatchNotification(matchId: string, userId: string) {
    return this.matchCreatedQueue.add('send-notification', { matchId, userId }, {
      jobId: `match-created-${matchId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
    });
  }

  // Returns true and atomically increments usage if the user has quota left
  // this period; returns false (without incrementing) if they've used it up.
  private async consumeMatchQuota(userId: string, subscription: Subscription | null, db: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    // Defensive: accounts predating the subscription model (or rows deleted
    // out of band) must degrade to FREE, never to "no matches, silently".
    if (!subscription) {
      subscription = await db.subscription.upsert({
        where: { userId },
        create: { userId, plan: 'FREE', status: 'active' },
        update: {},
      });
    }

    let { matchesUsedThisPeriod, quotaPeriodStart } = subscription;

    if (Date.now() - quotaPeriodStart.getTime() >= QUOTA_PERIOD_MS) {
      matchesUsedThisPeriod = 0;
      quotaPeriodStart = new Date();
      await db.subscription.updateMany({
        where: { userId, quotaPeriodStart: { lt: new Date(Date.now() - QUOTA_PERIOD_MS) } },
        data: { matchesUsedThisPeriod, quotaPeriodStart },
      });
    }

    // An operator's active plan override counts; the payment contract is untouched.
    const overrides = await db.planOverride.findMany({ where: { userId, ...activePlanOverrides().where }, orderBy: { createdAt: 'desc' }, take: 20 });
    const plan = effectivePlan({ subscription, planOverrides: overrides }, new Date());
    const weeklyQuota = PLAN_WEEKLY_MATCH_QUOTAS[plan];
    const dailyQuota = PLAN_DAILY_MATCH_QUOTAS[plan] ?? weeklyQuota;
    if (dailyQuota !== undefined) {
      // Lock this account's subscription row before counting. Concurrent workers
      // then see the previous transaction's committed Match before claiming a
      // slot. The unique insertion and this lock share the same transaction;
      // existing matches refreshed above never consume another slot.
      await db.subscription.update({ where: { userId }, data: { matchesUsedThisPeriod: { increment: 0 } } });
      const start = weeklyQuota !== undefined ? matchWeekStart() : matchDayStart();
      const periodWhere = { userId, createdAt: { gte: start, lt: new Date(start.getTime() + (weeklyQuota !== undefined ? 7 : 1) * 86_400_000) } };
      const delivered = await db.match.count({ where: periodWhere });
      // Revalidated occupation mismatches must not keep using a weekly/daily
      // recommendation slot. Explicit false is counted separately so missing
      // JSON paths in legacy records retain their normal quota accounting.
      const rejected = delivered ? await db.match.count({ where: { ...periodWhere, status: { not: 'APPLIED' },
        details: { path: ['breakdown', 'filters', 'role_relevant'], equals: false },
      } }) : 0;
      const used = Math.max(0, delivered - rejected);
      if (used >= dailyQuota) return false;
      await db.subscription.update({ where: { userId }, data: { matchesUsedThisPeriod: { increment: 1 } } });
      return true;
    }
    const quota = PLAN_MATCH_QUOTAS[plan];
    // Cheap local pre-check to skip a pointless write once we already know
    // (from the read above) that this user is over quota.
    if (quota !== null && matchesUsedThisPeriod >= quota) {
      return false;
    }

    if (quota === null) {
      await db.subscription.update({
        where: { userId },
        data: { matchesUsedThisPeriod: { increment: 1 } },
      });
      return true;
    }

    // Concurrent BullMQ workers can both pass the local check above before
    // either one's increment lands (e.g. two different newly-ingested jobs
    // scored for the same user around the same time) — a plain read-then-
    // write update() has no way to notice that. Re-checking the quota in the
    // WHERE clause of the write itself makes this atomic: the increment only
    // takes effect if the row is *still* under quota at that exact moment,
    // so at most one of two racing workers can push a user over the limit.
    const result = await db.subscription.updateMany({
      where: { userId, matchesUsedThisPeriod: { lt: quota } },
      data: { matchesUsedThisPeriod: { increment: 1 } },
    });
    return result.count > 0;
  }
}
