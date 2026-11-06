import * as cheerio from 'cheerio';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';

/**
 * Employer career sites hosted on Teamtailor, each verified by a link from the employer's own official website.
 * Only the public RSS feed (`/jobs.rss`, allowed by the site's robots.txt) is read: one request lists every open posting
 * with its full text. Nothing is executed, no candidate or application endpoint is touched.
 */
export const TEAMTAILOR_TENANTS = {
  'pasha-insurance': {
    origin: 'https://career.pasha-insurance.az',
    company: 'PASHA Insurance',
    verified: '2026-10-02',
    evidence: 'Official site https://pasha-insurance.az/az links to https://career.pasha-insurance.az/jobs (a Teamtailor career site); public feed /jobs.rss; robots.txt disallows only app/messenger/internal paths',
  },
} as const;
export type TeamtailorTenant = keyof typeof TEAMTAILOR_TENANTS;

const clean = (text: string) => text.replace(/[\s﻿]+/g, ' ').trim();

export function teamtailorUrl(tenant: TeamtailorTenant, input: string): string {
  const { origin } = TEAMTAILOR_TENANTS[tenant];
  const url = new URL(input, origin);
  if (url.origin !== origin) throw new Error('Unsupported Teamtailor URL: wrong origin');
  if (url.username || url.password || url.hash || url.search) throw new Error('Unsupported Teamtailor URL: credentials, query or fragment');
  if (/%2e|%2f|%5c/i.test(url.pathname)) throw new Error('Unsupported Teamtailor URL: path traversal');
  const allowed = url.pathname === '/robots.txt' || url.pathname === '/jobs.rss' || /^\/jobs\/\d{4,12}-[a-z0-9-]{1,200}$/.test(url.pathname);
  if (!allowed) throw new Error('Unsupported Teamtailor URL: path');
  return url.href;
}

export interface TeamtailorFeed { jobs: IngestJobDto[]; discovered: number; skipped: number; failed: number }

/** Strictly validates the feed: anything that is not the tenant's own RSS is an error, never "zero jobs". */
export function parseTeamtailorFeed(tenant: TeamtailorTenant, xml: string, fetchedAt: Date): TeamtailorFeed {
  const config = TEAMTAILOR_TENANTS[tenant];
  const $ = cheerio.load(xml, { xmlMode: true });
  const channel = $('rss > channel').first();
  if (!channel.length || $('rss').attr('version') !== '2.0') throw new Error('Unrecognized Teamtailor feed');
  const channelLink = clean(channel.children('link').first().text());
  if (!channelLink || new URL(channelLink).origin !== config.origin) throw new Error('Teamtailor feed does not belong to the verified tenant');

  const result: TeamtailorFeed = { jobs: [], discovered: 0, skipped: 0, failed: 0 };
  const seen = new Set<string>();
  channel.children('item').each((_, element) => {
    result.discovered++;
    const item = $(element);
    try {
      const link = teamtailorUrl(tenant, clean(item.children('link').first().text()));
      const id = /^\/jobs\/(\d{4,12})-/.exec(new URL(link).pathname)?.[1];
      if (!id || seen.has(id)) throw new Error('Missing or repeated posting id');
      seen.add(id);
      const title = clean(item.children('title').first().text());
      const html = item.children('description').first().text();
      const text = cheerio.load(`<div>${html}</div>`);
      text('script,style,iframe,form,input,button').remove();
      text('br').replaceWith('\n');
      text('p,li,h1,h2,h3,h4,ul,ol').append('\n');
      const description = text('div').text().split('\n').map(clean).filter(Boolean).join('\n');
      const posted = new Date(clean(item.children('pubDate').first().text()));
      if (!title || title.length > 500 || !description || description.length > MAX_JOB_DESCRIPTION_CHARS || Number.isNaN(posted.getTime())) throw new Error('Incomplete posting');
      if (posted.getTime() > fetchedAt.getTime() + 86_400_000) throw new Error('Implausible posting date');

      // Azerbaijan must be stated by the source; a posting without it is out of scope, not guessed.
      const locations = item.children().filter((__, e) => e.tagName.endsWith('locations')).first().children().filter((__, e) => e.tagName.endsWith('location')).toArray()
        .map((loc) => ({ name: clean($(loc).children().filter((___, e) => e.tagName.endsWith(':name')).text()), city: clean($(loc).children().filter((___, e) => e.tagName.endsWith(':city')).text()), country: clean($(loc).children().filter((___, e) => e.tagName.endsWith(':country')).text()) }));
      const azerbaijani = locations.find((l) => /^azerbaijan$/i.test(l.country));
      if (!azerbaijani) { result.skipped++; return; }
      const location = azerbaijani.name || azerbaijani.city;
      if (!location || location.length > 256) throw new Error('Invalid location');
      const remote = clean(item.children('remoteStatus').first().text()).toLowerCase();
      result.jobs.push({
        externalId: `${tenant}:${id}`, title, company: config.company, description, location, url: link, postedAt: posted.toISOString(), detailFetchedAt: fetchedAt.toISOString(),
        rawPayload: { source: tenant, platform: 'teamtailor', ...(remote === 'fully' || remote === 'remote' ? { isRemote: true } : {}) },
      });
    } catch {
      result.failed++;
    }
  });
  return result;
}
