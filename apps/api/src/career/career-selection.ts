import type { CareerEntry } from '@prisma/client';

/** Document-ready forms of confirmed career entries. `entryId` ties every line back to the entry it came from. */
export interface CareerSections {
  projects: { entryId: string; name: string; period: string; description: string; result?: string; organization?: string }[];
  languages: { entryId: string; language: string; fluency: string; level: number }[];
  certifications: { entryId: string; title: string; issuer: string; date: string; description?: string }[];
  activities: { entryId: string; kind: string; title: string; role: string; organization: string; period: string; description: string; result?: string }[];
  awards: { entryId: string; title: string; issuer: string; date: string }[];
  stories: { entryId: string; title: string; situation: string; action: string; result: string }[];
}

export type DocumentFormat = 'resume' | 'cv';

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d: Date | null, precision: string) => (d ? (precision === 'YEAR' ? String(d.getUTCFullYear()) : `${EN_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`) : '');

/** "2021 - 2022", "Sep 2020 - Present", a single stated date, or '' when the entry states none. */
export function periodOf(e: Pick<CareerEntry, 'startDate' | 'endDate' | 'current' | 'datePrecision'>): string {
  const start = fmt(e.startDate, e.datePrecision);
  const end = e.current ? 'Present' : fmt(e.endDate, e.datePrecision);
  if (start && end && start !== end) return `${start} - ${end}`;
  return start || end;
}

