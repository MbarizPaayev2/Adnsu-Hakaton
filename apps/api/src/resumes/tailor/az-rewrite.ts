import { stems } from './az-compose';
import { allowedVocabulary, languageProblems, tenseProblems, type LanguageProblem } from './az-language';
import { unknownWords, foldWord, inLexicon } from './az-words';
import { dateProblems } from './az-dates';
import { bulletTenses, bulletVoice, clauseFinalTokens, finiteForm, imperfectToPast } from './az-voice';

/**
 * Verification of a MODEL REWRITE against the confirmed evidence it was written from.
 *
 * A rewrite stage may only change the wording of what the candidate confirmed; it must never add a fact. These checks are the gate: a rewrite that fails any
 * of them is discarded and the candidate's own wording (or the existing composed text) is used instead. They are deliberately conservative and mechanical:
 * they catch invented figures, borrowed tools or vacancy words, upgraded attribution ("helped" → "led"), dropped scope, inflated adjectives and copied
 * requirement lines. They do NOT establish that the Azerbaijani is natural, nor that a paraphrase keeps every nuance: the candidate reviews both versions.
 */
const FOLD: Record<string, string> = { ə: 'e', ı: 'i', ğ: 'g', ş: 's', ö: 'o', ü: 'u', ç: 'c' };
export const fold = (s: string) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[əığşöüç]/g, (c) => FOLD[c] || c);
const words = (s: string) => fold(s).split(/[^\p{L}\p{N}+#]+/u).filter(Boolean);

export const numbersOf = (text: string): string[] => (String(text ?? '').match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.').replace(/^0+(?=\d)/, ''));

/** Product, tool and organisation names: ALL-CAPS, CamelCase, tokens with digits or + # . inside, and capitalised words that are not a sentence's first word. */
export function namedTerms(text: string, options: { isLabel?: boolean } = {}): Set<string> {
  const out = new Set<string>();
  for (const sentence of String(text ?? '').split(/(?<=[.!?;:])\s+|\n+/)) {
    const tokens = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}+#.\-/]*/gu) ?? [];
    tokens.forEach((raw, i) => {
      const t = raw.replace(/^[-./]+|[-./]+$/g, '');
      // Every hyphen- or slash-joined segment is judged ("ildən-Étienne" carried an invented name behind a lower-case first segment that used to hide it).
      t.split(/[-/]/).forEach((base, segment) => {
        if (base.length < 2) return;
        const allCaps = /^\p{Lu}[\p{Lu}\d]+$/u.test(base);
        // "XGBoost", "SQLite": a run of capitals before lower case is a product name too (XGBoost could be dropped from a translation unnoticed).
        const camel = /^\p{Lu}\p{Ll}+\p{Lu}/u.test(base) || /\p{Ll}\p{Lu}/u.test(base) || /^\p{Lu}{2,}\p{Ll}{2,}/u.test(base); // not a plural acronym ("KPIs")
        const odd = /\d|[+#]/.test(base) && /\p{L}/u.test(base);
        const capitalisedMid = (options.isLabel || i > 0 || segment > 0) && /^\p{Lu}\p{Ll}/u.test(base);
        if (allCaps || camel || odd || capitalisedMid) out.add(fold(base));
      });
    });
  }
  return out;
}

/** Stems (5 letters) that signal inflated or upgraded claims. Present in a rewrite only when the source already had them. */
const INFLATION = ['effek', 'ugurl', 'mesul', 'yuksek', 'keyfi', 'pesek', 'mukem', 'innov', 'strat', 'musbe', 'ela ', 'bacar', 'etibar', 'sebat', 'ehtir', 'hevesl', 'calisq', 'lider', 'rehbe', 'idare', 'teskil', 'yonle', 'qerar', 'musahi'];
const inflationStems = (text: string) => {
  // "etibarən" ("as of", as in "2022-ci ilin yanvarından etibarən") is ordinary Azerbaijani and not the claim word "etibarlı" (reliable).
  const f = ` ${fold(text).replace(/\betibaren\b/g, ' ')} `;
  return INFLATION.filter((s) => (s.endsWith(' ') ? f.includes(` ${s.trim()} `) : f.includes(s.length >= 5 ? s : ` ${s}`)));
};
/** Scope words: if the source limits or shares the candidate's role, the rewrite must keep that limit. */
const SCOPE: { label: string; stem: string }[] = [
  { label: 'komanda', stem: 'komand' }, { label: 'kömək', stem: 'komek' }, { label: 'iştirak', stem: 'istir' }, { label: 'dəstək', stem: 'deste' }, { label: 'birgə', stem: 'birge' }, { label: 'asistent', stem: 'assis' },
  { label: 'təlim', stem: 'telim' }, { label: 'öyrən', stem: 'oyren' }, { label: 'müşahidə', stem: 'musah' }, { label: 'stajyor', stem: 'stajy' },
];
const present = (text: string, stem: string) => fold(text).includes(stem);

export interface RewriteProblem { code: string; detail: string }

export { NOT_A_VERB_IB } from './az-voice';
import { NOT_A_VERB_IB } from './az-voice';

/**
 * Transitive ("the candidate reduced costs") versus intransitive ("costs decreased") pairs: swapping one for the other silently changes who did the work.
 * Folded stems; the intransitive pattern must not be the transitive one's prefix ("azalt" starts with "azal").
 */
const CAUSATIVE_PAIRS: { transitive: RegExp; intransitive: RegExp; label: string }[] = [
  { transitive: /azalt/, intransitive: /azal(?!t)/, label: 'azaltmaq / azalmaq' },
  { transitive: /yukselt/, intransitive: /yuksel(?!t)/, label: 'yüksəltmək / yüksəlmək' },
  { transitive: /yaxsilasdir/, intransitive: /yaxsilas(?!dir)/, label: 'yaxşılaşdırmaq / yaxşılaşmaq' },
  { transitive: /suretlendir/, intransitive: /suretlen(?!dir)/, label: 'sürətləndirmək / sürətlənmək' },
  { transitive: /guclendir/, intransitive: /guclen(?!dir)/, label: 'gücləndirmək / güclənmək' },
  { transitive: /sadelesdir/, intransitive: /sadeles(?!dir)/, label: 'sadələşdirmək / sadələşmək' },
  { transitive: /gelirini artir|xerclerini artir|satisi artir/, intransitive: /artdi\b/, label: 'artırmaq / artmaq' },
];
/** Problems where the rewrite turns what the candidate DID into something that merely HAPPENED, or the reverse. */
export function voiceShiftProblems(source: string, rewritten: string): RewriteProblem[] {
  const s = fold(source), o = fold(rewritten), out: RewriteProblem[] = [];
  for (const { transitive, intransitive, label } of CAUSATIVE_PAIRS) {
    if (transitive.test(s) && !intransitive.test(s) && intransitive.test(o) && !transitive.test(o)) out.push({ code: 'voice_changed', detail: `${label}: the candidate acted in the original, the rewrite says it happened by itself` });
    if (intransitive.test(s) && !transitive.test(s) && transitive.test(o) && !intransitive.test(o)) out.push({ code: 'voice_changed', detail: `${label}: the original says it happened, the rewrite says the candidate did it` });
  }
  return out;
}

/** Short words a polish may drop or change freely (conjunctions, pronouns, copulas). */
const SHORT_OK = new Set(['ve', 'ile', 'ucun', 'bir', 'her', 'bu', 'men', 'idi', 'ola', 'kimi', 'olan', 'ya', 'da', 'de', 'ki', 'dir', 'idik', 'etdi', 'edir', 'var', 'yox', 'daha', 'cox', 'ayri', 'ona', 'onu', 'hem']);

/** Grammatical person of a bullet: 'first' (mən, -dım, -ıram, -mışam, idik …) or 'third' (the CV style: no pronoun, -dı, -ır). */
export function bulletPerson(text: string): 'first' | 'third' {
  const tokens = foldWord(text).split(/[^\p{L}]+/u).filter(Boolean);
  if (tokens.some((t) => t === 'men' || t === 'menim' || t === 'mene' || t === 'idik' || t === 'idim')) return 'first';
  // The verb closes its clause in Azerbaijani, so only the last word of each clause is judged ("təqdim edir": təqdim is a noun ending in -dim).
  const clauses = foldWord(text).split(/[,;:]|\sve\s|\.\s/);
  const finals = clauses.map((c) => c.split(/[^\p{L}]+/u).filter(Boolean).pop() ?? '').filter(Boolean);
  // first person singular/plural endings: -dım/-dum, -dıq/-duq, -ıram/-irəm/-uram/-ürəm, -mışam/-mişəm, -ırıq/-irik …
  return finals.some((t) => t.length > 4 && /(?:d[iu]m|d[iu][kq]|[iu]r[ae]m|[iu]r[iu][kq]|m[iu]s[ae]m)$/.test(t)) ? 'first' : 'third';
}

export interface BulletContext {
  /** The role has ended: present-tense forms are refused. */
  endedRole?: boolean;
  /** The bullet is about the candidate's own work (a role highlight): it must be in the first person. A project's description of itself need not be. */
  firstPerson?: boolean;
  /** Words of the vacancy (stems): a rewrite may not import them unless the source had them. */
  vacancyTerms?: Set<string>;
  /** Other text whose words exist (the role and employer of the bullet): they count as known words, nothing more. */
  vocabulary?: string[];
}

/** A subject that is not the candidate: "kurs yoldaşlarım", "həmkarlarımız", "komandam", "tələbələrim". */
const OTHER_SUBJECT = /(?:^|[\s,])(?:\p{L}+(?:lar|lər)(?:ım|im|ımız|imiz)|komandam|komandamız|həmkarım|rəhbərim|müəllimim)(?=[\s,])/iu;

/** Whether `rewritten` is an acceptable polish of `source`. Empty array = accepted. */
export function bulletProblems(source: string, rewritten: string, ctx: BulletContext = {}): RewriteProblem[] {
  const problems: RewriteProblem[] = [];
  const src = String(source ?? '').trim(), out = String(rewritten ?? '').trim();
  if (!out) return [{ code: 'empty', detail: 'no text' }];
  if (/[\n\r]/.test(out) || /^(?:[-•*▪●]|\d+[.)])\s/.test(out)) problems.push({ code: 'format', detail: 'the rewrite is not one plain bullet' });
  const srcNums = numbersOf(src), outNums = numbersOf(out);
  for (const n of outNums) if (!srcNums.includes(n)) problems.push({ code: 'invented_number', detail: `"${n}" is not in the original` });
  for (const n of srcNums) if (!outNums.includes(n)) problems.push({ code: 'dropped_number', detail: `"${n}" from the original is missing` });
  const srcNames = namedTerms(src), srcAll = new Set(words(src));
  for (const t of namedTerms(out)) if (!srcNames.has(t) && !srcAll.has(t) && ![...srcAll].some((w) => w.startsWith(t) || t.startsWith(w) && w.length >= 4)) problems.push({ code: 'new_name', detail: `"${t}" is not in the original` });
  for (const t of srcNames) if (t.length >= 3 && !fold(out).includes(t)) problems.push({ code: 'dropped_name', detail: `"${t}" from the original is missing` });
  const srcInfl = new Set(inflationStems(src));
  for (const s of inflationStems(out)) if (!srcInfl.has(s)) problems.push({ code: 'inflated_claim', detail: `adds a claim word ("${s.trim()}…") the original does not have` });
  for (const { label, stem } of SCOPE) if (present(src, stem) && !present(out, stem)) problems.push({ code: 'scope_dropped', detail: `the original says "${label}"; the rewrite no longer does` });
  const srcStems = stems(src), outStems = stems(out);
  if (srcStems.size >= 2) {
    const kept = [...srcStems].filter((s) => outStems.has(s)).length;
    if (kept / srcStems.size < 0.5) problems.push({ code: 'meaning_drift', detail: `only ${kept} of ${srcStems.size} content words survive` });
  }
  const novel = [...outStems].filter((s) => !srcStems.has(s));
  if (novel.length > Math.max(2, Math.ceil(outStems.size * 0.4))) problems.push({ code: 'new_content', detail: `${novel.length} content words are not in the original` });
  if (ctx.vacancyTerms) for (const s of novel) if (ctx.vacancyTerms.has(s)) problems.push({ code: 'vacancy_word_imported', detail: `a word from the vacancy appears that the candidate did not write` });
  problems.push(...voiceShiftProblems(src, out));
  // "Tətbiqi kurs yoldaşlarım test etdi" (my classmates tested it) is someone else's action: turning the verb into "etdim" would make the
  // candidate claim it, and ungrammatically. A third-person sentence with an explicit "my colleagues / my team" subject keeps its person.
  if (OTHER_SUBJECT.test(src) && bulletVoice(src) === 'third' && bulletVoice(out) !== 'third') problems.push({ code: 'subject_changed', detail: 'the original says someone else did this; keep their verb in the third person' });
  if (/\borta\s+\d/iu.test(out) && !/\borta\s+\d/iu.test(src)) problems.push({ code: 'broken_phrase', detail: '"orta" stands directly before a number; "orta hesabla" or "ortalama" is needed' });
  // A bullet that ends in a bare -mış/-miş/-muş/-müş is a participle, not a finished verb ("12 iddianı bağlamış"): "bağlayıb" (3rd person) or "bağladı" is needed.
  const lastWord = out.replace(/[.;:!?)\]]+$/u, '').split(/[^\p{L}]+/u).filter(Boolean).pop() ?? '';
  if (/^\p{Ll}{3,}(?:mış|miş|muş|müş)$/u.test(lastWord) && !src.toLowerCase().split(/[^\p{L}]+/u).includes(lastWord.toLowerCase())) problems.push({ code: 'incomplete_verb', detail: `"${lastWord}" is a participle without a person ending; use the past tense (-dı/-di/-du/-dü) or -ıb/-ib/-ub/-üb` });
  // Short words carry meaning too ("ildə" = per year, "ilə" = with): a 3-4 letter word of the original must survive (an ending change is fine).
  const outFolded = words(out);
  for (const raw of fold(src).split(/\s+/)) {
    if (raw.includes('-')) continue; // "table-lar": a suffix after a hyphen is not a word
    const w = raw.replace(/[^\p{L}\p{N}]/gu, '');
    if (w.length < 3 || w.length > 4 || /\d/.test(w) || SHORT_OK.has(w)) continue;
    if (!outFolded.some((o) => o === w || o.startsWith(w))) problems.push({ code: 'dropped_word', detail: `"${w}" from the original is missing` });
  }
  // A word that is neither the candidate's, nor ordinary Azerbaijani, nor a well-formed ending on a known root is a typo or a garbled word.
  for (const w of unknownWords(out, [src, ...(ctx.vocabulary ?? [])])) problems.push({ code: 'unknown_word', detail: `"${w}"` });
  const sw = words(src).length, ow = words(out).length;
  if (ow > Math.max(8, Math.ceil(sw * 1.45) + 2)) problems.push({ code: 'too_long', detail: `${ow} words for ${sw}` });
  if (ow < Math.ceil(sw * 0.4) && sw > 4) problems.push({ code: 'too_short', detail: `${ow} words for ${sw}` });
  const allowed = new Set([...words(src)]);
  const lang: LanguageProblem[] = languageProblems(out, allowed);
  for (const l of lang) problems.push({ code: `language_${l.kind}`, detail: `"${l.word}"` });
  if (ctx.endedRole) for (const t of tenseProblems([out], allowed)) problems.push({ code: 'tense_drift', detail: `"${t.word}"` });
  // The candidate's own CV voice is the first person ("hazırladım", "edirəm"), never "hazırladı", "edir".
  if (ctx.firstPerson) {
    const voice = bulletVoice(out);
    if (voice === 'third' || voice === 'mixed') problems.push({ code: 'third_person_bullet', detail: 'write the bullet in the first person: -dım/-dim/-dum/-düm for finished work, -ıram/-irəm/-uram/-ürəm for current work' });
    // The candidate's own correct first-person tense is kept: "xidmət göstərirdim" (used to) is not "xidmət göstərdim" (did once).
    const before = bulletTenses(src), after = bulletTenses(out);
    const bt = clauseFinalTokens(src), at = clauseFinalTokens(out);
    const habitualLost = bt.length === at.length && bt.some((t, i) => imperfectToPast(t, at[i]));
    if (habitualLost || (before.length && before.length === after.length && before.some((t, i) => t !== after[i] && (t === 'imperfect' || after[i] === 'imperfect' || t === 'present' || after[i] === 'present')))) {
      problems.push({ code: 'tense_changed', detail: `keep the candidate's own verb tense (${before.join('/')}), only the person and spelling may change` });
    }
  }
  return problems;
}

