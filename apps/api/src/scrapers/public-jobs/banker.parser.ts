import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { validateAzerbaijanLocation } from './public-job-collector';

export const BANKER_ORIGIN = 'https://banker.az';
export const BANKER_MIN_DELAY_MS = 1500;

const clean = (s: string) => s.replace(/[\s\u00a0\uFEFF]+/g, ' ').trim();

export function bankerUrl(input: string): string {
  const u = new URL(input, BANKER_ORIGIN);
  if (u.origin !== BANKER_ORIGIN || u.username || u.password) throw new Error('Unsupported public source URL');
  if (u.pathname === '/robots.txt' && !u.search) return u.href;
  if (/^\/vakansiyalar\/?$/.test(u.pathname)) {
    const keys = [...u.searchParams.keys()];
    if (keys.length === 0) return `${BANKER_ORIGIN}/vakansiyalar/`;
    if (keys.length === 1 && keys[0] === 'paged' && /^[1-9]\d{0,3}$/.test(u.searchParams.get('paged') || '')) return u.href;
    throw new Error('Unsupported public source URL');
  }
  if (/^\/jobs\/[a-z0-9%_-]+\/?$/i.test(u.pathname) && !u.search) {
    u.hash = '';
    return u.href;
  }
  throw new Error('Unsupported public source URL');
}

export function bankerSlug(url: string): string {
  const u = new URL(bankerUrl(url));
  const slug = u.pathname.replace(/^\/jobs\//, '').replace(/\/+$/, '');
  if (!slug) throw new Error('Missing Banker job slug');
  return slug;
}

export interface BankerListingEntry {
  id: string;
  url: string;
  title: string;
  company: string;
  location?: string;
  postedAt?: string;
}

function parseBankerDate(value: string): string | undefined {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(clean(value));
  if (!match) return undefined;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText), month = Number(monthText), year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString();
}

export function parseBankerListing(html: string): { entries: BankerListingEntry[] } {
  const $ = cheerio.load(html);
  const entries = new Map<string, BankerListingEntry>();
  $('.sjb-list-row, .job-info').each((_, el) => {
    const link = $(el).find('h4 a[href*="/jobs/"]').first();
    const href = link.attr('href');
    if (!href) return;
    try {
      const url = bankerUrl(href);
      const rawTitle = clean($(el).find('.job-title').text() || link.text());
      if (!rawTitle) return;
      const parts = rawTitle.split(/\s+[–—-]\s+/);
      const title = parts.length >= 2 ? parts.slice(0, -1).join(' – ') : rawTitle;
      const company = parts.length >= 2 ? parts[parts.length - 1] : 'İşəgötürən göstərilməyib';
      const id = bankerSlug(url);
      if (!entries.has(url)) {
        entries.set(url, { id, url, title, company });
      }
    } catch {
      // Unrecognized or invalid job link
    }
  });
  if (!entries.size && !/vakansiyalar/i.test(`${$('h1').first().text()} ${$('title').text()}`)) {
    throw new Error('Listing has no recognizable vacancy entries');
  }
  $('.sjb-list-row, .job-info').each((_, el) => {
    const link = $(el).find('h4 a[href*="/jobs/"]').first();
    const href = link.attr('href');
    if (!href) return;
    try {
      const url = bankerUrl(href);
      const entry = entries.get(url);
      if (!entry) return;
      const location = clean($(el).find('.job-location').text());
      const postedAt = parseBankerDate($(el).find('.job-date').text());
      if (location) entry.location = location;
      if (postedAt) entry.postedAt = postedAt;
    } catch { /* already rejected by the first pass */ }
  });
  return { entries: [...entries.values()] };
}

export function parseBankerDetail(
  html: string,
  url: string,
  fetchedAt: Date,
  entry?: BankerListingEntry,
): IngestJobDto {
  const validatedUrl = bankerUrl(url);
  const slug = bankerSlug(validatedUrl);
  const $ = cheerio.load(html);

  const content = $('.td-post-content');
  if (!content.length) throw new Error('Unrecognized Banker detail layout');

  let rawTitle = entry?.title;
  let company = entry?.company;

  if (!rawTitle || !company) {
    const pageTitle = clean($('title').text().replace(/\|\s*Banker\.az$/i, ''));
    const parts = pageTitle.split(/\s+[–—-]\s+/);
    rawTitle = parts.length >= 2 ? parts.slice(0, -1).join(' – ') : pageTitle;
    company = parts.length >= 2 ? parts[parts.length - 1] : 'İşəgötürən göstərilməyib';
  }

  const title = rawTitle;
  if (!title) throw new Error('Missing Banker vacancy title');

  // Time extraction: ISO time from <time datetime="...">
  const timeAttr = $('time.entry-date, time[datetime]').first().attr('datetime');
  let postedAt: string | undefined;
  if (entry?.postedAt) {
    postedAt = entry.postedAt;
  } else if (timeAttr) {
    const d = new Date(timeAttr);
    if (!Number.isNaN(d.getTime()) && d.getTime() <= fetchedAt.getTime() + 86_400_000) {
      postedAt = d.toISOString();
    }
  }
  if (!postedAt) postedAt = fetchedAt.toISOString();

  // Description extraction with line breaks preserved
  $('script, style, form, iframe').remove();
  $('br').replaceWith('\n');
  $('p, li, h1, h2, h3, h4, h5, h6, tr').append('\n');
  const description = $('.td-post-content').text().split('\n').map(clean).filter(Boolean).join('\n');

  // Location extraction
  const cityPattern = /(?<=^|[^\p{L}])(Bakı|Şirvan|Ağdaş|Qax|Gəncə|Sumqayıt|Lənkəran|Xaçmaz|Bərdə|Mingəçevir|Quba|Şəki)(?=[^\p{L}]|$)/iu;
  const inTitle = cityPattern.exec(title)?.[1];
  const inDesc = cityPattern.exec(description)?.[1];
  const detailCity = inTitle || inDesc;
  const listedLocation = entry?.location;
  const locationBasis = listedLocation ? 'listing-card' : detailCity ? (inTitle ? 'title-city' : 'content-city') : 'not-specified';
  const location = validateAzerbaijanLocation(listedLocation || detailCity || 'Azərbaycan (şəhər göstərilməyib)', 'Azərbaycan (şəhər göstərilməyib)');

  if (!title || title.length > 500 || !company || company.length > 256 || !description || description.length > MAX_JOB_DESCRIPTION_CHARS) {
    throw new Error('Incomplete or invalid Banker.az vacancy detail');
  }

  return {
    externalId: `banker:${slug}`,
    title,
    company,
    description,
    location,
    url: validatedUrl,
    postedAt,
    detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: {
      source: 'banker',
      locationBasis,
      postedAtBasis: entry?.postedAt ? 'listing-card-date' : timeAttr && postedAt !== fetchedAt.toISOString() ? 'detail-source-date' : 'first-observed',
    },
  };
}
