import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { fetchPublicDocument, robotsAllows, type CollectionOptions } from './public-job-collector';
import { AZ_CITIES } from './abb.collector';

/**
 * Kapital Bank group career site (careers.bir.az: Bir, Birbank, m10, Birmarket). The site is a single-page app that reads its vacancies from the group's own public
 * JSON endpoints (no login, no key); this collector reads the same two GET endpoints, never the candidate/profile/apply endpoints. The posting's page is
 * https://careers.bir.az/vacancies/<id> and applying there needs the candidate's own account, so the application route is the employer's site (EXTERNAL_SITE).
 *
 * Access basis (11 October 2026): no robots.txt is published (the site returns its app shell for /robots.txt and the API host answers 404), no terms forbid
 * automated reading, no republication grant either: the same ROBOTS_ALLOWED_TERMS_PENDING state as the other employer feeds (pause/hide/remove on request).
 */
export const KAPITAL_API_ORIGIN = 'https://apihr.kapitalbank.az';
export const KAPITAL_SITE_ORIGIN = 'https://careers.bir.az';
const LIST_PATH = '/api/Vacancy/vacancies';
const DETAIL_PATH = '/api/Vacancy/getVacancyById';
const PAGE = 100;
const clean = (text: string) => text.replace(/[\s﻿ ]+/g, ' ').trim();

/** Only the two read endpoints (with their own parameters) and the site's robots.txt. */
export function kapitalUrl(input: string): string {
  const url = new URL(input, KAPITAL_API_ORIGIN);
  if (url.username || url.password || url.hash || /%|\\/.test(url.pathname)) throw new Error('Unsupported Kapital URL');
  if (url.origin === KAPITAL_SITE_ORIGIN && url.pathname === '/robots.txt' && !url.search) return url.href;
  if (url.origin !== KAPITAL_API_ORIGIN) throw new Error('Unsupported Kapital URL');
  if (url.pathname === LIST_PATH) {
    const allowed = new Set(['Skip', 'Take', 'SortField', 'OrderBy']);
    if ([...url.searchParams.keys()].some((k) => !allowed.has(k))) throw new Error('Unsupported Kapital list options');
    const skip = Number(url.searchParams.get('Skip') ?? '0'), take = Number(url.searchParams.get('Take') ?? String(PAGE));
    if (!Number.isInteger(skip) || skip < 0 || skip > 100_000 || !Number.isInteger(take) || take < 1 || take > 200) throw new Error('Invalid Kapital paging');
    return url.href;
  }
  if (url.pathname === DETAIL_PATH) {
    if ([...url.searchParams.keys()].some((k) => k !== 'id') || !/^[1-9]\d{0,9}$/.test(url.searchParams.get('id') ?? '')) throw new Error('Invalid Kapital vacancy id');
    return url.href;
  }
  throw new Error('Unsupported Kapital URL');
}

/** The posting's public page. */
export const kapitalVacancyPage = (id: number) => `${KAPITAL_SITE_ORIGIN}/vacancies/${id}`;

/** Source dates are Azerbaijan calendar days (UTC+4); a deadline includes its whole day. */
export function kapitalDate(value: unknown, endOfDay = false): string {
  if (typeof value !== 'string') throw new Error('Missing Kapital date');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) throw new Error('Invalid Kapital date');
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo, d));
  if (y < 2000 || y > 2100 || check.getUTCFullYear() !== y || check.getUTCMonth() !== mo || check.getUTCDate() !== d) throw new Error('Invalid Kapital calendar date');
  return new Date(Date.UTC(y, mo, d, endOfDay ? 19 : -4, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)).toISOString();
}

const text = (html: unknown): string => {
  if (typeof html !== 'string' || !html.trim()) return '';
  const $ = cheerio.load(html);
  $('script,style,iframe,form,button,input').remove();
  $('br').replaceWith('\n'); $('p,li,h1,h2,h3,h4,ul,ol').append('\n');
  return $.root().text().split('\n').map(clean).filter(Boolean).join('\n');
};

export interface KapitalListItem { id: number; isPrivate: boolean }
export function parseKapitalList(raw: string): { items: KapitalListItem[]; total: number } {
  const page = JSON.parse(raw) as { data?: unknown; totalCount?: unknown };
  if (!page || !Array.isArray(page.data) || !Number.isSafeInteger(page.totalCount) || (page.totalCount as number) < 0 || page.data.length > 500) throw new Error('Invalid Kapital listing contract');
  const items = page.data.map((row) => {
    const r = row as Record<string, unknown>;
    if (!r || !Number.isSafeInteger(r.id) || Number(r.id) < 1) throw new Error('Invalid Kapital vacancy identity');
    return { id: Number(r.id), isPrivate: r.isPrivate === true };
  });
  return { items, total: page.totalCount as number };
}

