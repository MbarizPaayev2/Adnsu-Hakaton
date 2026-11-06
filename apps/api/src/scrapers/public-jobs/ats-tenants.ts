import * as cheerio from 'cheerio';
import { EMPLOYER_TARGETS } from './employer-registry';
import { SAP_SOURCES } from './sap-careers.collector';
import { WORKABLE_TENANTS } from './workable.parser';
import { TEAMTAILOR_TENANTS } from './teamtailor.parser';
import { LEVER_TENANTS } from './lever.parser';
import { WORKDAY_TENANTS } from './workday.collector';
import { GREENHOUSE_TENANTS } from './greenhouse.parser';

/**
 * Employer-verified applicant-tracking-system (ATS) tenants.
 *
 * A tenant counts as the employer's own only when the employer's OFFICIAL site links to it: guessing a slug (accessbank on Workable turned out to be a
 * Nigerian bank; azerconnect's portal is Oracle, not Workable) is how wrong companies get imported. This module is the one place that
 *   - recognises ATS vendors in links found on an official career page (so a new lead is found, not guessed),
 *   - states what "the official page links to this tenant" means, and
 *   - lists every tenant a collector exists for, so a test can prove each one is tied to a verified official employer entry.
 * Detecting a vendor never registers anything: a collector, a source row and a review are still needed.
 */
export type AtsVendor = 'workable' | 'teamtailor' | 'sap-successfactors' | 'greenhouse' | 'lever' | 'recruitee' | 'smartrecruiters' | 'bamboohr' | 'workday' | 'oracle-cloud';

/** Vendors for which a reviewed collector exists in this repository. */
export const VENDORS_WITH_COLLECTOR: readonly AtsVendor[] = ['workable', 'teamtailor', 'sap-successfactors', 'lever', 'workday', 'greenhouse'];

export interface AtsLink { vendor: AtsVendor; tenant: string; url: string; collector: boolean }

const RULES: { vendor: AtsVendor; match: (u: URL) => string | null }[] = [
  { vendor: 'workable', match: (u) => (u.hostname === 'apply.workable.com' ? u.pathname.split('/')[1] || null : /^([a-z0-9-]+)\.workable\.com$/.exec(u.hostname)?.[1] ?? null) },
  { vendor: 'teamtailor', match: (u) => (/\.teamtailor\.com$/.test(u.hostname) ? u.hostname : /^career\./.test(u.hostname) && /^\/(jobs|en\/jobs)(\/|$)/.test(u.pathname) ? null : null) },
  { vendor: 'greenhouse', match: (u) => (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(u.hostname) ? u.pathname.split('/')[1] || null : null) },
  { vendor: 'lever', match: (u) => (u.hostname === 'jobs.lever.co' ? u.pathname.split('/')[1] || null : null) },
  { vendor: 'recruitee', match: (u) => /^([a-z0-9-]+)\.recruitee\.com$/.exec(u.hostname)?.[1] ?? null },
  { vendor: 'smartrecruiters', match: (u) => (['jobs.smartrecruiters.com', 'careers.smartrecruiters.com'].includes(u.hostname) ? u.pathname.split('/')[1] || null : null) },
  { vendor: 'bamboohr', match: (u) => /^([a-z0-9-]+)\.bamboohr\.com$/.exec(u.hostname)?.[1] ?? null },
  { vendor: 'workday', match: (u) => (/\.myworkdayjobs\.com$/.test(u.hostname) ? u.hostname : null) },
  { vendor: 'oracle-cloud', match: (u) => (/\.oraclecloud\.com$/.test(u.hostname) && /hcmUI|CandidateExperience/i.test(u.pathname) ? u.hostname : null) },
  { vendor: 'sap-successfactors', match: (u) => (/\.(successfactors|sapsf)\.(com|eu)$/.test(u.hostname) ? u.hostname : null) },
];

