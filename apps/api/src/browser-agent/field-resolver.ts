import { hashOf } from './canonical';

/**
 * Turns the controls a portal form actually has (described by the extension from the real page) into a plan: what AISE may fill from the
 * candidate's CONFIRMED answers, and what it must ask the candidate. It is deterministic on purpose: no model reads the page, so nothing a
 * website says can change what is answered, and nothing is ever invented. An optional field AISE has no confirmed answer for is left empty;
 * a required one becomes a question; sensitive disclosures and legal declarations are never answered on the candidate's behalf automatically.
 */
export type ControlType = 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'number' | 'date' | 'other';
export interface FormField {
  key: string; // the control's stable name (grouped radios share one key)
  label: string; // the question text exactly as the page shows it (data, never instructions)
  type: ControlType;
  required: boolean;
  options?: { value: string; label: string }[];
  multiple?: boolean;
}

export interface Answers {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  currentCompany?: string | null;
  links?: { linkedin?: string | null; github?: string | null; twitter?: string | null; portfolio?: string | null; other?: string | null };
  workAuthorization?: 'yes' | 'no' | null; // confirmed by the candidate; applies to "legally authorised to work" style questions
  salary?: { amount: number; currency: string; period?: string } | null;
  noticePeriod?: string | null;
}

export type Category =
  | 'resume' | 'name' | 'email' | 'phone' | 'location' | 'org' | 'link_linkedin' | 'link_github' | 'link_twitter' | 'link_portfolio' | 'link_other'
  | 'work_authorization' | 'salary' | 'notice' | 'cover' | 'sensitive' | 'declaration' | 'technical' | 'unknown';
export type AskReason = 'missing' | 'sensitive' | 'declaration' | 'unknown' | 'always_ask' | 'unsupported_control' | 'ambiguous_option';

export interface ResolvedField {
  key: string; label: string; type: ControlType; required: boolean; category: Category;
  action: 'fill' | 'file' | 'skip' | 'ask';
  value?: string | boolean | string[];
  source?: 'confirmed_answer' | 'remembered_answer' | 'candidate_answer' | 'approved_cover_note' | 'approved_letter';
  askReason?: AskReason;
  options?: { value: string; label: string }[];
}

export interface ResolveInput {
  fields: FormField[];
  answers: Answers;
  coverNote?: string | null;
  /** Where coverNote came from: the campaign's own note or the letter the candidate approved for this vacancy. */
  coverSource?: 'approved_cover_note' | 'approved_letter';
  alwaysAsk?: string[]; // categories the candidate wants to be asked about every time
  remembered?: Record<string, string | boolean>; // answers the candidate gave before for the same employer question (never sensitive or declarations)
  given?: Record<string, string | boolean | string[]>; // answers the candidate just gave for THIS application, by field key
  hasResume: boolean;
}

const n = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const has = (text: string, ...parts: (string | RegExp)[]) => parts.some((p) => (typeof p === 'string' ? text.includes(p) : p.test(text)));

/** Stable id of a question (employer questions have opaque names that differ per form; the wording is what repeats). */
export const questionKey = (f: Pick<FormField, 'label' | 'type' | 'options'>) => hashOf({ l: n(f.label), t: f.type, o: (f.options ?? []).map((o) => n(o.label)).sort() }).slice(0, 24);

export function categorize(f: FormField): Category {
  const key = n(f.key), label = n(f.label), t = `${key} ${label}`;
  if (f.type === 'file') return key === 'resume' || has(label, 'resume', 'cv') ? 'resume' : 'unknown';
  if (/^(accountid|linkedindata|origin|referer|timezone|socialreferralkey|socialsource|resumestorageid|h-captcha-response|g-recaptcha-response|source)$/.test(key) || key.endsWith('[basetemplate]') || key.endsWith('[surveyid]') || key.endsWith('[candidateselectedlocation]') || key === 'selectedlocation') return 'technical';
  if (key.startsWith('eeo[') || key.startsWith('surveysresponses[') || has(label, 'gender', 'race', 'ethnic', 'veteran', 'disabilit', 'sexual orientation', 'pronoun', 'age range', 'religio', 'date of birth', 'marital')) return 'sensitive';
  if (f.type === 'checkbox' && has(label, 'i agree', 'i consent', 'i have read', 'i acknowledge', 'i accept', 'terms', 'privacy', 'gdpr', 'data processing', 'razi', 'raziyam')) return 'declaration';
  if (key === 'name' || has(label, /^(full )?name\b/, 'first name', 'last name', 'ad soyad')) return 'name';
  if (key === 'email' || has(label, 'e-mail', 'email')) return 'email';
  if (key === 'phone' || has(label, 'phone', 'mobile', 'telefon', 'mobil')) return 'phone';
  if (key === 'location' || has(label, 'current location', 'city you', 'where are you located')) return 'location';
  if (key === 'org' || has(label, 'current company', 'current employer')) return 'org';
  if (key.startsWith('urls[')) {
    if (has(key, 'linkedin')) return 'link_linkedin';
    if (has(key, 'github')) return 'link_github';
    if (has(key, 'twitter')) return 'link_twitter';
    if (has(key, 'portfolio')) return 'link_portfolio';
    return 'link_other';
  }
  if (has(t, 'legally authorized', 'legally authorised', 'authorized to work', 'authorised to work', 'right to work', 'work permit', 'eligible to work')) return 'work_authorization';
  if (has(t, 'salary', 'compensation', 'maas', 'expected pay', 'pay expectation')) return 'salary';
  if (has(t, 'notice period', 'start date', 'when can you start', 'availability', 'available to start', 'earliest start')) return 'notice';
  if (f.type === 'textarea' && has(label, 'cover letter', 'covering letter', 'motivation letter', 'motivasiya mektub')) return 'cover';
  return 'unknown';
}

