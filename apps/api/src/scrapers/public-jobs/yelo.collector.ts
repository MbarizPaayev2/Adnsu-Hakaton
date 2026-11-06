import { type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { fetchPublicDocument, robotsAllows, type CollectionOptions } from './public-job-collector';
import {
  YELO_ORIGIN,
  YELO_LIST_PATH,
  yeloUrl,
  parseYeloListing,
  parseYeloDetail,
} from './yelo.parser';

export class YeloCollector {
  constructor(
    private read: (url: string) => Promise<string> = (url) =>
      fetchPublicDocument(url, yeloUrl),
    private pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
  ) {}

  async collect(
    options: CollectionOptions,
    accept: (job: IngestJobDto) => Promise<void>,
  ) {
    if (
      !Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 200 ||
      !Number.isInteger(options.maxJobs) || options.maxJobs < 1 || options.maxJobs > 10_000 ||
      !Number.isInteger(options.delayMs) || options.delayMs < 1000 || options.delayMs > 60_000
    ) throw new Error('Invalid collection limits');

    const report = {
      source: 'yelo',
      complete: false,
      outcome: undefined as CollectionOutcome | undefined,
      pages: 0,
      discovered: 0,
      fetched: 0,
      expired: 0,
      skipped: 0,
      failed: 0,
      accepted: 0,
      error: undefined as string | undefined,
    };

    try {
      const robots = await this.read(`${YELO_ORIGIN}/robots.txt`);
      const get = async (url: string) => {
        const path = new URL(url).pathname;
        if (!robotsAllows(robots, path)) throw new Error(`Yelo crawler rules prohibit: ${path}`);
        await this.pause(options.delayMs);
        return this.read(url);
      };

      const listUrl = yeloUrl(`${YELO_ORIGIN}${YELO_LIST_PATH}`);
      const listHtml = await get(listUrl);
      report.pages = 1;

      const listing = parseYeloListing(listHtml);
      report.discovered = listing.total;

      if (listing.total === 0) {
        report.complete = true;
        return report;
      }

      const toFetch = listing.entries.slice(0, options.maxJobs);
      for (const entry of toFetch) {
        let html: string;
        try {
          html = await get(entry.url);
          report.fetched++;
        } catch (err) {
          Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const });
          report.error = err instanceof Error ? err.message : 'Yelo Bank detail request failed';
          await options.onFailedDetail?.(entry.id, report.error);
          return report;
        }

        let job: IngestJobDto | null;
        try {
          job = parseYeloDetail(html, entry.url, this.now(), entry.cardLocation);
        } catch {
          report.failed++;
          continue;
        }

        if (!job) {
          report.skipped++;
          continue;
        }

        if (job.deadline && new Date(job.deadline) < this.now()) {
          report.expired++;
        }

        await accept(job);
        report.accepted++;
      }

      report.complete = report.fetched === listing.total && !report.failed;
      report.outcome = report.failed ? 'INVALID_DETAIL' : report.complete ? 'COMPLETE_CENSUS' : 'BOUNDED_PROGRESS';
      if (!report.complete) {
        report.error = report.failed
          ? 'Some Yelo Bank vacancy details could not be parsed; no closures inferred'
          : 'Collection limit reached; Yelo Bank run is bounded; coverage may be incomplete';
      }
    } catch (error) {
      Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const });
      report.error = error instanceof Error ? error.message : 'Yelo Bank collection failed';
    }

    return report;
  }
}
