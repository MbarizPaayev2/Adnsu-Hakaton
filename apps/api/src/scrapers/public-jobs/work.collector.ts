import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import {
  fetchPublicDocument,
  fetchPublicHtml,
  postPublicJson,
  robotsAllows,
  type CollectionOptions,
  type DiscoveryCursor,
} from './public-job-collector';
import {
  WORK_API_ORIGIN,
  WORK_ORIGIN,
  parseWorkApiResponse,
  parseWorkDetail,
  parseWorkListing,
  workUrl,
} from './work.parser';

export interface WorkCollectionReport {
  /** Where a bounded run stopped (null: it reached the listing's end). */
  cursor?: DiscoveryCursor | null;
  source: 'work';
  outcome?: CollectionOutcome;
  complete: boolean;
  pages: number;
  discovered: number;
  fetched: number;
  expired: number;
  failed: number;
  accepted: number;
  known?: number;
  error?: string;
}

const defaultWorkRead = (u: string) =>
  fetchPublicDocument(u, workUrl, ['text/html', 'text/plain', 'application/xml', 'text/xml'], 3 * 1024 * 1024);

export class WorkCollector {
  private postJson?: (url: string, body: Record<string, unknown>) => Promise<any>;

  constructor(
    private read: (url: string) => Promise<string> = defaultWorkRead,
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
    postJson?: (url: string, body: Record<string, unknown>) => Promise<any>,
  ) {
    this.postJson =
      postJson ??
      (read === defaultWorkRead
        ? (u, b) => postPublicJson(u, b, workUrl, { Origin: WORK_ORIGIN, Referer: `${WORK_ORIGIN}/` })
        : undefined);
  }

