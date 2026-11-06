import type { CareerSections } from '../../career/career-selection';

type Section<K extends keyof CareerSections> = (Omit<CareerSections[K][number], 'entryId'> & { entryId?: string })[];

export interface PersonaBasics {
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  website: { url: string; label: string };
}

export interface PersonaExperience {
  entryId?: string;
  company: string;
  position: string;
  location: string;
  period: string;
  highlights: string[];
}

export interface PersonaEducation {
  school: string;
  degree: string;
  area: string;
  location: string;
  period: string;
  grade: string;
}

export interface PersonaSkill {
  name: string;
  keywords: string[];
  proficiency: string;
  level: number;
}

export interface Persona {
  basics: PersonaBasics;
  summary: string;
  experience: PersonaExperience[];
  education: PersonaEducation[];
  skills: PersonaSkill[];
  // Career evidence the candidate confirmed (see career/career-selection.ts); every item carries its source entryId.
  languages: Section<'languages'>;
  projects: Section<'projects'>;
  certifications: Section<'certifications'>;
  activities?: Section<'activities'>;
  awards?: Section<'awards'>;
  /** Letter material only: short situation/action/result stories the candidate wrote. Never rendered in a resume or CV. */
  stories?: CareerSections['stories'];
}

export interface TailorJobInput {
  id: string;
  position: string;
  company: string;
  location: string;
  education: string;
  experience: string;
  salary_from: string;
  salary_to: string;
  category: string;
  description: string;
  requirements: string;
  responsibilities: string;
}

export type TailoredContent = Persona & { language?: string; translationSources?: Record<string, { source: string; text: string }> };

/** A job-specific motivation letter. Paragraph ids are stable across edits so a candidate can approve or keep a paragraph through regeneration. */
export interface LetterParagraph {
  id: string;
  text: string;
  /** The candidate marked this paragraph as final: regeneration keeps it word for word. */
  approved?: boolean;
}

export interface LetterContent {
  kind: 'LETTER';
  language: string;
  basics: { name: string; email: string; phone: string; location: string };
  recipient: { company: string; position: string; location: string };
  /** ISO date (yyyy-mm-dd) the draft was written; rendered in the letter's language. */
  date: string;
  salutation: string;
  paragraphs: LetterParagraph[];
  closing: string;
  signature: string;
}

export type DocumentContent = TailoredContent | LetterContent;

export function isLetter(content: unknown): content is LetterContent {
  return !!content && typeof content === 'object' && (content as { kind?: unknown }).kind === 'LETTER';
}
