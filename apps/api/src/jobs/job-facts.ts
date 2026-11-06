import type { ApplicationMethod } from '@prisma/client';

/**
 * Facts about a posting that are only recorded when the source states them.
 * NULL / UNKNOWN means "the posting does not say"; nothing here is inferred
 * from the employer, the industry or a model.
 */
export const FACTS_EXTRACTOR_VERSION = 4;

export const WORK_ARRANGEMENTS = ['Remote', 'Hybrid', 'On-site'] as const;
export const EXPERIENCE_LEVELS = ['Junior', 'Mid-level', 'Senior', 'Lead'] as const;

export interface JobFactsInput {
  title: string;
  description: string;
  rawPayload?: Record<string, unknown> | null;
}

export interface ApplicationEmailEvidence {
  excerpt: string;
  subjectLine?: string;
  /** The instruction asks for the position's name in the subject ("vəzifənin adını mövzu xanasında qeyd etməklə"): the subject is then the title itself. */
  subjectIsPositionName?: boolean;
  reference?: string;
  extractedFrom: 'description';
  extractorVersion: number;
}

export interface JobFacts {
  workArrangement: (typeof WORK_ARRANGEMENTS)[number] | null;
  experienceLevel: (typeof EXPERIENCE_LEVELS)[number] | null;
  applicationMethod: ApplicationMethod;
  applicationEmail: string | null;
  applicationEmailEvidence: ApplicationEmailEvidence | null;
}

const CAREER_LEVELS: Record<string, (typeof EXPERIENCE_LEVELS)[number]> = {
  'career-levels.entry': 'Junior',
  'career-levels.graduate': 'Junior',
  'career-levels.associate': 'Mid-level',
  'career-levels.mid': 'Mid-level',
  'career-levels.supervisor': 'Lead',
  'career-levels.executive': 'Lead',
};

function workArrangementOf(input: JobFactsInput): JobFacts['workArrangement'] {
  // Only an explicit structured flag or an explicit word in the title counts.
  // "Not remote" is not "on-site" (it may be hybrid), so it stays unknown.
  if (input.rawPayload?.isRemote === true) return 'Remote';
  const title = input.title.toLowerCase();
  if (/\bhybrid\b|\bhibrid\b/.test(title)) return 'Hybrid';
  if (/\bremote\b|\buzaqdan\b|\bдистанционно/.test(title)) return 'Remote';
  return null;
}

function experienceLevelOf(input: JobFactsInput): JobFacts['experienceLevel'] {
  const level = input.rawPayload?.careerLevel;
  if (typeof level === 'string' && CAREER_LEVELS[level]) return CAREER_LEVELS[level];
  const title = input.title.toLowerCase();
  if (/\bjunior\b|\bintern(ship)?\b|\bgraduate\b|təcrübəçi|başlanğıc/.test(title)) return 'Junior';
  if (/\bhead of\b|\bteam lead\b|\blead\b|\bunit head\b|bölümün rəhbəri|şöbə müdiri/.test(title)) return 'Lead';
  if (/\bsenior\b|\bsr\.? /.test(title)) return 'Senior';
  if (/\bmid[- ]level\b/.test(title)) return 'Mid-level';
  return null;
}

// ── Application e-mail evidence ─────────────────────────────────────────────
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;
// An address counts only when the sentence around it tells the candidate to SEND the application or CV there.
// Mentioning applying, or giving an address for questions, support or press, is not an instruction to apply: a
// contact address is never an application recipient. (Some sources flatten the posting to one line, so the
// context is the sentence around the address, not the line.)
const SEND_AFTER = /(\bcv\b|cv-|rezüme|resume|résumé|müraciət\w*|application\w*|резюме|заявк\w*)[^.!?\n]{0,90}(göndər\w*|send\w*|submit\w*|forward\w*|отправ\w*|присл\w*)/i;
const SEND_BEFORE = /(göndər\w*|send\w*|submit\w*|forward\w*|отправ\w*|присл\w*)[^.!?\n]{0,90}(\bcv\b|cv-|rezüme|resume|résumé|müraciət\w*|application\w*|резюме|заявк\w*)/i;
const APPLY_LABEL = /(müraciət üçün|müraciət ünvanı|müraciətlər üçün|cv ünvanı|how to apply|to apply|apply (?:to|at|via|by)|для отклика)\s*[:\-–]?\s*[^.!?\n]{0,25}$/i;
// The address stands under a label ("Email:", "Send to:") inside an application block ("TO APPLY: Please submit: …").
const ADDRESS_LABEL = /(?:^|\n)\s*(?:e-?mail(?: address)?|e-?poçt(?: ünvanı)?|send (?:it |them )?to|submit (?:it |them )?to|göndərin|göndərilməlidir)\s*[:\-–]?\s*$/i;
const APPLY_BLOCK_CUE = /(to apply|how to apply|application (?:instructions|procedure|requirements)|please (?:send|submit)|interested (?:candidates|applicants)|müraciət (?:qaydası|üçün)|necə müraciət|apply (?:by|via|to))/i;
const NOT_APPLY_CUE = /\b(unsubscribe|privacy|complain\w*|press|media inquiries|billing|invoice|questions?|inquir\w*|support|hotline|helpdesk)\b|şikayət|konfidensial|sual|əlavə məlumat|haqqında məlumat|qaynar xətt|texniki dəstək|вопрос\w*/i;
const PLACEHOLDER_DOMAINS = /@(example|test|localhost|domain|company|email|yourcompany)\.[a-z]+$|@example\./i;

