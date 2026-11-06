import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { fetchPublicDocument, robotsAllows, robotsCrawlDelayMs, type CollectionOptions, type DiscoveryCursor } from './public-job-collector';
import { BANKER_MIN_DELAY_MS, BANKER_ORIGIN, bankerUrl, parseBankerDetail, parseBankerListing } from './banker.parser';

export interface BankerCollectionReport {
  source: 'banker';
  outcome?: CollectionOutcome;
  cursor?: DiscoveryCursor | null;
  complete: boolean;
  pages: number;
  discovered: number;
  fetched: number;
  expired: number;
  failed: number;
  accepted: number;
  known?: number;
  delayMs?: number;
  rejections?: Record<string, number>;
  error?: string;
}

/**
 * Banker.az collector: specialized Azerbaijani banking, BOKT, fintech, and microfinance job board.
 * Paced at robots.txt crawl-delay (min 1500 ms).
 * Pages through /vakansiyalar/ and /vakansiyalar/?paged=N.
 */
export class BankerCollector {
  constructor(
    private read: (url: string) => Promise<string> = (u) => fetchPublicDocument(u, bankerUrl, ['text/html', 'text/plain'], 4 * 1024 * 1024),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private now: () => Date = () => new Date(),
  ) {}

  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>): Promise<BankerCollectionReport> {
    const { maxPages, maxJobs, delayMs } = options;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200 || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10_000 || !Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 60_000) {
      throw new Error('Invalid collection limits');
    }
    const report: BankerCollectionReport = {
      source: 'banker',
      complete: false,
      pages: 0,
      discovered: 0,
      fetched: 0,
      expired: 0,
      failed: 0,
      accepted: 0,
    };
    let page = options.resume?.kind === 'page'
      ? Math.max(1, options.resume.page - 1)
      : Math.max(1, options.startPage ?? 1);
    try {
      const robots = await this.read(`${BANKER_ORIGIN}/robots.txt`);
      const wait = Math.max(delayMs, robotsCrawlDelayMs(robots) ?? 0, BANKER_MIN_DELAY_MS);
      report.delayMs = wait;
      const get = async (url: string) => {
        const u = new URL(url);
        if (!robotsAllows(robots, u.pathname + u.search, { crawlDelayHonored: true })) {
          throw new Error('Source crawler rules prohibit this URL');
        }
        await this.pause(wait);
        return this.read(url);
      };

      const seenIds = new Set<string>();
      let reachedEnd = false;
      let stoppedAt: number | null = null;
      while (report.pages < maxPages && report.fetched < maxJobs) {
        const listUrl = page === 1 ? `${BANKER_ORIGIN}/vakansiyalar/` : `${BANKER_ORIGIN}/vakansiyalar/?paged=${page}`;
        const html = await get(listUrl);
        report.pages++;
        const listing = parseBankerListing(html);
        let pageComplete = true;

        for (const entry of listing.entries) {
          if (seenIds.has(entry.id)) continue;
          seenIds.add(entry.id);
          report.discovered++;
          await options.onListed?.(`banker:${entry.id}`);

          if (options.isKnown?.(`banker:${entry.id}`)) {
            report.known = (report.known ?? 0) + 1;
            continue;
          }
          if (report.fetched >= maxJobs) { pageComplete = false; break; }

          const detailHtml = await get(entry.url);
          report.fetched++;
          let job: IngestJobDto;
          try {
            job = parseBankerDetail(detailHtml, entry.url, this.now(), entry);
          } catch (e) {
            report.failed++;
            const why = (e instanceof Error ? e.message : 'unreadable').replace(/[0-9]+/g, 'N').slice(0, 80);
            (report.rejections ??= {})[why] = (report.rejections[why] ?? 0) + 1;
            await options.onFailedDetail?.(`banker:${entry.id}`, why);
            continue;
          }
          if (job.deadline && new Date(job.deadline) < this.now()) report.expired++;
          await accept(job);
          report.accepted++;
        }

        if (!pageComplete) {
          stoppedAt = page;
          break;
        }
        if (!listing.entries.length) {
          reachedEnd = true;
          break;
        }
        page++;
      }
      report.complete = reachedEnd && report.failed === 0;
      report.cursor = report.complete ? null : { kind: 'page', page: stoppedAt ?? page };
      report.outcome = report.failed
        ? 'INVALID_DETAIL'
        : report.complete
          ? (report.discovered === 0 ? 'NO_OPENINGS' : 'COMPLETE_CENSUS')
          : 'BOUNDED_PROGRESS';
      if (!report.complete) report.error = report.failed
        ? 'Some details could not be parsed; no closures inferred'
        : 'Banker.az collection limit reached; coverage incomplete';
    } catch (e) {
      report.outcome = 'UPSTREAM_FAILURE';
      report.complete = false;
      report.cursor = { kind: 'page', page };
      report.error = e instanceof Error ? e.message : 'Collection failed';
    }
    return report;
  }
}
