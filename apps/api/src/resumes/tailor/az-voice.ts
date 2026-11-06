/**
 * Grammatical person of Azerbaijani sentences, deterministic.
 *
 * A candidate writes about their own work in the first person ("hazırladım", "edirəm"). Models and CV templates drift to the third person ("hazırladı", "edir"),
 * which reads as someone else's profile. These helpers find the clause-final finite verb (the verb closes its clause in Azerbaijani), say which person it is in, and
 * convert a regular third-person form to the first person. A form that is not certainly a personal action (passives, "oldu", "azaldı", nouns that end like a verb)
 * is left exactly as written.
 */

/** Nouns that end in -ıb/-ib/-ub/-üb and are not a third-person verb ("sahib", "qalib", "tərtib", "cənub", "ədib", "təbib"). Compared exactly, with diacritics. */
export const NOT_A_VERB_IB = new Set(['sahib', 'qalib', 'tərtib', 'cənub', 'ədib', 'təbib', 'katib', 'naib', 'rahib', 'həbib', 'mənsub', 'müntəxib', 'nəqib', 'tələb', 'qərib', 'müəllib']);

/** Nouns that end like a present-tense verb (-ır/-ir/-ur/-ür) or a past-tense verb (-dı/-di/-du/-dü). */
const NOT_A_VERB_PRESENT = new Set(['müdir', 'kassir', 'tədbir', 'şair', 'əmir', 'vəzir', 'təsir', 'ünsür', 'nəzir', 'təqdir', 'təfsir', 'təhrir', 'təsvir', 'qadir', 'xeyir', 'təmir', 'şəhər', 'təkrar', 'sıfır', 'sahir', 'fakir', 'həkir', 'gəlir', 'sətir', 'fikir', 'dair']);
const NOT_A_VERB_PAST = new Set(['qədi', 'sədi', 'ədədi', 'mədi', 'vədi', 'bədi', 'hədi', 'ədli']);

/** Past-tense forms whose subject is not the candidate (passive, result or state verbs): never turned into "I did". */
const NOT_A_PERSONAL_ACTION = /(?:ldı|ldi|ldu|ldü|ndı|ndi|ndu|ndü|oldu|artdı|düşdü|bitdi|başladı|çatdı|yarandı|göründü|qaldı|çıxdı|doğuldu)$/u;

const VOWELS = 'aıoueəiöü';
const lastVowel = (w: string) => { for (let i = w.length - 1; i >= 0; i--) if (VOWELS.includes(w[i])) return w[i]; return 'a'; };

/** "alıb" → "almışam", "edib" → "etmişəm", "başlayıb" → "başlamışam"; null when the word is not a regular third-person perfect. */
export function firstPersonPerfect(word: string): string | null {
  const m = /^(\p{Ll}{2,}?)(y?)(ıb|ib|ub|üb)$/u.exec(word);
  if (!m || NOT_A_VERB_IB.has(word)) return null;
  let stem = m[1];
  // "başla" + "yıb": the buffer y belongs to the ending only after a vowel.
  if (m[2] && !VOWELS.includes(stem[stem.length - 1])) stem += m[2];
  if (stem.length < 2) return null;
  // Not repaired: "ol-" ("səlahiyyəti olmayıb" / "olub" is about a possessed thing, not an action of the candidate) and negatives (-ma/-mə- before the ending):
  // the draft is rejected and written again instead of being turned into a wrong sentence.
  if (/^ol(?:ma|mə)?$/.test(stem) || /(?:ma|mə)$/.test(stem)) return null;
  // The verbs et- and get- are written with d before a vowel ending: edib, gedib.
  if (/^(?:ed|ged)$/.test(stem)) stem = stem.slice(0, -1) + 't';
  const v = lastVowel(stem);
  const participle = v === 'a' || v === 'ı' ? 'mış' : v === 'o' || v === 'u' ? 'muş' : v === 'ö' || v === 'ü' ? 'müş' : 'miş';
  // -mış/-muş take -am; -miş/-müş take -əm.
  return `${stem}${participle}${participle === 'mış' || participle === 'muş' ? 'am' : 'əm'}`;
}

