import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { bakuInstant } from './baku-time';
import { validateAzerbaijanLocation } from './public-job-collector';
import { textWithBreaks } from './ejob.parser';

export const HRIN_ORIGIN = 'https://hrin.az';
const clean = (value: string) => value.replace(/[\s\uFEFF]+/g, ' ').trim();
const norm = (value: string) => clean(value).toLocaleLowerCase('az');

/** Public vacancy pages only. Candidate/profile, employer, application and API paths are never valid targets. */
export function hrinUrl(input: string): string {
  const url = new URL(input, HRIN_ORIGIN);
  if (url.origin !== HRIN_ORIGIN || url.username || url.password || /%2e|%2f|%5c/i.test(url.pathname) ||
      !(url.pathname === '/robots.txt' || url.pathname === '/sitemap.xml' || url.pathname === '/vakansiyalar' || /^\/vakansiya\/[a-z0-9-]+-\d{1,8}$/.test(url.pathname))) {
    throw new Error('Unsupported public HRIN URL');
  }
  // No query parameters are needed for these public documents. Drop them so identity and path checks stay exact.
  url.search = '';
  url.hash = '';
  return url.href;
}

export interface HrinListingEntry { id: string; url: string; title: string }

/** HRIN currently server-renders a bounded first page. We deliberately do not infer pagination or a full active census. */
export function parseHrinListing(html: string): HrinListingEntry[] {
  const $ = cheerio.load(html);
  const entries = new Map<string, HrinListingEntry>();
  $('main a[href^="/vakansiya/"]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;
    try {
      const url = hrinUrl(new URL(href, HRIN_ORIGIN).href);
      const match = /-(\d{1,8})$/.exec(new URL(url).pathname);
      const title = clean($(element).find('p').first().text()) || clean($(element).attr('aria-label') || '');
      if (!match || !title || title.length > 500) return;
      const id = match[1];
      entries.set(id, { id, url, title });
    } catch { /* navigation and unrelated links are not postings */ }
  });
  if (!entries.size) throw new Error('HRIN listing has no recognizable public vacancy cards');
  return [...entries.values()];
}

function readJobPosting($: cheerio.CheerioAPI): Record<string, any> | null {
  let result: Record<string, any> | null = null;
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const parsed = JSON.parse($(element).text());
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const found = rows.find((row) => row && row['@type'] === 'JobPosting');
      if (found) result = found;
    } catch { /* invalid structured data is not trusted */ }
  });
  return result;
}

export function parseHrinDetail(html: string, inputUrl: string, fetchedAt: Date, listingEntry?: HrinListingEntry): IngestJobDto {
  const url = hrinUrl(inputUrl);
  const match = /^\/vakansiya\/[a-z0-9-]+-(\d{1,8})$/.exec(new URL(url).pathname);
  const id = match?.[1];
  if (!id) throw new Error('Missing HRIN vacancy id');
  if (listingEntry && (listingEntry.id !== id || hrinUrl(listingEntry.url) !== url)) throw new Error('HRIN listing entry does not match detail URL');

  const $ = cheerio.load(html);
  const ld = readJobPosting($);
  if (!ld) throw new Error('HRIN JobPosting structured data missing');
  const identifier = ld.identifier?.value ?? ld.identifier;
  if (identifier !== undefined && String(identifier) !== id) throw new Error('HRIN structured data identifier mismatch');
  const canonicalRaw = $('link[rel="canonical"]').attr('href');
  if (!canonicalRaw) throw new Error('HRIN canonical URL missing');
  let canonical: string;
  try { canonical = hrinUrl(new URL(canonicalRaw, url).href); } catch { throw new Error('HRIN canonical URL invalid'); }
  if (canonical !== url) throw new Error('HRIN canonical URL does not match requested vacancy');
  if (ld.url && hrinUrl(new URL(String(ld.url), url).href) !== url) throw new Error('HRIN structured data URL mismatch');

  const title = clean(String(ld.title ?? ''));
  const domTitle = clean($('main h1').first().text());
  if (domTitle && norm(title) !== norm(domTitle)) throw new Error('HRIN structured data and visible title disagree');
  if (listingEntry && norm(title) !== norm(listingEntry.title)) throw new Error('HRIN listing and detail titles disagree');
  const company = clean(String(ld.hiringOrganization?.name ?? ''));
  const descriptionHtml = String(ld.description ?? '');
  const descriptionDocument = cheerio.load(`<div id="hrin-description">${descriptionHtml}</div>`);
  const description = textWithBreaks(descriptionDocument, descriptionDocument('#hrin-description'));
  const postedAtRaw = ld.datePosted ? String(ld.datePosted) : '';
  const postedAtDate = postedAtRaw ? new Date(postedAtRaw) : null;
  const postedAt = postedAtDate && Number.isFinite(postedAtDate.getTime()) ? postedAtDate.toISOString() : undefined;
  if (postedAt && new Date(postedAt).getTime() > fetchedAt.getTime() + 24 * 60 * 60 * 1000) throw new Error('HRIN publication date is in the future');

  let deadline: string | undefined;
  if (ld.validThrough !== undefined && ld.validThrough !== null && clean(String(ld.validThrough))) {
    deadline = bakuInstant(String(ld.validThrough), 'end');
    if (!deadline) throw new Error(`Malformed HRIN deadline: ${String(ld.validThrough).slice(0, 40)}`);
  }
  if (!title || title.length > 500 || !company || company.length > 256 || !description || description.length > MAX_JOB_DESCRIPTION_CHARS || !postedAt) {
    throw new Error('Incomplete or invalid HRIN vacancy detail');
  }

  const locationData = ld.jobLocation;
  const location = validateAzerbaijanLocation(locationData, 'Azerbaijan');
  const countryRaw = locationData?.address?.addressCountry;
  const country = typeof countryRaw === 'object' ? countryRaw?.name : countryRaw;
  const locationKnown = Boolean(locationData && (!country || ['AZ', 'AZE', 'Azerbaijan', 'Azərbaycan'].includes(String(country))));
  const salary = ld.baseSalary?.value
    ? `${ld.baseSalary.value.minValue ?? ''}${ld.baseSalary.value.maxValue !== undefined ? `-${ld.baseSalary.value.maxValue}` : ''} ${ld.baseSalary.currency ?? ''}`.trim()
    : null;
  return {
    externalId: `hrin:${id}`, title, company, description, location, url, postedAt,
    ...(deadline ? { deadline } : {}), detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: {
      source: 'hrin', locationKnown,
      employmentType: Array.isArray(ld.employmentType) ? ld.employmentType.join(', ') : ld.employmentType ?? null,
      salary, postedAtEvidence: 'jsonld', deadlineEvidence: deadline ? 'jsonld_validThrough' : null,
      sourceAttribution: HRIN_ORIGIN,
    },
  };
}