/** ATS links on an official career page. Only https links; fragments, queries and credentials never count. */
export function detectAtsLinks(html: string, base: string): AtsLink[] {
  const found = new Map<string, AtsLink>();
  const $ = cheerio.load(html);
  $('a[href]').each((_, el) => {
    let url: URL;
    try { url = new URL($(el).attr('href')!, base); } catch { return; }
    if (url.protocol !== 'https:' || url.username || url.password) return;
    for (const rule of RULES) {
      const tenant = rule.match(url);
      if (!tenant) continue;
      const key = `${rule.vendor}:${tenant}`;
      if (!found.has(key)) found.set(key, { vendor: rule.vendor, tenant, url: `${url.origin}${url.pathname}`, collector: VENDORS_WITH_COLLECTOR.includes(rule.vendor) });
      return;
    }
  });
  return [...found.values()];
}

/**
 * Whether the employer's official page links to this very tenant: same vendor host and same tenant identifier, not merely the same vendor.
 * `tenantUrl` is the tenant's public entry point (for example https://apply.workable.com/pasha-holding/).
 */
export function officialPageLinksToTenant(officialHtml: string, officialUrl: string, tenantUrl: string): boolean {
  const target = new URL(tenantUrl);
  const identity = (u: URL) => { for (const rule of RULES) { const tenant = rule.match(u); if (tenant) return `${rule.vendor}:${tenant}`; } return null; };
  const wanted = identity(target);
  if (wanted) {
    // A shared vendor host proves nothing by itself: the vendor AND the tenant must be the same.
    return detectAtsLinks(officialHtml, officialUrl).some((l) => `${l.vendor}:${l.tenant}` === wanted);
  }
  // An employer-hosted career domain: the official page must link to exactly that host.
  const $ = cheerio.load(officialHtml);
  let direct = false;
  $('a[href]').each((_, el) => {
    try { const u = new URL($(el).attr('href')!, officialUrl); if (u.protocol === 'https:' && u.hostname === target.hostname && !u.username) direct = true; } catch { /* not a URL */ }
  });
  return direct;
}

export interface TenantRecord { source: string; vendor: AtsVendor; entryUrl: string; employerId: string | null; verified: string | null; evidence: string | null }

/** Every tenant a collector exists for, with the official employer registry entry that vouches for it (null when none does). */
export function collectorTenants(): TenantRecord[] {
  const employerFor = (key: string) => EMPLOYER_TARGETS.find((e) => e.id === key && e.adapter !== null);
  const out: TenantRecord[] = [];
  for (const [key, t] of Object.entries(SAP_SOURCES)) out.push({ source: key, vendor: 'sap-successfactors', entryUrl: `${t.origin}${t.prefix}/search/`, employerId: employerFor(key)?.id ?? null, verified: null, evidence: employerFor(key)?.evidence ?? null });
  for (const [key, t] of Object.entries(WORKABLE_TENANTS)) out.push({ source: key, vendor: 'workable', entryUrl: `https://apply.workable.com/${key}/`, employerId: employerFor(key)?.id ?? null, verified: t.verified, evidence: t.evidence });
  for (const [key, t] of Object.entries(TEAMTAILOR_TENANTS)) out.push({ source: key, vendor: 'teamtailor', entryUrl: `${t.origin}/jobs`, employerId: employerFor(key)?.id ?? null, verified: t.verified, evidence: t.evidence });
  for (const [key, t] of Object.entries(LEVER_TENANTS)) out.push({ source: key, vendor: 'lever', entryUrl: `${t.origin}/${key}`, employerId: employerFor(key)?.id ?? null, verified: t.verified, evidence: t.evidence });
  for (const [key, t] of Object.entries(WORKDAY_TENANTS)) out.push({ source: key, vendor: 'workday', entryUrl: `https://${t.host}/${t.site}`, employerId: employerFor(key)?.id ?? null, verified: t.verified, evidence: t.evidence });
  for (const [key, t] of Object.entries(GREENHOUSE_TENANTS)) out.push({ source: key, vendor: 'greenhouse', entryUrl: `https://job-boards.greenhouse.io/${t.boardToken}`, employerId: employerFor(key)?.id ?? null, verified: t.verified, evidence: t.evidence });
  return out;
}
