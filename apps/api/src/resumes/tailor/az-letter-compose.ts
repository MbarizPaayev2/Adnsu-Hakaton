import type { Persona, TailorJobInput } from './resume-tailor.types';
import { letterEvidence, type KindedEvidence } from './az-writer';
import { cleanDisplayRole, isNegatedStatement, stems, vacancyRequirements, vacancyEvidenceScore } from './az-compose';
import { periodAz } from './az-dates';
import { toFirstPersonText } from './az-voice';
import { fold } from './az-rewrite';

/**
 * Requirement links and the composed (no-model) letter, version 2.
 *
 * Founder review, 11 October 2026: the composed letter listed facts after a template ("Təcrübəmdən nümunələr: …"), answered a degree requirement with a certificate and
 * wrote years with wrong case endings. Here a requirement is paired only with evidence of the right KIND, dates come from az-dates.ts, and the candidate's facts are told
 * as sentences about the role (employer, position, time) in the first person. Everything else is the candidate's own wording, verbatim. Nothing is invented: a reason for
 * the role or the employer appears only when the candidate wrote one.
 */

const DEGREE_WORDS = /\b(?:ali\s+təhsil|ali\s+təhsilli|bakalavr|magistr|universitet|təhsil\s+səviyyəsi|diplom|orta\s+ixtisas)/iu;
const CERT_WORDS = /\b(?:sertifikat|kurs|təlim|lisenziya|attestat|training|certificate|course)/iu;
const TOOL = (text: string) => new Set(fold(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && w.length <= 4 && /[a-z]/.test(w) && !/^(ve|ile|ucun|bir|her|bu|ya|da|de|ki|en)$/.test(w)));

export interface RequirementLink { requirement: string; evidenceId: string }

/**
 * Pairs requirement lines with the evidence that bears on them (at most `max`, each evidence and requirement once). A requirement that asks for a degree is answered
 * only by education; a certificate answers only a requirement that is about a certificate, course or training, or one that no other evidence can answer by shared words.
 */
export function linkRequirements(requirements: string[], evidence: KindedEvidence[], max = 3): RequirementLink[] {
  const out: RequirementLink[] = [];
  const used = new Set<string>();
  const candidates = requirements.map((requirement) => {
    const reqStems = stems(requirement);
    const reqTools = TOOL(requirement);
    const wantsDegree = DEGREE_WORDS.test(requirement);
    const wantsCert = CERT_WORDS.test(requirement);
    const best = evidence
      .filter((e) => !isNegatedStatement(e.text))
      .filter((e) => (wantsDegree ? e.kind === 'education' : e.kind !== 'education' || /təhsil|universitet|bakalavr|magistr/iu.test(requirement)))
      .filter((e) => (e.kind === 'certificate' ? wantsCert || !wantsDegree : true))
      .map((e) => {
        const text = `${e.text} ${e.role ?? ''}`;
        const shared = [...stems(text)].filter((s) => reqStems.has(s)).length + [...TOOL(text)].filter((t) => reqTools.has(t)).length;
        // A certificate that only shares a word with a vacancy line is weaker than a job highlight that does.
        return { e, shared, weight: shared - (e.kind === 'certificate' && !wantsCert ? 0.5 : 0) };
      })
      .sort((a, b) => b.weight - a.weight)[0];
    // Education answers a degree requirement on the subject area alone ("Əczaçılıq üzrə ali təhsil" + area "Əczaçılıq"): one shared stem is enough there.
    const need = wantsDegree ? 1 : 2;
    const ok = best && best.shared >= need && best.shared / Math.max(1, reqStems.size + reqTools.size) >= (wantsDegree ? 0.2 : 0.34);
    return { requirement, best: ok ? best : null };
  });
  const ranked = candidates.filter((x) => x.best).sort((a, b) => b.best!.weight - a.best!.weight);
  // The qualification answering a degree requirement is always kept, whatever else ranks higher.
  const degree = ranked.find((c) => c.best!.e.kind === 'education');
  for (const c of ranked) {
    if (used.has(c.best!.e.id)) continue;
    if (out.length >= max - (degree && c !== degree && !out.includes(degree as never) ? 1 : 0) && c !== degree) continue;
    used.add(c.best!.e.id);
    out.push({ requirement: c.requirement, evidenceId: c.best!.e.id });
    if (out.length >= max) break;
  }
  if (degree && !out.some((l) => l.evidenceId === degree.best!.e.id) && !used.has(degree.best!.e.id)) out.push({ requirement: degree.requirement, evidenceId: degree.best!.e.id });
  return out;
}

