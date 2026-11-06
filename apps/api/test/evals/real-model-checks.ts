/**
 * Automatic, offline checks used by the real-model evaluation. They FLAG things for a human reviewer; they are not a quality verdict.
 * Pure functions with a self-test (`--self-test`) that needs no provider and no network.
 */
import type { Persona } from '../../src/resumes/tailor/resume-tailor.types';
import type { EvalLanguage } from './real-model-fixtures';
import { fold } from '../../src/resumes/tailor/tailor-facts';
import { personalClaim, SKILL_LIST_THRESHOLD, skillsInSentence, wordCount } from '../../src/resumes/tailor/letter-style';

const flatten = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => flatten(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => flatten(x, out));
  return out;
};
const norm = (s: string) => s.normalize('NFKC').toLowerCase();
const tokens = (s: string) => norm(s).match(/[\p{L}\p{N}][\p{L}\p{N}+#.%-]*/gu) ?? [];

/** Every word and number the candidate (or the vacancy, for the company/position being applied to) supplied. */
export function allowedVocabulary(persona: Persona, extra: string[] = []): Set<string> {
  return new Set([...flatten(persona), ...extra].flatMap(tokens));
}

/** Numbers and capitalised names in the output that appear nowhere in the candidate's facts: candidates for a fabrication, to be judged by a human. */
export function unsupportedTokens(output: string, allowed: Set<string>) {
  const numbers = [...new Set((output.match(/\d[\d.,%-]*/g) ?? []).map(norm))].filter((n) => !allowed.has(n) && !tokens(n).every((t) => allowed.has(t)));
  const names = [...new Set((output.match(/(?<![.!?]\s)(?<!^)\b[\p{Lu}][\p{L}]{2,}\b/gu) ?? []).map(norm))].filter((n) => !allowed.has(n));
  return { numbers, names };
}

/** Skills the vacancy wants but the candidate does not have, found in the output (a claimed skill the candidate never stated). */
export function claimedTraps(output: string, trap: string[]): string[] {
  const text = norm(output);
  return trap.filter((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${norm(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(text));
}

const AZ_LETTERS = /[əıöüçşğƏİÖÜÇŞĞ]/g;
const CYRILLIC = /[Ѐ-ӿ]/g;
const LATIN = /\p{Script=Latin}/gu;
const EN_STOP = /\b(the|and|with|for|of|to|in|on|at|is|was|my|i|that)\b/gi;

/** Does the text look like the requested language? A coarse script/stop-word check; wording quality needs a human reader. */
export function languageLooksRight(text: string, language: EvalLanguage) {
  const letters = (text.match(/\p{L}/gu) ?? []).length || 1;
  const cyr = (text.match(CYRILLIC) ?? []).length / letters;
  const lat = (text.match(LATIN) ?? []).length / letters;
  const az = (text.match(AZ_LETTERS) ?? []).length;
  const en = (text.match(EN_STOP) ?? []).length;
  if (language === 'ru') return { ok: cyr > 0.5, detail: `cyrillic ${(cyr * 100).toFixed(0)}%` };
  if (language === 'en') return { ok: lat > 0.8 && cyr < 0.05 && en >= 3, detail: `latin ${(lat * 100).toFixed(0)}%, english stop-words ${en}` };
  return { ok: lat > 0.8 && cyr < 0.05 && az >= 2, detail: `latin ${(lat * 100).toFixed(0)}%, Azerbaijani letters ${az}` };
}

/** Share of the candidate's skills that the vacancy mentions and the output also mentions (relevance, not truth). */
export function relevanceCoverage(output: string, persona: Persona, jobText: string) {
  const out = norm(output);
  const wanted = persona.skills.flatMap((s) => s.keywords).filter((k) => norm(jobText).includes(norm(k)));
  const present = wanted.filter((k) => out.includes(norm(k)));
  return { wanted, present, ratio: wanted.length ? present.length / wanted.length : 1 };
}

/**
 * Flags for a human reader of Azerbaijani text. They come from the AI engineer's wording guidance and from the prompt's own rules; they catch mechanical
 * slips (a banned word, a repeated contrast, a half-finished sentence). They CANNOT say whether the text sounds natural: an independent reader must.
 */
export function azStyleFlags(text: string): string[] {
  const flags: string[] = [];
  const t = text.normalize('NFC');
  const has = (re: RegExp) => (t.match(re) ?? []).length;
  if (has(/\bdoğal\w*/giu)) flags.push('uses "doğal" (guidance prefers "təbii")');
  if (has(/\bnet oldu\b/giu)) flags.push('"net oldu" (guidance prefers "aydın oldu")');
  if (has(/\breal\s+\p{L}+/giu)) flags.push('"real" used as an adjective (guidance prefers canlı / əsl / konkret)');
  if (has(/həvəsi hiss/giu)) flags.push('"həvəsi hiss etdim" (guidance prefers "həvəsim artdı")');
  if (has(/\bbunu etmək\b|\bbunun üzərində işləmək\b/giu)) flags.push('vague action ("bunu etmək"): name the action');
  if (has(/\b\p{L}+ yox \p{L}+/giu) > 1) flags.push('the "X yox Y" contrast is used more than once');
  if (has(/:/g) > 1) flags.push('more than one colon');
  const sentences = t.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const starts = sentences.map((x) => fold(x.split(/\s+/)[0] ?? ''));
  for (const c of ['cunki', 'amma', 'lakin', 'hemcinin', 'buna gore']) if (starts.filter((x) => c.startsWith(x) && x.length >= 4).length >= 3) flags.push(`"${c}" starts three or more sentences`);
  if (sentences.some((x) => !/[.!?…»"”)]$/.test(x))) flags.push('a sentence has no ending punctuation (possibly unfinished)');
  return flags;
}

/** Personal statements that survived the product's own guard (it should have removed any the candidate did not state), judged against the candidate's own text. */
export function survivingPersonalClaims(text: string, candidateText: string, language: string): string[] {
  const own = candidateText.split(/(?<=[.!?])\s+|\n+/).map((x) => fold(x)).filter(Boolean);
  return text.split(/(?<=[.!?])\s+|\n+/).map((x) => personalClaim(fold(x), own, language)).filter((x): x is string => !!x);
}

export const skillDumpSentences = (text: string, skills: string[]) =>
  text.split(/(?<=[.!?])\s+|\n+/).filter((x) => skillsInSentence(x, skills, fold).length >= SKILL_LIST_THRESHOLD);

export const answerWords = (paragraphs: string[]) => paragraphs.reduce((n, p) => n + wordCount(p), 0);

const FILLER_WORDS = /(responsible for|accomplished|measured by|by demonstrating|leveraging|utili[sz]ing|duties included|various tasks|mesul (idi|olmusam)|muxtelif tapsiriq|отвечал[аи]? за|различные задачи)/;
const numbersOf = (t: string) => (t.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ''));

/** Mechanical measures of a generated CV or resume against the candidate's own facts. Nothing here judges whether a bullet is specific or well written. */
export function documentMetrics(content: any, persona: Persona) {
  const bullets: string[] = (content.experience ?? []).flatMap((e: any) => e.highlights ?? []);
  const outText = `${content.summary ?? ''} ${bullets.join(' ')} ${(content.projects ?? []).map((p: any) => `${p.description ?? ''} ${p.result ?? ''}`).join(' ')}`;
  const sourceNumbers = [...new Set(persona.experience.flatMap((e) => e.highlights).flatMap(numbersOf))];
  const outNumbers = new Set(numbersOf(outText));
  const keywords = persona.skills.flatMap((s) => s.keywords);
  const outSkills = new Set((content.skills ?? []).flatMap((s: any) => s.keywords ?? []).map((k: string) => fold(k)));
  const skills = (content.skills ?? []).flatMap((s: any) => s.keywords ?? []);
  return {
    rolesKept: persona.experience.filter((e) => (content.experience ?? []).some((c: any) => fold(c.company) === fold(e.company))).length,
    rolesInMaster: persona.experience.length,
    bullets: bullets.length,
    bulletsPerRole: (content.experience ?? []).map((e: any) => (e.highlights ?? []).length),
    avgBulletWords: bullets.length ? Math.round(bullets.reduce((n, b) => n + wordCount(b), 0) / bullets.length) : 0,
    sourceMetricsKept: `${sourceNumbers.filter((n) => outNumbers.has(n)).length}/${sourceNumbers.length}`,
    inventedNumbers: [...outNumbers].filter((n) => !new Set(allowedVocabularyNumbers(persona)).has(n)),
    fillerBullets: bullets.filter((b) => FILLER_WORDS.test(fold(b))).length,
    skillDumpSentences: [content.summary ?? '', ...bullets].filter((b: string) => skillsInSentence(b, keywords, fold).length >= SKILL_LIST_THRESHOLD).length,
    skillsKeptVerbatim: `${keywords.filter((k) => outSkills.has(fold(k))).length}/${keywords.length}`,
    skillsListed: skills.length,
    projectsInDoc: (content.projects ?? []).length,
    certificationsInDoc: (content.certifications ?? []).length,
  };
}
const allowedVocabularyNumbers = (persona: Persona) => flatten(persona).flatMap(numbersOf);

/** A readable plain-text rendering of a generated document, for the blind side-by-side review sheet. */
export function contentToText(content: any): string {
  if (content.kind === 'LETTER') return (content.paragraphs ?? []).map((p: any) => p.text).join('\n\n');
  const out: string[] = [];
  if (content.headline || content.basics?.headline) out.push(content.basics?.headline ?? content.headline);
  if (content.summary) out.push(content.summary);
  for (const e of content.experience ?? []) out.push(`${e.position} — ${e.company} (${e.period})\n${(e.highlights ?? []).map((h: string) => `• ${h}`).join('\n')}`);
  for (const p of content.projects ?? []) out.push(`${p.name}: ${p.description ?? ''}`);
  return out.join('\n\n');
}

export function selfTest() {
  const assert = (c: unknown, m: string) => { if (!c) throw new Error(`self-test failed: ${m}`); };
  const persona = { basics: { name: 'Leyla' }, experience: [{ company: 'Qafqaz Labs', highlights: ['Sorğu vaxtını 40% azaltdı'] }], skills: [{ keywords: ['PostgreSQL', 'Docker'] }] } as unknown as Persona;
  const allowed = allowedVocabulary(persona);
  const honest = 'Leyla Qafqaz Labs şirkətində sorğu vaxtını 40% azaltdı. PostgreSQL və Docker ilə işləyir.';
  const invented = 'Leyla əvvəl Google şirkətində işləyib və gəliri 45% artırıb. Kubernetes idarə edir.';
  const a = unsupportedTokens(honest, allowed);
  const b = unsupportedTokens(invented, allowed);
  assert(a.numbers.length === 0 && a.names.length === 0, `honest text flagged: ${JSON.stringify(a)}`);
  assert(b.numbers.includes('45%') && b.names.includes('google'), `invention not flagged: ${JSON.stringify(b)}`);
  assert(claimedTraps(invented, ['Kubernetes', 'Go']).join() === 'Kubernetes', 'trap not detected, or "Go" matched inside another word');
  assert(claimedTraps(honest, ['Kubernetes']).length === 0, 'trap false positive');
  assert(languageLooksRight('Привет, меня зовут Анна и я работаю с клиентами.', 'ru').ok, 'ru');
  assert(!languageLooksRight('Hello, I work with the data and the team.', 'ru').ok, 'en accepted as ru');
  assert(languageLooksRight('I work with the data and I enjoy the team at my office.', 'en').ok, 'en');
  assert(languageLooksRight('Hesabat sistemlərini sürətləndirməyi sevirəm və şirkətinizə töhfə verə bilərəm.', 'az').ok, 'az');
  assert(relevanceCoverage(honest, persona, 'PostgreSQL və Docker tələb olunur').ratio === 1, 'coverage');
  assert(azStyleFlags('Bu daha doğal gəldi. real məhsul. Onda başa düşdüm ki a yox b. Sonra c yox d. də elə').length >= 4, 'az flags');
  assert(azStyleFlags('Bir layihədə birinci alışdan sonra adamların getdiyini gördüm. Bunu yoxladım.').length === 0, 'az clean text flagged');
  const claimText = 'Bu işi çox sevirəm.';
  assert(survivingPersonalClaims(claimText, 'Mən backend yazıram.', 'az').length === 1, 'personal claim not seen');
  assert(survivingPersonalClaims(claimText, 'Sorğuları sürətləndirməyi sevirəm.', 'az').length === 1, 'a feeling about another subject supported the claim');
  assert(survivingPersonalClaims(claimText, 'Bu işi sevirəm.', 'az').length === 0, 'candidate-stated claim flagged');
  assert(skillDumpSentences('NestJS, PostgreSQL, TypeScript və Docker bilirəm. Docker ilə işləmişəm.', ['NestJS', 'PostgreSQL', 'TypeScript', 'Docker']).length === 1, 'skill dump');
  const doc = { summary: 'Backend mühəndisi.', experience: [{ company: 'Qafqaz Labs', highlights: ['Sorğu vaxtını 40% azaltdı', 'Responsible for NestJS, PostgreSQL, TypeScript və Docker'] }], skills: [{ keywords: ['PostgreSQL'] }], projects: [], certifications: [] };
  const m = documentMetrics(doc, { experience: [{ company: 'Qafqaz Labs', highlights: ['Sorğu vaxtını 40% azaltdı'] }, { company: 'Xəzər', highlights: ['İş 7 gün çəkirdi'] }], skills: [{ keywords: ['NestJS', 'PostgreSQL', 'TypeScript', 'Docker'] }] } as unknown as Persona);
  assert(m.rolesKept === 1 && m.rolesInMaster === 2, 'roles kept');
  assert(m.sourceMetricsKept === '1/2', 'metrics kept ' + m.sourceMetricsKept);
  assert(m.fillerBullets === 1 && m.skillDumpSentences === 1, 'filler/dump');
  assert(contentToText({ kind: 'LETTER', paragraphs: [{ text: 'a' }, { text: 'b' }] }) === 'a\n\nb', 'letter text');
  return 'self-test passed (flags an invented employer/number and a claimed missing skill; no false alarm on honest text)';
}
