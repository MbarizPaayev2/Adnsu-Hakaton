import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import {
  fetchPublicDocument,
  postPublicJson,
  robotsAllows,
  type CollectionOptions,
  type DiscoveryCursor,
} from './public-job-collector';
import {
  BOSS_ORIGIN,
  bossUrl,
  parseBossDetail,
  parseBossGraphQLResponse,
  parseBossListing,
} from './boss.parser';

export interface BossCollectionReport {
  /** Where a bounded run stopped (null: it reached the listing's end). */
  cursor?: DiscoveryCursor | null;
  source: 'boss';
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

export class BossCollector {
  private postJson?: (url: string, body: Record<string, unknown>) => Promise<any>;

  constructor(
    private read: (url: string) => Promise<string> = (u) => fetchPublicDocument(u, bossUrl, ['text/html', 'text/plain']),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
    postJson?: (url: string, body: Record<string, unknown>) => Promise<any>,
  ) {
    this.postJson = postJson;
  }

  async collect(
    options: CollectionOptions,
    accept: (job: IngestJobDto) => Promise<void>,
  ): Promise<BossCollectionReport> {
    const { maxPages, maxJobs, delayMs } = options;
    if (
      !Number.isInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 200 ||
      !Number.isInteger(maxJobs) ||
      maxJobs < 1 ||
      maxJobs > 10_000 ||
      !Number.isInteger(delayMs) ||
      delayMs < 1000 ||
      delayMs > 60_000
    ) {
      throw new Error('Invalid collection limits');
    }

    const report: BossCollectionReport = {
      source: 'boss',
      complete: false,
      pages: 0,
      discovered: 0,
      fetched: 0,
      expired: 0,
      failed: 0,
      accepted: 0,
    };

    const robots = await this.read(`${BOSS_ORIGIN}/robots.txt`);
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
        // GraphQL-driven full pagination across all active vacancies
        // The GraphQL cursor is anchored to an item, not a page number, so a resumed traversal tolerates a shifting listing.
        let cursor: string | null = options.resume?.kind === 'cursor' ? options.resume.value || null : null; // '' = the head of the listing
        let reachedEnd = false;

        const query = `
          query GetVacancies($first: Int, $after: String) {
            vacancies(first: $first, after: $after) {
              totalCount
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
              }
            }
          }
        `;

        while (report.pages < maxPages && report.fetched < maxJobs) {
          await this.pause(delayMs);
          const response = await this.postJson(`${BOSS_ORIGIN}/graphql`, {
            query,
            variables: { first: 24, after: cursor },
          });

          const listing = parseBossGraphQLResponse(response);
          report.pages++;

          let unseen = 0, budgetSkipped = 0;
          const pageCursor: string | null = cursor;
          for (let i = 0; i < listing.urls.length; i++) {
            const url = listing.urls[i];
            const id = listing.ids[i];
            if (seenJobs.has(url)) continue;
            unseen++;
            seenJobs.add(url);
            report.discovered++;

            const externalId = `boss:${id}`;
            if (options.isKnown?.(externalId)) {
              report.known = (report.known ?? 0) + 1;
              await options.onListed?.(externalId);
              continue;
            }
            if (report.fetched >= maxJobs) { budgetSkipped++; continue; }

            const detailHtml = await get(url);
            report.fetched++;

            let job: IngestJobDto;
            try {
              job = parseBossDetail(detailHtml, url, this.now());
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

          // The fetch budget ran out inside this page: the cursor stays where this page began so the rest is read next time, never skipped.
          if (budgetSkipped > 0) { cursor = pageCursor; break; }
          if (!listing.hasNextPage || !listing.endCursor || listing.urls.length === 0) {
            reachedEnd = true;
            break;
          }

          cursor = listing.endCursor;
        }
        report.cursor = reachedEnd ? null : { kind: 'cursor', value: cursor ?? '' }; // '' = stopped at the head: null is reserved for "reached the end"

        // A resumed run did not start at the head of the listing: it can never claim a complete one.
        if (reachedEnd && !options.resume && report.discovered === (report.accepted + (report.known ?? 0)) && !report.failed) {
          report.complete = true;
          report.outcome = report.discovered === 0 ? 'NO_OPENINGS' : 'COMPLETE_CENSUS';
        } else {
          report.complete = false;
          report.outcome = report.failed ? 'INVALID_DETAIL' : 'BOUNDED_PROGRESS';
          report.error = report.failed
            ? 'Some details could not be parsed; no closures inferred'
            : 'Collection limit reached; coverage incomplete';
        }
      } else {
        // Fallback: multi-category HTML traversal
        let page: string | null = `${BOSS_ORIGIN}/search/vacancies?sortBy=DATE`;
        let beyondFirstPage = 0;

        while (page && report.pages < maxPages && report.fetched < maxJobs) {
          if (seenPages.has(page)) throw new Error('Listing pagination repeated');
          seenPages.add(page);

          const html = await get(page);
          const listing = parseBossListing(html, page);
          report.pages++;
          if (listing.hasNextPage && listing.totalCount !== undefined && new URL(page).searchParams.has('categoryIds')) {
            beyondFirstPage += Math.max(0, listing.totalCount - listing.urls.length);
          }

          let unseen = 0;
          for (const url of listing.urls) {
            if (seenJobs.has(url)) continue;
            unseen++;
            seenJobs.add(url);
            report.discovered++;

            const id = new URL(url).pathname.split('/').pop();
            const externalId = `boss:${id}`;
            if (options.isKnown?.(externalId)) {
              report.known = (report.known ?? 0) + 1;
              await options.onListed?.(externalId);
              continue;
            }
            if (report.fetched >= maxJobs) continue;

            const detailHtml = await get(url);
            report.fetched++;

            let job: IngestJobDto;
            try {
              job = parseBossDetail(detailHtml, url, this.now());
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

          if (listing.urls.length && !unseen && listing.next) {
            throw new Error('Listing repeats jobs without progress');
          }

          page = listing.next;
        }

        report.complete = false;
        report.outcome = report.failed ? 'INVALID_DETAIL' : 'BOUNDED_PROGRESS';
        report.error = report.failed
          ? 'Some details could not be parsed; no closures inferred'
          : `Collection limit reached; Boss.az does not establish full pagination coverage; run is bounded and incomplete${beyondFirstPage ? ` (${beyondFirstPage} listed vacancies lie beyond the first page of their categories and are not reachable from the public HTML)` : ''}`;
      }
    } catch (error) {
      Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const });
      report.error = error instanceof Error ? error.message : 'Collection failed';
    }

    return report;
  }
}
