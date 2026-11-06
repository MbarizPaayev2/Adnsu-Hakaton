import { type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { fetchPublicDocument, robotsAllows, type CollectionOptions } from './public-job-collector';
import { TEAMTAILOR_TENANTS, type TeamtailorTenant, parseTeamtailorFeed, teamtailorUrl } from './teamtailor.parser';

export { TEAMTAILOR_TENANTS };
export type { TeamtailorTenant };
const FEED_TYPES = ['application/rss+xml', 'application/xml', 'text/xml'];

/** One tenant's public RSS feed. The feed lists every open posting, so a fully parsed feed is a complete listing. */
export class TeamtailorCollector {
  private readonly tenant: TeamtailorTenant;

  constructor(
    tenant: TeamtailorTenant,
    private read: (url: string) => Promise<string> = (url) => fetchPublicDocument(url, (u) => teamtailorUrl(tenant, u), [...FEED_TYPES, 'text/plain']),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
  ) {
    if (!(tenant in TEAMTAILOR_TENANTS)) throw new Error(`Unknown Teamtailor tenant: "${tenant}"`);
    this.tenant = tenant;
  }

  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>) {
    if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 200 || !Number.isInteger(options.maxJobs) || options.maxJobs < 1 || options.maxJobs > 10_000 || !Number.isInteger(options.delayMs) || options.delayMs < 1000 || options.delayMs > 60_000) throw new Error('Invalid collection limits');
    const tenant = this.tenant;
    const origin = TEAMTAILOR_TENANTS[tenant].origin;
    const report = { source: tenant, complete: false, pages: 0, discovered: 0, fetched: 0, expired: 0, skipped: 0, failed: 0, accepted: 0, error: undefined as string | undefined };
    try {
      const robots = await this.read(`${origin}/robots.txt`);
      if (!robotsAllows(robots, '/jobs.rss')) throw new Error('Teamtailor crawler rules prohibit the public feed');
      await this.pause(options.delayMs);
      const feed = parseTeamtailorFeed(tenant, await this.read(`${origin}/jobs.rss`), this.now());
      report.pages = 1;
      report.discovered = feed.discovered;
      report.fetched = feed.discovered;
      report.skipped = feed.skipped;
      report.failed = feed.failed;
      for (const job of feed.jobs.slice(0, options.maxJobs)) { await accept(job); report.accepted++; }
      // Complete only when every item was understood and nothing was held back by the job cap.
      report.complete = !feed.failed && feed.jobs.length <= options.maxJobs;
      if (!report.complete) report.error = feed.failed ? `Teamtailor:${tenant} — some postings could not be parsed; no closures inferred` : 'Collection limit reached; run is bounded; coverage incomplete';
    } catch (error) {
      Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const });
      report.error = error instanceof Error ? error.message : `Teamtailor:${tenant} collection failed`;
    }
    return report;
  }
}
