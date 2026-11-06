/**
 * Deterministic Azerbaijani date/number formatting.
 *
 * Deliberately not `toLocaleDateString()`:
 *
 *  - With no locale argument it follows the *viewer's* browser locale, so an
 *    Azerbaijani user on an en-US browser saw "9/3/2026". Twelve of the
 *    fourteen date renders in the app did this.
 *  - With "az-AZ" the output still differs by engine: Chrome returns the ISO
 *    "2026-09-03" while Node's ICU returns "03.09.2026". Because these dates
 *    render on both sides, that difference is also a React hydration mismatch,
 *    not just a cosmetic one. (Number grouping splits the same way — see
 *    groupAz in components/reveal.tsx.)
 *
 * Formatting the parts by hand gives one answer everywhere: DD.MM.YYYY, the
 * Azerbaijani convention.
 */

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** DD.MM.YYYY — returns "" for a missing or unparseable value. */
export function formatDate(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "";
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** DD.MM.YYYY HH:mm */
export function formatDateTime(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "";
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Thousands grouped with "." per Azerbaijani convention (1.000). */
export function formatNumber(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
