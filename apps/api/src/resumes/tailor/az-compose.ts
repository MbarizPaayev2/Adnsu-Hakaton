import type { Persona, TailorJobInput } from './resume-tailor.types';
import { languageProblems, tenseProblems } from './az-language';
import { detectScope } from './az-evidence-mapping';
import { postingLines } from '../../jobs/posting-sections';
import { analyzeVacancy, type VacancyAnalysis } from './az-vacancy-analysis';

/**
 * Azerbaijani documents are COMPOSED, not free-written by the model.
 *
 * Measured (9 Oct 2026, real model, synthetic candidates, real vacancies): the production model's free Azerbaijani prose is not reliable even with
 * mechanical gates: Turkish endings, "edirem" for "edirəm", invented words, changed meanings. So for Azerbaijani the words come from three places only:
 *   1. the candidate's own confirmed wording (highlights, stories, projects, motivation), verbatim;
 *   2. the vacancy's own wording (requirement lines), verbatim;
 *   3. a handful of fixed frames below, written once and reviewable by a native reader.
 * The model's job is limited to JUDGEMENT expressed as ids (which of the candidate's items matter most for this vacancy, which requirement a fact
 * answers); code validates the ids. A model that is down or answers badly only costs the ordering: the deterministic ranking below takes over.
 *
 * Nothing here claims the composed text is natural Azerbaijani; the frames are short on purpose and a native reader must approve them.
 */

const FOLD: Record<string, string> = { ə: 'e', ı: 'i', ğ: 'g', ş: 's', ö: 'o', ü: 'u', ç: 'c' };
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[əığşöüç]/g, (c) => FOLD[c] || c);

function containsWord(haystackFolded: string, needleFolded: string): boolean {
  const escaped = needleFolded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u').test(haystackFolded);
}

const KEEP_CAPITAL = new Set([
  'sql', 'aws', 'gcp', 'azure', 'it', 'hr', 'qa', 'bi', 'crm', 'erp', 'api', 'rest', 'ci/cd',
  'python', 'java', 'javascript', 'typescript', 'react', 'docker', 'kubernetes', 'excel', 'power bi',
]);
export const plainCase = (text: string): string => {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const first = t.split(/\s+/)[0] ?? '';
  if (/^[A-Z]{2,}/.test(first) || KEEP_CAPITAL.has(first.toLowerCase())) return t;
  return t[0].toLocaleLowerCase('az') + t.slice(1);
};

/** Distinct 5-letter stems of the words (5+ letters) of a text: tolerant of Azerbaijani suffixes without a stemmer. */
const DOMAIN_ACRONYMS = new Set([
  'data', 'word', 'ppt', 'stok', 'rpa', 'sql', 'bi', 'agv', 'ocr', 'ai', 'ml', 'qa', 'hr', 'sme', 'roi', 'crm', 'erp', 'api', 'etl', 'elt', 'dax', 'git', 'aws', 'gcp', 'b2b', 'b2c', 'kpi',
  'jira', 'bpmn', 'scrum', 'agile', 'java', 'rust', 'c#', 'c++', 'php', 'vue', 'sap', '1c',
]);

const STEM_ALIASES: Record<string, string> = {
  hyper: 'hiper',
  hiper: 'hiper',
  autom: 'avtom',
  avtom: 'avtom',
  analy: 'anali',
  anali: 'anali',
  devel: 'inkis',
  inkis: 'inkis',
  resea: 'tedqi',
  tedqi: 'tedqi',
};

export function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of fold(text).split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue;
    if (DOMAIN_ACRONYMS.has(w)) {
      out.add(w);
      continue;
    }
    if (w.length >= 5) {
      const rawStem = w.slice(0, 5);
      const aliased = STEM_ALIASES[rawStem] ?? rawStem;
      out.add(aliased);
      out.add(rawStem);
    }
  }
  return out;
}

export function vacancyTerms(job: TailorJobInput): Set<string> {
  return stems([job.position, job.requirements, job.responsibilities, job.description].join('\n'));
}

/** How many of a text's stems the vacancy also uses. */
export function relevance(text: string, terms: Set<string>): number {
  let n = 0;
  for (const s of stems(text)) if (terms.has(s)) n++;
  return n;
}

/** General application prose cannot establish task relevance. Match subject matter, not “prepared / used / experience”. */
const GENERIC_EVIDENCE_STEMS = new Set([
  'teleb', 'bacar', 'bilik', 'tecru', 'vezif', 'vakan', 'sahit', 'sirket', 'kompa', 'muess',
  'uzre', 'ucun', 'hazir', 'istif', 'etmis', 'etdim', 'edir', 'islem', 'yerin', 'yetir',
  'edilm', 'edile', 'edili', 'olunm', 'oluna', 'apari', 'temin', 'mesul', 'feali', 'inkis', 'sahes', 'sahad', 'imkan', 'pesek', 'uygun', 'konkr',
  'netic', 'metod', 'muhit', 'tedbi', 'prose', 'emeli', 'minimum', 'exper',
  'skill', 'knowl', 'requi', 'respo', 'worki', 'work', 'prepa', 'devel', 'using', 'with', 'role',
]);
const EVIDENCE_SYNONYMS: Record<string, string> = {
  analy: 'anali', analyti: 'anali', sale: 'satis', sales: 'satis', custo: 'muste', clien: 'muste',
  order: 'sifar', repor: 'hesab', marke: 'bazar', resea: 'tedqi', prese: 'teqdi',
  engli: 'ingil', russi: 'rus', negot: 'danis', inven: 'stok', wareh: 'anbar', reven: 'gelir', testi: 'test',
};
export function evidenceTerms(text: string): Set<string> {
  return new Set([...stems(text)].filter((stem) => !GENERIC_EVIDENCE_STEMS.has(stem)).map((stem) => EVIDENCE_SYNONYMS[stem] ?? stem));
}

