import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import {
  fetchPublicDocument,
  type CollectionOptions,
  type DiscoveryCursor,
} from './public-job-collector';
import {
  LINKEDIN_AZ_ORIGIN,
  LINKEDIN_GEO_AZERBAIJAN,
  LINKEDIN_ORIGIN,
  parseLinkedInJobDetail,
  parseLinkedInSearchListing,
  type LinkedInListingEntry,
} from './linkedin-job.parser';
import { fetchLinkedInJobHtml } from './linkedin-job.service';

export const LINKEDIN_MIN_DELAY_MS = 2000;
export const LINKEDIN_PAGE_SIZE = 25;

export interface LinkedInCollectionReport {
  source: 'linkedin';
  complete: false;
  pages: number;
  discovered: number;
  fetched: number;
  expired: number;
  failed: number;
  accepted: number;
  known?: number;
  delayMs?: number;
  cursor?: DiscoveryCursor | null;
  error?: string;
}

export class LinkedInCollector {
  constructor(
    private readListing: (url: string) => Promise<string> = (url) =>
      fetchPublicDocument(url, (u) => u, ['text/html', 'text/plain'], 4 * 1024 * 1024),
    private fetchDetail: (url: string) => Promise<{ html: string; method: string }> = (url) =>
      fetchLinkedInJobHtml(url),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
    private collectionApproved: () => boolean = () => process.env.LINKEDIN_COLLECTION_APPROVED === 'true',
  ) {}

  async collect(
    options: CollectionOptions,
    accept: (job: IngestJobDto) => Promise<void>,
  ): Promise<LinkedInCollectionReport> {
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

    const report: LinkedInCollectionReport = {
      source: 'linkedin',
      complete: false,
      pages: 0,
      discovered: 0,
      fetched: 0,
      expired: 0,
      failed: 0,
      accepted: 0,
    };

    const wait = Math.max(delayMs, LINKEDIN_MIN_DELAY_MS);
    report.delayMs = wait;

    if (!this.collectionApproved()) {
      report.error = 'LinkedIn avtomatik kolleksiyası ayrıca yazılı icazə və şərtlər yoxlanışınadək söndürülüb';
      return report;
    }

    try {
      const allEntries: LinkedInListingEntry[] = [];
      const seenIds = new Set<string>();

      // Walk pages up to maxPages
      for (let page = 0; page < maxPages; page++) {
        const start = page * LINKEDIN_PAGE_SIZE;
        const searchUrl = `${LINKEDIN_ORIGIN}/jobs-guest/jobs/api/seeMoreJobPostings/search?location=Azerbaijan&geoId=${LINKEDIN_GEO_AZERBAIJAN}&start=${start}`;

        let listingHtml: string;
        try {
          if (page > 0) await this.pause(wait);
          listingHtml = await this.readListing(searchUrl);
          report.pages++;
        } catch (error) {
          // If a subsequent page fails or rate-limits, break and process what was collected
          if (page === 0) throw error;
          break;
        }

        const pageEntries = parseLinkedInSearchListing(listingHtml);
        if (!pageEntries.length) {
          // No more entries found on this page
          break;
        }

        let newEntriesOnPage = 0;
        for (const entry of pageEntries) {
          if (!seenIds.has(entry.id)) {
            seenIds.add(entry.id);
            allEntries.push(entry);
            newEntriesOnPage++;
          }
        }

        // If no new unique entries were found on this page, search results have exhausted
        if (newEntriesOnPage === 0) break;
      }

      // Resume cursor handling
      let startIndex = 0;
      if (options.resume?.kind === 'cursor') {
        const resumeId = /^linkedin:(\d{6,14})$/.exec(options.resume.value)?.[1];
        const cursorIndex = resumeId ? allEntries.findIndex((e) => e.id === resumeId) : -1;
        if (cursorIndex < 0) {
          report.error = 'LinkedIn davametmə nöqtəsi cari ictimai nəticələrdə tapılmadı; təkrar başlanğıc edilmədi';
          return report;
        }
        startIndex = cursorIndex;
      }

      for (let index = startIndex; index < allEntries.length; index++) {
        const entry = allEntries[index];
        const externalId = `linkedin:${entry.id}`;
        report.discovered++;

        if (options.isKnown?.(externalId)) {
          report.known = (report.known ?? 0) + 1;
          continue;
        }

        if (report.fetched >= maxJobs) {
          report.cursor = { kind: 'cursor', value: externalId };
          break;
        }

        await this.pause(wait);
        let detailHtml = '';
        try {
          const detailRes = await this.fetchDetail(entry.url);
          detailHtml = detailRes.html;
          report.fetched++;
        } catch (err) {
          report.failed++;
          await options.onFailedDetail?.(
            externalId,
            err instanceof Error ? err.message : 'LinkedIn detail fetch failed',
          );
          continue;
        }

        let job: IngestJobDto;
        try {
          job = parseLinkedInJobDetail(detailHtml, entry.url, this.now(), entry);
        } catch (err) {
          report.failed++;
          await options.onFailedDetail?.(
            externalId,
            err instanceof Error ? err.message : 'Invalid LinkedIn vacancy detail',
          );
          continue;
        }

        if (job.deadline && new Date(job.deadline) < this.now()) {
          report.expired++;
          continue;
        }

        await accept(job);
        report.accepted++;
      }

      report.error = report.failed
        ? 'Some LinkedIn details could not be parsed; no closures inferred'
        : 'LinkedIn bounded guest snapshot only; closures are not inferred';
    } catch (error) {
      report.error = error instanceof Error ? error.message : 'LinkedIn collection failed';
    }

    return report;
  }
}
