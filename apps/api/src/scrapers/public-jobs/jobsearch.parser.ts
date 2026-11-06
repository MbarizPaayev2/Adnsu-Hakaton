import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { validateAzerbaijanLocation } from './public-job-collector';
import { azMonthNumber, bakuInstant, inferDeadlineFromDayMonth, inferPublishedFromDayMonth } from './baku-time';
import { textWithBreaks } from './ejob.parser';

export const JOBSEARCH_ORIGIN = 'https://classic.jobsearch.az';
/** robots.txt for this host asks every crawler (`*`) for a 30 s crawl delay. It is enforced from the file itself; this is only the fallback floor. */
export const JOBSEARCH_MIN_DELAY_MS = 30_000;
const clean = (s: string) => s.replace(/[\s﻿]+/g, ' ').trim();
const norm = (s: string) => clean(s).toLowerCase();

export function jobsearchUrl(input: string): string {
  const u = new URL(input, JOBSEARCH_ORIGIN);
  if (u.origin !== JOBSEARCH_ORIGIN || u.username || u.password || /%2e|%2f|%5c/i.test(u.pathname) || !(u.pathname === '/robots.txt' || u.pathname === '/vacancies' || /^\/vacancies\/[a-z0-9-]+-\d+$/.test(u.pathname))) throw new Error('Unsupported public source URL');
  const hl = u.searchParams.get('hl'); u.search = hl && ['az', 'en', 'ru'].includes(hl) ? `?hl=${hl}` : ''; u.hash = '';
  return u.href;
}

export interface DayMonth { day: number; month: number }
export interface JobsearchListingEntry { id: string; url: string; title: string; company: string | null; published: DayMonth | null; deadline: DayMonth | null }

function dayMonth(text: string): DayMonth | null {
  const m = /^(\d{1,2})\s+([A-Za-zƏəÖöÜüĞğÇçŞşİı]+)$/.exec(clean(text));
  const month = m ? azMonthNumber(m[2]) : undefined;
  return m && month ? { day: Number(m[1]), month } : null;
}

/** The listing is a table of cards (`ul.vacancies__item[data-id]`): title, employer, "Published" and "Deadline" columns (day and month, no year). */
export function parseJobsearchListing(html: string): { entries: JobsearchListingEntry[] } {
  const $ = cheerio.load(html);
  const entries = new Map<string, JobsearchListingEntry>();
  $('ul.vacancies__item[data-id]').each((_, card) => {
    const id = $(card).attr('data-id') ?? '';
    const href = $(card).find('h2 a[href*="/vacancies/"]').first().attr('href');
    if (!/^\d+$/.test(id) || !href) return;
    try {
      const url = jobsearchUrl(href);
      if (!new URL(url).pathname.endsWith(`-${id}`)) return; // id and URL must agree
      const title = clean($(card).find('h2 a').first().text());
      const company = clean($(card).find('.vacancies__provided span').first().text()) || null;
      // Columns are positional (Published, Deadline). Anything other than exactly two cells is ambiguous, so neither date is trusted.
      const cells = $(card).children('li.d-none.d-lg-block').toArray().map((li) => dayMonth($(li).text()));
      const [published, deadline] = cells.length === 2 ? cells : [null, null];
      if (!title || entries.has(url)) return;
      entries.set(url, { id, url, title, company, published, deadline });
    } catch { /* card without a valid vacancy URL */ }
  });
  if (!entries.size) throw new Error('Listing has no recognizable vacancy entries');
  return { entries: [...entries.values()] };
}

/**
 * Detail page + the listing card it came from. The detail page has no publication date; the listing's "Published" column is the only evidence, so an
 * entry without it is rejected rather than stamped with the fetch time. Day/month values get the year that makes them a real, recent, non-future date.
 * Location and application e-mail are not on the page (the address is filled in by script), so neither is produced.
 */
export function parseJobsearchDetail(html: string, url: string, fetchedAt: Date, entry: JobsearchListingEntry): IngestJobDto {
  const validatedUrl = jobsearchUrl(url);
  const id = /-(\d+)$/.exec(new URL(validatedUrl).pathname)?.[1];
  if (!id || id !== entry.id) throw new Error('JobSearch listing entry does not match the detail URL');
  const $ = cheerio.load(html);
  const title = clean($('h1').first().text());
  const company = clean($('.vacancies__provided span').first().text()) || clean($('a[href*="/companies/"]').first().text()) || clean($('h2').first().text());
  if (norm(title) !== norm(entry.title)) throw new Error('JobSearch listing and detail titles disagree');
  if (entry.company && company && norm(company) !== norm(entry.company)) throw new Error('JobSearch listing and detail employers disagree');
  const description = textWithBreaks($, $('.vacancy__description').first());
  if (!entry.published) throw new Error('JobSearch listing gives no publication date');
  const postedAt = inferPublishedFromDayMonth(entry.published.day, entry.published.month, fetchedAt);
  if (!postedAt) throw new Error('JobSearch publication date is not a plausible recent date');
  let deadline: string | undefined;
  const detailDeadline = /\bDeadline\s+(\d{1,2})\s+([A-Za-zƏəÖöÜüĞğÇçŞşİı]+)\s+(\d{4})\b/.exec(textWithBreaks($, $('body')));
  if (detailDeadline) {
    const month = azMonthNumber(detailDeadline[2]);
    deadline = month ? bakuInstant(`${detailDeadline[3]}-${String(month).padStart(2, '0')}-${detailDeadline[1].padStart(2, '0')}`, 'end') : undefined;
    if (!deadline) throw new Error('Malformed JobSearch deadline');
  } else if (entry.deadline) {
    deadline = inferDeadlineFromDayMonth(entry.deadline.day, entry.deadline.month, postedAt);
  }
  if (!title || title.length > 500 || !company || company.length > 256 || !description || description.length > MAX_JOB_DESCRIPTION_CHARS) throw new Error('Incomplete or invalid JobSearch vacancy detail');
  return {
    externalId: `jobsearch:${id}`, title, company, description, location: validateAzerbaijanLocation(undefined, 'Azerbaijan'),
    url: validatedUrl, postedAt, ...(deadline ? { deadline } : {}), detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: { source: 'jobsearch', locationKnown: false, postedAtEvidence: 'listing_day_month_year_inferred', deadlineEvidence: detailDeadline ? 'detail_full_date' : entry.deadline ? 'listing_day_month_year_inferred' : null },
  };
}
