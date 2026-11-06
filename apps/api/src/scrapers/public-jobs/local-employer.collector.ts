import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { fetchPublicDocument, robotsAllows, robotsCrawlDelayMs, type CollectionOptions } from './public-job-collector';

/** Reviewed public employer pages only. Account, saved-post and application endpoints are never requested. */
export const LOCAL_EMPLOYERS = {
  avrora: { origin: 'https://www.avrora.az', company: 'Avrora', list: '/az/karyera' },
  azergold: { origin: 'https://careers.azergold.az', company: 'AzerGold', list: '/vacancies' },
  veyseloglu: { origin: 'https://karyera.veyseloglu.az', company: 'Veyseloglu MMC', list: '/home/allvacancies?pageIndex=1&pageSize=5' },
  // Electronics retail chain with branches across the regions; each posting names its branch towns. Robots asks for a 30 s crawl delay (honoured).
  irshad: { origin: 'https://irshad.az', company: 'İrşad Electronics', list: '/az/sirket/vakansiyalar' },
  // Accor's careers site with its "Baku" location facet (options=313), linked from Fairmont Baku's official page. The facet covers every Accor hotel in
  // Baku; each posting's employer is the hotel its location names. Applications go to the employer's SmartRecruiters page (never requested).
  'fairmont-baku': { origin: 'https://careers.accor.com', company: 'Fairmont Baku', list: '/global/en/jobs?options=313&page=1' },
  // Sumqayıt Technologies Park group portal, linked from stp.az. Applying needs an account on the portal (never requested).
  stp: { origin: 'https://www.stpcareer.com', company: 'STP', list: '/vakansiyalar' },
  // Azerbaijan Supermarket LLC (Bravo Supermarket), official career portal.
  bravo: { origin: 'https://www.bravosupermarket.az', company: 'Bravo', list: '/career/all-vacancies/' },
} as const;
export type LocalEmployer = keyof typeof LOCAL_EMPLOYERS;
export interface EmployerListingFacts { location?: string; listingWindowText?: string }
/** Sources whose listing is paged; every other source lists all vacancies on one page. */
const PAGED: readonly LocalEmployer[] = ['veyseloglu', 'fairmont-baku'];
const listPage = (source: LocalEmployer, page: number) =>
  source === 'veyseloglu' ? `/home/allvacancies?pageIndex=${page}&pageSize=5` : source === 'fairmont-baku' ? `/global/en/jobs?options=313&page=${page}` : LOCAL_EMPLOYERS[source].list;
const clean = (s: string) => s.replace(/[\s\u00a0\uFEFF]+/g, ' ').trim();

