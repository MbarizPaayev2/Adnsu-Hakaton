import { Injectable, Logger } from '@nestjs/common';
import type { MatchScoreDetails } from '@aise/shared-types';

// ── matching-service client ─────────────────────────────────────
// Scoring itself lives in apps/matching-service (Python, sentence-transformers
// + numpy embeddings). This service only adapts our Prisma shapes to that
// service's job/persona contract and calls it in batches.
//
// Persona contract notes (see pipeline.py parse_persona / score_job):
// - `languages` must be real [{code}] entries: an empty array is NOT neutral
//   for jobs that name required languages, so we infer codes from the
//   profile's own skills/headline/experience text plus the base resume's
//   parsed skills (the CV parser folds "İngilis dili" etc. into skills).
// - `preferred_cities` may be empty (neutral server-side); remote markers
//   ("Uzaqdan"/"remote") travel inside it and are split out by the scorer.
// - `work_arrangements` carries prefs.types (remote/hybrid/onsite) so remote
//   jobs don't eat the outside-preferred-cities penalty.
// - salary falls back from prefs.salaryMin/Max to the profile's single
//   salaryExpectation value (treated as the min), with preferredCurrency.

const FOLD_MAP: Record<string, string> = {
  ə: 'e', ı: 'i', ğ: 'g', ş: 's', ö: 'o', ü: 'u', ç: 'c',
};

function fold(s: string): string {
  // NFKD + combining-mark strip first: Azerbaijani/Turkish dotted capital İ
  // lowercases to "i" + COMBINING DOT ABOVE (U+0307), so a plain toLowerCase
  // comparison silently fails on "İngilis dili" — the most common language
  // line in a local CV. Same treatment as the CV parser's stripMarks().
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[əığşöüç]/g, (c) => FOLD_MAP[c] || c);
}

/** Detects language codes (az/en/ru/tr/de) mentioned in free text: CV skill
 * lists ("İngilis dili"), headlines, and experience descriptions. */
export function inferLanguagesFromText(text: string): string[] {
  const t = fold(text);
  const found = new Set<string>();
  if (/azerbaij(an|an dili)?|azerbaycan dili|ana dili/.test(t)) found.add('az');
  if (/ingilis|english|englisc/.test(t)) found.add('en');
  if (/\brus\b|rus dili|rusca|russian|русск/.test(text.toLowerCase())) found.add('ru');
  if (/\bturk\b|turk dili|turkce|turkish/.test(t)) found.add('tr');
  if (/alman|german|deutsch/.test(t)) found.add('de');
  return [...found];
}

export interface MatchableJob {
  id: string;
  externalId: string;
  title: string;
  company: string;
  description: string;
  location: string;
  url: string;
  /** Normalized source fact; null means the source did not establish it. */
  workArrangement?: string | null;
  rawPayload?: unknown;
}

export interface MatchableVacancy {
  id: string;
  title: string;
  companyName: string;
  description: string | null;
  requirements: string | null;
  responsibilities: string | null;
  skills: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  location: string | null;
  workArrangement: string | null;
  experienceLevel: string | null;
  status: string;
  views: number;
}

export interface MatchableExperience {
  title: string;
  company: string;
  description: string;
  startDate: Date;
  endDate: Date | null;
}

export interface MatchableEducation {
  institution: string;
  degree: string;
  fieldOfStudy: string;
}

export interface MatchableResumeParsed {
  parsedContent?: unknown;
}

export interface MatchableProfile {
  id: string;
  headline: string;
  skills: string[];
  location: string;
  salaryExpectation?: number | null;
  preferredCurrency?: string | null;
  citizenship?: string | null;
  jobPreferences: unknown;
  experiences: MatchableExperience[];
  education: MatchableEducation[];
  resumes?: MatchableResumeParsed[];
  user?: { email?: string | null; name?: string | null };
}

