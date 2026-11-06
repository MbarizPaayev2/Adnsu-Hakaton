import type { ApplicationEmailEvidence } from '../jobs/job-facts';

export const MAX_SUBJECT_CHARS = 200;
export const MAX_BODY_CHARS = 5_000;
export const MAX_CV_BYTES = 8 * 1024 * 1024;

const isControl = (code: number) => code < 32 || code === 127 || code === 0x2028 || code === 0x2029;

/** Header values must be one line: control characters and line breaks never reach a header. */
export function singleLine(value: string): string {
  let out = '';
  for (const ch of value) out += isControl(ch.codePointAt(0)!) ? ' ' : ch;
  return out.replace(/\s+/g, ' ').trim();
}

/** Body text: no NUL or other control characters except line breaks and tabs. */
export function cleanBody(value: string): string {
  let out = '';
  for (const ch of value.replace(/\r\n/g, '\n')) {
    const code = ch.codePointAt(0)!;
    if (code === 10 || code === 9 || !isControl(code)) out += ch;
  }
  return out.trim();
}

const AZ_LETTERS = /[əıöüçşğƏİÖÜÇŞĞ]/;
export const draftLanguage = (text: string): 'az' | 'en' => (AZ_LETTERS.test(text) ? 'az' : 'en');

export interface DraftInput {
  title: string;
  description: string;
  senderName: string;
  evidence: Pick<ApplicationEmailEvidence, 'subjectLine' | 'reference' | 'subjectIsPositionName'> | null;
  /** The candidate's own saved letter, if any; used as written. */
  savedLetter?: string | null;
}

export interface Draft { subject: string; subjectSource: 'published' | 'reference' | 'generated'; body: string }

/**
 * The starting point the candidate reviews and may edit. It states only the
 * role applied for and that a CV is attached: no qualifications, years of
 * experience or answers are written on the candidate's behalf.
 */
export function buildDraft(input: DraftInput): Draft {
  const lang = draftLanguage(`${input.title} ${input.description}`);
  const ref = input.evidence?.reference;
  const published = input.evidence?.subjectLine ? singleLine(input.evidence.subjectLine).slice(0, MAX_SUBJECT_CHARS) : '';
  const title = singleLine(input.title);
  // The posting asked for the position's name in the subject: that is exactly the title (nothing added in front of it).
  const positionOnly = !published && !ref && input.evidence?.subjectIsPositionName === true;
  const subject = published || (ref ? singleLine(`${title} - ${ref}`) : positionOnly ? singleLine(title) : singleLine(`${lang === 'az' ? 'Müraciət' : 'Application'}: ${title}`)).slice(0, MAX_SUBJECT_CHARS);
  const subjectSource = published ? 'published' : ref ? 'reference' : positionOnly ? 'published' : 'generated';
  const name = singleLine(input.senderName);
  const saved = input.savedLetter?.trim();
  const body = saved
    ? cleanBody(saved).slice(0, MAX_BODY_CHARS)
    : lang === 'az'
      ? `Salam,\n\n${title} vəzifəsi üzrə müraciət edirəm${ref ? ` (vakansiya kodu: ${ref})` : ''}. CV-m əlavə olunub.\n\nHörmətlə,\n${name}`
      : `Hello,\n\nI am applying for the ${title} position${ref ? ` (reference ${ref})` : ''}. My CV is attached.\n\nKind regards,\n${name}`;
  return { subject, subjectSource, body };
}

/** ASCII file name for the attachment; the extension comes from the stored document type. */
export function attachmentName(senderName: string, extension: '.pdf' | '.docx'): string {
  const slug = singleLine(senderName).normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `CV-${slug || 'candidate'}${extension}`;
}

/** ASCII file name for the motivation-letter attachment. */
export function letterAttachmentName(senderName: string): string {
  const slug = singleLine(senderName).normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `Motivation-letter-${slug || 'candidate'}.pdf`;
}

/** Requirements the posting makes beyond "send your CV". Automatic mode cannot meet them, so it stops. */
export const EXTRA_REQUIREMENTS = /salary expectation|expected salary|maaş gözləntisi|maaş tələbi|portfolio|portfel|diploma|sertifikat|certificate|references?\b|tövsiyə məktubu|motivation letter|motivasiya məktubu|cover letter|müşayiət məktubu|answer the following|following questions|aşağıdakı suallar|ответьте на|сопроводительное|зарплатные ожидания/i;
