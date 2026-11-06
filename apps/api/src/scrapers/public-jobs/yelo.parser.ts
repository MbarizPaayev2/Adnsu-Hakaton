/**
 * Yelo Bank official career page parser.
 *
 * Source: https://www.yelo.az/az/about-bank/career/
 * Direct publisher: Yelo Bank OJSC (Azerbaijan)
 *
 * robots.txt at https://www.yelo.az/robots.txt (reviewed 2026-10-02):
 *   User-agent: *
 *   Disallow: /site/assets/files/passports/*
 *   Sitemap: https://www.yelo.az/sitemap.xml
 *
 * All public career paths (/az/about-bank/career/ and /az/about-bank/vacancies/)
 * are fully allowed by robots.txt.
 *
 * Access review: PUBLIC_LISTING — direct employer career portal, server-rendered HTML,
 * no authentication required, no CAPTCHA.
 */

import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { parseStrictIsoDate, validateAzerbaijanLocation } from './public-job-collector';

export const YELO_ORIGIN = 'https://www.yelo.az';
export const YELO_LIST_PATH = '/az/about-bank/career/';
export const YELO_DETAIL_PATH = '/az/about-bank/vacancies/';

const clean = (text: string) => text.replace(/[\s\uFEFF]+/g, ' ').trim();

/** Allowed Azerbaijan cities for location derivation from title/card. */
const KNOWN_AZ_CITIES = [
  'Bakı', 'Lənkəran', 'Gəncə', 'Sumqayıt', 'Mingəçevir', 'Şəki', 'Şirvan',
  'Naxçıvan', 'Quba', 'Xaçmaz', 'Bərdə', 'Zaqatala', 'İsmayıllı', 'Şamaxı',
  'Göyçay', 'Salyan', 'Cəlilabad', 'Masallı', 'Tovuz', 'Qazax', 'Şəmkir',
];

/** Validate and normalize a Yelo Bank public URL. */
export function yeloUrl(input: string): string {
  if (/%2e|%2f|%5c|\.\./i.test(input)) {
    throw new Error('Unsupported Yelo public URL');
  }
  const url = new URL(input, YELO_ORIGIN);
  if (url.hostname === 'yelo.az') url.hostname = 'www.yelo.az';
  if (url.origin !== YELO_ORIGIN || url.username || url.password) {
    throw new Error('Unsupported Yelo public URL');
  }
  url.hash = '';
  if (url.pathname === '/robots.txt') {
    if (url.search) throw new Error('Unsupported Yelo robots URL options');
    return url.href;
  }
  if (url.pathname === YELO_LIST_PATH) {
    if (url.search) throw new Error('Unsupported Yelo listing URL options');
    return url.href;
  }
  if (url.pathname === YELO_DETAIL_PATH) {
    const vacancy = url.searchParams.get('vacancy');
    if (!vacancy || [...url.searchParams.keys()].some((k) => k !== 'vacancy') || url.searchParams.getAll('vacancy').length > 1) {
      throw new Error('Unsupported Yelo detail URL options');
    }
    if (!/^[a-z0-9-]+-([1-9]\d*)$/.test(vacancy)) {
      throw new Error(`Invalid Yelo vacancy slug: ${vacancy}`);
    }
    return url.href;
  }
  throw new Error(`Unsupported Yelo URL path: ${url.pathname}`);
}

/**
 * Strict calendar date parser for Yelo Bank (DD-MM-YYYY format in UTC+4).
 * endOfDay=true gives Baku end-of-day (23:59:59.999 UTC+4 = 19:59:59.999Z).
 */
