import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { bakuInstant } from './baku-time';
import { textWithBreaks } from './ejob.parser';

export const LINKEDIN_ORIGIN = 'https://www.linkedin.com';
export const LINKEDIN_AZ_ORIGIN = 'https://az.linkedin.com';
export const LINKEDIN_GEO_AZERBAIJAN = '100378370';

const clean = (value: string) => value.replace(/[\s\uFEFF\u00a0]+/g, ' ').trim();
const norm = (value: string) => clean(value).toLocaleLowerCase('az');

export interface ValidatedLinkedInJobUrl {
  valid: boolean;
  normalizedUrl?: string;
  jobId?: string;
  error?: string;
}

/**
 * Validates a LinkedIn job URL and guards against SSRF, credential embedding, non-standard ports, and malformed URLs.
 * Supports canonical /jobs/view/<id> as well as localized az.linkedin.com and title-slugged formats.
 */
export function validateLinkedInJobUrl(urlString: string): ValidatedLinkedInJobUrl {
  const trimmed = String(urlString ?? '').trim();
  if (!trimmed) {
    return { valid: false, error: 'LinkedIn vakansiya URL-i tələb olunur' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`);
  } catch {
    return { valid: false, error: 'Keçid formatı düzgün deyil' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, error: 'Yalnız HTTPS/HTTP keçidləri dəstəklənir' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Keçiddə istifadəçi adı və ya şifrə ola bilməz' };
  }

  if (parsed.port && parsed.port !== '443' && parsed.port !== '80') {
    return { valid: false, error: 'Keçiddə qeyri-standart port istifadə edilə bilməz' };
  }

  const host = parsed.hostname.toLowerCase();
  // Restrict to hosts LinkedIn itself uses for public jobs. Accepting every
  // subdomain expands the fetch surface without helping the supported flow.
  const isLinkedInHost = ['linkedin.com', 'www.linkedin.com', 'az.linkedin.com'].includes(host);
  if (!isLinkedInHost) {
    return { valid: false, error: 'Yalnız rəsmi LinkedIn vakansiya keçidləri qəbul edilir' };
  }

  // Path must match /jobs/view/<jobId> or /jobs/view/<title-slug>-<jobId>
  const match = parsed.pathname.match(/^\/jobs\/view\/(?:[a-z0-9-]+-)?(\d{6,14})\/?$/i);
  if (!match) {
    return { valid: false, error: 'LinkedIn vakansiya keçidi formatı: https://www.linkedin.com/jobs/view/123456789' };
  }

  const jobId = match[1];
  return {
    valid: true,
    normalizedUrl: `https://www.linkedin.com/jobs/view/${jobId}`,
    jobId,
  };
}

export interface LinkedInListingEntry {
  id: string;
  url: string;
  title: string;
  company: string;
  location: string;
  postedDate?: string;
}

/**
 * Parses LinkedIn's public guest job search carousel/HTML fragment:
 * https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?location=Azerbaijan&geoId=100378370
 */
export function parseLinkedInSearchListing(html: string): LinkedInListingEntry[] {
  const $ = cheerio.load(html);
  const entries = new Map<string, LinkedInListingEntry>();

  $('li').each((_, li) => {
    const card = $(li).find('.job-search-card, .base-card, .base-search-card').first();
    const container = card.length ? card : $(li);

    const urn = container.attr('data-entity-urn') || container.find('[data-entity-urn]').attr('data-entity-urn') || '';
    const urnMatch = /urn:li:jobPosting:(\d{6,14})/.exec(urn);

    const link = container.find('a[href*="/jobs/view/"]').first();
    const href = link.attr('href') || '';
    const linkMatch = /\/jobs\/view\/(?:[a-z0-9-]+-)?(\d{6,14})/.exec(href);

    const id = urnMatch?.[1] || linkMatch?.[1];
    if (!id) return;

    const titleEl = container.find('.base-search-card__title, .job-search-card__title, h3, h4').first();
    const title = clean(titleEl.text());

    const companyEl = container.find('.base-search-card__subtitle, .job-search-card__company-name, h4 a, .base-search-card__subtitle a').first();
    const company = clean(companyEl.text());

    const locationEl = container.find('.job-search-card__location, .base-search-card__metadata span').first();
    const location = clean(locationEl.text());

    const timeEl = container.find('time').first();
    const postedDate = timeEl.attr('datetime') || clean(timeEl.text()) || undefined;

    if (!title || !company) return;

    // Reject non-Azerbaijan listings if explicit foreign location is present
    if (location && (isExplicitForeignLocation(location) || !isAzerbaijanLocation(location))) return;

    const url = `https://www.linkedin.com/jobs/view/${id}`;
    if (!entries.has(id)) {
      // Missing location is unknown. Never turn it into a guessed Baku location.
      entries.set(id, { id, url, title, company, location, postedDate });
    }
  });

  return [...entries.values()];
}

function readJobPostingJsonLd($: cheerio.CheerioAPI): Record<string, any> | null {
  let result: Record<string, any> | null = null;
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const parsed = JSON.parse($(element).text());
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const found = rows.find((row) => row && (row['@type'] === 'JobPosting' || row['@type']?.includes?.('JobPosting')));
      if (found) result = found;
    } catch {
      // ignore invalid json-ld scripts
    }
  });
  return result;
}