/**
 * Generic vocabulary of a letter that is not a claim about the candidate (frame words, months, time and education wording). Everything else in a sentence has to come
 * from what the candidate confirmed: a sentence made mostly of other words is an embellishment ("müvafiq tədbirlər görülməsini təmin etdim" after "qeyd edib").
 */
const LETTER_FRAME_STEMS = stems(`müraciət edirəm vəzifəsinə vəzifəsi vəzifə vakansiyasına vakansiya şirkətində şirkətinin şirkət üçün haqqında bütün çalışıram işləmişəm işləyirəm etdim apardım hazırladım təcrübəm təcrübəmi
olaraq qədər ilədək ilin ilə ildən illərdə ildə ayın ayından ayına təhsil təhsili almışam aldım bakalavr magistr ixtisas ixtisası dərəcəsi dərəcə universitet universitetində kollec kolleci tamamlamışam bitirmişəm
yanvar fevral mart aprel iyun iyul avqust sentyabr oktyabr noyabr dekabr yanvarından fevralından martından aprelindən mayından iyunundan iyulundan avqustundan sentyabrından oktyabrından noyabrından dekabrından
yanvarına fevralına martına aprelinə mayına iyununa iyuluna avqustuna sentyabrına oktyabrına noyabrına dekabrına bəri hazırda indiyə davam edir indi həmçinin eyni zamanda həftədə gündə ayda
vaxtında təqdim təşkil iştirak elanda göstərilən tələb olunur tələbi tələbə tələbin sahədə bağlı əlaqədar müddət ərzində əvvəl həmin dövrdə bundan vacibdir
uyğun uyğundur zəmin yaradır yaradaraq çərçivəsində çərçivə töhfə vermək qiymətləndirilməsi qiymətləndirmə imkan verir əsaslanır istiqamətində`);
const GENERIC_COMPANY_WORDS = new Set(['bank', 'banki', 'group', 'grup', 'qrup', 'qrupu', 'mmc', 'asc', 'llc', 'ltd', 'inc', 'qsc', 'company', 'sirket', 'sirketi', 'holding', 'baku', 'azerbaijan', 'azerbaycan', 'hotel', 'international', 'sigorta', 'insurance', 'the', 'and', 've']);
export interface LetterEvidence { id: string; text: string; /** where it happened: position, employer, project or club name */ role?: string; /** when: a period or date, as the candidate confirmed it */ period?: string }
export interface LetterContext {
  position: string;
  company: string;
  evidence: LetterEvidence[];
  motivation: string;
  /** The vacancy's own requirement lines: a letter may not copy them. */
  requirementLines: string[];
  maxWords?: number;
  /** The candidate's own words for why this employer (never written by the system). */
  companyReason?: string;
  /** Every other answer the candidate wrote (experience that clarified the interest, contribution to notice …): facts, and the only source of feelings. */
  ownTexts?: string[];
  /** Requirement lines paired with the evidence that answers them: their words may be used to say how the evidence relates to the role. */
  matches?: { requirement: string; evidenceId: string }[];
  /** A letter shorter than this that also leaves out one of `expectedUses` is asked for again (style); never rejected for length alone. */
  minWords?: number;
  expectedUses?: string[];
}