export function yeloDate(value: string, endOfDay = false): string {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid Yelo date format: ${value}`);
  const day = Number(match[1]);
  const month = Number(match[2]) - 1; // 0-11
  const year = Number(match[3]);

  // Calendar validation via UTC date object to detect rollover (e.g. 30-02-2026)
  const check = new Date(Date.UTC(year, month, day));
  if (
    year < 2020 || year > 2100 || month < 0 || month > 11 ||
    check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day
  ) {
    throw new Error(`Invalid Yelo calendar date: ${value}`);
  }

  // Double check with shared parseStrictIsoDate
  const isoCheck = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!parseStrictIsoDate(isoCheck)) {
    throw new Error(`Strict date validation failed for: ${value}`);
  }

  if (endOfDay) {
    // 23:59:59.999 in UTC+4 -> 19:59:59.999 UTC
    return new Date(Date.UTC(year, month, day, 19, 59, 59, 999)).toISOString();
  }
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0)).toISOString();
}

export interface YeloListingEntry {
  url: string;
  slug: string;
  id: string;
  cardTitle: string;
  cardLocation?: string;
}

/**
 * Parse the Yelo Bank career listing page (https://www.yelo.az/az/about-bank/career/).
 */
export function parseYeloListing(html: string): { entries: YeloListingEntry[]; total: number } {
  const $ = cheerio.load(html);

  // 1. Detect maintenance, error, or server-down pages immediately
  const titleText = $('title').text();
  const headingText = $('h1, h2').text();
  const combinedHeader = `${titleText} ${headingText}`.toLowerCase();
  if (/maintenance|təmir işləri|xəta|service unavailable|internal server error|\b50[023]\b/i.test(combinedHeader)) {
    throw new Error('Yelo career listing indicates maintenance or error page');
  }

  // 2. Require recognized career container or recognized career heading
  const container = $('.vacancies-list, .list_vacs, [class*="vacanc"], div.career-list, div.career_list');
  const hasCareerHeading = /karyera|vakansiya|career|yelo bank/i.test(combinedHeader);
  if (!container.length && !hasCareerHeading) {
    throw new Error('Unrecognized Yelo listing page layout: missing career container or heading');
  }

  const entries: YeloListingEntry[] = [];
  const seenIds = new Set<string>();

  const vacancyLinks = $('a[href*="vacancies/?vacancy="]');
  if (vacancyLinks.length === 0) {
    // Verified career page structure with zero vacancies
    return { entries: [], total: 0 };
  }

  vacancyLinks.each((_, el) => {
    const rawHref = $(el).attr('href');
    if (!rawHref) throw new Error('Missing href attribute on Yelo vacancy card');

    let validUrl: string;
    try {
      validUrl = yeloUrl(rawHref);
    } catch (e) {
      throw new Error(`Malformed Yelo vacancy link "${rawHref}": ${e instanceof Error ? e.message : e}`);
    }

    const u = new URL(validUrl);
    const slug = u.searchParams.get('vacancy');
    if (!slug) throw new Error(`Missing vacancy parameter in Yelo URL: ${validUrl}`);
    const idMatch = /-([1-9]\d*)$/.exec(slug);
    if (!idMatch) throw new Error(`Invalid Yelo vacancy slug: ${slug}`);
    const id = idMatch[1];

    if (seenIds.has(id)) return;
    seenIds.add(id);

    // Card text often contains: "Title City EmploymentType"
    const cardText = clean($(el).text());
    if (!cardText) throw new Error(`Empty card text in Yelo vacancy link for ID ${id}`);

    const lowerCard = cardText.toLocaleLowerCase('az');
    let cardLocation: string | undefined;
    for (const city of KNOWN_AZ_CITIES) {
      if (lowerCard.includes(city.toLocaleLowerCase('az'))) {
        cardLocation = city;
        break;
      }
    }

    entries.push({
      url: validUrl,
      slug,
      id,
      cardTitle: cardText,
      cardLocation,
    });
  });

  return { entries, total: entries.length };
}

/**
 * Parse a Yelo Bank vacancy detail page.
 */
export function parseYeloDetail(
  html: string,
  detailUrl: string,
  fetchedAt: Date,
  hintLocation?: string,
): IngestJobDto | null {
  const validatedUrl = yeloUrl(detailUrl);
  const u = new URL(validatedUrl);
  const slug = u.searchParams.get('vacancy')!;
  const idMatch = /-([1-9]\d*)$/.exec(slug);
  if (!idMatch) throw new Error('Missing numeric ID in Yelo detail URL');
  const id = idMatch[1];

  const $ = cheerio.load(html);

  // Title: primary heading
  const h1 = clean($('div.vac_top h1, h1').first().text());
  if (!h1 || h1.length > 500) throw new Error('Invalid or missing Yelo vacancy title');

  // Metadata container
  const container = $('div.text_content_career_vacancies, div.text_content');
  if (!container.length) throw new Error('Missing Yelo vacancy content container');

  // Dates
  const elanLi = container.find('li:contains("Elan tarixi:")').first();
  const sonLi = container.find('li:contains("Son Tarix:")').first();

  if (!elanLi.length) throw new Error('Missing Yelo Elan tarixi (posted date)');
  const rawElan = clean(elanLi.text().replace(/^.*?Elan tarixi:\s*/i, ''));
  const postedAt = yeloDate(rawElan, false);

  if (new Date(postedAt) > fetchedAt) return null; // Future date — skip

  let deadline: string | undefined;
  if (sonLi.length) {
    const rawSon = clean(sonLi.text().replace(/^.*?Son Tarix:\s*/i, ''));
    if (rawSon) {
      deadline = yeloDate(rawSon, true);
      if (new Date(deadline) < new Date(postedAt)) {
        throw new Error('Inverted Yelo date range: deadline before posted date');
      }
    }
  }

  // Category & Employment type
  const katLi = container.find('li:contains("Kateqoriya:")').first();
  const category = katLi.length ? clean(katLi.text().replace(/^.*?Kateqoriya:\s*/i, '')) : null;

  const novLi = container.find('li:contains("Vakansiya növü:")').first();
  const employmentType = novLi.length ? clean(novLi.text().replace(/^.*?Vakansiya növü:\s*/i, '')) : null;

  // Clean description: remove scripts, styles, forms
  const clone = container.clone();
  clone.find('script, style, iframe, form, button, input').remove();
  clone.find('br').replaceWith('\n');
  clone.find('p, li, h1, h2, h3, h4').append('\n');

  const rawDescription = clone.text().split('\n').map(clean).filter(Boolean).join('\n');
  if (!rawDescription || rawDescription.length > MAX_JOB_DESCRIPTION_CHARS) {
    throw new Error('Invalid Yelo vacancy description length');
  }

  // Location determination
  let location = 'Azerbaijan';
  if (hintLocation) {
    location = hintLocation;
  } else {
    const lowerH1 = h1.toLocaleLowerCase('az');
    for (const city of KNOWN_AZ_CITIES) {
      if (lowerH1.includes(city.toLocaleLowerCase('az'))) {
        location = city;
        break;
      }
    }
  }

  // Safety validate location
  try {
    location = validateAzerbaijanLocation(location, 'Azerbaijan');
  } catch {
    return null; // Foreign rejected
  }

  return {
    externalId: `yelo:${id}`,
    title: h1,
    company: 'Yelo Bank',
    description: rawDescription,
    location,
    url: validatedUrl,
    postedAt,
    ...(deadline ? { deadline } : {}),
    detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: {
      source: 'yelo',
      employer: 'yelo-bank',
      slug,
      category,
      employmentType,
      locationEvidence: location === 'Azerbaijan' ? 'country-default' : 'explicit-city-evidence',
      postingDateEvidence: 'yelo-official-elan-tarixi',
      deadlineEvidence: deadline ? 'yelo-official-son-tarix' : 'not-provided',
    },
  };
}