export function localEmployerUrl(source: LocalEmployer, input: string): string {
  const cfg = LOCAL_EMPLOYERS[source], u = new URL(input, cfg.origin);
  if (source === 'bravo' && u.hostname === 'bravosupermarket.az') u.hostname = 'www.bravosupermarket.az';
  if (u.origin !== cfg.origin || u.username || u.password || u.hash || /[%\\]/.test(u.pathname)) throw new Error('Unsupported employer URL');
  if (u.pathname === '/robots.txt' && !u.search) return u.href;
  if (source === 'avrora' && !u.search && (/^\/az\/vakansiya-etrafli\/[1-9]\d{0,9}$/.test(u.pathname) || u.pathname === cfg.list)) return u.href;
  if (source === 'azergold' && !u.search && (u.pathname === cfg.list || /^\/vacancies\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(u.pathname))) return u.href;
  if (source === 'bravo' && !u.search && (u.pathname === cfg.list || /^\/career\/all-vacancies\/(?:[a-z0-9-]+\/)+$/.test(u.pathname))) return u.href;
  if (source === 'irshad' && !u.search && (u.pathname === cfg.list || /^\/az\/sirket\/vakansiyalar\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(u.pathname))) {
    // The per-vacancy application form lives one level deeper (/vakansiyalar/muraciet-et/<slug>) and is never requested.
    if (u.pathname.endsWith('/muraciet-et')) throw new Error('Unsupported employer URL');
    return u.href;
  }
  if (source === 'fairmont-baku') {
    const keys = [...u.searchParams.keys()];
    if (u.pathname === '/global/en/jobs' && keys.length === 2 && u.searchParams.get('options') === '313' && /^[1-9]\d?$/.test(u.searchParams.get('page') || '') && keys.includes('page')) return u.href;
    if (!u.search && /^\/global\/en\/job\/[a-z0-9]+(?:-[a-z0-9]+)*-jid-[1-9]\d{0,9}$/.test(u.pathname)) return u.href;
  }
  if (source === 'stp' && !u.search && (u.pathname === cfg.list || /^\/vakansiya-haqqinda\/[1-9]\d{0,9}$/.test(u.pathname))) return u.href;
  if (source === 'veyseloglu') {
    // Its missing robots file redirects to this public 404 page. The request still fails with HTTP 404; no other error/account redirect is followed.
    if (u.pathname === '/~/error/_404' && !u.search) return u.href;
    const keys = [...u.searchParams.keys()];
    if (u.pathname === '/vac/detail' && keys.length === 1 && keys[0] === 'vacancyId' && /^[1-9]\d{0,9}$/.test(u.searchParams.get('vacancyId') || '')) return u.href;
    if (u.pathname === '/home/allvacancies' && keys.length === 2 && keys.every(k => ['pageIndex', 'pageSize'].includes(k)) && /^[1-9]\d{0,2}$/.test(u.searchParams.get('pageIndex') || '') && u.searchParams.get('pageSize') === '5') return u.href;
  }
  throw new Error('Unsupported employer URL');
}

const bodyText = (html: string): string => {
  const $ = cheerio.load(html);
  $('script,style,form,input,button,iframe').remove();
  $('br').replaceWith('\n'); $('p,li,h1,h2,h3,h4,h5,h6').append('\n');
  return $.root().text().split('\n').map(clean).filter(Boolean).join('\n');
};

/** Only complete source dates become deadlines; a month/day without a year is retained as text, never guessed. */
export function employerDeadline(text: string): string {
  const months = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
  const m = /^(\d{1,2})\s+([\p{L}]+),?\s+(20\d{2})$/u.exec(clean(text).toLocaleLowerCase('az'));
  if (!m) throw new Error('Missing complete employer deadline');
  const day = Number(m[1]), month = months.indexOf(m[2]), year = Number(m[3]);
  const check = new Date(Date.UTC(year, month, day));
  if (month < 0 || check.getUTCMonth() !== month || check.getUTCDate() !== day || check.getUTCFullYear() !== year) throw new Error('Invalid employer deadline');
  return new Date(Date.UTC(year, month, day, 19, 59, 59, 999)).toISOString();
}