export type FiniteForm = { person: 'first' | 'third'; tense: 'past' | 'present' | 'perfect' };

/** The person and tense of ONE word when it is a regular finite verb form; null for everything else (nouns, converbs, passives, names). */
/** Very common short verbs (and the light verb et-/ed- of "təqdim etdi", "tərcümə edir"): too short for the suffix rules below, certain as whole words. */
const SHORT_THIRD: Record<string, FiniteForm['tense']> = { etdi: 'past', edir: 'present', edib: 'perfect', aldı: 'past', alır: 'present', verdi: 'past', verir: 'present', qurdu: 'past', görür: 'present', gördü: 'past', yazdı: 'past', yazır: 'present', açdı: 'past', açır: 'present', tutdu: 'past', tutur: 'present' };

export function finiteForm(raw: string): FiniteForm | null {
  const w = raw.toLowerCase();
  if (SHORT_THIRD[w]) return { person: 'third', tense: SHORT_THIRD[w] };
  if (w.length < 4 || /\d/.test(w)) return null;
  // first person: -dım/-dim/-dum/-düm (+ -ırdım …), -ıram/-irəm/-uram/-ürəm, -mışam/-mişəm …
  if (/\p{Ll}{2,}(?:d[ıiuü]m)$/u.test(w)) return { person: 'first', tense: 'past' };
  if (/\p{Ll}{2,}(?:[ıu]ram|[iü]rəm)$/u.test(w)) return { person: 'first', tense: 'present' };
  if (/\p{Ll}{2,}(?:m[ıu]şam|m[iü]şəm)$/u.test(w)) return { person: 'first', tense: 'perfect' };
  // third person
  if (/\p{Ll}{2,}(?:d[ıiuü])$/u.test(w) && w.length >= 5) {
    if (NOT_A_VERB_PAST.has(w) || NOT_A_PERSONAL_ACTION.test(w)) return null;
    return { person: 'third', tense: 'past' };
  }
  if (/\p{Ll}{3,}(?:[ıiuü]r)$/u.test(w) && w.length >= 5) {
    if (NOT_A_VERB_PRESENT.has(w)) return null;
    // passive / reflexive ("olunur", "edilir", "görünür", "bilinir": the subject is not the candidate) and the copula -dır/-dir/-dur/-dür ("vacibdir", "uyğundur")
    if (/(?:[ıiuü]l|[ıiuü]n)[ıiuü]r$/u.test(w) || /[dt][ıiuü]r$/u.test(w)) return null;
    // a plural or possessive noun ("sənədlər", "hesabatlar") ends in -lər/-lar, not in -ir: only vowel + r after a consonant counts
    if (/[ıiuü]r$/.test(w) && /(?:lər|lar)$/.test(w)) return null;
    return { person: 'third', tense: 'present' };
  }
  if (/\p{Ll}{2,}(?:[ıiuü]b)$/u.test(w) && !NOT_A_VERB_IB.has(w)) return { person: 'third', tense: 'perfect' };
  return null;
}

/** Third-person → first-person form of one word; null when it is not a regular third-person verb. */
export function toFirstPersonWord(word: string): string | null {
  const f = finiteForm(word);
  if (!f || f.person !== 'third') return null;
  const w = word;
  const lw = w.toLowerCase();
  if (f.tense === 'perfect') return lw === 'edib' ? 'etmişəm' : firstPersonPerfect(lw);
  if (f.tense === 'past') return `${w}m`; // -dı → -dım, -di → -dim, -du → -dum, -dü → -düm
  // present: -ır → -ıram, -ir → -irəm, -ur → -uram, -ür → -ürəm
  const ending = lw.slice(-2);
  const add = ending === 'ır' || ending === 'ur' ? 'am' : 'əm';
  return `${w}${add}`;
}

