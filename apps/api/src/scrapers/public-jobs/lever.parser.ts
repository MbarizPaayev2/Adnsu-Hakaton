import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';

export const LEVER_ORIGIN = 'https://jobs.lever.co';
export const LEVER_API_ORIGIN = 'https://api.lever.co';

/**
 * Curated and verified Lever tenants with official employer career links.
 */
export const LEVER_TENANTS = {
  xsolla: {
    origin: 'https://jobs.lever.co',
    company: 'Xsolla',
    verified: '2026-10-04',
    evidence: 'Official site https://xsolla.com/careers links to https://jobs.lever.co/xsolla (a Lever career site); public API /v0/postings/xsolla?mode=json; robots.txt allows /',
  },
} as const;

export type LeverTenant = keyof typeof LEVER_TENANTS;
export const LEVER_SOURCES = Object.keys(LEVER_TENANTS) as LeverTenant[];

export function leverUrl(tenant: LeverTenant, input: string): string {
  const url = new URL(input, LEVER_ORIGIN);
  if (url.origin !== LEVER_ORIGIN && url.origin !== LEVER_API_ORIGIN) {
    throw new Error('Unsupported Lever URL: wrong origin');
  }
  if (url.username || url.password) {
    throw new Error('Unsupported Lever URL: credentials');
  }
  if (/%2e|%2f|%5c/i.test(url.pathname)) {
    throw new Error('Unsupported Lever URL: path traversal');
  }
  if (url.origin === LEVER_API_ORIGIN) {
    if (url.pathname === '/robots.txt') return url.href;
    if (url.pathname === `/v0/postings/${tenant}`) {
      if (url.search && url.search !== '?mode=json') {
        throw new Error('Unsupported Lever API URL: invalid query');
      }
      return url.href;
    }
    throw new Error('Unsupported Lever API URL: path');
  }
  if (url.pathname === '/robots.txt') return url.href;
  const postingRegex = new RegExp(`^/${tenant}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, 'i');
  if (!postingRegex.test(url.pathname)) {
    throw new Error('Unsupported Lever URL: path');
  }
  if (url.search || url.hash) {
    throw new Error('Unsupported Lever URL: query or fragment');
  }
  return url.href;
}

export function leverApiUrl(tenant: LeverTenant): string {
  return `${LEVER_API_ORIGIN}/v0/postings/${tenant}?mode=json`;
}

export interface LeverFeedResult {
  jobs: IngestJobDto[];
  discovered: number;
  skipped: number;
  failed: number;
}

const clean = (text: string) => text.replace(/[\s\uFEFF]+/g, ' ').trim();

export function parseLeverFeed(
  tenant: LeverTenant,
  rawJson: string | unknown,
  fetchedAt: Date,
): LeverFeedResult {
  const config = LEVER_TENANTS[tenant];
  if (!config) throw new Error(`Unknown Lever tenant: "${tenant}"`);

  let items: any[];
  if (typeof rawJson === 'string') {
    try {
      items = JSON.parse(rawJson);
    } catch {
      throw new Error('Invalid Lever JSON response');
    }
  } else {
    items = rawJson as any[];
  }

  if (!Array.isArray(items)) {
    throw new Error('Lever API response is not an array');
  }

  const result: LeverFeedResult = { jobs: [], discovered: 0, skipped: 0, failed: 0 };
  const seen = new Set<string>();

  for (const item of items) {
    result.discovered++;
    if (!item || typeof item !== 'object') {
      result.failed++;
      continue;
    }

    try {
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!id || seen.has(id) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error('Missing or invalid posting id');
      }
      seen.add(id);

      const title = typeof item.text === 'string' ? clean(item.text) : '';
      if (!title || title.length > 500) {
        throw new Error('Missing or invalid title');
      }

      const catLoc = typeof item.categories?.location === 'string' ? clean(item.categories.location) : '';
      const allLocs: string[] = Array.isArray(item.categories?.allLocations)
        ? item.categories.allLocations.filter((l: unknown) => typeof l === 'string').map((l: string) => clean(l))
        : [];
      const country = typeof item.country === 'string' ? clean(item.country) : '';

      const isBakuOrAz = (s: string) => /baku|bakı|azerbaijan|az[əe]rbaycan/i.test(s);
      const isCountryAz = country.toUpperCase() === 'AZ' || isBakuOrAz(country);

      const hasAzLocation = isBakuOrAz(catLoc) || allLocs.some(isBakuOrAz) || isCountryAz;
      if (!hasAzLocation) {
        result.skipped++;
        continue;
      }

      let location = 'Bakı';
      if (isBakuOrAz(catLoc)) {
        location = catLoc;
      } else if (allLocs.some(isBakuOrAz)) {
        location = allLocs.find(isBakuOrAz)!;
      }

      const hostedUrl = typeof item.hostedUrl === 'string' ? item.hostedUrl.trim() : `${LEVER_ORIGIN}/${tenant}/${id}`;
      const validatedUrl = leverUrl(tenant, hostedUrl);

      if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt) || item.createdAt <= 0) {
        throw new Error('Missing or invalid createdAt');
      }
      const posted = new Date(item.createdAt);
      if (Number.isNaN(posted.getTime()) || posted.getTime() > fetchedAt.getTime() + 86_400_000) {
        throw new Error('Implausible posting date');
      }

      const descParts: string[] = [];
      if (typeof item.descriptionBodyPlain === 'string' && item.descriptionBodyPlain.trim()) {
        descParts.push(item.descriptionBodyPlain.trim());
      } else if (typeof item.descriptionPlain === 'string' && item.descriptionPlain.trim()) {
        descParts.push(item.descriptionPlain.trim());
      } else if (typeof item.descriptionBody === 'string' && item.descriptionBody.trim()) {
        const $ = cheerio.load(`<div>${item.descriptionBody}</div>`);
        $('script,style,iframe,form,input,button').remove();
        $('br').replaceWith('\n');
        $('p,li,h1,h2,h3,h4,ul,ol').append('\n');
        const txt = $('div').text().split('\n').map(clean).filter(Boolean).join('\n');
        if (txt) descParts.push(txt);
      } else if (typeof item.description === 'string' && item.description.trim()) {
        const $ = cheerio.load(`<div>${item.description}</div>`);
        $('script,style,iframe,form,input,button').remove();
        $('br').replaceWith('\n');
        $('p,li,h1,h2,h3,h4,ul,ol').append('\n');
        const txt = $('div').text().split('\n').map(clean).filter(Boolean).join('\n');
        if (txt) descParts.push(txt);
      }

      if (Array.isArray(item.lists)) {
        for (const l of item.lists) {
          if (!l || typeof l !== 'object') continue;
          const sectionTitle = typeof l.text === 'string' ? clean(l.text) : '';
          if (sectionTitle) descParts.push(`\n${sectionTitle}:`);
          if (typeof l.content === 'string') {
            const $ = cheerio.load(`<ul>${l.content}</ul>`);
            $('li').each((_, el) => {
              const liText = clean($(el).text());
              if (liText) descParts.push(`• ${liText}`);
            });
          }
        }
      }

      if (typeof item.additionalPlain === 'string' && item.additionalPlain.trim()) {
        descParts.push(`\n${item.additionalPlain.trim()}`);
      }

      let description = descParts.join('\n').trim();
      if (!description) {
        throw new Error('Missing job description');
      }
      if (description.length > MAX_JOB_DESCRIPTION_CHARS) {
        description = description.slice(0, MAX_JOB_DESCRIPTION_CHARS - 3) + '...';
      }

      const rawPayload: Record<string, unknown> = {
        source: tenant,
        platform: 'lever',
      };
      if (item.workplaceType) {
        rawPayload.workplaceType = item.workplaceType;
        if (item.workplaceType === 'remote') rawPayload.isRemote = true;
      }
      if (item.categories?.team) rawPayload.team = item.categories.team;
      if (item.categories?.department) rawPayload.department = item.categories.department;
      if (item.categories?.commitment) rawPayload.commitment = item.categories.commitment;

      result.jobs.push({
        externalId: `${tenant}:${id}`,
        title,
        company: config.company,
        description,
        location,
        url: validatedUrl,
        postedAt: posted.toISOString(),
        detailFetchedAt: fetchedAt.toISOString(),
        rawPayload,
      });
    } catch {
      result.failed++;
    }
  }

  return result;
}