/** Deterministic task-first relevance. Employer prestige, numbers and verbosity earn no bonus. */
export function vacancyEvidenceScore(text: string, job: TailorJobInput): number {
  const analysis = analyzeVacancy(job);
  const weights = new Map<string, number>();
  const add = (value: string, weight: number) => {
    for (const term of evidenceTerms(value)) weights.set(term, Math.max(weights.get(term) ?? 0, weight));
  };
  add(job.position || '', 3);
  analysis.principalResponsibilities.forEach((line) => add(line, 2));
  [...analysis.requiredQualifications, ...analysis.preferredQualifications].forEach((line) => add(line, 1));
  // For genuinely sparse/unstructured postings, retain meaningful source terms as a conservative fallback.
  if (!analysis.principalResponsibilities.length && !analysis.requiredQualifications.length && !analysis.preferredQualifications.length) add(job.description || '', 1);
  return [...evidenceTerms(text)].reduce((total, term) => total + (weights.get(term) ?? 0), 0);
}

export function rankByVacancyEvidence<T>(items: T[], textOf: (item: T) => string, job: TailorJobInput): T[] {
  return items.map((item, index) => ({ item, index, score: vacancyEvidenceScore(textOf(item), job) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map((row) => row.item);
}

/** Stable order by relevance, highest first; equal scores keep the candidate's own order. */
export function rankByRelevance<T>(items: T[], textOf: (item: T) => string, terms: Set<string>): T[] {
  return items
    .map((item, index) => ({ item, index, score: relevance(textOf(item), terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.item);
}

/** Applies an order of indices proposed by the model: unknown or repeated indices are ignored and anything it left out follows in its original order. */
export function applyOrder<T>(items: T[], order: unknown): T[] {
  const seen = new Set<number>();
  const picked: T[] = [];
  if (Array.isArray(order)) {
    for (const raw of order) {
      const i = Number(raw);
      if (Number.isInteger(i) && i >= 0 && i < items.length && !seen.has(i)) {
        seen.add(i);
        picked.push(items[i]);
      }
    }
  }
  items.forEach((item, i) => { if (!seen.has(i)) picked.push(item); });
  return picked;
}

const trimEnd = (s: string) => s.replace(/[\s.;:,!?…]+$/u, '').trim();

/** The requirement lines of a vacancy, verbatim: bullet or sentence sized, without digits (a number the vacancy states is not a fact about the candidate), without addresses or links (a posting must not be able to put a contact into a candidate's letter). */
export function vacancyRequirements(job: TailorJobInput, max = 12): string[] {
  const raw = [job.requirements, job.responsibilities, job.description].join('\n');
  const bulletStart = /^\s*[-–•·*▪●]/u;
  const all = raw.split(/\r?\n|(?<=[.;])\s+/);
  // A posting's requirement lines are its bullets; prose sentences (the introduction) are used only when there are fewer than two bullets.
  const bullets = all.filter((l) => bulletStart.test(l));
  const pool = bullets.length >= 2 ? bullets : all;
  const own = fold(job.position || '');
  const lines = pool
    .map((l) => l.replace(/^[\s\-–•·*▪●]+/u, '').replace(/^\d+[.)]\s+/, ''))
    .map(trimEnd)
    .filter((l) => l.length >= 20 && l.length <= 130 && !/\d/.test(l) && !/@|https?:|www\./i.test(l) && /\p{L}/u.test(l))
    .filter((l) => !/axtar(?:ırıq|iriq)|işə götürürük/i.test(l) && !(own.length >= 8 && fold(l).includes(own)));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const k = fold(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
    if (out.length >= max) break;
  }
  return out;
}

/** A statement of what the candidate does NOT have ("Satış təcrübəsi yoxdur", "səlahiyyəti olmayıb"): never presented as an example of experience. */
export const isNegatedStatement = (text: string) => /(?:yoxdur|yoxdu|olmayıb|olmayıbdır|keçməyib|deyil|bilmir|bilmirəm|yoxdur)[\s.!;:]*$/iu.test(String(text ?? '').trim());

/** Tool and abbreviation tokens of 2 to 4 letters (SQL, SAP, Java, Excel): stems() ignores words under five letters, so they are matched whole. */
const shortTokens = (text: string) => new Set(fold(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && w.length <= 4 && /[a-z]/.test(w) && !/^(ve|ile|ucun|bir|her|bu|ya|da|de|ki|ən|en)$/.test(w)));

/**
 * Requirement lines of a vacancy that NOTHING the candidate confirmed speaks to (no shared word stem, no shared tool name). These become a question for the
 * candidate at review ("do you have real experience with this?"), never a claim in the letter. At most `max`, in the order the vacancy lists them.
 */
export function uncoveredRequirements(requirementLines: string[], candidateTexts: string[], max = 2): string[] {
  const have = stems(candidateTexts.join('\n'));
  const haveShort = shortTokens(candidateTexts.join('\n'));
  const out: string[] = [];
  for (const line of requirementLines) {
    const need = stems(line);
    const needShort = shortTokens(line);
    if (!need.size && !needShort.size) continue;
    const covered = [...need].some((s) => have.has(s)) || [...needShort].some((t) => haveShort.has(t));
    if (!covered) out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

/** The candidate's own evidence sentences with ids: role highlights, project texts, activities, awards, story actions/results, certifications. Verbatim. */
export interface EvidenceItem { id: string; text: string; source: 'experience' | 'project' | 'activity' | 'award' | 'story' | 'certification' }
export function candidateEvidence(persona: Persona, max = Number.POSITIVE_INFINITY): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const add = (source: EvidenceItem['source'], text: string) => {
    const t = String(text || '').trim();
    if (t.length >= 8) items.push({ id: `E${items.length + 1}`, text: t, source });
  };
  for (const e of persona.experience ?? []) for (const h of e.highlights ?? []) add('experience', h);
  for (const p of persona.projects ?? []) add('project', [p.name, p.description, p.result].filter(Boolean).join('. '));
  for (const a of persona.activities ?? []) add('activity', [a.title, a.organization, a.description, a.result].filter(Boolean).join('. '));
  for (const w of persona.awards ?? []) add('award', [w.title, w.issuer].filter(Boolean).join(' - '));
  for (const s of persona.stories ?? []) add('story', [s.title, s.action, s.result].filter(Boolean).join(' '));
  for (const c of persona.certifications ?? []) add('certification', [c.title, c.issuer].filter(Boolean).join(' - '));
  return items.slice(0, max);
}

/**
 * First person for the candidate's own finished actions: a simple-past verb ("apardı", "qurdu", "təhlil etdi") takes -m ("apardım"), also before "və".
 * Left untouched, in the candidate's own words: passive and result verbs whose subject is not the candidate ("bağlandı", "azaldı", "oldu"), and anything that is not a
 * simple past. The frame around the sentence never relies on the conversion being right.
 */
const NOT_A_PERSONAL_ACTION = /(?:ldı|ldi|ldu|ldü|ndı|ndi|ndu|ndü|oldu|artdı|düşdü|bitdi|başladı|çatdı)$/u;
function convertSegment(segment: string): string {
  const words = segment.trim().split(/\s+/);
  const last = words[words.length - 1] ?? '';
  const bare = last.replace(/[.;:,!?]+$/u, '');
  if (/(?:dı|di|du|dü)$/u.test(bare) && !NOT_A_PERSONAL_ACTION.test(bare)) words[words.length - 1] = `${bare}m${last.slice(bare.length)}`;
  return words.join(' ');
}
export function firstPerson(text: string): string {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => trimEnd(sentence))
    .filter(Boolean)
    .map((sentence) => sentence.split(/ və /).map(convertSegment).join(' və '))
    .join('. ');
}

export interface LetterMatch { requirement: string; evidence: EvidenceItem }

/** Deterministic matches: for each of the most relevant requirements the candidate evidence sharing the most stems (at least 2). */
export function deterministicMatches(requirements: string[], evidence: EvidenceItem[], max = 2): LetterMatch[] {
  const out: LetterMatch[] = [];
  const used = new Set<string>();
  const scored = requirements
    .map((requirement) => {
      const reqStems = stems(requirement);
      const best = evidence
        .filter((e) => !used.has(e.id) && !isNegatedStatement(e.text))
        .map((e) => ({ e, score: [...stems(e.text)].filter((s) => reqStems.has(s)).length }))
        .sort((a, b) => b.score - a.score)[0];
      return { requirement, best };
    })
    // At least two shared word stems AND about a third of the requirement's own: two incidental words ("verilənlər bazası") must not be presented as an answer.
    .filter((x) => x.best && x.best.score >= 2 && x.best.score / Math.max(1, stems(x.requirement).size) >= 0.34)
    .sort((a, b) => b.best!.score - a.best!.score);
  for (const x of scored) {
    if (used.has(x.best!.e.id)) continue;
    used.add(x.best!.e.id);
    out.push({ requirement: x.requirement, evidence: x.best!.e });
    if (out.length >= max) break;
  }
  return out;
}

/** Validates the model's id pairs {r: index of a requirement, e: id of an evidence item}; anything unknown is dropped. */
export function validateMatches(raw: unknown, requirements: string[], evidence: EvidenceItem[], max = 2): LetterMatch[] {
  if (!Array.isArray(raw)) return [];
  const out: LetterMatch[] = [];
  const usedReq = new Set<number>();
  const usedEv = new Set<string>();
  for (const m of raw) {
    const r = Number((m as any)?.r);
    const e = evidence.find((x) => x.id === String((m as any)?.e));
    if (!Number.isInteger(r) || r < 0 || r >= requirements.length || !e || usedReq.has(r) || usedEv.has(e.id)) continue;
    // A pairing says "this evidence answers that requirement": it needs at least one word in common, so a model cannot attach unrelated evidence to a requirement.
    if (![...stems(e.text)].some((st) => stems(requirements[r]).has(st))) continue;
    usedReq.add(r);
    usedEv.add(e.id);
    out.push({ requirement: requirements[r], evidence: e });
    if (out.length >= max) break;
  }
  return out;
}

/** The composed CV has no summary: the header already carries the candidate's own headline and the skills section lists the (relevance-ordered) skills. A summary would only repeat them. */
export function composeSummary(): string {
  return '';
}

/**
 * Composes a genuine vacancy-specific professional summary,
 * strictly grounded in confirmed candidate facts (confirmed education, confirmed experience/roles, and confirmed matching skills).
 * Absolutely no shortcuts, no hardcoded domain heuristics, and no unconfirmed qualifications.
 */
export function composeVacancySummary(
  persona: Persona,
  job?: TailorJobInput,
  terms?: Set<string>,
  language = 'az',
): string {
  if (!job) return persona.summary || '';

  const isEn = language === 'en';
  const vacWords = terms ?? vacancyTerms(job);
  const allSkills = (persona.skills ?? []).flatMap((s) => s.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const analysis = analyzeVacancy(job);
  const selectedSkills = new Set(groupAndRankSkills(persona, job, analysis, language)
    .flatMap((group) => /dil|language/i.test(group.name)
      ? group.keywords.filter((skill) => [...evidenceTerms(skill)].some((term) => analysis.spokenLanguages.some((lang) => evidenceTerms(lang).has(term))))
      : group.keywords));
  const matchedSkills = allSkills.filter((skill) => selectedSkills.has(skill));

  // 2. Map candidate background: distinguish substantive employment from training/mentorship/internship
  const exp = persona.experience ?? [];
  const substantiveExp = exp.filter((e) => detectScope('experience', e.position, e.company) === 'employment');
  const roleScore = (e: typeof exp[number]) => vacancyEvidenceScore([e.position, ...(e.highlights ?? [])].join(' '), job);
  const recentSubstantive = [...substantiveExp].filter((e) => roleScore(e) > 0).sort((a, b) => roleScore(b) - roleScore(a))[0];
  const recentAny = [...exp].filter((e) => roleScore(e) > 0).sort((a, b) => roleScore(b) - roleScore(a))[0];
  const primaryEdu = persona.education?.[0];
  const eduArea = primaryEdu?.area?.trim();

  // If candidate had no summary, only compose one when sufficient confirmed evidence exists
  const hasExistingSummary = Boolean(persona.summary?.trim());
  const hasSufficientEvidence = Boolean(
    recentSubstantive || eduArea || (recentAny && (matchedSkills.length > 0 || allSkills.length > 0)) || persona.projects?.length || persona.activities?.length,
  );
  if (!hasExistingSummary && !hasSufficientEvidence) {
    return '';
  }

  // Prefer a short, source-backed deliverable across ALL career sections over a generic title frame.
  const summaryFacts = [
    ...exp.flatMap((e) => e.highlights ?? []),
    ...(persona.projects ?? []).flatMap((p) => [p.description, p.result].filter((t): t is string => !!t)),
    ...(persona.activities ?? []).flatMap((a) => [a.description, a.result].filter((t): t is string => !!t)),
  ];
  const evidence = summaryFacts.flatMap((text) => text.split(/(?<=[.!?])\s+|\n+/u))
    .map((text, index) => {
    const sentence = text.replace(/^\s*[-•–]\s*/, '').trim();
    return { sentence, index, score: vacancyEvidenceScore(sentence, job) };
  }).filter((item) => item.score > 0 && item.sentence.length <= 360 && !isNegatedStatement(item.sentence))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0];
  if (evidence) {
    const fact = /[.!?]$/u.test(evidence.sentence) ? evidence.sentence : `${evidence.sentence}.`;
    const skills = groupAndRankSkills(persona, job, undefined, language).filter((group) => !/dil|language/i.test(group.name)).flatMap((group) => group.keywords).slice(0, 3);
    return skills.length ? `${fact} ${isEn ? 'Relevant skills' : 'Vakansiya ilə əlaqəli bacarıqlar'}: ${skills.join(', ')}.` : fact;
  }

  let s1 = '';
  let s2 = '';

  // 3. Sentence 1: Anchored in confirmed background, without turning a job title into a field of expertise
  if (recentSubstantive) {
    const roleTitle = plainCase(recentSubstantive.position);
    if (isEn) {
      s1 = `Has worked as ${recentSubstantive.position}.`;
    } else {
      s1 = `${roleTitle} vəzifəsində iş təcrübəsi var.`;
    }
  } else if (eduArea) {
    if (isEn) {
      s1 = `Brings academic training in ${eduArea} with hands-on practical preparation.`;
    } else {
      s1 = `${eduArea} üzrə akademik təhsilə və sahə üzrə praktiki hazırlığa malikdir.`;
    }
  } else if (recentAny) {
    const roleTitle = plainCase(recentAny.position);
    if (isEn) {
      s1 = `Has training experience as ${roleTitle}.`;
    } else {
      s1 = `${roleTitle} kimi təcrübə keçib.`;
    }
  }

  // 4. Sentence 2: Grounded in confirmed matching skills and target role contribution
  if (matchedSkills.length > 0) {
    const topSkills = matchedSkills.slice(0, 3).join(', ');
    if (isEn) {
      s2 = `Relevant skills: ${topSkills}.`;
    } else {
      s2 = `Vakansiya ilə əlaqəli bacarıqlar: ${topSkills}.`;
    }
  }

  return `${s1} ${s2}`.trim();
}

/**
 * Generates a concise, editable, vacancy-specific document headline using the target role
 * and confirmed candidate strengths. When a role title would imply experience or credentials
 * the candidate does not possess (e.g. applying for a Senior role without senior credentials,
 * or career changers / students / interns without substantive employment in that role),
 * it is explicitly identified as a target role (e.g., "Hədəf vəzifə: ..." or "Target role: ...").
 *
 * This headline is local to the document and never overwrites the candidate's global profile.
 */
export const GENERIC_HIERARCHY_WORDS = new Set([
  'manager', 'menecer', 'müdir', 'mudir', 'rəhbər', 'rehber',
  'lead', 'leader', 'lider', 'head', 'başçı', 'basci',
  'director', 'direktor', 'chief',
  'coordinator', 'koordinator',
  'supervisor', 'nəzarətçi', 'nezaretci',
  'officer', 'zabit',
  'specialist', 'mütəxəssis', 'mutexessis',
  'expert', 'ekspert',
  'consultant', 'məsləhətçi', 'meslehetci', 'advisor',
  'assistant', 'assistent', 'köməkçi', 'komekci',
  'associate', 'əməkdaş', 'emekdas',
  'representative', 'təmsilçi', 'temsilci',
  'worker', 'işçi', 'isci',
  'intern', 'təcrübəçi', 'tecrubeci', 'trainee', 'stajor', 'stajyer', 'şagird', 'sagird', 'kursant',
  'administrator', 'admin', 'inzibatçı', 'inzibatci',
]);

export const GENERIC_SENIORITY_WORDS = new Set([
  'senior', 'baş', 'bas', 'aparıcı', 'aparici', 'böyük', 'boyuk',
  'junior', 'kiçik', 'kicik',
  'mid', 'middle', 'orta',
  'principal', 'staff',
]);

export const HIERARCHY_OR_QUALIFIER_STEMS = new Set([
  'manag', 'menec', 'mudir', 'rehbe',
  'leade', 'lider', 'basci', 'direc',
  'coord', 'koord', 'super', 'nezar',
  'offic', 'zabit', 'speci', 'mutex',
  'exper', 'ekspe', 'consu', 'mesle',
  'advis', 'assis', 'komek', 'assoc',
  'emekd', 'repre', 'temsi', 'worke',
  'iscil', 'inter', 'tecru', 'stajo',
  'stajy', 'sagir', 'kursa', 'admin',
  'inzib', 'senio', 'apari', 'boyuk',
  'junio', 'kicik', 'middl', 'princ',
  'staff',
]);

export function extractDomainStems(title: string): Set<string> {
  const out = new Set<string>();
  const words = fold(title).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const TECH_SHORT = new Set(['go', 'qa', 'hr', 'ui', 'ux', 'bi', 'it', 'ai', 'ml', '1c', 'db', 'pr']);
  for (const w of words) {
    if (GENERIC_HIERARCHY_WORDS.has(w) || GENERIC_SENIORITY_WORDS.has(w)) continue;
    if (w.length < 3) {
      if (TECH_SHORT.has(w)) out.add(w);
      continue;
    }
    const s5 = w.length >= 5 ? w.slice(0, 5) : w;
    if (HIERARCHY_OR_QUALIFIER_STEMS.has(s5)) continue;
    out.add(s5);
  }
  return out;
}

/**
 * Strips department, center, division or organizational unit prefixes from institutional vacancy titles
 * so the document headline identifies the concise occupational function.
 * e.g. "Hiper avtomatlaşdırma üzrə ekspert mərkəzinə proseslərin avtomatlaşdırılması üzrə analitik"
 * -> "Proseslərin avtomatlaşdırılması üzrə analitik"
 */
export function cleanDisplayRole(rawTitle: string): string {
  let s = String(rawTitle ?? '').trim();
  if (!s) return '';
  // 1. Azerbaijani institutional / departmental prefix with dative or separator
  const DEPT_AZ_RE = /^(?:[\p{L}\d\s-]+\s+(?:üzrə\s+)?(?:ekspert\s+)?(?:mərkəzinə|departamentinə|idarəsinə|şöbəsinə|bölməsinə|qrupuna|komandasına|filialına|mərkəzi|departamenti|idarəsi|şöbəsi|bölməsi)\s*[:\-\/|–—]?\s*)/iu;
  s = s.replace(DEPT_AZ_RE, '');
  // 2. English institutional / departmental prefix
  const DEPT_EN_RE = /^(?:(?:Center of Excellence|Department|Division|Unit|Branch)\s+(?:for|in|of)\s+[^:–—\/-]+[:–—\/-|]\s*)/iu;
  s = s.replace(DEPT_EN_RE, '');
  // 3. Domain slash/dash prefix: "IT / Developer", "Rəqəmsal İnkişaf / Proses analitiki"
  const DOMAIN_SLASH_RE = /^(?:(?:IT|HR|Maliyyə|Rəqəmsal\s+İnkişaf|Audit|Əməliyyat)\s*(?:departamenti|şöbəsi|mərkəzi)?\s*[\/|–—]\s*)(.+)$/iu;
  const sepMatch = s.match(DOMAIN_SLASH_RE);
  if (sepMatch && sepMatch[1]?.trim()) {
    s = sepMatch[1].trim();
  }
  s = s.replace(/^[:\-\/|–—\s]+/, '').trim();
  return s.length > 0 ? (s[0].toLocaleUpperCase('az') + s.slice(1)) : rawTitle.trim();
}

export function composeTargetRoleHeadline(
  persona: Persona,
  job?: TailorJobInput,
  analysis?: VacancyAnalysis,
  language = 'az',
): string {
  if (!job?.position?.trim()) return persona.basics?.headline || '';

  const isEn = language === 'en';
  const rawRole = trimEnd(job.position.trim());
  const displayRole = cleanDisplayRole(rawRole);
  const targetRole = displayRole || rawRole;
  const ana = analysis ?? analyzeVacancy(job);

  // Check confirmed candidate experience
  const exp = persona.experience ?? [];
  const substantiveExp = exp.filter((e) => detectScope('experience', e.position, e.company) === 'employment');

  // Determine substantive domain match:
  // Candidate must possess confirmed experience in the specific occupational domain,
  // not merely shared generic hierarchy words like "manager", "specialist" or "lead".
  const targetDomainStems = extractDomainStems(targetRole);

  const domainMatchedExp = substantiveExp.filter((e) => {
    const eDomain = extractDomainStems(e.position);
    if (targetDomainStems.size === 0) return true;
    return [...targetDomainStems].some((s) => eDomain.has(s));
  });

  const hasSubstantiveRoleMatch = domainMatchedExp.length > 0;

  // Determine domain-specific seniority:
  // A candidate only has domain-specific seniority if they carry senior/lead credentials
  // in that SAME occupational domain.
  const targetSeniority = ana.statedSeniority;
  const isSeniorTitle = (pos: string) =>
    /\b(senior|baş|aparıcı|lead|rəhbər|director|head|principal|staff|chief)\b/i.test(pos);

  const candidateHasDomainSeniority = domainMatchedExp.some((e) => isSeniorTitle(e.position));
  const lacksSeniority = (targetSeniority === 'senior' || targetSeniority === 'lead') && !candidateHasDomainSeniority;

  // Determine if candidate already carries this title in their headline
  const headlineDomain = extractDomainStems(persona.basics?.headline ?? '');
  const headlineHasDomain = targetDomainStems.size > 0
    ? [...targetDomainStems].some((s) => headlineDomain.has(s))
    : false;
  const candidateAlreadyTitled = !lacksSeniority && hasSubstantiveRoleMatch && headlineHasDomain;

  // Determine if target prefix is required:
  // 1. Cross-domain candidate (e.g. Sales Manager applying for Engineering Manager)
  // 2. Student / intern / career changer without substantive employment in this domain
  // 3. Stated seniority is missing from candidate's confirmed career in this domain
  const needsTargetPrefix = !candidateAlreadyTitled && (!hasSubstantiveRoleMatch || lacksSeniority || substantiveExp.length === 0);

  // The headline uses the same selected skills as the body, not a separate loose keyword matcher.
  const matchedSkills = groupAndRankSkills(persona, job, ana, language)
    .filter((group) => !/dil|language/i.test(group.name)).flatMap((group) => group.keywords)
    .filter((skill) => vacancyEvidenceScore(skill, job) > 0);

  // Avoid appending an overflowing list of tools to the headline
  // Only add at most 1-2 core skills if the headline remains compact (<= 45 chars) and candidate does not have a long target title
  const titleTerms = evidenceTerms(targetRole);
  const topSkills = matchedSkills.filter((skill) => [...evidenceTerms(skill)].some((term) => !titleTerms.has(term))).filter((skill) => !/^(?:(?:ms|microsoft)\s+)?(?:excel|word|outlook|powerpoint|office)$/iu.test(skill) || containsWord(fold(targetRole), fold(skill))).slice(0, 2);
  let strengthsText = '';
  if (targetRole.length <= 32 && topSkills.length > 0) {
    strengthsText = topSkills.join(isEn ? ' & ' : ', ');
    if (`${targetRole} | ${strengthsText}`.length > 48) {
      strengthsText = topSkills[0] || '';
    }
  } else if (!needsTargetPrefix && substantiveExp[0]) {
    // Only use prior position as trailer when candidate is confirmed in that domain
    const firstExpDomain = extractDomainStems(substantiveExp[0].position);
    const sharesDomain = [...targetDomainStems].some((s) => firstExpDomain.has(s));
    if (sharesDomain && fold(substantiveExp[0].position) !== fold(targetRole) && targetRole.length <= 28) {
      strengthsText = substantiveExp[0].position;
    }
  } else if (persona.education?.[0]?.area && targetRole.length <= 28) {
    if (vacancyEvidenceScore(persona.education[0].area, job) > 0) {
      strengthsText = persona.education[0].area;
    }
  }

  const prefix = needsTargetPrefix ? (isEn ? 'Target role: ' : 'Hədəf vəzifə: ') : '';
  const separator = strengthsText ? ' | ' : '';
  const headline = `${prefix}${targetRole}${separator}${strengthsText}`.trim();

  return headline.length > 100 ? `${headline.slice(0, 97)}…` : headline;
}

/**
 * Groups skills according to the candidate and vacancy:
 * 1. Technical Tools & Technologies ("Texniki alətlər və sistemlər")
 * 2. Domain Knowledge & Methodologies ("Sahəvi biliklər və metodologiyalar")
 * 3. Language Proficiency ("Dil bilikləri")
 * Skills are deduplicated and prioritized by vacancy relevance.
 */
export function groupAndRankSkills(
  persona: Persona,
  job?: TailorJobInput,
  analysis?: VacancyAnalysis,
  language = 'az',
): Persona['skills'] {
  const isEn = language === 'en';
  const allSkills = (persona.skills ?? []).flatMap((s) => s.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (!allSkills.length && !(persona.languages?.length)) return [];

  const ana = job ? (analysis ?? analyzeVacancy(job)) : undefined;
  const vacTools = new Set(ana?.toolsAndTechnologies ?? []);
  const vacWords = job ? vacancyTerms(job) : new Set<string>();

  const isTechVacancy = vacTools.size > 0 || [...vacWords].some((w) =>
    ['proqram', 'developer', 'muhendis', 'engineer', 'analitik', 'analyst', 'data', 'it', 'backend', 'frontend', 'software', 'devops', 'qa', 'veb', 'web', 'kod'].includes(w)
  );

  // Exclude spoken languages from technical and domain buckets, but collect them separately
  const SPOKEN_LANGUAGES_RE = /\b(?:azerbaycan|azerbaijani|ingilis|english|rus|russian|rusca|turk|turkish|turkce|alman|german|fransiz|french|ispan|spanish|ana\s+dili|serbest)\b/i;
  const isSpoken = (s: string) => {
    const f = fold(s);
    if (/\brust\b/i.test(f)) return false; // Rust programming language is never spoken Russian
    return SPOKEN_LANGUAGES_RE.test(f) || /\bdili\b/i.test(f);
  };

  const PROGRAMMING_RE = /\b(?:python|javascript|typescript|java|c\+\+|c#|golang|go|rust|php|ruby|swift|kotlin|scala|sql)\b/i;
  const TECHNICAL_TOOLS_RE = /\b(?:postgresql|postgres|mysql|mssql|oracle|mongodb|redis|docker|kubernetes|aws|azure|gcp|git|linux|excel|power bi|tableau|sas|word|outlook|powerpoint|ms office|visio|ppt|jira|confluence|figma|1c|sap|react|angular|vue|node\.js|django|fastapi|spring boot|\.net|ci\/cd|api|rest)\b/i;

  const toolSkills: string[] = [];
  const domainSkills: string[] = [];
  const spokenSkills: string[] = [];

  const seen = new Set<string>();

  for (const skill of allSkills) {
    const folded = fold(skill);
    if (!folded || seen.has(folded)) continue;
    seen.add(folded);

    if (isSpoken(skill)) {
      spokenSkills.push(skill);
    } else if (PROGRAMMING_RE.test(skill) || TECHNICAL_TOOLS_RE.test(skill) || vacTools.has(folded)) {
      toolSkills.push(skill);
    } else {
      domainSkills.push(skill);
    }
  }

  // Also include confirmed languages from persona.languages if present
  for (const lang of persona.languages ?? []) {
    const label = lang.fluency ? `${lang.language} — ${lang.fluency}` : lang.language;
    const f = fold(label);
    if (label && !seen.has(f)) {
      seen.add(f);
      spokenSkills.push(label);
    }
  }

  const fullJobText = job
    ? fold([job.position, ...[...postingLines(job.requirements, 'required'), ...postingLines(job.responsibilities, 'responsibility'), ...postingLines(job.description)].filter((line) => line.section !== 'other').map((line) => line.text)].filter(Boolean).join(' '))
    : '';

  // Helper to score and rank skills within group by vacancy relevance.
  // Default document skills must be candidate-supported skills explicitly required or preferred by the actual posting.
  // Automatic domain bonuses and accounting-tool defaults are strictly removed.
  const scoreSkill = (s: string): number => {
    const folded = fold(s);
    if (!folded) return 0;

    // Direct tool catalogue or whole-phrase match
    const unprefixed = folded.replace(/^(?:ms|microsoft)\s+/u, '');
    if (vacTools.has(folded) || vacTools.has(unprefixed) || containsWord(fullJobText, folded) || (unprefixed !== folded && containsWord(fullJobText, unprefixed))) {
      return 5;
    }

    // Technical tools should only match when explicitly present in the vacancy
    const isTech = toolSkills.includes(s) || PROGRAMMING_RE.test(s) || TECHNICAL_TOOLS_RE.test(s) || vacTools.has(folded);
    if (isTech) {
      return 0;
    }

    // A single common fragment cannot justify an entire multi-part skill.
    // “customer” alone must not select “cohort and customer retention analysis”.
    const skillTerms = evidenceTerms(s);
    const jobTerms = evidenceTerms(fullJobText);
    const shared = [...skillTerms].filter((term) => jobTerms.has(term)).length;
    if (skillTerms.size && shared >= Math.ceil(skillTerms.size * 0.67)) return 2;

    return 0;
  };

  // Determine whether the posting contains explicit usable skill/domain/qualification requirements
  // independently of whether the candidate matches them.
  const hasUsableVacancyRequirements = Boolean(
    job && (
      vacTools.size > 0 ||
      (ana?.domainKnowledge?.length ?? 0) > 0 ||
      (ana?.methodsAndFrameworks?.length ?? 0) > 0 ||
      (ana?.requiredQualifications?.length ?? 0) > 0 ||
      (ana?.priorities?.some((p) => p.category === 'tool_method' || p.category === 'required_qualification'))
    ),
  );

  const filterAndRank = (list: string[], groupType: 'tool' | 'domain'): string[] => {
    const scored = list.map((s) => ({ s, score: scoreSkill(s) }));
    if (!job) {
      return scored.sort((a, b) => b.score - a.score).map((x) => x.s);
    }
    // When explicit vacancy requirements exist:
    // Only keep skills with a direct vacancy connection (score >= 2).
    // When explicit requirements exist but none are supported, do NOT fill the tailored skills section with unrelated profile skills.
    if (hasUsableVacancyRequirements) {
      return scored.filter((x) => x.score >= 2).sort((a, b) => b.score - a.score).map((x) => x.s);
    }
    // Sparse vacancy fallback (the posting itself lacks usable requirements):
    // Retain top profile skills up to 6
    return scored.slice(0, 6).map((x) => x.s);
  };

  const rankedTools = filterAndRank(toolSkills, 'tool');
  const rankedDomain = filterAndRank(domainSkills, 'domain');

  const groups: Persona['skills'] = [];

  if (rankedTools.length > 0) {
    groups.push({
      name: isEn ? 'Technical Tools & Platforms' : 'Texniki alətlər və sistemlər',
      keywords: rankedTools,
      proficiency: '',
      level: 0,
    });
  }

  if (rankedDomain.length > 0) {
    groups.push({
      name: isEn ? 'Domain & Methodologies' : 'Sahəvi biliklər və metodologiyalar',
      keywords: rankedDomain,
      proficiency: '',
      level: 0,
    });
  }

  if (spokenSkills.length > 0) {
    groups.push({
      name: isEn ? 'Language Proficiency' : 'Dil bilikləri',
      keywords: spokenSkills,
      proficiency: '',
      level: 0,
    });
  }

  if (groups.length > 0) return groups;

  // When explicit requirements exist in the posting but none are supported by the candidate,
  // do not fill the tailored skills section with unrelated profile skills.
  if (hasUsableVacancyRequirements) {
    return [];
  }

  // Sparse posting fallback (only when the posting itself lacks usable requirements):
  const fallbackKeywords = filterAndRank(allSkills, 'domain');
  return fallbackKeywords.length > 0
    ? [{ name: '', keywords: fallbackKeywords, proficiency: '', level: 0 }]
    : [];
}


/**
 * The letter body as paragraphs. Frames are fixed text; everything else is the vacancy's or the candidate's own wording.
 *   1. which position at which company, then the candidate's own motivation (if they wrote one) verbatim;
 *   2. for each match: the requirement as the vacancy states it, and the candidate's own evidence for it;
 *   3. a fixed closing sentence.
 * With no match, the candidate's most recent role's first highlights stand in, so a sparse profile still gets an honest, short letter.
 */
export function composeLetterParagraphs(persona: Persona, job: TailorJobInput, motivation: string, matches: LetterMatch[]): string[] {
  const company = trimEnd(job.company || '');
  const position = trimEnd(job.position || '');
  const opening = company && position
    ? `${company} tərəfindən elan olunmuş ${position} vakansiyasına müraciət edirəm.`
    : position ? `${position} vakansiyasına müraciət edirəm.` : company ? `${company} şirkətinin vakansiyasına müraciət edirəm.` : '';
  const paragraphs: string[] = [];
  const first = [opening, motivation.trim()].filter(Boolean).join(' ');
  if (first) paragraphs.push(first);
  if (matches.length) {
    matches.forEach((m, i) => {
      const fact = firstPerson(m.evidence.text);
      // The evidence is the candidate's own; the requirement is attributed to the posting. A certificate is never called experience: a course is "keçdiyim təlim", any other document "sertifikatım".
      const noun = m.evidence.source === 'certification' ? (/kurs|təlim|training|course|bootcamp|akademiya|academy/i.test(m.evidence.text) ? 'keçdiyim təlim' : 'sertifikatım') : 'təcrübəm';
      paragraphs.push(i === 0 ? `Elandakı «${m.requirement}» tələbi ilə bağlı ${noun}: ${fact}.` : `Həmçinin «${m.requirement}» tələbi ilə bağlı ${noun}: ${fact}.`);
    });
  } else {
    // Nothing pairs convincingly with a requirement: the most relevant confirmed evidence stands alone (projects, certificates and activities count, not only jobs).
    const terms = vacancyTerms(job);
    const ranked = rankByRelevance(candidateEvidence(persona).filter((e) => !isNegatedStatement(e.text)), (e) => e.text, terms).slice(0, 2);
    const lines = ranked.map((e) => (e.source === 'certification' ? `${/kurs|təlim|training|course|bootcamp|akademiya|academy/i.test(e.text) ? 'keçdiyim təlim' : 'sertifikatım'}: ${e.text}` : firstPerson(e.text))).filter(Boolean);
    const recent = persona.experience[0];
    const fallback = lines.length ? lines : (recent?.highlights ?? []).slice(0, 2).map(firstPerson).filter(Boolean);
    if (fallback.length) paragraphs.push(`Təcrübəmdən nümunələr: ${fallback.join('; ')}.`);
  }
  paragraphs.push('Təcrübəmi və motivasiyamı görüşdə ətraflı izah etməyə hazıram.');
  return paragraphs;
}


/**
 * Notes for the candidate about THEIR OWN wording in what is about to be shown (nothing is changed): Turkish or English forms, and a present-tense bullet for a role that
 * has ended. The candidate decides; the meaning is never touched. Each note carries the word and a suggestion, never a rewritten sentence.
 */
export interface WordingNote { code: 'candidate_wording'; severity: 'warning'; section: string; detail: string }
export function candidateWordingNotes(pieces: { section: string; text: string; endedRole?: boolean }[]): WordingNote[] {
  const notes: WordingNote[] = [];
  const seen = new Set<string>();
  for (const { section, text, endedRole } of pieces) {
    const problems = [...languageProblems(text), ...(endedRole ? tenseProblems([text]) : [])];
    for (const p of problems) {
      const key = `${section}|${p.word.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notes.push({ code: 'candidate_wording', severity: 'warning', section, detail: `"${p.word}"${p.suggestion ? ` → ${p.suggestion}` : ''}: ${text.slice(0, 140)}` });
      if (notes.length >= 12) return notes;
    }
  }
  return notes;
}
