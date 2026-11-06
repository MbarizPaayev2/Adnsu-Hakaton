import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { HELLOJOB_ORIGIN, parseHellojobDetail, parseHellojobListing, sourceUrl } from './hellojob.parser';

const USER_AGENT = 'AISEVacancyCollector/1.0 (+https://aisehr.com)';
const MAX_BYTES = 2 * 1024 * 1024;

/** Conservative robots handling: unknown directives fail closed; the most specific matching group wins. */
type RobotsGroup = { agents: string[]; rules: { allow: boolean; path: string }[]; crawlDelay?: number };
function parseRobotsGroups(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let group: typeof groups[number] | undefined;
  let hasRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) throw new Error('Unrecognized robots response');
    const directive = m[1].toLowerCase(), value = m[2].trim();
    if (directive === 'user-agent') {
      if (!group || hasRules) { group = { agents: [], rules: [] }; groups.push(group); hasRules = false; }
      group.agents.push(value.toLowerCase());
    } else if (directive === 'allow' || directive === 'disallow') {
      if (!group) throw new Error('Invalid robots group');
      hasRules = true;
      if (value) group.rules.push({ allow: directive === 'allow', path: value });
    } else if (directive === 'crawl-delay') {
      // Validate now; applicability is determined after selecting this collector's agent group.
      // A delay addressed only to another crawler must not block unrelated public collection.
      if (!group) throw new Error('Invalid robots group');
      hasRules = true;
      if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) > 3600) throw new Error('Unreadable robots crawl-delay');
      group.crawlDelay = Number(value);
    } else if (directive === 'content-signal') {
      if (/\bsearch\s*=\s*no\b/i.test(value)) {
        throw new Error('Robots content-signal explicitly disallows search indexing');
      }
    } else if (directive !== 'sitemap' && directive !== 'host') {
      throw new Error(`Unsupported robots directive: ${directive}`);
    }
  }
  if (!groups.length) throw new Error('No recognizable robots groups');
  return groups;
}

export function robotsAllows(text: string, path: string, options: { crawlDelayHonored?: boolean } = {}): boolean {
  const groups = parseRobotsGroups(text);
  const agent = USER_AGENT.split('/')[0].toLowerCase();
  const specificity = (g: typeof groups[number]) => Math.max(-1, ...g.agents.map((a) => a === '*' ? 0 : agent.includes(a) ? a.length : -1));
  const best = Math.max(...groups.map(specificity));
  const applicable = groups.filter((g) => specificity(g) === best && best >= 0);
  if (!options.crawlDelayHonored && applicable.some(g => g.crawlDelay !== undefined)) {
    throw new Error('Unsupported robots directive: crawl-delay');
  }
  const rules = applicable.flatMap((g) => g.rules);
  const matching = rules.filter((r) => {
    const end = r.path.endsWith('$');
    const pattern = (end ? r.path.slice(0, -1) : r.path).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}${end ? '$' : ''}`).test(path);
  }).sort((a, b) => b.path.replace(/[*$]/g, '').length - a.path.replace(/[*$]/g, '').length || Number(b.allow) - Number(a.allow));
  return !matching.length || matching[0].allow;
}

/**
 * The crawl-delay (ms) that applies to this collector's own user agent: the most specific matching group, else `*`, else none.
 * A delay addressed only to other crawlers (e.g. AI-bot groups) does not apply to us, but collectors still keep their own minimum.
 */
export function robotsCrawlDelayMs(text: string): number | null {
  const groups = parseRobotsGroups(text);
  const agent = USER_AGENT.split('/')[0].toLowerCase();
  const specificity = (g: RobotsGroup) => Math.max(-1, ...g.agents.map((a) => a === '*' ? 0 : agent.includes(a) ? a.length : -1));
  const best = Math.max(...groups.map(specificity));
  if (best < 0) return null;
  const delays = groups.filter((g) => specificity(g) === best && g.crawlDelay !== undefined).map((g) => g.crawlDelay as number);
  return delays.length ? Math.round(Math.max(...delays) * 1000) : null;
}

/** Bounded direct requests: no browser impersonation, proxy rotation, CAPTCHA solving or login. */
export async function fetchPublicDocument(input: string, validateUrl = sourceUrl, types = ['text/html', 'text/plain'], maxBytes = MAX_BYTES): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    let url = validateUrl(input);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': USER_AGENT, Accept: types.join(',') } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get('location');
        await response.body?.cancel();
        if (!next) throw new Error('Redirect without location');
        url = validateUrl(new URL(next, url).href);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Source HTTP ${response.status}`); }
      const contentType = response.headers.get('content-type') || '';
      if (!types.includes(contentType.split(';')[0].trim().toLowerCase())) { await response.body?.cancel(); throw new Error('Unexpected source content type'); }
      if (!response.body) throw new Error('Empty source response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) { await reader.cancel(); throw new Error('Source response too large'); }
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString('utf8');
    }
    throw new Error('Too many source redirects');
  } finally { clearTimeout(timer); }
}

