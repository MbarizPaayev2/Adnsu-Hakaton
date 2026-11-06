/**
 * Dates in Azerbaijani sentences, written by code and checked by code.
 *
 * Measured on 11 October 2026 (founder review): drafts wrote "2023-dən 2024-cü il kimi" for "2023 – 2024" (a number cannot take a case ending without its ordinal
 * "-cü il", and "kimi" is not "until"). Case endings on years and months are regular, so the model is given the finished phrase and any other form is refused.
 *
 *   "2023 - 2024"            → "2023-cü ildən 2024-cü ilə qədər"
 *   "Jun 2023 - Present"     → started: "2023-cü ilin iyunundan"   (a role that is still running: "… iyunundan Şirkət-də işləyirəm")
 *   "Jan 2022 - May 2023"    → "2022-ci ilin yanvarından 2023-cü ilin mayına qədər"
 *   "2021"                   → "2021-ci ildə"
 */

const MONTH_NAMES = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'] as const;
/** possessive + case endings, by the month's last vowel (back: ı/u, front: ə/i/ü): "yanvarından", "aprelindən", "iyunundan". */
const MONTH_FORMS: Record<number, { abl: string; dat: string; loc: string }> = {
  1: { abl: 'yanvarından', dat: 'yanvarına', loc: 'yanvarında' },
  2: { abl: 'fevralından', dat: 'fevralına', loc: 'fevralında' },
  3: { abl: 'martından', dat: 'martına', loc: 'martında' },
  4: { abl: 'aprelindən', dat: 'aprelinə', loc: 'aprelində' },
  5: { abl: 'mayından', dat: 'mayına', loc: 'mayında' },
  6: { abl: 'iyunundan', dat: 'iyununa', loc: 'iyununda' },
  7: { abl: 'iyulundan', dat: 'iyuluna', loc: 'iyulunda' },
  8: { abl: 'avqustundan', dat: 'avqustuna', loc: 'avqustunda' },
  9: { abl: 'sentyabrından', dat: 'sentyabrına', loc: 'sentyabrında' },
  10: { abl: 'oktyabrından', dat: 'oktyabrına', loc: 'oktyabrında' },
  11: { abl: 'noyabrından', dat: 'noyabrına', loc: 'noyabrında' },
  12: { abl: 'dekabrından', dat: 'dekabrına', loc: 'dekabrında' },
};
const EN_MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const AZ_MONTH_PREFIX: Record<string, number> = { yan: 1, fev: 2, mar: 3, apr: 4, may: 5, iyn: 6, iyu: 6, iyl: 7, avq: 8, sen: 9, okt: 10, noy: 11, dek: 12 };

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');

/** "2023" → "2023-cü": the ordinal suffix follows the last spoken numeral (üçüncü, iyirminci, otuzuncu …). */
export function yearOrdinal(year: number): string {
  const tens = Math.floor((year % 100) / 10) * 10;
  const unit = year % 10;
  let suffix: string;
  if (unit !== 0) suffix = ({ 1: 'ci', 2: 'ci', 3: 'cü', 4: 'cü', 5: 'ci', 6: 'cı', 7: 'ci', 8: 'ci', 9: 'cu' } as Record<number, string>)[unit];
  else if (tens !== 0) suffix = ({ 10: 'cu', 20: 'ci', 30: 'cu', 40: 'cı', 50: 'ci', 60: 'cı', 70: 'ci', 80: 'ci', 90: 'cı' } as Record<number, string>)[tens];
  else suffix = year % 1000 === 0 ? 'ci' : 'ci'; // "…yüzüncü" for x00 (x00 years are not used for work periods); "iki mininci" for 2000
  return `${year}-${suffix}`;
}

export interface PeriodParts { startYear?: number; startMonth?: number; endYear?: number; endMonth?: number; present: boolean }

const monthOf = (token: string): number | undefined => {
  const f = fold(token).replace(/[^a-z]/g, '');
  if (f.length < 3) return undefined;
  return EN_MONTHS[f.slice(0, 3)] ?? AZ_MONTH_PREFIX[f.slice(0, 3)];
};

function parseSide(text: string): { year?: number; month?: number } {
  const t = text.trim();
  const iso = /^(\d{4})[-./](\d{1,2})$/.exec(t);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) >= 1 && Number(iso[2]) <= 12 ? Number(iso[2]) : undefined };
  const eu = /^(\d{1,2})[./](\d{4})$/.exec(t);
  if (eu) return { year: Number(eu[2]), month: Number(eu[1]) >= 1 && Number(eu[1]) <= 12 ? Number(eu[1]) : undefined };
  const y = /\b(19\d{2}|20\d{2})\b/.exec(t);
  if (!y) return {};
  const word = /\p{L}{3,}/u.exec(t.replace(y[0], ''));
  return { year: Number(y[1]), month: word ? monthOf(word[0]) : undefined };
}

