import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { fetchPublicDocument, robotsAllows, type CollectionOptions } from './public-job-collector';

export const PWC_ORIGIN = 'https://jobs-cee.pwc.com';
export const PWC_LIST = `${PWC_ORIGIN}/ea/en/search-results-azerbaijan`;
const ID = /^[1-9]\d{4,10}WD$/;
const clean = (s: string) => s.replace(/[\s\uFEFF]+/g, ' ').trim();

export function pwcUrl(input: string): string {
  const url = new URL(input, PWC_ORIGIN);
  if (url.origin !== PWC_ORIGIN || url.username || url.password || url.search || url.hash || /%|\\/.test(url.pathname) ||
    !(url.pathname === '/robots.txt' || url.href === PWC_LIST || /^\/ea\/en\/job\/[1-9]\d{4,10}WD\/[A-Za-z0-9-]+$/.test(url.pathname))) throw new Error('Unsupported PwC public URL');
  return url.href;
}

/** Parse only the public JSON literal. Never evaluate the page's JavaScript or retain session/config data. */
export function publicPhenomData(html: string): Record<string, any> {
  const $ = cheerio.load(html);
  for (const element of $('script:not([src])').toArray()) {
    const script = $(element).text(), match = /\bphApp\.ddo\s*=\s*\{/.exec(script);
    if (!match) continue;
    const start = match.index + match[0].lastIndexOf('{'); let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < script.length; i++) {
      const char = script[i];
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        const value = JSON.parse(script.slice(start, i + 1));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid public search data');
        return value;
      }
    }
    throw new Error('Incomplete public search data');
  }
  throw new Error('Missing public search data');
}

export function parsePwcListing(html: string): { urls: string[]; total: number } {
  const result = publicPhenomData(html).eagerLoadRefineSearch;
  if (result?.status !== 200 || !Number.isSafeInteger(result.totalHits) || result.totalHits < 0 || result.totalHits > 100_000 ||
    !Array.isArray(result.data?.jobs) || result.hits !== result.data.jobs.length || result.hits > result.totalHits ||
    JSON.stringify(result.data.ui_selections?.country) !== '["Azerbaijan"]') throw new Error('Unrecognized PwC Azerbaijan listing');
  const urls: string[] = [], ids = new Set<string>();
  for (const row of result.data.jobs) {
    if (!ID.test(row.jobId) || ids.has(row.jobId) || typeof row.title !== 'string' || row.country !== 'Azerbaijan' || row.visibilityType !== 'External') throw new Error('Invalid PwC listing row');
    ids.add(row.jobId);
    // Verified against all three rendered links on this source's Azerbaijan page.
    const slug = row.title.replace(/[^A-Za-z0-9\s-]/g, '').trim().replace(/[\s-]+/g, '-');
    if (!slug) throw new Error('Unrecognized PwC title URL');
    urls.push(pwcUrl(`${PWC_ORIGIN}/ea/en/job/${row.jobId}/${slug}`));
  }
  if (!urls.length && result.totalHits) throw new Error('Missing PwC listing rows');
  return { urls, total: result.totalHits };
}

function calendarDate(input: unknown): string {
  if (typeof input !== 'string') throw new Error('Missing PwC posting date');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) throw new Error('Unrecognized PwC calendar date');
  const year = Number(match[1]), month = Number(match[2]) - 1, day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (year < 2000 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) throw new Error('Invalid PwC calendar date');
  return new Date(Date.UTC(year, month, day, -4)).toISOString();
}

