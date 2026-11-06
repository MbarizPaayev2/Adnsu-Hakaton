import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { parseStrictIsoDate } from './public-job-collector';

export const GREENHOUSE_API_ORIGIN = 'https://boards-api.greenhouse.io';
export const GREENHOUSE_JOB_BOARDS_ORIGIN = 'https://job-boards.greenhouse.io';
export const GREENHOUSE_BOARDS_ORIGIN = 'https://boards.greenhouse.io';

/**
 * Curated and verified Greenhouse tenants with official employer career links.
 */
export const GREENHOUSE_TENANTS = {
  wolt: {
    employer: 'wolt',
    boardToken: 'wolt',
    company: 'Wolt Azerbaijan',
    locationFilter: 'Azerbaijan',
    verified: '2026-10-27',
    evidence: 'Official site https://careers.wolt.com links to https://job-boards.greenhouse.io/wolt; public API https://boards-api.greenhouse.io/v1/boards/wolt/jobs; verified active requisition in Baku under Wolt Services Azerbaijan LLC',
  },
} as const;

export type GreenhouseTenant = keyof typeof GREENHOUSE_TENANTS;
export const GREENHOUSE_SOURCES = Object.keys(GREENHOUSE_TENANTS) as GreenhouseTenant[];

/**
 * Validates and normalizes Greenhouse API and career board URLs.
 */
export function greenhouseUrl(tenant: GreenhouseTenant, input: string): string {
  const config = GREENHOUSE_TENANTS[tenant];
  if (!config) throw new Error(`Unknown Greenhouse tenant: "${tenant}"`);

  let url: URL;
  try {
    url = new URL(input, GREENHOUSE_API_ORIGIN);
  } catch {
    throw new Error('Unsupported Greenhouse URL: malformed');
  }

  const allowedOrigins = [GREENHOUSE_API_ORIGIN, GREENHOUSE_JOB_BOARDS_ORIGIN, GREENHOUSE_BOARDS_ORIGIN];
  if (!allowedOrigins.includes(url.origin)) {
    throw new Error('Unsupported Greenhouse URL: wrong origin');
  }
  if (url.username || url.password) {
    throw new Error('Unsupported Greenhouse URL: credentials');
  }
  if (/%2e|%2f|%5c/i.test(url.pathname)) {
    throw new Error('Unsupported Greenhouse URL: path traversal');
  }

  // API endpoint validation
  if (url.origin === GREENHOUSE_API_ORIGIN) {
    if (url.pathname === '/robots.txt') return url.href;

    const listPath = `/v1/boards/${config.boardToken}/jobs`;
    const detailRegex = new RegExp(`^/v1/boards/${config.boardToken}/jobs/(\\d+)$`);

    if (url.pathname === listPath) {
      if (url.search && url.search !== '?content=true') {
        throw new Error('Unsupported Greenhouse API URL: unexpected query');
      }
      return url.href;
    }

    if (detailRegex.test(url.pathname)) {
      if (url.search) {
        throw new Error('Unsupported Greenhouse API URL: unexpected query on detail');
      }
      return url.href;
    }

    throw new Error('Unsupported Greenhouse API URL: invalid path');
  }

  // Web career board validation (job-boards.greenhouse.io or boards.greenhouse.io)
  if (url.pathname === '/robots.txt') return url.href;

  const boardLandingRegex = new RegExp(`^/${config.boardToken}/?$`);
  const jobDetailRegex = new RegExp(`^/${config.boardToken}/jobs/(\\d+)$`);

  if (boardLandingRegex.test(url.pathname)) {
    return `${url.origin}/${config.boardToken}`;
  }

  const match = jobDetailRegex.exec(url.pathname);
  if (match) {
    // Strip query and hash fragments for the canonical vacancy URL
    return `${url.origin}/${config.boardToken}/jobs/${match[1]}`;
  }

  throw new Error('Unsupported Greenhouse URL: invalid board path');
}

export function greenhouseListApiUrl(tenant: GreenhouseTenant): string {
  const config = GREENHOUSE_TENANTS[tenant];
  return `${GREENHOUSE_API_ORIGIN}/v1/boards/${config.boardToken}/jobs`;
}

export function greenhouseDetailApiUrl(tenant: GreenhouseTenant, jobId: string | number): string {
  const config = GREENHOUSE_TENANTS[tenant];
  const idStr = String(jobId).trim();
  if (!/^\d+$/.test(idStr)) throw new Error(`Invalid Greenhouse jobId: "${jobId}"`);
  return `${GREENHOUSE_API_ORIGIN}/v1/boards/${config.boardToken}/jobs/${idStr}`;
}

