/**
 * Workable career page parser for the public markdown feeds.
 *
 * Workable's apply.workable.com provides machine-readable markdown endpoints
 * that do not require JavaScript execution:
 *   - /{tenant}/jobs.md        → listing table (all current openings)
 *   - /{tenant}/jobs/view/{id}.md → job detail (description, requirements, apply link)
 *
 * robots.txt at https://apply.workable.com/robots.txt (verified 2026-10-02):
 *   User-agent: *
 *   Content-Signal: search=yes, ai-input=yes, ai-train=no
 *   Disallow:        ← empty; all paths allowed
 *
 * Terms: https://apply.workable.com/terms (reviewed 2026-10-02)
 * Workable's TOS applies to employers using the platform; the public career
 * pages are employer-published vacancy listings intended for job-seekers.
 * The robots.txt explicitly permits crawling (Disallow empty).
 *
 * Access review: PUBLIC_LISTING — employer-published, publicly accessible,
 * no authentication required, no CAPTCHA on markdown endpoints.
 *
 * Only the /jobs.md and /jobs/view/{id}.md markdown endpoints are used.
 * Application form endpoints (/j/{id}/apply) are never accessed.
 */

import { MAX_JOB_DESCRIPTION_CHARS, type IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { parseStrictIsoDate, validateAzerbaijanLocation } from './public-job-collector';

export const WORKABLE_ORIGIN = 'https://apply.workable.com';

/**
 * Workable tenant definitions.
 *
 * tenant:     slug used in apply.workable.com/{tenant}/
 * employer:   canonical employer identifier (matches employers-100.json id)
 * company:    display name for the IngestJobDto.company field
 * verified:   ISO date of ATS tenant ownership verification
 * evidence:   how ownership was confirmed
 */
export const WORKABLE_TENANTS = {
  'pasha-holding': {
    employer: 'pasha-holding',
    company: 'PASHA Holding',
    verified: '2026-10-02',
    evidence: 'Official site https://pasha-holding.az/az/career/vacancies/ links directly to apply.workable.com/pasha-holding/',
  },
  alumil: {
    employer: 'alumil',
    company: 'ALUMIL',
    verified: '2026-10-26',
    evidence: 'Official site https://www.alumil.com/international/corporate/careers links directly to apply.workable.com/alumil/',
  },
  supportyourapp: {
    employer: 'supportyourapp',
    company: 'SupportYourApp',
    verified: '2026-10-26',
    evidence: 'Official site https://supportyourapp.com/career/ links to https://apply.workable.com/supportyourapp/; the public jobs.md location filter returned an Azerbaijan-eligible remote posting on 2026-10-26',
    countryFilter: 'Azerbaijan',
  },
} as const;

export type WorkableTenant = keyof typeof WORKABLE_TENANTS;
export const WORKABLE_SOURCE_KEYS = Object.keys(WORKABLE_TENANTS) as WorkableTenant[];

export function workableCountryFilter(tenant: WorkableTenant): string | undefined {
  const value = (WORKABLE_TENANTS[tenant] as { countryFilter?: unknown }).countryFilter;
  return typeof value === 'string' ? value : undefined;
}

/** ID is 8–12 uppercase hex chars as used by Workable. */
const JOB_ID = /^[0-9A-F]{8,12}$/;

/** Validate and normalize a Workable public URL. Never accepts apply form endpoints. */
export function workableUrl(tenant: WorkableTenant, input: string): string {
  const url = new URL(input, WORKABLE_ORIGIN);
  if (url.origin !== WORKABLE_ORIGIN) throw new Error('Unsupported Workable URL: wrong origin');
  if (url.username || url.password) throw new Error('Unsupported Workable URL: credentials');
  if (/%2e|%2f|%5c/i.test(url.pathname)) throw new Error('Unsupported Workable URL: path traversal');
  if (url.hash) throw new Error('Unsupported Workable URL: fragment');
  const listMd = `/${tenant}/jobs.md`;
  const detailPrefix = `/${tenant}/jobs/view/`;
  const robotsPath = '/robots.txt';
  if (url.pathname === robotsPath) { url.search = ''; return url.href; }
  if (url.pathname === listMd) {
    if (url.search) {
      const countryFilter = workableCountryFilter(tenant);
      const params = [...url.searchParams.entries()];
      if (!countryFilter || params.length !== 1 ||
          params[0][0] !== 'location[0][country]' || params[0][1] !== countryFilter) {
        throw new Error('Unsupported Workable listing URL: query not allowed');
      }
    }
    return url.href;
  }
  if (url.pathname.startsWith(detailPrefix)) {
    const rest = url.pathname.slice(detailPrefix.length);
    // Must be exactly: {ID}.md — no sub-paths
    const m = /^([0-9A-F]{8,12})\.md$/.exec(rest);
    if (!m) throw new Error(`Unsupported Workable detail URL: unrecognized id segment "${rest}"`);
    if (url.search) throw new Error('Unsupported Workable detail URL: query not allowed');
    return url.href;
  }
  throw new Error(`Unsupported Workable URL path: "${url.pathname}"`);
}

export function workableListUrl(tenant: WorkableTenant): string {
  const url = new URL(`${WORKABLE_ORIGIN}/${tenant}/jobs.md`);
  const countryFilter = workableCountryFilter(tenant);
  if (countryFilter) url.searchParams.set('location[0][country]', countryFilter);
  return workableUrl(tenant, url.href);
}

export function workableDetailUrl(tenant: WorkableTenant, id: string): string {
  if (!JOB_ID.test(id)) throw new Error(`Invalid Workable job ID: "${id}"`);
  return workableUrl(tenant, `${WORKABLE_ORIGIN}/${tenant}/jobs/view/${id}.md`);
}

/**
 * Parse the table row in jobs.md.
 * Format: | Title | Department | Location | Type | Salary | Posted | Details |
 * Details cell: [View](https://apply.workable.com/{tenant}/jobs/view/{ID}.md)
 */
export interface WorkableListRow {
  title: string;
  location: string;
  type: string;
  postedDate: string; // YYYY-MM-DD
  detailUrl: string;
  id: string;
}

export function parseWorkableListing(
  tenant: WorkableTenant,
  markdown: string,
  countryEligibility?: string,
): WorkableListRow[] {
  if (countryEligibility && countryEligibility !== workableCountryFilter(tenant)) {
    throw new Error('Unverified Workable location eligibility');
  }
  const lines = markdown.split('\n').map((l) => l.trim());

  // Require recognized Workable title heading: e.g. "# PASHA Holding — All Open Positions"
  const headerIdx = lines.findIndex((l) => /^#\s+.+[\u2014-]\s+All Open Positions$/i.test(l) || /^#\s+.+\s+Careers$/i.test(l));
  if (headerIdx === -1) {
    throw new Error(`Unrecognized or invalid Workable listing header in ${tenant} feed`);
  }

  // Require table header line (or explicit empty inventory notice)
  const tableHeaderIdx = lines.findIndex((l) => l === '| Title | Department | Location | Type | Salary | Posted | Details |');
  if (tableHeaderIdx === -1) {
    const hasEmptyNotice = lines.some((l) =>
      /no open positions|no vacancies|there are currently no|hazırda aktiv vakansiya yoxdur/i.test(l),
    );
    if (hasEmptyNotice) {
      return [];
    }
    throw new Error(`Missing Workable listing table header in ${tenant} feed`);
  }

  // Require separator line immediately following table header
  const separatorLine = lines[tableHeaderIdx + 1];
  if (!separatorLine || !/^\|(?:\s*-+\s*\|)+$/.test(separatorLine)) {
    throw new Error(`Missing or malformed table separator in Workable listing for ${tenant}`);
  }

  const rows: WorkableListRow[] = [];
  // Parse rows starting after separator line until "---" or "Powered by" or end
  for (let i = tableHeaderIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line === '---' || line.startsWith('Powered by')) break;

    if (!line.startsWith('|') || !line.endsWith('|')) {
      throw new Error(`Unexpected line format in Workable listing table: ${line}`);
    }

    const cells = line.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.length !== 7) {
      throw new Error(`Malformed table row (expected 7 columns, got ${cells.length}) in Workable listing for ${tenant}`);
    }

    const [titleCell, , locationCell, typeCell, , postedCell, detailsCell] = cells;
    if (!titleCell || !locationCell || !postedCell || !detailsCell) {
      throw new Error(`Empty required cell in Workable listing row for ${tenant}`);
    }

    const detailMatch = /\[View\]\((https:\/\/apply\.workable\.com\/[^)]+\.md)\)/.exec(detailsCell);
    if (!detailMatch) {
      throw new Error(`Malformed details link in Workable listing row for ${tenant}`);
    }

    const detailUrl = detailMatch[1];
    const idMatch = new RegExp(`^https://apply\\.workable\\.com/${tenant}/jobs/view/([0-9A-F]{8,12})\\.md$`).exec(detailUrl);
    if (!idMatch) {
      throw new Error(`Mismatched or invalid job ID in Workable listing row: ${detailUrl}`);
    }

    const id = idMatch[1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(postedCell)) {
      throw new Error(`Invalid posted date format in Workable listing row: ${postedCell}`);
    }

    // A country-filtered Workable response is source evidence that the role is
    // eligible in that country. Workable's row can still display its first
    // office (e.g. Buenos Aires) for a multi-location remote role.
    const location = locationCell.replace(/^\s+|\s+$/g, '');
    const countryFilter = countryEligibility;
    if (!countryFilter && !/azerbaijan|baku/i.test(location)) {
      continue;
    }

    rows.push({
      title: titleCell.replace(/&amp;/g, '&').replace(/&#[0-9]+;/g, '').trim(),
      location: countryFilter ?? location,
      type: typeCell.trim(),
      postedDate: postedCell,
      detailUrl: workableUrl(tenant, detailUrl),
      id,
    });
  }

  return rows;
}

