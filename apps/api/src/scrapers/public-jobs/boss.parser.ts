import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { parseStrictIsoDate, validateAzerbaijanLocation } from './public-job-collector';
import { bakuInstant } from './baku-time';

export const BOSS_ORIGIN = 'https://boss.az';
const clean = (s: string) => s.replace(/[\s\uFEFF]+/g, ' ').trim();

/**
 * Discovered category IDs from boss.az sitemap and listings.
 * Includes restaurant category 134 and all core industry sectors.
 */
export const BOSS_CATEGORY_IDS = [
  '66', '67', '68', '69', '70', '71', '72', // IT & Programming
  '44', '105', '108', '110', '112', '143', '113', '202', '204', // Admin & Management
  '49', '83', '86', '266', '267', '268', '269', '270', '271', '272', '273', // Sales & Customer Service
  '64', '61', '62', '60', '249', '250', '251', '248', '252', // Marketing & PR
  '91', '92', '93', '213', '214', '215', '216', '217', '218', '241', '243', '247', // Engineering & Construction
  '158', '135', '144', '203', '240', // Logistics & Transport
  '139', '140', '141', '275', '274', // Medical & Pharma
  '255', '259', '260', '261', '262', '263', '264', '265', // Finance & Procurement
  '134', '136', '137', '142', '145', '148', '149', // Restaurant, Hospitality & Tourism
  '36', '37', '38', '39', '40', '42', '43', '46', '48', '51', '52', '57', // General services
];

/** Only source-owned public vacancy/search/graphql URLs, never auth, profile, bookmarks or admin paths. */
export function bossUrl(input: string): string {
  const u = new URL(input, BOSS_ORIGIN);
  if (
    u.origin !== BOSS_ORIGIN ||
    u.username ||
    u.password ||
    /%2e|%2f|%5c/i.test(u.pathname) ||
    !(
      u.pathname === '/robots.txt' ||
      u.pathname === '/sitemap.xml' ||
      u.pathname === '/pages/sitemap' ||
      u.pathname === '/search/vacancies' ||
      u.pathname === '/graphql' ||
      /^\/vacancies\/[1-9]\d*$/.test(u.pathname)
    )
  ) {
    throw new Error('Unsupported public source URL');
  }

  if (u.pathname === '/search/vacancies') {
    const allowedParams = new Set(['sortBy', 'categoryIds', 'regionIds']);
    for (const key of u.searchParams.keys()) {
      if (!allowedParams.has(key)) throw new Error(`Unsupported search parameter: ${key}`);
    }
  } else {
    u.search = '';
  }
  u.hash = '';
  return u.href;
}

export interface BossGraphQLListing {
  urls: string[];
  ids: string[];
  totalCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
}

export function parseBossGraphQLResponse(json: any): BossGraphQLListing {
  if (!json || typeof json !== 'object') throw new Error('Invalid Boss.az GraphQL response: not an object');
  if (json.errors?.length) throw new Error(`Boss.az GraphQL error: ${json.errors[0]?.message}`);
  const vacancies = json.data?.vacancies;
  if (!vacancies || typeof vacancies !== 'object') throw new Error('Invalid Boss.az GraphQL response: missing vacancies');

  const urls: string[] = [];
  const ids: string[] = [];
  if (Array.isArray(vacancies.nodes)) {
    for (const node of vacancies.nodes) {
      if (node?.id && /^[1-9]\d*$/.test(String(node.id))) {
        const id = String(node.id);
        urls.push(bossUrl(`${BOSS_ORIGIN}/vacancies/${id}`));
        ids.push(id);
      }
    }
  }

  const totalCount = typeof vacancies.totalCount === 'number' ? vacancies.totalCount : urls.length;
  const hasNextPage = vacancies.pageInfo?.hasNextPage === true;
  const endCursor = typeof vacancies.pageInfo?.endCursor === 'string' ? vacancies.pageInfo.endCursor : null;

  return { urls, ids, totalCount, hasNextPage, endCursor };
}

/**
 * Strict, non-executing JSON/SSR data parser.
 * Replaces vm/eval/Function execution entirely.
 * Parses objects, arrays, strings, numbers, booleans, null, and undefined.
 * Fails closed upon encountering any function, expression, operator, or unknown token.
 */
export class SafeJsonParser {
  private pos = 0;

  constructor(private input: string) {}

  parse(): any {
    this.skipWhitespace();
    const result = this.parseValue();
    this.skipWhitespace();
    return result;
  }