export function greenhouseCanonicalJobUrl(tenant: GreenhouseTenant, jobId: string | number): string {
  const config = GREENHOUSE_TENANTS[tenant];
  const idStr = String(jobId).trim();
  if (!/^\d+$/.test(idStr)) throw new Error(`Invalid Greenhouse jobId: "${jobId}"`);
  return `${GREENHOUSE_JOB_BOARDS_ORIGIN}/${config.boardToken}/jobs/${idStr}`;
}

export interface GreenhouseSummaryItem {
  id: string;
  title: string;
  updatedAt: string;
  locationName: string;
  absoluteUrl: string;
}

export interface GreenhouseListingResult {
  totalDiscovered: number;
  skippedNonMatching: number;
  invalid: number;
  coverageVerified: boolean;
  matchingJobs: GreenhouseSummaryItem[];
}

const clean = (text: string) => text.replace(/[\s\uFEFF]+/g, ' ').trim();

/**
 * Checks whether a Greenhouse job listing matches Azerbaijan location criteria.
 */
export function isAzerbaijanGreenhouseJob(job: any, locationFilter?: string): boolean {
  if (!job || typeof job !== 'object') return false;

  const locName = typeof job.location?.name === 'string' ? clean(job.location.name) : '';
  const isAzString = (s: string) => /(?:^|[^\p{L}\p{N}])(?:baku|bakı|azerbaijan|az[əe]rbaycan)(?:$|[^\p{L}\p{N}])/iu.test(s);

  if (isAzString(locName)) return true;
  // A foreign explicit location wins over unrelated office or entity metadata.
  if (locName && !/^remote(?:\s|$|,|-)/iu.test(locName)) return false;
  // A remote/unspecified role is included only when the job itself has an explicit AZ market.
  return Array.isArray(job.metadata) && job.metadata.some((m: any) =>
    typeof m?.name === 'string' && /^market$/iu.test(clean(m.name)) &&
    typeof m.value === 'string' && isAzString(clean(m.value)));
}

/**
 * Parses Greenhouse jobs list JSON.
 */
export function parseGreenhouseListing(
  tenant: GreenhouseTenant,
  rawJson: string | unknown,
): GreenhouseListingResult {
  const config = GREENHOUSE_TENANTS[tenant];
  if (!config) throw new Error(`Unknown Greenhouse tenant: "${tenant}"`);

  let data: any;
  if (typeof rawJson === 'string') {
    try {
      data = JSON.parse(rawJson);
    } catch {
      throw new Error('Invalid Greenhouse listing JSON');
    }
  } else {
    data = rawJson;
  }

  if (!data || !Array.isArray(data.jobs)) {
    throw new Error('Greenhouse listing payload missing jobs array');
  }

  const result: GreenhouseListingResult = {
    totalDiscovered: 0,
    skippedNonMatching: 0,
    invalid: 0,
    coverageVerified: Number.isInteger(data.meta?.total) && data.meta.total === data.jobs.length,
    matchingJobs: [],
  };

  const seenIds = new Set<string>();

  for (const item of data.jobs) {
    result.totalDiscovered++;
    if (!item || typeof item !== 'object') {
      result.invalid++;
      continue;
    }

    const id = item.id !== undefined && item.id !== null ? String(item.id).trim() : '';
    if (!id || !/^\d+$/.test(id) || seenIds.has(id)) {
      result.invalid++;
      continue;
    }
    seenIds.add(id);

    if (!isAzerbaijanGreenhouseJob(item, config.locationFilter)) {
      result.skippedNonMatching++;
      continue;
    }

    const title = typeof item.title === 'string' ? clean(item.title) : '';
    if (!title) {
      result.invalid++;
      continue;
    }

    const locationName = typeof item.location?.name === 'string' ? clean(item.location.name) : '';
    const absoluteUrl = typeof item.absolute_url === 'string' && item.absolute_url.trim()
      ? greenhouseUrl(tenant, item.absolute_url.trim())
      : greenhouseCanonicalJobUrl(tenant, id);
    if (new URL(absoluteUrl).pathname.split('/').pop() !== id) {
      result.invalid++;
      continue;
    }

    const updatedAt = typeof item.updated_at === 'string' ? clean(item.updated_at) : '';

    result.matchingJobs.push({
      id,
      title,
      updatedAt,
      locationName,
      absoluteUrl,
    });
  }

  return result;
}

/**
 * Parses Greenhouse job detail JSON into an IngestJobDto.
 */