/** Splits into clauses and returns each clause's last word with its index in the text. */
function clauseFinals(text: string): { word: string; start: number; end: number }[] {
  const out: { word: string; start: number; end: number }[] = [];
  const re = /[^,;:.!?\n]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const clause = m[0];
    // " və " joins two predicates: each part has its own final verb
    const parts: { s: number; e: number }[] = [];
    let from = 0;
    for (const j of clause.matchAll(/\s(?:və|və\s+ya|ya\s+da)\s/giu)) { parts.push({ s: from, e: j.index! }); from = j.index! + j[0].length - 1; }
    parts.push({ s: from, e: clause.length });
    for (const p of parts) {
      const seg = clause.slice(p.s, p.e);
      const w = /(\p{L}[\p{L}\p{M}'’-]*)\s*$/u.exec(seg);
      if (w) out.push({ word: w[1], start: m.index + p.s + w.index, end: m.index + p.s + w.index + w[1].length });
    }
  }
  return out;
}

/** 'first' (some clause ends in a first-person verb, none in a third-person one), 'third', 'mixed', or 'none' (no finite verb: a noun phrase). */
export function bulletVoice(text: string): 'first' | 'third' | 'mixed' | 'none' {
  const persons = new Set<string>();
  for (const f of clauseFinals(String(text ?? ''))) { const form = finiteForm(f.word); if (form) persons.add(form.person); }
  if (persons.has('first') && persons.has('third')) return 'mixed';
  if (persons.has('first')) return 'first';
  if (persons.has('third')) return 'third';
  return 'none';
}

/** Turns every clause-final regular third-person verb into the first person. `changed` lists what was converted; a bullet already in the first person is unchanged. */
export function toFirstPersonText(text: string): { text: string; changed: { from: string; to: string }[] } {
  const src = String(text ?? '');
  const finals = clauseFinals(src);
  const changed: { from: string; to: string }[] = [];
  let out = '';
  let pos = 0;
  for (const f of finals) {
    const to = toFirstPersonWord(f.word);
    if (!to) continue;
    out += src.slice(pos, f.start) + to;
    pos = f.end;
    changed.push({ from: f.word, to });
  }
  out += src.slice(pos);
  return { text: out, changed };
}

/** The tense of a first-person verb: 'imperfect' ("yoxlayırdım", used to), 'past' ("yoxladım"), 'present' ("yoxlayıram"), 'perfect' ("yoxlamışam"); null for anything else. */
export function firstPersonTense(word: string): 'imperfect' | 'past' | 'present' | 'perfect' | null {
  const w = word.toLowerCase();
  if (/\p{Ll}{2,}[ıiuü]rd[ıiuü]m$/u.test(w)) return 'imperfect';
  if (/\p{Ll}{2,}d[ıiuü]m$/u.test(w)) return 'past';
  if (/\p{Ll}{2,}(?:[ıu]ram|[iü]rəm)$/u.test(w)) return 'present';
  if (/\p{Ll}{2,}(?:m[ıu]şam|m[iü]şəm)$/u.test(w)) return 'perfect';
  return null;
}

/** The tenses of the clause-final first-person verbs of a bullet, in order. */
export function bulletTenses(text: string): string[] {
  return clauseFinals(String(text ?? '')).map((f) => firstPersonTense(f.word)).filter((t): t is NonNullable<ReturnType<typeof firstPersonTense>> => t !== null);
}

/** The last word of each clause, in order (the verb of the clause in Azerbaijani). */
export const clauseFinalTokens = (text: string): string[] => clauseFinals(String(text ?? '')).map((f) => f.word);

/** "çatdırırdım" (used to deliver) → "çatdırdım" (delivered): the habitual past with its -ır- removed. True when `after` is `before` turned into the simple past. */
export const imperfectToPast = (before: string, after: string): boolean => {
  const b = before.toLowerCase(), a = after.toLowerCase();
  return /[ıiuü]rd[ıiuü]m$/.test(b) && a === b.replace(/[ıiuü]r(d[ıiuü]m)$/, '$1');
};