const SUBJECT_QUOTED = /(?:subject(?: line)?|mövzu(?:su|sunda|\s+(?:sətri(?:ndə)?|hissəsində|yerində|xanasında))?|subyekt|тема(?: письма)?|в теме)\s*[:\-–]?\s*["“'«]([^"”'»\n]{3,140})["”'»]/i;
// "… to a@b.az indicating “Coordinator, Department of Economics”" / "with the subject …" (university announcements)
const SUBJECT_INDICATING = /(?:indicat(?:ing|ion)|mentioning|with (?:the )?(?:subject|title)|başlığı ilə|mövzusunda)\s*(?:of)?\s*[:\-–]?\s*["“'«]([^"”'»\n]{3,140})["”'»]/i;
const SUBJECT_PLAIN = /(?:subject(?: line)?|mövzu|тема(?: письма)?)\s*:\s*([^\n"”'»]{3,140})$/im;
// "put the name of the position in the subject field" in the languages these postings use; only read from the sentence that carries the address.
const SUBJECT_IS_TITLE = /(?:(?:vəzifənin|vakansiyanın|vəzifə|vakansiya)\s+(?:adını|adı)[^.!?\n]{0,80}(?:mövzu|subyekt)|(?:mövzu|subyekt)[^.!?\n]{0,60}(?:vəzifənin|vakansiyanın)\s+adı|(?:position|job|vacancy)\s+(?:title|name)[^.!?\n]{0,60}subject|subject[^.!?\n]{0,60}(?:position|job|vacancy)\s+(?:title|name))/i;
const REFERENCE = /(?:\bref(?:erence)?(?:\s+(?:no|number))?\.?|vakansiya kodu|vakansiya nömrəsi|код вакансии)\s*[:#№]\s*([A-Z0-9][A-Z0-9_\-/.]{2,30})/i;

/** The sentence-sized text around one occurrence of an address, widened to the previous line when the address stands alone. */
function localContext(text: string, index: number, length: number): { before: string; after: string; start: number; end: number } {
  const boundary = /[.!?•\n]\s|\n/g;
  const base = Math.max(0, index - 240);
  let start = base;
  for (const m of text.slice(base, index).matchAll(boundary)) start = base + (m.index ?? 0) + m[0].length;
  let end = Math.min(text.length, index + length + 160);
  const next = text.slice(index + length, end).search(boundary);
  if (next >= 0) end = index + length + next + 1;
  // An address alone on its line ("kadr@firma.az") is introduced by the previous line.
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  if (index - lineStart < 3 && lineStart > 0) start = Math.max(0, text.lastIndexOf('\n', lineStart - 2) + 1);
  return { before: text.slice(start, index), after: text.slice(index + length, end), start, end };
}

export function extractApplicationEmail(description: string): { email: string; evidence: ApplicationEmailEvidence } | null {
  const text = description.replace(/\r\n/g, '\n');
  const found = new Map<string, { start: number; end: number; at: number }>();
  for (const match of text.matchAll(EMAIL)) {
    const email = match[0].replace(/[.,;:]+$/, '').toLowerCase();
    if (email.length > 254 || PLACEHOLDER_DOMAINS.test(email) || /^(noreply|no-reply|donotreply|do-not-reply)@/.test(email)) continue;
    const ctx = localContext(text, match.index!, match[0].length);
    // The address itself contains dots, which would end the sentence in the patterns below: test with a placeholder.
    const local = `${ctx.before}ADDRESS${ctx.after}`.replace(EMAIL, 'ADDRESS');
    if (NOT_APPLY_CUE.test(local)) continue;
    const lead = text.slice(Math.max(0, match.index! - 700), match.index!);
    // "TO APPLY: Please send the following documents in PDF format by <date> to <address> email address": the instruction is the block, not one noun.
    const blockInstruction = APPLY_BLOCK_CUE.test(lead) && /\b(?:send|submit|forward|e-?mail|göndər\w*)\b[^.!?]{0,160}\b(?:to|at|via|ünvanına)\s*$/i.test(text.slice(Math.max(0, match.index! - 200), match.index!).replace(/\s+/g, ' '));
    const labelled = blockInstruction || (ADDRESS_LABEL.test(text.slice(Math.max(0, match.index! - 60), match.index!)) && APPLY_BLOCK_CUE.test(lead));
    if (!(SEND_AFTER.test(local) || SEND_BEFORE.test(local) || APPLY_LABEL.test(ctx.before.slice(-70)) || labelled)) continue;
    if (!found.has(email)) found.set(email, { start: ctx.start, end: ctx.end, at: match.index! });
  }
  // Two different addresses: the posting is ambiguous, so none is used.
  if (found.size !== 1) return null;
  const [[email, { start, end, at }]] = [...found.entries()];
  const window = text.slice(Math.max(0, start - 120), Math.min(text.length, end + 260));
  const subjectLine = (SUBJECT_QUOTED.exec(window)?.[1] ?? SUBJECT_INDICATING.exec(window)?.[1] ?? SUBJECT_PLAIN.exec(window)?.[1])?.trim();
  const reference = REFERENCE.exec(window)?.[1];
  const subjectIsPositionName = !subjectLine && SUBJECT_IS_TITLE.test(text.slice(Math.max(0, start - 40), end + 80));
  // Centered on the address, so a posting with no punctuation still shows the words around it.
  const excerpt = text.slice(Math.max(start, at - 220), Math.min(end, at + email.length + 160)).replace(/\s+/g, ' ').trim();
  return {
    email,
    evidence: {
      excerpt,
      ...(subjectLine && !new RegExp(EMAIL.source).test(subjectLine) ? { subjectLine } : {}),
      ...(subjectIsPositionName ? { subjectIsPositionName: true } : {}),
      ...(reference && /\d/.test(reference) ? { reference } : {}),
      extractedFrom: 'description',
      extractorVersion: FACTS_EXTRACTOR_VERSION,
    },
  };
}

// ── What the candidate must read before sending ─────────────────────────────
const APPLY_HEADING = /^(?:#+\s*)?(?:how to apply|to apply|how can i apply|application (?:process|instructions|procedure|requirements)|apply|müraciət(?: qaydası| qaydaları| üçün| etmək üçün)?|necə müraciət edə bilərsiniz)\b[^\n]{0,80}$/i;
// Work the employer asks for in addition to a CV and a letter. Conservative wording: it only decides whether the review screen warns, it never blocks.
const EXTRA_MATERIAL = /(?<![\p{L}\p{N}])(google\s*doc|google\s*sheet|test\s*(?:task|assignment)|assignment|exercise|case\s*study|take-?home|work\s*sample|writing\s*sample|samples?\s+of\s+(?:your\s+)?work|record\s+a\s+video|video\s*(?:introduction|cv|presentation)|portfolio|write\s+\d+|find\s+\d+|\d+\s+(?:comments?|posts?|examples?|samples?|slides?|links?)|tapşırıq|test\s+tapşırığı|nümunə\s+iş|esse|video\s+təqdimat)(?![\p{L}\p{N}])/iu;

/**
 * The application instruction as the posting wrote it: from its "How to apply" heading (or the paragraph around the address) through the sentence
 * that names the address. The address sentence alone ("Send the doc, your CV … to ali@x.com") can refer back to a task described just before it.
 */
export function applicationInstructionBlock(description: string, email: string): string | null {
  const lines = String(description ?? '').replace(/\r\n/g, '\n').split('\n');
  const needle = email.toLowerCase();
  const at = lines.findIndex((l) => l.toLowerCase().includes(needle));
  if (at < 0) return null;
  let start = -1;
  for (let i = at; i >= Math.max(0, at - 8); i--) {
    if (i < at && !lines[i].trim()) break; // a blank line ends the paragraph (a heading is still found above it only when adjacent)
    if (APPLY_HEADING.test(lines[i].trim())) { start = i; break; }
  }
  if (start < 0) {
    // no heading: the paragraph the address sits in, at most two lines before it
    start = at;
    while (start > Math.max(0, at - 2) && lines[start - 1].trim()) start--;
  }
  let end = at;
  while (end < Math.min(lines.length - 1, at + 2) && lines[end + 1].trim()) end++;
  const block = lines.slice(start, end + 1).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return block.length >= 20 ? block.slice(0, 900) : null;
}

/** Whether the instruction asks for something beyond a CV and a letter (a task, a document, samples). */
export function needsExtraMaterial(instruction: string | null | undefined): boolean {
  return !!instruction && EXTRA_MATERIAL.test(instruction);
}

export function deriveJobFacts(input: JobFactsInput): JobFacts {
  const email = extractApplicationEmail(input.description);
  return {
    workArrangement: workArrangementOf(input),
    experienceLevel: experienceLevelOf(input),
    applicationMethod: email ? 'EMAIL' : 'EXTERNAL_SITE',
    applicationEmail: email?.email ?? null,
    applicationEmailEvidence: email?.evidence ?? null,
  };
}
