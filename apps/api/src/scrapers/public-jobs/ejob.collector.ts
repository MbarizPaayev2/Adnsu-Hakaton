import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { fetchPublicDocument, robotsAllows, robotsCrawlDelayMs, type CollectionOptions, type DiscoveryCursor } from './public-job-collector';
import { EJOB_MIN_DELAY_MS, EJOB_ORIGIN, ejobUrl, parseEjobDetail, parseEjobListing } from './ejob.parser';

export interface EjobCollectionReport { source: 'ejob'; complete: boolean; outcome?: CollectionOutcome; pages: number; discovered: number; fetched: number; expired: number; failed: number; accepted: number; known?: number; delayMs?: number; /** Why fetched details were refused, by reason (counts only; never page content). */ rejections?: Record<string, number>; error?: string; /** Where a bounded run stopped (null: it reached the listing's end). */ cursor?: DiscoveryCursor | null }

/**
 * eJob public listing/detail collector. Access: robots.txt is read first and honoured (including a crawl-delay for our agent, if any); pacing never drops
 * below the 5 s floor; redirects stay on approved eJob paths. Contacts are rendered as an image / message form, so no application address is produced.
 *
 * `complete` is never true. The numbered listing repeats featured entries on every page and the site's own headline counts disagree with the listing, so a
 * full pass does not prove an active census; a closure from this source needs a verified complete run first (see docs/scraper-integration-2026-10-03.md).
 */
export class EjobCollector {
  constructor(
    private read: (url: string) => Promise<string> = (u) => fetchPublicDocument(u, ejobUrl, ['text/html', 'text/plain'], 3 * 1024 * 1024),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private now: () => Date = () => new Date(),
  ) {}

  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>): Promise<EjobCollectionReport> {
    const { maxPages, maxJobs, delayMs } = options;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200 || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10_000 || !Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 60_000) throw new Error('Invalid collection limits');
    const report: EjobCollectionReport = { source: 'ejob', complete: false, pages: 0, discovered: 0, fetched: 0, expired: 0, failed: 0, accepted: 0 };
    try {
      const robots = await this.read(`${EJOB_ORIGIN}/robots.txt`);
      const wait = Math.max(delayMs, EJOB_MIN_DELAY_MS, robotsCrawlDelayMs(robots) ?? 0);
      report.delayMs = wait;
      const get = async (url: string) => {
        const u = new URL(url);
        if (!robotsAllows(robots, u.pathname + u.search, { crawlDelayHonored: true })) throw new Error('Source crawler rules prohibit this URL');
        await this.pause(wait);
        return this.read(url);
      };
      const seenPages = new Set<string>(), seenJobs = new Set<string>();
      // A resumed run starts at the page before the cursor, so a listing that shifted still overlaps what was read.
      let page: string | null = options.resume?.kind === 'url' ? (options.resume.prev ?? options.resume.url) : `${EJOB_ORIGIN}/is-elanlari/`;
      let prevPage: string | undefined;
      let stoppedAt: DiscoveryCursor | null | undefined;
      let exhausted = false;
      while (page && report.pages < maxPages && report.fetched < maxJobs) {
        if (seenPages.has(page)) throw new Error('Listing pagination repeated');
        seenPages.add(page);
        const listing = parseEjobListing(await get(page), page);
        report.pages++;
        let unseen = 0, budgetSkipped = 0;
        const current = page;
        for (const url of listing.urls) {
          if (seenJobs.has(url)) continue;
          seenJobs.add(url); unseen++; report.discovered++;
          const id = /^\/is-elani\/(\d+)-/.exec(new URL(url).pathname)?.[1];
          if (id && options.isKnown?.(`ejob:${id}`)) { report.known = (report.known ?? 0) + 1; continue; }
          if (report.fetched >= maxJobs) { budgetSkipped++; continue; }
          // Transport errors (403/429/blocks) stop the run; nothing is retried around a restriction.
          const html = await get(url); report.fetched++;
          let job: IngestJobDto;
          try { job = parseEjobDetail(html, url, this.now()); } catch (e) { report.failed++; const why = (e instanceof Error ? e.message : 'unreadable').replace(/[0-9]+/g, 'N').slice(0, 80); (report.rejections ??= {})[why] = (report.rejections[why] ?? 0) + 1; continue; }
          if (job.deadline && new Date(job.deadline) < this.now()) report.expired++;
          await accept(job); report.accepted++;
        }
        // Featured entries repeat across pages, so a page with nothing new is only an error when it also claims there is a next page.
        if (!unseen && listing.next) throw new Error('Listing repeats jobs without progress');
        // The fetch budget ran out inside this page: the cursor stays on it so the rest is read next time, never skipped.
        if (budgetSkipped > 0) { stoppedAt = { kind: 'url', url: current, ...(prevPage ? { prev: prevPage } : {}) }; break; }
        prevPage = current;
        page = listing.next;
        if (!page) exhausted = true;
      }
      report.cursor = stoppedAt !== undefined ? stoppedAt : page ? { kind: 'url', url: page, ...(prevPage ? { prev: prevPage } : {}) } : null;
      report.error = report.failed ? 'Some details could not be parsed; no closures inferred'
        : exhausted ? 'Collection limit reached; eJob listing walked to its last page but an active census is not proven; no closures inferred'
          : 'Collection limit reached; coverage incomplete';
      report.outcome = report.failed ? 'INVALID_DETAIL' : 'BOUNDED_PROGRESS';
    } catch (e) { Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const }); report.error = e instanceof Error ? e.message : 'Collection failed'; }
    return report;
  }
}
