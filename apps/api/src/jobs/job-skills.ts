import { postingLines } from './posting-sections';
import { KNOWN_SKILLS } from '../resumes/cv-parser';

/**
 * What a posting asks for, set against what the candidate's profile already evidences.
 *
 * Everything here is mechanical and conservative: a need is only listed when the posting's own words name it, each need carries the line it came from,
 * and "not in your profile" is a statement about the profile, never about the person. Degrees and years of experience are kept apart from skills.
 * Nothing is added to a profile or a CV from here; a candidate confirms each addition.
 */

export type NeedLevel = 'required' | 'preferred';
export interface SkillNeed { skill: string; level: NeedLevel; requirement: string }
export interface OtherRequirement { kind: 'degree' | 'experience' | 'other'; text: string; level: NeedLevel }
export interface PostingNeeds { skills: SkillNeed[]; other: OtherRequirement[]; sourceRequirements?: { text: string; level: NeedLevel; needsReview: boolean }[] }

const fold = (s: string) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ə/g, 'e').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ç/g, 'c')
    .replace(/[^a-z0-9+#./ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Alias groups: every member is the same skill. The first is the display name. */
const SYNONYMS: string[][] = [
  ['JavaScript', 'js', 'java script', 'ecmascript'], ['TypeScript', 'ts'], ['PostgreSQL', 'postgres', 'postgre sql', 'psql'], ['MS Excel', 'excel', 'microsoft excel', 'ms excel', 'mc excel'],
  ['PowerPoint', 'ppt', 'ms powerpoint', 'microsoft powerpoint'],
  ['Power BI', 'powerbi', 'power-bi', 'microsoft power bi'], ['Machine Learning', 'ml', 'masin ogrenmesi', 'maşın öyrənməsi'], ['MS Office', 'microsoft office', 'office paketi', 'ms ofis', 'office'],
  ['Node.js', 'node', 'nodejs'], ['React', 'reactjs', 'react.js'], ['Vue', 'vuejs', 'vue.js'], ['Kubernetes', 'k8s'], ['Go', 'golang'], ['MongoDB', 'mongo'], ['CI/CD', 'ci cd', 'cicd'],
  ['Google Analytics', 'ga4', 'google analytics 4'], ['SEO', 'search engine optimization'], ['Communication skills', 'communication', 'kommunikasiya', 'kommunikasiya bacariqlari', 'ünsiyyət', 'unsiyyet', 'unsiyyet bacariqlari'],
  ['Teamwork', 'team work', 'komanda ile is', 'komanda ilə iş', 'komanda isi', 'komandada isleme', 'team player'], ['Analytical skills', 'analytical thinking', 'analitik tefekkur', 'analitik bacariqlar', 'analytical'],
  ['Problem solving', 'problem-solving', 'problemlerin helli'], ['Time management', 'vaxtin idare olunmasi', 'vaxt idareetmesi'], ['Project management', 'layihe idareetmesi', 'layihe idaresi'],
  ['Customer service', 'musteri xidmeti', 'müştəri xidməti', 'customer support', 'client service'], ['Accounting', 'muhasibat', 'muhasibatliq', 'mühasibatlıq', 'muhasibat ucotu'],
  ['English', 'ingilis dili', 'ingilis', 'english language'], ['Russian', 'rus dili', 'rus'], ['Azerbaijani', 'azerbaycan dili', 'azerbaycanca', 'azərbaycan', 'azerbaycan'], ['Turkish', 'turk dili', 'turkce'], ['German', 'alman dili'],
  ['RPA', 'robotic process automation', 'robotik proseslərin avtomatlaşdırılması', 'robotik proseslerin avtomatlasdirilmasi'],
  ['BPMN', 'bpmn 2.0', 'business process modeling', 'proseslərin xəritələndirilməsi', 'proseslerin xeritelesdirilmesi'],
  ['Hyperautomation', 'hyper automation', 'hiperavtomatlaşdırma', 'hiper avtomatlaşdırma', 'hiperavtomatlasdirma'],
  ['SQL', 'structured query language', 'ms sql', 'tsql', 't-sql'],
  ['Jira', 'atlassian jira'],
  ['Confluence', 'atlassian confluence'],
];
const ALIAS_TO_CANON = new Map<string, string>();
for (const group of SYNONYMS) for (const alias of group) ALIAS_TO_CANON.set(fold(alias), group[0]);
for (const k of KNOWN_SKILLS) if (!ALIAS_TO_CANON.has(fold(k))) ALIAS_TO_CANON.set(fold(k), k);

/** Canonical display name of a skill phrase (synonyms collapse; unknown phrases keep the posting's own wording). */
export function canonicalSkill(raw: string): { key: string; label: string } {
  const f = fold(raw);
  const canon = ALIAS_TO_CANON.get(f);
  if (canon) return { key: fold(canon), label: canon };
  // "SQL knowledge" / "knowledge of SQL" / "SQL bilikləri"
  const stripped = f.replace(/^(?:knowledge of|proficiency in|experience with|experience in|strong|good|excellent|basic|advanced|working knowledge of)\s+/, '').replace(/\s+(?:knowledge|experience|bilikleri|bilik|bacarigi|bacariqlari|skills?)$/, '').trim();
  const again = ALIAS_TO_CANON.get(stripped);
  if (again) return { key: fold(again), label: again };
  const label = String(raw).trim().replace(/^[-–—•*\s]+|[.;:,\s]+$/g, '');
  return { key: stripped || f, label };
}

// ------------------------------------------------------------------ posting --

const PREFERRED_INLINE = /\b(?:preferred|nice to have|a plus|is a plus|an advantage|desirable|bonus|üstünlük|üstün tutulur|arzuolunandır|arzu olunur|əlavə üstünlük)\b/iu;
const DEGREE = /\b(?:bachelor|master(?:'s)?|degree|diploma|phd|mba|ali təhsil|bakalavr|magistr|orta ixtisas|təhsil|universitet|university graduate|graduate of)\b/iu;
const YEARS = /(?:\b\d+\s*\+?\s*(?:[-–]\s*\d+\s*)?(?:years?|yrs?|il|illik)\b|\b(?:il|ildən) (?:az olmayaraq )?(?:iş )?təcrübə|\bminimum \d+ (?:years?|il))/iu;
const TRIGGER = /(?:knowledge of|proficiency in|proficient in|experience (?:with|in|of)|familiarity with|skills? in|expertise in|ability to use|hands-on experience with|working knowledge of|bilik(?:lər)?i?\b|bacarığı|bacarıqları|biliyi|istifadə bacarığı)/iu;
const SOFT_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /communicat|unsiyyet|kommunikasiya/, label: 'Communication skills' },
  { re: /team ?work|team player|komanda (?:ile|ucun|uzvu)|komanda ruhu|komandada/, label: 'Teamwork' },
  { re: /analytic|analitik|tehlil bacar/, label: 'Analytical skills' },
  { re: /problem[- ]solving|problemlerin helli|problem helli/, label: 'Problem solving' },
  { re: /time management|vaxt(?:in)? idare|vaxtdan sef/, label: 'Time management' },
  { re: /leadership|liderlik|rehberlik bacar/, label: 'Leadership' },
  { re: /attention to detail|diqqetli|diqqet/, label: 'Attention to detail' },
  { re: /negotiat|danisiq aparma|danisiqlar/, label: 'Negotiation' },
  { re: /presentation skills|teqdimat/, label: 'Presentation skills' },
  { re: /stres|stress/, label: 'Stress resistance' },
  { re: /customer (?:service|support|focus|orient)|musteri (?:xidmet|yonumlu|ile is)/, label: 'Customer service' },
  { re: /project management|layihe idare/, label: 'Project management' },
  { re: /creativ|yaradici/, label: 'Creativity' },
];
// A token that names a tool or a standard rather than an ordinary word: an acronym, CamelCase, a digit or a dot inside, or a capitalised word that is
// not the first word of the line.
const TOOLISH = /^(?:[A-Z][A-Z0-9&/+#.-]{1,11}|[A-Za-z]+[0-9][A-Za-z0-9.]*|[A-Z][a-z]+[A-Z][A-Za-z]*|[A-Za-z]+\.[a-z]{2,4}|[A-Z][a-z0-9]{2,15})$/;
const TOOL_STOPWORDS = new Set(['The', 'And', 'Our', 'You', 'Your', 'We', 'For', 'With', 'Must', 'Have', 'Good', 'Strong', 'Excellent', 'Knowledge', 'Experience', 'Ability', 'Fluent', 'Basic', 'Advanced', 'Minimum', 'Bachelor', 'Master', 'University', 'Years', 'Year', 'Skills', 'Skill', 'Work', 'Working', 'Team', 'Business', 'Management', 'Company', 'Bank', 'Baku', 'Azerbaijan', 'Azerbaijani', 'English', 'Russian', 'Turkish', 'German', 'Required', 'Preferred', 'Plus', 'Etc', 'EN', 'Bakı', 'AZ', 'Real', 'Time', 'Part', 'Full']);
const OTHER_TOOLS = ['Word', 'Outlook', 'Teams', 'Jira', 'Confluence', 'Slack', 'Notion', 'GitHub', 'GitLab', 'Bitrix24', 'Oracle', 'Navision', 'Stata', 'MATLAB', 'Revit', 'ArchiCAD', 'SolidWorks', '3ds Max', 'Premiere', 'After Effects', 'InDesign', 'Canva', 'WordPress', 'Shopify', 'HubSpot', 'Zendesk', 'ERP', 'PLC', 'SCADA', 'Postman', 'Swagger', 'Selenium', 'Hadoop', 'Spark', 'Airflow', 'Snowflake', 'Looker', 'Kafka', 'RabbitMQ', 'Elasticsearch', 'Nginx', 'Ansible', 'Jenkins', 'Bash', 'Scrum', 'Agile', 'Kanban', 'SWIFT', 'IFRS', 'GAAP', 'VBA', 'Access', 'Visio', 'Zoom'];
for (const t of OTHER_TOOLS) if (!ALIAS_TO_CANON.has(fold(t))) ALIAS_TO_CANON.set(fold(t), t);
const SKILL_LIST_SPLIT = /\s*(?:,|;|\/|\band\b|\bor\b|\bvə\b|\bhəmçinin\b|\+|\||:)\s*/iu;
const STOP = new Set(['and', 'or', 'the', 'a', 'an', 'of', 'in', 'with', 'for', 'to', 'etc', 'və', 'ilə', 'üçün', 'etc.', 'other', 'others', 'related', 'similar', 'tools', 'tool']);

function skillPhrases(line: string): string[] {
  const found = new Map<string, string>();
  const put = (label: string) => { const c = canonicalSkill(label); if (!found.has(c.key)) found.set(c.key, c.label); };
  const f = fold(line);

  // 1) the vocabulary and its aliases, as whole words
  for (const [alias, canon] of ALIAS_TO_CANON) {
    if (alias.length < 2) continue;
    const re = new RegExp(`(^|[^a-z0-9+#])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9+#]|$)`);
    if (re.test(f)) put(canon);
  }
  // 2) soft skills, by their stems in both languages
  for (const { re, label } of SOFT_PATTERNS) if (re.test(f)) put(label);
  // 3) tool-like tokens next to a "knowledge of ..." / "... bilikləri" phrase, so a plain capitalised sentence is not mistaken for a tool list
  if (TRIGGER.test(line) || /[:：]/.test(line)) {
    const tokens = line.split(SKILL_LIST_SPLIT).flatMap((part) => part.trim().split(/\s+/).length <= 3 ? [part.trim()] : part.trim().split(/\s+/));
    for (const raw of tokens) {
      const t = raw.replace(/^[("'“]+|[)"'”.]+$/g, '');
      if (t.length < 2 || STOP.has(t.toLowerCase()) || TOOL_STOPWORDS.has(t)) continue;
      // A fragment of a recognized name is not another skill (MS from MS Office).
      if ([...found.values()].some((label) => fold(label).startsWith(fold(t) + ' '))) continue;
      if (DEGREE.test(t) || YEARS.test(t)) continue;
      if (/^[\p{Lu}\d][\p{L}\d&/+#.-]*(?:\s[\p{Lu}\d][\p{L}\d&/+#.-]*){0,2}$/u.test(t) && TOOLISH.test(t.split(/\s+/)[0]) && /^[A-Za-z0-9&/+#. -]+$/.test(t)) put(t);
    }
  }
  return [...found.values()];
}

export function extractPostingNeeds(posting: { title?: string; description?: string; requirements?: string | null; skills?: string[] | null }): PostingNeeds {
  const skills: SkillNeed[] = [];
  const other: OtherRequirement[] = [];
  const seen = new Set<string>();
  const sourceRequirements: NonNullable<PostingNeeds['sourceRequirements']> = [];
  const push = (skill: string, level: NeedLevel, requirement: string) => {
    const { key, label } = canonicalSkill(skill);
    const prior = skills.find((s) => fold(s.skill) === key);
    if (prior) { if (prior.level === 'preferred' && level === 'required') prior.level = 'required'; return; }
    skills.push({ skill: label, level, requirement: requirement.slice(0, 220) });
  };

  // A native vacancy lists its skills as data: those are the employer's own required list.
  for (const s of posting.skills ?? []) if (String(s).trim()) push(String(s), 'required', String(s));

  const blocks = [
    ...postingLines(posting.requirements ?? '', 'required'),
    ...postingLines(posting.description ?? ''),
  ].map(({ text, section }) => ({ text, context: section === 'responsibility' ? 'other' : section }));

  for (const { text, context } of blocks) {
    if (context === 'other') continue;
    // Outside a labelled requirements part, only lines that clearly ask for something count.
    const asks = /\b(?:required|must|should|need|knowledge|proficien|experience|ability|familiar|skills?|fluent|degree|tələb|bilik|bacarıq|təcrübə|biliyi|istifadə|üstünlük|arzu)/iu.test(text);
    if (context === 'unknown' && !asks) continue;
    sourceRequirements.push({ text, level: context === 'preferred' || PREFERRED_INLINE.test(text) ? 'preferred' : 'required', needsReview: !skillPhrases(text).length });
    const level: NeedLevel = context === 'preferred' || PREFERRED_INLINE.test(text) ? 'preferred' : 'required';
    const key = `${level}:${fold(text)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (DEGREE.test(text) && !TRIGGER.test(text)) other.push({ kind: 'degree', text: text.slice(0, 220), level });
    else if (YEARS.test(text)) {
      other.push({ kind: 'experience', text: text.slice(0, 220), level });
      // "3+ years with SQL and Python": the tools are still skills.
      for (const s of skillPhrases(text)) push(s, level, text);
      continue;
    }
    if (DEGREE.test(text) && !TRIGGER.test(text)) continue;
    const found = skillPhrases(text);
    for (const s of found) push(s, level, text);
    // A requirement the posting states that is not a named skill (a duty, a licence, a condition) is shown as written, with no check against the profile.
    if (!found.length && context !== 'unknown' && text.length >= 12) other.push({ kind: 'other', text, level });
  }
  return { skills, other, sourceRequirements };
}

// ------------------------------------------------------------------ profile --

export interface ProfileEvidenceInput {
  skills: string[];
  experiences: { title?: string | null; company?: string | null; description?: string | null }[];
  career?: { title?: string | null; description?: string | null; result?: string | null }[];
  languages?: { title: string }[];
}
export interface EvidencedSkill { skill: string; via: 'skills' | 'experience'; where?: string }

export function evidenceFor(need: string, profile: ProfileEvidenceInput): EvidencedSkill | null {
  const { key, label } = canonicalSkill(need);
  for (const s of profile.skills) if (canonicalSkill(s).key === key) return { skill: label, via: 'skills' };
  for (const l of profile.languages ?? []) if (canonicalSkill(l.title).key === key) return { skill: label, via: 'skills' };
  const aliases = [...ALIAS_TO_CANON.entries()].filter(([, canon]) => fold(canon) === key).map(([a]) => a);
  const variants = new Set([key, ...aliases].filter((v) => v.length >= 2));
  const matches = (text: string) => {
    const f = fold(text);
    for (const v of variants) {
      const re = new RegExp(`(^|[^a-z0-9+#])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9+#]|$)`);
      if (re.test(f)) return true;
    }
    return false;
  };
  for (const e of profile.experiences) if (matches(`${e.title ?? ''} ${e.description ?? ''}`)) return { skill: label, via: 'experience', where: [e.title, e.company].filter(Boolean).join(', ') };
  for (const c of profile.career ?? []) if (matches(`${c.title ?? ''} ${c.description ?? ''} ${c.result ?? ''}`)) return { skill: label, via: 'experience', where: c.title ?? undefined };
  return null;
}

export interface SkillGuidance {
  evidenced: (SkillNeed & { via: 'skills' | 'experience'; where?: string })[];
  missingRequired: SkillNeed[];
  missingPreferred: SkillNeed[];
  other: OtherRequirement[];
  sourceRequirements?: PostingNeeds['sourceRequirements'];
}

export function skillGuidance(needs: PostingNeeds, profile: ProfileEvidenceInput): SkillGuidance {
  const out: SkillGuidance = { evidenced: [], missingRequired: [], missingPreferred: [], other: needs.other, sourceRequirements: needs.sourceRequirements };
  for (const need of needs.skills) {
    const ev = evidenceFor(need.skill, profile);
    if (ev) out.evidenced.push({ ...need, via: ev.via, where: ev.where });
    else if (need.level === 'required') out.missingRequired.push(need);
    else out.missingPreferred.push(need);
  }
  return out;
}
