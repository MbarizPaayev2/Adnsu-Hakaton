import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { fetchPublicDocument, robotsAllows, robotsCrawlDelayMs, type CollectionOptions, type DiscoveryCursor } from './public-job-collector';
import { HRIN_ORIGIN, hrinUrl, parseHrinDetail, parseHrinListing } from './hrin.parser';

export const HRIN_MIN_DELAY_MS = 1500;
export interface HrinCollectionReport {
  source: 'hrin'; complete: false; outcome?: CollectionOutcome; pages: number; discovered: number; fetched: number; expired: number; failed: number; accepted: number;
  known?: number; delayMs?: number; cursor?: DiscoveryCursor | null; error?: string;
}

/**
 * HRIN's robots-approved server-rendered first page is a fresh, bounded snapshot, not a proven census. We only read public listing/detail pages,
 * never call its disallowed /api or account surfaces, and never infer closures from an item missing from this page.
 */
export class HrinCollector {
  constructor(
    private read: (url: string) => Promise<string> = (url) => fetchPublicDocument(url, hrinUrl, ['text/html', 'text/plain'], 4 * 1024 * 1024),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
  ) {}

  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>): Promise<HrinCollectionReport> {
    const { maxPages, maxJobs, delayMs } = options;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200 || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10_000 ||
        !Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 60_000) throw new Error('Invalid collection limits');
    const report: HrinCollectionReport = { source: 'hrin', complete: false, pages: 0, discovered: 0, fetched: 0, expired: 0, failed: 0, accepted: 0 };
    try {
      const robots = await this.read(`${HRIN_ORIGIN}/robots.txt`);
      const wait = Math.max(delayMs, HRIN_MIN_DELAY_MS, robotsCrawlDelayMs(robots) ?? 0);
      report.delayMs = wait;
      const get = async (input: string) => {
        const url = hrinUrl(input);
        const parsed = new URL(url);
        if (!robotsAllows(robots, parsed.pathname + parsed.search, { crawlDelayHonored: true })) throw new Error('HRIN crawler rules prohibit this URL');
        await this.pause(wait);
        return this.read(url);
      };
      const listingUrl = `${HRIN_ORIGIN}/vakansiyalar`;
      const entries = parseHrinListing(await get(listingUrl));
      report.pages = 1;

      // An item cursor is stable under listing reorder. Start at the cursor item for one-item overlap; if it disappeared, restart at the current head.
      let startIndex = 0;
      if (options.resume?.kind === 'cursor') {
        const id = /^hrin:(\d{1,8})$/.exec(options.resume.value)?.[1];
        const cursorIndex = id ? entries.findIndex((entry) => entry.id === id) : -1;
        if (cursorIndex >= 0) startIndex = cursorIndex;
      }
      for (let index = startIndex; index < entries.length; index++) {
        const entry = entries[index];
        const externalId = `hrin:${entry.id}`;
        report.discovered++;
        if (options.isKnown?.(externalId)) {
          report.known = (report.known ?? 0) + 1;
          // This board page is not a complete census and may contain stale cards; it is not safe to use for reopen/closure decisions.
          continue;
        }
        if (report.fetched >= maxJobs) {
          report.cursor = { kind: 'cursor', value: externalId };
          break;
        }
        const detailHtml = await get(entry.url);
        report.fetched++;
        let job: IngestJobDto;
        try { job = parseHrinDetail(detailHtml, entry.url, this.now(), entry); }
        catch (error) {
          report.failed++;
          await options.onFailedDetail?.(externalId, error instanceof Error ? error.message : 'Invalid HRIN detail');
          continue;
        }
        if (job.deadline && new Date(job.deadline) < this.now()) {
          report.expired++;
          continue; // Expired sitemap/listing records are not surfaced as fresh vacancies.
        }
        await accept(job);
        report.accepted++;
      }
      // Current HRIN HTML exposes one bounded first page without verified pagination. Never call it complete, even when all cards fit the run.
      report.error = report.failed ? 'Some HRIN details could not be parsed; no closures inferred'
        : 'HRIN bounded first-page snapshot only; pagination and full active census are unverified, so no closures inferred';
      report.outcome = report.failed ? 'INVALID_DETAIL' : 'BOUNDED_PROGRESS';
    } catch (error) {
      Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const });
      report.error = error instanceof Error ? error.message : 'HRIN collection failed';
    }
    return report;
  }
}
