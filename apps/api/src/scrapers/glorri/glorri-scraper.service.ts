import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import { PrismaService } from '../../database/database.service';
import { JobsService } from '../../jobs/jobs.service';
import { PostHogService } from '../../common/posthog.service';
import { stripHtml } from '../../common/text.util';

function sanitizeJobHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'span', 'div'],
    allowedAttributes: {},
  });
}
import { classifyGlorriInfoItems, glorriDetailUrl, glorriExternalId, mapGlorriJobToIngestPayload } from './glorri-mapping.util';
import type { IngestOutcome } from '../../jobs/jobs.service';
import { GlorriJobDetail, GlorriJobRecord, GlorriJobSummary } from './glorri-scraper.types';

const SOURCE = 'glorri';
const API_URL = 'https://api.glorri.com/job-service-v2/jobs/public';
const LIMIT = 18;
const MAX_PAGES = 200;
const LIST_FETCH_MAX_ATTEMPTS = 3;
// Pages in a row that add no unseen job before the listing is treated as
// looping (offset ignored, same page served again) instead of finished.
const MAX_STALE_PAGES = 3;
// Known jobs get their detail page re-read at most this often unless the
// listing entry itself changed; caps how hard a run leans on the source.
const DETAIL_REFRESH_MS = 24 * 60 * 60 * 1000;
const MAX_DETAIL_REFRESHES_PER_RUN = 150;
// Closure needs an absent listing AND a 404/410 detail response.
// Mere absence never overrides a still-reachable posting.

const MAX_CLOSURE_PROBES_PER_RUN = 100;
// A "complete" listing far smaller than the last complete one is more likely
// a source hiccup than mass closure; such runs close nothing.
const MIN_LISTED_SHARE_FOR_CLOSURE = 0.5;
/**
 * A detail page that fails now and then is not a reason to freeze closures for ever (measured 11 October: one persistent failure in every run kept 313 postings
 * that Glorri no longer listed ACTIVE for up to six weeks). A listing is still trusted when failures stay within this share of what was listed.
 */
const DETAIL_FAILURE_TOLERANCE_SHARE = 0.02;
/**
 * Consecutive complete listings (hourly: two days) that did not contain a posting, plus no sighting for as long, close it: the source's own listing is its
 * definition of "open". The reason is recorded and a later listing reopens it.
 */
const ABSENT_LISTINGS_TO_CLOSE = 48;
const ABSENT_HOURS_TO_CLOSE = 48;
/** An application deadline that passed more than a day ago closes the posting (the catalogue already hid it; the record now says so). */
const DEADLINE_GRACE_MS = 24 * 3600 * 1000;
const ABANDONED_RUN_MS = 2 * 60 * 60 * 1000;

const REQUEST_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

type DetailResult =
  | { kind: 'ok'; detail: GlorriJobDetail }
  | { kind: 'gone' } // 404/410: the source says the posting no longer exists
  | { kind: 'error' }; // network/5xx/unparseable: says nothing either way

interface ListingResult {
  jobs: GlorriJobSummary[];
  complete: boolean;
  pagesFetched: number;
  error?: string;
}

type RunCounts = Record<IngestOutcome, number> & { closed: number; detailFailures: number; failedJobs: number };

/** Listing fields whose change means the stored detail may be outdated. */
function summaryKey(job: Partial<GlorriJobSummary> | undefined): string {
  return JSON.stringify([
    job?.title ?? null,
    job?.postedDate ?? null,
    job?.location ?? null,
    job?.type ?? null,
    job?.isRemote ?? null,
    job?.company?.slug ?? null,
    job?.company?.name ?? null,
  ]);
}