/**
 * Product, platform and tool names keep their capital inside a sentence ("Instagram səhifəsi", not "ınstagram"). A word starting with a Latin
 * capital I is never lowered either: in Azerbaijani it would become the dotless "ı" ("Instagram" → "ınstagram"), which is almost always a
 * foreign name; ordinary Azerbaijani words start with the dotted "İ".
 */
const KEEP_CAPITAL = new Set([
  'instagram', 'facebook', 'tiktok', 'telegram', 'whatsapp', 'youtube', 'linkedin', 'google', 'twitter', 'excel', 'word', 'powerpoint', 'outlook',
  'canva', 'figma', 'photoshop', 'illustrator', 'python', 'java', 'javascript', 'typescript', 'react', 'angular', 'docker', 'linux', 'windows',
  'android', 'jira', 'trello', 'notion', 'shopify', 'wordpress', 'salesforce', 'oracle', 'cisco', 'microsoft', 'apple', 'amazon', 'zoom', 'slack',
]);
const ordinaryWord = (w: string) => /^\p{Lu}\p{Ll}+$/u.test(w) && !w.startsWith('I') && !KEEP_CAPITAL.has(w.toLowerCase());

/** Lower-cases the first letter of ordinary capitalised words only: "Əczaçı köməkçisi" → "əczaçı köməkçisi", but "IT dəstək mütəxəssisi" and "Senior Developer" keep their capitals ("IT".toLowerCase('az') would give the dotless "ıt"). */
export const plainCase = (text: string): string => String(text ?? '').split(/(\s+)/).map((w) => (ordinaryWord(w) ? w[0].toLocaleLowerCase('az') + w.slice(1) : w)).join('');
const cap = (s: string) => (s ? s[0].toLocaleUpperCase('az') + s.slice(1) : s);
const trimEnd = (s: string) => s.replace(/[\s.;:,!?…]+$/u, '').trim();

/** Lower-cases the first letter only when the first word is certainly an ordinary word (not a tool, a name or an abbreviation). */
function lowerFirstIfPlain(text: string): string | null {
  const first = /^(\p{L}+)(?![\p{L}\p{N}-])/u.exec(text);
  if (!first) return null;
  const w = first[1];
  if (!ordinaryWord(w)) return null;
  return text[0].toLocaleLowerCase('az') + text.slice(1);
}

