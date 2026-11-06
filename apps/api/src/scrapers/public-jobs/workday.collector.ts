/**
 * Workday career sites (myworkdayjobs.com) of employers with Azerbaijan postings, read through the JSON endpoints the career site itself calls:
 *   POST /wday/cxs/<tenant>/<site>/jobs   (search; public, no login)   and   GET /wday/cxs/<tenant>/<site>/job/...   (one posting)
 * A tenant is listed only when the employer's OFFICIAL careers page links to it (ats-tenants.ts). Robots is read first and must allow /wday/cxs.
 * The search text narrows the list; a posting is kept only when its own detail names Azerbaijan as the country, so a fuzzy search hit elsewhere is dropped.
 * Apply, sign-in and candidate-home paths are never requested.
 */
import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { fetchPublicDocument, postPublicJson, robotsAllows, robotsCrawlDelayMs, type CollectionOptions } from './public-job-collector';

export const WORKDAY_TENANTS = {
  // Official page https://careers.bakerhughes.com/global/en links bakerhughes.wd5.myworkdayjobs.com/BakerHughes (probe 16 Oct 2026: 5 Baku postings).
  'baker-hughes': {
    host: 'bakerhughes.wd5.myworkdayjobs.com', tenant: 'bakerhughes', site: 'BakerHughes', company: 'Baker Hughes', searchText: 'Azerbaijan',
    verified: '2026-10-16', evidence: 'Official site https://careers.bakerhughes.com/global/en links https://bakerhughes.wd5.myworkdayjobs.com/BakerHughes',
  },
  'bp-azerbaijan': {
    host: 'bpinternational.wd3.myworkdayjobs.com', tenant: 'bpinternational', site: 'bpCareers', company: 'bp Azerbaijan', searchText: 'Azerbaijan',
    verified: '2026-10-25', evidence: 'Official site https://careers.bp.com/job-description/RQ117127 links https://bpinternational.wd3.myworkdayjobs.com/bpCareers; public cxs search and detail verified for Azerbaijan on 25 October 2026',
  },
  fugro: {
    host: 'fugro.wd3.myworkdayjobs.com', tenant: 'fugro', site: 'Careers', company: 'Fugro', searchText: 'Azerbaijan',
    verified: '2026-10-26', evidence: 'Official site https://www.fugro.com/careers links https://fugro.wd3.myworkdayjobs.com/Careers',
  },
} as const;
export type WorkdayTenant = keyof typeof WORKDAY_TENANTS;

const PAGE = 20;
const clean = (s: string) => s.replace(/[\s ﻿]+/g, ' ').trim();

export function workdayUrl(source: WorkdayTenant, input: string): string {
  const cfg = WORKDAY_TENANTS[source], u = new URL(input, `https://${cfg.host}`);
  if (u.protocol !== 'https:' || u.host !== cfg.host || u.username || u.password || u.hash || u.search || /[\\]/.test(u.pathname)) throw new Error('Unsupported Workday URL');
  const base = `/wday/cxs/${cfg.tenant}/${cfg.site}`;
  if (u.pathname === '/robots.txt' || u.pathname === `${base}/jobs`) return u.href;
  // One posting: /job/<location segment>/<title segment>_<requisition>. Nothing else under the tenant (apply, userHome, sign-in) is reachable.
  if (new RegExp(`^${base}/job/[A-Za-z0-9._~(),-]+/[A-Za-z0-9._~(),-]+_R(?:Q)?\\d+(?:-\\d+)?$`).test(u.pathname) && !/\/apply/i.test(u.pathname)) return u.href;
  throw new Error('Unsupported Workday URL');
}

const text = (html: string): string => {
  const $ = cheerio.load(html);
  $('script,style,form,input,button,iframe').remove();
  $('br').replaceWith('\n'); $('p,li,h1,h2,h3,h4,h5,h6,div').append('\n');
  return $.root().text().split('\n').map(clean).filter(Boolean).join('\n');
};

export interface WorkdaySearch { total: number; paths: string[] }

export function parseWorkdaySearch(json: unknown): WorkdaySearch {
  const body = json as { total?: unknown; jobPostings?: unknown };
  if (!body || !Number.isInteger(body.total) || (body.total as number) < 0 || !Array.isArray(body.jobPostings)) throw new Error('Unrecognized Workday search response');
  const paths = body.jobPostings.map((p) => {
    const path = (p as { externalPath?: unknown })?.externalPath;
    if (typeof path !== 'string' || !path.startsWith('/job/')) throw new Error('Workday posting without a path');
    return path;
  });
  return { total: body.total as number, paths };
}

/** Workday's startDate is the posting date (a calendar date). Anything else is not trusted and the first observation is used instead. */
function postedAt(startDate: unknown, now: Date): { postedAt: string; basis: 'source-start-date' | 'first-observed' } {
  if (typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const d = new Date(`${startDate}T00:00:00+04:00`);
    if (!Number.isNaN(d.getTime()) && d.getTime() <= now.getTime() + 86_400_000) return { postedAt: d.toISOString(), basis: 'source-start-date' };
  }
  return { postedAt: now.toISOString(), basis: 'first-observed' };
}