/**
 * "SOCAR-da işləyirəm" when the vacancy's employer is SOCAR and nothing the candidate confirmed mentions SOCAR. The employer's name is a given input (it may appear
 * in the letter), which would otherwise make it a free word for the writer to attach a job to. A wish ("SOCAR-da işləməyi istəyirəm") is not a claim.
 */
const EMPLOYMENT_CLAIM = /(?:işləyirəm|işləyirdim|işlədim|işləmişəm|işləmişdim|çalışıram|çalışırdım|çalışdım|çalışmışam|xidmət\s+etmişəm|xidmət\s+edirəm|əməkdaşı\s+(?:olmuşam|idim|oldum|olaraq)|əməkdaşıyam|stajyoru?\s+(?:olmuşam|idim|oldum)|təcrübə\s+keçmişəm|təcrübə\s+keçdim)/iu;

/**
 * A letter may use an impersonal, evidence-linked sentence to explain relevance
 * ("Bu təcrübə ... üçün zəmin yaradır"). Such a sentence is grammatical Azerbaijani
 * even though its predicate is third person; it does not turn the candidate's
 * actions into third person. Keep this exception deliberately limited to named
 * evidence nouns and relational predicates. Factuality and unsupported-clause
 * checks still run on the complete sentence.
 */
function isGroundedRelevanceFrame(sentence: string): boolean {
  const s = fold(sentence).trim();
  const subject = /^(?:(?:bu|hemin)\s+)?(?:tecrube(?:m|lerim)?|layihe(?:m|lerim)?|numune(?:m)?|biliklerim|tehsil(?:im)?|yanasma(?:m)?|netice(?:m)?)(?:\s|,)/u;
  const relation = /\b(?:zemin yaradir|esas yaradir|imkan verir|uygun gelir|elaqe yaradir)\b/u;
  return subject.test(s) && relation.test(s);
}

