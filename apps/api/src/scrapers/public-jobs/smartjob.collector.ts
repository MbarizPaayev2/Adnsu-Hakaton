import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import {
  fetchPublicDocument,
  robotsAllows,
  type CollectionOptions,
  type DiscoveryCursor,
} from './public-job-collector';
import {
  SMARTJOB_ORIGIN,
  parseSmartjobDetail,
  parseSmartjobListing,
  smartjobUrl,
} from './smartjob.parser';

export interface SmartjobCollectionReport {
  /** Where a bounded run stopped (null: it reached the listing's end). */
  cursor?: DiscoveryCursor | null;
  source: 'smartjob';
  complete: boolean;
  outcome?: CollectionOutcome;
  pages: number;
  discovered: number;
  fetched: number;
  known?: number;
  expired: number;
  failed: number;
  accepted: number;
  error?: string;
}

export class SmartjobCollector {
  constructor(
    private read: (url: string) => Promise<string> = (u) =>
      fetchPublicDocument(u, smartjobUrl, ['text/html', 'text/plain', 'application/xml', 'text/xml']),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
  ) {}

  async collect(
    options: CollectionOptions,
    accept: (job: IngestJobDto) => Promise<void>,
  ): Promise<SmartjobCollectionReport> {
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

    const report: SmartjobCollectionReport = {
      source: 'smartjob',
      complete: false,
      pages: 0,
      discovered: 0,
      fetched: 0,
      expired: 0,
      failed: 0,
      accepted: 0,
    };

    const robots = await this.read(`${SMARTJOB_ORIGIN}/robots.txt`);
    const seenPages = new Set<string>();
    const seenJobs = new Set<string>();
    // A resumed run continues with the shards and pages still pending when the last one stopped.
    const pageQueue: string[] = options.resume?.kind === 'queue' && options.resume.pending.length ? [...options.resume.pending] : [`${SMARTJOB_ORIGIN}/vakansiyalar`];

    const get = async (url: string) => {
      const u = new URL(url);
      if (!robotsAllows(robots, u.pathname + u.search)) {
        throw new Error('Source crawler rules prohibit this URL');
      }
      await this.pause(delayMs);
      return this.read(url);
    };

    try {
      while (pageQueue.length > 0 && report.pages < maxPages && report.fetched < maxJobs) {
        const page = pageQueue.shift()!;
        if (seenPages.has(page)) continue;
        seenPages.add(page);

        const content = await get(page);
        const isSitemap = page.includes('sitemap') || page.endsWith('.xml') || content.includes('<urlset') || content.includes('<sitemapindex');
        const listing = parseSmartjobListing(content, page);
        report.pages++;

        // If the page was a sitemap index, queue all discovered shards
        if (listing.shards) {
          for (const shard of listing.shards) {
            if (!seenPages.has(shard) && !pageQueue.includes(shard)) {
              pageQueue.push(shard);
            }
          }
        }

        let unseen = 0, budgetSkipped = 0;
        for (const url of listing.urls) {
          if (seenJobs.has(url)) continue;
          unseen++;
          seenJobs.add(url);
          report.discovered++;

          const slug = new URL(url).pathname.split('/').pop() || '';
          const externalId = `smartjob:${slug.split('-').pop() || slug}`;
          if (options.isKnown?.(externalId)) {
            report.known = (report.known ?? 0) + 1;
            // Historical sitemaps are discovery only; only live active listings prove current listing
            if (!isSitemap) {
              await options.onListed?.(externalId);
            }
            continue;
          }

          if (report.fetched >= maxJobs) { budgetSkipped++; continue; }

          // Transport errors stop the run (no retry around 403/429)
          const html = await get(url);
          report.fetched++;

          let job: IngestJobDto;
          try {
            job = parseSmartjobDetail(html, url, this.now());
          } catch (error) {
            report.failed++;
            await options.onFailedDetail?.(externalId, error instanceof Error ? error.message : 'Invalid Smartjob detail');
            continue;
          }

          if (job.deadline && new Date(job.deadline) < this.now()) {
            report.expired++;
          }

          await accept(job);
          report.accepted++;
        }

        if (listing.next && !seenPages.has(listing.next) && !pageQueue.includes(listing.next)) {
          pageQueue.push(listing.next);
        }
        // The fetch budget ran out inside this page: it goes back to the front of the queue so the rest is read next time, never skipped.
        if (budgetSkipped > 0) { pageQueue.unshift(page); break; }

        if (!unseen && !listing.shards?.length && pageQueue.length > 0 && listing.next) {
          // Check if progress is stalled
        }
      }

      report.cursor = pageQueue.length ? { kind: 'queue', pending: pageQueue.slice(0, 500) } : null;
      // Coverage completeness: A sitemap shard is not automatically a list of current vacancies.
      // Until complete inventory coverage is verified across all shards and listing, always report complete=false
      report.complete = false;
      report.outcome = report.failed ? 'INVALID_DETAIL' : 'BOUNDED_PROGRESS';
      report.error = report.failed
        ? 'Some details could not be parsed; no closures inferred'
        : 'Collection limit reached; Smartjob collection is bounded; complete active census not proven';
    } catch (error) {
      report.outcome = 'UPSTREAM_FAILURE';
      report.error = error instanceof Error ? error.message : 'Collection failed';
    }

    return report;
  }
}
