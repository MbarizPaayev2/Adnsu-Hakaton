/**
 * Client-side filtering of the matches an account is already entitled to see.
 *
 * Nothing here talks to the API or touches fit scores: it only narrows the
 * list that the server returned. Only fields that the /matches response
 * really supplies are used (title, matched skills, vacancy requirements,
 * company name, free-text location, used as written). Category, experience level, work format
 * and source are NOT part of the match payload, so there is deliberately no
 * filter for them — see docs/discovery-ux-handoff-2026-10-03.md.
 */

export interface FilterableMatch {
  id: string;
  status: string;
  details?: { matchedKeywords?: string[]; gaps?: string[] } | null;
  job?: { title?: string; company?: string; location?: string } | null;
  vacancy?: {
    title?: string;
    requirements?: string | null;
    location?: string | null;
    company?: { name?: string } | null;
  } | null;
}

export interface MatchCriteria {
  status: string; // 'all' | 'new' | 'viewed' | 'applied' | 'dismissed'
  query: string;
  company: string; // '' = all companies
  city: string; // '' = all cities
}

export const EMPTY_CRITERIA: MatchCriteria = { status: 'all', query: '', company: '', city: '' };

/** Azerbaijani-aware, case- and whitespace-insensitive normalisation. */
export function normalizeAz(value: string | null | undefined): string {
  return (value ?? '').toLocaleLowerCase('az').replace(/\s+/g, ' ').trim();
}

export function companyOf(match: FilterableMatch): string {
  return (match.job?.company || match.vacancy?.company?.name || '').trim();
}

export function titleOf(match: FilterableMatch): string {
  return (match.job?.title || match.vacancy?.title || '').trim();
}

const COUNTRY_ONLY = new Set(['azərbaycan', 'azerbaijan', 'азербайджан', 'azerbaycan']);

/**
 * Postings carry a free-text location ("Bakı", "Bakı, Azərbaycan", "Bakı, Nərimanov rayonu", "Bakı; Sumqayıt", "Uzaqdan"). There is no
 * structured city field in the match payload, so nothing is cut at the first comma and no city is guessed: the label is the posting's own
 * text, minus a trailing country name ("Bakı, Azərbaycan" and "Bakı" are the same label). A value that is only a country, or empty, has no
 * usable location (""); "Uzaqdan"/"Remote" is a work arrangement and is shown as the posting wrote it, not as a city.
 */
export function locationOf(match: FilterableMatch): string {
  const raw = (match.job?.location || match.vacancy?.location || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  while (parts.length && COUNTRY_ONLY.has(normalizeAz(parts[parts.length - 1]))) parts.pop();
  return parts.join(', ');
}

/** @deprecated kept for old imports; this is the raw location label, not an extracted city. */
export const cityOf = locationOf;

function searchableText(match: FilterableMatch): string {
  // Title + matched skill evidence + vacancy requirements. Gaps are what the
  // candidate is MISSING, so they never make a match "contain" a skill.
  const parts = [titleOf(match), ...(match.details?.matchedKeywords ?? []), match.vacancy?.requirements ?? ''];
  return normalizeAz(parts.join(' \n '));
}

export function matchesQuery(match: FilterableMatch, query: string): boolean {
  const tokens = normalizeAz(query).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const haystack = searchableText(match);
  return tokens.every((token) => haystack.includes(token));
}

export function applyMatchCriteria<T extends FilterableMatch>(matches: T[], criteria: MatchCriteria): T[] {
  const company = normalizeAz(criteria.company);
  const city = normalizeAz(criteria.city);
  return matches.filter((match) => {
    if (criteria.status !== 'all' && match.status !== criteria.status.toUpperCase()) return false;
    if (company && normalizeAz(companyOf(match)) !== company) return false;
    if (city && normalizeAz(locationOf(match)) !== city) return false;
    return matchesQuery(match, criteria.query);
  });
}

function distinct(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const key = normalizeAz(value);
    if (key && !seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'az'));
}

/** Options come from the full visible dataset so one filter never erases the others. */
export function companyOptions(matches: FilterableMatch[]): string[] {
  return distinct(matches.map(companyOf));
}

export function cityOptions(matches: FilterableMatch[]): string[] {
  return distinct(matches.map(locationOf));
}

/** The most frequent matched skills — suggestions that the data really supports. */
export function skillSuggestions(matches: FilterableMatch[], limit = 12): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const match of matches) {
    for (const keyword of match.details?.matchedKeywords ?? []) {
      const key = normalizeAz(keyword);
      if (!key) continue;
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { label: keyword.trim(), count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'az'))
    .slice(0, limit)
    .map((entry) => entry.label);
}

/** Number of criteria currently narrowing the list (status counts as a filter). */
export function activeCriteriaCount(criteria: MatchCriteria): number {
  return [criteria.status !== 'all', !!normalizeAz(criteria.query), !!criteria.company, !!criteria.city].filter(Boolean).length;
}