export function parseEmployerListing(source: LocalEmployer, html: string): { urls: string[]; complete: boolean; total?: number; factsByUrl?: Record<string, EmployerListingFacts> } {
  const $ = cheerio.load(html), urls: string[] = [];
  const add = (selector: string, pattern: RegExp) => $(selector).each((_, a) => {
    const href = $(a).attr('href') || '';
    if (pattern.test(new URL(href, LOCAL_EMPLOYERS[source].origin).pathname)) {
      const url = localEmployerUrl(source, href);
      // AzerGold repeats the same link for the title and mobile action within a table row.
      if (urls.includes(url)) { if (source === 'azergold') return; throw new Error('Repeated employer listing identity'); }
      urls.push(url);
    }
  });
  if (source === 'avrora') {
    if (!$('#vacancies[data-site-section="career.vacancies"]').length) throw new Error('Unrecognized Avrora listing');
    add('#vacancies .career-vacancy-card__link', /^\/az\/vakansiya-etrafli\//);
    const total = /^(\d+)\s*aktiv vakansiya/.exec(clean($('.career-hero__facts div').first().text()));
    if (!total) throw new Error('Missing Avrora listing count');
    return { urls, complete: urls.length === Number(total[1]) };
  }
  if (source === 'azergold') {
    if (!$('table').length || !$('.pagination_container').length) throw new Error('Unrecognized AzerGold listing');
    add('table a[href]', /^\/vacancies\/[a-z0-9-]+$/);
    const total = /Ümumi vakansiya sayı:\s*(\d+)/u.exec(clean($.root().text()));
    if (!total) throw new Error('Missing AzerGold listing count');
    return { urls, complete: urls.length === Number(total[1]) };
  }
  if (source === 'irshad') {
    // One unpaginated page with no published count: it is complete only when recognised and non-empty (an empty page can never close postings).
    if (!$('section.career .career__item').length) throw new Error('Unrecognized İrşad listing');
    add('section.career a.career__item__link[href]', /^\/az\/sirket\/vakansiyalar\/[a-z0-9-]+$/);
    if (urls.length !== $('section.career .career__item').length) throw new Error('İrşad listing items without a vacancy link');
    return { urls, complete: true };
  }
  if (source === 'fairmont-baku') {
    // 12 tiles a page; the stated total across pages decides completeness in the collector (a page never claims the whole listing on its own).
    const total = /^Found\s+(\d+)\s+result/.exec(clean($('.attrax-pagination__total-results').first().text()));
    if (!total) throw new Error('Unrecognized Accor listing');
    const tiles = $('div.attrax-vacancy-tile[data-jobid]');
    add('div.attrax-vacancy-tile[data-jobid] a.attrax-vacancy-tile__title[href]', /^\/global\/en\/job\/[a-z0-9-]+-jid-\d+$/);
    if (urls.length !== tiles.length) throw new Error('Accor listing tiles without a vacancy link');
    tiles.each((i, el) => { if (!urls[i].endsWith(`-jid-${$(el).attr('data-jobid')}`)) throw new Error('Accor tile identity mismatch'); });
    return { urls, complete: false, total: Number(total[1]) };
  }
  if (source === 'stp') {
    const total = /^(\d+)\s+Vakansiya$/u.exec(clean($('.section-title h6 span').first().text()));
    if (!total) throw new Error('Unrecognized STP listing');
    add('div.job-list .job-list-title h5 a[href]', /^\/vakansiya-haqqinda\/\d+$/);
    return { urls, complete: urls.length === Number(total[1]) };
  }
  if (source === 'bravo') {
    const articles = $('.vacancies_grid article');
    if (!articles.length || clean($('h1').first().text()) !== 'Bütün vakansiyalar') throw new Error('Unrecognized Bravo listing');
    if ($('.pagination, nav[aria-label*="pagination" i], a[rel="next"], .load-more').length || $('a[href*="?page="], a[href*="&page="]').length) {
      throw new Error('Bravo listing has unverified pagination');
    }
    const factsByUrl: Record<string, EmployerListingFacts> = {};
    articles.each((_, article) => {
      const href = $(article).find('a.full_link[href]').first().attr('href') || '';
      const url = localEmployerUrl(source, href);
      const footer = clean($(article).find('footer').text());
      const dateRange = /\b\d{1,2}\s+[\p{L}]+\s*[-–—]\s*\d{1,2}\s+[\p{L}]+(?:\s+20\d{2})?\b/u.exec(footer)?.[0];
      const location = dateRange ? clean(footer.replace(dateRange, '')) : footer;
      factsByUrl[url] = { ...(location ? { location } : {}), ...(dateRange ? { listingWindowText: dateRange } : {}) };
    });
    add('.vacancies_grid article a.full_link[href]', /^\/career\/all-vacancies\//);
    if (urls.length !== $('.vacancies_grid article').length) throw new Error('Bravo listing items without a vacancy link');
    return { urls, complete: true, factsByUrl };
  }
  if (!$('#getAllVacancies').length || !$('.vacancy-body').length) throw new Error('Unrecognized Veyseloglu listing');
  add('.vacancy-body a[href^="/vac/detail?"]', /^\/vac\/detail$/);
  const end = $('.hide-vacancy-view-more-btn').attr('value');
  if (!/^(true|false)$/i.test(end || '')) throw new Error('Missing Veyseloglu paging boundary');
  return { urls, complete: end?.toLowerCase() === 'true' };
}

/** A source's own publication date (ISO date or date-time); a missing, malformed or future one is not trusted and the first observation is used. */
function sourceDate(value: unknown, now: Date): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const v = value.trim(), d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00+04:00` : v);
  return Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 86_400_000 ? undefined : d.toISOString();
}

export function parseEmployerDetail(source: LocalEmployer, html: string, input: string, now: Date, listingFacts?: EmployerListingFacts): IngestJobDto {
  const url = localEmployerUrl(source, input), $ = cheerio.load(html), cfg = LOCAL_EMPLOYERS[source];
  let title: string, description: string, location: string, deadline: string | undefined, deadlineText: string | undefined;
  let company: string = cfg.company, posted: string | undefined, extra: Record<string, unknown> = {};
  if (source === 'avrora') {
    title = clean($('.av-vacancy-detail article h1').text());
    description = bodyText($('.av-vacancy-detail article .av-richtext').html() || '');
    location = clean($('.av-vacancy-detail article dl div').filter((_, el) => clean($(el).find('dt').text()) === 'Şəhər').find('dd').text());
  } else if (source === 'azergold') {
    title = clean($('.breadcrumb_container > p').first().text());
    description = bodyText($('.markup').html() || '');
    const labels = $('span').filter((_, el) => clean($(el).text()) === 'İş yeri:');
    location = clean(labels.first().next('span').text());
    deadlineText = clean($('span').filter((_, el) => clean($(el).text()) === 'Son müraciət :').first().next('span').text());
    deadline = employerDeadline(deadlineText);
  } else if (source === 'irshad') {
    if ($('link[rel="canonical"]').attr('href') !== url) throw new Error('Unexpected employer identity');
    const heading = $('section.blog-inner h1').first().clone();
    heading.find('br').replaceWith('\n');
    const [name, ...places] = heading.text().split('\n').map(clean).filter(Boolean);
    title = name ?? '';
    // The branch towns follow the title ("Bakı, Gəncə, Şərur"); a trailing "üzrə" ("Şamaxı,Bakı üzrə") is dropped. Nothing is assumed when absent.
    location = places.join(', ').replace(/\s*üzrə$/u, '').replace(/,(?=\S)/g, ', ');
    const body = $('section.blog-inner .blog-inner__center').clone();
    body.find('a').remove();
    description = bodyText(body.html() || '');
  } else if (source === 'fairmont-baku') {
    if ($('link[rel="canonical"]').attr('href') !== url) throw new Error('Unexpected employer identity');
    const ld = $('script[type="application/ld+json"]').map((_, el) => { try { return JSON.parse($(el).text()); } catch { return null; } }).get()
      .find((j: { '@type'?: unknown }) => j && j['@type'] === 'JobPosting') as Record<string, any> | undefined;
    if (!ld || ld.url !== url) throw new Error('Missing Accor posting data');
    title = clean(String(ld.title ?? ''));
    description = bodyText(String(ld.description ?? ''));
    location = clean(String(ld.jobLocation?.[0]?.address?.addressLocality ?? ''));
    // "Fairmont Baku - Flame Towers, Baku, Azerbaijan": the hotel before the first comma is the employer; postings outside Azerbaijan are not ours.
    if (!/,\s*Azerbaijan$/.test(location)) throw new Error('Accor posting outside Azerbaijan');
    company = clean(location.split(',')[0].split(' - ')[0]);
    posted = sourceDate(ld.datePosted, now);
    // validThrough is the posting date plus 100 years on this site: a placeholder, never a deadline. A real one (within two years) is kept.
    const until = typeof ld.validThrough === 'string' ? new Date(ld.validThrough) : null;
    if (until && !Number.isNaN(until.getTime()) && posted && until.getTime() > new Date(posted).getTime() && until.getTime() - new Date(posted).getTime() < 2 * 365 * 86_400_000) deadline = until.toISOString();
    extra = { hotel: clean(location.split(',')[0]), ...(Array.isArray(ld.employmentType) ? { employmentType: ld.employmentType.join(', ') } : {}) };
  } else if (source === 'stp') {
    const overview = (label: string) => $('.job-overview-inner li').filter((_, el) => clean($(el).children('span').first().text()) === label);
    const value = (label: string) => clean(overview(label).find('h5').first().text());
    const tags = (label: string) => overview(label).find('.task-tags span').map((_, el) => clean($(el).text())).get().filter(Boolean).join(', ');
    if (clean($('input[name="id"]').first().attr('value') || '') !== new URL(url).pathname.split('/').pop()) throw new Error('Unexpected employer identity');
    title = clean($('.employers-list-title h5').first().text());
    const options = $('.employers-list-option li');
    const group = clean(options.filter((_, el) => $(el).find('.fa-map-marker-alt').length > 0).first().text());
    if (group) company = group;
    const department = clean(options.first().text());
    const body = bodyText($('.single-page-section').first().html() || '');
    const facts = [['Təcrübə tələbi', value('Təcrübə tələbi')], ['Təhsil', value('Təhsil')], ['İxtisas', tags('Ixtisas')], ['Dil biliyi', tags('Dil biliyi')],
      ['Kompüter bacarıqları', tags('Komputer bacarıqları')], ['Əmək haqqı', value('Əmək haqqı')]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    description = [department && !department.startsWith('Elanın') ? `Departament: ${department}` : '', body, ...facts].filter(Boolean).join('\n');
    // Postings name no workplace; the group's only site is the Sumqayıt technology park (stated in the portal footer), recorded as such.
    location = 'Sumqayıt';
    extra = { locationBasis: 'employer-head-office' };
    posted = sourceDate(value('Elanın yerləşdirmə tarixi'), now);
    deadlineText = value('Son müraciət tarixi') || undefined;
    if (deadlineText) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineText)) throw new Error('Unrecognized STP deadline');
      deadline = new Date(`${deadlineText}T23:59:59+04:00`).toISOString();
    }
  } else if (source === 'bravo') {
    title = clean($('.special_first h1').text());
    $('.article_text a.__cf_email__[data-cfemail], .article_text [data-cfemail]').each((_, el) => {
      const hex = $(el).attr('data-cfemail');
      if (hex) {
        const k = parseInt(hex.substr(0, 2), 16);
        let email = '';
        for (let i = 2; i < hex.length; i += 2) email += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ k);
        $(el).replaceWith(email);
      }
    });
    const body = bodyText($('.article_text').html() || '');
    const formNotice = clean($('.form_section h3, .form_section h4').map((_, el) => clean($(el).text())).get().filter(Boolean).join('\n'));
    description = body || (formNotice ? `${title}\n${formNotice}` : '');
    // The saved Bravo detail fixture exposes only a city inside an HTML comment
    // and the URL category (head-office/markets). Neither is reliable posting
    // location evidence, so preserve the field as unspecified.
    location = listingFacts?.location || 'Azərbaycan (şəhər göstərilməyib)';
    extra = { locationBasis: listingFacts?.location ? 'listing-card' : 'not-specified', ...(listingFacts?.listingWindowText ? { listingWindowText: listingFacts.listingWindowText } : {}) };
  } else {
    title = clean($('.vacancies-header__title').first().text());
    description = bodyText($('.vacancy-container__left').html() || '');
    const label = (name: string) => clean($('.vacancy-info').filter((_, el) => clean($(el).find('.vacancy-info__title').text()) === name).find('.vacancy-info__degree').text());
    location = label('Şəhər'); deadlineText = label('Son müraciət tarixi');
    if (!/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i.test(deadlineText)) throw new Error('Unrecognized Veyseloglu deadline text');
    if (deadlineText) description += `\nSon müraciət tarixi (mənbədə il göstərilmir): ${deadlineText}`;
    if (!clean($('title').text()).startsWith('Veyseloglu MMC -')) throw new Error('Unexpected employer identity');
  }
  if (!title || title.length > 500 || !description || description.length > MAX_JOB_DESCRIPTION_CHARS || !location || location.length > 256) throw new Error('Invalid employer detail');
  const id = source === 'veyseloglu' ? new URL(url).searchParams.get('vacancyId')! : source === 'fairmont-baku' ? /-jid-(\d+)$/.exec(new URL(url).pathname)![1] : new URL(url).pathname.replace(/\/+$/, '').split('/').pop()!;
  if (`${source}:${id}`.length > 256) throw new Error('Employer identity too long');
  return { externalId: `${source}:${id}`, title, company, description, location, url, postedAt: posted ?? now.toISOString(),
    ...(deadline ? { deadline } : {}), detailFetchedAt: now.toISOString(),
    rawPayload: { source, postedAtBasis: posted ? 'source-date' : 'first-observed', ...(deadlineText ? { deadlineText } : {}), ...(source === 'veyseloglu' ? { deadlineYearUnknown: true } : {}), ...extra } };
}

export class LocalEmployerCollector {
  constructor(private source: LocalEmployer,
    private read: (url: string) => Promise<string> = u => fetchPublicDocument(u, v => localEmployerUrl(source, v)),
    private pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date()) {}

  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>) {
    if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 200 || !Number.isInteger(options.maxJobs) || options.maxJobs < 1 || options.maxJobs > 10_000 || !Number.isInteger(options.delayMs) || options.delayMs < 1000 || options.delayMs > 60_000) throw new Error('Invalid collection limits');
    const source = this.source, cfg = LOCAL_EMPLOYERS[source];
    const report = { source, complete: false, outcome: undefined as CollectionOutcome | undefined, pages: 0, discovered: 0, fetched: 0, accepted: 0, expired: 0, failed: 0, error: undefined as string | undefined };
    try {
      let robots: string;
      try { robots = await this.read(`${cfg.origin}/robots.txt`); }
      catch (e) { if (source !== 'veyseloglu' || !(e instanceof Error) || e.message !== 'Source HTTP 404') throw e; robots = 'User-agent: *\nAllow: /'; }
      const delay = Math.max(options.delayMs, robotsCrawlDelayMs(robots) || 0);
      const get = async (u: string) => {
        const url = new URL(localEmployerUrl(source, u));
        if (!robotsAllows(robots, url.pathname + url.search, { crawlDelayHonored: true })) throw new Error('Employer crawler rules prohibit this URL');
        await this.pause(delay); return this.read(url.href);
      };
      const ids = new Set<string>();
      let total: number | undefined;
      for (let page = 1; page <= options.maxPages; page++) {
        const list = parseEmployerListing(source, await get(`${cfg.origin}${listPage(source, page)}`)); report.pages++;
        if (list.total !== undefined) {
          if (total === undefined) total = list.total;
          else if (list.total !== total) throw new Error('Employer result count changed during collection');
        }
        for (const url of list.urls) {
          if (ids.has(url)) throw new Error('Employer paging repeated a vacancy');
          ids.add(url); report.discovered++;
          if (report.fetched >= options.maxJobs) continue;
          const html = await get(url); report.fetched++;
          let job: IngestJobDto;
          try { job = parseEmployerDetail(source, html, url, this.now(), list.factsByUrl?.[url]); }
          catch { report.failed++; continue; }
          if (job.deadline && new Date(job.deadline) < this.now()) report.expired++;
          await accept(job); report.accepted++;
        }
        // A paged listing with a stated total is complete only when exactly that many distinct vacancies were listed.
        if (total !== undefined && ids.size >= total) list.complete = ids.size === total;
        if (total !== undefined && ids.size > total) throw new Error('Employer listing exceeds its stated total');
        if (list.complete) { report.complete = report.failed === 0 && report.fetched === report.discovered; break; }
        if (!PAGED.includes(source) || report.fetched >= options.maxJobs) break;
        if (!list.urls.length) throw new Error('Empty employer page without a verified end marker');
      }
      if (!report.complete) report.error = report.failed ? 'Employer details failed validation; no closures inferred' : 'Employer listing incomplete or collection budget reached';
      report.outcome = report.failed ? 'INVALID_DETAIL' : report.complete
        ? report.discovered === 0 ? 'NO_OPENINGS' : 'COMPLETE_CENSUS'
        : 'BOUNDED_PROGRESS';
    } catch (e) { report.outcome = 'UPSTREAM_FAILURE'; report.error = e instanceof Error ? e.message : 'Employer collection failed'; }
    return report;
  }
}
