/**
 * Mechanical language checks for generated Azerbaijani text. They catch what a model most often gets wrong in Azerbaijani (Turkish forms and English
 * function words) so the draft can be regenerated with precise feedback. They do NOT prove the text is natural or correct Azerbaijani: only a native
 * reader can say that, and nothing here claims it.
 *
 * A word the candidate or the vacancy itself uses is never a "leak" (company, tool and product names, a Russian employer, "Power BI").
 */
export type LanguageProblemKind = 'turkish_word' | 'turkish_verb_form' | 'english_word' | 'foreign_script' | 'tense_drift';

export interface LanguageProblem {
  kind: LanguageProblemKind;
  word: string;
  /** What to write instead, when there is one (shown to the model, never to the candidate). */
  suggestion?: string;
}

/** Folded Turkish words and their Azerbaijani counterparts. Only words that are NOT also ordinary Azerbaijani. */
const TURKISH_WORDS: Record<string, string> = {
  yerel: 'yerli',
  icin: 'üçün',
  olarak: 'kimi / olaraq',
  ancak: 'lakin / amma',
  cok: 'çox',
  degil: 'deyil',
  gibi: 'kimi',
  veya: 'və ya',
  ve: 'və',
  tarafindan: 'tərəfindən',
  hakkinda: 'haqqında',
  uzerinde: 'üzərində',
  icinde: 'içində',
  sayesinde: 'sayəsində',
  yonelik: 'yönəlik',
  yonetim: 'idarəetmə',
  yonetici: 'rəhbər / menecer',
  sorumlu: 'məsul',
  deneyim: 'təcrübə',
  basari: 'uğur',
  basarili: 'uğurlu',
  gelisim: 'inkişaf',
  destek: 'dəstək',
  destekle: 'dəstəklə',
  destekler: 'dəstəkləyir',
  desteklemek: 'dəstəkləmək',
  surec: 'proses',
  sureci: 'prosesi',
  surecler: 'proseslər',
  rapor: 'hesabat',
  raporlama: 'hesabatlıq',
  baska: 'başqa',
  yapmak: 'etmək',
  yapan: 'edən',
  yaparak: 'edərək',
  bulunmak: 'olmaq',
  bulunan: 'olan',
  calismak: 'işləmək',
  calisarak: 'işləyərək',
  sonuc: 'nəticə',
  sonuclar: 'nəticələr',
  analizler: 'təhlillər',
  bilgi: 'məlumat',
  bilimim: 'biliyim',
  hedef: 'məqsəd',
  musteri: 'müştəri',
  haftalik: 'həftəlik',
  aylik: 'aylıq',
  yillik: 'illik',
  stajyerlik: 'təcrübə',
  stajyer: 'təcrübəçi',
  sahip: 'sahib / malik',
  sahiptir: 'malikdir',
};

/** Turkish word beginnings (in ASCII): any inflection of them is Turkish. */
const TURKISH_PREFIXES = ['yerel', 'destekle', 'yonetim', 'yonetic', 'gelistir', 'calistir', 'basarili', 'deneyim', 'sorumlulu', 'surdurulebil', 'kullanici', 'kullan', 'calisan'];

/** A Turkish plural (-ler/-leri…): Azerbaijani writes -lər/-ləri. Only a word of 5+ letters with no Azerbaijani-only letter is judged; a name the candidate wrote is exempt (see `allowed`). */
const TURKISH_PLURAL = /^[\p{L}]{3,}(?:ler|leri|lerin|lerini|lerde|lerden|lerle|lerimiz)$/u;

/** English words that do not belong in Azerbaijani prose. Names and terms the candidate or vacancy use themselves are exempt (see `allowed`). */
const ENGLISH_WORDS = new Set(
  (
    'the and with for of to in by from is are was were be been being we you our your their his its this that these those or not but if ' +
    'team work works working worked experience experienced skills skill project projects insight insights actionable stakeholder stakeholders reporting reports ' +
    'driven results result key using used use based support supports manage managed management analysis analyze analyzed data-driven strong proven passionate ' +
    'responsible responsibilities ability abilities looking opportunity opportunities company role position candidate application applying regards sincerely dear ' +
    'hiring manager best leading improve improved improving deliver delivered delivering build built building across within between during through over under'
  ).split(/\s+/),
);

const FOLD_MAP: Record<string, string> = { ə: 'e', ı: 'i', ğ: 'g', ş: 's', ö: 'o', ü: 'u', ç: 'c' };
/** Case/diacritic-insensitive form (same rule as tailor-facts `fold`, kept local so the two modules do not import each other). */
function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[əığşöüç]/g, (c) => FOLD_MAP[c] || c).trim();
}

/** Turkish-keyed lookups compare in ASCII with Azerbaijani "ə" left intact, so Turkish "destek"/"ve" never collide with Azerbaijani "dəstək"/"və". */
function asciiTr(s: string): string {
  return s.replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ç/g, 'c');
}

