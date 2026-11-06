import { type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { fetchPublicDocument, robotsAllows, type CollectionOptions } from './public-job-collector';
import {
  WORKABLE_ORIGIN,
  WORKABLE_TENANTS,
  type WorkableTenant,
  workableUrl,
  workableListUrl,
  workableDetailUrl,
  parseWorkableListing,
  parseWorkableDetail,
  workableCountryFilter,
} from './workable.parser';

export type { WorkableTenant };
export { WORKABLE_TENANTS };
export const WORKABLE_SOURCES = Object.keys(WORKABLE_TENANTS) as WorkableTenant[];

export class WorkableCollector {
  private readonly tenant: WorkableTenant;

  constructor(
    tenant: WorkableTenant,
    private read: (url: string) => Promise<string> = (url) =>
      fetchPublicDocument(url, (u) => workableUrl(tenant, u), ['text/html', 'text/plain', 'text/markdown']),
    private pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
  ) {
    if (!(tenant in WORKABLE_TENANTS)) throw new Error(`Unknown Workable tenant: "${tenant}"`);
    this.tenant = tenant;
  }

  async collect(
    options: CollectionOptions,
    accept: (job: IngestJobDto) => Promise<void>,
  ) {
    if (
      !Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 200 ||
      !Number.isInteger(options.maxJobs) || options.maxJobs < 1 || options.maxJobs > 10_000 ||
      !Number.isInteger(options.delayMs) || options.delayMs < 1000 || options.delayMs > 60_000
    ) throw new Error('Invalid collection limits');

    const tenant = this.tenant;
    const report = {
      source: tenant,
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
      const robots = await this.read(`${WORKABLE_ORIGIN}/robots.txt`);
      const get = async (url: string) => {
        const path = new URL(url).pathname;
        if (!robotsAllows(robots, path)) throw new Error(`Workable crawler rules prohibit: ${path}`);
        await this.pause(options.delayMs);
        return this.read(url);
      };

      // Fetch the listing markdown
      const listUrl = workableListUrl(tenant);
      const listMd = await get(listUrl);
      report.pages = 1;

      const countryEligibility = workableCountryFilter(tenant);
      const rows = parseWorkableListing(tenant, listMd, countryEligibility);
      report.discovered = rows.length;

      if (rows.length === 0) {
        // No current openings — this is not an error, it's a valid state
        report.complete = true;
        return report;
      }

      // Fetch detail for each row up to maxJobs
      const toFetch = rows.slice(0, options.maxJobs);
      for (const row of toFetch) {
        const url = workableDetailUrl(tenant, row.id);
        let md: string;
        try {
          md = await get(url);
          report.fetched++;
        } catch (err) {
          report.failed++;
          Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const });
          report.error = err instanceof Error ? err.message : `Workable:${tenant} detail request failed`;
          await options.onFailedDetail?.(`${tenant}:${row.id}`, report.error);
          return report;
        }

        let job: IngestJobDto | null;
        try {
          job = parseWorkableDetail(tenant, md, url, this.now(), countryEligibility);
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

      // Complete only when all discovered rows were fetched with no failures
      report.complete = report.fetched === rows.length && !report.failed;
      report.outcome = report.failed ? 'INVALID_DETAIL' : report.complete ? 'COMPLETE_CENSUS' : 'BOUNDED_PROGRESS';
      if (!report.complete) {
        report.error = report.failed
          ? `Workable:${tenant} — some details could not be parsed; no closures inferred`
          : 'Collection limit reached; Workable run is bounded; coverage may be incomplete';
      }
    } catch (error) {
      Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const });
      report.error = error instanceof Error ? error.message : `Workable:${tenant} collection failed`;
    }

    return report;
  }
}