export async function postPublicJson(
  input: string,
  body: Record<string, unknown>,
  validateUrl = sourceUrl,
  extraHeaders: Record<string, string> = {},
  maxBytes = MAX_BYTES,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const url = validateUrl(input);
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Source HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json') && !contentType.includes('application/graphql-response+json')) {
      await response.body?.cancel();
      throw new Error('Unexpected source content type');
    }
    if (!response.body) throw new Error('Empty source response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error('Source response too large');
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Malformed JSON from source');
    }
  } finally {
    clearTimeout(timer);
  }
}

export const fetchPublicHtml = (input: string) => fetchPublicDocument(input);

/**
 * Where a bounded collection stopped, in the source's own terms, so the next run continues there instead of re-reading the same head pages. Positional
 * kinds (`page`, `url`) are resumed ONE PAGE EARLIER than they stopped: if the listing shifted meanwhile the overlap still contains what was read before.
 * A cursor never points past a page whose postings were not all handled.
 */
export type DiscoveryCursor =
  | { kind: 'page'; page: number }
  | { kind: 'cursor'; value: string }
  | { kind: 'url'; url: string; prev?: string }
  | { kind: 'queue'; pending: string[] };

export interface CollectionOptions {
  /** Continue a bounded traversal from this cursor. A resumed run never reports a complete listing, whatever it reached. */
  resume?: DiscoveryCursor;
  maxPages: number; maxJobs: number; delayMs: number;
  startPage?: number;
  /** Postings already stored: their detail pages are not requested again (they are counted as `known`, not refreshed). */
  isKnown?: (externalId: string) => boolean;
  /** Callback fired when an existing or new posting is observed listed in the current run. */
  onListed?: (externalId: string) => Promise<void> | void;
  /** Callback fired when a detail page could not be fetched or parsed. */
  onFailedDetail?: (externalId: string, error: string) => Promise<void> | void;
}
export interface CollectionReport {
  source: 'hellojob'; complete: boolean; outcome?: CollectionOutcome; pages: number; discovered: number;
  fetched: number; expired: number; failed: number; accepted: number; known?: number; error?: string;
  /** Where a bounded run stopped (absent or null: it reached the listing's end). */
  cursor?: DiscoveryCursor | null;
}
export class PublicJobCollector {
  constructor(
    private read: (url: string) => Promise<string> = fetchPublicHtml,
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
  ) {}

  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>): Promise<CollectionReport> {
    const { maxPages, maxJobs, delayMs } = options;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200 || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10_000 ||
        !Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 60_000) throw new Error('Invalid collection limits');
    const report: CollectionReport = { source: 'hellojob', complete: false, pages: 0, discovered: 0, fetched: 0, expired: 0, failed: 0, accepted: 0 };
    const robots = await this.read(`${HELLOJOB_ORIGIN}/robots.txt`);
    const seenPages = new Set<string>(), seenJobs = new Set<string>();
    // A resumed run starts one page back (the page before the cursor), so a listing that shifted still overlaps what was read.
    let page: string | null = options.resume?.kind === 'url' ? (options.resume.prev ?? options.resume.url) : `${HELLOJOB_ORIGIN}/vakansiyalar`;
    let prevPage: string | undefined;
    let stoppedAt: DiscoveryCursor | null | undefined;
    const get = async (url: string) => {
      if (!robotsAllows(robots, new URL(url).pathname + new URL(url).search)) throw new Error('Source crawler rules prohibit this URL');
      await this.pause(delayMs);
      return this.read(url);
    };
    try {
      while (page && report.pages < maxPages && report.fetched < maxJobs) {
        if (seenPages.has(page)) throw new Error('Listing pagination repeated');
        seenPages.add(page);
        const listing = parseHellojobListing(await get(page), page);
        report.pages++;
        let unseen = 0, budgetSkipped = 0;
        for (const url of listing.urls) {
          if (seenJobs.has(url)) continue;
          unseen++; seenJobs.add(url); report.discovered++;
          const externalId = `hellojob:${new URL(url).pathname.split('/').pop()}`;
          if (options.isKnown?.(externalId)) {
            report.known = (report.known ?? 0) + 1;
            await options.onListed?.(externalId);
            continue;
          }
          if (report.fetched >= maxJobs) { budgetSkipped++; continue; }
          // Transport errors stop the run, including 403/429; never retry around a restriction.
          const html = await get(url); report.fetched++;
          let job: IngestJobDto;
          try { job = parseHellojobDetail(html, url, this.now()); }
          catch (error) {
            report.failed++;
            await options.onFailedDetail?.(externalId, error instanceof Error ? error.message : 'Invalid HelloJob detail');
            continue;
          }
          // Refresh expired deadlines too: skipping an existing row would leave its old future deadline active.
          // JobsService excludes expired postings before matching, without deleting any historic application.
          if (job.deadline && new Date(job.deadline) < this.now()) report.expired++;
          // Destination errors also stop the run rather than quietly reporting success.
          await accept(job); report.accepted++;
        }
        if (!unseen && listing.next) throw new Error('Listing repeats jobs without progress');
        // The fetch budget ran out in the middle of this page: the cursor stays on it so the rest is read next time, never skipped.
        if (budgetSkipped > 0) { stoppedAt = { kind: 'url', url: seenPagesLast(seenPages), ...(prevPage ? { prev: prevPage } : {}) }; break; }
        prevPage = seenPagesLast(seenPages);
        page = listing.next;
        const fullyAccounted = options.onListed
          ? report.discovered === (report.fetched + (report.known ?? 0))
          : report.discovered === report.fetched;
        if (!page && fullyAccounted && !report.failed) report.complete = true;
      }
      if (stoppedAt === undefined) stoppedAt = page ? { kind: 'url', url: page, ...(prevPage ? { prev: prevPage } : {}) } : null;
      report.cursor = stoppedAt; // failed details do not hold the traversal back: they stay unknown and are fetched again on a later pass
      if (options.resume) report.complete = false; // a resumed run did not start at the head of the listing
      report.outcome = report.failed ? 'INVALID_DETAIL' : report.complete
        ? report.discovered === 0 ? 'NO_OPENINGS' : 'COMPLETE_CENSUS'
        : 'BOUNDED_PROGRESS';
      if (!report.complete) report.error = report.failed ? 'Some details could not be parsed; no closures inferred' : 'Collection limit reached; coverage incomplete';
    } catch (error) {
      report.outcome = 'UPSTREAM_FAILURE';
      report.error = error instanceof Error ? error.message : 'Collection failed';
    }
    // Never close jobs merely because a capped/failed/empty listing did not contain them.
    return report;
  }
}

