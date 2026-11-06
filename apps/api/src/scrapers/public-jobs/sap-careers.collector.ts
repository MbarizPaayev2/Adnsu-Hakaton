import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { fetchPublicDocument, robotsAllows, type CollectionOptions } from './public-job-collector';

export const SAP_SOURCES = {
  socar: { origin: 'https://jobs.socar.az', prefix: '', company: 'SOCAR', location: '', organizations: ['SOCAR'] },
  azercell: { origin: 'https://careers.digitalecosystem.az', prefix: '/Azercell', company: 'Azercell', location: '', organizations: ['Digitalecosystem AZ', 'Azercell'] },
  ey: { origin: 'https://careers.ey.com', prefix: '/ey', company: 'EY', location: 'Baku', organizations: ['EY', 'Ernst & Young'] },
  halliburton: { origin: 'https://jobs.halliburton.com', prefix: '', company: 'Halliburton', location: 'Azerbaijan', organizations: ['Halliburton'] },
} as const;
export type SapSource = keyof typeof SAP_SOURCES;
const clean = (text: string) => text.replace(/[\s\uFEFF]+/g, ' ').trim();

export function sapUrl(source: SapSource, input: string): string {
  const config = SAP_SOURCES[source], url = new URL(input, config.origin);
  const jobPrefix = `${config.prefix}/job/`, searchPath = `${config.prefix}/search/`;
  const job = url.pathname.startsWith(jobPrefix) && /^\/[^/]+\/[1-9]\d*\/$/.test(url.pathname.slice(jobPrefix.length - 1));
  if (url.origin !== config.origin || url.username || url.password || /%2e|%2f|%5c/i.test(url.pathname) ||
      !(url.pathname === '/robots.txt' || url.pathname === searchPath || job)) throw new Error('Unsupported public careers URL');
  const allowed = new Set(['q', 'locationsearch', 'startrow', 'sortColumn', 'sortDirection']);
  if (url.pathname !== searchPath && url.search) throw new Error('Unexpected job URL query');
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new Error('Unsupported careers query');
  if (url.searchParams.has('q') && url.searchParams.get('q') !== '') throw new Error('Unsupported keyword query');
  if (url.searchParams.has('locationsearch') && url.searchParams.get('locationsearch') !== config.location) throw new Error('Location filter changed');
  const offset = url.searchParams.get('startrow');
  if (offset !== null && (!/^\d+$/.test(offset) || Number(offset) > 10_000)) throw new Error('Invalid careers offset');
  if (url.searchParams.has('sortColumn') && url.searchParams.get('sortColumn') !== 'referencedate') throw new Error('Unsupported sort');
  if (url.searchParams.has('sortDirection') && url.searchParams.get('sortDirection') !== 'desc') throw new Error('Unsupported sort direction');
  url.hash = ''; return url.href;
}

export function sapSearchUrl(source: SapSource, offset = 0) {
  const config = SAP_SOURCES[source], url = new URL(`${config.prefix}/search/`, config.origin);
  url.searchParams.set('q', ''); url.searchParams.set('locationsearch', config.location);
  url.searchParams.set('sortColumn', 'referencedate'); url.searchParams.set('sortDirection', 'desc');
  if (offset) url.searchParams.set('startrow', String(offset));
  return sapUrl(source, url.href);
}

export function parseSapListing(source: SapSource, html: string, offset: number) {
  const $ = cheerio.load(html), links = new Set<string>();
  $('a.jobTitle-link[href]').each((_, element) => { links.add(sapUrl(source, $(element).attr('href')!)); });
  const label = clean($('.paginationLabel').first().text());
  const match = /^Results\s+([\d,]+)\s*[–-]\s*([\d,]+)\s+of\s+([\d,]+)/i.exec(label);
  if (!match) {
    const message = clean($('#noresults-message').text());
    if (!links.size && $('#noresults').length && /\b0 most recent jobs\b/i.test(message)) return { urls: [] as string[], total: 0, nextOffset: null };
    throw new Error('Unrecognized careers listing; not proof of zero jobs');
  }
  const [start, end, total] = match.slice(1).map((v) => Number(v.replace(/,/g, '')));
  if (start !== offset + 1 || end < start || end > total || links.size !== end - start + 1 || total > 100_000) throw new Error('Inconsistent careers pagination');
  return { urls: [...links], total, nextOffset: end < total ? end : null };
}

function sourceDate(text: string): string {
  const source = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC (\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!source && !iso) throw new Error('Unrecognized careers date');
  if (iso && (Number(text.slice(11, 13)) > 23 || Number(text.slice(14, 16)) > 59 || Number(text.slice(17, 19)) > 59)) throw new Error('Invalid careers clock time');
  const year = Number(source ? source[6] : iso![1]);
  const month = source ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(source[1]) : Number(iso![2]) - 1;
  const day = Number(source ? source[2] : iso![3]), calendar = new Date(Date.UTC(year, month, day));
  if (year < 2000 || year > 2100 || month < 0 || month > 11 || calendar.getUTCMonth() !== month || calendar.getUTCDate() !== day || (source && (Number(source[3]) > 23 || Number(source[4]) > 59 || Number(source[5]) > 59))) throw new Error('Invalid careers calendar date');
  const date = new Date(text); if (!Number.isFinite(date.getTime())) throw new Error('Invalid careers date');
  return date.toISOString();
}

