/** Read-only 100-employer discovery. Reachability is never reported as a working collector. */
import * as cheerio from 'cheerio';
import { EMPLOYER_TARGETS, validateEmployerRegistry, type EmployerTarget } from '../scrapers/public-jobs/employer-registry';
import { robotsAllows } from '../scrapers/public-jobs/public-job-collector';

const UA = 'AISEVacancyCollector/1.0 (+https://aisehr.com)';
const MAX_BYTES = 1024 * 1024;

export function publicCandidate(input: string, base: string): string | null {
  try {
    const url = new URL(input, base);
    if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|\d)/i.test(url.hostname)) return null;
    if (/apply|subscribe|talentcommunity|login|register|sign.?in|\.pdf$|\/cv\b/i.test(url.pathname)) return null;
    url.search = ''; url.hash = ''; return url.href;
  } catch { return null; }
}

export function careerCandidates(html: string, base: string): string[] {
  const $ = cheerio.load(html), candidates = new Set<string>();
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href')!, text = $(element).text().trim();
    if (!/career|vacan|karyera|vakans|işə.?qəbul|iş imkan|\bjobs?\b/i.test(href + ' ' + text)) return;
    const url = publicCandidate(href, base); if (url) candidates.add(url);
  });
  return [...candidates].slice(0, 12);
}

export async function readAuditPage(input: string, hosts: Set<string>) {
  let url = new URL(input); url.hash = '';
  const signal = AbortSignal.timeout(12_000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, { signal, redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html,text/plain' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) return { status: response.status, url: url.href, html: '', error: 'redirect-without-location' };
      const next = new URL(location, url);
      if (next.protocol !== 'https:' || next.username || next.password || !hosts.has(next.hostname)) return { status: response.status, url: url.href, html: '', error: 'unreviewed-redirect' };
      url = next; continue;
    }
    if (!response.ok) { await response.body?.cancel(); return { status: response.status, url: url.href, html: '' }; }
    if (!/^text\/(html|plain)(?:;|$)/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); return { status: response.status, url: url.href, html: '', error: 'unexpected-content-type' }; }
    if (!response.body) return { status: response.status, url: url.href, html: '', error: 'empty-response' };
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) { await reader.cancel(); return { status: response.status, url: url.href, html: '', error: 'response-too-large' }; } chunks.push(value); }
    return { status: response.status, url: url.href, html: Buffer.concat(chunks).toString('utf8') };
  }
  return { status: null, url: url.href, html: '', error: 'too-many-redirects' };
}

export async function auditEmployer(row: EmployerTarget) {
  const entry = row.careerUrl || row.websiteCandidate, original = new URL(entry);
  const hosts = new Set([original.hostname, original.hostname.startsWith('www.') ? original.hostname.slice(4) : `www.${original.hostname}`]);
  const base = { employerId: row.id, name: row.name, sector: row.sector, checkedAt: new Date().toISOString(), entry, adapter: row.adapter, coverage: 'not-verified' };
  try {
    const robots = await readAuditPage(`${original.origin}/robots.txt`, hosts);
    let rules = 'unknown';
    if (robots.status === 404 || robots.status === 410) rules = 'not-published';
    else if (robots.status === 200 && !robots.error) {
      try { rules = robotsAllows(robots.html, original.pathname + original.search) ? 'allowed' : 'disallowed'; } catch { rules = 'unrecognized'; }
    }
    if (!['allowed', 'not-published'].includes(rules)) return { ...base, robotsStatus: robots.status, rules, status: 'access-needs-review', candidates: [] };
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const page = await readAuditPage(entry, hosts);
    if (page.status !== 200 || page.error) return { ...base, robotsStatus: robots.status, rules, httpStatus: page.status, status: page.error || 'http-unavailable', candidates: [] };
    const $ = cheerio.load(page.html);
    const title = $('title').text().replace(/\s+/g, ' ').trim().slice(0, 180);
    const challenge = /just a moment|access denied|checking your browser|attention required|verify you are human/i.test(title);
    return { ...base, robotsStatus: robots.status, rules, httpStatus: page.status, status: challenge ? 'challenge-page' : 'public-page-reachable', title,
      candidates: challenge ? [] : careerCandidates(page.html, page.url) };
  } catch { return { ...base, status: 'request-failed', candidates: [] }; }
}

export async function runEmployerAudit(entries: readonly EmployerTarget[] = EMPLOYER_TARGETS, concurrency = 4) {
  validateEmployerRegistry(entries);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Audit concurrency must be 1–4');
  const reports: Awaited<ReturnType<typeof auditEmployer>>[] = new Array(entries.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { for (;;) { const index = cursor++; if (index >= entries.length) return; reports[index] = await auditEmployer(entries[index]); } }));
  return reports;
}

async function main() {
  if (process.argv.slice(2).length) throw new Error('This audit takes no URLs or write flags');
  const reports = await runEmployerAudit();
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), targets: reports.length, purpose: 'public-source-discovery-not-import', reports }, null, 2));
}
if (require.main === module) main().catch(() => { console.error('Employer audit failed. No jobs were imported.'); process.exitCode = 1; });