// Mirrors pipeline.py's _EDUCATION_RANK scale (0-5), applied to whatever
// degree text a profile stores instead of the Azerbaijani job-posting labels
// that scale was built for — an approximation, not an exact match.
export function estimateEducationRank(entries: MatchableEducation[]): number {
  let rank = 0;
  for (const e of entries) {
    const text = fold(`${e.degree} ${e.fieldOfStudy}`);
    let r = 0;
    if (/phd|doctor|elmi dereje/.test(text)) r = 5;
    else if (/master|bachelor|magistr|bakalavr|ali tehsil|degree/.test(text)) r = 4;
    else if (/associate|natamam|diploma/.test(text)) r = 3;
    else if (/vocational|texniki|xususi/.test(text)) r = 2;
    else if (/high school|orta mekteb|secondary/.test(text)) r = 1;
    rank = Math.max(rank, r);
  }
  return rank;
}

/** Sums actual tenures (end − start per role, ongoing roles capped at now)
 * instead of now − earliest-start, so career gaps don't inflate seniority
 * and misfire the scorer's junior/senior adjustments. */
export function estimateYearsOfExperience(experiences: MatchableExperience[], now = Date.now()): number {
  if (!experiences.length) return 0;
  const nowMs = now;
  let totalMs = 0;
  for (const e of experiences) {
    if (!e.startDate) continue; // new Date(null) is 1970, not "unknown"
    const start = e.startDate instanceof Date ? e.startDate.getTime() : new Date(e.startDate).getTime();
    const endRaw = e.endDate ? (e.endDate instanceof Date ? e.endDate.getTime() : new Date(e.endDate).getTime()) : nowMs;
    if (!Number.isFinite(start)) continue;
    const end = Number.isFinite(endRaw) ? Math.min(endRaw, nowMs) : nowMs;
    if (end > start) totalMs += end - start;
  }
  const years = totalMs / (1000 * 60 * 60 * 24 * 365.25);
  return Math.max(0, Math.round(years * 10) / 10);
}