export function parsePwcJob(html: string, input: string, fetchedAt: Date): IngestJobDto | null {
  const requested = pwcUrl(input), id = new URL(requested).pathname.split('/')[4], $ = cheerio.load(html);
  const current = publicPhenomData(html).jobDetail;
  if (current?.status !== 200 || current.hits !== 1 || current.data?.job?.jobId !== id) throw new Error('Unrecognized PwC detail state');
  if (current.data.job.postingStatus !== 'OPEN') {
    if (current.data.job.postingStatus === 'CLOSED') return null;
    throw new Error('Unrecognized PwC posting status');
  }
  const jobs = $('script[type="application/ld+json"]').toArray().map((e) => JSON.parse($(e).text())).filter((row) => row['@type'] === 'JobPosting');
  if (jobs.length !== 1) throw new Error('Missing or ambiguous PwC job metadata');
  const row = jobs[0], address = row.jobLocation?.address;
  if (row.identifier?.value !== id || row.hiringOrganization?.name !== 'Pwc CEE') throw new Error('PwC metadata identity mismatch');
  if (address?.addressCountry !== 'Azerbaijan' || current.data.job.country !== 'Azerbaijan' || current.data.job.visibilityType !== 'External') return null;
  const title = typeof row.title === 'string' ? clean(row.title) : '', location = typeof address.addressLocality === 'string' ? clean(address.addressLocality) : 'Azerbaijan';
  if (typeof row.description !== 'string') throw new Error('Missing PwC full description');
  const decoded = /&(?:lt|#0*60|#x0*3c);/i.test(row.description) ? cheerio.load(row.description).root().text() : row.description;
  const text = cheerio.load(decoded);
  text('script,style,iframe,form,input,button').remove(); text('br').replaceWith('\n'); text('p,li,h1,h2,h3,h4').prepend('\n').append('\n');
  const description = text.root().text().split('\n').map(clean).filter(Boolean).join('\n');
  const postedAt = calendarDate(row.datePosted);
  if (new Date(postedAt) > fetchedAt) return null;
  if (!title || title.length > 500 || !description || description.length > MAX_JOB_DESCRIPTION_CHARS || !location || location.length > 256) throw new Error('Invalid PwC job content');
  const url = pwcUrl($('link[rel="canonical"]').attr('href') || '');
  if (new URL(url).pathname.split('/')[4] !== id) throw new Error('PwC canonical identity mismatch');
  // Current source has no deadline. Do not fabricate one; source-closure reconciliation remains a separate gate.
  if (row.validThrough !== undefined) throw new Error('PwC deadline contract needs review');
  return { externalId: `pwc:${id}`, title, company: 'PwC', description, location, url, postedAt, detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: { source: 'pwc', locationEvidence: 'source-job-metadata', postingDateEvidence: 'source-jsonld-calendar', deadlineEvidence: 'not-provided' } };
}

export class PwcCollector {
  constructor(private read: (url: string) => Promise<string> = (url) => fetchPublicDocument(url, pwcUrl),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), private now: () => Date = () => new Date()) {}
  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>) {
    if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 200 || !Number.isInteger(options.maxJobs) || options.maxJobs < 1 || options.maxJobs > 10_000 || !Number.isInteger(options.delayMs) || options.delayMs < 1000 || options.delayMs > 60_000) throw new Error('Invalid collection limits');
    const report = { source: 'pwc', complete: false, outcome: undefined as CollectionOutcome | undefined, pages: 0, discovered: 0, fetched: 0, expired: 0, skipped: 0, failed: 0, accepted: 0, error: undefined as string | undefined };
    try {
      const robots = await this.read(`${PWC_ORIGIN}/robots.txt`);
      const get = async (url: string) => { if (!robotsAllows(robots, new URL(url).pathname)) throw new Error('PwC crawler rules prohibit this URL'); await this.pause(options.delayMs); return this.read(url); };
      const listing = parsePwcListing(await get(PWC_LIST)); report.pages = 1; report.discovered = listing.total;
      for (const url of listing.urls.slice(0, options.maxJobs)) {
        const html = await get(url); report.fetched++;
        let job: IngestJobDto | null;
        try { job = parsePwcJob(html, url, this.now()); } catch { report.failed++; continue; }
        if (!job) { report.skipped++; continue; } await accept(job); report.accepted++;
      }
      report.complete = report.fetched === listing.total && !report.failed;
      report.outcome = report.failed ? 'INVALID_DETAIL' : report.complete ? report.discovered === 0 ? 'NO_OPENINGS' : 'COMPLETE_CENSUS' : 'BOUNDED_PROGRESS';
      if (!report.complete) report.error = report.failed ? 'Some PwC details could not be parsed; no closures inferred' : 'Collection limit reached or additional source pagination needs review; coverage incomplete';
    } catch (error) { Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const }); report.error = error instanceof Error ? error.message : 'PwC collection failed'; }
    return report;
  }
}
