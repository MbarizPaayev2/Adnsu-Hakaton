import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { fetchPublicDocument, robotsAllows, type CollectionOptions } from './public-job-collector';

export const ABB_ORIGIN = 'https://careers.abb-bank.az';
const LIST = '/api/vacancy/v2/get';
const clean = (text: string) => text.replace(/[\s\uFEFF]+/g, ' ').trim();

/** Only the observed public listing and canonical vacancy routes, no accounts/apply endpoints. */
export function abbUrl(input: string): string {
  const url = new URL(input, ABB_ORIGIN);
  if (url.origin !== ABB_ORIGIN || url.username || url.password || /%|\\/.test(url.pathname) ||
      !(url.pathname === '/robots.txt' || url.pathname === LIST || /^\/vakansiyalar\/v2\/[1-9]\d*$/.test(url.pathname))) throw new Error('Unsupported ABB public URL');
  if ([...url.searchParams.keys()].some((key) => key !== 'page') || (url.search && url.pathname !== LIST) || url.hash) throw new Error('Unsupported ABB URL options');
  const page = url.searchParams.get('page');
  if (url.searchParams.getAll('page').length > 1 || (page !== null && (!/^[1-9]\d*$/.test(page) || Number(page) > 10_000))) throw new Error('Invalid ABB page');
  return url.href;
}

/** Source calendar dates are in Azerbaijan (UTC+4); deadline includes the entire stated day. */
export function abbDate(value: unknown, endOfDay = false): string {
  if (typeof value !== 'string') throw new Error('Missing ABB date');
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) throw new Error('Invalid ABB date');
  const day = Number(match[1]), month = Number(match[2]) - 1, year = Number(match[3]);
  const check = new Date(Date.UTC(year, month, day));
  if (year < 2000 || year > 2100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) throw new Error('Invalid ABB calendar date');
  return new Date(Date.UTC(year, month, day, endOfDay ? 19 : -4, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)).toISOString();
}

export const AZ_CITIES = ['Bakı', 'Gəncə', 'Sumqayıt', 'Lənkəran', 'Naxçıvan', 'Şəki', 'Şəmkir', 'Qazax', 'İsmayıllı', 'Şabran', 'Zərdab', 'Xankəndi', 'Mingəçevir', 'Quba', 'Qusar', 'Şamaxı', 'Xaçmaz', 'Salyan', 'Bərdə', 'Yevlax', 'Ağdaş', 'Ağcabədi', 'Sabirabad', 'Masallı', 'Qəbələ', 'Göyçay', 'Tovuz', 'Zaqatala'];

export function parseAbbJob(input: unknown, fetchedAt: Date): IngestJobDto | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid ABB job');
  const row = input as Record<string, unknown>;
  if (!Number.isSafeInteger(row.id) || Number(row.id) < 1 || ![0, 1].includes(row.is_public as number) || !['string', 'number'].includes(typeof row.status)) throw new Error('Invalid ABB identity/status');
  if (row.is_public !== 1 || String(row.status) !== '1') return null;
  if (typeof row.title !== 'string' || typeof row.description !== 'string' || typeof row.url !== 'string') throw new Error('Missing ABB fields');
  const title = clean(row.title), url = abbUrl(row.url);
  if (new URL(url).pathname !== `/vakansiyalar/v2/${row.id}`) throw new Error('ABB identifier/link mismatch');
  const postedAt = abbDate(row.begin_date), deadline = abbDate(row.end_date, true);
  if (new Date(deadline) < new Date(postedAt)) throw new Error('Inverted ABB date range');
  if (new Date(postedAt) > fetchedAt) return null;
  const $ = cheerio.load(row.description);
  $('script,style,iframe,form,button,input').remove();
  $('br').replaceWith('\n'); $('p,li,h1,h2,h3,h4').append('\n');
  const description = $.root().text().split('\n').map(clean).filter(Boolean).join('\n');
  if (!title || title.length > 500 || !description || description.length > MAX_JOB_DESCRIPTION_CHARS) throw new Error('Invalid ABB content');
  const suffix = title.split(/\s+[–—-]\s+/).pop()!;
  // Never infer every ABB role is in Baku. Use an explicit recognized city suffix only.
  const location = AZ_CITIES.find((city) => city.toLocaleLowerCase('az') === suffix.toLocaleLowerCase('az')) || 'Azerbaijan';
  return { externalId: `abb:${row.id}`, title, company: 'ABB', description, location, url, postedAt, deadline, detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: { source: 'abb', employmentType: typeof row.type === 'string' ? row.type : null, term: typeof row.term === 'string' ? row.term : null, locationEvidence: location === 'Azerbaijan' ? 'country-only' : 'explicit-title-suffix' } };
}