/** Parses a free-text period; null when no year can be read (the caller then keeps the candidate's own wording). */
export function parsePeriod(raw: string): PeriodParts | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const present = /\b(present|hazırda|indi|davam edir|davam|now|current|bu gün|bugün)\b/i.test(text);
  const cleaned = text.replace(/\b(present|hazırda|indi|davam edir|davam|now|current|bu gün|bugün)\b/gi, '').trim();
  const parts = cleaned.split(/\s+(?:-|–|—|to|until|dən|-dək)\s+|\s*[–—]\s*|\s+-\s+/i).map((p) => p.trim()).filter(Boolean);
  // "2023-2024" without spaces
  const compact = parts.length === 1 ? /^(\d{4})\s*-\s*(\d{4})$/.exec(parts[0]) : null;
  const sides = compact ? [compact[1], compact[2]] : parts;
  if (!sides.length) return null;
  const a = parseSide(sides[0]);
  if (a.year === undefined) return null;
  const out: PeriodParts = { startYear: a.year, startMonth: a.month, present };
  if (sides.length >= 2) {
    const b = parseSide(sides[1]);
    if (b.year !== undefined) { out.endYear = b.year; out.endMonth = b.month; }
  }
  return out;
}

const ilin = (y: number, m?: number, form: 'abl' | 'dat' | 'loc' = 'abl') => (m ? `${yearOrdinal(y)} ilin ${MONTH_FORMS[m][form]}` : `${yearOrdinal(y)} il${form === 'abl' ? 'dən' : form === 'dat' ? 'ə' : 'də'}`);

export interface PeriodAz {
  /** The whole period as one adverbial phrase ("2023-cü ildən 2024-cü ilə qədər"); for a running role "… indiyə qədər". */
  phrase: string;
  /** "2023-cü ilin iyunundan": the start alone, for "…-dan etibarən işləyirəm". */
  started?: string;
  /** The period has an end (an ended role is written in the past tense). */
  ended: boolean;
}

/** The Azerbaijani phrase for a period, or null when it cannot be read with certainty. */
export function periodAz(raw: string): PeriodAz | null {
  const p = parsePeriod(raw);
  if (!p || p.startYear === undefined) return null;
  const started = ilin(p.startYear, p.startMonth, 'abl');
  if (p.present) return { phrase: `${started} indiyə qədər`, started, ended: false };
  if (p.endYear === undefined) {
    // One date only: when it happened.
    return { phrase: p.startMonth ? `${yearOrdinal(p.startYear)} ilin ${MONTH_FORMS[p.startMonth].loc}` : `${yearOrdinal(p.startYear)} ildə`, started, ended: true };
  }
  if (p.endYear < p.startYear || (p.endYear === p.startYear && p.endMonth && p.startMonth && p.endMonth < p.startMonth)) return null;
  const end = p.endYear === p.startYear && p.endMonth && p.startMonth
    ? MONTH_FORMS[p.endMonth].dat
    : `${yearOrdinal(p.endYear)} il${p.endMonth ? `in ${MONTH_FORMS[p.endMonth].dat}` : 'ə'}`;
  return { phrase: `${started} ${end} qədər`, started, ended: true };
}

export interface DateProblem { code: 'date_case' | 'date_ordinal' | 'date_until'; detail: string }

/**
 * Errors in how a text writes years: a bare number with a case ending ("2023-dən"), a year ordinal with the wrong vowel ("2023-ci il"), "il kimi" for "ilə qədər".
 * Only forms that are wrong in every context are reported.
 */
export function dateProblems(text: string): DateProblem[] {
  const out: DateProblem[] = [];
  const t = String(text ?? '');
  for (const m of t.matchAll(/\b((?:19|20)\d{2})-(dən|dan|də|da|ə|a|ın|in|un|ün)\b/giu)) out.push({ code: 'date_case', detail: `"${m[0]}": a year takes its ordinal first ("${yearOrdinal(Number(m[1]))} il…")` });
  for (const m of t.matchAll(/\b((?:19|20)\d{2})-(c[ıiuü])\b/giu)) {
    const want = yearOrdinal(Number(m[1])).split('-')[1];
    if (m[2].toLowerCase() !== want) out.push({ code: 'date_ordinal', detail: `"${m[0]}" should be "${yearOrdinal(Number(m[1]))}"` });
  }
  for (const m of t.matchAll(/\b(?:19|20)\d{2}-c[ıiuü]\s+il\s+kimi\b/giu)) out.push({ code: 'date_until', detail: `"${m[0]}": use "…-cü ilə qədər"` });
  // "2023-cü il tamamlamışam": the year of an event takes the locative ("2023-cü ildə"); a bare "il" is correct only before a postposition or as a noun ("2023-cü il ərzində", "2023-cü ilin").
  for (const m of t.matchAll(/\b((?:19|20)\d{2}-c[ıiuü])\s+il\s+(\p{L}+)/giu)) {
    if (/^(?:ərzində|boyu|boyunca|üçün|ilə|kimi|sonunda|əvvəlində|başında|ortasında|və|yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr|ərzində)$/iu.test(m[2])) continue;
    out.push({ code: 'date_case', detail: `"${m[0]}": the year of an event is "${m[1]} ildə"` });
  }
  return out;
}
