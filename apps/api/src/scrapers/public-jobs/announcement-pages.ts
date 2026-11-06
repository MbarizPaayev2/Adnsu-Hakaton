/**
 * Official employer announcement pages that state the application e-mail themselves.
 *
 *   ada     ADA University  https://www.ada.edu.az/en/jobs            list page + one detail page per vacancy ("TO APPLY: Email / Subject line / deadline")
 *   khazar  Khazar University  https://khazar.org/en/item/510        one page, newest announcement first ("submit their CV to … indication “…” / Application deadline")
 *
 * Both are the employer's own pages (robots.txt allows them for every crawler; reviewed 11 October 2026). Nothing here guesses: the application
 * address, subject and deadline come from the announcement's own words, and the address is read by the shared extractor (jobs/job-facts.ts) that
 * refuses contact, privacy and enquiry addresses and ambiguous blocks. A posting whose block has no deadline in the future, or no readable title, is not emitted.
 */
import * as cheerio from 'cheerio';
import * as https from 'node:https';
import { rootCertificates } from 'node:tls';
import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import type { CollectionOutcome } from '../../jobs/collection-outcome';
import { fetchPublicDocument, robotsAllows, type CollectionOptions } from './public-job-collector';

export type AnnouncementSource = 'ada' | 'khazar' | 'norm';

export const ANNOUNCEMENT_SOURCES: Record<AnnouncementSource, { origin: string; company: string; listPath: string; location: string; name: string }> = {
  ada: { origin: 'https://www.ada.edu.az', company: 'ADA University', listPath: '/en/jobs', location: 'Bakı', name: 'ADA University' },
  khazar: { origin: 'https://khazar.org', company: 'Khazar University', listPath: '/en/item/510', location: 'Bakı', name: 'Khazar University' },
  // NORM (cement and building materials): its own careers page lists every open vacancy with the application instruction and the deadline.
  norm: { origin: 'https://www.norm.az', company: 'NORM', listPath: '/page/careers', location: 'Azərbaycan', name: 'NORM' },
};

const clean = (text: string) => text.replace(/[\s ﻿]+/g, ' ').trim();
const BAKU_OFFSET_MS = 4 * 3600_000;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** End of the stated day in Baku time (UTC+4), as ISO. Null when the text is not one complete, valid calendar date. */
export function announcementDeadline(text: string): string | null {
  const t = clean(text).replace(/[.,;]+$/, '');
  let y: number, m: number, d: number;
  let match = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})$/.exec(t);
  if (match) { d = +match[1]; m = +match[2] - 1; y = match[3].length === 2 ? 2000 + +match[3] : +match[3]; } else {
    match = /^([A-Za-z]+)\s*(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/.exec(t);
    if (match) { m = MONTHS.indexOf(match[1].toLowerCase()); d = +match[2]; y = +match[3]; } else {
      match = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})$/.exec(t);
      if (!match) return null;
      d = +match[1]; m = MONTHS.indexOf(match[2].toLowerCase()); y = +match[3];
    }
  }
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 2020 || y > 2100) return null;
  const check = new Date(Date.UTC(y, m, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m || check.getUTCDate() !== d) return null;
  return new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - BAKU_OFFSET_MS).toISOString();
}

/**
 * These pages show no posting date. The value must not change from run to run (it is part of the content hash, and a changing value would make every
 * run look like an edit): thirty days before the deadline when that is already past, otherwise the first day of the current month in Baku.
 */
export function stablePostedAt(deadlineIso: string, fetchedAt: Date): string {
  const candidate = new Date(new Date(deadlineIso).getTime() - 30 * 86400_000);
  // Once now has passed deadline-30d the value is fixed for good; before that it moves at most once a month.
  if (candidate.getTime() <= fetchedAt.getTime()) return new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate())).toISOString();
  const baku = new Date(fetchedAt.getTime() + BAKU_OFFSET_MS);
  return new Date(Date.UTC(baku.getUTCFullYear(), baku.getUTCMonth(), 1) - BAKU_OFFSET_MS).toISOString();
}