interface AbbPage { current_page: number; last_page: number; total: number; data: unknown[]; next_page_url: string | null }
export function parseAbbPage(text: string, expectedPage: number): AbbPage {
  const page = JSON.parse(text) as AbbPage;
  if (!page || !Number.isSafeInteger(page.current_page) || page.current_page !== expectedPage || !Number.isSafeInteger(page.last_page) || page.last_page < expectedPage ||
      !Number.isSafeInteger(page.total) || page.total < 0 || !Array.isArray(page.data) || page.data.length > 500 || !(page.next_page_url === null || typeof page.next_page_url === 'string')) throw new Error('Invalid ABB listing contract');
  if ((page.last_page > expectedPage) !== (page.next_page_url !== null)) throw new Error('Inconsistent ABB pagination');
  if (page.next_page_url) {
    const next = new URL(abbUrl(page.next_page_url));
    if (next.pathname !== LIST || next.searchParams.get('page') !== String(expectedPage + 1)) throw new Error('Invalid ABB next page');
  }
  if ((!page.data.length && page.total > 0) || (page.total === 0 && page.data.length)) throw new Error('Inconsistent ABB result count');
  return page;
}

export class AbbCollector {
  constructor(
    private read: (url: string) => Promise<string> = (url) => fetchPublicDocument(url, abbUrl, url.endsWith('/robots.txt') ? ['text/plain', 'text/html'] : ['application/json']),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
  ) {}

  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>) {
    const { maxPages, maxJobs, delayMs } = options;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200 || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10_000 || !Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 60_000) throw new Error('Invalid collection limits');
    const report = { source: 'abb', complete: false, outcome: undefined as CollectionOutcome | undefined, pages: 0, discovered: 0, fetched: 0, expired: 0, skipped: 0, failed: 0, accepted: 0, error: undefined as string | undefined };
    const seen = new Set<number>();
    let next: string | null = `${ABB_ORIGIN}${LIST}`, total: number | undefined;
    try {
      const robots = await this.read(`${ABB_ORIGIN}/robots.txt`);
      while (next && report.pages < maxPages && report.fetched < maxJobs) {
        if (!robotsAllows(robots, new URL(next).pathname + new URL(next).search)) throw new Error('ABB crawler rules prohibit this URL');
        await this.pause(delayMs);
        const page = parseAbbPage(await this.read(next), report.pages + 1);
        if (total !== undefined && page.total !== total) throw new Error('ABB listing changed during pagination; coverage incomplete');
        total = page.total; report.pages++;
        for (const row of page.data) {
          report.discovered++;
          if (report.fetched >= maxJobs) continue;
          report.fetched++;
          let job: IngestJobDto | null;
          try { job = parseAbbJob(row, this.now()); } catch { report.failed++; continue; }
          const id = Number((row as Record<string, unknown>).id);
          if (seen.has(id)) throw new Error('ABB pagination repeated a job');
          seen.add(id);
          if (!job) { report.skipped++; continue; }
          if (new Date(job.deadline!) < this.now()) report.expired++;
          await accept(job); report.accepted++;
        }
        next = page.next_page_url;
      }
      report.complete = next === null && report.discovered === report.fetched && report.discovered === total && report.failed === 0;
      report.outcome = report.failed ? 'INVALID_DETAIL' : report.complete ? report.discovered === 0 ? 'NO_OPENINGS' : 'COMPLETE_CENSUS' : 'BOUNDED_PROGRESS';
      if (!report.complete) report.error = report.failed ? 'Some ABB rows could not be parsed; no closures inferred' : 'Collection limit reached or count inconsistent; coverage incomplete';
    } catch (error) { Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const }); report.error = error instanceof Error ? error.message : 'ABB collection failed'; }
    // Never close jobs from absence in a capped/failed feed. Explicit deadlines are refreshed normally.
    return report;
  }
}
