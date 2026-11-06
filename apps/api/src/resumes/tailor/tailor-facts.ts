import { LetterContent, LetterParagraph, Persona, TailorJobInput, TailoredContent } from './resume-tailor.types';
import { composeTargetRoleHeadline, groupAndRankSkills } from './az-compose';
import { looksWrongLanguage, metricProblem, metricsOf, nearDuplicate } from './metrics';
import { allowedVocabulary, languageFeedback, languageProblems, tenseProblems } from './az-language';
import { ANSWER_WORDS, claimsPastEmployment, LetterMode, personalClaim, SKILL_LIST_THRESHOLD, skillsInSentence, wordCount } from './letter-style';

/**
 * Fact reconciliation for tailored CVs.
 *
 * The candidate's saved profile (already corrected by them after CV
 * extraction) is the only source of facts. The model may reword the headline,
 * summary and experience bullets and reorder existing skills; it may not add
 * or change employers, positions, dates, education, skills, languages,
 * projects or numbers. Anything unsupported is removed from the draft and
 * listed as a review issue so the candidate sees exactly what was dropped.
 */

export type ReviewSeverity = 'error' | 'warning';

export interface ReviewIssue {
  code:
    | 'invented_experience'
    | 'changed_position'
    | 'changed_period'
    | 'missing_rewrite'
    | 'unsupported_number'
    | 'unsupported_term'
    | 'wrong_language_text'
    | 'invented_skill'
    | 'invented_education'
    | 'invented_language'
    | 'invented_project'
    | 'invented_certification'
    | 'invented_activity'
    | 'unsupported_project_text'
    | 'trimmed_highlights'
    | 'trimmed_paragraphs'
    | 'kept_approved_paragraph'
    | 'unsupported_personal_claim'
    | 'unsupported_employer_claim'
    | 'filler_phrase'
    | 'dropped_metric'
    | 'restored_metric'
    | 'misattributed_metric'
    | 'changed_metric_meaning'
    | 'skill_list'
    | 'candidate_wording'
    | 'left_out_entry'
    | 'reworded'
    | 'unused_evidence'
    | 'uncovered_requirement'
    | 'add_detail'
    | 'reason_missing'
    | 'writer_fallback'
    | 'answer_length'
    // An Azerbaijani document whose English text was translated (detail: "source → translation") or could not be translated reliably (detail: the English text).
    | 'translated'
    | 'not_translated'
    // Words in a machine translation that are not ordinary Azerbaijani: the candidate checks exactly these.
    | 'check_wording'
    // A letter fact that could not be translated reliably and was left out of the letter (named so the candidate can translate it in the profile).
    | 'evidence_not_translated';
  severity: ReviewSeverity;
  section: string;
  /** What was removed or kept instead — shown only to the owner, never logged. Language-neutral (quoted text and numbers); the app words the explanation. */
  detail: string;
  /** Why a note exists, when the code alone does not say (the app words it in the candidate's language). */
  reason?: 'NO_ROOM' | 'OTHER_LANGUAGE';
}

export class TailorOutputError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** An output rejected with feedback the next attempt can act on (see ResumeTailorService.runProvider); after the last attempt the generation fails and costs nothing. */
export class RejectedWithFeedback extends TailorOutputError {
  constructor(reason: string, readonly feedback: string, readonly kind: 'language' | 'relevance') {
    super(reason);
  }
}

export const MAX_HIGHLIGHTS_PER_ENTRY = 8;
const SUPPORTED_LANGUAGES = ['az', 'ru', 'en', 'tr'] as const;

const FOLD_MAP: Record<string, string> = { ə: 'e', ı: 'i', ğ: 'g', ş: 's', ö: 'o', ü: 'u', ç: 'c' };

/** Case/diacritic-insensitive form used for every comparison (İ → i, ə → e, ё → е). */
export function fold(s: unknown): string {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[əığşöüç]/g, (c) => FOLD_MAP[c] || c)
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}.+#'’-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]/gu;

function numbersIn(text: string): string[] {
  return (text.match(NUMBER_RE) || []).map((n) => n.replace(/[.,]/g, ''));
}

/**
 * Tokens that carry a checkable claim: acronyms (AWS), mixed case or
 * symbol-bearing names (PostgreSQL, Node.js, C#), and capitalised words that
 * do not start a sentence (Kubernetes, Siemens). A sentence-initial word is a
 * claim when it takes a hyphenated suffix ("Kubernetes-də" — verbs do not) or
 * is one of the job posting's own terms (`jobTerms`); otherwise ordinary
 * sentence openers ("Hazırladı", "Built") are prose.
 */
