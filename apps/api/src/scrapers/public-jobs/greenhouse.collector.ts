import { type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import {
  fetchPublicDocument,
  robotsAllows,
  robotsCrawlDelayMs,
  type CollectionOptions,
  type DiscoveryCursor,
} from './public-job-collector';
import {
  GREENHOUSE_TENANTS,
  type GreenhouseTenant,
  GREENHOUSE_API_ORIGIN,
  greenhouseUrl,
  greenhouseListApiUrl,
  greenhouseDetailApiUrl,
  parseGreenhouseListing,
  parseGreenhouseDetail,
} from './greenhouse.parser';

export { GREENHOUSE_TENANTS };
export type { GreenhouseTenant };
export const GREENHOUSE_SOURCES = Object.keys(GREENHOUSE_TENANTS) as GreenhouseTenant[];

export const GREENHOUSE_MIN_DELAY_MS = 1000;

export interface GreenhouseCollectionReport {
  source: GreenhouseTenant;
  complete: boolean;
  pages: number;
  discovered: number;
  fetched: number;
  expired: number;
  skipped: number;
  failed: number;
  accepted: number;
  known?: number;
  delayMs?: number;
  error?: string;
  outcome: CollectionOutcome;
  cursor?: DiscoveryCursor | null;
  totalSeen?: number;
}

export class GreenhouseCollector {
  private readonly tenant: GreenhouseTenant;

  constructor(
    tenant: GreenhouseTenant,
    private read: (url: string) => Promise<string> = (url) =>
      fetchPublicDocument(
        url,
        (u) => greenhouseUrl(tenant, u),
        ['application/json', 'text/plain', 'text/html'],
        6 * 1024 * 1024,
      ),
    private pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
  ) {
    if (!(tenant in GREENHOUSE_TENANTS)) {
      throw new Error(`Unknown Greenhouse tenant: "${tenant}"`);
    }
    this.tenant = tenant;
  }

  async collect(
    options: CollectionOptions,
    accept: (job: IngestJobDto) => Promise<void>,
  ): Promise<GreenhouseCollectionReport> {
    const { maxPages, maxJobs, delayMs } = options;
    if (
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200 ||
      !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10_000 ||
      !Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 60_000
    ) {
      throw new Error('Invalid collection limits');
    }

    const tenant = this.tenant;
    const config = GREENHOUSE_TENANTS[tenant];
    const report: GreenhouseCollectionReport = {
      source: tenant,
      complete: false,
      pages: 0,
      discovered: 0,
      fetched: 0,
      expired: 0,
      skipped: 0,
      failed: 0,
      accepted: 0,
      known: 0,
      outcome: 'UPSTREAM_FAILURE',
    };

    try {
      const robots = await this.read(`${GREENHOUSE_API_ORIGIN}/robots.txt`);
      const wait = Math.max(delayMs, GREENHOUSE_MIN_DELAY_MS, robotsCrawlDelayMs(robots) ?? 0);
      report.delayMs = wait;

      const listUrl = greenhouseListApiUrl(tenant);
      const listPath = new URL(listUrl).pathname;
      if (!robotsAllows(robots, listPath, { crawlDelayHonored: true })) {
        throw new Error('Greenhouse crawler rules prohibit the public jobs list endpoint');
      }

      await this.pause(wait);
      const listJson = await this.read(listUrl);
      report.pages = 1;

      const listing = parseGreenhouseListing(tenant, listJson);
      report.totalSeen = listing.totalDiscovered;
      report.discovered = listing.matchingJobs.length;
      report.skipped = listing.skippedNonMatching;

      if (listing.matchingJobs.length === 0) {
        // An unmatched global location may be an AZ opening we could not classify.
        // Do not turn this filtered listing into evidence that existing jobs closed.
        report.complete = listing.coverageVerified && !listing.invalid && !listing.skippedNonMatching && !options.resume;
        report.outcome = report.complete ? 'NO_OPENINGS' : listing.invalid ? 'INVALID_DETAIL' : 'BOUNDED_PROGRESS';
        report.failed = listing.invalid;
        report.cursor = report.complete ? null : { kind: 'page', page: 1 };
        if (!report.complete) report.error = 'Listing completeness could not be verified';
        return report;
      }

      let budgetReached = false;
      for (const summary of listing.matchingJobs) {
        const externalId = `${tenant}:${summary.id}`;

        if (options.isKnown?.(externalId)) {
          report.known = (report.known ?? 0) + 1;
          await options.onListed?.(externalId);
          continue;
        }
        if (report.fetched >= maxJobs) { budgetReached = true; break; }

        const detailUrl = greenhouseDetailApiUrl(tenant, summary.id);
        const detailPath = new URL(detailUrl).pathname;
        if (!robotsAllows(robots, detailPath, { crawlDelayHonored: true })) {
          throw new Error(`Greenhouse crawler rules prohibit detail endpoint: ${detailPath}`);
        }

        let detailJson: string;
        try {
          await this.pause(wait);
          detailJson = await this.read(detailUrl);
          report.fetched++;
        } catch (err) {
          report.failed++;
          report.outcome = 'UPSTREAM_FAILURE';
          report.cursor = { kind: 'page', page: 1 };
          report.error = err instanceof Error ? err.message : 'Failed to fetch detail';
          await options.onFailedDetail?.(
            externalId,
            report.error,
          );
          return report;
        }

        let job: IngestJobDto;
        try {
          job = parseGreenhouseDetail(tenant, detailJson, this.now(), summary);
        } catch (err) {
          report.failed++;
          await options.onFailedDetail?.(
            externalId,
            err instanceof Error ? err.message : 'Invalid Greenhouse job detail',
          );
          report.outcome = 'INVALID_DETAIL';
          report.cursor = { kind: 'page', page: 1 };
          report.error = 'A detail could not be validated; retry without inferring closures';
          return report;
        }

        if (job.deadline && new Date(job.deadline) < this.now()) {
          report.expired++;
        }

        await accept(job);
        report.accepted++;
      }

      report.failed += listing.invalid;
      const totalHandled = report.accepted + (report.known ?? 0);
      report.complete = listing.coverageVerified && !listing.skippedNonMatching && !report.failed && !budgetReached && !options.resume && totalHandled === listing.matchingJobs.length;
      report.cursor = report.complete ? null : { kind: 'page', page: 1 };
      report.outcome = report.failed ? 'INVALID_DETAIL' : report.complete ? 'COMPLETE_CENSUS' : 'BOUNDED_PROGRESS';

      if (!report.complete) {
        report.error = report.failed
          ? `Greenhouse:${tenant} — some job details could not be parsed; no closures inferred`
          : 'Listing or location coverage is incomplete; no closures inferred';
      }
    } catch (error) {
      report.error = error instanceof Error ? error.message : `Greenhouse:${tenant} collection failed`;
      report.outcome = 'UPSTREAM_FAILURE';
      report.cursor = { kind: 'page', page: 1 };
    }

    return report;
  }
}
