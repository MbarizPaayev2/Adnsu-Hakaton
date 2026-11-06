import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { parseStrictIsoDate, validateAzerbaijanLocation } from './public-job-collector';
import { bakuInstant } from './baku-time';

export const WORK_ORIGIN = 'https://www.work.az';
export const WORK_API_ORIGIN = 'https://api.work.az';
const clean = (s: string) => s.replace(/[\s\uFEFF]+/g, ' ').trim();

/** Only source-owned public vacancy/sitemap/API URLs, never auth, profile, cabinet or invoice paths. */
export function workUrl(input: string): string {
  const u = new URL(input, WORK_ORIGIN);
  if (
    (u.origin !== WORK_ORIGIN && u.origin !== WORK_API_ORIGIN) ||
    u.username ||
    u.password ||
    /%2e|%2f|%5c/i.test(u.pathname)
  ) {
    throw new Error('Unsupported public source URL');
  }

  if (u.origin === WORK_API_ORIGIN) {
    if (u.pathname !== '/v1/vacancies') {
      throw new Error('Unsupported public source URL');
    }
  } else {
    if (
      !(
        u.pathname === '/robots.txt' ||
        u.pathname === '/sitemap.xml' ||
        u.pathname === '/vakansiyalar' ||
        /^\/vakansiyalar\/[a-z0-9-]+$/.test(u.pathname)
      )
    ) {
      throw new Error('Unsupported public source URL');
    }
  }
  u.search = '';
  u.hash = '';
  return u.href;
}

export { parseStrictIsoDate as parseWorkDate };

export interface WorkApiListing {
  urls: string[];
  totalElements: number;
  totalPages: number;
  currentPage: number;
  hasNext: boolean;
  slugs: string[];
  invalidCount: number;
}

export function parseWorkApiResponse(json: any, expectedPage?: number): WorkApiListing {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid Work.az API response: not an object');
  }
  if (json.success !== true || !json.data || !Array.isArray(json.data.content)) {
    throw new Error('Invalid Work.az API response: unexpected format');
  }

  const { totalElements, totalPages, hasNext, content } = json.data;
  const currentPage = typeof json.data.currentPage === 'number' ? json.data.currentPage : (expectedPage ?? 1);

  if (
    !Number.isInteger(totalElements) ||
    totalElements <= 0 ||
    !Number.isInteger(totalPages) ||
    totalPages <= 0 ||
    !Number.isInteger(currentPage) ||
    currentPage <= 0 ||
    typeof hasNext !== 'boolean'
  ) {
    throw new Error('Work.az API response missing required pagination metadata');
  }

  if (expectedPage !== undefined && currentPage !== expectedPage) {
    throw new Error(`Work.az API returned unexpected page ${currentPage}, expected ${expectedPage}`);
  }

  if (currentPage >= totalPages && hasNext) {
    throw new Error('Work.az API response has contradictory pagination: hasNext is true on final page');
  }
  if (currentPage < totalPages && !hasNext) {
    throw new Error('Work.az API response has contradictory pagination: hasNext is false before final page');
  }

  if (content.length === 0 && hasNext) {
    throw new Error('Work.az API returned empty content page while hasNext is true');
  }
  if (content.length === 0 && currentPage < totalPages) {
    throw new Error('Work.az API returned empty content page before reaching totalPages');
  }

  const urls: string[] = [];
  const slugs: string[] = [];
  let invalidCount = 0;

  for (const item of content) {
    if (!item || typeof item !== 'object') {
      invalidCount++;
      continue;
    }
    if (typeof item.status !== 'string' || !['ACTIVE', 'INACTIVE', 'CLOSED', 'EXPIRED'].includes(item.status)) {
      invalidCount++;
      continue;
    }
    if (item.status !== 'ACTIVE') {
      continue;
    }
    const slug = typeof item.slug === 'string' ? item.slug.trim() : '';
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      invalidCount++;
      continue;
    }
    try {
      const u = workUrl(`${WORK_ORIGIN}/vakansiyalar/${slug}`);
      urls.push(u);
      slugs.push(slug);
    } catch {
      invalidCount++;
    }
  }

  return {
    urls,
    totalElements,
    totalPages,
    currentPage,
    hasNext,
    slugs,
    invalidCount,
  };
}

