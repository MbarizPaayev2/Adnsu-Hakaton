import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { parseStrictIsoDate, validateAzerbaijanLocation } from './public-job-collector';
import { bakuInstant } from './baku-time';

export const SMARTJOB_ORIGIN = 'https://smartjob.az';
const clean = (s: string) => s.replace(/[\s\uFEFF]+/g, ' ').trim();

/** Only source-owned public vacancy/listing/sitemap URLs, never CVs, admin or auth endpoints. */
export function smartjobUrl(input: string): string {
  const u = new URL(input, SMARTJOB_ORIGIN);
  if (
    u.origin !== SMARTJOB_ORIGIN ||
    u.username ||
    u.password ||
    /%2e|%2f|%5c/i.test(u.pathname) ||
    !(
      u.pathname === '/robots.txt' ||
      u.pathname === '/sitemap.xml' ||
      /^\/sitemaps\/jobs\/[1-9]\d*$/.test(u.pathname) ||
      u.pathname === '/vakansiyalar' ||
      /^\/vakansiyalar\/[a-z0-9-]+$/.test(u.pathname)
    )
  ) {
    throw new Error('Unsupported public source URL');
  }
  u.search = '';
  u.hash = '';
  return u.href;
}

export { parseStrictIsoDate as parseIsoDate };

export function parseSmartjobListing(
  content: string,
  currentUrl: string,
): { urls: string[]; shards?: string[]; next: string | null } {
  const current = smartjobUrl(currentUrl);
  const urls = new Set<string>();

  // Check if content is a sitemap index (lists shards)
  if (content.includes('<sitemapindex')) {
    const shardMatches = content.match(/<loc>(https:\/\/smartjob\.az\/sitemaps\/jobs\/[1-9]\d*)<\/loc>/g);
    const shards: string[] = [];
    if (shardMatches) {
      for (const m of shardMatches) {
        const loc = m.replace(/<\/?loc>/g, '').trim();
        shards.push(smartjobUrl(loc));
      }
    }
    return { urls: [], shards, next: shards[0] || null };
  }

  // Check if content is XML sitemap (vacancy urls)
  if (content.includes('<urlset') || current.includes('/sitemaps/jobs/')) {
    const locMatches = content.match(/<loc>(https:\/\/smartjob\.az\/vakansiyalar\/[a-z0-9-]+)<\/loc>/g);
    if (!locMatches || !locMatches.length) throw new Error('Sitemap has no recognizable vacancy entries');
    for (const match of locMatches) {
      const loc = match.replace(/<\/?loc>/g, '').trim();
      urls.add(smartjobUrl(loc));
    }
    return { urls: [...urls], next: null };
  }

  // HTML listing (/vakansiyalar)
  const $ = cheerio.load(content);
  $('a[href^="/vakansiyalar/"], a[href^="https://smartjob.az/vakansiyalar/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && !href.includes('?') && !href.includes('#')) {
      try {
        urls.add(smartjobUrl(href));
      } catch {}
    }
  });

  if (!urls.size) throw new Error('Listing has no recognizable vacancy cards');

  // Follow to the sitemap index on next page if started on /vakansiyalar
  const next = current === `${SMARTJOB_ORIGIN}/vakansiyalar` ? `${SMARTJOB_ORIGIN}/sitemap.xml` : null;
  return { urls: [...urls], next };
}

function extractSmartjobPosting($: cheerio.CheerioAPI): Record<string, any> | null {
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

export function parseSmartjobDetail(html: string, url: string, fetchedAt: Date): IngestJobDto {
  const validatedUrl = smartjobUrl(url);
  const $ = cheerio.load(html);

  // Extract Schema.org JobPosting microdata
  const jobPosting = extractSmartjobPosting($);

  const slug = new URL(validatedUrl).pathname.split('/').pop() || '';
  const fallbackId = slug.split('-').pop() || slug;

  const title = clean(jobPosting?.title || $('h1').first().text());
  const company = clean(
    jobPosting?.hiringOrganization?.name ||
      $('a[href*="/sirketler/"]').first().text() ||
      $('.company-title').first().text(),
  );

  let rawDescription = jobPosting?.description || '';
  if (!rawDescription) {
    const descEl = $('.job-body, .vacancy-description, .job-content').first();
    rawDescription = descEl.html() || '';
  }

  const descDom = cheerio.load(rawDescription || '<div></div>');
  descDom('script,style,form,button,iframe').remove();
  descDom('br').replaceWith('\n');
  descDom('p,li,h1,h2,h3,h4').each((_, el) => {
    descDom(el).append('\n');
  });
  const description = descDom.text().replace(/\uFEFF/g, '').split('\n').map(clean).filter(Boolean).join('\n');

  // Must have genuine datePosted evidence from source
  const rawDate = jobPosting?.datePosted;
  if (!rawDate) {
    throw new Error('Missing datePosted evidence');
  }
  const postedAt = parseStrictIsoDate(String(rawDate));
  if (!postedAt) {
    throw new Error(`Malformed or invalid datePosted: ${rawDate}`);
  }

  // Supplied deadline must be valid calendar date (never silently discard)
  const deadlineText = jobPosting?.validThrough;
  let deadline: string | undefined = undefined;
  if (deadlineText !== undefined && deadlineText !== null && clean(String(deadlineText)) !== '') {
    // A date-only deadline is open through the END of that day in Baku (UTC+4); zone-less times are Baku local.
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
    throw new Error('Incomplete or invalid Smartjob vacancy detail');
  }

  // Reject explicitly foreign-only vacancies
  const location = validateAzerbaijanLocation(jobPosting?.jobLocation, 'Azerbaijan');

  const rawId = jobPosting?.identifier?.value || fallbackId;
  const externalId = `smartjob:${rawId}`;
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
      source: 'smartjob',
      employmentType: jobPosting?.employmentType || null,
      industry: jobPosting?.industry || null,
      occupationalCategory: jobPosting?.occupationalCategory || null,
    },
  };
}