/** Origin guard: only the employer's own host and the paths each adapter reads. */
export function announcementUrl(source: AnnouncementSource, input: string): string {
  if (/%2e|%2f|%5c|\.\./i.test(input)) throw new Error('Unsupported announcement URL');
  const cfg = ANNOUNCEMENT_SOURCES[source];
  const url = new URL(input, cfg.origin);
  if (url.hostname === new URL(cfg.origin).hostname.replace(/^www\./, '')) url.hostname = new URL(cfg.origin).hostname;
  if (url.origin !== cfg.origin || url.username || url.password) throw new Error('Unsupported announcement URL');
  url.hash = '';
  if (url.pathname === '/robots.txt') { if (url.search) throw new Error('Unsupported robots URL'); return url.href; }
  if (source === 'ada') {
    if (url.pathname === cfg.listPath && !url.search) return url.href;
    if (/^\/en\/jobs\/[1-9]\d*-[a-z0-9-]{1,200}$/.test(url.pathname) && !url.search) return url.href;
  } else if (source === 'norm') {
    if (url.pathname === cfg.listPath && !url.search) return url.href;
    if (/^\/vacancy\/[1-9]\d{3,20}$/.test(url.pathname) && !url.search) return url.href;
  } else if (url.pathname === cfg.listPath && [...url.searchParams.keys()].every((k) => k === 'vacancy')) {
    return url.href;
  }
  throw new Error(`Unsupported ${source} path: ${url.pathname}`);
}

// ── ADA University ──────────────────────────────────────────────────────────
export interface AdaEntry { id: string; url: string }

export function parseAdaListing(html: string): AdaEntry[] {
  const $ = cheerio.load(html);
  if (!/career at ada/i.test($('title').text() + ' ' + $('h1').text())) throw new Error('Unrecognized ADA career list layout');
  const seen = new Map<string, AdaEntry>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const m = /^(?:https:\/\/www\.ada\.edu\.az)?\/en\/jobs\/([1-9]\d*)-[a-z0-9-]+$/.exec(href);
    if (m && !seen.has(m[1])) seen.set(m[1], { id: m[1], url: announcementUrl('ada', href) });
  });
  return [...seen.values()];
}

export function parseAdaDetail(html: string, url: string, fetchedAt: Date): IngestJobDto | null {
  const id = /\/en\/jobs\/([1-9]\d*)-/.exec(new URL(announcementUrl('ada', url)).pathname)?.[1];
  if (!id) throw new Error('Missing ADA vacancy id');
  const $ = cheerio.load(html);
  const title = clean($('title').text().split('|')[0]);
  if (!title || /^career at ada$/i.test(title)) throw new Error('ADA detail page has no vacancy title');
  // The announcement sits between the breadcrumb and the side facts (CATEGORY / STATUS / CLOSING DATE).
  $('script, style, noscript, header, footer, nav').remove();
  const facts: Record<string, string> = {};
  $('h3.title').each((_, el) => {
    const label = clean($(el).text()).toUpperCase();
    const value = clean($(el).parent().next().text());
    if (label && value) facts[label] = value;
  });
  const closing = facts['CLOSING DATE'] ? announcementDeadline(facts['CLOSING DATE']) : null;
  // Block elements end a line; without this the page text runs "Email:" "address" "Subject line:" together.
  $('br').replaceWith('\n');
  $('p, li, h1, h2, h3, h4, h5, h6, div, tr, ul, ol, section').each((_, el) => { $(el).append('\n'); });
  const body = $('body').text().replace(/\u00a0/g, ' ');
  const start = body.search(new RegExp(`\\n\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n`, 'i'));
  const end = body.indexOf('CATEGORY', Math.max(start, 0));
  if (start < 0 || end < 0) throw new Error('Unrecognized ADA vacancy layout');
  const description = body.slice(start, end).split('\n').map((l) => clean(l)).filter(Boolean).join('\n').replace(/\nApply$/i, '').slice(0, MAX_JOB_DESCRIPTION_CHARS);
  if (description.length < 80) throw new Error('ADA vacancy text is too short to be a posting');
  if (!closing) return null; // no stated closing date: not an actionable announcement
  const cfg = ANNOUNCEMENT_SOURCES.ada;
  return {
    externalId: `ada:${id}`, title, company: cfg.company, description, location: cfg.location, url: announcementUrl('ada', url),
    postedAt: stablePostedAt(closing, fetchedAt), deadline: closing, detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: { category: facts['CATEGORY'] ?? null, status: facts['STATUS'] ?? null, closing: facts['CLOSING DATE'] },
  };
}