@Injectable()
export class GlorriScraperService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GlorriScraperService.name);
  // Politeness/backoff delays; overridable for local fixture runs.
  private readonly detailDelayMs = envMs('GLORRI_DETAIL_DELAY_MS', 500);
  private readonly retryBaseMs = envMs('GLORRI_RETRY_BASE_MS', 500);

  constructor(
    private prisma: PrismaService,
    private jobsService: JobsService,
    private postHogService: PostHogService,
    @InjectQueue('glorri-scrape') private scrapeQueue: Queue,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.GLORRI_SCRAPER_ENABLED === 'false') return;
    // Schedule repeatable job to scrape glorri.az job postings every hour
    await this.scrapeQueue
      .add(
        'glorri-scrape-job',
        {},
        {
          repeat: {
            pattern: '0 * * * *',
          },
          removeOnComplete: true,
        },
      )
      .catch((err) => this.logger.error('Failed to register repeatable glorri-scrape job', err));
    this.logger.log('[CRON GLORRI] Repeatable hourly glorri.az scrape job registered successfully');
  }

  private async fetchListPage(offset: number): Promise<unknown> {
    const url = new URL(API_URL);
    url.searchParams.set('sort', 'date');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(LIMIT));

    let lastError: unknown;
    for (let attempt = 1; attempt <= LIST_FETCH_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(url.toString(), { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(15_000) });
        if (!response.ok) {
          throw new Error(`glorri listing request failed: ${response.status} ${response.statusText}`);
        }
        return await response.json();
      } catch (error) {
        lastError = error;
        if (attempt < LIST_FETCH_MAX_ATTEMPTS) {
          const delay = this.retryBaseMs * 2 ** (attempt - 1);
          this.logger.warn(`Listing request failed (attempt ${attempt}/${LIST_FETCH_MAX_ATTEMPTS}, offset ${offset}): ${error}. Retrying in ${delay}ms`);
          await sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * The listing API's exact response envelope isn't documented — mirrors
   * temp/gloorri.py's defensive shape resolution: try the likely wrapper
   * keys, fall back to a bare array.
   */
  private extractJobs(payload: unknown): GlorriJobSummary[] {
    if (Array.isArray(payload)) return payload as GlorriJobSummary[];
    if (payload && typeof payload === 'object') {
      for (const key of ['entities', 'items', 'data', 'results', 'jobs']) {
        const value = (payload as Record<string, unknown>)[key];
        if (Array.isArray(value)) return value as GlorriJobSummary[];
      }
    }
    throw new Error('Unrecognized glorri listing response shape');
  }

  /**
   * Walks the whole listing. Ordering is not trusted: promoted entries repeat
   * and dates interleave, so a known job never ends the walk — only an empty
   * or short page does. Repeats are de-duplicated by slug. The result is
   * `complete` only when the listing ended by itself; a failed request, an
   * unreadable page, a page cap or a looping source leave it incomplete, and
   * incomplete listings never close anything.
   */
  private async collectListing(): Promise<ListingResult> {
    const bySlug = new Map<string, GlorriJobSummary>();
    const result = (complete: boolean, pagesFetched: number, error?: string): ListingResult => ({
      jobs: [...bySlug.values()],
      complete,
      pagesFetched,
      error,
    });
    let offset = 0;
    let stalePages = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      let jobs: GlorriJobSummary[];
      try {
        jobs = this.extractJobs(await this.fetchListPage(offset));
      } catch (error) {
        return result(false, page, `listing offset ${offset}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!jobs.length) return result(true, page + 1);

      if (jobs.some((job) => !job || typeof job.slug !== 'string' || !job.slug.trim())) {
        return result(false, page + 1, 'listing contains invalid job identities');
      }
      let unseen = 0;
      for (const job of jobs) {
        if (!job?.slug || bySlug.has(job.slug)) continue;
        bySlug.set(job.slug, job);
        unseen++;
      }
      stalePages = unseen ? 0 : stalePages + 1;
      if (stalePages >= MAX_STALE_PAGES) {
        return result(false, page + 1, `listing repeated ${stalePages} pages without unseen jobs at offset ${offset}`);
      }
      if (jobs.length < LIMIT) return result(true, page + 1);
      offset += jobs.length;
    }

    return result(false, MAX_PAGES, `page cap ${MAX_PAGES} reached`);
  }

  private parseJobDetailHtml(html: string): GlorriJobDetail {
    const $ = cheerio.load(html);

    const title = $('h1.mb-1.text-3xl.font-semibold').first().text().trim() || null;

    const infoItems = $('ul.mb-2.list-disc')
      .first()
      .find('li')
      .map((_, el) => $(el).text().trim())
      .get();
    const { company_name, location, employment_type } = classifyGlorriInfoItems(infoItems);

    const descBlocks = $('.description-html');
    const desc0 = descBlocks.eq(0);
    const desc1 = descBlocks.eq(1);
    // Sanitized even though nothing renders these _html fields today — this
    // is third-party HTML from arbitrary glorri.az job postings, stored
    // verbatim in Job.rawPayload, and a future "rich description" view that
    // renders it without re-sanitizing would otherwise be stored XSS.
    const description_html = desc0.length ? sanitizeJobHtml($.html(desc0)) : null;
    const description_text = desc0.length ? stripHtml($.html(desc0)) : null;
    const requirements_html = desc1.length ? sanitizeJobHtml($.html(desc1)) : null;
    const requirements_text = desc1.length ? stripHtml($.html(desc1)) : null;

    const sidebar: Record<string, string> = {};
    $('.mb-4.flex.justify-between').each((_, row) => {
      const ps = $(row).find('p');
      if (ps.length === 2) {
        const key = $(ps.get(0)).text().trim();
        const value = $(ps.get(1)).text().trim();
        sidebar[key] = value;
      }
    });

    const category = $('span.inline-block.rounded-full').first().text().trim() || null;

    return {
      title,
      company_name,
      location,
      employment_type,
      description_html,
      description_text,
      requirements_html,
      requirements_text,
      sidebar,
      deadline: sidebar['Son tarix'],
      posted_date_display: sidebar['Paylaşılıb'],
      category,
    };
  }

  private async fetchJobDetail(job: GlorriJobSummary): Promise<DetailResult> {
    const url = glorriDetailUrl(job.company?.slug || '', job.slug);
    try {
      const response = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(15_000) });
      if (response.status === 404 || response.status === 410) return { kind: 'gone' };
      if (!response.ok) {
        throw new Error(`glorri detail request failed: ${response.status} ${response.statusText}`);
      }
      const detail = this.parseJobDetailHtml(await response.text());
      // A page without a title or description is not evidence of anything and
      // must not blank out a stored description.
      if (!detail.title && !detail.description_text) throw new Error('detail page has no recognisable posting');
      return { kind: 'ok', detail };
    } catch (error) {
      this.logger.warn(`Failed to fetch/parse detail for ${job.slug}: ${error}`);
      return { kind: 'error' };
    }
  }

  /** Marks runs that never finished (process died mid-run) as failed. */
  private async abandonStaleRuns(now: Date) {
    await this.prisma.jobImportRun.updateMany({
      where: { source: SOURCE, status: 'RUNNING', startedAt: { lt: new Date(now.getTime() - ABANDONED_RUN_MS) } },
      data: { status: 'FAILED', finishedAt: now, error: 'run did not finish' },
    });
  }

  private async importListedJobs(listed: GlorriJobSummary[], now: Date, counts: RunCounts) {
    const known = new Map(
      (
        await this.prisma.job.findMany({
          where: { externalId: { in: listed.map((j) => glorriExternalId(j.slug)) } },
          select: { externalId: true, rawPayload: true, detailFetchedAt: true, postedAt: true, status: true },
        })
      ).map((j) => [j.externalId, j]),
    );
    let refreshes = 0;

    for (const summary of listed) {
      const prev = known.get(glorriExternalId(summary.slug));
      const prevPayload = (prev?.rawPayload ?? undefined) as (GlorriJobRecord & Record<string, unknown>) | undefined;
      const stale = !prev?.detailFetchedAt || now.getTime() - prev.detailFetchedAt.getTime() > DETAIL_REFRESH_MS;
      const mustFetch = !prev || prev.status === 'CLOSED' || summaryKey(prevPayload) !== summaryKey(summary);
      const refresh = !mustFetch && stale && refreshes < MAX_DETAIL_REFRESHES_PER_RUN;

      // Without a fresh detail page, keep the stored one rather than blanking it.
      let detail = prevPayload?.detail;
      let detailFetchedAt: string | undefined;
      if (mustFetch || refresh) {
        if (refresh) refreshes++;
        const fetched = await this.fetchJobDetail(summary);
        if (fetched.kind === 'ok') {
          detail = fetched.detail;
          detailFetchedAt = now.toISOString();
        } else {
          counts.detailFailures++;
          // Do not create/reopen a posting whose detail is missing, or
          // overwrite confirmed facts with a failed fetch's summary.
          if (prev) await this.prisma.job.updateMany({
            where: { externalId: glorriExternalId(summary.slug), lastSeenAt: { lte: now } },
            data: { lastSeenAt: now, missedImports: 0 },
          });
          await sleep(this.detailDelayMs);
          continue;
        }
        await sleep(this.detailDelayMs);
      }

      const payload = mapGlorriJobToIngestPayload({ ...summary, detail }, detailFetchedAt);
      if (!summary.postedDate && prev) payload.postedAt = prev.postedAt.toISOString();
      try {
        const { outcome } = await this.jobsService.upsertJob(payload, now);
        counts[outcome]++;
      } catch (error) {
        counts.failedJobs++;
        this.logger.error(`Failed to import ${summary.slug}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  /**
   * Only after a complete listing: active jobs it did not contain are probed.
   * A 404/410 detail page closes the job; a still-reachable page only counts
   * another missed listing and is never closed for absence alone; a failed
   * probe changes nothing. Returns false when the listing looked too small to
   * be trusted and closure was skipped.
   */
  private async reconcileClosures(listedIds: string[], now: Date, counts: RunCounts): Promise<boolean> {
    const lastComplete = await this.prisma.jobImportRun.findFirst({
      where: { source: SOURCE, status: { in: ['SUCCEEDED', 'PARTIAL'] }, listingComplete: true, finishedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
    });
    if (!listedIds.length || (lastComplete && listedIds.length < lastComplete.listed * MIN_LISTED_SHARE_FOR_CLOSURE)) {
      return false;
    }

    const missing = await this.prisma.job.findMany({
      where: { externalId: { startsWith: `${SOURCE}:`, notIn: listedIds }, status: 'ACTIVE' },
      select: { id: true, externalId: true, rawPayload: true, missedImports: true },
      orderBy: { lastSeenAt: 'asc' },
      take: MAX_CLOSURE_PROBES_PER_RUN,
    });

    for (const job of missing) {
      // Absent from every complete listing for two days: closed on the source's own definition of open, without another request.
      if (job.missedImports + 1 >= ABSENT_LISTINGS_TO_CLOSE) {
        const absent = await this.prisma.job.updateMany({
          where: { id: job.id, status: 'ACTIVE', lastSeenAt: { lt: new Date(now.getTime() - ABSENT_HOURS_TO_CLOSE * 3600 * 1000) } },
          data: { missedImports: job.missedImports + 1, status: 'CLOSED', closedAt: now, closedReason: 'not_listed_by_source' },
        });
        counts.closed += absent.count;
        continue;
      }
      const payload = (job.rawPayload ?? {}) as Partial<GlorriJobSummary>;
      const slug = payload.slug || job.externalId.slice(SOURCE.length + 1);
      const probe = await this.fetchJobDetail({ ...payload, slug, title: payload.title || '' } as GlorriJobSummary);
      await sleep(this.detailDelayMs);
      if (probe.kind === 'error') { counts.detailFailures++; continue; }

      const missedImports = job.missedImports + 1;
      const close = probe.kind === 'gone';
      const changed = await this.prisma.job.updateMany({
        where: { id: job.id, status: 'ACTIVE', lastSeenAt: { lt: now } },
        data: close
          ? {
              missedImports,
              status: 'CLOSED',
              closedAt: now,
              closedReason: 'source_removed',
            }
          : { missedImports },
      });
      if (close) counts.closed += changed.count;
    }
    // Deadlines that passed a day ago (the posting states its own end date).
    const lapsed = await this.prisma.job.updateMany({
      where: { externalId: { startsWith: `${SOURCE}:` }, status: 'ACTIVE', deadline: { lt: new Date(now.getTime() - DEADLINE_GRACE_MS) } },
      data: { status: 'CLOSED', closedAt: now, closedReason: 'deadline_passed' },
    });
    counts.closed += lapsed.count;
    return true;
  }

  /** Keeps cross-source duplicate links honest after an import; never fails the run. */
  private async maintainDuplicateLinks() {
    try {
      await this.jobsService.backfillDedupKeys();
      const released = await this.jobsService.releaseOrphanedDuplicates();
      if (released) this.logger.log(`Released ${released} duplicate posting(s) whose primary closed or was hidden`);
    } catch (error) {
      this.logger.warn(`Duplicate link maintenance failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  async runScrape(): Promise<{ scanned: number; ingested: number; runId: string; status: string }> {
    const now = new Date();
    await this.abandonStaleRuns(now);
    const run = await this.prisma.jobImportRun.create({ data: { source: SOURCE, startedAt: now } });
    this.logger.log(`Starting glorri.az import run ${run.id}`);

    const counts: RunCounts = { created: 0, updated: 0, reopened: 0, unchanged: 0, closed: 0, detailFailures: 0, failedJobs: 0 };
    let listing: ListingResult = { jobs: [], complete: false, pagesFetched: 0 };
    let status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' = 'FAILED';
    const problems: string[] = [];

    try {
      listing = await this.collectListing();
      if (listing.error) problems.push(listing.error);
      await this.importListedJobs(listing.jobs, now, counts);

      if (counts.failedJobs) problems.push(`${counts.failedJobs} job(s) failed to save`);

      const detailFailureAllowance = Math.floor(listing.jobs.length * DETAIL_FAILURE_TOLERANCE_SHARE);
      if (listing.complete && !counts.failedJobs && counts.detailFailures <= detailFailureAllowance) {
        const trusted = await this.reconcileClosures(listing.jobs.map((j) => glorriExternalId(j.slug)), now, counts);
        if (!trusted) problems.push('listing much smaller than the last complete one; closures skipped');
      } else {
        problems.push('closures skipped: incomplete listing or failed details/jobs');
      }

      await this.maintainDuplicateLinks();

      if (counts.detailFailures) problems.push(`${counts.detailFailures} detail page(s) failed`);
      status = listing.pagesFetched === 0 ? 'FAILED' : problems.length ? 'PARTIAL' : 'SUCCEEDED';
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      status = 'FAILED';
    } finally {
      await this.prisma.jobImportRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt: new Date(),
          listingComplete: listing.complete,
          pagesFetched: listing.pagesFetched,
          listed: listing.jobs.length,
          created: counts.created,
          updated: counts.updated,
          unchanged: counts.unchanged,
          reopened: counts.reopened,
          closed: counts.closed,
          detailFailures: counts.detailFailures,
          error: problems.length ? problems.join('; ').slice(0, 2000) : null,
        },
      });
    }

    const ingested = counts.created + counts.updated + counts.reopened;
    this.logger.log(
      `glorri.az import ${run.id} ${status}: listed ${listing.jobs.length}, created ${counts.created}, updated ${counts.updated}, reopened ${counts.reopened}, unchanged ${counts.unchanged}, closed ${counts.closed}`,
    );
    try {
      this.postHogService.capture('glorri-scraper', 'scrape_run_completed', {
        status,
        listed: listing.jobs.length,
        ...counts,
      });
    } catch {
      // analytics is best-effort
    }
    return { scanned: listing.jobs.length, ingested, runId: run.id, status };
  }
}
