/**
 * Case endings after an abbreviation in Azerbaijani ("MMC-də", "ABB-nin", "SOCAR-da", "SEO-da").
 *
 * The vowel of the ending follows the LAST VOWEL YOU HEAR, not the last letter you see: an abbreviation read letter by letter ends in the vowel of its last
 * letter's name ("MMC": em-em-se → front → "-də"), a pronounceable one in its own last vowel ("SOCAR" → back → "-da"). Writer models regularly get this
 * wrong ("Qafqaz Hotels MMC-da"), and a word-existence check cannot see it because the abbreviation itself is a known name.
 *
 * Deliberately conservative: an abbreviation is judged only when every plausible reading agrees (Azerbaijani letter names, English letter names and, for
 * abbreviations that contain a vowel letter, the word read as written). "HR" (he-er / eych-ar) or "PR" are ambiguous in speech and are left alone, because a
 * wrong "correction" is worse than none. Only the vowel of the ending is repaired; the consonant buffers (-n-, -y-) are never touched.
 */
type Vowel = 'a' | 'ı' | 'o' | 'u' | 'ə' | 'i' | 'ö' | 'ü';

/** The vowel of each letter's NAME: Azerbaijani alphabet (be, ce, el, em, ...) and English (bee, see, el, em, ...). */
const AZ_LETTER: Record<string, Vowel> = {
  A: 'a', B: 'ə', C: 'ə', Ç: 'ə', D: 'ə', E: 'ə', Ə: 'ə', F: 'ə', G: 'ə', Ğ: 'ə', H: 'ə', X: 'ə', I: 'ı', İ: 'i', J: 'ə', K: 'ə', Q: 'ə', L: 'ə', M: 'ə', N: 'ə',
  O: 'o', Ö: 'ö', P: 'ə', R: 'ə', S: 'ə', Ş: 'ə', T: 'ə', U: 'u', Ü: 'ü', V: 'ə', W: 'ı', Y: 'ə', Z: 'ə',
};
const EN_LETTER: Record<string, Vowel> = {
  A: 'ə', B: 'i', C: 'i', D: 'i', E: 'i', F: 'ə', G: 'i', H: 'ə', I: 'ə', J: 'ə', K: 'ə', L: 'ə', M: 'ə', N: 'ə', O: 'o', P: 'i', Q: 'u', R: 'a', S: 'ə', T: 'i',
  U: 'u', V: 'i', W: 'u', X: 'ə', Y: 'i', Z: 'i',
};
/** Abbreviations that are certainly spelled out although they contain a vowel letter. */
const LETTERWISE = new Set(['ASC', 'ABB', 'ATM', 'UX', 'EU']);
const BACK = new Set<Vowel>(['a', 'ı', 'o', 'u']);
const AZ_VOWEL_LETTERS = new Set(['A', 'E', 'Ə', 'I', 'İ', 'O', 'Ö', 'U', 'Ü']);

/** Abbreviations that are read as words, not letter by letter (their own last vowel decides). */
const WORD_LIKE: Record<string, Vowel> = {
  SOCAR: 'a', ASAN: 'a', AZAL: 'a', NATO: 'o', UNICEF: 'ə', FIFA: 'a', UEFA: 'a', OPEC: 'ə', ISO: 'o', SAP: 'a', TÜİK: 'i',
  // Business abbreviations that are read with their English letter names (ending in "-ay", "-o"): KPI = key-pi-ay.
  KPI: 'i', API: 'i', GUI: 'i', UI: 'i', AI: 'i', IT: 'i', CEO: 'o', CFO: 'o', COO: 'o', CTO: 'o', SEO: 'o', SMM: 'ə', CRM: 'ə', ERP: 'ə', SQL: 'ə', CV: 'ə',
};

/** The vowel the ending must harmonise with, or null when the abbreviation is ambiguous or unknown (then nothing is judged). */
export function acronymVowel(acronym: string): Vowel | null {
  const a = acronym.toLocaleUpperCase('az');
  if (WORD_LIKE[a]) return WORD_LIKE[a];
  const letters = [...a].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 2 || letters.length > 6 || !letters.every((c) => c in AZ_LETTER)) return null;
  const last = letters[letters.length - 1];
  const az = AZ_LETTER[last], en = EN_LETTER[last] ?? az;
  if (BACK.has(az) !== BACK.has(en)) return null;
  // An abbreviation with a vowel letter may be a pronounceable word ("ASAN"): the written word's last vowel must then agree too.
  if (!LETTERWISE.has(a) && letters.some((c) => AZ_VOWEL_LETTERS.has(c))) {
    const written = [...letters].reverse().find((c) => AZ_VOWEL_LETTERS.has(c));
    if (written && BACK.has(AZ_LETTER[written]) !== BACK.has(az)) return null;
  }
  // A trailing digit is read as a word ("B2B" → be-iki-be): not judged.
  if (/\d/.test(a)) return null;
  return az;
}

const twoWay = (v: Vowel) => (BACK.has(v) ? 'a' : 'ə');
const fourWay = (v: Vowel) => (v === 'a' || v === 'ı' ? 'ı' : v === 'ə' || v === 'i' ? 'i' : v === 'o' || v === 'u' ? 'u' : 'ü');

/** Case/plural/derivation endings after an abbreviation, as written after the hyphen (a plain "e" is the Turkish-style spelling of "ə"). */
const ENDING = /^(d[aəe]n?|d[aəe]k[ıiuü]|[aəe]|y[aəe]|l[aəe]r?|[ıiuü]n|n[ıiuü]n|n[ıiuü]|[ıiuü]|ç[ıiuü]|l[ıiuü])$/u;

/** The same ending with its vowels set by harmony to `vowel` (consonants, buffers and ending shape unchanged). */
export function harmonised(ending: string, vowel: Vowel): string {
  return [...ending].map((ch) => {
    if (ch === 'a' || ch === 'ə' || ch === 'e') return twoWay(vowel);
    if (ch === 'ı' || ch === 'i' || ch === 'u' || ch === 'ü') return fourWay(vowel);
    return ch;
  }).join('');
}

export interface AcronymIssue { token: string; expected: string }

/** Repairs the vowel of endings written after an abbreviation. `issues` lists what was changed (for the trace and the candidate's review). */
export function repairAcronymEndings(text: string): { text: string; issues: AcronymIssue[] } {
  const issues: AcronymIssue[] = [];
  const out = String(text ?? '').replace(/(?<![\p{L}\p{N}])([\p{Lu}][\p{Lu}\d]{1,6})([-’'])([\p{Ll}]{1,5})(?![\p{L}])/gu, (whole, acronym: string, sep: string, ending: string) => {
    if (!ENDING.test(ending)) return whole;
    const vowel = acronymVowel(acronym);
    if (!vowel) return whole;
    const fixed = harmonised(ending, vowel);
    if (fixed === ending) return whole;
    const token = `${acronym}${sep}${fixed}`;
    issues.push({ token: whole, expected: token });
    return token;
  });
  return { text: out, issues };
}

/** Same judgement without changing the text: the endings that are wrong after an abbreviation. */
export function acronymEndingProblems(text: string): AcronymIssue[] {
  return repairAcronymEndings(text).issues;
}