// ── Khazar University ───────────────────────────────────────────────────────
const SECTION_HEADINGS = /^(key responsibilities|responsibilities|qualifications( & experience)?|requirements( & qualifications)?|required (qualifications|knowledge|skills)[^:]*|position overview|how to apply:?|job description|full job description|minimum requirements:?|why join[^:]*|duties and responsibilities|application requirements:?|vacancy announcement:?|vacancy:?)$/i;
const DEADLINE_LINE = /^(?:application\s+)?deadline\s*(?:for applications)?\s*(?:is|:)\s*(.+)$/i;
const MAX_BLOCK_CHARS = 9000;

export interface KhazarBlock { title: string; description: string; deadline: string }

/** Announcements from the top of the page down; stops at the first block it cannot bound with a complete deadline date. */
export function parseKhazarBlocks(html: string): KhazarBlock[] {
  const $ = cheerio.load(html);
  const items: { text: string; heading: boolean }[] = [];
  $('p, li').each((_, el) => {
    const text = clean($(el).text());
    if (!text) return;
    const strong = $(el).children('strong, b');
    const heading = el.tagName === 'p' && strong.length > 0 && clean(strong.text()) === text && text.length < 200;
    items.push({ text: el.tagName === 'li' ? `• ${text}` : text, heading });
  });
  const start = items.findIndex((i) => /jobs and vacancies/i.test(i.text) === false && i.heading && !SECTION_HEADINGS.test(i.text) && !/^application deadline/i.test(i.text));
  if (start < 0) throw new Error('Unrecognized Khazar announcements layout');
  const blocks: KhazarBlock[] = [];
  let buffer: typeof items = [];
  let chars = 0;
  for (const item of items.slice(start)) {
    const m = DEADLINE_LINE.exec(item.text.replace(/^•\s*/, ''));
    const iso = m ? announcementDeadline(m[1]) : null;
    if (iso) {
      const title = buffer.find((b) => b.heading && !SECTION_HEADINGS.test(b.text))?.text;
      if (!title || buffer.length < 3) break;
      blocks.push({ title: title.replace(/^(?:vacancy announcement|job announcement|vacancy)\s*[:\-–]\s*/i, ''), description: buffer.map((b) => b.text).join('\n') + `\n${item.text}`, deadline: iso });
      buffer = [];
      chars = 0;
      continue;
    }
    chars += item.text.length;
    if (chars > MAX_BLOCK_CHARS) break;
    // Closing boilerplate of the previous announcement belongs to no title: drop lines until the next heading.
    if (!buffer.length && !item.heading) continue;
    buffer.push(item);
  }
  return blocks;
}

export function khazarPostings(html: string, fetchedAt: Date): { jobs: IngestJobDto[]; expired: number; seen: number } {
  const cfg = ANNOUNCEMENT_SOURCES.khazar;
  const blocks = parseKhazarBlocks(html);
  const jobs: IngestJobDto[] = [];
  let expired = 0;
  const used = new Set<string>();
  for (const b of blocks) {
    // Closed announcements are still stored (a past deadline makes them non-actionable): the run then shows evidence of work instead of "nothing".
    if (new Date(b.deadline).getTime() < fetchedAt.getTime()) expired++;
    const slug = b.title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'announcement';
    const key = `${slug}-${b.deadline.slice(0, 10)}`;
    if (used.has(key)) continue;
    used.add(key);
    jobs.push({
      externalId: `khazar:${key}`, title: b.title, company: cfg.company, description: b.description.slice(0, MAX_JOB_DESCRIPTION_CHARS), location: cfg.location,
      url: announcementUrl('khazar', `${cfg.origin}${cfg.listPath}?vacancy=${encodeURIComponent(key)}`), postedAt: stablePostedAt(b.deadline, fetchedAt), deadline: b.deadline,
      detailFetchedAt: fetchedAt.toISOString(), rawPayload: { page: `${cfg.origin}${cfg.listPath}` },
    });
  }
  return { jobs, expired, seen: blocks.length };
}

