import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';

export const HELLOJOB_ORIGIN = 'https://www.hellojob.az';
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
const clean = (s: string) => s.replace(/[\s\uFEFF]+/g, ' ').trim();

/** Only source-owned public vacancy/listing URLs, never CVs or contact-reveal endpoints. */
export function sourceUrl(input: string): string {
  const u = new URL(input, HELLOJOB_ORIGIN);
  if (u.origin !== HELLOJOB_ORIGIN || u.username || u.password ||
      /%2e|%2f|%5c/i.test(u.pathname) ||
      !(/^\/vakansiya\/[^/]+$/.test(u.pathname) || u.pathname === '/vakansiyalar' || u.pathname === '/robots.txt')) {
    throw new Error('Unsupported public source URL');
  }
  const page = u.searchParams.get('page');
  if (u.pathname === '/vakansiyalar' && page !== null && !/^[1-9]\d*$/.test(page)) throw new Error('Invalid listing page');
  u.search = u.pathname === '/vakansiyalar' && page ? `?page=${page}` : '';
  u.hash = '';
  return u.href;
}

export function parseAzDate(text: string, endOfDay = false): string | undefined {
  const match = /^(\d{1,2})\s+([a-zəıöüçşğ]+)\s+(\d{4})$/i.exec(clean(text));
  if (!match) return undefined;
  const day = Number(match[1]), month = MONTHS.indexOf(match[2].toLocaleLowerCase('az')), year = Number(match[3]);
  if (month < 0 || year < 2000 || year > 2100 || day < 1 || day > 31) return undefined;
  const check = new Date(Date.UTC(year, month, day));
  if (check.getUTCMonth() !== month || check.getUTCDate() !== day) return undefined;
  return new Date(Date.UTC(year, month, day, endOfDay ? 19 : -4, endOfDay ? 59 : 0, endOfDay ? 59 : 0)).toISOString();
}

export function parseHellojobListing(html: string, currentUrl: string): { urls: string[]; next: string | null } {
  const $ = cheerio.load(html);
  const current = new URL(sourceUrl(currentUrl));
  const expectedPage = current.searchParams.get('page') || '1';
  if (current.pathname !== '/vakansiyalar' || !$('h1').toArray().some((e) => {
    const heading = /^(?:Vakansiyalar|İş elanları(?: 20\d{2})?)(?: — səhifə ([1-9]\d*))?$/u.exec(clean($(e).text()));
    return !!heading && (!heading[1] || heading[1] === expectedPage);
  })) {
    throw new Error('Unrecognized listing (possibly a challenge page)');
  }
  const urls = new Set<string>();
  $('a.vacancies__body[href]').each((_, el) => {
    const href = $(el).attr('href')!;
    const target = new URL(href, currentUrl);
    // The redesigned list interleaves rotating standing talent-pool campaigns with real vacancies.
    // They are not postings and must never be fetched, imported, or allowed to abort the whole listing.
    // Unexpected/off-origin links still fail validation rather than silently proving a complete census.
    if (target.origin === HELLOJOB_ORIGIN && !target.search && target.hash === '#apply' &&
        /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.pathname) && $(el).closest('.vfp').length) return;
    urls.add(sourceUrl(href));
  });
  // An empty/changed layout is not evidence that all vacancies disappeared.
  if (!urls.size) throw new Error('Listing has no recognizable vacancy cards');
  const href = $('a.pagination__btn.next[href]').first().attr('href');
  const next = href ? sourceUrl(new URL(href, currentUrl).href) : null;
  if (next && new URL(next).pathname !== '/vakansiyalar') throw new Error('Invalid next-page URL');
  return { urls: [...urls], next };
}