export function inventedEmployment(text: string, company: string, evidence: { text: string; role?: string }[]): string[] {
  const key = fold(company).split(/[^\p{L}\p{N}]+/u).find((w) => w.length >= 3 && !GENERIC_COMPANY_WORDS.has(w));
  if (!key) return [];
  const stem = key.slice(0, Math.max(4, Math.min(6, key.length)));
  const known = evidence.some((e) => fold(`${e.role ?? ''} ${e.text}`).includes(stem));
  if (known) return [];
  const out: string[] = [];
  for (const sentence of String(text ?? '').split(/(?<=[.!?])\s+|\n+/)) {
    if (!fold(sentence).includes(stem)) continue;
    // The claim must come AFTER the employer's name in the same sentence (name … verb), within one clause.
    const clause = sentence.split(/[,;]/).find((c) => fold(c).includes(stem));
    if (clause && EMPLOYMENT_CLAIM.test(clause.slice(fold(clause).indexOf(stem)))) out.push(sentence.trim().slice(0, 120));
  }
  return out;
}

const longestCommonRun = (a: string[], b: string[]) => {
  let best = 0;
  const idx = new Map<string, number[]>();
  b.forEach((w, j) => { const l = idx.get(w) ?? []; l.push(j); idx.set(w, l); });
  for (let i = 0; i < a.length; i++) for (const j of idx.get(a[i]) ?? []) { let k = 0; while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++; if (k > best) best = k; }
  return best;
};