// ── NORM ────────────────────────────────────────────────────────────────────
/** Every vacancy sits in one accordion on the careers page: title, posting date, the full instruction, and its own "Müraciət et" link. */
export function normPostings(html: string, fetchedAt: Date): { jobs: IngestJobDto[]; expired: number; seen: number } {
  const $ = cheerio.load(html);
  if (!$('.accordion, .vacancies-accordion-item').length && !/vakansiya/i.test($('title').text() + ' ' + $('h1').text())) throw new Error('Unrecognized NORM careers layout');
  const cfg = ANNOUNCEMENT_SOURCES.norm;
  const jobs: IngestJobDto[] = [];
  let expired = 0;
  let seen = 0;
  $('.vacancies-accordion-item').each((_, el) => {
    seen++;
    const title = clean($(el).find('.accor-title h4, h4').first().text());
    const posted = clean($(el).find('.accor-title p').first().text());
    const link = $(el).find('a[href*="/vacancy/"]').first().attr('href') ?? '';
    const id = /\/vacancy\/([1-9]\d{3,20})\b/.exec(link)?.[1];
    if (!title || !id) return;
    const $detail = $(el).find('.detail-text').first().clone();
    // The source wraps its HTML mid-sentence: a line break inside a text node is a space, only block elements and <br> end a line.
    $detail.find('*').addBack().contents().each((__, node) => { if (node.type === 'text') (node as unknown as { data: string }).data = (node as unknown as { data: string }).data.replace(/\s*\n\s*/g, ' '); });
    $detail.find('br').replaceWith('\n');
    $detail.find('p, li, div, h1, h2, h3, h4, h5, h6, tr').each((__, node) => { $(node).append('\n'); });
    const description = $detail.text().replace(/\u00a0/g, ' ').split('\n').map((l) => clean(l)).filter(Boolean).join('\n').slice(0, MAX_JOB_DESCRIPTION_CHARS);
    if (description.length < 60) return;
    const dl = /son\s+tarix\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i.exec(description);
    const deadline = dl ? announcementDeadline(dl[1]) : null;
    const pm = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(posted);
    const postedIso = pm ? new Date(Date.UTC(+pm[3], +pm[2] - 1, +pm[1]) - BAKU_OFFSET_MS).toISOString() : null;
    if (!postedIso || new Date(postedIso).getTime() > fetchedAt.getTime()) return; // no readable, non-future posting date: not a usable announcement
    if (deadline && new Date(deadline).getTime() < fetchedAt.getTime()) expired++;
    jobs.push({
      externalId: `norm:${id}`, title, company: cfg.company, description, location: cfg.location, url: announcementUrl('norm', link),
      postedAt: postedIso, ...(deadline ? { deadline } : {}), detailFetchedAt: fetchedAt.toISOString(), rawPayload: { page: `${cfg.origin}${cfg.listPath}` },
    });
  });
  return { jobs, expired, seen };
}


// ── Transport for a host whose server sends the wrong intermediate certificate ───────────────────────────
/**
 * www.norm.az serves its leaf with an unrelated intermediate ("DigiCert SHA2 Secure Server CA"), so Node cannot build the chain that browsers repair
 * through the AIA field. The missing public intermediate is added here for that host only; the chain is still verified up to a trusted root and the
 * host name is still checked (nothing is disabled).
 *   subject  C=US, O=DigiCert Inc, CN=DigiCert Global G2 TLS RSA SHA256 2020 CA1   (issuer: DigiCert Global Root G2)
 *   sha256   C8:02:5F:9F:C6:5F:DF:C9:5B:3C:A8:CC:78:67:B9:A5:87:B5:27:79:73:95:79:17:46:3F:C8:13:D0:B6:25:A9   expires 29 March 2031
 *   source   http://cacerts.digicert.com/DigiCertGlobalG2TLSRSASHA2562020CA1-1.crt
 */