const BAKU_UTC_OFFSET_MS = 4 * 3_600_000;
const bakuDay = (instant: Date) => new Date(instant.getTime() + BAKU_UTC_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Deadlines the posting text itself states ("Application deadline: 30.09.2026"),
 * as the instant that day ends in Baku. Used only to detect a contradiction
 * with the structured deadline, never to add one the source lacks.
 */
export function statedDeadlines(description: string): Date[] {
  const found: Date[] = [];
  for (const m of description.matchAll(/(?:müraciət üçün son tarix|son tarix|application deadline|closing date|deadline)\s*[:\-–]?\s*(\d{1,2})[./](\d{1,2})[./](20\d{2})/gi)) {
    const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - BAKU_UTC_OFFSET_MS);
    if (month >= 1 && month <= 12 && bakuDay(end) === `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`) found.push(end);
  }
  return found;
}

/** Cities and districts of Azerbaijan accepted from a title's own parenthesis (lower-case, Azerbaijani spelling). A place outside this list is never inferred. */
const TITLE_PLACES = new Set(['salyan', 'sumqayıt', 'naxçıvan', 'xankəndi', 'gəncə', 'bakı', 'mingəçevir', 'lənkəran', 'şəki', 'şirvan', 'yevlax', 'quba', 'qəbələ', 'masallı', 'kürdəmir', 'neftçala', 'astara', 'göyçay', 'şamaxı', 'bərdə', 'ağdam', 'füzuli', 'ağstafa', 'zaqatala', 'balakən']);
export function parseSapJob(source: SapSource, html: string, input: string, fetchedAt: Date): IngestJobDto | null {
  const url = sapUrl(source, input), config = SAP_SOURCES[source], $ = cheerio.load(html);
  const root = $('[itemscope][itemtype$="/JobPosting"]').first();
  if (!root.length) throw new Error('Missing public job metadata');
  const field = (name: string) => { const element = root.find(`[itemprop="${name}"]`).first(); return clean(element.attr('content') || element.text()); };
  const title = field('title'), organization = field('hiringOrganization');
  if (!(config.organizations as readonly string[]).includes(organization)) throw new Error('Unrecognized hiring organization');
  // SOCAR writes "0" for an empty country or city (internship postings); that is the source's blank value, not a place.
  const blank = (v: string) => /^[\s0\-–—.]*$/.test(v);
  const country = blank(field('addressCountry')) ? '' : field('addressCountry'), city = blank(field('addressLocality')) ? '' : field('addressLocality'), street = field('streetAddress');
  const countryIsAz = /^(AZ|Azerbaijan|Azərbaycan)$/i.test(country);
  const cityIsAz = /^(Baku|Bakı|Ganja|Gəncə|Sumgait|Sumqayıt|Nakhchivan|Naxçıvan|Xankəndi|Salyan)$/i.test(city);
  // SOCAR uses streetAddress for the city alone; never interpret US state AZ as a country.
  const streetIsAz = /^(Baku|Bakı|Ganja|Gəncə|Sumgait|Sumqayıt|Nakhchivan|Naxçıvan|Xankəndi|Salyan)(?:,\s*(AZ|Azerbaijan|Azərbaycan))?$/i.test(street);
  // An explicit district in SOCAR's job title resolves its generic "Other" address.
  // The posting's own title names an Azerbaijani city or district in its closing parenthesis ("…, Sumqayıt şəhəri)"): used only when the address fields say nothing.
  const titlePlace = source === 'socar' && (street === 'Digər' || (!country && !city && !street)) ? /,\s*([^,()]+?)\s+(?:şəhəri|rayonu)\)\s*$/i.exec(title)?.[1]?.trim() : undefined;
  const titleDistrict = titlePlace && TITLE_PLACES.has(titlePlace.toLocaleLowerCase('az')) ? titlePlace : undefined;
  // SOCAR also writes an Azerbaijani postal code (four digits) with the country code as the whole address ("4770, AZ"): the country is stated, the city is not.
  // Five digits is a US ZIP and never accepted.
  const postalCodeAz = source === 'socar' && !country && /^\d{4},\s*AZ$/.test(street);
  if (country ? !countryIsAz : !cityIsAz && !streetIsAz && !titleDistrict && !postalCodeAz) return null;
  const location = city || (streetIsAz ? street.split(',')[0] : titleDistrict || 'Azerbaijan');
  const text = root.find('[itemprop="description"]').first().clone();
  text.find('script,style,iframe,form,input,button').remove(); text.find('br').replaceWith('\n'); text.find('p,li,h1,h2,h3,h4').append('\n');
  const description = text.text().split('\n').map(clean).filter(Boolean).join('\n');
  const postedAt = sourceDate(field('datePosted')), valid = field('validThrough'), structuredDeadline = valid ? sourceDate(valid) : undefined;
  // When the text contradicts the structured deadline, neither is trusted over
  // the other: the earlier one is used (a candidate is never told a posting is
  // open longer than any source says) and the conflict is recorded.
  let deadline = structuredDeadline, deadlineConflict: Record<string, unknown> | undefined;
  if (structuredDeadline) {
    const structuredDay = bakuDay(new Date(new Date(structuredDeadline).getTime() - 1));
    const disagreeing = statedDeadlines(description).filter((d) => bakuDay(d) !== structuredDay);
    // A stated date before the posting existed cannot be a deadline: record it, keep the structured one.
    const plausible = disagreeing.filter((d) => d.getTime() >= new Date(postedAt).getTime());
    if (disagreeing.length) {
      const used = [new Date(structuredDeadline), ...plausible].sort((a, b) => a.getTime() - b.getTime())[0].toISOString();
      deadline = used;
      deadlineConflict = { structured: structuredDeadline, statedInDescription: disagreeing.map((d) => d.toISOString()), used, ...(plausible.length < disagreeing.length ? { note: 'stated date precedes the posting date and was ignored' } : {}) };
    }
  }
  if (!title || title.length > 500 || !description || description.length > MAX_JOB_DESCRIPTION_CHARS || location.length > 256 || (deadline && new Date(deadline) < new Date(postedAt))) throw new Error('Incomplete careers job');
  if (new Date(postedAt) > fetchedAt) return null;
  const id = /\/([1-9]\d*)\/$/.exec(new URL(url).pathname)![1];
  return { externalId: `${source}:${id}`, title, company: config.company, description, location, url, postedAt, ...(deadline ? { deadline } : {}), detailFetchedAt: fetchedAt.toISOString(), rawPayload: { source, hiringOrganization: organization, locationEvidence: titleDistrict ? 'explicit-title-district' : postalCodeAz ? 'source-country-code-without-city' : 'source-job-metadata', ...(deadlineConflict ? { deadlineConflict } : {}) } };
}

