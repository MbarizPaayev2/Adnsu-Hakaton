import { isLetter, type DocumentContent } from './resume-tailor.types';
import type { ModelCall, WriterConfig, WriterTrace } from './az-writer';
import { fold, namedTerms, numbersOf, type RewriteProblem } from './az-rewrite';
import { allowedVocabulary, languageProblems, tenseProblems } from './az-language';
import { bulletTenses, bulletVoice } from './az-voice';
import { documentFields, needsTranslation, translateEmbeddedRoleLabels, translatedRoleVocabulary } from './az-document-fields';
import { unknownWords } from './az-words';
import type { TailoredContent } from './resume-tailor.types';
import { createHash } from 'node:crypto';
import { currentTranslationMemory, memoryKey } from './translation-memory';

/**
 * English → Azerbaijani translation of the candidate's own CV text.
 *
 * The candidate wrote (or imported) their CV in English; choosing Azerbaijani must translate the summary, the role bullets and the project text, not only
 * the headings. A model translates; every result is checked mechanically against its source (numbers, names, tools, length, voice, language) and anything
 * that fails is NOT shown as Azerbaijani: it stays flagged as "not translated" until the candidate retries or writes it themselves. Nothing here proves the
 * Azerbaijani is natural; the candidate reviews source and translation side by side.
 */

export const ENGLISH_FUNCTION_WORDS = new Set([
  'the', 'and', 'of', 'to', 'with', 'for', 'in', 'on', 'by', 'from', 'across', 'including', 'that', 'which', 'as', 'an', 'a', 'into', 'using', 'through', 'while',
  'was', 'were', 'is', 'are', 'be', 'been', 'has', 'have', 'had', 'their', 'its', 'our', 'over', 'between', 'within', 'among', 'per', 'via', 'also', 'both', 'more',
  'than', 'under', 'after', 'before', 'during', 'who', 'where', 'whose', 'about', 'against', 'toward', 'towards', 'based',
]);