function resumeSkills(resumes?: MatchableResumeParsed[]): string[] {
  const out: string[] = [];
  for (const r of resumes || []) {
    const pc = r?.parsedContent as { skills?: unknown } | null;
    if (pc && Array.isArray(pc.skills)) {
      for (const s of pc.skills) {
        if (typeof s === 'string' && s.trim()) out.push(s.trim());
      }
    }
  }
  return out;
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

// Maps a Prisma Profile (+ relations) to pipeline.py's parse_persona() input
// contract.
export function buildPersonaFromProfile(profile: MatchableProfile): Record<string, unknown> {
  const prefs = (profile.jobPreferences as Record<string, any>) || {};
  const roles: string[] = Array.isArray(prefs.roles) ? prefs.roles : [];
  const locations: string[] = Array.isArray(prefs.locations) ? prefs.locations : [];
  const types: string[] = Array.isArray(prefs.types)
    ? prefs.types.filter((t: unknown) => t === 'remote' || t === 'onsite' || t === 'hybrid')
    : [];

  const experiences = profile.experiences || [];
  const historyText = experiences.map((e) => `${e.title} ${e.company} ${e.description}`).join('\n');
  const cvSkills = resumeSkills(profile.resumes);
  const hardSkills = dedupeStrings([...(profile.skills || []), ...cvSkills]);
  const languagePool = [
    profile.headline || '',
    (profile.skills || []).join('\n'),
    cvSkills.join('\n'),
    historyText,
  ].join('\n');
  const languages = inferLanguagesFromText(languagePool).map((code) => ({ code }));

  // Salary: explicit prefs range wins; otherwise the profile's single
  // expectation acts as the floor (it answers "I won't work below X", which
  // is exactly what the scorer's salary filter checks).
  let salaryMin: number | null = prefs.salaryMin ?? null;
  let salaryMax: number | null = prefs.salaryMax ?? null;
  if (salaryMin == null && profile.salaryExpectation != null) {
    salaryMin = profile.salaryExpectation;
  }

  return {
    candidate_id: profile.id,
    name: profile.user?.name || '',
    email: profile.user?.email || '',
    location: profile.location || '',
    languages,
    years_of_experience: estimateYearsOfExperience(experiences),
    summary: profile.headline || '',
    target_titles: roles,
    hard_skills: hardSkills,
    soft_skills: [],
    experience_history: experiences.map((e) => ({
      company: e.company,
      role: e.title,
      location: '',
      dates: '',
      achievements: e.description ? [e.description] : [],
    })),
    education: { rank: estimateEducationRank(profile.education || []) },
    salary_expectation: {
      monthly_min: salaryMin,
      monthly_max: salaryMax,
      currency: profile.preferredCurrency || 'AZN',
    },
    preferred_cities: locations,
    work_arrangements: types,
    citizenship: profile.citizenship || prefs.citizenship || null,
    certifications: [],
  };
}

function isGlorriShaped(raw: unknown): raw is Record<string, any> {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, any>;
  return (r.detail !== undefined && typeof r.detail === 'object' && r.detail !== null) || typeof r.slug === 'string';
}

/** Builds the /score `job` payload. Glorri-shaped rawPayloads keep their source
 * facts and receive a normalized row fallback only for omitted arrangement;
 * generic imports are rebuilt from Job columns so the scorer sees real text
 * and established structured facts. */
export function buildJobPayload(job: MatchableJob): Record<string, unknown> {
  const raw = job.rawPayload as Record<string, any> | undefined;
  const sourceArrangement =
    (typeof raw?.workArrangement === 'string' && raw.workArrangement.trim()) ||
    (typeof raw?.detail?.workArrangement === 'string' && raw.detail.workArrangement.trim()) ||
    null;
  const workArrangement = sourceArrangement || job.workArrangement?.trim() || null;
  if (isGlorriShaped(raw)) {
    // Preserve source payload and its verified arrangement. When the source
    // omitted that fact, add the normalized Job-column value to a shallow copy;
    // never mutate the JSON object stored by the importer.
    if (sourceArrangement || !workArrangement) return raw;
    return { ...raw, workArrangement };
  }
  const description = job.description || '';
  return {
    title: job.title,
    slug: job.externalId || job.id,
    location: job.location || '',
    workArrangement,
    experience: (raw as any)?.experience || '',
    education: (raw as any)?.education || '',
    salaryFrom: (raw as any)?.salaryFrom ?? null,
    salaryTo: (raw as any)?.salaryTo ?? null,
    salaryCurrency: (raw as any)?.salaryCurrency || 'AZN',
    status: 'approved',
    company: { slug: '', name: job.company || 'Unknown' },
    detail: {
      title: job.title,
      company_name: job.company || 'Unknown',
      location: job.location || '',
      // Generic descriptions mix pitch + requirements in one body; expose it
      // on both sides since language detection now scans the full text.
      description_text: description,
      requirements_text: (raw as any)?.requirements_text || description,
      category: '',
    },
  };
}

/** Native Vacancy columns → pipeline.py parse_vacancy() contract. */
export function buildVacancyPayload(vacancy: MatchableVacancy): Record<string, unknown> {
  return {
    id: vacancy.id,
    title: vacancy.title,
    company: { name: vacancy.companyName },
    description: vacancy.description || '',
    requirements: vacancy.requirements || '',
    responsibilities: vacancy.responsibilities || '',
    skills: vacancy.skills || [],
    salaryMin: vacancy.salaryMin,
    salaryMax: vacancy.salaryMax,
    location: vacancy.location || '',
    workArrangement: vacancy.workArrangement || '',
    experienceLevel: vacancy.experienceLevel || '',
    status: vacancy.status,
    views: vacancy.views,
  };
}

export interface MatchingServiceResult {
  profileId: string;
  score: number;
  matchedKeywords: string[];
  breakdown: MatchScoreDetails['breakdown'];
  gaps: string[];
}

export interface ProfileBatchResult extends MatchingServiceResult {
  source: string;
  postingId: string;
}

// One matching-service call scores one job against every profile in the
// batch; keep it well under the server's MAX_PROFILES_PER_REQUEST=500 so a
// big user base can never fail the whole ingest run on a 422.
const SCORE_BATCH_CHUNK = 250;
// Fail-closed per chunk, not per run: one bad payload/timeout must not zero
// out every other profile's matches for this job.
//
// The profile direction embeds every posting's text on the scorer's CPU, which dominates the cost: measured on
// a 4-CPU native ARM laptop, a 100-posting chunk takes 64–70 s warm (~0.65 s per posting) and 200 postings 154 s.
// The old fixed 30 s timeout with 100-posting chunks could therefore never succeed there. Both knobs are
// environment-configurable but always bounded; the defaults keep a chunk (25 postings ≈ 15–20 s) well inside its
// timeout (60 s). Chunk latency on production hardware is unmeasured: set these from a measurement there.
function boundedInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
const SCORE_FETCH_TIMEOUT_MS = boundedInt('MATCHING_SCORE_TIMEOUT_MS', 60_000, 5_000, 300_000);
const SCORE_PROFILE_CHUNK = boundedInt('MATCHING_PROFILE_CHUNK_SIZE', 25, 5, 200);

/**
 * Accepts a scorer response only when every entry names a posting/profile we
 * asked about and carries a finite 0–1 score. A malformed chunk is treated as
 * failed, so the caller sees incomplete scoring (and retries) instead of
 * silently storing nothing or a bogus score.
 */
function validResults<T extends { score: unknown; matchedKeywords?: unknown }>(
  data: unknown,
  idOf: (entry: T) => unknown,
  requested: Set<string>,
): T[] {
  const results = (data as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) throw new Error('matching-service response has no results array');
  for (const entry of results as T[]) {
    const id = entry && typeof entry === 'object' ? idOf(entry) : undefined;
    if (typeof id !== 'string' || !requested.has(id)) throw new Error('matching-service returned an unknown or missing id');
    if (typeof entry.score !== 'number' || !Number.isFinite(entry.score) || entry.score < 0 || entry.score > 1) {
      throw new Error(`matching-service returned an invalid score for ${id}`);
    }
    if (entry.matchedKeywords !== undefined && !Array.isArray(entry.matchedKeywords)) {
      throw new Error(`matching-service returned invalid matchedKeywords for ${id}`);
    }
  }
  return results as T[];
}

@Injectable()
export class JobMatchingService {
  private readonly logger = new Logger(JobMatchingService.name);
  private readonly matchingServiceUrl = process.env.MATCHING_SERVICE_URL || 'http://localhost:8000';
  private readonly matchingServiceToken = process.env.MATCHING_SERVICE_TOKEN;

  private async postScore(path: string, payload: unknown): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SCORE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.matchingServiceUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.matchingServiceToken ? { Authorization: `Bearer ${this.matchingServiceToken}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`matching-service ${path} failed: ${response.status} ${response.statusText} ${body}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async scoreBatch(job: MatchableJob, profiles: MatchableProfile[]): Promise<Map<string, MatchScoreDetails>> {
    const out = new Map<string, MatchScoreDetails>();
    if (!profiles.length) return out;

    const jobPayload = buildJobPayload(job);
    for (let i = 0; i < profiles.length; i += SCORE_BATCH_CHUNK) {
      const chunk = profiles.slice(i, i + SCORE_BATCH_CHUNK);
      const payload = {
        job: jobPayload,
        profiles: chunk.map((p) => ({ profileId: p.id, persona: buildPersonaFromProfile(p) })),
      };
      try {
        const results = validResults<MatchingServiceResult>(
          await this.postScore('/score', payload),
          (r) => r.profileId,
          new Set(chunk.map((p) => p.id)),
        );
        for (const r of results) {
          out.set(r.profileId, {
            score: r.score,
            matchedKeywords: r.matchedKeywords ?? [],
            breakdown: r.breakdown,
            gaps: r.gaps,
          });
        }
      } catch (err) {
        // Partial success by design: profiles scored in earlier chunks keep
        // their results; the failed chunk is skipped with a loud log instead
        // of aborting the entire ingest run (the old behavior — one throw
        // killed every match for the job).
        this.logger.warn(
          `scoreBatch chunk ${i / SCORE_BATCH_CHUNK + 1} failed for job ${job.id} (${chunk.length} profiles skipped): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return out;
  }

  /** Inverse direction: one profile against many jobs AND vacancies in a few
   * /score-profile calls (persona embedded once server-side). clientId
   * round-trips so job rows (slug-keyed) and vacancy rows (id-keyed) map
   * back to our own ids unambiguously. */
  async scoreProfileBatch(
    profile: MatchableProfile,
    jobs: MatchableJob[],
    vacancies: MatchableVacancy[],
  ): Promise<Map<string, ProfileBatchResult & { details: MatchScoreDetails }>> {
    const out = new Map<string, ProfileBatchResult & { details: MatchScoreDetails }>();
    const persona = buildPersonaFromProfile(profile);
    const postings: { clientId: string; source: string; postingId: string; raw: Record<string, unknown> }[] = [
      ...jobs.map((j) => ({ clientId: `job:${j.id}`, source: 'job', postingId: j.id, raw: buildJobPayload(j) })),
      ...vacancies.map((v) => ({
        clientId: `vacancy:${v.id}`,
        source: 'vacancy',
        postingId: v.id,
        raw: buildVacancyPayload(v),
      })),
    ];
    const CHUNK = SCORE_PROFILE_CHUNK;
    const totalChunks = Math.ceil(postings.length / CHUNK);
    const startedAt = Date.now();
    for (let i = 0; i < postings.length; i += CHUNK) {
      const chunk = postings.slice(i, i + CHUNK);
      const chunkStarted = Date.now();
      try {
        const byClient = new Map(chunk.map((p) => [p.clientId, p]));
        const results = validResults<{ jobId: string; source: string; score: number; matchedKeywords: string[]; breakdown: any; gaps: string[] }>(
          await this.postScore('/score-profile', {
            persona,
            jobs: chunk.map((p) => ({ ...p.raw, clientId: p.clientId })),
          }),
          (r) => r.jobId,
          new Set(byClient.keys()),
        );
        for (const r of results) {
          const meta = byClient.get(r.jobId);
          if (!meta) continue;
          out.set(r.jobId, {
            profileId: profile.id,
            source: meta.source,
            postingId: meta.postingId,
            score: r.score,
            matchedKeywords: r.matchedKeywords,
            breakdown: r.breakdown,
            gaps: r.gaps,
            details: {
              score: r.score,
              matchedKeywords: r.matchedKeywords,
              breakdown: r.breakdown,
              gaps: r.gaps,
              source: meta.source as 'job' | 'vacancy',
            },
          });
        }
        this.logger.log(
          `scoreProfileBatch chunk ${i / CHUNK + 1}/${totalChunks} ok for profile ${profile.id}: ${chunk.length} postings in ${Date.now() - chunkStarted} ms`,
        );
      } catch (err) {
        const timedOut = err instanceof Error && err.name === 'AbortError';
        this.logger.warn(
          `scoreProfileBatch chunk ${i / CHUNK + 1}/${totalChunks} ${timedOut ? 'timed out' : 'failed'} for profile ${profile.id} after ${Date.now() - chunkStarted} ms (${chunk.length} postings): ${err instanceof Error ? err.message : String(err)}; stopping — the caller treats this run as incomplete`,
        );
        // The caller never accepts a partial profile result, so scoring the remaining chunks would only add load
        // to a scorer that is already failing or slow. Stop here and let the retry start clean.
        return out;
      }
    }
    this.logger.log(`scoreProfileBatch scored ${out.size}/${postings.length} postings in ${totalChunks} chunks for profile ${profile.id} in ${Date.now() - startedAt} ms`);
    return out;
  }
}