  async collect(
    options: CollectionOptions,
    accept: (job: IngestJobDto) => Promise<void>,
  ): Promise<WorkCollectionReport> {
    const { maxPages, maxJobs, delayMs } = options;
    // A resumed traversal starts one page back so a listing that shifted since still overlaps what was read.
    const startPage = options.startPage ?? (options.resume?.kind === 'page' ? Math.max(1, options.resume.page - 1) : 1);
    if (
      !Number.isInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 1000 ||
      !Number.isInteger(maxJobs) ||
      maxJobs < 1 ||
      maxJobs > 10_000 ||
      !Number.isInteger(delayMs) ||
      delayMs < 1000 ||
      delayMs > 60_000 ||
      !Number.isInteger(startPage) ||
      startPage < 1
    ) {
      throw new Error('Invalid collection limits');
    }

    const report: WorkCollectionReport = {
      source: 'work',
      complete: false,
      pages: 0,
      discovered: 0,
      fetched: 0,
      expired: 0,
      failed: 0,
      accepted: 0,
    };

    const robots = await this.read(`${WORK_ORIGIN}/robots.txt`);
    const seenPages = new Set<string>();
    const seenJobs = new Set<string>();

    const get = async (url: string) => {
      const u = new URL(url);
      if (!robotsAllows(robots, u.pathname + u.search)) {
        throw new Error('Source crawler rules prohibit this URL');
      }
      await this.pause(delayMs);
      return this.read(url);
    };

    try {
      if (this.postJson) {
        // API-driven active listing discovery and pagination
        let apiPage = startPage;
        let totalPages = 1;
        let initialTotalElements: number | null = null;
        let inventoryDrifted = false;
        let reachedEnd = false;
        let consecutiveStalledPages = 0;
        let stopCursor: number | null = null;
        const seenApiPages = new Set<number>();

        while ((initialTotalElements === null || apiPage <= totalPages) && report.pages < maxPages && report.fetched < maxJobs) {
          if (seenApiPages.has(apiPage)) throw new Error('Listing pagination repeated');
          seenApiPages.add(apiPage);

          await this.pause(delayMs);
          const response = await this.postJson(`${WORK_API_ORIGIN}/v1/vacancies`, {
            count: 50,
            page: apiPage,
            type: 'VACANCY',
          });
          const listing = parseWorkApiResponse(response, apiPage);
          report.pages++;

          if (listing.invalidCount > 0) {
            report.failed += listing.invalidCount;
          }

          if (initialTotalElements === null) {
            initialTotalElements = listing.totalElements;
          } else if (Math.abs(listing.totalElements - initialTotalElements) > 100) {
            inventoryDrifted = true;
          }
          totalPages = listing.totalPages;

          let unseen = 0, budgetSkipped = 0;
          for (let i = 0; i < listing.urls.length; i++) {
            const url = listing.urls[i];
            const slug = listing.slugs[i];
            if (seenJobs.has(url)) continue;
            unseen++;
            seenJobs.add(url);
            report.discovered++;

            const externalId = `work:${slug}`;
            if (options.isKnown?.(externalId)) {
              report.known = (report.known ?? 0) + 1;
              await options.onListed?.(externalId);
              continue;
            }
            if (report.fetched >= maxJobs) { budgetSkipped++; continue; }

            // Transport errors stop the run (no retry around 403/429)
            let detailHtml: string;
            try {
              detailHtml = await get(url);
            } catch (err) {
              report.failed++;
              await options.onFailedDetail?.(externalId, err instanceof Error ? err.message : String(err));
              throw err;
            }
            report.fetched++;

            let job: IngestJobDto;
            try {
              job = parseWorkDetail(detailHtml, url, this.now());
            } catch (err) {
              report.failed++;
              await options.onFailedDetail?.(externalId, err instanceof Error ? err.message : String(err));
              continue;
            }

            if (job.deadline && new Date(job.deadline) < this.now()) {
              report.expired++;
            }

            await accept(job);
            report.accepted++;
          }

          if (listing.urls.length > 0 && unseen === 0) {
            consecutiveStalledPages++;
            if (consecutiveStalledPages >= 3) {
              throw new Error('Listing repeats jobs without progress');
            }
          } else {
            consecutiveStalledPages = 0;
          }

          // The fetch budget ran out inside this page: the cursor stays on it so the rest is read next time, never skipped.
          if (budgetSkipped > 0) { stopCursor = apiPage; break; }
          if (!listing.hasNext || apiPage >= totalPages || listing.urls.length === 0) {
            reachedEnd = true;
            break;
          }

          apiPage++;
        }
        report.cursor = reachedEnd ? null : { kind: 'page', page: stopCursor ?? apiPage };

        if (
          reachedEnd &&
          startPage === 1 &&
          !options.resume &&
          !inventoryDrifted &&
          report.discovered === (report.accepted + (report.known ?? 0)) &&
          !report.failed
        ) {
          report.complete = true;
        } else {
          report.complete = false;
          report.error = report.failed
            ? 'Some details could not be parsed; no closures inferred'
            : inventoryDrifted
            ? 'Source inventory drifted during traversal; closures not authorized'
            : 'Collection limit reached; coverage incomplete';
        }
      } else {
        // Fallback: HTML listing and sitemap traversal
        let page: string | null = `${WORK_ORIGIN}/vakansiyalar`;
        while (page && report.pages < maxPages && report.fetched < maxJobs) {
          if (seenPages.has(page)) throw new Error('Listing pagination repeated');
          seenPages.add(page);

          const content = await get(page);
          const listing = parseWorkListing(content, page);
          report.pages++;

          let unseen = 0;
          for (const url of listing.urls) {
            if (seenJobs.has(url)) continue;
            unseen++;
            seenJobs.add(url);
            report.discovered++;

            const slug = new URL(url).pathname.split('/').pop();
            const externalId = `work:${slug}`;
            if (options.isKnown?.(externalId)) {
              report.known = (report.known ?? 0) + 1;
              // Sitemap is discovery evidence, not active listing proof; do NOT refresh freshness
              continue;
            }
            if (report.fetched >= maxJobs) continue;

            const detailHtml = await get(url);
            report.fetched++;

            let job: IngestJobDto;
            try {
              job = parseWorkDetail(detailHtml, url, this.now());
            } catch {
              report.failed++;
              continue;
            }

            if (job.deadline && new Date(job.deadline) < this.now()) {
              report.expired++;
            }

            await accept(job);
            report.accepted++;
          }

          if (!unseen && listing.next) {
            throw new Error('Listing repeats jobs without progress');
          }

          page = listing.next;
        }

        report.complete = false;
        report.outcome = report.failed ? 'INVALID_DETAIL' : 'BOUNDED_PROGRESS';
        report.error = report.failed
          ? 'Some details could not be parsed; no closures inferred'
          : 'Collection limit reached; Work.az sitemap run is bounded; active census not proven';
      }
    } catch (error) {
      Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const });
      report.error = error instanceof Error ? error.message : 'Collection failed';
    }

    return report;
  }
}