/** True when the text reads as English rather than Azerbaijani (function words, no Azerbaijani letters). Short names and tool lists are not "English prose". */
export function looksEnglish(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (/\b(?:business|data) analyst(?: intern)?\b|\bco-founder\b|\bproduct lead\b/i.test(t)) return true;
  const prose = t.replace(/\b[A-Z][A-Za-z]+(?: (?:(?:in|of|for|the|and) )?[A-Z][A-Za-z]+)+/g, '');
  const words = prose.toLowerCase().match(/[a-zçəğıöşüİ'’-]+/giu) ?? [];
  if (!/[əğıöşüçƏĞİÖŞÜÇ]/.test(t) && /^(?:built|created|completed|developed|designed|analyzed|analysed|reviewed|managed|supported|led|leading|developing|prepared|implemented)\b/i.test(t) && words.length >= 2) return true;
  if (words.length < 4) return false;
  const hits = words.filter((w) => ENGLISH_FUNCTION_WORDS.has(w)).length;
  const azLetters = /[əğıöşüçƏĞİÖŞÜÇ]/.test(t);
  if (hits >= 2 && hits / words.length >= 0.1) return true;
  // A long Azerbaijani paragraph can contain an English clause whose signal is diluted by surrounding text and names.
  for (let i = 0; i <= words.length - 8; i++) {
    const window = words.slice(i, i + 12);
    if (window.filter(w => ENGLISH_FUNCTION_WORDS.has(w)).length >= 2) return true;
  }
  if (/\b(?:emerging green|risk[- ]escalation logic|financial[- ]wellness|research deliverables|advisory opportunity)\b/i.test(prose)) return true;
  return !azLetters && words.length >= 6 && hits >= 1;
}

export interface TranslateItem { id: string; text: string; kind: 'bullet' | 'summary' | 'headline' | 'project' | 'label'; role?: string; current?: boolean }
export interface TranslateResult {
  /** `suspect`: words of the translation that are neither the candidate's own nor ordinary Azerbaijani; shown to the candidate to check. */
  accepted: { id: string; text: string; suspect?: string[] }[];
  failed: { id: string; problems: RewriteProblem[] }[];
  trace: WriterTrace;
}

export const TRANSLATABLE = new Set('incubation program programme regional international global financial wellness venture seed fund youth development fellow entrepreneurship platform business analyst intern founder product lead sustainability research engineer developer software consultant specialist coordinator director marketing sales finance human resources operations executive assistant supervisor manager officer accountant quality assurance bachelor master administration skills analysis management communication english russian advanced intermediate remote'.split(' '));
/**
 * Ordinary English words that CVs write in Title Case ("Machine Learning Intern", "Data Visualization", "Winner, Startup Pitch Competition"). Capitalised,
 * they looked like names to `namedTerms`, so a faithful translation of a job title or a skill was rejected as "dropped name" on every attempt and the field
 * stayed English (reproduced 17 October 2026 with the reported founder CV). They are not names: a translation may render them. Brand and tool words
 * (Excel, Vision, Power, Office, Forest...) are deliberately absent, and ALL-CAPS, CamelCase and digit tokens (SQL, XGBoost, PR-AUC) stay protected.
 */
export const GENERIC_TITLE_WORDS = new Set((
  'machine learning deep artificial intelligence data science scientist analytics analysis analyst analytical visualization visualisation engineering engineer '
  + 'computer information technology systems system network networking security cloud software web mobile application applications development developer '
  + 'distributed infrastructure architecture '
  + 'design designer graphic user experience interface research researcher assistant associate junior senior lead principal head chief officer manager '
  + 'management project projects program programme product products operations operational marketing digital content social media communications '
  + 'communication public relations sales business customer client service services support success account accounting accountant finance financial '
  + 'investment banking corporate retail commercial institutional risk compliance audit auditor tax legal human resources talent recruitment recruiter administrative administration administrator '
  + 'executive coordinator specialist consultant consulting advisor adviser advisory strategy strategic planning planner logistics supply chain procurement purchasing '
  + 'quality assurance control testing tester teacher teaching tutor education trainer training instructor mentor student intern internship trainee volunteer '
  + 'academic higher lecturer curriculum state '
  + 'volunteering ambassador member president vice treasurer secretary organizer organiser fellow fellowship scholarship winner finalist participant runner '
  + 'certificate certification professional fundamentals foundations introduction advanced intermediate beginner course diploma degree bachelor master '
  + 'studies economics mathematics statistics physics chemistry biology architecture civil mechanical electrical electronics industrial chemical petroleum '
  + 'energy environmental sustainability hospitality tourism journalism language languages literature linguistics translation international relations '
  + 'psychology sociology history problem solving critical thinking teamwork leadership time presentation public speaking negotiation writing reporting '
  + 'modeling modelling forecasting budgeting spreadsheet dashboard dashboards database databases mining processing cleaning wrangling pipeline pipelines '
  + 'automation stakeholder stakeholders requirements gathering definition documentation prediction predictive classification clustering segmentation '
  + 'recommendation detection recognition entrepreneurship startup pitch competition award prize honor honour hackathon olympiad contest championship '
  + 'challenge summit conference forum club society team community youth innovation incubation accelerator bootcamp university institute college '
  + 'department faculty general small medium enterprise enterprises customer churn ledger ledgers'
).split(' '));

/** Descriptive words are not proper names when a CV stores a brand and descriptor on one line. */
export const DESCRIPTIVE_WORDS = new Set((
  'outstanding contributor contribution excellence achievement achiever award awarded distinguished carbon capture concrete additive additives material materials enabled powered based driven first native venture ventures startup company companies platform solution solutions app tool tools service marketplace agency studio lab initiative fund foundation network hub academy school wellness wellbeing health healthcare care medical fintech edtech agritech climate green clean renewable smart digital online local regional national global automation automated analytics insights advisory consultancy delivery logistics food fashion retail ecommerce commerce payments payment lending insurance credit savings budget personal family student students women learning career careers jobs hiring recruiting travel booking tourism water waste recycling circular emission emissions cement construction building housing energy solar battery electric mobility transport urban city farm farming agriculture organic ledger ledgers bookkeeping accounting invoice invoicing tax reporting compliance risk fraud detection security privacy research reports study ' +
  'design research analysis analyst engineer developer intern specialist manager lead founder product operations sales marketing finance resources quality communication skills '.trim()
).split(/\s+/));

const NAME_VARIANTS: Record<string, string[]> = {
  baku: ['baku', 'baki'],
  azerbaijan: ['azerbaijan', 'azerbaycan'],
  azerbaijani: ['azerbaijani', 'azerbaycan'],
};

const protectedTerms = (text: string, options?: { isLabel?: boolean }) => new Set([...namedTerms(text, options)].filter(t => !TRANSLATABLE.has(t) && !GENERIC_TITLE_WORDS.has(t) && !DESCRIPTIVE_WORDS.has(t) && !/^\d+(?:st|nd|rd|th)$/.test(t)));

const SYSTEM = [
  'You translate a candidate\'s own CV text from English into natural, standard Azerbaijani (Latin script). Each input item is one thing the candidate wrote.',
  'Translate faithfully using natural Azerbaijani sentence structure; reorder clauses where Azerbaijani grammar requires it, normally ending with the main verb. Do not add, embellish, omit or shorten facts. Keep EXACTLY as in the source: every person, organisation, programme, product and tool name, acronym, number, currency, percentage, unit and date. Generic labels (Incubation Program, Business Analyst), nationalities and ordinals are NOT names: translate them (Azərbaycan, inkubasiya proqramı, biznes analitiki, 6-cı)',
  '(for example "Power BI", "XGBoost", "ISAE 3000", "$108,623", "577:1", "100K+"). When the source writes a number as digits, retain digits in the translation (including 1: never replace it with bir or biri). Add nothing: no results, adjectives, qualities, responsibilities or numbers that the source does not state, and drop nothing.',
  'Keep who did what (the candidate alone, with a team, or helping) and scope words ("co-", "supported", "contributed").',
  'For tool or system actions inside a candidate bullet, use a participle or nominal clause so the main verb can be first person without changing agency (a workflow that digitizes records = qeydləri rəqəmsallaşdıran iş axını). Never turn a tool action into a new claim that the candidate personally did it.',
  'kind "bullet": one CV bullet in the candidate\'s own FIRST PERSON. Finished work: simple past (-dım, -dim, -dum, -düm: "hazırladım", "təhlil etdim"); work still going on (current=true): present (-ıram, -irəm, -uram, -ürəm: "hazırlayıram"). Current roles may include completed milestones: translate each action in its source tense, so an ongoing action and a completed award can have different tenses. Use participles for nested tool actions. Keep source sentence boundaries. No leading dash or bullet sign.',
  'kind "summary" / "headline" / "project": neutral, as the source states it; no first-person "mən" unless the source is written in the first person.',
  'Use Azerbaijani technical terms where they are established ("hesabat", "təhlil", "layihə", "məlumat bazası") and keep an English term as written when Azerbaijani CVs usually keep it ("dashboard", "pipeline", "machine learning", "Power BI"). No Turkish forms (-yor, -mak/-mek, için, olarak, plural -ler: Azerbaijani is -lər; "sürdürülebilir" is wrong: write "dayanıqlı"). Do not invent compound words; if no established Azerbaijani word exists, keep the English term as written.',
  'Use idiomatic professional wording, not literal English noun chains. Examples of meaning (not candidate facts): product development = məhsulun hazırlanması; leading product development = məhsulun hazırlanmasına rəhbərlik edirəm (never məhsul inkişafını rəhbərlik edirəm); research deliverables = tədqiqat materialları (never tədqiqat çatdırılması); advisory opportunity briefs = məsləhət xidmətləri üzrə imkanlara dair qısa arayışlar; workflow = iş axını. Use təhlil rather than analiz where natural. Preserve the source meaning and agency; these examples do not authorize any new claim.',
  'Do not add a hyphen before Azerbaijani case endings (Azərbaycanın, not Azərbaycan-ın). Use established wording: unit economics = vahid üzrə gəlirlilik; ledger = uçot kitabı; risk escalation logic = risklərin yuxarı səviyyəyə ötürülməsi qaydası; churn-aware = müştəri itkisini nəzərə alan; playbook = fəaliyyət bələdçisi. Percentage points (pp) means faiz bəndi, not percent (%).',
  'Reply with JSON only: {"items":[{"id":"...","text":"..."}]}.',
].join(' ');

/** Changes whenever the translation instructions change, so remembered translations made under other instructions are not reused. */
export const TRANSLATION_PROMPT_VERSION = createHash('sha256').update(SYSTEM).digest('hex').slice(0, 12);

const jsonOf = (text: string): any | null => {
  const t = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
};

const wordsOf = (s: string) => fold(s).split(/[^\p{L}\p{N}+#]+/u).filter(Boolean);
const HANGING_END = /\s(?:və|ilə|üçün|ki|da|də|və ya|olaraq|kimi|üzrə|barədə|haqqında|ilə birlikdə)$/iu;

/** Whether `out` is an acceptable Azerbaijani translation of `src`. Empty = accepted. */
export function translationProblems(src: string, out: string, ctx: { kind: TranslateItem['kind']; current?: boolean; vocabulary?: string[] } = { kind: 'bullet' }): RewriteProblem[] {
  const problems: RewriteProblem[] = [];
  const s = String(src ?? '').trim(), o = String(out ?? '').trim();
  if (!o) return [{ code: 'empty', detail: 'no text' }];
  if (/[\n\r]/.test(o) || /^(?:[-•*▪●–—]|\d+[.)])\s/.test(o)) problems.push({ code: 'format', detail: 'one plain sentence without a leading dash or bullet sign' });

  const sn = numbersOf(s), on = numbersOf(o);
  // Azerbaijani naturally renders '1 of 20' as '20 nəfərdən biri'. This is the same selection count, not a dropped fact.
  const selection = /\b1 of (\d+)\b/i.exec(s);
  const selectionOne = selection && (s.match(/\b1\b(?![.,]\d)/g) ?? []).length === 1
    && new RegExp(`(?<![\\p{L}\\d])${selection[1]}(?:-(?:dən|dan)|\\s+[\\p{L}\\s-]{0,45}(?:dən|dan))\\s+biri(?![\\p{L}])`, 'iu').test(o.replace(/[‐‑–]/g, '-'));
  for (const n of on) if (!sn.includes(n)) problems.push({ code: 'invented_number', detail: `"${n}" is not in the source` });
  for (const n of sn) if (!on.includes(n) && !(n === '1' && selectionOne)) problems.push({ code: 'dropped_number', detail: `"${n}" from the source is missing` });

  const isLabel = ctx.kind === 'label' || ctx.kind === 'headline';
  const srcNames = protectedTerms(s, { isLabel });
  const outFolded = fold(o);
  for (const t of srcNames) {
    if (t.length >= 3) {
      const variants = NAME_VARIANTS[t] ?? [t];
      if (!variants.some((v) => outFolded.includes(v))) {
        problems.push({ code: 'dropped_name', detail: `"${t}" from the source is missing; keep names, tools and acronyms as written` });
      }
    }
  }
  const srcAll = new Set(wordsOf(s));
  const translatedRoleWords = new Set(wordsOf(translatedRoleVocabulary(s).join(' ')));
  for (const t of protectedTerms(o, { isLabel })) {
    if (!unknownWords(o.toLocaleLowerCase('az'), []).some(w => fold(w) === t) && !new RegExp('\\b' + t.toUpperCase() + '\\b').test(o)) continue;
    if (srcNames.has(t) || srcAll.has(t) || translatedRoleWords.has(t)) continue;
    if ([...srcNames].some((s) => (NAME_VARIANTS[s] ?? []).some((v) => t.startsWith(v) || v.startsWith(t)))) continue;
    if ([...srcAll].some((w) => w.length >= 4 && (w.startsWith(t) || t.startsWith(w)))) continue;
    problems.push({ code: 'new_name', detail: `"${t}" is not in the source` });
  }

  // A short label or headline returned in English ("Stakeholder Communication" for "Stakeholder Communication") is not prose to looksEnglish, so it used
  // to be accepted as a "translation", recorded as translated and then listed as English with no further attempt.
  if (looksEnglish(o) || ((ctx.kind === 'label' || ctx.kind === 'headline') && needsTranslation(o, ctx.kind))) problems.push({ code: 'still_english', detail: 'the text is still English' });
  const allowed = allowedVocabulary([...srcNames].join(' '), ...(ctx.vocabulary ?? []));
  // Connectors inside an unchanged official name (Youth in Development Fellow) are not leaked English prose.
  const officialNames = s.match(/\b[A-Z][A-Za-z]+(?: (?:(?:in|of|for|the|and) )?[A-Z][A-Za-z]+)+/g) ?? [];
  for (const name of officialNames) if (o.includes(name) && (/\b(?:in|of|for|the)\b/.test(name) || !name.split(' ').every(w => TRANSLATABLE.has(w.toLowerCase())))) for (const word of wordsOf(name)) allowed.add(word);
  for (const p of languageProblems(o, allowed)) problems.push({ code: p.kind, detail: `"${p.word}"${p.suggestion ? ` → ${p.suggestion}` : ''}` });

  const sw = wordsOf(s).length, ow = wordsOf(o).length;
  if (ow > Math.ceil(sw * 1.9) + 3) problems.push({ code: 'too_long', detail: `${ow} words for ${sw}` });
  if (sw > 5 && ow < Math.ceil(sw * 0.4)) problems.push({ code: 'too_short', detail: `${ow} words for ${sw}` });
  if (HANGING_END.test(o.replace(/[.;:!?]+$/u, ''))) problems.push({ code: 'incomplete', detail: 'the sentence ends on a connecting word' });
  for (const p of wordingProblems(s, o)) problems.push(p);

  if (ctx.kind === 'bullet') {
    // Amount + gəlir is a noun, not the verb 'arrives'; commas in numeric lists do not make it a predicate.
    let voiceText = o.replace(/(\d[\d.,]*[KM]?\s+)gəlir(?=\s*[,;])/gu, '$1məbləğ');
    const toolAction = /with\s+([A-Z][\w-]+)\s+achieving\b/.exec(s);
    if (toolAction && s.includes(toolAction[1])) voiceText = voiceText.replace(new RegExp('\\b' + toolAction[1] + '[^;\\n]*$'), '');
    const voice = bulletVoice(voiceText);
    if (voice === 'third' || voice === 'mixed') problems.push({ code: 'voice', detail: 'a CV bullet is in the first person ("hazırladım"), not the third' });
    if (ctx.current === false) for (const t of tenseProblems([o], allowed)) problems.push({ code: t.kind, detail: `"${t.word}": ${t.suggestion}` });
    // One tense in a bullet: "analiz etmişəm … müəyyən etdim" reads as two writers.
    const tenses = new Set(bulletTenses(o));
    const mixedSourceTime = ctx.current === true && /\b(?:leading|developing|currently|preparing)\b/i.test(s) && /\b(?:accepted|awarded|selected|named|completed)\b/i.test(s);
    if (!mixedSourceTime && tenses.size > 1 && !(tenses.size === 2 && tenses.has('past') && tenses.has('imperfect'))) problems.push({ code: 'tense_mixed', detail: `one bullet mixes ${[...tenses].join(' and ')}; use a single tense` });
  }
  return problems;
}

const CALQUE_RULES: { re: RegExp; detail: string }[] = [
  { re: /\blojik|lojiğ/iu, detail: '“lojiği” is not idiomatic Azerbaijani; use “məntiqi” or “qaydası”.' },
  { re: /məbləğ\s+dəftər/iu, detail: 'For ledger, prefer “uçot kitabı”.' },
  { re: /\bvahid[-‑‐\s]+(?:iqtisadiyyat|ekonomikas)/iu, detail: 'For unit economics, prefer “vahid üzrə gəlirlilik”.' },
  { re: /[-‑‐]şüurlu\b/iu, detail: 'Avoid literal “-aware” compounds; express the idea as “nəzərə alan”.' },
  { re: /\p{L}[-‑‐]playbook|playbook[-‑‐]\p{L}/iu, detail: 'Translate playbook as “fəaliyyət bələdçisi”.' },
];
const CASE_ENDING = '(?:ın|in|un|ün|nın|nin|nun|nün|a|ə|ya|yə|na|nə|da|də|dan|dən|ı|i|u|ü|nı|ni|nu|nü|yı|yi|yu|yü|la|lə|dakı|dəki)';
/** Narrow language checks for known Azerbaijani calques that are not caught by factuality validation. */
export function wordingProblems(src: string, out: string): RewriteProblem[] {
  const problems: RewriteProblem[] = [];
  for (const rule of CALQUE_RULES) if (rule.re.test(out) && !rule.re.test(src)) problems.push({ code: 'calque', detail: rule.detail });
  const sourceWords = new Set(wordsOf(src));
  for (const match of out.matchAll(new RegExp(`(?<![\\p{L}\\d])(\\p{L}*\\p{Ll}\\p{L}*)[-‑‐]${CASE_ENDING}(?![\\p{L}])`, 'gu'))) {
    const stem = match[1];
    if (/^\p{Lu}+$/u.test(stem) || sourceWords.has(fold(stem))) continue;
    problems.push({ code: 'suffix_hyphen', detail: `Write the Azerbaijani case ending without a hyphen (“${match[0]}”).` });
  }
  for (const match of src.matchAll(/(\d+(?:[.,]\d+)?)\+?\s*(?:pp|p\.p\.|percentage points?)\b/giu)) {
    const n = match[1].replace('.', '\\.');
    if (new RegExp(`${n}\\+?\\s*%`).test(out) || !/faiz\s+bənd|\bpp\b|p\.p\./iu.test(out)) {
      problems.push({ code: 'percentage_points', detail: `“${match[0]}” means percentage points (faiz bəndi), not percent.` });
    }
  }
  return problems;
}

const MAX_CALLS = 3;

/**
 * Output space for one translation call. Groq admits a request only when its per-minute budget (8,000 tokens on the production account) holds the
 * prompt AND max_tokens, so the earlier cap of up to 3,200 tokens per batch let barely two batches start per minute, while answers used about 350
 * (16 October evaluation: 5,912 output tokens over 17 calls). Azerbaijani runs to roughly 0.5 tokens per source character; 0.7 plus 600 for low-effort
 * reasoning and JSON keeps a wide margin.
 */
export const translationOutputTokens = (items: { text: string }[]) => Math.min(2400, Math.max(1024, 600 + Math.ceil(items.reduce((n, item) => n + item.text.length, 0) * 0.7)));
const shortName = (m: string) => m.split('/').pop() ?? m;

export async function translateItems(call: ModelCall, cfg: WriterConfig, items: TranslateItem[]): Promise<TranslateResult> {
  const trace: WriterTrace = { outcomes: [], calls: 0, promptTokens: 0, completionTokens: 0 };
  const result: TranslateResult = { accepted: [], failed: [], trace };
  if (!items.length) { trace.outcomes.push('translate:no-items'); return result; }
  let pending = items;
  const feedback = new Map<string, string>();

  const order = cfg.models.length ? [cfg.models[0], ...cfg.models.slice(1), cfg.models[0]] : [];
  const now = cfg.now ?? Date.now;
  const started = now();
  let calls = 0;
  for (const model of order) {
    if (!pending.length || calls >= MAX_CALLS) break;
    const left = cfg.deadlineMs - (now() - started);
    if (left <= 5_000) { trace.outcomes.push('translate:deadline'); break; }
    calls++; trace.calls++;
    const payload = { items: pending.map((i) => ({ id: i.id, text: i.text, kind: i.kind, role: i.role, current: !!i.current, ...(feedback.has(i.id) ? { your_previous_answer_was_rejected: feedback.get(i.id) } : {}) })) };
    const res = await call(model, [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(payload) }], { timeoutMs: Math.min(cfg.timeoutMs, left), waitMs: Math.max(0, left - cfg.timeoutMs - 2_000), maxTokens: translationOutputTokens(pending) });
    if (res) { trace.promptTokens += res.promptTokens; trace.completionTokens += res.completionTokens; }
    if (!res) { trace.outcomes.push(`translate:${shortName(model)}:unavailable`); continue; }
    const got = Array.isArray(jsonOf(res.text)?.items) ? (jsonOf(res.text).items as { id?: unknown; text?: unknown }[]) : [];
    if (!got.length) { trace.outcomes.push(`translate:${shortName(model)}:no-json`); continue; }
    const still: TranslateItem[] = [];
    for (const src of pending) {
      const g = got.find((x) => x?.id === src.id);
      let text = translateEmbeddedRoleLabels(String(g?.text ?? '').trim().replace(/^[-•*▪●–—]\s+/, ''));
      if (!g || !text) { still.push(src); feedback.set(src.id, 'no answer for this item'); continue; }
      const problems = translationProblems(src.text, text, { kind: src.kind, current: src.current, vocabulary: src.role ? [src.role] : [] });
      // Words that are neither the candidate's nor ordinary Azerbaijani (a garbled coinage, an unknown form) do not trigger another model call (each call
      // costs seconds against the document's deadline): the translation is kept and those words are named so the candidate checks exactly them.
      const suspect = problems.length ? [] : unknownWords(text, [src.text, src.role ?? '']).filter((w) => w.length > 5);
      if (problems.length) {
        still.push(src);
        feedback.set(src.id, problems.map((p) => `${p.code} ${p.detail}`).join('; ') + '. Translate the source faithfully; change only what these points require.');
        const k = result.failed.findIndex((f) => f.id === src.id);
        if (k >= 0) result.failed[k] = { id: src.id, problems }; else result.failed.push({ id: src.id, problems });
      } else {
        const k = result.failed.findIndex((f) => f.id === src.id);
        if (k >= 0) result.failed.splice(k, 1);
        result.accepted.push({ id: src.id, text, ...(suspect.length ? { suspect } : {}) });
      }
    }
    pending = still;
    trace.model = res.model;
    trace.outcomes.push(`translate:${shortName(model)}:${result.accepted.length}-accepted:${pending.length}-pending`);
  }
  for (const p of pending) if (!result.failed.some((f) => f.id === p.id)) result.failed.push({ id: p.id, problems: [{ code: 'no_answer', detail: 'the model gave no usable translation' }] });
  return result;
}

/**
 * Remembered translations of these items (see translation-memory.ts), each re-checked with today's `translationProblems`; `misses` still need a model.
 * Without a memory in scope everything is a miss.
 */
export async function recallTranslations<T extends TranslateItem>(cfg: WriterConfig, items: T[]): Promise<{ hits: { id: string; text: string }[]; misses: T[] }> {
  const store = currentTranslationMemory();
  if (!store || !items.length) return { hits: [], misses: items };
  const model = cfg.models[0] ?? '';
  const keys = items.map((i) => memoryKey(i, model, TRANSLATION_PROMPT_VERSION));
  const found = await store.get([...new Set(keys)]);
  const hits: { id: string; text: string }[] = [];
  const misses: T[] = [];
  items.forEach((item, k) => {
    const text = found.get(keys[k]);
    if (text && !translationProblems(item.text, text, { kind: item.kind, current: item.current, vocabulary: item.role ? [item.role] : [] }).length) hits.push({ id: item.id, text });
    else misses.push(item);
  });
  return { hits, misses };
}

/** Remembers translations that passed every check, for the candidate's next documents. */
export async function rememberTranslations(cfg: WriterConfig, items: TranslateItem[], accepted: { id: string; text: string }[]): Promise<void> {
  const store = currentTranslationMemory();
  if (!store || !accepted.length) return;
  const model = cfg.models[0] ?? '';
  const entries = accepted.map((a) => { const item = items.find((i) => i.id === a.id); return item ? { key: memoryKey(item, model, TRANSLATION_PROMPT_VERSION), text: a.text } : null; }).filter((e): e is { key: string; text: string } => !!e);
  await store.put(entries).catch(() => undefined);
}

/** `translateItems` that first reuses remembered translations and remembers the new accepted ones. */
export async function translateRemembered(call: ModelCall, cfg: WriterConfig, items: TranslateItem[]): Promise<TranslateResult> {
  const { hits, misses } = await recallTranslations(cfg, items);
  const result = misses.length ? await translateItems(call, cfg, misses) : { accepted: [], failed: [], trace: { outcomes: [], calls: 0, promptTokens: 0, completionTokens: 0 } as WriterTrace };
  await rememberTranslations(cfg, misses, result.accepted);
  if (hits.length) result.trace.outcomes.unshift(`translate:memory:${hits.length}/${items.length}`);
  return { ...result, accepted: [...hits, ...result.accepted] };
}

export interface UntranslatedItem { path: string; text: string; section: string }

/** Every text of an Azerbaijani document that is still English prose. Used to flag the review and to hold back approval (a PDF must not be Azerbaijani only in its headings). */
export function untranslatedItems(content: DocumentContent): UntranslatedItem[] {
  return documentFields(content).filter(f => needsTranslation(f.text, f.kind)).map(f => ({ path: f.id, text: f.text, section: f.section }));
}