const fold = (s: unknown) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i').replace(/ə/g, 'e');
const words = (s: string) => new Set(fold(s).match(/[\p{L}\p{N}][\p{L}\p{N}+#.]{3,}/gu) ?? []);

/** Whole months the candidate has worked, counting overlapping roles once. */
export function experienceMonths(experiences: { startDate: Date | null; endDate: Date | null }[], now = new Date()): number {
  const spans = experiences.filter((e): e is { startDate: Date; endDate: Date | null } => !!e.startDate).map((e) => [e.startDate.getTime(), (e.endDate ?? now).getTime()] as const).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curEnd = -Infinity;
  for (const [s, e] of spans) {
    if (e <= s) continue;
    const from = Math.max(s, curEnd);
    if (e > from) total += e - from;
    curEnd = Math.max(curEnd, e);
  }
  return Math.floor(total / (30.44 * 86_400_000));
}

/** An experienced candidate is not given school-era extracurriculars by default. */
export const EXPERIENCED_MONTHS = 36;

const relevance = (e: CareerEntry, jobWords: Set<string>): number => {
  if (!jobWords.size) return 0;
  const mine = words([e.title, e.organization, e.role, e.description, e.result, e.situation, e.action, e.level].filter(Boolean).join(' '));
  let n = 0;
  for (const w of mine) if (jobWords.has(w)) n++;
  return n;
};

const recency = (e: CareerEntry) => (e.current ? Date.now() : (e.endDate ?? e.issuedAt ?? e.startDate)?.getTime() ?? 0);

function toSections(entries: CareerEntry[]): CareerSections {
  const out: CareerSections = { projects: [], languages: [], certifications: [], activities: [], awards: [], stories: [] };
  for (const e of entries) {
    if (e.kind === 'PROJECT') out.projects.push({ entryId: e.id, name: e.title, period: periodOf(e), description: e.description ?? '', ...(e.result ? { result: e.result } : {}), ...(e.organization ? { organization: e.organization } : {}) });
    else if (e.kind === 'LANGUAGE') out.languages.push({ entryId: e.id, language: e.title, fluency: e.level ?? '', level: 0 });
    else if (e.kind === 'CERTIFICATION') out.certifications.push({ entryId: e.id, title: e.title, issuer: e.organization ?? '', date: fmt(e.issuedAt, e.datePrecision), ...(e.description ? { description: e.description } : {}) });
    else if (e.kind === 'VOLUNTEERING' || e.kind === 'LEADERSHIP' || e.kind === 'EXTRACURRICULAR') {
      out.activities.push({ entryId: e.id, kind: e.kind, title: e.title, role: e.role ?? '', organization: e.organization ?? '', period: periodOf(e), description: e.description ?? '', ...(e.result ? { result: e.result } : {}) });
    } else if (e.kind === 'AWARD') out.awards.push({ entryId: e.id, title: e.title, issuer: e.organization ?? '', date: fmt(e.issuedAt, e.datePrecision) });
    else if (e.kind === 'STORY') out.stories.push({ entryId: e.id, title: e.title, situation: e.situation ?? '', action: e.action ?? '', result: e.result ?? '' });
  }
  return out;
}

/** Everything the candidate has confirmed (review screens may add back any of it). */
export function fullCareerSections(entries: CareerEntry[]): CareerSections {
  return toSections(entries.filter((e) => e.status === 'CONFIRMED'));
}

/**
 * The confirmed entries worth putting in THIS document. Rules (documented in docs/career-evidence-2026-10-04.md):
 *  - hidden and unconfirmed entries are never used;
 *  - languages always, certifications by relevance (a short resume keeps the relevant ones, or the three most recent when none match);
 *  - projects are ranked by relevance to the vacancy, then recency; a resume keeps at most two;
 *  - volunteering / leadership / extracurricular / awards: a candidate with fewer than 36 months of experience gets them; an experienced candidate
 *    gets only the ones that match the vacancy or that they marked "always include";
 *  - stories are letter material only and never appear in a resume or CV.
 */
export function selectCareerSections(
  entries: CareerEntry[],
  opts: { format: DocumentFormat; experienceMonths: number; jobText: string; selectedCareerEntryIds?: string[] },
): CareerSections {
  if (opts.selectedCareerEntryIds !== undefined) {
    const selected = new Set(opts.selectedCareerEntryIds);
    return toSections(entries.filter((e) => e.status === 'CONFIRMED' &&
      (e.kind === 'LANGUAGE' || selected.has(e.id))));
  }
  const jobWords = words(opts.jobText);
  const confirmed = entries.filter((e) => e.status === 'CONFIRMED');
  const scored = confirmed.map((e) => ({ e, score: relevance(e, jobWords) }));
  const experienced = opts.experienceMonths >= EXPERIENCED_MONTHS;
  const byRank = (a: { e: CareerEntry; score: number }, b: { e: CareerEntry; score: number }) => b.score - a.score || recency(b.e) - recency(a.e) || a.e.sortOrder - b.e.sortOrder;
  const kept: CareerEntry[] = [];

  for (const kind of ['LANGUAGE'] as const) kept.push(...scored.filter((x) => x.e.kind === kind).sort(byRank).map((x) => x.e));

  const certs = scored.filter((x) => x.e.kind === 'CERTIFICATION').sort(byRank);
  if (opts.format === 'cv') kept.push(...certs.map((x) => x.e));
  else {
    const relevant = certs.filter((x) => x.score > 0 || x.e.alwaysInclude);
    kept.push(...(relevant.length ? relevant : certs.slice(0, 3)).map((x) => x.e));
  }

  const projects = scored.filter((x) => x.e.kind === 'PROJECT').sort(byRank);
  if (opts.format === 'cv') kept.push(...projects.map((x) => x.e));
  else {
    const relevant = projects.filter((x) => x.score > 0 || x.e.alwaysInclude);
    kept.push(...(relevant.length ? relevant : experienced ? [] : projects).slice(0, 2).map((x) => x.e));
  }

  const soft = scored.filter((x) => ['VOLUNTEERING', 'LEADERSHIP', 'EXTRACURRICULAR', 'AWARD'].includes(x.e.kind)).sort(byRank);
  const allowed = soft.filter((x) => x.e.alwaysInclude || (experienced ? x.score > 0 : opts.format === 'cv' || x.score > 0 || soft.indexOf(x) < 2));
  kept.push(...allowed.map((x) => x.e));
  return toSections(kept);
}

/**
 * Confirmed entries (projects, activities, awards, certifications, languages) that did not make it into a document, so the candidate is told instead of finding out
 * later. Stories are letter material and are never expected in a CV or resume.
 */
export function leftOutEntries(confirmed: CareerEntry[], sections: CareerSections): { kind: string; title: string }[] {
  const included = new Set<string>([...sections.projects, ...sections.languages, ...sections.certifications, ...sections.activities, ...sections.awards].map((x) => x.entryId));
  // Only kinds a CV or resume can show: stories are letter material and OTHER notes are never document content.
  const shown = new Set(['PROJECT', 'LANGUAGE', 'CERTIFICATION', 'VOLUNTEERING', 'LEADERSHIP', 'EXTRACURRICULAR', 'AWARD']);
  return confirmed.filter((e) => e.status === 'CONFIRMED' && shown.has(e.kind) && !included.has(e.id)).map((e) => ({ kind: e.kind, title: e.title }));
}