function claimTokens(sentence: string, jobTerms: Set<string> = new Set()): string[] {
  const out: string[] = [];
  let sentenceStart = true;
  for (const m of sentence.matchAll(WORD_RE)) {
    const w = m[0];
    const prefix = sentence.slice(Math.max(0, m.index! - 2), m.index!);
    if (/[.!?:;]\s*$/.test(prefix) || /^\s*[-–•]\s*$/.test(prefix)) sentenceStart = true;
    const letters = w.replace(/[^\p{L}]/gu, '');
    const isAcronym = letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
    const hasInnerCaps = /\p{Ll}\p{Lu}/u.test(w);
    const hasSymbols = /[.+#]/.test(w.slice(1, -1) + w.slice(-1)) && /\p{L}/u.test(w);
    const capitalised =
      /^\p{Lu}/u.test(w) && (!sentenceStart || /[-'’]\p{L}/u.test(w) || jobTerms.has(fold(w).split(/[-'’]/)[0]));
    if (isAcronym || hasInnerCaps || hasSymbols || capitalised) out.push(w.replace(/[.'’-]+$/, ''));
    sentenceStart = false;
  }
  return out;
}

export function splitSentences(text: string): string[] {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const AZ_LETTERS = new Set([...'abcçdeəfgğhxıijkqlmnoöprsştuüvyz']);

/** Lower-cased letters with diacritics kept; the dotted capital İ becomes plain i. */
function lowerLetters(text: string): Set<string> {
  return new Set([...text.normalize('NFC').toLowerCase().replace(/i\u0307/g, 'i')].filter((c) => /\p{L}/u.test(c)));
}

export class CandidateFacts {
  readonly corpus: string;
  /** The candidate's own sentences, folded (profile, stories and what they typed): the only support for a personal statement in a letter. */
  readonly sentences: string[];
  /** The target employer of a letter and the corpus WITHOUT the vacancy's own strings: the vacancy naming its employer proves nothing about the candidate. */
  targetCompany = '';
  ownCorpus = '';
  private readonly numbers: Set<string>;
  private readonly words: Set<string>;
  readonly skills: string[];

  private readonly jobTerms: Set<string>;

  /** `extra`: additional candidate-supplied text that counts as a fact (e.g. the motivation the candidate typed for a letter). */
  constructor(readonly persona: Persona, job?: TailorJobInput, extra: string[] = []) {
    const texts: string[] = [
      persona.basics.name,
      persona.basics.headline,
      persona.basics.location,
      persona.summary,
      ...persona.experience.flatMap((e) => [e.company, e.position, e.location, e.period, ...e.highlights]),
      ...persona.education.flatMap((e) => [e.school, e.degree, e.area, e.location, e.period, e.grade]),
      ...persona.skills.flatMap((s) => [s.name, ...s.keywords]),
      ...persona.projects.flatMap((p) => [p.name, p.period, p.description, p.result ?? '', p.organization ?? '']),
      ...persona.languages.flatMap((l) => [l.language, l.fluency]),
      ...persona.certifications.flatMap((c) => [c.title, c.issuer, c.date, c.description ?? '']),
      ...(persona.activities ?? []).flatMap((a) => [a.title, a.role, a.organization, a.period, a.description, a.result ?? '']),
      ...(persona.awards ?? []).flatMap((a) => [a.title, a.issuer, a.date]),
      ...(persona.stories ?? []).flatMap((s) => [s.title, s.situation, s.action, s.result]),
      ...extra,
    ];
    this.corpus = fold(texts.join(' \n '));
    this.ownCorpus = this.corpus;
    this.sentences = texts.flatMap((t) => splitSentences(t)).map(fold);
    this.factLetters = lowerLetters(texts.join(' '));
    this.numbers = new Set(numbersIn(texts.join(' ')));
    this.words = new Set((this.corpus.match(WORD_RE) || []).map((w) => w.replace(/[.'’-]+$/, '')));
    const jobText = job ? [job.position, job.description, job.requirements, job.responsibilities].join('\n') : '';
    this.jobTerms = new Set(claimTokens(jobText).map((t) => fold(t).split(/[-'’]/)[0]));
    const langLabels = (persona.languages ?? []).flatMap((l) => [
      l.language,
      l.fluency ? `${l.language} — ${l.fluency}` : l.language,
    ]).map((k) => String(k).trim()).filter(Boolean);
    this.skills = [...new Set([...persona.skills.flatMap((s) => s.keywords), ...langLabels].map((k) => String(k).trim()).filter(Boolean))];
  }

  /** The language the draft is written in; Azerbaijani drafts get an alphabet check. */
  language = 'en';
  private factLetters = new Set<string>();

  /**
   * Azerbaijani output sometimes drifts into other languages ("présentə"). A word
   * with a letter outside the Azerbaijani Latin alphabet is refused unless the
   * candidate's own data already uses that letter (a Russian employer name, say).
   * Letters are compared with their diacritics (fold() would hide the é).
   */
  private foreignWord(sentence: string): string | null {
    if (this.language !== 'az') return null;
    for (const m of sentence.matchAll(WORD_RE)) {
      const word = m[0];
      const bad = [...lowerLetters(word)].find((c) => !AZ_LETTERS.has(c) && !this.factLetters.has(c));
      if (bad) return word;
    }
    return null;
  }

  /** Why a generated sentence is not supported by the facts, or null if it is. */
  unsupported(sentence: string): { code: 'unsupported_number' | 'unsupported_term' | 'wrong_language_text'; token: string } | null {
    const foreign = this.foreignWord(sentence);
    if (foreign) return { code: 'wrong_language_text', token: foreign };
    for (const n of numbersIn(sentence)) {
      if (!this.numbers.has(n)) return { code: 'unsupported_number', token: n };
    }
    for (const token of claimTokens(sentence, this.jobTerms)) {
      if (!this.supportsWord(token)) return { code: 'unsupported_term', token };
    }
    return null;
  }

  /**
   * Whole-word support with room for inflection: the stem before a hyphen or
   * apostrophe is checked ("PostgreSQL-dən", "API-lər"), and a fact word may
   * differ by a suffix of up to three letters ("Bakıda", "APIs"). "Java" is
   * still not supported by "JavaScript".
   */
  /** Whether a name the candidate did not write is nevertheless among their facts (inflection tolerated). */
  supports(token: string): boolean {
    return this.supportsWord(token);
  }

  private supportsWord(token: string): boolean {
    const whole = fold(token).replace(/[.'’-]+$/, '');
    // A hyphenated name the candidate wrote ("Co-developing", "PR-AUC", "AI-OCR") is supported as written: judging only its first segment ("co", "pr")
    // flagged every such word, because a two-letter stem is never compared.
    if (whole && this.words.has(whole)) return true;
    const stem = fold(token).split(/[-'’]/)[0];
    if (!stem) return true;
    if (this.words.has(stem)) return true;
    for (const w of this.words) {
      const base = w.split(/[-'’]/)[0];
      if (base.length < 3 || stem.length < 3) continue;
      if ((base.startsWith(stem) || stem.startsWith(base)) && Math.abs(base.length - stem.length) <= 3) return true;
    }
    return false;
  }

  skill(name: unknown): string | undefined {
    const f = fold(name);
    return this.skills.find((s) => fold(s) === f);
  }
}

function asArray(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) return [v];
  return [];
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

const ORG_CUE = /^(şirkət|sirket|bank|universitet|təşkilat|teskilat|mmc|asc|qsc|inc|llc|ltd|corp|company|компани|банк|университет)/iu;
/** "Amazon şirkətində ...": a capitalised sentence-opening word followed by an organisation word. Returns the name, or null. */
function openingOrganisation(sentence: string): string | null {
  const m = sentence.match(/^(\p{Lu}[\p{L}\p{N}.&+-]{2,})\s+(\p{L}+)/u);
  return m && ORG_CUE.test(m[2]) ? m[1] : null;
}

/** Numbers that may appear in plain form in a role's bullets because they identify the role or a tool (dates, a "Python 3" skill), not because they measure something. */
function roleLoose(fact: Persona['experience'][number], facts: CandidateFacts): Set<string> {
  return new Set([fact.company, fact.position, fact.location, fact.period, ...facts.skills].flatMap(metricsOf).map((m) => m.n));
}

/** Filler scaffolding that adds no information (folded). A heuristic list: it flags wording for the candidate, it does not decide that a bullet is false. */
const FILLER: Record<string, RegExp> = {
  en: /(responsible for|accomplished|measured by|by demonstrating|leveraging|utili[sz]ing|duties included|various tasks)/,
  az: /(mesul (idi|olmusam|olub)|mesuliyyet(im)? (dasiyir|daxil)|muxtelif tapsiriq)/,
  ru: /(отвечал[аи]? за|ответственн\w+ за|различные задачи|в мои обязанности входил)/,
  tr: /(sorumluydum|sorumluluklarim|cesitli gorevler)/,
};

/** Style notes for generated prose in any document: a sentence that lists many of the candidate's tools, and filler scaffolding. Warnings only; the text is kept. */
function styleNotes(facts: CandidateFacts, sentence: string, section: string, issues: ReviewIssue[]) {
  const named = skillsInSentence(sentence, facts.skills, fold);
  if (named.length >= SKILL_LIST_THRESHOLD) issues.push({ code: 'skill_list', severity: 'warning', section, detail: sentence });
  const folded = fold(sentence);
  const filler = (FILLER[facts.language] ?? FILLER.en).exec(folded) ?? FILLER.en.exec(folded);
  if (filler) issues.push({ code: 'filler_phrase', severity: 'warning', section, detail: `"${filler[0]}": ${sentence}` });
}

/** Keeps only fact-supported sentences of a generated paragraph. `letter`: the extra rules for a motivation letter (personal statements, employer claims). */
function checkParagraph(facts: CandidateFacts, value: string, section: string, issues: ReviewIssue[], letter = false): string {
  const kept: string[] = [];
  for (const sentence of splitSentences(value)) {
    const problem = facts.unsupported(sentence);
    if (problem) {
      issues.push({ code: problem.code, severity: 'error', section, detail: `"${problem.token}": ${sentence}` });
      continue;
    }
    if (letter) {
      // A sentence that OPENS with an organisation the candidate never mentioned ("Amazon şirkətində ...") has no capital-letter tell-tale
      // for the generic check, which treats a sentence opener as prose. A name followed by an organisation word is a claim.
      const opener = openingOrganisation(sentence);
      if (opener && !facts.supports(opener)) {
        issues.push({ code: 'unsupported_term', severity: 'error', section, detail: `"${opener}": ${sentence}` });
        continue;
      }
      // The vacancy names its employer, so the generic check accepts that name. It proves nothing about the candidate: "worked at <employer>" needs their own facts.
      const prior = claimsPastEmployment(fold(sentence), facts.targetCompany, facts.ownCorpus, facts.language);
      if (prior) {
        issues.push({ code: 'unsupported_employer_claim', severity: 'error', section, detail: `"${prior}": ${sentence}` });
        continue;
      }
      // A feeling, taste or hardship is kept only when a sentence of the candidate's own says the same kind of thing about the same subject.
      const personal = personalClaim(fold(sentence), facts.sentences, facts.language);
      if (personal) {
        issues.push({ code: 'unsupported_personal_claim', severity: 'error', section, detail: `"${personal}": ${sentence}` });
        continue;
      }
    }
    styleNotes(facts, sentence, section, issues);
    kept.push(sentence);
  }
  return kept.join(' ');
}

export function labelsFor(language: string | undefined) {
  switch (language) {
    case 'az':
      return { summary: 'Xülasə', education: 'Təhsil', experience: 'İş təcrübəsi', projects: 'Layihələr', skills: 'Bacarıqlar', languages: 'Dillər', certifications: 'Sertifikatlar', activities: 'Könüllülük və fəaliyyətlər', awards: 'Təltiflər' };
    case 'ru':
      return { summary: 'Резюме', education: 'Образование', experience: 'Опыт работы', projects: 'Проекты', skills: 'Навыки', languages: 'Языки', certifications: 'Сертификаты', activities: 'Волонтёрство и активности', awards: 'Награды' };
    case 'tr':
      return { summary: 'Özet', education: 'Eğitim', experience: 'İş Deneyimi', projects: 'Projeler', skills: 'Yetenekler', languages: 'Diller', certifications: 'Sertifikalar', activities: 'Gönüllülük ve Etkinlikler', awards: 'Ödüller' };
    default:
      return { summary: 'Summary', education: 'Education', experience: 'Experience', projects: 'Projects', skills: 'Skills', languages: 'Languages', certifications: 'Certifications', activities: 'Volunteering & Activities', awards: 'Awards' };
  }
}

/**
 * Builds the draft from facts plus fact-checked model wording. Throws
 * TailorOutputError when the model output carries nothing usable, so the
 * caller can retry within its budget instead of storing an empty "success".
 */
export function reconcileWithFacts(
  persona: Persona,
  model: unknown,
  job?: TailorJobInput,
  opts: { maxHighlights?: number; language?: string } = {},
): { content: TailoredContent; issues: ReviewIssue[] } {
  const maxHighlights = opts.maxHighlights ?? MAX_HIGHLIGHTS_PER_ENTRY;
  if (!model || typeof model !== 'object' || Array.isArray(model)) throw new TailorOutputError('output is not an object');
  const m = model as Record<string, unknown>;
  const facts = new CandidateFacts(persona, job);
  const issues: ReviewIssue[] = [];
  // A language the candidate asked for wins over the model's own detection.
  const requested = SUPPORTED_LANGUAGES.includes(opts.language as any) ? opts.language : undefined;
  const language = requested ?? (SUPPORTED_LANGUAGES.includes(m.language as any) ? (m.language as string) : 'en');
  facts.language = language;

  // Headline / summary: fact-checked wording, else the saved profile's own.
  let headline = persona.basics.headline;
  let acceptedHeadline = false;
  const modelHeadline = text(m.headline);
  if (modelHeadline) {
    const problem = facts.unsupported(modelHeadline);
    const isKnownTargetHeadline = !!job && modelHeadline === composeTargetRoleHeadline(persona, job, undefined, language);
    if (problem && !isKnownTargetHeadline) issues.push({ code: problem.code, severity: 'error', section: 'headline', detail: `"${problem.token}": ${modelHeadline}` });
    else {
      headline = modelHeadline;
      acceptedHeadline = true;
    }
  }
  const modelSummary = text(m.summary);
  const acceptedSummary = modelSummary ? checkParagraph(facts, modelSummary, 'summary', issues) : '';
  // The saved summary is used only when it is in the document's language (the auto-generated English line is not offered in an Azerbaijani CV).
  const summary = acceptedSummary || (language === 'en' || !/ based in /.test(persona.summary) ? persona.summary : '');

  // Experience: fact entries in fact order; the model only supplies bullets.
  const modelExperience = asArray(m.experience).filter((e) => e && typeof e === 'object');
  const used = new Set<number>();
  let rewrittenBullets = 0;
  const experience = persona.experience.map((fact, factIndex) => {
    const section = `experience:${fact.company}`;
    let at = -1;

    // 1. Try matching by entryId or id if available
    const factEntryId = (fact as any).entryId || (fact as any).id;
    if (factEntryId) {
      at = modelExperience.findIndex((e, i) => !used.has(i) && (e.entryId === factEntryId || e.id === factEntryId));
    }

    // 2. Try matching by generated roleId or sourceIndex if fact doesn't have an explicit entryId
    if (at < 0) {
      const generatedRoleId = `exp_${factIndex}`;
      at = modelExperience.findIndex(
        (e, i) => !used.has(i) && (e.entryId === generatedRoleId || (e as any).sourceIndex === factIndex),
      );
    }

    // 3. Exact company + position + period (when fact states period, require exact period match)
    if (at < 0 && fact.period) {
      at = modelExperience.findIndex(
        (e, i) =>
          !used.has(i) &&
          fold(e.company) === fold(fact.company) &&
          fold(e.position) === fold(fact.position) &&
          e.period && fold(e.period) === fold(fact.period),
      );
    }

    // 4. Exact company + position
    if (at < 0) {
      at = modelExperience.findIndex(
        (e, i) =>
          !used.has(i) &&
          fold(e.company) === fold(fact.company) &&
          fold(e.position) === fold(fact.position),
      );
    }

    // 4. Exact company + period
    if (at < 0 && fact.period) {
      at = modelExperience.findIndex(
        (e, i) =>
          !used.has(i) &&
          fold(e.company) === fold(fact.company) &&
          fold(e.period) === fold(fact.period),
      );
    }

    // 5. Company fallback ONLY when candidate has a single role at that employer (prevents confusing multiple roles)
    const rolesAtCompany = persona.experience.filter((x) => fold(x.company) === fold(fact.company)).length;
    if (at < 0 && rolesAtCompany === 1) {
      at = modelExperience.findIndex((e, i) => !used.has(i) && fold(e.company) === fold(fact.company));
      if (at >= 0) {
        issues.push({
          code: 'changed_position',
          severity: 'warning',
          section,
          detail: `${text(modelExperience[at].position)} → ${fact.position}`,
        });
      }
    }

    // 6. Stable index fallback if array lengths match and company matches at that index
    if (at < 0 && modelExperience.length === persona.experience.length && !used.has(factIndex)) {
      if (fold(modelExperience[factIndex].company) === fold(fact.company)) {
        at = factIndex;
        issues.push({
          code: 'changed_position',
          severity: 'warning',
          section,
          detail: `${text(modelExperience[at].position)} → ${fact.position}`,
        });
      }
    }

    if (at < 0) {
      issues.push({ code: 'missing_rewrite', severity: 'warning', section, detail: 'saved description kept' });
      return { ...fact, highlights: [...fact.highlights] };
    }
    used.add(at);
    const entry = modelExperience[at];
    if (text(entry.period) && fold(entry.period) !== fold(fact.period)) {
      issues.push({ code: 'changed_period', severity: 'warning', section, detail: `${text(entry.period)} → ${fact.period}` });
    }
    const bullets: string[] = [];
    for (const raw of asArray(entry.highlights)) {
      const bullet = text(raw);
      if (!bullet) continue;
      const problem = facts.unsupported(bullet);
      // Numbers must also belong to THIS role and keep their meaning (the generic check accepts a number found anywhere in the candidate's facts).
      const metric = problem ? null : metricProblem(bullet, fact.highlights, roleLoose(fact, facts));
      if (problem) issues.push({ code: problem.code, severity: 'error', section, detail: `"${problem.token}": ${bullet}` });
      else if (metric) issues.push({ code: metric.code, severity: 'error', section, detail: `"${metric.n}": ${bullet}` });
      else if (!bullets.some((b) => fold(b) === fold(bullet))) {
        bullets.push(bullet);
        styleNotes(facts, bullet, section, issues);
      }
    }
    const entryMax = Number((entry as any).maxHighlights) > 0 ? Number((entry as any).maxHighlights) : maxHighlights;
    if (bullets.length > entryMax) {
      issues.push({ code: 'trimmed_highlights', severity: 'warning', section, detail: `${bullets.length - entryMax} generated bullet(s) not used` });
    }
    const kept = bullets.slice(0, entryMax);
    // Metrics the candidate supplied are kept, with their meaning. A number from the saved description that no bullet of THIS role carries is brought
    // back by using the saved line itself (the candidate's own text): in place of the bullet that says nearly the same thing, else added while there
    // is room. Never when the saved line is in another language than the document (it is reported instead), never as a duplicate. Never required, never invented.
    if (kept.length) {
      const carries = (m: { n: string; kind: string }) => kept.flatMap(metricsOf).some((c) => c.n === m.n && c.kind === m.kind);
      for (const source of fact.highlights) {
        const missing = metricsOf(source).filter((m) => !carries(m));
        if (!missing.length || kept.some((k) => fold(k) === fold(source))) continue;
        if (looksWrongLanguage(source, language)) continue; // reported below
        const same = nearDuplicate(kept, source, fold);
        if (same >= 0) {
          issues.push({ code: 'restored_metric', severity: 'warning', section, detail: `${missing.map((m) => m.n).join(', ')} · "${kept[same]}" → ${source}` });
          kept[same] = source;
        } else if (kept.length < entryMax) {
          kept.push(source);
          issues.push({ code: 'restored_metric', severity: 'warning', section, detail: `${missing.map((m) => m.n).join(', ')} · ${source}` });
        }
      }
      for (const source of fact.highlights) {
        const missing = metricsOf(source).filter((m) => !carries(m));
        if (!missing.length) continue;
        issues.push({ code: 'dropped_metric', severity: 'warning', section, reason: looksWrongLanguage(source, language) ? 'OTHER_LANGUAGE' : 'NO_ROOM', detail: `${missing.map((m) => m.n).join(', ')} · ${source}` });
      }
    }
    rewrittenBullets += kept.length;
    if (!kept.length) {
      issues.push({ code: 'missing_rewrite', severity: 'warning', section, detail: 'saved description kept' });
      return { ...fact, highlights: [...fact.highlights] };
    }
    return { ...fact, highlights: kept };
  });
  modelExperience.forEach((e, i) => {
    if (!used.has(i)) {
      issues.push({ code: 'invented_experience', severity: 'error', section: 'experience', detail: `${text(e.position)} — ${text(e.company)} ${text(e.period)}`.trim() });
    }
  });

  // Education: facts only; anything else the model listed is reported.
  for (const e of asArray(m.education)) {
    if (!e || typeof e !== 'object') continue;
    const known = persona.education.some((f) => fold(f.school) === fold(e.school) && (!text(e.degree) || fold(f.degree) === fold(e.degree)));
    if (!known) issues.push({ code: 'invented_education', severity: 'error', section: 'education', detail: `${text(e.degree)} — ${text(e.school)}`.trim() });
  }

  // Skills: the model may select, reorder or group saved skills; it cannot add any.
  // Intentional omissions are preserved (unselected skills are NOT dumped back into the document).
  const isGenericSectionName = (name: string) => {
    const n = fold(name);
    return !n || n === 'bacariqlar' || n === 'skills' || n === 'naviki' || n === 'yetenekler';
  };
  const rawGroups = asArray(m.skills);
  const hasNamedGroups = rawGroups.some((g) => g && typeof g === 'object' && !isGenericSectionName(text((g as any).name)));
  let skills: { name: string; keywords: string[]; proficiency: string; level: number }[] = [];

  if (hasNamedGroups) {
    const seenSkills = new Set<string>();
    for (const group of rawGroups) {
      if (!group || typeof group !== 'object') continue;
      const gName = isGenericSectionName(text((group as any).name)) ? '' : text((group as any).name);
      const kws: string[] = [];

      for (const k of asArray((group as any).keywords)) {
        const known = facts.skill(k);
        if (known) {
          if (!seenSkills.has(known)) {
            seenSkills.add(known);
            kws.push(known);
          }
        } else if (text(k)) {
          issues.push({ code: 'invented_skill', severity: 'error', section: 'skills', detail: text(k) });
        }
      }
      if (kws.length > 0) {
        skills.push({ name: gName, keywords: kws, proficiency: '', level: 0 });
      }
    }
    // Only if the model provided no valid skills at all, fall back to vacancy-tailored skills (not raw profile skills)
    if (skills.length === 0) {
      skills = job ? groupAndRankSkills(persona, job, undefined, opts.language || 'az') : (facts.skills.length ? [{ name: '', keywords: [...facts.skills], proficiency: '', level: 0 }] : []);
    }
  } else if (rawGroups.length > 0) {
    const ordered: string[] = [];
    for (const group of rawGroups) {
      const keywords = group && typeof group === 'object' ? asArray((group as any).keywords) : [group];
      for (const k of keywords) {
        const known = facts.skill(k);
        if (known) {
          if (!ordered.includes(known)) ordered.push(known);
        } else if (text(k)) {
          issues.push({ code: 'invented_skill', severity: 'error', section: 'skills', detail: text(k) });
        }
      }
    }
    if (ordered.length === 0) {
      skills = job ? groupAndRankSkills(persona, job, undefined, opts.language || 'az') : (facts.skills.length ? [{ name: '', keywords: [...facts.skills], proficiency: '', level: 0 }] : []);
    } else {
      skills = [{ name: '', keywords: ordered, proficiency: '', level: 0 }];
    }
  } else {
    skills = job ? groupAndRankSkills(persona, job, undefined, opts.language || 'az') : (facts.skills.length ? [{ name: '', keywords: [...facts.skills], proficiency: '', level: 0 }] : []);
  }

  // Career evidence selection and reconciliation:
  // Preserves validated requested ordering and intentional omissions while retaining complete base-profile facts.
  const byName = <T extends Record<string, any>>(list: T[], key: string, name: string) => list.find((x) => fold(x[key]) === fold(name));

  for (const l of asArray(m.languages)) {
    const name = l && typeof l === 'object' ? text(l.language) : text(l);
    if (name && !byName(persona.languages, 'language', name) && !facts.corpus.includes(fold(name))) {
      issues.push({ code: 'invented_language', severity: 'error', section: 'languages', detail: name });
    }
  }

  let projects: typeof persona.projects;
  if (Array.isArray(m.projects)) {
    const modelProjects = m.projects.filter((p) => p && typeof p === 'object') as Record<string, any>[];
    const usedProjectIndices = new Set<number>();
    const reconciledProjects: typeof persona.projects = [];

    for (const p of modelProjects) {
      const pEntryId = text(p.entryId || p.id);
      const pName = text(p.name || p.title);
      let factIdx = -1;
      if (pEntryId) {
        factIdx = persona.projects.findIndex((f, i) => !usedProjectIndices.has(i) && (f.entryId === pEntryId || (f as any).id === pEntryId));
      }
      if (factIdx < 0 && pName) {
        factIdx = persona.projects.findIndex((f, i) => !usedProjectIndices.has(i) && fold(f.name) === fold(pName));
      }
      if (factIdx < 0) {
        if (pName) issues.push({ code: 'invented_project', severity: 'error', section: 'projects', detail: pName });
        continue;
      }
      usedProjectIndices.add(factIdx);
      const fact = persona.projects[factIdx];
      const wording = text(p.description);
      if (!wording) {
        reconciledProjects.push({ ...fact });
        continue;
      }
      const kept = checkParagraph(facts, wording, `projects:${fact.name}`, issues);
      const projectMetric = kept ? metricProblem(kept, [fact.description, fact.result ?? '', fact.period], new Set(facts.skills.flatMap(metricsOf).map((m) => m.n))) : null;
      if (projectMetric) {
        issues.push({ code: projectMetric.code, severity: 'error', section: `projects:${fact.name}`, detail: `"${projectMetric.n}": ${kept}` });
        reconciledProjects.push({ ...fact });
      } else if (kept && kept === wording) {
        reconciledProjects.push({ ...fact, description: kept });
      } else {
        reconciledProjects.push({ ...fact });
      }
    }
    projects = reconciledProjects;
  } else {
    projects = persona.projects.map((fact) => ({ ...fact }));
  }

  let certifications: typeof persona.certifications;
  if (Array.isArray(m.certifications)) {
    const modelCerts = m.certifications.filter((c) => c && typeof c === 'object') as Record<string, any>[];
    const usedCertIndices = new Set<number>();
    const reconciledCerts: typeof persona.certifications = [];

    for (const c of modelCerts) {
      const cEntryId = text(c.entryId || c.id);
      const cTitle = text(c.title || c.name);
      let factIdx = -1;
      if (cEntryId) {
        factIdx = persona.certifications.findIndex((f, i) => !usedCertIndices.has(i) && (f.entryId === cEntryId || (f as any).id === cEntryId));
      }
      if (factIdx < 0 && cTitle) {
        factIdx = persona.certifications.findIndex((f, i) => !usedCertIndices.has(i) && fold(f.title) === fold(cTitle));
      }
      if (factIdx < 0) {
        if (cTitle) issues.push({ code: 'invented_certification', severity: 'error', section: 'certifications', detail: cTitle });
        continue;
      }
      usedCertIndices.add(factIdx);
      reconciledCerts.push({ ...persona.certifications[factIdx] });
    }
    certifications = reconciledCerts;
  } else {
    certifications = persona.certifications.map((c) => ({ ...c }));
  }

  let activities: typeof persona.activities;
  if (Array.isArray(m.activities)) {
    const modelActs = m.activities.filter((a) => a && typeof a === 'object') as Record<string, any>[];
    const usedActIndices = new Set<number>();
    const reconciledActs: NonNullable<typeof persona.activities> = [];
    const baseActs = persona.activities ?? [];

    for (const a of modelActs) {
      const aEntryId = text(a.entryId || a.id);
      const aTitle = text(a.title || a.name);
      let factIdx = -1;
      if (aEntryId) {
        factIdx = baseActs.findIndex((f, i) => !usedActIndices.has(i) && (f.entryId === aEntryId || (f as any).id === aEntryId));
      }
      if (factIdx < 0 && aTitle) {
        factIdx = baseActs.findIndex((f, i) => !usedActIndices.has(i) && fold(f.title) === fold(aTitle));
      }
      if (factIdx < 0) {
        if (aTitle) issues.push({ code: 'invented_activity', severity: 'error', section: 'activities', detail: aTitle });
        continue;
      }
      usedActIndices.add(factIdx);
      reconciledActs.push({ ...baseActs[factIdx] });
    }
    activities = reconciledActs;
  } else {
    activities = (persona.activities ?? []).map((a) => ({ ...a }));
  }

  let awards: typeof persona.awards;
  if (Array.isArray(m.awards)) {
    const modelAwards = m.awards.filter((a) => a && typeof a === 'object') as Record<string, any>[];
    const usedAwardIndices = new Set<number>();
    const reconciledAwards: NonNullable<typeof persona.awards> = [];
    const baseAwards = persona.awards ?? [];

    for (const a of modelAwards) {
      const aEntryId = text(a.entryId || a.id);
      const aTitle = text(a.title || a.name);
      let factIdx = -1;
      if (aEntryId) {
        factIdx = baseAwards.findIndex((f, i) => !usedAwardIndices.has(i) && (f.entryId === aEntryId || (f as any).id === aEntryId));
      }
      if (factIdx < 0 && aTitle) {
        factIdx = baseAwards.findIndex((f, i) => !usedAwardIndices.has(i) && fold(f.title) === fold(aTitle));
      }
      if (factIdx < 0) {
        if (aTitle) issues.push({ code: 'invented_activity', severity: 'error', section: 'awards', detail: aTitle });
        continue;
      }
      usedAwardIndices.add(factIdx);
      reconciledAwards.push({ ...baseAwards[factIdx] });
    }
    awards = reconciledAwards;
  } else {
    awards = (persona.awards ?? []).map((a) => ({ ...a }));
  }

  // Nothing the model wrote survived fact-checking: this is not a tailored draft.
  if (!rewrittenBullets && !acceptedSummary && !acceptedHeadline) {
    throw new TailorOutputError('output contains no usable headline, summary or bullets');
  }

  // Azerbaijani drafts must read as Azerbaijani: Turkish forms and English function words are refused and the attempt is repeated with feedback.
  if (language === 'az') {
    const written = [acceptedHeadline ? headline : '', acceptedSummary, ...experience.flatMap((e) => e.highlights), ...projects.map((p) => p.description)].join('\n');
    const allowedWords = allowedVocabulary(facts.corpus, jobText(job));
    const problems = languageProblems(written, allowedWords);
    // A role the candidate has left reads in the past tense; the model's bullets for it must too.
    for (const e of experience) if (!/present|hazırda|настоящее|günümüz/i.test(e.period)) problems.push(...tenseProblems(e.highlights, allowedWords));
    if (problems.length) throw new RejectedWithFeedback(`language: ${problems.map((p) => p.word).join(', ')}`, languageFeedback(problems), 'language');
  }

  return {
    content: {
      basics: { ...persona.basics, headline },
      summary,
      experience,
      education: persona.education.map((e) => ({ ...e })),
      skills,
      languages: persona.languages.map((l) => ({ ...l })),
      projects,
      certifications,
      activities,
      awards,
      language,
    },
    issues,
  };
}

/**
 * Applies a candidate's review edits. Identity facts (name, contact,
 * employers, positions, dates, education) always come from the saved
 * profile; the candidate edits wording and may reorder or remove saved
 * skills. A skill that is not in the saved profile is refused — the profile
 * is where facts are corrected.
 */
export function applyReviewEdits(
  persona: Persona,
  current: TailoredContent,
  edits: { headline?: unknown; summary?: unknown; experience?: unknown; skills?: unknown; projects?: unknown; activities?: unknown; awards?: unknown; certifications?: unknown; languages?: unknown },
): TailoredContent {
  const facts = new CandidateFacts(persona);
  const limit = (v: unknown, max: number, field: string) => {
    const s = text(v);
    if (s.length > max) throw new TailorOutputError(`${field} is too long`);
    return s;
  };
  const next: TailoredContent = JSON.parse(JSON.stringify(current));
  next.basics = { ...persona.basics, headline: edits.headline !== undefined ? limit(edits.headline, 300, 'headline') : next.basics.headline };
  const translatedDisplay = (path: string, original: string, displayed: string): string => {
    const pair = current.translationSources?.[path];
    if (!pair || !pair.source || !pair.text || pair.source === pair.text || !original.includes(pair.source)) return original;
    return displayed === original.replace(pair.source, pair.text) ? displayed : original;
  };
  const sourceLabelForMatch = (path: string, displayed: string): string => {
    const pair = current.translationSources?.[path];
    return pair?.source && pair.text && pair.source !== pair.text && displayed.includes(pair.text)
      ? displayed.replace(pair.text, pair.source)
      : displayed;
  };
  next.basics.location = translatedDisplay('basics.location', persona.basics.location, current.basics.location);
  if (edits.summary !== undefined) next.summary = limit(edits.summary, 3000, 'summary');
  const requestedExperience = edits.experience !== undefined ? asArray(edits.experience) : undefined;
  if (requestedExperience && requestedExperience.length !== current.experience.length) {
    throw new TailorOutputError('experience entries must match the current document');
  }
  const seenRoles = new Set<number>();
  next.experience = current.experience.map((shown, index) => {
    let candidates = persona.experience.map((fact, sourceIndex) => ({ fact, sourceIndex }))
      .filter(({ sourceIndex }) => !seenRoles.has(sourceIndex));
    if (shown.entryId) {
      candidates = candidates.filter(({ fact }) => fact.entryId === shown.entryId);
    } else {
      // Legacy documents predate stable role IDs. A unique identity match is required;
      // never align a selected/reordered subset to the full profile by array position.
      const sourceCompany = sourceLabelForMatch(`experience.${index}.company`, shown.company);
      const sourcePosition = sourceLabelForMatch(`experience.${index}.position`, shown.position);
      const samePeriod = candidates.filter(({ fact }) => fold(fact.company) === fold(sourceCompany) && fold(fact.period) === fold(shown.period));
      const exact = samePeriod.filter(({ fact }) => fold(fact.position) === fold(sourcePosition));
      candidates = exact.length ? exact : samePeriod;
    }
    if (candidates.length !== 1) throw new TailorOutputError('experience entries must match the saved profile; review the changed role');
    const { fact, sourceIndex } = candidates[0];
    seenRoles.add(sourceIndex);
    const highlights = requestedExperience
      ? asArray(requestedExperience[index]?.highlights).map((h) => limit(h, 1500, 'highlight')).filter(Boolean)
      : [...shown.highlights];
    if (highlights.length > 20) throw new TailorOutputError('too many highlights');
    return {
      ...fact,
      company: translatedDisplay(`experience.${index}.company`, fact.company, shown.company),
      position: translatedDisplay(`experience.${index}.position`, fact.position, shown.position),
      location: translatedDisplay(`experience.${index}.location`, fact.location, shown.location),
      highlights,
    };
  });
  next.education = persona.education.map((e) => ({ ...e }));
  if (edits.skills !== undefined) {
    const rawSkills = asArray(edits.skills);
    const isGrouped = rawSkills.some((g) => g && typeof g === 'object' && Array.isArray((g as any).keywords));
    if (isGrouped) {
      next.skills = rawSkills.map((g: any) => {
        const gName = text(g.name);
        const keywords = asArray(g.keywords).map((k) => {
          const alias = Object.entries(current.translationSources ?? {}).find(([path, pair]) => path.startsWith('skills.') && pair.text === text(k) && facts.skill(pair.source));
          const known = facts.skill(k) ?? (alias ? facts.skill(alias[1].source) : undefined);
          if (!known) throw new TailorOutputError(`skill not in saved profile: ${text(k).slice(0, 60)}`);
          return alias ? alias[1].text : known;
        });
        return { name: gName, keywords: [...new Set(keywords)], proficiency: '', level: 0 };
      }).filter((g) => g.keywords.length > 0);
    } else {
      const keywords = rawSkills.map((k) => {
        const alias = Object.entries(current.translationSources ?? {}).find(([path, pair]) => path.startsWith('skills.') && pair.text === text(k) && facts.skill(pair.source));
        const known = facts.skill(k) ?? (alias ? facts.skill(alias[1].source) : undefined);
        if (!known) throw new TailorOutputError(`skill not in saved profile: ${text(k).slice(0, 60)}`);
        return alias ? alias[1].text : known;
      });
      next.skills = keywords.length ? [{ name: '', keywords: [...new Set(keywords)], proficiency: '', level: 0 }] : [];
    }
  }


  // Career sections: a list of { entryId, description? } chooses which CONFIRMED entries appear and in what order (leaving one out removes it
  // from this document). An entry that is not one of the candidate's confirmed entries is refused: facts are added in the profile, not here.
  const pickEntries = <T extends { entryId?: string }>(requested: unknown, pool: T[], field: string, reword?: (item: T, wording: string) => T): T[] => {
    const list = asArray(requested);
    if (list.length > 60) throw new TailorOutputError(`too many ${field}`);
    const seen = new Set<string>();
    return list.map((raw) => {
      const id = text(raw && typeof raw === 'object' ? raw.entryId : raw);
      const item = pool.find((p) => p.entryId === id);
      if (!item) throw new TailorOutputError(`${field}: entry not among your confirmed entries`);
      if (seen.has(id)) throw new TailorOutputError(`${field}: entry listed twice`);
      seen.add(id);
      const chosen = raw && typeof raw === 'object' && raw.description !== undefined && reword ? reword(item, limit(raw.description, 1500, `${field} description`)) : { ...item };
      if (reword && raw && typeof raw === 'object' && raw.result !== undefined) return { ...chosen, result: limit(raw.result, 1500, `${field} result`) };
      return chosen;
    });
  };
  const currentSection = <T extends { entryId?: string }>(list: T[] | undefined, pool: T[]): T[] =>
    (list ?? []).map((c) => ({ ...(pool.find((p) => p.entryId === c.entryId) ?? c), ...c }));
  next.projects = edits.projects !== undefined
    ? pickEntries(edits.projects, persona.projects, 'projects', (item, wording) => ({ ...item, description: wording }))
    : currentSection(next.projects, persona.projects);
  next.activities = edits.activities !== undefined
    ? pickEntries(edits.activities, persona.activities ?? [], 'activities', (item, wording) => ({ ...item, description: wording }))
    : currentSection(next.activities, persona.activities ?? []);
  next.awards = edits.awards !== undefined ? pickEntries(edits.awards, persona.awards ?? [], 'awards') : currentSection(next.awards, persona.awards ?? []);
  next.certifications = edits.certifications !== undefined ? pickEntries(edits.certifications, persona.certifications, 'certifications') : currentSection(next.certifications, persona.certifications);
  next.languages = edits.languages !== undefined ? pickEntries(edits.languages, persona.languages, 'languages') : currentSection(next.languages, persona.languages);
  // Preserve accepted translations of identity labels, never arbitrary edited roles or skills.
  for (const [path, pair] of Object.entries(current.translationSources ?? {})) {
    if (!/^(?:basics\.location|experience\.\d+\.(?:position|location)|education\.\d+\.(?:degree|area|location)|skills\.\d+\.(?:name|proficiency|keywords\.\d+)|languages\.\d+\.(?:language|fluency)|activities\.\d+\.role)$/.test(path)) continue;
    const bits = path.split('.');
    let node: any = next;
    for (const bit of bits.slice(0, -1)) node = node?.[bit];
    const key = bits[bits.length - 1];
    if (node && node[key] === pair.source) node[key] = pair.text;
  }
  return next;
}


// ── Motivation letters ───────────────────────────────────────────

export const MAX_LETTER_PARAGRAPHS = 5;
export const MIN_LETTER_PARAGRAPHS = 2;

const LETTER_PHRASES: Record<string, { salutation: string; closing: string }> = {
  az: { salutation: 'Hörmətli işə qəbul komandası,', closing: 'Hörmətlə,' },
  en: { salutation: 'Dear Hiring Team,', closing: 'Sincerely,' },
  ru: { salutation: 'Уважаемая команда по подбору персонала,', closing: 'С уважением,' },
  tr: { salutation: 'Sayın İşe Alım Ekibi,', closing: 'Saygılarımla,' },
};

function jobText(job?: TailorJobInput): string {
  return job ? [job.position, job.company, job.location, job.description, job.requirements, job.responsibilities].join('\n') : '';
}

/** Whether a letter names the position (a distinctive word of its title) or the employer: a letter that fits any vacancy is not accepted. */
export function refersToVacancy(letterText: string, job: TailorJobInput): boolean {
  const body = fold(letterText);
  const stems = (value: string) => fold(value).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 5).map((w) => w.slice(0, 5));
  const wanted = [...stems(job.position || ''), ...stems((job.company || '').replace(/["“”«»]/g, ''))];
  if (!wanted.length) return true;
  return wanted.some((stem) => body.includes(stem));
}

/** The facts a letter may rely on: the candidate's persona (with stories), what they typed as motivation, and the recipient's own name/title/location. */
export function letterFacts(persona: Persona, job: TailorJobInput, motivation: string, language: string): CandidateFacts {
  const facts = new CandidateFacts(persona, job, [motivation, job.company, job.position, job.location]);
  facts.language = language;
  // What is the candidate's own: no vacancy strings. Their sentences are the only support for a personal statement, and the employer being applied to
  // counts as the candidate's past employer only when their own facts say so.
  const own = new CandidateFacts(persona, undefined, [motivation]);
  facts.targetCompany = fold(job.company);
  facts.ownCorpus = own.corpus;
  (facts as { sentences: string[] }).sentences = own.sentences;
  return facts;
}

export function supportedLanguage(language: unknown): string | undefined {
  return SUPPORTED_LANGUAGES.includes(language as any) ? (language as string) : undefined;
}

/**
 * Builds the letter from fact-checked model paragraphs. Salutation, closing, signature and recipient are fixed (never model text). Paragraphs the
 * candidate already approved (marked in `previous`, the letter being regenerated) stay word for word at their position; generated paragraphs fill the remaining slots in order. Throws
 * TailorOutputError when fewer than two usable paragraphs result, so the caller retries instead of storing an empty "success".
 */
export function reconcileLetter(
  persona: Persona,
  model: unknown,
  job: TailorJobInput,
  opts: { language: string; motivation?: string; previous?: LetterParagraph[]; today?: Date; mode?: LetterMode; maxWords?: number; requireVacancyReference?: boolean; composed?: boolean },
): { content: LetterContent; issues: ReviewIssue[] } {
  if (!model || typeof model !== 'object' || Array.isArray(model)) throw new TailorOutputError('output is not an object');
  const m = model as Record<string, unknown>;
  const language = supportedLanguage(opts.language) ?? 'en';
  const facts = letterFacts(persona, job, opts.motivation ?? '', language);
  const issues: ReviewIssue[] = [];

  const generated: string[] = [];
  for (const raw of asArray(m.paragraphs)) {
    const value = text(raw && typeof raw === 'object' ? (raw as any).text : raw);
    if (!value) continue;
    if (value.length > 1500) {
      issues.push({ code: 'trimmed_paragraphs', severity: 'warning', section: 'letter', detail: 'a paragraph over 1500 characters was not used' });
      continue;
    }
    // A composed (Azerbaijani) letter is made of the candidate's and the vacancy's own wording plus fixed frames: there is no model prose to fact-check.
    const kept = opts.composed ? value : checkParagraph(facts, value, `paragraph:${generated.length + 1}`, issues, true);
    if (kept && !generated.some((g) => fold(g) === fold(kept))) generated.push(kept);
  }

  // Generated paragraphs (never the candidate's approved ones) must be in the letter's language and about THIS vacancy.
  if (opts.mode !== 'answer' && !opts.composed && generated.length) {
    const written = generated.join('\n');
    if (language === 'az') {
      const problems = languageProblems(written, allowedVocabulary(facts.corpus, jobText(job)));
      if (problems.length) throw new RejectedWithFeedback(`language: ${problems.map((p) => p.word).join(', ')}`, languageFeedback(problems), 'language');
    }
    if (opts.requireVacancyReference && !refersToVacancy(written, job)) {
      throw new RejectedWithFeedback(
        'letter does not refer to the vacancy',
        `The letter must name the position "${job.position}"${job.company ? ` and the company "${job.company}"` : ''} and connect at least one requirement of the vacancy to one of the candidate's confirmed facts. Write the paragraphs again; Reply with the JSON object only.`,
        'relevance',
      );
    }
  }

  const keep = (opts.previous ?? []).filter((p) => p.approved);
  const slots = opts.previous ?? [];
  const paragraphs: LetterParagraph[] = [];
  let next = 0;
  for (const slot of slots) {
    if (slot.approved) {
      paragraphs.push({ id: slot.id, text: slot.text, approved: true });
      issues.push({ code: 'kept_approved_paragraph', severity: 'warning', section: slot.id, detail: 'approved paragraph kept unchanged' });
    } else if (next < generated.length) {
      paragraphs.push({ id: slot.id, text: generated[next++] });
    }
  }
  while (next < generated.length && paragraphs.length < MAX_LETTER_PARAGRAPHS) {
    let n = paragraphs.length + 1;
    while (paragraphs.some((p) => p.id === `p${n}`)) n++;
    paragraphs.push({ id: `p${n}`, text: generated[next++] });
  }
  if (next < generated.length) issues.push({ code: 'trimmed_paragraphs', severity: 'warning', section: 'letter', detail: `${generated.length - next} generated paragraph(s) not used` });
  if (paragraphs.length < MIN_LETTER_PARAGRAPHS || (!generated.length && !keep.length)) {
    throw new TailorOutputError('output contains too little fact-supported letter text');
  }

  // A short answer to an application question has its own size; the candidate is told when the fact-checked text falls outside it.
  if (opts.mode === 'answer') {
    const words = paragraphs.reduce((n, p) => n + wordCount(p.text), 0);
    const min = opts.maxWords ? 0 : ANSWER_WORDS.min;
    const max = opts.maxWords ?? ANSWER_WORDS.max;
    if (words < min || words > max) issues.push({ code: 'answer_length', severity: 'warning', section: 'letter', detail: `${words} / ${min ? `${min}–` : '≤ '}${max}` });
  }

  const phrases = LETTER_PHRASES[language];
  return {
    content: {
      kind: 'LETTER',
      language,
      basics: { name: persona.basics.name, email: persona.basics.email, phone: persona.basics.phone, location: persona.basics.location },
      recipient: { company: job.company, position: job.position, location: job.location },
      date: (opts.today ?? new Date()).toISOString().slice(0, 10),
      salutation: phrases.salutation,
      paragraphs,
      closing: phrases.closing,
      signature: persona.basics.name,
    },
    issues,
  };
}

/** The candidate's edits to a letter: wording of existing paragraphs, removing, adding (up to five), and marking paragraphs approved. */
export function applyLetterEdits(
  current: LetterContent,
  persona: Persona,
  edits: { paragraphs?: unknown },
): LetterContent {
  const next: LetterContent = JSON.parse(JSON.stringify(current));
  // Identity and recipient always come from the saved profile / the vacancy the letter was written for, never from the edit body.
  next.basics = { name: persona.basics.name, email: persona.basics.email, phone: persona.basics.phone, location: persona.basics.location };
  next.signature = persona.basics.name;
  if (edits.paragraphs === undefined) return next;
  const list = asArray(edits.paragraphs);
  if (list.length < 1 || list.length > MAX_LETTER_PARAGRAPHS) throw new TailorOutputError(`a letter has 1 to ${MAX_LETTER_PARAGRAPHS} paragraphs`);
  const seen = new Set<string>();
  next.paragraphs = list.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new TailorOutputError('paragraph must be an object');
    const value = text((raw as any).text);
    if (!value) throw new TailorOutputError('paragraph text is empty');
    if (value.length > 1500) throw new TailorOutputError('paragraph is too long');
    let id = text((raw as any).id);
    if (id && !current.paragraphs.some((p) => p.id === id)) throw new TailorOutputError('unknown paragraph id');
    if (!id) {
      let n = i + 1;
      while (seen.has(`p${n}`) || current.paragraphs.some((p) => p.id === `p${n}`)) n++;
      id = `p${n}`;
    }
    if (seen.has(id)) throw new TailorOutputError('paragraph listed twice');
    seen.add(id);
    return { id, text: value, ...((raw as any).approved === true ? { approved: true } : {}) };
  });
  return next;
}
