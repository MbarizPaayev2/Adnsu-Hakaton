import { GlorriJobRecord } from './glorri-scraper.types';
import { isEmploymentTypeLabel, usableLocation } from '../../jobs/job-location.util';

export function glorriExternalId(slug: string): string {
  return `glorri:${slug}`;
}

export function glorriDetailUrl(companySlug: string, slug: string): string {
  return `https://jobs.glorri.com/vacancies/${companySlug}/${slug}?isLocal=true`;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * The detail sidebar's "Son tarix" is an English date such as
 * "September 19, 2026". Returns the end of that day in Baku (UTC+4) as ISO,
 * or undefined for anything else — an unparseable deadline is never guessed.
 */
export function parseGlorriDeadline(value: string | undefined | null): string | undefined {
  const m = /^\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(value || '');
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 0 || day < 1 || day > 31) return undefined;
  const utc = Date.UTC(year, month, day, 23 - 4, 59, 59);
  if (new Date(utc + 4 * 3600_000).getUTCDate() !== day) return undefined; // e.g. February 30
  return new Date(utc).toISOString();
}

/**
 * Classifies the bullets of a Glorri detail page by what they are instead of by
 * position. The page lists company, location and employment type, but omits the
 * location for some postings; reading the second bullet as the location then
 * stored "Tam ştat" as the place. The first bullet is always the company; an
 * employment-type label is never a location; anything else is the location.
 */
export function classifyGlorriInfoItems(items: string[]): {
  company_name: string | null;
  location: string | null;
  employment_type: string | null;
} {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  const [company, ...rest] = clean;
  const employment = rest.find((item) => isEmploymentTypeLabel(item)) ?? null;
  const location = rest.find((item) => !isEmploymentTypeLabel(item)) ?? null;
  return { company_name: company ?? null, location, employment_type: employment };
}

/**
 * Shared by the live hourly scraper and the one-time backfill import so both
 * paths produce identical Job rows for the same source record.
 */
export function mapGlorriJobToIngestPayload(job: GlorriJobRecord, detailFetchedAt?: string) {
  const detail = job.detail;
  const companySlug = job.company?.slug || '';
  const deadline = parseGlorriDeadline(detail?.deadline);

  return {
    externalId: glorriExternalId(job.slug),
    title: detail?.title || job.title || 'Untitled',
    company: detail?.company_name || job.company?.name || 'Unknown',
    description: [detail?.description_text, detail?.requirements_text].filter(Boolean).join('\n\n'),
    // An employment type stored as the detail location (rows imported before
    // this fix, or a page that still misplaces it) falls back to the listing's
    // own location field, then to the country — never to a guessed city.
    location: usableLocation(detail?.location) || usableLocation(job.location) || 'Azerbaijan',
    url: glorriDetailUrl(companySlug, job.slug),
    postedAt: job.postedDate || new Date().toISOString(),
    ...(deadline ? { deadline } : {}),
    ...(detailFetchedAt ? { detailFetchedAt } : {}),
    rawPayload: job as unknown as Record<string, unknown>,
  };
}