  private skipWhitespace() {
    while (this.pos < this.input.length) {
      const ch = this.input.charCodeAt(this.pos);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
        this.pos++;
      } else {
        break;
      }
    }
  }

  private parseValue(): any {
    this.skipWhitespace();
    if (this.pos >= this.input.length) {
      throw new Error('Unexpected end of input in safe JSON parser');
    }

    const ch = this.input[this.pos];
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '"') return this.parseString();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber();

    if (this.input.startsWith('true', this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.input.startsWith('false', this.pos)) {
      this.pos += 5;
      return false;
    }
    if (this.input.startsWith('null', this.pos)) {
      this.pos += 4;
      return null;
    }
    if (this.input.startsWith('undefined', this.pos)) {
      this.pos += 9;
      return undefined;
    }

    throw new Error(`Executable or disallowed token in safe JSON parser at position ${this.pos}`);
  }

  private parseObject(): Record<string, any> {
    this.pos++; // skip '{'
    const obj: Record<string, any> = {};
    this.skipWhitespace();

    if (this.pos < this.input.length && this.input[this.pos] === '}') {
      this.pos++;
      return obj;
    }

    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.input[this.pos] !== '"') {
        throw new Error(`Expected quoted string key in object at position ${this.pos}`);
      }
      const key = this.parseString();
      this.skipWhitespace();
      if (this.input[this.pos] !== ':') {
        throw new Error(`Expected ':' after key in object at position ${this.pos}`);
      }
      this.pos++; // skip ':'
      const val = this.parseValue();
      obj[key] = val;
      this.skipWhitespace();
      if (this.input[this.pos] === ',') {
        this.pos++;
        continue;
      }
      if (this.input[this.pos] === '}') {
        this.pos++;
        return obj;
      }
      throw new Error(`Expected ',' or '}' in object at position ${this.pos}`);
    }
    throw new Error('Unterminated object in safe JSON parser');
  }

  private parseArray(): any[] {
    this.pos++; // skip '['
    const arr: any[] = [];
    this.skipWhitespace();

    if (this.pos < this.input.length && this.input[this.pos] === ']') {
      this.pos++;
      return arr;
    }

    while (this.pos < this.input.length) {
      const val = this.parseValue();
      arr.push(val);
      this.skipWhitespace();
      if (this.input[this.pos] === ',') {
        this.pos++;
        continue;
      }
      if (this.input[this.pos] === ']') {
        this.pos++;
        return arr;
      }
      throw new Error(`Expected ',' or ']' in array at position ${this.pos}`);
    }
    throw new Error('Unterminated array in safe JSON parser');
  }

  private parseString(): string {
    this.pos++; // skip opening '"'
    let start = this.pos;
    let out = '';
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === '"') {
        out += this.input.slice(start, this.pos);
        this.pos++; // skip closing '"'
        return out;
      }
      if (ch === '\\') {
        out += this.input.slice(start, this.pos);
        this.pos++; // skip '\'
        if (this.pos >= this.input.length) throw new Error('Unterminated escape in string');
        const esc = this.input[this.pos];
        if (esc === '"' || esc === '\\' || esc === '/') {
          out += esc;
          this.pos++;
        } else if (esc === 'b') {
          out += '\b';
          this.pos++;
        } else if (esc === 'f') {
          out += '\f';
          this.pos++;
        } else if (esc === 'n') {
          out += '\n';
          this.pos++;
        } else if (esc === 'r') {
          out += '\r';
          this.pos++;
        } else if (esc === 't') {
          out += '\t';
          this.pos++;
        } else if (esc === 'u') {
          this.pos++;
          const hex = this.input.slice(this.pos, this.pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(`Invalid unicode escape \\u${hex}`);
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 4;
        } else {
          out += esc;
          this.pos++;
        }
        start = this.pos;
        continue;
      }
      this.pos++;
    }
    throw new Error('Unterminated string in safe JSON parser');
  }

  private parseNumber(): number {
    const start = this.pos;
    if (this.input[this.pos] === '-') this.pos++;
    while (this.pos < this.input.length && this.input[this.pos] >= '0' && this.input[this.pos] <= '9') {
      this.pos++;
    }
    if (this.pos < this.input.length && this.input[this.pos] === '.') {
      this.pos++;
      while (this.pos < this.input.length && this.input[this.pos] >= '0' && this.input[this.pos] <= '9') {
        this.pos++;
      }
    }
    if (this.pos < this.input.length && (this.input[this.pos] === 'e' || this.input[this.pos] === 'E')) {
      this.pos++;
      if (this.pos < this.input.length && (this.input[this.pos] === '+' || this.input[this.pos] === '-')) {
        this.pos++;
      }
      while (this.pos < this.input.length && this.input[this.pos] >= '0' && this.input[this.pos] <= '9') {
        this.pos++;
      }
    }
    const numStr = this.input.slice(start, this.pos);
    const num = Number(numStr);
    if (!Number.isFinite(num)) throw new Error(`Invalid number: ${numStr}`);
    return num;
  }
}

