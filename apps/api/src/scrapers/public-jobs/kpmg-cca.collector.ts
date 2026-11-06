import * as cheerio from 'cheerio';
import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { MAX_JOB_DESCRIPTION_CHARS } from '../../jobs/dto/ingest-job.dto';
import { fetchPublicDocument, robotsAllows, type CollectionOptions } from './public-job-collector';

export const KPMG_CCA_ORIGIN = 'https://kpmgcca.global.huntflow.io';
export const KPMG_CCA_LIST = `${KPMG_CCA_ORIGIN}/`;
const clean = (s: string) => s.replace(/[\s\uFEFF\u00a0]+/g, ' ').trim();
const norm = (s: string) => clean(s).toLocaleLowerCase('en');

export interface KpmgCcaEntry { slug: string; url: string; title: string; location: string }

/** Allow only the public KPMG CCA board, its listing, robots file, and individual public vacancy pages. */
export function kpmgCcaUrl(input: string): string {
  const u = new URL(input, KPMG_CCA_ORIGIN);
  if (u.origin !== KPMG_CCA_ORIGIN || u.username || u.password || u.search || u.hash || /%|\\/.test(u.pathname) ||
    !(u.pathname === '/' || u.pathname === '/robots.txt' || u.pathname === '/vacancy' || /^\/vacancy\/[a-z0-9-]{1,160}$/.test(u.pathname))) {
    throw new Error('Unsupported KPMG CCA public URL');
  }
  return u.href;
}

/** First rendered page only. We use the board's own location label to avoid fetching non-Azerbaijan roles. */
export function parseKpmgCcaListing(html: string): { entries: KpmgCcaEntry[]; hasMore: boolean } {
  const $ = cheerio.load(html);
  if (!/KPMG Caucasus and Central Asia Job Openings/i.test($('title').text())) throw new Error('Unrecognized KPMG CCA board identity');
  const entries = new Map<string, KpmgCcaEntry>();
  let recognizedCards = 0;
  $('article').each((_, article) => {
    const link = $(article).find('h3 a[href]').first();
    const href = link.attr('href');
    if (!href) return;
    let url: string;
    try { url = kpmgCcaUrl(href); } catch { return; }
    const title = clean(link.text());
    const location = clean($(article).find('div').filter((__, el) => $(el).text().includes('·')).first().text()).split('·')[0].trim();
    if (title && location) recognizedCards++;
    // Deliberately exact: regional offices are not silently attributed to Azerbaijan.
    if (!title || !/^(?:Baku|Bakı)$/i.test(location)) return;
    const slug = new URL(url).pathname.split('/').pop()!;
    if (entries.has(slug)) throw new Error('Duplicate KPMG CCA vacancy slug');
    entries.set(slug, { slug, url, title, location: 'Baku' });
  });
  if (!entries.size && recognizedCards === 0 && !/no current openings|no vacancies available/i.test($('body').text())) throw new Error('KPMG CCA board has no recognizable vacancy cards');
  const hasMore = $('button').toArray().some((el) => /show more openings/i.test(clean($(el).text())));
  return { entries: [...entries.values()], hasMore };
}

function sectionText($: cheerio.CheerioAPI, label: string): string[] {
  const heading = $('h2').filter((_, el) => norm($(el).text()) === norm(label)).first();
  if (!heading.length) return [];
  // Each section is a sibling wrapper with one content subtree; include paragraphs and bullets only.
  const wrapper = heading.parent();
  const lines: string[] = [];
  wrapper.find('p, li').each((_, el) => {
    const text = clean($(el).text());
    if (text && !lines.includes(text)) lines.push(text);
  });
  return lines;
}