const clean = (text: string) => text.replace(/[\s\uFEFF]+/g, ' ').trim();

/**
 * Parse a Workable job detail markdown page.
 *
 * Format:
 *   # {Title}
 *   > {Company} · {Location} · {Type} · Posted {YYYY-MM-DD}
 *   **Workplace:** on_site|remote|hybrid
 *   **Department:** {Dept}
 *   ## Description
 *   {text}
 *   ## Requirements
 *   {text}
 *   ## Apply
 *   [Apply at {Company}](https://apply.workable.com/{tenant}/j/{ID}/apply)
 */
export function parseWorkableDetail(
  tenant: WorkableTenant,
  markdown: string,
  detailUrl: string,
  fetchedAt: Date,
  countryEligibility?: string,
): IngestJobDto | null {
  const config = WORKABLE_TENANTS[tenant];
  const id = new URL(detailUrl).pathname.match(/\/jobs\/view\/([0-9A-F]{8,12})\.md$/)?.[1];
  if (!id) throw new Error('Could not extract Workable job ID from URL');

  const lines = markdown.split('\n');

  // Title: first "# ..." line
  const titleLine = lines.find((l) => /^#\s+/.test(l));
  if (!titleLine) throw new Error('Missing Workable job title');
  const title = clean(titleLine.replace(/^#+\s*/, '').replace(/&amp;/g, '&'));
  if (!title || title.length > 500) throw new Error('Invalid Workable job title');

  // Meta line: "> Company · Location · Type · Posted YYYY-MM-DD"
  const metaLine = lines.find((l) => /^>\s+/.test(l) && /Posted\s+\d{4}-\d{2}-\d{2}/.test(l));
  if (!metaLine) throw new Error('Missing Workable job meta line');
  const postedMatch = /Posted\s+(\d{4}-\d{2}-\d{2})/.exec(metaLine);
  if (!postedMatch) throw new Error('Missing Posted date in Workable meta');
  const postedDate = postedMatch[1];
  // Location from meta: "> Company · {Location} · ..."
  const metaParts = metaLine.replace(/^>\s*/, '').split('·').map((p) => p.trim());
  // metaParts[0] = company, metaParts[1] = location, metaParts[2] = type, metaParts[3] = "Posted YYYY-MM-DD"
  const rawLocation = metaParts[1] ?? '';

  // Validate location using structured parsing.
  // Workable meta uses "City, Country" format. Split and check each part
  // against the known foreign sets before accepting.
  if (rawLocation && !/azerbaijan|baku/i.test(rawLocation)) {
    // Try to split "City, Country" — check city and country independently
    const parts = rawLocation.split(',').map((p) => p.trim());
    const city = parts[0] ?? '';
    const country = parts[parts.length - 1] ?? '';
    // validateAzerbaijanLocation handles string inputs via KNOWN_FOREIGN_LOCALITIES
    // Pass each part individually so it can match e.g. "ISTANBUL"
    let isForeign = false;
    for (const part of [city, country]) {
      if (!part) continue;
      try {
        validateAzerbaijanLocation(part, 'Azerbaijan');
      } catch {
        isForeign = true;
        break;
      }
    }
    // Also reject if country is explicitly non-Azerbaijan (e.g. "Turkey", "Georgia")
    if (!isForeign && country && country !== city) {
      // Check if country matches a known non-AZ country name
      const countryUpper = country.toUpperCase();
      const KNOWN_FOREIGN_COUNTRIES = new Set([
        'TURKEY', 'TÜRKIYE', 'GEORGIA', 'RUSSIA', 'UKRAINE', 'KAZAKHSTAN',
        'UZBEKISTAN', 'UK', 'UNITED KINGDOM', 'GERMANY', 'FRANCE', 'POLAND',
        'UAE', 'UNITED ARAB EMIRATES', 'SAUDI ARABIA', 'QATAR', 'USA', 'UNITED STATES',
      ]);
      if (KNOWN_FOREIGN_COUNTRIES.has(countryUpper)) isForeign = true;
    }
    if (isForeign) return null; // Explicitly foreign posting — reject
  }
  if (countryEligibility && countryEligibility !== workableCountryFilter(tenant)) {
    throw new Error('Unverified Workable location eligibility');
  }
  const location = countryEligibility || rawLocation || 'Azerbaijan';

  // Parse postedAt using strict date validator
  const postedAt = parseStrictIsoDate(postedDate);
  if (!postedAt) throw new Error(`Invalid or impossible Workable date: "${postedDate}"`);
  const postedAtDate = new Date(postedAt);
  if (postedAtDate > fetchedAt) return null; // Future date — skip

  // Extract description and requirements sections
  const sections: Record<string, string[]> = {};
  let currentSection = '';
  for (const line of lines) {
    const sectionMatch = /^##\s+(.+)$/.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim().toLowerCase();
      sections[currentSection] = [];
      continue;
    }
    if (currentSection && !line.startsWith('---')) {
      sections[currentSection] = sections[currentSection] ?? [];
      sections[currentSection].push(line);
    }
  }

  const descLines = [
    ...(sections['description'] ?? []),
    '',
    ...(sections['requirements'] ?? []),
    '',
    ...(sections['benefits'] ?? []),
  ];
  // Remove markdown link syntax, clean up whitespace
  const description = descLines
    .map((l) => l.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!description || description.length > MAX_JOB_DESCRIPTION_CHARS) {
    throw new Error('Invalid Workable description length');
  }

  // Extract the apply link — used as the canonical vacancy URL (the listing detail page, not the apply form)
  // Use the detail markdown URL as the canonical URL since it's the public vacancy page
  const canonicalUrl = `${WORKABLE_ORIGIN}/${tenant}/j/${id}`;

  return {
    externalId: `${tenant}:${id}`,
    title,
    company: config.company,
    description,
    location,
    url: canonicalUrl,
    postedAt,
    detailFetchedAt: fetchedAt.toISOString(),
    rawPayload: {
      source: tenant,
      tenant,
      employer: config.employer,
      workplaceType: (() => {
        const wpLine = lines.find((l) => /^\*\*Workplace:\*\*/.test(l));
        return wpLine ? clean(wpLine.replace(/^\*\*Workplace:\*\*\s*/, '')) : null;
      })(),
      department: (() => {
        const deptLine = lines.find((l) => /^\*\*Department:\*\*/.test(l));
        return deptLine ? clean(deptLine.replace(/^\*\*Department:\*\*\s*/, '')) : null;
      })(),
      ...(countryEligibility ? { sourceLocation: rawLocation } : {}),
      locationEvidence: countryEligibility ? 'workable-country-filter' : 'workable-meta-line',
      ...(countryEligibility ? { countryEligibility } : {}),
      postingDateEvidence: 'workable-meta-posted-date',
      tenantVerified: config.verified,
      tenantEvidence: config.evidence,
    },
  };
}