/** A posting from its detail record; null when it is private or not (yet) public. */
export function parseKapitalJob(input: unknown, fetchedAt: Date): IngestJobDto | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid Kapital job');
  const row = input as Record<string, any>;
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid Kapital identity');
  if (row.isPrivate === true) return null;
  if (typeof row.header !== 'string' || !clean(row.header)) throw new Error('Missing Kapital title');
  const title = clean(row.header);
  const deadline = kapitalDate(row.endDate, true);
  const postedAt = typeof row.createdDate === 'string' ? kapitalDate(row.createdDate) : new Date(new Date(deadline).getTime() - 30 * 86400000).toISOString();
  if (new Date(postedAt) > fetchedAt) return null;
  const sections: [string, string][] = [
    ['', text(row.description)],
    ['Vəzifə öhdəlikləri', text(row.liability)],
    ['Tələblər', text(row.requirement)],
    ['Üstünlüklər', text(row.advantage)],
    ['Rol haqqında', text(row.roleInfo)],
  ];
  const description = sections.filter(([, body]) => body).map(([head, body]) => (head ? `${head}:\n${body}` : body)).join('\n\n');
  if (!title || title.length > 500 || !description || description.length > MAX_JOB_DESCRIPTION_CHARS) throw new Error('Invalid Kapital content');
  const company = clean(String(row.companyDto?.displayName ?? '')) || 'Kapital Bank';
  // The source's "region" field is not reliable (a Qusar branch is filed under Ağstafa, an Ağcabədi branch under Bakı), so it is not used. The place is taken only from what
  // the posting itself names: a branch called "<place> (rayon|şəhər) filialı" in the office or the title, or Baku named explicitly; otherwise it is "Azerbaijan".
  const office = typeof row.location === 'string' ? clean(row.location.replace(/,\s*$/, '')) : '';
  const place = (value: string): string | null => {
    const m = /^(.+?)\s+(?:rayon\s+|şəhər\s+)?filial[ıi]?(?:nın|nin)?\b/iu.exec(value);
    const name = clean(m ? m[1] : value);
    return AZ_CITIES.find((c) => c.toLocaleLowerCase('az') === name.toLocaleLowerCase('az')) ?? null;
  };
  const named = place(office) ?? place(title) ?? (/\b(?:Port\s*Baku|PBT\d?|Bakı|Baku)\b/iu.test(`${office} ${title}`) ? 'Bakı' : null);
  const location = named ?? 'Azerbaijan';
  return {
    externalId: `kapital:${id}`, title, company, description, location, url: kapitalVacancyPage(id), postedAt, deadline, detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: { source: 'kapital', group: 'Kapital Bank', field: typeof row.field === 'string' ? row.field : null, level: typeof row.level === 'string' ? row.level : null, office: office || null, employmentOpportunity: typeof row.employmentOpportunity === 'string' ? row.employmentOpportunity : null, locationEvidence: named ? 'branch-or-office-name' : 'country-only' },
  };
}

export class KapitalCollector {
  constructor(
    private read: (url: string) => Promise<string> = (url) => fetchPublicDocument(url, kapitalUrl, url.endsWith('/robots.txt') ? ['text/plain', 'text/html'] : ['application/json'], 2 * 1024 * 1024),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
  ) {}

  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>) {
    const { maxPages, maxJobs, delayMs } = options;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200 || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10_000 || !Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 60_000) throw new Error('Invalid collection limits');
    const report = { source: 'kapital', complete: false, outcome: undefined as CollectionOutcome | undefined, pages: 0, discovered: 0, fetched: 0, expired: 0, skipped: 0, failed: 0, accepted: 0, error: undefined as string | undefined };
    try {
      // The site publishes no robots.txt (its app shell, or a 404, answers): nothing to obey beyond the spacing and the two read endpoints. A real robots file is honoured.
      let robots = '';
      try { robots = await this.read(`${KAPITAL_SITE_ORIGIN}/robots.txt`); } catch { robots = ''; }
      if (robots && !/^\s*</.test(robots) && !robotsAllows(robots, LIST_PATH, { crawlDelayHonored: true })) throw new Error('Kapital crawler rules prohibit the vacancy endpoint');
      const ids: number[] = [];
      let total: number | undefined;
      for (let skip = 0; report.pages < maxPages; skip += PAGE) {
        await this.pause(delayMs);
        const list = parseKapitalList(await this.read(`${KAPITAL_API_ORIGIN}${LIST_PATH}?Skip=${skip}&Take=${PAGE}&SortField=createdAt&OrderBy=desc`));
        if (total !== undefined && list.total !== total) throw new Error('Kapital listing changed during paging; coverage incomplete');
        total = list.total; report.pages++;
        for (const item of list.items) {
          if (ids.includes(item.id)) throw new Error('Kapital paging repeated a vacancy');
          if (item.isPrivate) { report.skipped++; continue; }
          ids.push(item.id);
        }
        if (!list.items.length || skip + PAGE >= list.total) break;
      }
      report.discovered = ids.length + report.skipped;
      for (const id of ids) {
        if (report.fetched >= maxJobs) break;
        report.fetched++;
        await this.pause(delayMs);
        let job: IngestJobDto | null;
        let detail: string;
        try { detail = await this.read(`${KAPITAL_API_ORIGIN}${DETAIL_PATH}?id=${id}`); }
        catch (error) {
          report.failed++;
          report.outcome = 'UPSTREAM_FAILURE';
          report.error = error instanceof Error ? error.message : 'Kapital detail request failed';
          return report;
        }
        try { job = parseKapitalJob(JSON.parse(detail), this.now()); } catch { report.failed++; continue; }
        if (!job) { report.skipped++; continue; }
        if (job.deadline && new Date(job.deadline) < this.now()) report.expired++;
        await accept(job); report.accepted++;
      }
      const seenAll = total !== undefined && ids.length + report.skipped === total;
      report.complete = seenAll && report.fetched === ids.length && report.failed === 0;
      report.outcome = report.failed ? 'INVALID_DETAIL' : report.complete ? report.discovered === 0 ? 'NO_OPENINGS' : 'COMPLETE_CENSUS' : 'BOUNDED_PROGRESS';
      if (!report.complete) report.error = report.failed ? 'Some Kapital postings could not be read; no closures inferred' : 'Collection limit reached or count inconsistent; coverage incomplete';
    } catch (error) { Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const }); report.error = error instanceof Error ? error.message : 'Kapital collection failed'; }
    return report;
  }
}
