import { type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { fetchPublicDocument, robotsAllows, type CollectionOptions } from './public-job-collector';
import {
  LEVER_TENANTS,
  type LeverTenant,
  parseLeverFeed,
  leverUrl,
  leverApiUrl,
  LEVER_API_ORIGIN,
} from './lever.parser';

export { LEVER_TENANTS };
export type { LeverTenant };
export const LEVER_SOURCES = Object.keys(LEVER_TENANTS) as LeverTenant[];

export class LeverCollector {
  private readonly tenant: LeverTenant;

  constructor(
    tenant: LeverTenant,
    private read: (url: string) => Promise<string> = (url) =>
      fetchPublicDocument(url, (u) => leverUrl(tenant, u), ['application/json', 'text/plain', 'text/html'], 6 * 1024 * 1024),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
  ) {
    if (!(tenant in LEVER_TENANTS)) throw new Error(`Unknown Lever tenant: "${tenant}"`);
    this.tenant = tenant;
  }

  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>) {
    if (
      !Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 200 ||
      !Number.isInteger(options.maxJobs) || options.maxJobs < 1 || options.maxJobs > 10_000 ||
      !Number.isInteger(options.delayMs) || options.delayMs < 1000 || options.delayMs > 60_000
    ) {
      throw new Error('Invalid collection limits');
    }

    const tenant = this.tenant;
    const report = {
      source: tenant,
      complete: false,
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
      const robots = await this.read(`${LEVER_API_ORIGIN}/robots.txt`);
      if (!robotsAllows(robots, `/v0/postings/${tenant}`, { crawlDelayHonored: true })) {
        throw new Error('Lever crawler rules prohibit the public postings endpoint');
      }

      const delay = Math.max(options.delayMs, 1000);
      await this.pause(delay);
      const rawJson = await this.read(leverApiUrl(tenant));
      report.pages = 1;

      const feed = parseLeverFeed(tenant, rawJson, this.now());
      report.discovered = feed.discovered;
      report.fetched = feed.discovered;
      report.skipped = feed.skipped;
      report.failed = feed.failed;

      for (const job of feed.jobs.slice(0, options.maxJobs)) {
        if (job.deadline && new Date(job.deadline) < this.now()) {
          report.expired++;
        }
        await accept(job);
        report.accepted++;
      }

      // Complete only when every item was understood and nothing was held back by the job cap.
      report.complete = !feed.failed && feed.jobs.length <= options.maxJobs;
      if (!report.complete) {
        report.error = feed.failed
          ? `Lever:${tenant} — some postings could not be parsed; no closures inferred`
          : 'Collection limit reached; run is bounded; coverage incomplete';
      }
    } catch (error) {
      Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const });
      report.error = error instanceof Error ? error.message : `Lever:${tenant} collection failed`;
    }

    return report;
  }
}
