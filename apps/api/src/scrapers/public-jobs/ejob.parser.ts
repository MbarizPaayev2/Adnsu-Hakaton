import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { validateAzerbaijanLocation } from './public-job-collector';
import { bakuInstant } from './baku-time';

export const EJOB_ORIGIN = 'https://ejob.az';
/** eJob's robots.txt asks AI crawlers for a 5 s crawl delay; we keep that as our own floor even though our user agent is not listed. */
export const EJOB_MIN_DELAY_MS = 5000;
const clean = (s: string) => s.replace(/[\s﻿]+/g, ' ').trim();
const norm = (s: string) => clean(s).toLowerCase();

/** Only source-owned public listing/detail URLs; never cabinet, message, upload or PDF paths. Query and fragment are dropped. */
export function ejobUrl(input: string): string {
  const u = new URL(input, EJOB_ORIGIN);
  if (u.origin !== EJOB_ORIGIN || u.username || u.password || /%2e|%2f|%5c/i.test(u.pathname) || !(
    u.pathname === '/robots.txt' || u.pathname === '/is-elanlari/' || /^\/is-elanlari\/page-\d{1,4}\/$/.test(u.pathname) || /^\/is-elani\/\d+-[a-z0-9-]+\/$/.test(u.pathname)
  )) throw new Error('Unsupported public source URL');
  u.search = ''; u.hash = '';
  return u.href;
}

/** Detail URLs and the next numbered page. Featured (VIP) entries repeat on every page; the collector de-duplicates them. */
export function parseEjobListing(html: string, currentUrl: string): { urls: string[]; next: string | null } {
  const current = ejobUrl(currentUrl);
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $('a[href*="/is-elani/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try { urls.add(ejobUrl(href)); } catch { /* not a vacancy URL */ }
  });
  if (!urls.size) throw new Error('Listing has no recognizable vacancy entries');
  const pageNo = /^\/is-elanlari\/page-(\d+)\/$/.exec(new URL(current).pathname)?.[1];
  const currentPage = pageNo ? Number(pageNo) : 1;
  const later = new Set<number>();
  $('a[href*="/is-elanlari/page-"]').each((_, el) => {
    const href = $(el).attr('href'); if (!href) return;
    try {
      const m = /^\/is-elanlari\/page-(\d+)\/$/.exec(new URL(ejobUrl(href)).pathname);
      if (m && Number(m[1]) > currentPage) later.add(Number(m[1]));
    } catch { /* not a page link */ }
  });
  const nextPage = [...later].sort((a, b) => a - b)[0];
  return { urls: [...urls], next: nextPage ? `${EJOB_ORIGIN}/is-elanlari/page-${nextPage}/` : null };
}

/** Text of the document with line breaks kept at block boundaries and <br>, so bullet lists stay readable. */
export function textWithBreaks($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>): string {
  const copy = cheerio.load(`<div id="r">${root.html() ?? ''}</div>`);
  copy('script,style,iframe,form,button,noscript').remove();
  copy('br').replaceWith('\n');
  copy('p,div,li,tr,h1,h2,h3,h4,h5,table,ul,ol').each((_, el) => { copy(el).append('\n'); });
  return copy('#r').text().replace(/﻿/g, '').replace(/[ \t ]+/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

/** eJob writes HTML entities (e.g. `&quot;`) inside its JSON-LD strings; JSON parsing does not decode them, the visible page does. */
const decodeEntities = (value: string) => cheerio.load(`<i>${value}</i>`, null, false).text();

function jobPosting($: cheerio.CheerioAPI): Record<string, any> | null {
  let found: Record<string, any> | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '{}');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const item = items.find((x) => x?.['@type'] === 'JobPosting');
      if (item) found = item;
    } catch { /* malformed block: ignored, not trusted */ }
  });
  return found;
}

export function parseEjobDetail(html: string, url: string, fetchedAt: Date): IngestJobDto {
  const validatedUrl = ejobUrl(url);
  const id = /^\/is-elani\/(\d+)-/.exec(new URL(validatedUrl).pathname)?.[1];
  if (!id) throw new Error('Missing eJob vacancy id');
  const $ = cheerio.load(html);
  const ld = jobPosting($);
  const domTitle = clean($('h1.position, h1').first().text());
  const domCompany = clean($('a[href^="/company/"] .name, a[href*="/company/"] .name').first().text());
  const ldTitle = ld?.title ? decodeEntities(String(ld.title)) : '';
  const ldCompany = ld?.hiringOrganization?.name ? decodeEntities(String(ld.hiringOrganization.name)) : '';
  const title = clean(ldTitle || domTitle);
  const company = clean(ldCompany || domCompany);
  // Structured data and the visible page must describe the same posting; a disagreement means a changed or mixed layout.
  if (domTitle && ldTitle && norm(domTitle) !== norm(ldTitle)) throw new Error('eJob structured data and page title disagree');
  if (domCompany && ldCompany && norm(domCompany) !== norm(ldCompany)) throw new Error('eJob structured data and page employer disagree');
  if (ld?.identifier?.value !== undefined && String(ld.identifier.value) !== id) throw new Error('eJob structured data identifier does not match the URL');

  const body = textWithBreaks($, $('body'));
  const cell = (label: string) => { const m = new RegExp(`^${label}\\s*:\\s*(.+)$`, 'm').exec(body); return m ? clean(m[1]) : null; };
  const cityText = cell('Şəhər');
  const location = ld?.jobLocation ? validateAzerbaijanLocation(ld.jobLocation, 'Azerbaijan') : validateAzerbaijanLocation(cityText || undefined, 'Azerbaijan');
  const locationKnown = Boolean(ld?.jobLocation || cityText);

  const startMarker = body.indexOf('İş barədə məlumat:');
  const endMarker = body.search(/^Əlavə olunub\s*:/m);
  if (startMarker < 0 || endMarker < startMarker) throw new Error('eJob vacancy text not found');
  const description = body.slice(startMarker + 'İş barədə məlumat:'.length, endMarker).split('\n').map(clean).filter(Boolean).join('\n');

  const postedText = ld?.datePosted ? String(ld.datePosted) : cell('Əlavə olunub');
  const postedAt = bakuInstant(postedText, 'start');
  let deadline: string | undefined;
  if (ld?.validThrough !== undefined && ld.validThrough !== null && clean(String(ld.validThrough)) !== '') {
    deadline = bakuInstant(String(ld.validThrough), 'end');
    if (!deadline) throw new Error(`Malformed eJob deadline: ${ld.validThrough}`);
  }
  if (!title || title.length > 500 || !company || company.length > 256 || !description || description.length > MAX_JOB_DESCRIPTION_CHARS || !postedAt) {
    throw new Error('Incomplete or invalid eJob vacancy detail');
  }
  const salary = ld?.baseSalary?.value ? `${ld.baseSalary.value.minValue ?? ''}-${ld.baseSalary.value.maxValue ?? ''} ${ld.baseSalary.currency ?? ''}`.trim() : cell('Əmək haqqı');
  return {
    externalId: `ejob:${id}`, title, company, description, location,
    url: validatedUrl, postedAt, ...(deadline ? { deadline } : {}), detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: {
      source: 'ejob', employmentType: Array.isArray(ld?.employmentType) ? ld.employmentType.join(', ') : ld?.employmentType ?? null, salary: salary || null,
      locationKnown, datesFrom: ld?.datePosted ? 'jsonld' : 'page', deadlineMeaning: deadline ? 'source_valid_through' : null,
    },
  };
}