/**
 * Extracts and non-executively parses Apollo SSR data payloads from script tags.
 */
export function extractBossApolloPayloads(html: string): any[] {
  const payloads: any[] = [];
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const content = match[1];
    if (!content.includes('ApolloSSRDataTransport')) continue;

    const pushRegex = /\.push\s*\(/g;
    let pushMatch: RegExpExecArray | null;
    while ((pushMatch = pushRegex.exec(content)) !== null) {
      const startIndex = pushRegex.lastIndex;
      try {
        const parser = new SafeJsonParser(content.slice(startIndex));
        const parsed = parser.parse();
        if (parsed && typeof parsed === 'object') {
          payloads.push(parsed);
        }
      } catch {
        // Safe non-executing parser failed closed on invalid or executable content
      }
    }
  }

  return payloads;
}

export function parseBossListing(
  html: string,
  currentUrl: string,
): { urls: string[]; categories?: string[]; next: string | null; totalCount?: number; hasNextPage?: boolean } {
  bossUrl(currentUrl);
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  const discoveredCategories = new Set<string>();

  // Extract from vacancy links in HTML
  $('a[href^="/vacancies/"], a[href^="https://boss.az/vacancies/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && /^\/vacancies\/[1-9]\d*$/.test(new URL(href, BOSS_ORIGIN).pathname)) {
      try {
        urls.add(bossUrl(href));
      } catch {}
    }
  });

  // Extract category links from HTML
  $('a[href*="/search/vacancies?categoryIds="]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      const catMatch = /categoryIds=([0-9]+)/.exec(href);
      if (catMatch) discoveredCategories.add(catMatch[1]);
    }
  });

  // Also extract from ApolloSSRDataTransport non-executively
  let totalCount: number | undefined;
  let hasNextPage = false;
  for (const payload of extractBossApolloPayloads(html)) {
    const rehydrate = payload?.rehydrate || {};
    for (const k of Object.keys(rehydrate)) {
      const vacancies = rehydrate[k]?.data?.vacancies;
      // The page's own statement of how many vacancies this listing holds, and whether more exist beyond the first page.
      if (vacancies && Number.isInteger(vacancies.totalCount) && Array.isArray(vacancies.nodes)) {
        totalCount = vacancies.totalCount;
        hasNextPage = vacancies.pageInfo?.hasNextPage === true;
      }
      if (vacancies?.nodes && Array.isArray(vacancies.nodes)) {
        for (const node of vacancies.nodes) {
          if (node?.id && /^[1-9]\d*$/.test(String(node.id))) {
            urls.add(bossUrl(`${BOSS_ORIGIN}/vacancies/${node.id}`));
          }
        }
      }
    }
  }

  // A category the page itself says holds zero vacancies is an explicit empty listing. Anything else without entries
  // (a changed layout, a challenge or error page) is not evidence of anything and stays an error.
  const explicitlyEmpty = !urls.size && totalCount === 0 && !hasNextPage;
  if (!urls.size && !explicitlyEmpty) throw new Error('Listing has no recognizable vacancy entries');

  // Determine next page for multi-category pagination
  const current = new URL(currentUrl);
  let next: string | null = null;
  const currentCat = current.searchParams.get('categoryIds');

  const categories = [...new Set([...BOSS_CATEGORY_IDS, ...discoveredCategories])];

  if (!currentCat) {
    // From global search, advance to the first category
    next = bossUrl(`${BOSS_ORIGIN}/search/vacancies?sortBy=DATE&categoryIds=${categories[0]}`);
  } else {
    const idx = categories.indexOf(currentCat);
    if (idx >= 0 && idx < categories.length - 1) {
      next = bossUrl(`${BOSS_ORIGIN}/search/vacancies?sortBy=DATE&categoryIds=${categories[idx + 1]}`);
    }
  }

  return { urls: [...urls], categories: [...discoveredCategories], next, ...(totalCount !== undefined ? { totalCount } : {}), hasNextPage };
}

function extractBossApolloVacancy(html: string): Record<string, any> | null {
  for (const payload of extractBossApolloPayloads(html)) {
    const rehydrate = payload?.rehydrate || {};
    for (const k of Object.keys(rehydrate)) {
      if (rehydrate[k]?.data?.vacancy) {
        return rehydrate[k].data.vacancy;
      }
    }
  }
  return null;
}

