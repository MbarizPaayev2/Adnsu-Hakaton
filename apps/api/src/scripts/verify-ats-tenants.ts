/**
 * Read-only: re-checks that each ATS tenant AISE has a collector for is still linked from its employer's OFFICIAL page. One robots.txt read and one
 * page read per tenant, 2 s apart, never an import, never a write. A tenant that is no longer linked (or whose official page cannot be read) is
 * reported as such — it is a reason to look, not a reason to delete anything automatically.
 */
import { EMPLOYER_TARGETS } from '../scrapers/public-jobs/employer-registry';
import { collectorTenants, officialPageLinksToTenant } from '../scrapers/public-jobs/ats-tenants';
import { robotsAllows } from '../scrapers/public-jobs/public-job-collector';
import { careerCandidates, readAuditPage } from './audit-employer-sources';

/** The employer's own page that should carry the link: the one named in the recorded evidence, else its website. */
export function officialPageFor(tenant: { employerId: string | null; evidence: string | null }): string | null {
  const fromEvidence = /Official site (https:\/\/[^\s]+?)(?:\s|$)/i.exec(tenant.evidence ?? '')?.[1];
  if (fromEvidence) return fromEvidence;
  return EMPLOYER_TARGETS.find((e) => e.id === tenant.employerId)?.websiteCandidate ?? null;
}

const hostsOf = (url: URL) => new Set([url.hostname, url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`]);

/** One polite, robots-checked page read; null when the page is not allowed or cannot be read. */
async function readIfAllowed(input: string): Promise<{ html: string; url: string } | null> {
  const url = new URL(input);
  const hosts = hostsOf(url);
  const robots = await readAuditPage(`${url.origin}/robots.txt`, hosts);
  const allowed = robots.status === 404 || robots.status === 410 || (robots.status === 200 && !robots.error && (() => { try { return robotsAllows(robots.html, url.pathname + url.search); } catch { return false; } })());
  if (!allowed) return null;
  await new Promise((r) => setTimeout(r, 2000));
  const page = await readAuditPage(input, hosts);
  return page.status === 200 && !page.error ? { html: page.html, url: page.url } : null;
}

async function main() {
  if (process.argv.slice(2).length) throw new Error('This check takes no arguments');
  const rows = [];
  for (const tenant of collectorTenants()) {
    const official = officialPageFor(tenant);
    const base = { source: tenant.source, vendor: tenant.vendor, tenant: tenant.entryUrl, officialPage: official, checkedAt: new Date().toISOString() };
    if (!official) { rows.push({ ...base, result: 'no-official-page-recorded' }); continue; }
    const first = await readIfAllowed(official);
    if (!first) { rows.push({ ...base, result: 'official-page-not-readable-or-not-allowed' }); continue; }
    if (officialPageLinksToTenant(first.html, first.url, tenant.entryUrl)) { rows.push({ ...base, result: 'linked' }); continue; }
    // Inspect official career links (up to four, each robots-checked), and up to three vacancy detail links if needed.
    let via: string | null = null;
    for (const next of careerCandidates(first.html, first.url).slice(0, 4)) {
      await new Promise((r) => setTimeout(r, 2000));
      const page = await readIfAllowed(next).catch(() => null);
      if (page) {
        if (officialPageLinksToTenant(page.html, page.url, tenant.entryUrl)) {
          via = next;
          break;
        }
        // 2-hop check: if the career page lists individual vacancies on the official site, inspect up to 3 detail links.
        const detailCandidates = careerCandidates(page.html, page.url).filter((d) => d !== next && d !== first.url).slice(0, 3);
        for (const detailUrl of detailCandidates) {
          await new Promise((r) => setTimeout(r, 2000));
          const detailPage = await readIfAllowed(detailUrl).catch(() => null);
          if (detailPage && officialPageLinksToTenant(detailPage.html, detailPage.url, tenant.entryUrl)) {
            via = `${next} -> ${detailUrl}`;
            break;
          }
        }
        if (via) break;
      }
    }
    rows.push({ ...base, result: via ? 'linked-via-official-career-page' : 'not-linked-within-two-hops', ...(via ? { via } : {}) });
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), purpose: 'verify-existing-tenants-not-import', rows }, null, 2));
}
if (require.main === module) main().catch(() => { console.error('Tenant check failed. Nothing was imported.'); process.exitCode = 1; });