export function isExplicitForeignLocation(loc: string): boolean {
  const l = loc.toLowerCase();
  const foreignIndicators = [
    'united kingdom', 'london', 'united states', 'california', 'new york', 'germany', 'berlin',
    'france', 'paris', 'turkey', 'istanbul', 'ankara', 'russia', 'moscow', 'uae', 'dubai',
    'georgia', 'tbilisi', 'ukraine', 'kyiv', 'canada', 'toronto', 'poland', 'warsaw',
  ];
  return foreignIndicators.some((indicator) => l.includes(indicator));
}

export function isAzerbaijanLocation(loc: string, countryCode?: string): boolean {
  const country = clean(countryCode ?? '').toLocaleLowerCase('en');
  if (loc && isExplicitForeignLocation(loc)) return false;
  if (country) return /^(?:az|aze|azerbaijan|azerbaijani republic)$/.test(country);
  if (!loc) return false;
  const l = norm(loc);
  const azIndicators = [
    'azerbaijan', 'azərbaycan', 'baku', 'bakı', 'sumqayit', 'sumqayıt', 'ganja', 'gəncə',
    'mingachevir', 'mingəçevir', 'shirvan', 'şirvan', 'nakhchivan', 'naxçıvan', 'khirdalan', 'xırdalan',
    'absheron', 'abşeron', 'qaradağ', 'garadagh',
  ];
  return azIndicators.some((indicator) => new RegExp(`(?:^|[^\\p{L}])${indicator.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?:$|[^\\p{L}])`, 'iu').test(l));
}

export function isLinkedInJobClosed(html: string): boolean {
  if (!html) return false;
  return (
    /No longer accepting applications/i.test(html) ||
    /Bu vakansiya artıq aktiv deyil/i.test(html) ||
    /This job is closed/i.test(html) ||
    /This job is no longer available/i.test(html) ||
    /<span[^>]*class="[^"]*closed-job[^"]*"[^>]*>/i.test(html) ||
    /figure class="closed-job"/i.test(html)
  );
}

/**
 * High-quality parser for LinkedIn vacancy pages.
 * Prioritizes official Schema.org JobPosting structured JSON-LD and falls back to semantic DOM selectors.
 * Enforces Azerbaijan location verification and closure detection.
 */
