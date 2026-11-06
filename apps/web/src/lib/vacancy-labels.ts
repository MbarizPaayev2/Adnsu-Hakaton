/**
 * Azerbaijani display labels for the vacancy enums.
 *
 * The stored values stay English on purpose — they are written to the DB by
 * the business vacancy form, already exist in rows created before this change,
 * and are read by the matching pipeline. Only the presentation is localized,
 * so translating a label can never invalidate stored data or matching.
 *
 * `labelFor` falls back to the raw value so a vacancy carrying an option this
 * map doesn't know about (older row, or a value added server-side) still
 * renders something rather than an empty chip.
 */

export const EXPERIENCE_LEVELS = [
  { value: "Junior", label: "Başlanğıc (Junior)" },
  { value: "Mid-level", label: "Orta səviyyə" },
  { value: "Senior", label: "Təcrübəli (Senior)" },
  { value: "Lead", label: "Rəhbər (Lead)" },
] as const;

export const WORK_FORMATS = [
  { value: "On-site", label: "Ofisdə" },
  { value: "Hybrid", label: "Hibrid" },
  { value: "Remote", label: "Uzaqdan" },
] as const;

export const EMPLOYMENT_TYPES = [
  { value: "Full-time", label: "Tam ştat" },
  { value: "Part-time", label: "Yarım ştat" },
  { value: "Contract", label: "Müqavilə ilə" },
  { value: "Internship", label: "Təcrübə proqramı" },
] as const;

type Option = { value: string; label: string };

function lookup(options: readonly Option[], value: string | null | undefined) {
  if (!value) return "";
  return options.find((o) => o.value === value)?.label ?? value;
}

export const experienceLevelLabel = (v?: string | null) =>
  lookup(EXPERIENCE_LEVELS, v);
export const workFormatLabel = (v?: string | null) => lookup(WORK_FORMATS, v);
export const employmentTypeLabel = (v?: string | null) =>
  lookup(EMPLOYMENT_TYPES, v);

/**
 * Application-question types.
 *
 * These values must stay in lockstep with QuestionType in
 * apps/api/src/vacancies/dto/create-question.dto.ts — the DTO validates them
 * with @IsEnum, so an unknown value fails the whole vacancy request. The form
 * previously offered "TEXT" and "FILE", neither of which is in that enum, so
 * every vacancy submitted with a question got a 400.
 */
export const QUESTION_TYPES = [
  { value: "SHORT_TEXT", label: "Qısa mətn" },
  { value: "LONG_TEXT", label: "Uzun mətn" },
  { value: "YES_NO", label: "Bəli / Xeyr" },
  { value: "MULTIPLE_CHOICE", label: "Seçim" },
  { value: "NUMBER", label: "Rəqəm" },
  { value: "FILE_UPLOAD", label: "Fayl yükləmə" },
] as const;

export type QuestionTypeValue = (typeof QUESTION_TYPES)[number]["value"];

export const questionTypeLabel = (v?: string | null) =>
  lookup(QUESTION_TYPES, v);