export function parseHellojobDetail(html: string, url: string, fetchedAt: Date): IngestJobDto {
  url = sourceUrl(url);
  const $ = cheerio.load(html);
  const modern = $('section.vp[data-advert-root]').first();
  const card = modern.length ? modern : $('.company__body > .company__item.vacancies__body').first();
  const head = modern.find('.vp__head, .vp__hero-main').first();
  const title = clean(modern.length ? head.find('h1.vp__title').text() : card.find('h2.vacancies__subTitle').text());
  const company = clean(modern.length ? head.find('.vp__company a[href*="/sirket/"]').text() : card.find('a.vacancies__category[href*="/sirket/"]').text());
  const sourceId = new URL(url).pathname.match(/-(\d+)$/)?.[1];
  const canonical = $('link[rel="canonical"][href]').first().attr('href');
  if (modern.length) {
    // Slug suffixes are not always advert IDs (e.g. a retained legacy slug ending -8756).
    // An exact source-owned canonical URL binds the response to the requested posting.
    // Without it, retain the older numeric-ID check rather than accepting another posting.
    if (canonical) {
      let same = false;
      try { same = sourceUrl(new URL(canonical, url).href) === url; } catch { /* reject untrusted identity */ }
      if (!same) throw new Error('Vacancy identity mismatch');
    } else if (sourceId && modern.attr('data-id') !== sourceId) throw new Error('Vacancy identity mismatch');
  }
  const fields = new Map<string, string>();
  card.find('ul.company__item__details > li').each((_, el) => {
    fields.set(clean($(el).children('span').first().text()), clean($(el).find('p').first().text()));
  });
  if (modern.length) {
    modern.find('.vp__facts > .vp__fact').each((_, el) => {
      fields.set(clean($(el).find('.vp__fact-label').text()), clean($(el).find('.vp__fact-value').text()));
    });
    head.find('.vp__meta > li, .vp__meta > span').each((_, el) => {
      const value = clean($(el).text());
      if (parseAzDate(value)) fields.set('Yerləşmə tarixi', value);
      // The location pin distinguishes the city from category, date and view count.
      if ($(el).find('svg circle[cx="12"][cy="10"]').length) fields.set('Şəhər', value);
    });
  }
  const text = (modern.length ? modern.find('.vp__text') : $('.company__body > .company__text')).first().clone();
  text.find('script,style,form,button,iframe').remove();
  text.find('p').each((_, el) => {
    if ($(el).find('a[href*="t.me/hellojob"],a[href*="whatsapp.com/channel/"]').length) $(el).remove();
  });
  text.find('br').replaceWith('\n');
  text.find('p,li,h2,h3').each((_, el) => { $(el).append('\n'); });
  const description = text.text().replace(/\uFEFF/g, '').split('\n').map(clean).filter(Boolean).join('\n');
  let postedAt = parseAzDate(fields.get('Yerləşmə tarixi') || '');
  const deadlineText = fields.get('Bitmə tarixi');
  const deadline = deadlineText ? parseAzDate(deadlineText, true) : undefined;
  if (!company && title) throw new Error('Employer not disclosed');
  if (!title || title.length > 500 || !company || company.length > 256 || !description || description.length > MAX_JOB_DESCRIPTION_CHARS ||
      !postedAt || (deadlineText && !deadline)) throw new Error('Incomplete or invalid vacancy detail');
  // Some postings state a publication date in the future or after their own deadline. That date cannot be true, so it is
  // never stored as the publication date. The posting is still demonstrably open when its deadline is in the future, so it is
  // kept with the day we first saw it, and the payload says so; without such a deadline it is rejected.
  const implausible = new Date(postedAt).getTime() > fetchedAt.getTime() + 86_400_000 || (deadline && new Date(postedAt) > new Date(deadline));
  let postedAtEvidence = 'source';
  if (implausible) {
    if (!deadline || new Date(deadline).getTime() < fetchedAt.getTime()) throw new Error('Implausible vacancy dates');
    postedAt = fetchedAt.toISOString();
    postedAtEvidence = 'first-seen: the source stated an impossible publication date';
  }
  const location = fields.get('Şəhər') || 'Azerbaijan';
  if (location.length > 256) throw new Error('Invalid location');
  const externalId = `hellojob:${new URL(url).pathname.split('/').pop()}`;
  if (externalId.length > 256) throw new Error('Invalid vacancy identifier');
  return {
    externalId,
    title, company, description, location, url, postedAt,
    ...(deadline ? { deadline } : {}),
    detailFetchedAt: fetchedAt.toISOString(),
    // Stable metadata only: no full HTML, view counters, accounts, CVs or hidden contact data.
    rawPayload: { source: 'hellojob', salary: fields.get('Maaş') || null, employmentType: fields.get('İş rejimi') || null, ...(postedAtEvidence !== 'source' ? { postedAtEvidence } : {}) },
  };
}