const WORD = /[\p{L}][\p{L}\p{M}'’-]*/gu;

/** A Turkish present-continuous verb ("hazırlıyor"): Azerbaijani writes "hazırlayır". */
const TURKISH_PRESENT = /^[\p{L}]{3,}(?:ıyor|iyor|uyor|üyor)(?:um|sun|uz|lar|lar)?$/u;
/** A Turkish infinitive in -mak/-mek: Azerbaijani writes -maq/-mək. */
const TURKISH_INFINITIVE = /^[\p{L}]{3,}m(?:a|e)k$/u;

/**
 * Words of the candidate's facts and the vacancy, folded: whatever they already use is the candidate's/employer's own vocabulary.
 * `extra` may carry the candidate's motivation text.
 */
export function allowedVocabulary(...texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const m of String(t || '').matchAll(WORD)) out.add(fold(m[0]));
  return out;
}

export function languageProblems(text: string, allowed: Set<string> = new Set()): LanguageProblem[] {
  const found = new Map<string, LanguageProblem>();
  for (const m of String(text || '').matchAll(WORD)) {
    const raw = m[0].replace(/['’-]+$/, '');
    const lower = raw.toLocaleLowerCase('az');
    const f = fold(raw);
    if (allowed.has(f)) continue;
    // Azerbaijani case suffixes may be attached to a supplied foreign name.
    // Preserve the name, without allowing unrelated non-Latin prose or arbitrary suffixes.
    const nameSuffix = raw.match(/^(.+)[’'-](da|də|dan|dən|a|ə|ya|yə|nın|nin|nun|nün|ın|in|un|ün|la|lə)$/u);
    if (nameSuffix && allowed.has(fold(nameSuffix[1]))) continue;
    // An inflected Turkish word: "desteklemek", "yapabilir" are matched by their stem list entry only when whole; suffixed forms are caught below.
    const stem = asciiTr(lower.split(/['’-]/)[0]);
    let problem: LanguageProblem | null = null;
    if (/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(raw)) problem = { kind: 'foreign_script', word: raw, suggestion: 'use Azerbaijani Latin-script wording; preserve only names explicitly present in the source' };
    else if (TURKISH_WORDS[stem]) problem = { kind: 'turkish_word', word: raw, suggestion: TURKISH_WORDS[stem] };
    else if (TURKISH_PREFIXES.some((pre) => stem.startsWith(pre))) problem = { kind: 'turkish_word', word: raw, suggestion: 'use the Azerbaijani word' };
    else if (TURKISH_PLURAL.test(lower)) problem = { kind: 'turkish_word', word: raw, suggestion: 'Azerbaijani plural is -lər/-ləri' };
    else if (TURKISH_PRESENT.test(lower)) problem = { kind: 'turkish_verb_form', word: raw, suggestion: 'use the Azerbaijani present tense -ır/-ir/-ur/-ür' };
    else if (TURKISH_INFINITIVE.test(lower) && !allowed.has(stem)) problem = { kind: 'turkish_verb_form', word: raw, suggestion: 'Azerbaijani infinitive ends in -maq/-mək' };
    else if (ENGLISH_WORDS.has(lower)) problem = { kind: 'english_word', word: raw, suggestion: 'write it in Azerbaijani or leave it out' };
    if (problem && !found.has(f)) found.set(f, problem);
  }
  return [...found.values()];
}

/** Feedback for a regeneration: names the offending words and what to use, nothing about the candidate. */
export function languageFeedback(problems: LanguageProblem[]): string {
  const list = problems.slice(0, 12).map((p) => `"${p.word}"${p.suggestion ? ` → ${p.suggestion}` : ''}`).join('; ');
  return (
    `The previous answer contained words or forms that are not Azerbaijani: ${list}. Write the whole answer again as correct, natural Azerbaijani ` +
    'with the same facts: no Turkish forms (-yor, -mak/-mek, için, olarak, gibi), no English words, no invented words. Reply with the JSON object only.'
  );
}

/** A bullet of a role that has ENDED must not be in the present tense ("hazırlayır"): the model sometimes drifts from the saved past tense. */
export function tenseProblems(bullets: string[], allowed: Set<string> = new Set()): LanguageProblem[] {
  const out: LanguageProblem[] = [];
  for (const bullet of bullets) {
    const last = String(bullet || '').trim().replace(/[.;:!?)\]]+$/u, '').split(/\s+/).pop() ?? '';
    const word = last.toLocaleLowerCase('az');
    // third person ("hazırlayır") or first person ("hazırlayıram", "edirəm") present tense for a role that has ended
    if (/^[\p{L}]{5,}(?:ır|ir|ur|ür|ıram|uram|irəm|ürəm)$/u.test(word) && !allowed.has(fold(word))) {
      out.push({ kind: 'tense_drift', word: last, suggestion: 'past tense (-dım/-dim/-dum/-düm): this role has ended' });
    }
  }
  return out;
}