/** A model-written letter body against the evidence it may use. Empty = accepted. */
export function letterProblems(paragraphs: { text: string; uses?: unknown }[], ctx: LetterContext): RewriteProblem[] {
  const problems: RewriteProblem[] = [];
  const text = paragraphs.map((p) => String(p?.text ?? '')).join('\n');
  if (paragraphs.length < 2 || paragraphs.length > 4 || paragraphs.some((p) => !String(p?.text ?? '').trim())) return [{ code: 'shape', detail: 'expected 2 to 4 non-empty paragraphs: an opening paragraph naming the position and employer, then the experience' }];
  const source = [ctx.motivation, ctx.companyReason ?? '', ...(ctx.ownTexts ?? []), ...ctx.evidence.flatMap((e) => [e.text, e.role ?? '', e.period ?? '']), ctx.position, ctx.company].join('\n');
  const srcNums = new Set(numbersOf(source));
  for (const n of numbersOf(text)) if (!srcNums.has(n)) problems.push({ code: 'invented_number', detail: `"${n}"` });
  const srcWords = new Set(words(source)); const srcNames = namedTerms(source);
  for (const t of namedTerms(text)) if (!srcNames.has(t) && !srcWords.has(t) && ![...srcWords].some((w) => w.length >= 4 && (w.startsWith(t) || t.startsWith(w)))) problems.push({ code: 'new_name', detail: `"${t}"` });
  const srcInfl = new Set(inflationStems(source));
  for (const s of inflationStems(text)) if (!srcInfl.has(s)) problems.push({ code: 'inflated_claim', detail: `"${s.trim()}…"` });
  // Evidence ids a paragraph claims to use must exist.
  const ids = new Set(ctx.evidence.map((e) => e.id));
  for (const p of paragraphs) if (Array.isArray(p.uses)) for (const u of p.uses) if (!['motivation', 'reason_for_role', 'reason_for_company', 'requirement_links', 'what_attracts_me', 'experience_that_clarified_it', 'what_caught_my_attention_here', 'contribution_to_notice', 'role_needs'].includes(String(u)) && !ids.has(String(u))) problems.push({ code: 'unknown_evidence', detail: String(u) });
  // The letter must be addressed to this vacancy but not copy its requirement lines.
  // Valid words in a combination that is wrong in Azerbaijani (all observed in model drafts): "ilə 60" for "ildə 60", "orta ilə" for "orta hesabla", a doubled word.
  const suspicious: [RegExp, string][] = [
    [/\borta\s+ilə\b/i, '"orta ilə" (should be "orta hesabla")'],
    [/\bgündən\s+gündə\b/i, '"gündən gündə" means day by day, not per day'],
    [/\b(\p{L}{3,})\s+\1\b/iu, 'a word is repeated'],
    // "Gündə orta hesabla 25" lost its "hesabla": "orta" straight before a number is not Azerbaijani.
    [/\borta\s+\d/iu, '"orta" before a number ("orta hesabla 25" or "ortalama 25")'],
  ];
  for (const [re, why] of suspicious) { const m = re.exec(text); if (m && !re.test(source)) problems.push({ code: 'suspicious_phrase', detail: why }); }
  // "ildə 60" (per year, a number follows) turned into "ilə 60"/"ilin 60": only suspicious when the evidence itself says "ildə <number>"; "SQL ilə 2022-ci ildə" is ordinary Azerbaijani.
  const fs_ = fold(source), ft_ = fold(text);
  if (/\bilde\s+\d/.test(fs_) && /\bil(?:e|in)\s+\d/.test(ft_) && !/\bil(?:e|in)\s+\d/.test(fs_)) problems.push({ code: 'suspicious_phrase', detail: '"ildə" (per year) written as "ilə"/"ilin" before a number' });
  problems.push(...voiceShiftProblems(ctx.evidence.map((e) => e.text).join('\n'), text));
  // Plural first person ("təşkil etdik") is another voice: the letter is the candidate's own singular "mən"; only a token the candidate wrote may keep it.
  const sourceTokens = new Set(source.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean));
  for (const raw of text.toLowerCase().split(/[^\p{L}]+/u)) {
    if (raw.length > 4 && /(?:d[iıuü][kq]|[iıuü]r[iıuü][kq]|m[iıuü]ş[iıuü][kq]|[ae]c[ae][kq])$/.test(raw) && !sourceTokens.has(raw) && !inLexicon(raw)) problems.push({ code: 'wrong_person', detail: `"${raw}" is first person plural` });
  }
  const pos = stems(ctx.position);
  const textStems = stems(text);
  if (pos.size && [...pos].filter((s) => textStems.has(s)).length === 0 && !fold(text).includes(fold(ctx.company).slice(0, 5))) problems.push({ code: 'not_addressed', detail: 'neither the position nor the employer is named' });
  else {
    // The employer's distinctive name: the first word that is not a legal form, a sector or a place ("Bank Respublika ASC" → Respublika).
    const key = fold(ctx.company).split(/[^\p{L}\p{N}]+/u).find((w) => w.length >= 3 && !GENERIC_COMPANY_WORDS.has(w));
    if (key && !fold(text).includes(key.slice(0, 6))) problems.push({ code: 'employer_missing', detail: `the employer "${ctx.company}" is not named` });
  }
  // A lower-case word glued to a capitalised name with a hyphen ("ildən-Étienne") is not Azerbaijani: it is a joined or invented token.
  const joined = /\p{Ll}{2,}-\p{Lu}\p{Ll}+/u.exec(text);
  if (joined && !new RegExp(joined[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u').test(source)) problems.push({ code: 'stray_hyphen', detail: `"${joined[0]}" joins a word and a name with a hyphen` });
  // The letter is the candidate's own "mən": a sentence that ends in the third-person perfect ("təhsil alıb", "kömək edib") is a leftover of CV or third-person wording.
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const last = (sentence.trim().replace(/[.!?;:»")\]]+$/u, '').split(/[^\p{L}]+/u).filter(Boolean).pop() ?? '');
    const form = finiteForm(last);
    // A word the candidate wrote themselves ("öyrədici olardı" in their own reason) is theirs to say.
    if (form?.person === 'third' && !NOT_A_VERB_IB.has(last) && !sourceTokens.has(last.toLowerCase()) && !isGroundedRelevanceFrame(sentence)) problems.push({ code: 'third_person_verb', detail: `"${last}" is third person; the letter is written in the first person ("mən")` });
  }
  // Dates: a year takes its ordinal before a case ending ("2023-cü ildən 2024-cü ilə qədər"), never "2023-dən 2024-cü il kimi".
  for (const d of dateProblems(text)) problems.push({ code: d.code, detail: d.detail });
  // Feelings and reasons are the candidate's own words or nothing: "maraqlıdır", "həvəslə", "arzu edirəm" without a supplied reason is an invention even when every fact is fine.
  {
    const feelingSource = fold([ctx.motivation, ctx.companyReason ?? '', ...(ctx.ownTexts ?? []), ...ctx.evidence.map((e) => e.text)].join(' '));
    const FEELINGS = ['maraq', 'hevesl', 'heves', 'arzu', 'ehtiras', 'sevir', 'xosuma', 'qürur', 'qurur', 'ilhamla', 'motivasiya', 'inanir', 'istekle', 'sevgi'];
    const ft = fold(text);
    for (const f of FEELINGS) if (ft.includes(f) && !feelingSource.includes(f)) { problems.push({ code: 'invented_feeling', detail: `a feeling or wish ("${f}…") that the candidate's own words do not state` }); break; }
  }
  // The connection to the vacancy is stated once per piece of evidence, not as a template repeated: "elandakı … tələbi" may appear at most once.
  if ((fold(text).match(/\belandaki\b|\belanda gosterilen\b|\belandaki\s+\w+\s+telebi/g) ?? []).length > 1 || /\btelebi?\s+(?:olunur|var)\s*;\s*men\b/.test(fold(text)) || /\bvacibdir\s*;\s*men\b/.test(fold(text))) problems.push({ code: 'repeated_link_frame', detail: 'the frame "… tələb olunur; mən …" / "… vacibdir; mən …" is not allowed; explain fit through what you did, in connected prose' });
  // A sentence built mostly of words nothing the candidate confirmed contains is an embellishment, even when every single number and name is fine.
  {
    const known = stems([source, ...(ctx.matches ?? []).map((m) => m.requirement), ...(ctx.requirementLines ?? []), ctx.position ?? '', ctx.company ?? ''].join('\n'));
    const reported = new Set<string>();
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
      const st = [...stems(sentence)].filter((x) => !LETTER_FRAME_STEMS.has(x));
      const novel = st.filter((x) => !known.has(x));
      if (novel.length >= 3 && novel.length / Math.max(1, st.length) >= 0.4 && !reported.has(sentence)) {
        reported.add(sentence);
        problems.push({ code: 'unsupported_clause', detail: `"${sentence.trim().slice(0, 110)}" is mostly words that nothing confirmed contains (${novel.slice(0, 4).join(', ')})` });
      }
    }
  }
  for (const claim of inventedEmployment(text, ctx.company, ctx.evidence)) problems.push({ code: 'invented_employment', detail: `says the candidate works or worked at the employer, which no confirmed evidence says: "${claim}"` });
  const tw = words(text);
  for (const line of ctx.requirementLines) if (longestCommonRun(tw, words(line)) >= 6) { problems.push({ code: 'copies_vacancy', detail: 'six or more consecutive words come from a requirement line' }); break; }
  const count = tw.length;
  if (count < 25) problems.push({ code: 'too_short', detail: `${count} words` });
  // Style, not fact: the evidence supports a fuller letter than this one. Asked for again once; on the last attempt the verified draft stands (never padded).
  else if (ctx.minWords && count < ctx.minWords && (ctx.expectedUses ?? []).some((id) => !paragraphs.some((p) => Array.isArray(p.uses) && p.uses.includes(id)))) problems.push({ code: 'thin_letter', detail: `${count} words; the confirmed evidence supports about ${ctx.minWords} or more, say what the candidate did and how it relates to the role` });
  if (count > (ctx.maxWords ?? 260)) problems.push({ code: 'too_long', detail: `${count} words` });
  // Repetition: the same opening words, or a repeated four-word run.
  const sentences = paragraphs.flatMap((p) => String(p.text).split(/(?<=[.!?])\s+/)).map((s) => words(s)).filter((w) => w.length);
  const firstWords = new Map<string, number>(); for (const w of sentences) firstWords.set(w[0], (firstWords.get(w[0]) ?? 0) + 1);
  const pairs = sentences.filter((w) => w.length >= 2).map((w) => `${w[0]} ${w[1]}`);
  if ([...firstWords.values()].some((n) => n >= 3) || new Set(pairs).size < pairs.length) problems.push({ code: 'repeated_opening', detail: 'sentences start the same way' });
  // The same statement told twice (a requirement link that repeats a sentence already written) is never acceptable, unlike a merely repeated phrase.
  {
    // Nine words is a whole sentence: a link sentence that merely names a fact already told ("hər gün ünvanlara vaxtında təhvil verirəm") is a style matter (the
    // four-word rule below asks once), but a sentence told twice is not.
    const nine = new Map<string, number>();
    for (let i = 0; i + 9 <= tw.length; i++) { const g = tw.slice(i, i + 9).join(' '); nine.set(g, (nine.get(g) ?? 0) + 1); }
    if ([...nine.values()].some((n) => n > 1)) problems.push({ code: 'duplicate_statement', detail: 'the same statement (nine or more words) is written twice; say each fact once' });
  }
  const grams = new Map<string, number>(); for (let i = 0; i + 4 <= tw.length; i++) { const g = tw.slice(i, i + 4).join(' '); grams.set(g, (grams.get(g) ?? 0) + 1); }
  if ([...grams.values()].some((n) => n > 1)) problems.push({ code: 'repeated_phrase', detail: 'a four-word phrase repeats' });
  for (const w of unknownWords(text, [source, ...ctx.requirementLines])) problems.push({ code: 'unknown_word', detail: `"${w}"` });
  for (const l of languageProblems(text, allowedVocabulary(source))) problems.push({ code: `language_${l.kind}`, detail: `"${l.word}"` });
  return problems;
}
