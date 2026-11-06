/**
 * Glorri's detail page lists "company, location, employment type" as bullets
 * and the listing API sometimes carries the employment type on its own. A value
 * such as "Tam ştat" says how a job is worked, never where, so it must never be
 * stored as a location (it made ~118 postings unfindable by city and penalised
 * them in matching). Matching is on folded text so "Tam ştat", "tam stat" and
 * "TAM ŞTAT" are the same label.
 */
const EMPLOYMENT_TYPE_LABELS = new Set([
  'tam stat',
  'yarim stat',
  'novbe esasinda',
  'konullu',
  'muveqqeti',
  'tecrube',
  'frilans',
  'full time',
  'full-time',
  'part time',
  'part-time',
  'freelance',
  'internship',
  'contract',
  'temporary',
]);

const AZ_FOLD: Record<string, string> = { ə: 'e', ı: 'i', ğ: 'g', ş: 's', ö: 'o', ü: 'u', ç: 'c' };

export function foldText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[əığşöüç]/g, (c) => AZ_FOLD[c] ?? c)
    .replace(/[.,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isEmploymentTypeLabel(value: string | null | undefined): boolean {
  return EMPLOYMENT_TYPE_LABELS.has(foldText(value));
}

/** The value as a location, or null when it is empty or really an employment type. */
export function usableLocation(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed && !isEmploymentTypeLabel(trimmed) ? trimmed : null;
}