export function parseKpmgCcaDetail(html: string, entry: KpmgCcaEntry, fetchedAt: Date): IngestJobDto | null {
  const requested = kpmgCcaUrl(entry.url), $ = cheerio.load(html);
  const title = clean($('h1').first().text());
  const header = $('header').first();
  // Adjacent block text nodes can concatenate as `...SpecialistBaku`; read the location block separately.
  const locationText = header.find('div').map((_, el) => clean($(el).text())).get().join(' ');
  const headerLocation = locationText || clean(header.text());
  if (new URL(requested).pathname.split('/').pop() !== entry.slug || title !== entry.title) throw new Error('KPMG CCA detail identity mismatch');
  if (!/\b(?:Baku|Bakı)\b/i.test(headerLocation)) return null;
  if (/this job opening is archived|vakansiya arxivə köçürülüb/i.test($('body').text())) return null;
  const responsibilities = sectionText($, 'Responsibilities');
  const requirements = sectionText($, 'Requirements');
  if (!responsibilities.length || !requirements.length) throw new Error('KPMG CCA detail lacks recognizable responsibilities or requirements');
  const description = [
    'Responsibilities:', ...responsibilities.map((line) => `• ${line}`),
    'Requirements:', ...requirements.map((line) => `• ${line}`),
  ].join('\n');
  if (description.length > MAX_JOB_DESCRIPTION_CHARS) throw new Error('KPMG CCA description exceeds the allowed size');
  const canonical = $('link[rel="canonical"]').attr('href');
  if (canonical && kpmgCcaUrl(canonical) !== requested) throw new Error('KPMG CCA canonical identity mismatch');
  return {
    externalId: `kpmg-cca:${entry.slug}`, title, company: 'KPMG Caucasus and Central Asia', description, location: 'Baku', url: requested,
    // This board does not publish a posting date. Keep the required API field as first-observed and expose that limitation.
    postedAt: fetchedAt.toISOString(), detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: { source: 'kpmg-cca', locationEvidence: 'listing-and-detail-city', postedAtBasis: 'first-observed', deadlineEvidence: 'not-provided' },
  };
}

/**
 * KPMG CCA's public board exposes 20 initial cards and a “Show more openings” control. This bounded collector
 * imports only cards explicitly marked Baku; because pagination is not yet proven, it never claims completeness
 * and cannot close jobs missing from this snapshot.
 */
export class KpmgCcaCollector {
  constructor(
    private read: (url: string) => Promise<string> = (url) => fetchPublicDocument(url, kpmgCcaUrl, ['text/html', 'text/plain'], 4 * 1024 * 1024),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
  ) {}

  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>) {
    const { maxPages, maxJobs, delayMs } = options;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200 || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10_000 || !Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 60_000) throw new Error('Invalid collection limits');
    const report = { source: 'kpmg-cca', complete: false, outcome: undefined as CollectionOutcome | undefined, pages: 0, discovered: 0, fetched: 0, expired: 0, skipped: 0, failed: 0, accepted: 0, known: 0, error: undefined as string | undefined };
    try {
      let detailTransportFailure = false;
      const robots = await this.read(`${KPMG_CCA_ORIGIN}/robots.txt`);
      const get = async (url: string) => {
        const path = new URL(kpmgCcaUrl(url)).pathname;
        if (!robotsAllows(robots, path)) throw new Error('KPMG CCA robots rules prohibit this URL');
        await this.pause(Math.max(delayMs, 2000));
        return this.read(url);
      };
      const listing = parseKpmgCcaListing(await get(KPMG_CCA_LIST));
      report.pages = 1;
      report.discovered = listing.entries.length;
      for (const entry of listing.entries) {
        const id = `kpmg-cca:${entry.slug}`;
        if (options.isKnown?.(id)) { report.known++; continue; }
        if (report.fetched >= maxJobs) continue;
        report.fetched++;
        let html: string;
        try { html = await get(entry.url); }
        catch (error) {
          report.failed++;
          const message = error instanceof Error ? error.message : 'KPMG CCA detail could not be read';
          detailTransportFailure = true;
          await options.onFailedDetail?.(id, message);
          continue;
        }
        let job: IngestJobDto | null;
        try { job = parseKpmgCcaDetail(html, entry, this.now()); }
        catch (error) {
          report.failed++;
          await options.onFailedDetail?.(id, error instanceof Error ? error.message : 'KPMG CCA detail could not be parsed');
          continue;
        }
        if (!job) { report.skipped++; continue; }
        await accept(job); report.accepted++;
      }
      report.error = report.failed ? 'Some KPMG CCA details could not be parsed; pagination is unverified and no closures are inferred'
        : listing.hasMore ? 'Initial KPMG CCA snapshot only; additional openings may be available through the board’s show-more control; no closures inferred'
          : 'KPMG CCA active census is unverified; no closures inferred';
      report.outcome = detailTransportFailure ? 'UPSTREAM_FAILURE' : report.failed ? 'INVALID_DETAIL' : 'BOUNDED_PROGRESS';
    } catch (error) { report.outcome = 'UPSTREAM_FAILURE'; report.error = error instanceof Error ? error.message : 'KPMG CCA collection failed'; }
    return report;
  }
}