export class SapCareersCollector {
  constructor(private source: SapSource,
    private read: (url: string) => Promise<string> = (url) => fetchPublicDocument(url, (u) => sapUrl(source, u)),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
  ) {}
  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>) {
    const { maxPages, maxJobs, delayMs } = options;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200 || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10_000 || !Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 60_000) throw new Error('Invalid collection limits');
    const report = { source: this.source, complete: false, outcome: undefined as CollectionOutcome | undefined, pages: 0, discovered: 0, fetched: 0, expired: 0, skipped: 0, failed: 0, accepted: 0, error: undefined as string | undefined };
    let offset: number | null = 0, total: number | undefined;
    const seen = new Set<string>();
    try {
      const robots = await this.read(`${SAP_SOURCES[this.source].origin}/robots.txt`);
      const get = async (url: string) => {
        if (!robotsAllows(robots, new URL(url).pathname + new URL(url).search)) throw new Error('Careers crawler rules prohibit this URL');
        await this.pause(delayMs); return this.read(url);
      };
      while (offset !== null && report.pages < maxPages && report.fetched < maxJobs) {
        const page = parseSapListing(this.source, await get(sapSearchUrl(this.source, offset)), offset);
        if (total !== undefined && total !== page.total) throw new Error('Careers listing changed during pagination');
        total = page.total; report.pages++;
        for (const url of page.urls) {
          if (seen.has(url)) throw new Error('Careers listing repeated a job');
          seen.add(url); report.discovered++;
          if (report.fetched >= maxJobs) continue;
          const html = await get(url); report.fetched++;
          let job: IngestJobDto | null;
          try { job = parseSapJob(this.source, html, url, this.now()); } catch { report.failed++; continue; }
          if (!job) { report.skipped++; continue; }
          if (job.deadline && new Date(job.deadline) < this.now()) report.expired++;
          await accept(job); report.accepted++;
        }
        offset = page.nextOffset;
      }
      report.complete = offset === null && report.discovered === total && report.fetched === report.discovered && !report.failed;
      report.outcome = report.failed ? 'INVALID_DETAIL' : report.complete ? report.discovered === 0 ? 'NO_OPENINGS' : 'COMPLETE_CENSUS' : 'BOUNDED_PROGRESS';
      if (!report.complete) report.error = report.failed ? 'Some careers details could not be parsed; no closures inferred' : 'Collection limit reached; coverage incomplete';
    } catch (error) { Object.assign(report, { outcome: 'UPSTREAM_FAILURE' as const }); report.error = error instanceof Error ? error.message : 'Careers collection failed'; }
    return report;
  }
}
