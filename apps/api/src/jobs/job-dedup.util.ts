import { foldText, usableLocation } from './job-location.util';

/**
 * Conservative duplicate detection between job postings.
 *
 * A wrong "duplicate" hides a real opening from candidates, so the rules ask
 * for several independent agreements and lean toward "distinct":
 *  - postings from the SAME source are never linked automatically (its own
 *    stable id is authoritative; two identical postings there may be two
 *    headcounts). They are only reported as a possible repost for a person;
 *  - across sources, a posting is linked only when the destination URL matches
 *    AND the company matches AND the title or text agrees, or when company,
 *    title, exact location and near-identical text all agree within a window.
 * Nothing here deletes or merges rows.
 */

export type DuplicateKind = 'same_destination' | 'same_posting' | 'same_posting_location_unspecified' | 'possible_repost_same_source';

export interface DuplicateVerdict {
  kind: DuplicateKind;
  reason: string;
  /** Word-shingle similarity of the descriptions, 0..1. */
  similarity: number;
  /** Only cross-source verdicts are linked automatically. */
  autoLink: boolean;
}

export interface DedupJob {
  externalId: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  postedAt: Date;
}

const SAME_POSTING_SIMILARITY = 0.9;
const SAME_DESTINATION_SIMILARITY = 0.5;
const REPOST_SIMILARITY = 0.95;
// A source that states no city (ABB lists "Azerbaijan") cannot contradict another source's city, but only text that is
// essentially identical, published within days, may then stand in for the missing location.
const UNSPECIFIED_LOCATION_SIMILARITY = 0.98;
const UNSPECIFIED_LOCATION_WINDOW_MS = 3 * 24 * 3600_000;
const POSTED_WINDOW_MS = 45 * 24 * 3600_000;

const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|yclid|mc_cid|mc_eid|ref|referrer|source|src|islocal|lang|locale)$/i;

/**
 * A comparable form of a destination URL: https, lowercase host without `www.`,
 * no fragment, no tracking parameters, sorted parameters, no trailing slash.
 * A bare domain (no path, no query) names no particular posting, so it is null.
 */
export function canonicalizeUrl(raw: string | null | undefined): string | null {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/g, '');
  const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a], [b]) => a.localeCompare(b));
  if (!path && !params.length) return null;
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
  return `https://${host}${path}${query}`;
}

const LEGAL_SUFFIXES = /\b(mmc|asc|qsc|ojsc|llc|ltd|inc|gmbh|llp|cjsc|ooo|sc)\b/g;

export function normalizeCompany(name: string | null | undefined): string {
  return foldText(name)
    .replace(/[^a-z0-9а-я\s]/gi, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTitle(title: string | null | undefined): string {
  return foldText(title)
    .replace(/[^a-z0-9а-я\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A comparable place, or null when unknown/employment-type (unknown never matches). */
export function normalizeLocation(location: string | null | undefined): string | null {
  const place = usableLocation(location);
  if (!place) return null;
  const folded = foldText(place).replace(/[^a-z0-9а-я\s]/gi, ' ').replace(/\b(azerbaycan|azerbaijan)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return folded || null;
}

const isCountryOnly = (location: string | null | undefined) => /^(azerbaycan|azerbaijan|azerbaycan respublikasi|azerbaijan republic)$/.test(foldText(String(location ?? '')).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim());

function shingles(text: string, size = 3): Set<string> {
  const words = foldText(text).replace(/[^a-z0-9а-я\s]/gi, ' ').split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  if (words.length < size) return out;
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(' '));
  return out;
}

/** Jaccard similarity of word 3-shingles; 0 when either text is too short to judge. */
export function descriptionSimilarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (sa.size < 8 || sb.size < 8) return 0;
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export function sourceOf(externalId: string): string {
  const i = externalId.indexOf(':');
  return i > 0 ? externalId.slice(0, i) : externalId;
}

/** Verdict on whether `candidate` (newly seen) repeats `existing`, or null when distinct. */
export function compareJobs(candidate: DedupJob, existing: DedupJob): DuplicateVerdict | null {
  if (candidate.externalId === existing.externalId) return null;
  const sameCompany = normalizeCompany(candidate.company) !== '' && normalizeCompany(candidate.company) === normalizeCompany(existing.company);
  if (!sameCompany) return null;
  const sameTitle = normalizeTitle(candidate.title) !== '' && normalizeTitle(candidate.title) === normalizeTitle(existing.title);
  const similarity = descriptionSimilarity(candidate.description, existing.description);
  const locA = normalizeLocation(candidate.location);
  const sameLocation = locA !== null && locA === normalizeLocation(existing.location);

  if (sourceOf(candidate.externalId) === sourceOf(existing.externalId)) {
    if (sameTitle && sameLocation && similarity >= REPOST_SIMILARITY) {
      return { kind: 'possible_repost_same_source', reason: 'same company, title, location and text within one source', similarity, autoLink: false };
    }
    return null;
  }

  const urlA = canonicalizeUrl(candidate.url);
  if (urlA && urlA === canonicalizeUrl(existing.url) && (sameTitle || similarity >= SAME_DESTINATION_SIMILARITY)) {
    return { kind: 'same_destination', reason: 'same company, same destination URL and agreeing title or text', similarity, autoLink: true };
  }

  const withinWindow = Math.abs(candidate.postedAt.getTime() - existing.postedAt.getTime()) <= POSTED_WINDOW_MS;
  if (sameTitle && sameLocation && similarity >= SAME_POSTING_SIMILARITY && withinWindow) {
    return { kind: 'same_posting', reason: 'same company, title, location and near-identical text across sources', similarity, autoLink: true };
  }
  // Exactly one side names no city. Two DIFFERENT specific cities are distinct roles and never reach this rule.
  const locB = normalizeLocation(existing.location);
  // Only a stated country without a city counts; an empty or junk location says nothing and still never links.
  if (sameTitle && ((locA === null && isCountryOnly(candidate.location)) || (locB === null && isCountryOnly(existing.location))) && similarity >= UNSPECIFIED_LOCATION_SIMILARITY &&
      Math.abs(candidate.postedAt.getTime() - existing.postedAt.getTime()) <= UNSPECIFIED_LOCATION_WINDOW_MS) {
    return { kind: 'same_posting_location_unspecified', reason: 'same company and title, essentially identical text and publication day; one source states no city', similarity, autoLink: true };
  }
  return null;
}