/** Workday's endDate is the last day the posting accepts applications; it becomes the deadline (end of that day in Baku) only when it is a real date not before the posting date. */
function deadline(endDate: unknown, posted: string): string | undefined {
  if (typeof endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return undefined;
  const d = new Date(`${endDate}T23:59:59+04:00`);
  return Number.isNaN(d.getTime()) || d.getTime() < new Date(posted).getTime() ? undefined : d.toISOString();
}

/** One posting, or null when Workday says it is not an Azerbaijan posting (kept out, not a failure). Throws on an unreadable response. */
export function parseWorkdayDetail(source: WorkdayTenant, json: unknown, path: string, now: Date): IngestJobDto | null {
  const cfg = WORKDAY_TENANTS[source];
  const info = (json as { jobPostingInfo?: Record<string, unknown> })?.jobPostingInfo;
  if (!info || typeof info.title !== 'string' || typeof info.jobDescription !== 'string') throw new Error('Unrecognized Workday posting');
  const country = (info.country as { descriptor?: unknown } | undefined)?.descriptor;
  if (country !== 'Azerbaijan') return null;
  const title = clean(info.title), description = text(info.jobDescription);
  const location = clean([info.location, ...(Array.isArray(info.additionalLocations) ? info.additionalLocations : [])].filter((l): l is string => typeof l === 'string').join('; '));
  const reqId = typeof info.jobReqId === 'string' && /^RQ?\d+$/.test(info.jobReqId) ? info.jobReqId : /_(RQ?\d+)(?:-\d+)?$/.exec(path)?.[1];
  if (!title || title.length > 500 || !description || description.length > MAX_JOB_DESCRIPTION_CHARS || !location || location.length > 256 || !reqId) throw new Error('Invalid Workday posting');
  // The candidate-facing page is the career site's own job page; the cxs JSON path is only how it is read.
  const url = typeof info.externalUrl === 'string' && new URL(info.externalUrl).host === cfg.host ? info.externalUrl : `https://${cfg.host}/${cfg.site}${path}`;
  const posted = postedAt(info.startDate, now), closes = deadline(info.endDate, posted.postedAt);
  return {
    externalId: `${source}:${reqId}`, title, company: cfg.company, description, location: location.replace(/^AZ-/, 'Azerbaijan, '), url,
    postedAt: posted.postedAt, ...(closes ? { deadline: closes } : {}), detailFetchedAt: now.toISOString(),
    rawPayload: { source, vendor: 'workday', reqId, postedAtBasis: posted.basis, ...(typeof info.timeType === 'string' ? { timeType: info.timeType } : {}) },
  };
}

export class WorkdayCollector {
  constructor(private source: WorkdayTenant,
    private read: (url: string) => Promise<string> = (u) => fetchPublicDocument(u, (v) => workdayUrl(source, v), ['text/plain', 'application/json']),
    private search: (url: string, body: Record<string, unknown>) => Promise<unknown> = (u, b) => postPublicJson(u, b, (v) => workdayUrl(source, v)),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date()) {
    if (!(source in WORKDAY_TENANTS)) throw new Error(`Unknown Workday tenant: "${source}"`);
  }

  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>) {
    if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 200 || !Number.isInteger(options.maxJobs) || options.maxJobs < 1 || options.maxJobs > 10_000 || !Number.isInteger(options.delayMs) || options.delayMs < 1000 || options.delayMs > 60_000) throw new Error('Invalid collection limits');
    const cfg = WORKDAY_TENANTS[this.source], origin = `https://${cfg.host}`, base = `/wday/cxs/${cfg.tenant}/${cfg.site}`;
    const report = { source: this.source, complete: false, outcome: undefined as CollectionOutcome | undefined, pages: 0, discovered: 0, fetched: 0, skipped: 0, accepted: 0, expired: 0, failed: 0, error: undefined as string | undefined };
    try {
      const robots = await this.read(`${origin}/robots.txt`);
      if (!robotsAllows(robots, `${base}/jobs`, { crawlDelayHonored: true })) throw new Error('Workday crawler rules prohibit the public job search');
      const delay = Math.max(options.delayMs, robotsCrawlDelayMs(robots) || 0);
      const seen = new Set<string>();
      let total: number | null = null;
      for (let offset = 0; report.pages < options.maxPages && (total === null || offset < total); offset += PAGE) {
        await this.pause(delay);
        const page = parseWorkdaySearch(await this.search(`${origin}${base}/jobs`, { appliedFacets: {}, limit: PAGE, offset, searchText: cfg.searchText }));
        report.pages++;
        if (total === null) total = page.total;
        else if (page.total !== total) throw new Error('Workday result count changed during collection');
        if (!page.paths.length && offset < total) throw new Error('Workday returned an empty page before its stated total');
        for (const path of page.paths) {
          if (seen.has(path)) throw new Error('Workday paging repeated a posting');
          seen.add(path); report.discovered++;
          if (report.fetched >= options.maxJobs) continue;
          const url = workdayUrl(this.source, `${base}${path}`);
          if (!robotsAllows(robots, new URL(url).pathname, { crawlDelayHonored: true })) throw new Error('Workday crawler rules prohibit a posting');
          await this.pause(delay);
          const response = await this.read(url);
          report.fetched++;
          let job: IngestJobDto | null;
          try { job = parseWorkdayDetail(this.source, JSON.parse(response), path, this.now()); }
          catch { report.failed++; continue; }
          if (!job) { report.skipped++; continue; }
          await accept(job); report.accepted++;
        }
      }
      report.complete = total !== null && report.discovered === total && report.fetched + report.failed === total && report.failed === 0;
      report.outcome = report.failed ? 'INVALID_DETAIL' : report.complete ? report.discovered === 0 ? 'NO_OPENINGS' : 'COMPLETE_CENSUS' : 'BOUNDED_PROGRESS';
      if (!report.complete) report.error = report.failed ? 'Workday postings failed validation; no closures inferred' : 'Workday listing incomplete or collection budget reached';
    } catch (e) { Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const }); report.error = e instanceof Error ? e.message : 'Workday collection failed'; }
    return report;
  }
}
