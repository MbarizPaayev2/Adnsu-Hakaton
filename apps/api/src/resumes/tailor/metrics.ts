/**
 * Metrics (numbers with their meaning) in generated CV and resume text. A number must stay attached to the experience it came from AND keep what it
 * measured: "30%" in one role's saved text may not become "30 clients", and a "40%" from another role may not appear in this one. Heuristics: they read
 * the unit that follows (or the currency sign before) a number; they do not understand the sentence.
 */
export type MetricKind = 'percent' | 'currency' | 'plain';
export interface Metric { n: string; kind: MetricKind }

const PERCENT = /^\s{0,2}(%|faiz|percent|процент)/iu;
const CURRENCY = /^\s{0,2}(₼|\$|€|azn\b|usd\b|eur\b|manat|dollar|доллар|руб)/iu;

export function metricsOf(text: string): Metric[] {
  const out: Metric[] = [];
  for (const m of String(text ?? '').matchAll(/\d+(?:[.,]\d+)*/g)) {
    const at = m.index ?? 0;
    const after = text.slice(at + m[0].length, at + m[0].length + 12);
    const before = text.slice(Math.max(0, at - 2), at);
    const kind: MetricKind = PERCENT.test(after) ? 'percent' : CURRENCY.test(after) || /[$€₼]\s*$/.test(before) ? 'currency' : 'plain';
    out.push({ n: m[0].replace(/[.,]/g, ''), kind });
  }
  return out;
}

export type MetricProblem = { code: 'misattributed_metric' | 'changed_metric_meaning'; n: string };

/**
 * Whether every number in `text` belongs to this experience (or project) and still means what it meant. `own` is that entry's own saved wording;
 * `loose` holds numbers that may appear in plain form because they identify the entry or a tool (dates, a "Python 3" skill).
 */
export function metricProblem(text: string, own: string[], loose: Set<string>): MetricProblem | null {
  const mine = own.flatMap(metricsOf);
  for (const m of metricsOf(text)) {
    if (mine.some((o) => o.n === m.n && o.kind === m.kind)) continue;
    if (mine.some((o) => o.n === m.n)) return { code: 'changed_metric_meaning', n: m.n };
    if (m.kind === 'plain' && loose.has(m.n)) continue;
    return { code: 'misattributed_metric', n: m.n };
  }
  return null;
}

const STOP_EN = new Set(['the', 'and', 'with', 'for', 'of', 'to', 'in', 'on', 'at', 'by', 'from', 'was', 'were', 'a', 'an', 'is']);
/** Whether a saved line is confidently in another language than the document's. Conservative: unsure means "no". */
export function looksWrongLanguage(text: string, language: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  if (words.length < 3) return false;
  const letters = (text.match(/\p{L}/gu) ?? []).length || 1;
  const cyrillic = (text.match(/[Ѐ-ӿ]/g) ?? []).length / letters;
  const azLetters = (text.match(/[əıöüçşğƏİÖÜÇŞĞ]/g) ?? []).length;
  const english = words.filter((w) => STOP_EN.has(w)).length / words.length;
  if (language === 'ru') return cyrillic < 0.3;
  if (language === 'en') return cyrillic > 0.3 || (azLetters >= 2 && english < 0.1);
  if (language === 'az' || language === 'tr') return cyrillic > 0.3 || (azLetters === 0 && english >= 0.12);
  return false;
}

const stems = (s: string, fold: (v: string) => string) => new Set((fold(s).match(/[\p{L}]{3,}/gu) ?? []).map((w) => w.slice(0, 5)));
/** Index of the bullet that says (nearly) the same thing as `source`, or -1: how much of the wording they share. */
export function nearDuplicate(bullets: string[], source: string, fold: (v: string) => string, threshold = 0.5): number {
  const a = stems(source, fold);
  let best = -1, bestScore = 0;
  bullets.forEach((b, i) => {
    const s = stems(b, fold);
    const inter = [...a].filter((x) => s.has(x)).length;
    const score = inter / Math.max(1, new Set([...a, ...s]).size);
    if (score >= threshold && score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}