export function parseGreenhouseDetail(
  tenant: GreenhouseTenant,
  rawJson: string | unknown,
  fetchedAt: Date,
  expected?: GreenhouseSummaryItem,
): IngestJobDto {
  const config = GREENHOUSE_TENANTS[tenant];
  if (!config) throw new Error(`Unknown Greenhouse tenant: "${tenant}"`);

  let item: any;
  if (typeof rawJson === 'string') {
    try {
      item = JSON.parse(rawJson);
    } catch {
      throw new Error('Invalid Greenhouse detail JSON');
    }
  } else {
    item = rawJson;
  }

  if (!item || typeof item !== 'object') {
    throw new Error('Greenhouse detail item is not an object');
  }

  const id = item.id !== undefined && item.id !== null ? String(item.id).trim() : '';
  if (!id || !/^\d+$/.test(id)) {
    throw new Error(`Invalid Greenhouse detail id: "${id}"`);
  }

  const title = typeof item.title === 'string' ? clean(item.title) : '';
  if (!title || title.length > 500) {
    throw new Error('Missing or invalid title in Greenhouse detail');
  }
  if (expected && (id !== expected.id || title !== expected.title)) {
    throw new Error('Greenhouse detail does not match the listing identity');
  }

  if (!isAzerbaijanGreenhouseJob(item, config.locationFilter)) {
    throw new Error('Foreign vacancy rejected: does not match Azerbaijan location criteria');
  }

  // Location validation: ensures Azerbaijan locality
  const rawLoc = typeof item.location?.name === 'string' ? clean(item.location.name) : '';
  const location = rawLoc || 'Məkan göstərilməyib';

  // Canonical URL
  const rawUrl = typeof item.absolute_url === 'string' && item.absolute_url.trim()
    ? item.absolute_url.trim()
    : greenhouseCanonicalJobUrl(tenant, id);
  const validatedUrl = greenhouseUrl(tenant, rawUrl);
  if (new URL(validatedUrl).pathname.split('/').pop() !== id || (expected && validatedUrl !== expected.absoluteUrl)) {
    throw new Error('Greenhouse detail URL does not match the listing identity');
  }

  // An update timestamp is not a publication date. The legacy DTO requires a
  // timestamp, so record observation explicitly when the source date is missing.
  const publishedAt = typeof item.first_published === 'string' ? parseStrictIsoDate(item.first_published) : undefined;
  const sourcePostedAt = publishedAt && new Date(publishedAt) <= fetchedAt ? publishedAt : undefined;
  const postedAt = sourcePostedAt ?? fetchedAt.toISOString();

  // Deadline if specified
  const deadline = typeof item.application_deadline === 'string' && item.application_deadline.trim()
    ? parseStrictIsoDate(item.application_deadline.trim())
    : undefined;

  // Content processing
  const rawContent = typeof item.content === 'string' ? item.content : '';
  if (!rawContent || !rawContent.trim()) {
    throw new Error('Missing job content in Greenhouse detail');
  }

  // Greenhouse HTML content is entity-encoded (&lt;div class=&quot;...&quot;&gt;)
  const unescapedHtml = cheerio.load(rawContent).text();
  const $ = cheerio.load(unescapedHtml);
  $('script, style, iframe, form, button, input').remove();
  $('br').replaceWith('\n');
  $('p, li, h1, h2, h3, h4, h5, h6, ul, ol, div').append('\n');

  let description = $('body').text()
    .split('\n')
    .map(clean)
    .filter(Boolean)
    .join('\n');

  if (!description || description.length < 20) {
    throw new Error('Incomplete or empty job description in Greenhouse detail');
  }

  if (description.length > MAX_JOB_DESCRIPTION_CHARS) {
    throw new Error(`Job description exceeds maximum allowed characters: ${description.length}`);
  }

  // Raw payload metadata
  const rawPayload: Record<string, unknown> = {
    source: tenant,
    platform: 'greenhouse',
    boardToken: config.boardToken,
    internalJobId: item.internal_job_id,
    requisitionId: item.requisition_id,
    sourcePostedAt: sourcePostedAt ?? null,
    firstObservedAt: fetchedAt.toISOString(),
    postedAtBasis: sourcePostedAt ? 'source-date' : 'first-observed',
  };

  if (Array.isArray(item.departments) && item.departments.length) {
    rawPayload.departments = item.departments.map((d: any) => d?.name).filter(Boolean);
  }
  if (Array.isArray(item.offices) && item.offices.length) {
    rawPayload.offices = item.offices.map((o: any) => o?.name).filter(Boolean);
  }
  if (Array.isArray(item.metadata)) {
    const meta: Record<string, any> = {};
    for (const m of item.metadata) {
      if (m && m.name && m.value !== undefined && m.value !== null) {
        meta[m.name] = m.value;
      }
    }
    rawPayload.metadata = meta;
  }

  return {
    externalId: `${tenant}:${id}`,
    title,
    company: config.company,
    description,
    location,
    url: validatedUrl,
    postedAt,
    deadline,
    detailFetchedAt: fetchedAt.toISOString(),
    rawPayload,
  };
}