export const DIGICERT_GLOBAL_G2_TLS_RSA_SHA256_2020_CA1 = `-----BEGIN CERTIFICATE-----
MIIEyDCCA7CgAwIBAgIQDPW9BitWAvR6uFAsI8zwZjANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0yMTAzMzAwMDAwMDBaFw0zMTAzMjkyMzU5NTlaMFkxCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxMzAxBgNVBAMTKkRpZ2lDZXJ0IEdsb2Jh
bCBHMiBUTFMgUlNBIFNIQTI1NiAyMDIwIENBMTCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBAMz3EGJPprtjb+2QUlbFbSd7ehJWivH0+dbn4Y+9lavyYEEV
cNsSAPonCrVXOFt9slGTcZUOakGUWzUb+nv6u8W+JDD+Vu/E832X4xT1FE3LpxDy
FuqrIvAxIhFhaZAmunjZlx/jfWardUSVc8is/+9dCopZQ+GssjoP80j812s3wWPc
3kbW20X+fSP9kOhRBx5Ro1/tSUZUfyyIxfQTnJcVPAPooTncaQwywa8WV0yUR0J8
osicfebUTVSvQpmowQTCd5zWSOTOEeAqgJnwQ3DPP3Zr0UxJqyRewg2C/Uaoq2yT
zGJSQnWS+Jr6Xl6ysGHlHx+5fwmY6D36g39HaaECAwEAAaOCAYIwggF+MBIGA1Ud
EwEB/wQIMAYBAf8CAQAwHQYDVR0OBBYEFHSFgMBmx9833s+9KTeqAx2+7c0XMB8G
A1UdIwQYMBaAFE4iVCAYlebjbuYP+vq5Eu0GF485MA4GA1UdDwEB/wQEAwIBhjAd
BgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwdgYIKwYBBQUHAQEEajBoMCQG
CCsGAQUFBzABhhhodHRwOi8vb2NzcC5kaWdpY2VydC5jb20wQAYIKwYBBQUHMAKG
NGh0dHA6Ly9jYWNlcnRzLmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydEdsb2JhbFJvb3RH
Mi5jcnQwQgYDVR0fBDswOTA3oDWgM4YxaHR0cDovL2NybDMuZGlnaWNlcnQuY29t
L0RpZ2lDZXJ0R2xvYmFsUm9vdEcyLmNybDA9BgNVHSAENjA0MAsGCWCGSAGG/WwC
ATAHBgVngQwBATAIBgZngQwBAgEwCAYGZ4EMAQICMAgGBmeBDAECAzANBgkqhkiG
9w0BAQsFAAOCAQEAkPFwyyiXaZd8dP3A+iZ7U6utzWX9upwGnIrXWkOH7U1MVl+t
wcW1BSAuWdH/SvWgKtiwla3JLko716f2b4gp/DA/JIS7w7d7kwcsr4drdjPtAFVS
slme5LnQ89/nD/7d+MS5EHKBCQRfz5eeLjJ1js+aWNJXMX43AYGyZm0pGrFmCW3R
bpD0ufovARTFXFZkAdl9h6g4U5+LXUZtXMYnhIHUfoyMo5tS58aI7Dd8KvvwVVo4
chDYABPPTHPbqjc1qCmBaZx2vN4Ye5DUys/vZwP9BFohFrH/6j/f3IL16/RZkiMN
JCqVJUzKoZHm1Lesh3Sz8W2jmdv51b2EQJ8HmA==
-----END CERTIFICATE-----
`;

const USER_AGENT = 'AISEVacancyCollector/1.0 (+https://aisehr.com)';