export function parseLinkedInJobDetail(
  html: string,
  inputUrl: string,
  fetchedAt: Date,
  listingEntry?: LinkedInListingEntry,
): IngestJobDto {
  const validated = validateLinkedInJobUrl(inputUrl);
  if (!validated.valid || !validated.normalizedUrl || !validated.jobId) {
    throw new Error(validated.error || 'LinkedIn URL formatı düzgün deyil');
  }

  const id = validated.jobId;
  const canonicalUrl = validated.normalizedUrl;

  if (isLinkedInJobClosed(html)) {
    throw new Error('LinkedIn vacancy is closed and no longer accepting applications');
  }

  const $ = cheerio.load(html);
  const ld = readJobPostingJsonLd($);

  // 1. Title Extraction
  let title = clean(String(ld?.title ?? ''));
  if (!title) {
    title = clean($('h1.top-card-layout__title, h1.topcard__title, .topcard__flavor--black-link').first().text());
  }
  if (!title && listingEntry?.title) {
    title = clean(listingEntry.title);
  }
  if (!title) {
    throw new Error('Missing LinkedIn vacancy title');
  }

  // 2. Company Extraction
  let company = clean(String(ld?.hiringOrganization?.name ?? ''));
  if (!company) {
    company = clean($('a.topcard__org-name-link, .topcard__flavor--first-link, [data-tracking-control-name="public_jobs_topcard-org-name"]').first().text());
  }
  if (!company && listingEntry?.company) {
    company = clean(listingEntry.company);
  }
  if (!company) {
    throw new Error('Missing LinkedIn vacancy company');
  }

  // 3. Location Verification
  const countryValue = ld?.jobLocation?.address?.addressCountry;
  const ldCountry = clean(
    typeof countryValue === 'string'
      ? countryValue
      : String(countryValue?.name ?? countryValue?.identifier ?? ''),
  );
  const ldLocality = clean(String(ld?.jobLocation?.address?.addressLocality ?? ''));
  const ldRegion = clean(String(ld?.jobLocation?.address?.addressRegion ?? ''));
  const domLocation = clean($('span.topcard__flavor--bullet, .top-card-layout__first-subline .topcard__flavor--bullet').first().text());
  const rawLocation = [ldLocality, ldRegion, ldCountry, domLocation, listingEntry?.location].filter(Boolean).join(', ');

  if (!isAzerbaijanLocation(rawLocation, ldCountry)) {
    throw new Error(`LinkedIn vacancy is not located in Azerbaijan: ${rawLocation || 'Unknown location'}`);
  }
  const location = ldLocality
    ? `${ldLocality}, Azerbaijan`
    : ldRegion
      ? `${ldRegion}, Azerbaijan`
      : domLocation && isAzerbaijanLocation(domLocation)
        ? domLocation
        : listingEntry?.location && isAzerbaijanLocation(listingEntry.location)
          ? listingEntry.location
          : 'Azerbaijan';

  // 4. Description Extraction
  let description = '';
  if (ld?.description) {
    const descDoc = cheerio.load(`<div id="desc-wrapper">${String(ld.description)}</div>`);
    description = textWithBreaks(descDoc, descDoc('#desc-wrapper'));
  }
  if (!description) {
    const descEl = $('.show-more-less-html__markup, .description__text, .decoratedJobPosting .description').first();
    if (descEl.length) {
      description = textWithBreaks($, descEl);
    }
  }
  if (!description) {
    throw new Error('Missing LinkedIn vacancy description');
  }

  // 5. Date Posted
  const postedAtRaw = ld?.datePosted ? String(ld.datePosted) : $('time').first().attr('datetime');
  let postedAt: string | undefined;
  if (postedAtRaw) {
    const date = new Date(postedAtRaw);
    if (Number.isFinite(date.getTime())) {
      postedAt = date.toISOString();
      if (date.getTime() > fetchedAt.getTime() + 24 * 60 * 60 * 1000) {
        throw new Error('LinkedIn publication date is in the future');
      }
    }
  }
  if (!postedAt) {
    postedAt = fetchedAt.toISOString();
  }

  // 6. Deadline / Valid Through
  let deadline: string | undefined;
  if (ld?.validThrough && clean(String(ld.validThrough))) {
    deadline = bakuInstant(String(ld.validThrough), 'end');
  }

  // 7. Sanity Checks
  if (title.length > 500 || company.length > 256 || description.length > MAX_JOB_DESCRIPTION_CHARS) {
    throw new Error('Incomplete or invalid LinkedIn vacancy detail length');
  }

  return {
    externalId: `linkedin:${id}`,
    title,
    company,
    location,
    description,
    url: canonicalUrl,
    postedAt,
    ...(deadline ? { deadline } : {}),
    detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: {
      source: 'linkedin',
      employmentType: Array.isArray(ld?.employmentType) ? ld.employmentType.join(', ') : ld?.employmentType ?? null,
      sourceAttribution: LINKEDIN_ORIGIN,
    },
  };
}
