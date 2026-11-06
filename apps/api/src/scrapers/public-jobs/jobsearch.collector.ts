import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { fetchPublicDocument, robotsAllows, robotsCrawlDelayMs, type CollectionOptions } from './public-job-collector';
import { JOBSEARCH_MIN_DELAY_MS, JOBSEARCH_ORIGIN, jobsearchUrl, parseJobsearchDetail, parseJobsearchListing } from './jobsearch.parser';

export interface JobsearchCollectionReport { source: 'jobsearch'; complete: boolean; outcome?: CollectionOutcome; pages: number; discovered: number; fetched: number; expired: number; failed: number; accepted: number; known?: number; delayMs?: number; /** Why fetched details were refused, by reason (counts only; never page content). */ rejections?: Record<string, number>; error?: string }

/**
 * JobSearch classic: one listing request (the latest ~200 cards, no proven pagination) plus detail pages, paced at the robots.txt crawl-delay (30 s for `*`).
 * The listing is a bounded recent snapshot, so `complete` is always false and nothing can be closed because of it.
 */
export class JobsearchCollector {
  constructor(
    private read: (url: string) => Promise<string> = (u) => fetchPublicDocument(u, jobsearchUrl, ['text/html', 'text/plain'], 4 * 1024 * 1024),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private now: () => Date = () => new Date(),
  ) {}

  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>): Promise<JobsearchCollectionReport> {
    const { maxPages, maxJobs, delayMs } = options;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200 || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10_000 || !Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 60_000) throw new Error('Invalid collection limits');
    const report: JobsearchCollectionReport = { source: 'jobsearch', complete: false, pages: 0, discovered: 0, fetched: 0, expired: 0, failed: 0, accepted: 0 };
    try {
      const robots = await this.read(`${JOBSEARCH_ORIGIN}/robots.txt`);
      const wait = Math.max(delayMs, robotsCrawlDelayMs(robots) ?? 0, JOBSEARCH_MIN_DELAY_MS);
      report.delayMs = wait;
      const get = async (url: string) => {
        const u = new URL(url);
        if (!robotsAllows(robots, u.pathname + u.search, { crawlDelayHonored: true })) throw new Error('Source crawler rules prohibit this URL');
        await this.pause(wait);
        return this.read(url);
      };
      const listing = parseJobsearchListing(await get(`${JOBSEARCH_ORIGIN}/vacancies?hl=az`));
      report.pages = 1;
      for (const entry of listing.entries) {
        report.discovered++;
        if (options.isKnown?.(`jobsearch:${entry.id}`)) { report.known = (report.known ?? 0) + 1; continue; }
        if (report.fetched >= maxJobs) continue;
        const html = await get(entry.url); report.fetched++;
        let job: IngestJobDto;
        try { job = parseJobsearchDetail(html, entry.url, this.now(), entry); } catch (e) { report.failed++; const why = (e instanceof Error ? e.message : 'unreadable').replace(/[0-9]+/g, 'N').slice(0, 80); (report.rejections ??= {})[why] = (report.rejections[why] ?? 0) + 1; continue; }
        if (job.deadline && new Date(job.deadline) < this.now()) report.expired++;
        await accept(job); report.accepted++;
      }
      report.error = report.failed ? 'Some details could not be parsed; no closures inferred' : 'Collection limit reached; JobSearch classic listing is a bounded recent snapshot, active census not proven; no closures inferred';
      report.outcome = report.failed ? 'INVALID_DETAIL' : 'BOUNDED_PROGRESS';
    } catch (e) { Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const }); report.error = e instanceof Error ? e.message : 'Collection failed'; }
    return report;
  }
}