/** The listing page just processed (the last one added to the visited set). */
const seenPagesLast = (seen: Set<string>) => [...seen][seen.size - 1];

export const AZERBAIJAN_COUNTRY_CODES = new Set([
  'AZ', 'AZE', '031',
  'AZERBAIJAN', 'AZERBAYCAN', 'AZƏRBAYCAN', 'АЗЕРБАЙДЖАН'
]);

export const KNOWN_FOREIGN_LOCALITIES = new Set([
  'ISTANBUL', 'İSTANBUL', 'ANKARA', 'IZMIR', 'İZMİR', 'BURSA', 'ANTALYA',
  'TBILISI', 'ТБИЛИСИ', 'BATUMI', 'KUTAISI',
  'MOSCOW', 'МОСКВА', 'SAINT PETERSBURG', 'САНКТ-ПЕТЕРБУРГ',
  'KIEV', 'KYIV', 'КИЕВ', 'MINSK', 'МИНСК',
  'ALMATY', 'АЛМАТЫ', 'ASTANA', 'АСТАНА', 'TASHKENT', 'ТАШКЕНТ',
  'DUBAI', 'ABU DHABI', 'DOHA', 'RIYADH',
  'LONDON', 'BERLIN', 'PARIS', 'NEW YORK', 'WARSAW'
]);