function extractBossJobPosting($: cheerio.CheerioAPI): Record<string, any> | null {
  let found: Record<string, any> | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '{}');
      if (parsed['@type'] === 'JobPosting') found = parsed;
    } catch {}
  });
  return found;
}

export function parseBossDetail(html: string, url: string, fetchedAt: Date): IngestJobDto {
  const validatedUrl = bossUrl(url);
  const idMatch = /\/vacancies\/([1-9]\d*)$/.exec(new URL(validatedUrl).pathname);
  if (!idMatch) throw new Error('Invalid boss vacancy URL');
  const id = idMatch[1];

  const $ = cheerio.load(html);

  // 1. Extract from ApolloSSRDataTransport via safe non-executing parser
  const vacancy = extractBossApolloVacancy(html);

  // 2. Try JSON-LD JobPosting as fallback/supplement
  const jobPosting = extractBossJobPosting($);

  const title = clean(vacancy?.positionName || jobPosting?.title || $('h1').first().text());
  const company = clean(
    vacancy?.name ||
      jobPosting?.hiringOrganization?.name ||
      $('a[href*="/companies/"]').first().text() ||
      $('.company-title').first().text(),
  );

  // Reject explicitly foreign-only vacancies
  const rawLoc = vacancy?.location || jobPosting?.jobLocation;
  const location = validateAzerbaijanLocation(rawLoc, 'Bakı');

  // Build complete structured description
  const descParts: string[] = [];
  if (vacancy?.description) descParts.push(vacancy.description);
  if (vacancy?.responsibilities) descParts.push(`<h3>Öhdəliklər</h3>\n${vacancy.responsibilities}`);
  if (vacancy?.requirements) descParts.push(`<h3>Tələblər</h3>\n${vacancy.requirements}`);

  const rawHtml = descParts.join('\n\n') || jobPosting?.description || $('body').html() || '';
  const $desc = cheerio.load(rawHtml);
  $desc('script,style,form,button,iframe').remove();
  $desc('br').replaceWith('\n');
  $desc('p,li,h1,h2,h3,h4').each((_, el) => {
    $desc(el).append('\n');
  });
  const description = $desc.text().replace(/\uFEFF/g, '').split('\n').map(clean).filter(Boolean).join('\n');

  // Strict datePosted / approvedAt validation: must have genuine source evidence
  const rawDate = vacancy?.approvedAt || jobPosting?.datePosted;
  if (!rawDate) {
    throw new Error('Missing approvedAt/datePosted evidence');
  }
  const postedAt = parseStrictIsoDate(String(rawDate));
  if (!postedAt) {
    throw new Error(`Malformed or invalid approvedAt/datePosted: ${rawDate}`);
  }

  // Strict deadline validation: if supplied, must be valid calendar date
  const rawDeadline = jobPosting?.validThrough || vacancy?.deadline || vacancy?.expireDate || vacancy?.finishDate;
  let deadline: string | undefined = undefined;
  if (rawDeadline !== undefined && rawDeadline !== null && clean(String(rawDeadline)) !== '') {
    // A date-only deadline is open through the END of that day in Baku (UTC+4); zone-less times are Baku local.
    deadline = bakuInstant(String(rawDeadline), 'end');
    if (!deadline) {
      throw new Error(`Malformed or invalid deadline: ${rawDeadline}`);
    }
  }

  // Source-backed closed/expired status handling
  const isSourceExpired =
    vacancy?.status === 'expired' ||
    vacancy?.status === 'archived' ||
    vacancy?.status === 'closed' ||
    vacancy?.isExpired === true ||
    vacancy?.daysLeft === 0;

  if (isSourceExpired && !deadline) {
    deadline = postedAt; // Recorded as expired in the past based on source evidence
  }

  if (
    !title ||
    title.length > 500 ||
    !company ||
    company.length > 256 ||
    !description ||
    description.length > MAX_JOB_DESCRIPTION_CHARS ||
    !postedAt
  ) {
    throw new Error('Incomplete or invalid Boss.az vacancy detail');
  }

  const externalId = `boss:${id}`;
  if (externalId.length > 256) throw new Error('Invalid vacancy identifier');

  const email = vacancy?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vacancy.email) ? vacancy.email : null;

  return {
    externalId,
    title,
    company,
    description,
    location,
    url: validatedUrl,
    postedAt,
    ...(deadline ? { deadline } : {}),
    detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: {
      source: 'boss',
      status: vacancy?.status || 'approved',
      email,
      phones: Array.isArray(vacancy?.phones) ? vacancy.phones : [],
      category: vacancy?.category?.name || null,
      education: vacancy?.education || null,
      experience: vacancy?.experience || null,
    },
  };
}