const AWARD_SEGMENT = /^(?:outstanding\s+contributor|top\s+\d+%?|fellow|scholar|winner|award(?:ee)?|honors?|dean'?s\s+list|mükafatçı?|fəxri\s+fərman|qızıl\s+medal|diplomant|intern(?:ship)?|təcrübəçi|əla\s+töhfəçi|fəal\s+töhfəçi)$/iu;

/** Strips awards, fellowships and non-employer qualifiers from employer strings. */
export function cleanEmployerName(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const parts = s.split(/\s*[,|;]\s*/).map((p) => p.trim()).filter(Boolean);
  const nonAward = parts.filter((p) => !AWARD_SEGMENT.test(p));
  const chosen = (nonAward.length > 0 ? nonAward : parts).join(', ');
  return chosen.replace(/\s+/g, ' ').trim();
}

/** "where" for an employer: the case ending is added only where it is certain; a school is not a "şirkət", and an unknown kind of organisation stays neutral. */
const ORG_LOCATIVE: [RegExp, string][] = [
  [/Məktəbi$/u, 'Məktəbində'], [/Universiteti$/u, 'Universitetində'], [/Kolleci$/u, 'Kollecində'], [/Liseyi$/u, 'Liseyində'], [/Xəstəxanası$/u, 'Xəstəxanasında'],
  [/Xəstəxana$/u, 'Xəstəxanasında'], [/Bankı$/u, 'Bankında'], [/Klinikası$/u, 'Klinikasında'], [/Hospitalı$/u, 'Hospitalında'],
];
const LEGAL_FORM = /(?:^|\s)(?:MMC|ASC|QSC|ASC-|LLC|Ltd|Inc|Holding|Group|Qrup|Şirkəti|Şirkət|Korporasiya|Cəmiyyəti)(?:\s|$)/iu;
export function inOrganisation(name: string): string {
  const n = cleanEmployerName(name);
  if (!n) return '';
  for (const [re, to] of ORG_LOCATIVE) if (re.test(n)) return n.replace(re, to);
  return LEGAL_FORM.test(n) ? `${n} şirkətində` : `${n} təşkilatında`;
}

const roleParts = (e: KindedEvidence) => {
  if (e.position !== undefined || e.company !== undefined) {
    const rawPos = e.position || '';
    const cleanPos = rawPos.replace(/\s*[,|;]\s*(?:outstanding\s+contributor|əla\s+töhfəçi|fəal\s+töhfəçi).*$/iu, '').trim();
    return {
      position: cleanPos || rawPos,
      company: cleanEmployerName(e.company || ''),
    };
  }
  const [position, ...rest] = String(e.role ?? '').split(',').map((x) => x.trim());
  const company = cleanEmployerName(rest.join(', '));
  return { position: position ?? '', company };
};

const GENERIC_COMMUNICATION_RE = /\b(?:(?:güclü|effektiv|yaxşı|şifahi|yazılı|fəal|peşəkar|aydın)?\s*(?:ünsiyyət|kommunikasiya)\s*(?:bacarıqlar[ıi]|qabiliyyət[ıi]|əlaqələr[ıi]|qura\s+bilirəm)?|müştəri(?:\s+və\s+ya\s+həmkarlarla)?\s+aydın\s+ünsiyyət|strong\s+communication\s+skills?|excellent\s+communication|cross-functional\s+communication)\b/iu;

function isGenericCommunicationClaim(text: string): boolean {
  const t = text.trim();
  return GENERIC_COMMUNICATION_RE.test(t) && !/\d/.test(t) && !/\b(?:sql|python|power\s*bi|excel|crm|erp|jira|bpmn|rpa)\b/i.test(t);
}

/** One sentence that places a group of one role's facts: when, where, as what; then the facts, in the first person. */
function roleSentence(items: KindedEvidence[], opts: { first: boolean; earlier?: boolean }): string {
  const lead = items[0];
  const { position, company } = roleParts(lead);
  const current = !!lead.current;
  const substantive = items.filter((i) => !isGenericCommunicationClaim(i.text));
  const filtered = substantive.length > 0 ? substantive : items;
  // Bounded to 1-2 concrete facts to keep motivation letters complementary rather than repeating the entire resume
  const bounded = filtered.slice(0, opts.first ? 2 : 1);
  const facts = bounded.map((i) => trimEnd(toFirstPersonText(i.text).text)).filter(Boolean);
  const when = lead.period ? periodAz(lead.period.replace(/\bpresent\b/gi, 'Present')) : null;
  const where = company ? inOrganisation(company) : '';
  const as = position ? `${plainCase(position)} vəzifəsində` : '';
  let head: string;
  if (lead.scope === 'mentorship') {
    head = `${current ? when?.started ?? '' : when?.phrase ?? ''} ${company ? `${company} çərçivəsində` : ''} ${position ? `${plainCase(position)} kimi` : ''} ${current ? 'iştirak edirəm' : 'iştirak etmişəm'}.`.replace(/\s+/g, ' ').trim();
  } else if (lead.kind === 'experience' && where) {
    const t = current ? `${when?.started ?? ''} ${where} ${as} işləyirəm` : `${when?.phrase ?? ''} ${where} ${as} işləmişəm`;
    head = `${opts.earlier ? 'Bundan əvvəl, ' : ''}${t.replace(/\s+/g, ' ').trim()}.`;
  } else if (lead.kind === 'project') {
    const projName = lead.position || lead.role || '';
    const org = company && company !== projName ? `${company} nəzdində ` : '';
    head = `${org}«${projName}» layihəsi çərçivəsində`;
  } else if (lead.kind === 'activity') {
    const actTitle = lead.position || lead.role || '';
    const org = company ? `${inOrganisation(company)} ` : '';
    head = `${org}«${actTitle}» fəaliyyətim çərçivəsində`;
  } else {
    head = '';
  }
  if (!facts.length) return head ? (head.endsWith('.') ? head : `${head}.`) : '';

  if (lead.kind === 'project' || lead.kind === 'activity') {
    const firstFact = lowerFirstIfPlain(facts[0]) ?? facts[0];
    if (facts.length === 1) {
      return `${head} ${firstFact}.`.replace(/\s+/g, ' ').trim();
    }
    const otherFacts = facts.slice(1).map((f) => lowerFirstIfPlain(f) ?? f);
    return `${head} ${firstFact} və ${otherFacts.join(' və ')}.`.replace(/\s+/g, ' ').trim();
  }
  const connector = opts.earlier ? 'Həmin dövrdə' : 'Bu müddət ərzində';
  const pieces = facts.map((f, i) => {
    if (i === 0) {
      if (head.endsWith(':')) return cap(f);
      const low = lowerFirstIfPlain(f);
      return `${connector} ${low ?? f}`;
    }
    const low = lowerFirstIfPlain(f);
    return low ?? cap(f);
  });
  // Two facts to a sentence, joined with "və" (a piece that must keep its capital, a tool or a name, starts its own sentence): short, connected sentences instead of a
  // comma chain.
  const sentences: string[] = [];
  let current_: string[] = [];
  const flush = () => { if (current_.length) { sentences.push(current_.join(' və ')); current_ = []; } };
  // A fact that is already a long or compound sentence ("…; accepted into …") stands alone: joining it to the next with "və" made one run-on sentence
  // of three achievements (founder review of the TABIA letter, 17 October 2026).
  const long = (p: string) => /;/.test(p) || p.split(/\s+/).length > 16;
  pieces.forEach((p, i) => {
    const capital = /^\p{Lu}/u.test(p);
    if (i > 0 && (capital || long(p) || current_.some(long))) flush();
    current_.push(p);
    if (current_.length === 2) flush();
  });
  flush();
  return `${head} ${sentences.map((x) => `${cap(trimEnd(x))}.`).join(' ')}`.trim();
}

/** "…Universiteti" → "…Universitetində": the possessive-locative of a school name; any other name is introduced by "təhsil müəssisəsində" so no ending is guessed. */
const SCHOOL_LOCATIVE: [RegExp, string][] = [
  [/Universiteti$/u, 'Universitetində'], [/Universitet$/u, 'Universitetində'], [/Akademiyası$/u, 'Akademiyasında'], [/Kolleci$/u, 'Kollecində'], [/Məktəbi$/u, 'Məktəbində'],
  [/İnstitutu$/u, 'İnstitutunda'], [/Texnikumu$/u, 'Texnikumunda'], [/Liseyi$/u, 'Liseyində'], [/Gimnaziyası$/u, 'Gimnaziyasında'],
];
const inSchool = (school: string): string => {
  for (const [re, to] of SCHOOL_LOCATIVE) if (re.test(school)) return school.replace(re, to);
  return `${school} təhsil müəssisəsində`;
};

function educationSentence(e: KindedEvidence, persona: Persona): string | null {
  const ed = (persona.education ?? []).find((x) => [plainCase(x.degree), x.area, x.school].filter(Boolean).join(', ') === e.text) ?? null;
  if (!ed) return null;
  const when = periodAz(e.period ?? '');
  const degree = String(ed.degree || '').toLocaleLowerCase('az');
  const area = ed.area ? `${ed.area} ixtisası üzrə ` : '';
  const kind = degree ? `${degree} təhsili ` : 'təhsil ';
  const school = ed.school ? inSchool(ed.school) : '';
  const ends = [...(e.period ?? '').matchAll(/\b(20\d{2}|19\d{2})\b/g)].map((m) => Number(m[1]));
  const currentYear = new Date().getUTCFullYear();
  const hasFutureEnd = ends.length > 0 && Math.max(...ends) >= currentYear;
  // If explicitly ongoing, use present tense ("alıram").
  // If period mentions a future year without explicit ongoing confirmation, state the record factually ("qeyd olunub") rather than inventing graduation or enrollment.
  // Otherwise, if ended in the past, use simple past ("almışam").
  const verb = e.current ? 'alıram' : hasFutureEnd ? 'qeyd olunub' : 'almışam';
  const parts = [when ? (when.ended ? when.phrase : when.started) : '', school, `${area}${kind}${verb}`].filter(Boolean);
  return `${cap(parts.join(' ').replace(/\s+/g, ' ').trim())}.`;
}

export interface ComposeInput { motivation: string; companyReason?: string; formative?: string; contribution?: string; links?: RequirementLink[]; maxWords?: number }

const asSentence = (text: string): string => {
  const t = String(text ?? '').trim();
  if (!t) return '';
  return /[.!?…]$/u.test(t) ? t : `${t}.`;
};

/**
 * The composed letter body (what many candidates receive when the writer's draft is not used). It is a short personal explanation, not a CV summary:
 *   1. the application, with the candidate's own reason for wanting this work (if they wrote one) in the same breath;
 *   2. the strongest experience told as sentences about the role (when, where, as what, what was done), the experience that made the interest clearer
 *      (the candidate's own sentence) directly after the role it belongs to;
 *   3. the qualification when it answers the vacancy, then what the candidate wants noticed and what caught their attention here, in their own sentences;
 *   4. one plain closing sentence.
 * Requirements are never quoted or listed: fit is shown by which experience is chosen and by what the candidate says themselves. Nothing is invented: every
 * statement of interest, wish or contribution is the candidate's own sentence, verbatim.
 */
export function composeNarrativeLetter(persona: Persona, job: TailorJobInput, input: ComposeInput): { paragraphs: string[]; links: RequirementLink[] } {
  const rawCompany = trimEnd(job.company || '');
  const rawPosition = trimEnd(job.position || '');
  const company = cleanEmployerName(rawCompany) || rawCompany;
  const position = cleanDisplayRole(rawPosition) || rawPosition;
  const opening = company && position
    ? `${company} tərəfindən elan olunmuş ${position} vakansiyasına müraciət edirəm.`
    : position ? `${position} vakansiyasına müraciət edirəm.` : company ? `${company} şirkətinin vakansiyasına müraciət edirəm.` : '';
  const evidence = letterEvidence(persona, job, 12);
  const links = input.links ?? linkRequirements(vacancyRequirements(job), evidence);
  const paragraphs: string[] = [];
  // Each of the candidate's answers is told once: the same sentence picked (or reused from the last letter) as two answers was printed twice.
  const told_ = new Set<string>();
  const once = (text: string | undefined) => {
    const t = asSentence(text ?? '');
    const key = fold(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!key || told_.has(key)) return '';
    told_.add(key);
    return t;
  };
  const attraction = once(input.motivation);
  // The reflection (which experience made the interest clear) belongs with the reason: why → what made it clear → the evidence that follows.
  const formativeFirst = once(input.formative);
  const first = [opening, attraction, formativeFirst].filter(Boolean).join(' ');
  if (first) paragraphs.push(first);

  // Strongest experience first: the order of `letterEvidence` is relevance to the vacancy; a role the candidate's own "experience that clarified" sentence is about comes first.
  const byRole = new Map<string, KindedEvidence[]>();
  const allExperience = evidence.filter((e) => e.kind === 'experience' || e.kind === 'project' || e.kind === 'activity').filter((e) => !isNegatedStatement(e.text));
  const relevantExperience = allExperience.filter((e) => vacancyEvidenceScore(e.text, job) > 0);
  const pool = relevantExperience.length ? relevantExperience : allExperience.slice(0, 1);
  const formativeText = fold(input.formative ?? '').replace(/[^\p{L}\p{N}]+/gu, ' ');
  // An adopted source fact already told in the opening must not be copied again under its employer.
  const experience = pool.filter((e) => {
    const fact = fold(e.text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return fact.length < 30 || fact.split(/\s+/).length < 4 || !formativeText.includes(fact);
  });
  for (const e of experience) byRole.set(`${e.kind}|${e.role}|${e.period}`, [...(byRole.get(`${e.kind}|${e.role}|${e.period}`) ?? []), e]);
  let groups = [...byRole.values()];
  const formative = asSentence(input.formative ?? '');
  if (formative) {
    const fs = stems(formative);
    const score = (g: KindedEvidence[]) => g.reduce((n, x) => n + [...stems(`${x.role ?? ''} ${x.text}`)].filter((st) => fs.has(st)).length, 0);
    const best = groups.map((g, i) => ({ g, i, sc: score(g) })).sort((a, b) => b.sc - a.sc || a.i - b.i)[0];
    if (best && best.sc > 0) groups = [best.g, ...groups.filter((g) => g !== best.g)];
  }
  groups = groups.slice(0, 2);
  const told: string[] = [];
  groups.forEach((g, i) => {
    const sentence = roleSentence(g.slice(0, i === 0 ? 4 : 2), { first: i === 0, earlier: i > 0 && !!groups[0][0].current && !g[0].current });
    if (!sentence) return;
    told.push(sentence);
  });
  // One paragraph per role: two roles in one block read as a single run of achievements (TABIA letter, 17 October 2026).
  paragraphs.push(...told);

  // Qualification: the degree when the vacancy asks for one, or when no experience could be told; a course or licence only when a requirement is about it.
  const closing: string[] = [];
  const degreeLink = links.find((l) => evidence.find((x) => x.id === l.evidenceId)?.kind === 'education');
  const certLink = links.find((l) => evidence.find((x) => x.id === l.evidenceId)?.kind === 'certificate');
  const edu = degreeLink ? evidence.find((x) => x.id === degreeLink.evidenceId) : !told.length ? evidence.find((e) => e.kind === 'education') : undefined;
  const eduSentence = edu ? educationSentence(edu, persona) : null;
  if (eduSentence) closing.push(eduSentence);
  if (certLink) {
    const e = evidence.find((x) => x.id === certLink.evidenceId)!;
    const noun = /kurs|təlim|training|course|bootcamp|akademiya|academy/iu.test(e.text) ? 'Keçdiyim təlim' : /vəsiqə/iu.test(e.text) ? 'Vəsiqəm' : /diplom/iu.test(e.text) ? 'Diplomum' : /lisenziya/iu.test(e.text) ? 'Lisenziyam' : 'Sertifikatım';
    closing.push(`${noun}: ${trimEnd(e.text)}.`);
  }
  const contribution = once(input.contribution);
  const hook = once(input.companyReason);
  if (contribution && !isGenericCommunicationClaim(contribution)) closing.push(contribution);
  if (hook) closing.push(hook);
  if (closing.length) paragraphs.push(closing.join(' '));

  const answered = [input.motivation, input.formative, input.companyReason, input.contribution].some((x) => (x ?? '').trim());
  paragraphs.push(answered ? 'Təcrübəmi və motivasiyamı görüşdə ətraflı izah etməyə hazıram.' : 'Təcrübəm barədə görüşdə ətraflı danışmağa hazıram.');
  return { paragraphs, links };
}