/** Strict ISO calendar date parser: rejects rollover (e.g. 2026-02-30) and malformed dates. */
export function parseStrictIsoDate(text: string): string | undefined {
  const cleaned = text.replace(/[\s\uFEFF]+/g, ' ').trim();
  if (!cleaned) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(?:Z|([+-]\d{2}:?\d{2}))?)?$/.exec(cleaned);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1; // 0-11
  const day = Number(match[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31 || year < 2020 || year > 2100) return undefined;
  const check = new Date(Date.UTC(year, month, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) {
    return undefined; // Calendar rollover (e.g. 2026-02-30 -> March 2)
  }
  const date = new Date(cleaned);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toISOString();
}

/** Conservative Azerbaijan location extractor: rejects explicitly foreign countries and localities. */
export function validateAzerbaijanLocation(jobLocation: any, fallback = 'Azerbaijan'): string {
  if (!jobLocation) return fallback;

  const locations = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  const validLocalities: string[] = [];

  for (const loc of locations) {
    if (typeof loc === 'string') {
      const cleaned = loc.replace(/[\s\uFEFF]+/g, ' ').trim();
      if (!cleaned) continue;
      const upper = cleaned.toUpperCase();
      if (KNOWN_FOREIGN_LOCALITIES.has(upper)) {
        throw new Error(`Foreign vacancy rejected: locality ${cleaned}`);
      }
      validLocalities.push(cleaned);
      continue;
    }

    const address = loc.address || loc;
    const country = typeof address.addressCountry === 'object'
      ? address.addressCountry?.name
      : address.addressCountry;

    if (country) {
      const normCountry = String(country).replace(/[\s\uFEFF]+/g, ' ').trim().toUpperCase();
      if (!AZERBAIJAN_COUNTRY_CODES.has(normCountry)) {
        throw new Error(`Foreign vacancy rejected: country ${country}`);
      }
    }

    const locality = address.addressLocality || address.addressRegion || loc.name;
    if (locality) {
      const cleanedLoc = String(locality).replace(/[\s\uFEFF]+/g, ' ').trim();
      const upper = cleanedLoc.toUpperCase();
      if (KNOWN_FOREIGN_LOCALITIES.has(upper)) {
        throw new Error(`Foreign vacancy rejected: locality ${cleanedLoc}`);
      }
      validLocalities.push(cleanedLoc);
    }
  }

  if (validLocalities.length === 0) {
    return fallback;
  }

  const unique = [...new Set(validLocalities)];
  const combined = unique.join(', ');
  if (combined.length > 256) throw new Error('Invalid location');
  return combined;
}