/** One bounded GET (20 s, 2 MB, text only, up to 3 same-origin redirects) trusting the system roots plus one named intermediate. */
export function fetchWithIntermediate(source: AnnouncementSource, input: string, intermediatePem: string, redirects = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try { url = new URL(announcementUrl(source, input)); } catch (e) { reject(e); return; }
    const req = https.get(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain;q=0.9' }, ca: [...rootCertificates, intermediatePem], timeout: 20_000 }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 3) { reject(new Error('Too many redirects')); return; }
        fetchWithIntermediate(source, new URL(res.headers.location, url).href, intermediatePem, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) { res.resume(); reject(new Error(`HTTP ${status}`)); return; }
      if (!/^text\/(html|plain)/i.test(String(res.headers['content-type'] ?? ''))) { res.resume(); reject(new Error('Unsupported content type')); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > 2 * 1024 * 1024) { req.destroy(new Error('Response too large')); return; } chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

// ── Collector ───────────────────────────────────────────────────────────────
export class AnnouncementPagesCollector {
  constructor(
    private source: AnnouncementSource,
    private read: (url: string) => Promise<string> = source === 'norm'
      ? (url) => fetchWithIntermediate('norm', url, DIGICERT_GLOBAL_G2_TLS_RSA_SHA256_2020_CA1)
      : (url) => fetchPublicDocument(url, (u) => announcementUrl(source, u)),
    private pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private now: () => Date = () => new Date(),
  ) {}

  async collect(options: CollectionOptions, accept: (job: IngestJobDto) => Promise<void>) {
    if (
      !Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 200 ||
      !Number.isInteger(options.maxJobs) || options.maxJobs < 1 || options.maxJobs > 10_000 ||
      !Number.isInteger(options.delayMs) || options.delayMs < 1000 || options.delayMs > 60_000
    ) throw new Error('Invalid collection limits');
    const cfg = ANNOUNCEMENT_SOURCES[this.source];
    const report = { source: this.source, complete: false, outcome: undefined as CollectionOutcome | undefined, pages: 0, discovered: 0, fetched: 0, expired: 0, skipped: 0, failed: 0, accepted: 0, error: undefined as string | undefined };
    try {
      const robots = await this.read(`${cfg.origin}/robots.txt`);
      const get = async (url: string) => {
        const path = new URL(url).pathname;
        if (!robotsAllows(robots, path)) throw new Error(`${cfg.name} crawler rules prohibit: ${path}`);
        await this.pause(options.delayMs);
        return this.read(url);
      };
      const listHtml = await get(`${cfg.origin}${cfg.listPath}`);
      report.pages = 1;
      const fetchedAt = this.now();

      if (this.source === 'khazar' || this.source === 'norm') {
        const { jobs, expired, seen } = this.source === 'khazar' ? khazarPostings(listHtml, fetchedAt) : normPostings(listHtml, fetchedAt);
        report.discovered = seen;
        report.fetched = 1;
        report.expired = expired;
        report.failed = this.source === 'norm' ? Math.max(0, seen - jobs.length) : 0;
        for (const job of jobs.slice(0, options.maxJobs)) { await accept(job); report.accepted++; }
        if (seen === 0 && this.source === 'khazar') {
          report.outcome = 'UPSTREAM_FAILURE';
          report.error = 'No Khazar University announcement could be read; the page layout may have changed';
          return report;
        }
        // NORM lists every open vacancy on one page, so a complete read may close what is gone. Khazar is an archive page: absence closes nothing
        // (a past deadline makes a posting non-actionable); the run is healthy and simply "partial".
        report.complete = this.source === 'norm' && report.failed === 0 && jobs.length <= options.maxJobs;
        report.outcome = this.source === 'khazar' ? 'BOUNDED_PROGRESS' : report.failed
          ? 'INVALID_DETAIL' : report.discovered === 0 ? 'NO_OPENINGS' : 'COMPLETE_CENSUS';
        if (this.source === 'norm' && report.failed > 0) report.error = 'Some NORM vacancy blocks could not be parsed; no closures inferred';
        return report;
      }

      const entries = parseAdaListing(listHtml);
      report.discovered = entries.length;
      for (const entry of entries.slice(0, options.maxJobs)) {
        let html: string;
        try { html = await get(entry.url); report.fetched++; } catch (err) {
          const reason = err instanceof Error ? err.message : `${cfg.name} detail request failed`;
          report.failed++;
          await options.onFailedDetail?.(`ada:${entry.id}`, reason);
          // A single removed detail page must not discard the other listings.
          // It remains a partial run, so absence cannot close any stored jobs.
          if (/\bHTTP 404\b/i.test(reason)) continue;
          report.outcome = 'UPSTREAM_FAILURE';
          report.error = reason;
          return report;
        }
        let job: IngestJobDto | null;
        try { job = parseAdaDetail(html, entry.url, this.now()); } catch (err) {
          report.failed++;
          await options.onFailedDetail?.(`ada:${entry.id}`, err instanceof Error ? err.message : 'Invalid ADA detail');
          continue;
        }
        if (!job) {
          report.skipped++; report.failed++;
          await options.onFailedDetail?.(`ada:${entry.id}`, 'No usable closing date in ADA detail');
          continue;
        }
        if (job.deadline && new Date(job.deadline).getTime() < this.now().getTime()) report.expired++; // stored, but not actionable
        await accept(job);
        report.accepted++;
      }
      report.complete = report.fetched === entries.length && report.failed === 0 && entries.length <= options.maxJobs;
      report.outcome = report.complete ? report.discovered === 0 ? 'NO_OPENINGS' : 'COMPLETE_CENSUS'
        : report.failed ? 'INVALID_DETAIL' : 'BOUNDED_PROGRESS';
      if (!report.complete) report.error = report.failed ? 'Some ADA vacancy pages could not be read; no closures inferred' : 'Collection limit reached; coverage may be incomplete';
    } catch (error) {
      report.outcome = 'UPSTREAM_FAILURE';
      report.error = error instanceof Error ? error.message : `${cfg.name} collection failed`;
    }
    return report;
  }
}