const yesNo = (answer: 'yes' | 'no', options: { value: string; label: string }[]): string | null => {
  const pick = options.filter((o) => (answer === 'yes' ? /^(yes|i am|i do|bəli|beli|да)\b/.test(n(o.label)) : /^(no|not|i am not|i do not|xeyr|нет)\b/.test(n(o.label))));
  return pick.length === 1 ? pick[0].value : null;
};

/** The single option whose wording says exactly one of the answers; anything ambiguous returns null (and the candidate is asked). */
function chooseOption(f: FormField, wanted: string): string | null {
  const opts = f.options ?? [];
  const exact = opts.filter((o) => n(o.label) === n(wanted) || n(o.value) === n(wanted));
  return exact.length === 1 ? exact[0].value : null;
}

export interface Resolution { fields: ResolvedField[]; questions: ResolvedField[]; ready: boolean }

export function formatPhone(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('994') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+994${digits.slice(1)}`;
  if (digits.length === 9) return `+994${digits}`;
  return cleaned.startsWith('+') ? `+${digits}` : digits;
}

export function resolveFields(input: ResolveInput): Resolution {
  const out: ResolvedField[] = [];
  const always = new Set(input.alwaysAsk ?? []);
  const a = input.answers;
  for (const f of input.fields) {
    const category = categorize(f);
    const base: ResolvedField = { key: f.key, label: f.label.slice(0, 300), type: f.type, required: f.required, category, action: 'skip', options: f.options };
    const ask = (reason: AskReason): ResolvedField => ({ ...base, action: f.required ? 'ask' : 'skip', askReason: f.required ? reason : undefined });
    const fill = (value: string | boolean | string[], source: NonNullable<ResolvedField['source']>): ResolvedField => ({ ...base, action: 'fill', value, source });

    if (category === 'technical') { out.push({ ...base, action: 'skip' }); continue; }
    // What the candidate typed for this very application wins, for every category except documents.
    const given = input.given?.[f.key];
    if (given !== undefined && category !== 'resume') { out.push(fill(given, 'candidate_answer')); continue; }

    if (category === 'resume') { out.push(input.hasResume ? { ...base, action: 'file', source: 'confirmed_answer' } : ask('missing')); continue; }
    if (f.type === 'other') { out.push(ask('unsupported_control')); continue; }
    if (category === 'sensitive') { out.push(ask('sensitive')); continue; } // never answered on the candidate's behalf; optional ones stay empty
    if (category === 'declaration') { out.push(ask('declaration')); continue; }

    const text = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    let value: string | null = null;
    switch (category) {
      case 'name': value = text(a.fullName); break;
      case 'email': value = text(a.email); break;
      case 'phone': value = formatPhone(a.phone); break;
      case 'location': value = text(a.location); break;
      case 'org': value = text(a.currentCompany); break;
      case 'link_linkedin': value = text(a.links?.linkedin); break;
      case 'link_github': value = text(a.links?.github); break;
      case 'link_twitter': value = text(a.links?.twitter); break;
      case 'link_portfolio': value = text(a.links?.portfolio); break;
      case 'link_other': value = text(a.links?.other); break;
      case 'notice': value = text(a.noticePeriod); break;
      case 'salary': value = a.salary && a.salary.amount > 0 ? `${a.salary.amount} ${a.salary.currency}${a.salary.period ? ` / ${a.salary.period}` : ''}` : null; break;
      case 'cover': value = text(input.coverNote); break;
      case 'work_authorization': {
        if (a.workAuthorization && (f.type === 'select' || f.type === 'radio')) value = yesNo(a.workAuthorization, f.options ?? []);
        else if (a.workAuthorization && (f.type === 'text' || f.type === 'textarea')) value = a.workAuthorization === 'yes' ? 'Yes' : 'No';
        break;
      }
      default: break;
    }
    if (category === 'salary' && value && (f.type === 'select' || f.type === 'radio')) value = chooseOption(f, value); // a salary choice must match an option exactly
    if (value && always.has(category)) { out.push(ask('always_ask')); continue; }
    if (value && (f.type === 'select' || f.type === 'radio') && !(f.options ?? []).some((o) => o.value === value)) { out.push(ask('ambiguous_option')); continue; }
    if (value) { out.push(fill(value, category === 'cover' ? (input.coverSource ?? 'approved_cover_note') : 'confirmed_answer')); continue; }

    // Not covered by the confirmed answers: an answer the candidate already gave to the same question for this employer, or a question for them.
    const remembered = input.remembered?.[questionKey(f)];
    if (category === 'unknown' && remembered !== undefined && !always.has('unknown')) { out.push(fill(remembered, 'remembered_answer')); continue; }
    out.push(ask(category === 'unknown' ? 'unknown' : 'missing'));
  }
  const questions = out.filter((r) => r.action === 'ask');
  return { fields: out, questions, ready: questions.length === 0 };
}

/** The part of a resolution that gets approved and filled: exactly the values, in a stable order. */
export function planOf(fields: ResolvedField[]) {
  return fields
    .filter((f) => f.action === 'fill' || f.action === 'file')
    .map((f) => ({ key: f.key, label: f.label, type: f.type, action: f.action, value: f.action === 'file' ? 'resume' : f.value, category: f.category, source: f.source }))
    .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}