export function parseWorkListing(content: string, currentUrl: string): { urls: string[]; next: string | null } {
  const current = workUrl(currentUrl);
  const urls = new Set<string>();

  // Check if content is XML sitemap
  if (content.includes('<urlset') || current.endsWith('/sitemap.xml')) {
    // The sitemap holds thousands of historical postings (most no longer carry structured data). Newest first, so a bounded
    // run spends its requests on current vacancies; entries without a date go last.
    const entries: { url: string; at: number }[] = [];
    for (const m of content.matchAll(/<url>\s*<loc>(https:\/\/www\.work\.az\/vakansiyalar\/[a-z0-9-]+)<\/loc>(?:\s*<lastmod>([^<]*)<\/lastmod>)?/g)) {
      const at = m[2] ? Date.parse(`${m[2].trim().replace(' ', 'T')}Z`) : NaN;
      try { entries.push({ url: workUrl(m[1].trim()), at: Number.isNaN(at) ? -Infinity : at }); } catch { /* not a vacancy URL */ }
    }
    if (!entries.length) throw new Error('Sitemap has no recognizable vacancy entries');
    entries.sort((a, b) => b.at - a.at);
    for (const e of entries) urls.add(e.url);
    return { urls: [...urls], next: null };
  }

  // HTML listing (/vakansiyalar)
  const $ = cheerio.load(content);
  $('a[href^="/vakansiyalar/"], a[href^="https://www.work.az/vakansiyalar/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && !href.includes('page-')) {
      try {
        urls.add(workUrl(href));
      } catch {}
    }
  });

  // Extract slugs embedded in RSC/scripts
  const scriptMatches = content.match(/\/vakansiyalar\/[a-z0-9-]+/g) || [];
  for (const m of scriptMatches) {
    if (!m.includes('page-') && m !== '/vakansiyalar') {
      try {
        urls.add(workUrl(m));
      } catch {}
    }
  }

  if (!urls.size) throw new Error('Listing has no recognizable vacancy cards');

  // If started on /vakansiyalar, advance to official sitemap for full inventory
  const next = current === `${WORK_ORIGIN}/vakansiyalar` ? `${WORK_ORIGIN}/sitemap.xml` : null;
  return { urls: [...urls], next };
}

function extractWorkPosting($: cheerio.CheerioAPI): Record<string, any> | null {
  let found: Record<string, any> | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '{}');
      if (parsed['@type'] === 'JobPosting') {
        found = parsed;
      } else if (Array.isArray(parsed)) {
        const item = parsed.find((x: any) => x?.['@type'] === 'JobPosting');
        if (item) found = item;
      }
    } catch {}
  });
  return found;
}

export function parseWorkDetail(html: string, url: string, fetchedAt: Date): IngestJobDto {
  const validatedUrl = workUrl(url);
  const slug = new URL(validatedUrl).pathname.split('/').pop() || '';

  const $ = cheerio.load(html);

  // Extract Schema.org JobPosting microdata
  const jobPosting = extractWorkPosting($);

  const title = clean(jobPosting?.title || $('h1').first().text());
  const company = clean(
    jobPosting?.hiringOrganization?.name ||
      $('a[href*="/sirketler/"]').first().text() ||
      $('.company-title').first().text(),
  );

  let rawDescription = jobPosting?.description || '';
  if (!rawDescription) {
    const descEl = $('.vacancy-description, .job-description, .job-body').first();
    rawDescription = descEl.html() || '';
  }

  const descDom = cheerio.load(rawDescription || '<div></div>');
  descDom('script,style,form,button,iframe').remove();
  descDom('br').replaceWith('\n');
  descDom('p,li,h1,h2,h3,h4').each((_, el) => {
    descDom(el).append('\n');
  });
  const description = descDom.text().replace(/\uFEFF/g, '').split('\n').map(clean).filter(Boolean).join('\n');

  // Strict datePosted validation: must have genuine source evidence
  const rawDate = jobPosting?.datePosted;
  if (!rawDate) {
    throw new Error('Missing datePosted evidence');
  }
  const postedAt = parseStrictIsoDate(String(rawDate));
  if (!postedAt) {
    throw new Error(`Malformed or invalid datePosted: ${rawDate}`);
  }

  // Strict deadline validation: if supplied, must be valid calendar date (never silently discard)
  const deadlineText = jobPosting?.validThrough;
  let deadline: string | undefined = undefined;
  if (deadlineText !== undefined && deadlineText !== null && clean(String(deadlineText)) !== '') {
    // Observed `validThrough` values are date-only ("2026-10-04"): the posting is open through the END of that day in Baku, not until UTC midnight.
    deadline = bakuInstant(String(deadlineText), 'end');
    if (!deadline) {
      throw new Error(`Malformed or invalid deadline: ${deadlineText}`);
    }
  }

  if (
    !title ||
    title.length > 500 ||
    !company ||
    company.length > 256 ||
    !description ||
    description.length > MAX_JOB_DESCRIPTION_CHARS ||
    !postedAt
  ) {
    throw new Error('Incomplete or invalid Work.az vacancy detail');
  }

  // Reject explicitly foreign-only vacancies
  const location = validateAzerbaijanLocation(jobPosting?.jobLocation, 'Azerbaijan');

  const externalId = `work:${slug}`;
  if (externalId.length > 256) throw new Error('Invalid vacancy identifier');

  return {
    externalId,
    title,
    company,
    description,
    location,
    url: validatedUrl,
    postedAt,
    ...(deadline ? { deadline } : {}),
    detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: {
      source: 'work',
      employmentType: Array.isArray(jobPosting?.employmentType)
        ? jobPosting.employmentType.join(', ')
        : jobPosting?.employmentType || null,
      salary: jobPosting?.baseSalary ? `${jobPosting.baseSalary.value?.minValue ?? ''}-${jobPosting.baseSalary.value?.maxValue ?? ''} ${jobPosting.baseSalary.currency ?? ''}`.trim() : null,
    },
  };
}
