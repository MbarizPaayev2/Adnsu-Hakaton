import fs from 'node:fs';
import path from 'node:path';
import {
  workableUrl,
  workableListUrl,
  workableDetailUrl,
  parseWorkableListing,
  parseWorkableDetail,
  WORKABLE_ORIGIN,
} from './workable.parser';
import { WorkableCollector } from './workable.collector';

// ──────────────────────────────────────────────────────────────────────────────
// URL validation
// ──────────────────────────────────────────────────────────────────────────────
describe('workableUrl', () => {
  it('accepts the robots.txt path', () => {
    expect(workableUrl('pasha-holding', `${WORKABLE_ORIGIN}/robots.txt`)).toBe(`${WORKABLE_ORIGIN}/robots.txt`);
  });

  it('accepts the listing markdown path', () => {
    expect(workableUrl('pasha-holding', `${WORKABLE_ORIGIN}/pasha-holding/jobs.md`))
      .toBe(`${WORKABLE_ORIGIN}/pasha-holding/jobs.md`);
  });

  it('accepts a valid detail URL', () => {
    expect(workableUrl('pasha-holding', `${WORKABLE_ORIGIN}/pasha-holding/jobs/view/AAFCBFE72F.md`))
      .toBe(`${WORKABLE_ORIGIN}/pasha-holding/jobs/view/AAFCBFE72F.md`);
  });

  it('rejects wrong origin', () => {
    expect(() => workableUrl('pasha-holding', 'https://evil.example/pasha-holding/jobs.md'))
      .toThrow('wrong origin');
  });

  it('rejects credentials in URL', () => {
    expect(() => workableUrl('pasha-holding', `${WORKABLE_ORIGIN.replace('https://', 'https://u:p@')}/pasha-holding/jobs.md`))
      .toThrow('credentials');
  });

  it('rejects path traversal %2f', () => {
    expect(() => workableUrl('pasha-holding', `${WORKABLE_ORIGIN}/pasha-holding%2fjobs.md`))
      .toThrow('path traversal');
  });

  it('rejects fragment in URL', () => {
    expect(() => workableUrl('pasha-holding', `${WORKABLE_ORIGIN}/pasha-holding/jobs.md#section`))
      .toThrow('fragment');
  });

  it('rejects query on listing URL', () => {
    expect(() => workableUrl('pasha-holding', `${WORKABLE_ORIGIN}/pasha-holding/jobs.md?q=1`))
      .toThrow('query not allowed');
  });

  it('rejects query on detail URL', () => {
    expect(() => workableUrl('pasha-holding', `${WORKABLE_ORIGIN}/pasha-holding/jobs/view/AAFCBFE72F.md?x=1`))
      .toThrow('query not allowed');
  });

  it('rejects apply form endpoint', () => {
    expect(() => workableUrl('pasha-holding', `${WORKABLE_ORIGIN}/pasha-holding/j/AAFCBFE72F/apply`))
      .toThrow('path');
  });

  it('rejects non-tenant detail path', () => {
    // Other tenant's detail URL should be rejected
    expect(() => workableUrl('pasha-holding', `${WORKABLE_ORIGIN}/other-company/jobs/view/AAFCBFE72F.md`))
      .toThrow();
  });

  it('rejects invalid job ID format (lowercase)', () => {
    expect(() => workableUrl('pasha-holding', `${WORKABLE_ORIGIN}/pasha-holding/jobs/view/aafcbfe72f.md`))
      .toThrow('id segment');
  });

  it('rejects too-short job ID', () => {
    expect(() => workableUrl('pasha-holding', `${WORKABLE_ORIGIN}/pasha-holding/jobs/view/A1.md`))
      .toThrow('id segment');
  });
});

describe('workableListUrl / workableDetailUrl', () => {
  it('constructs the listing URL correctly', () => {
    expect(workableListUrl('pasha-holding')).toBe(`${WORKABLE_ORIGIN}/pasha-holding/jobs.md`);
  });

  it('constructs a detail URL correctly', () => {
    expect(workableDetailUrl('pasha-holding', 'ABC12345')).toBe(`${WORKABLE_ORIGIN}/pasha-holding/jobs/view/ABC12345.md`);
  });

  it('rejects invalid ID in detail URL', () => {
    expect(() => workableDetailUrl('pasha-holding', 'bad-id')).toThrow('Invalid Workable job ID');
    expect(() => workableDetailUrl('pasha-holding', 'abc12345')).toThrow('Invalid Workable job ID');
    expect(() => workableDetailUrl('pasha-holding', '')).toThrow('Invalid Workable job ID');
  });

  it('uses a narrowly scoped Azerbaijan country query for the verified multi-location tenant', () => {
    expect(workableListUrl('supportyourapp')).toBe(
      `${WORKABLE_ORIGIN}/supportyourapp/jobs.md?location%5B0%5D%5Bcountry%5D=Azerbaijan`,
    );
    expect(() => workableUrl('supportyourapp', `${WORKABLE_ORIGIN}/supportyourapp/jobs.md?query=developer`))
      .toThrow('query not allowed');
    expect(() => workableUrl('pasha-holding', `${WORKABLE_ORIGIN}/pasha-holding/jobs.md?location%5B0%5D%5Bcountry%5D=Azerbaijan`))
      .toThrow('query not allowed');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Listing parser
// ──────────────────────────────────────────────────────────────────────────────

const SAMPLE_LISTING = `# PASHA Holding — All Open Positions

> Last updated: 2026-10-02

| Title | Department | Location | Type | Salary | Posted | Details |
|-------|-----------|----------|------|--------|--------|---------| 
| Azərbaycan Supermarket MMC (Bravo) - Baş Auditor | Group Audit | Baku, Azerbaijan | Full-time | — | 2026-09-09 | [View](https://apply.workable.com/pasha-holding/jobs/view/AAFCBFE72F.md) |
| Auditor-Agro Dairy | Group Audit | Baku, Azerbaijan | Full-time | — | 2026-09-09 | [View](https://apply.workable.com/pasha-holding/jobs/view/42FA7BEF17.md) |
| Audit Manager | Group Audit | Baku, Azerbaijan | Full-time | — | 2026-09-07 | [View](https://apply.workable.com/pasha-holding/jobs/view/BDD973568D.md) |
| AI Transformation and Governance Manager | Other | Baku, Azerbaijan | Full-time | — | 2026-08-26 | [View](https://apply.workable.com/pasha-holding/jobs/view/C81AC3343B.md) |

---
Powered by [Workable](https://www.workable.com)
`;

const EMPTY_LISTING = `# PASHA Holding — All Open Positions

> Last updated: 2026-10-02

| Title | Department | Location | Type | Salary | Posted | Details |
|-------|-----------|----------|------|--------|--------|---------| 

---
Powered by [Workable](https://www.workable.com)
`;

describe('parseWorkableListing', () => {
  it('parses all rows from a real listing fixture', () => {
    const rows = parseWorkableListing('pasha-holding', SAMPLE_LISTING);
    expect(rows).toHaveLength(4);
    expect(rows[0].id).toBe('AAFCBFE72F');
    expect(rows[0].title).toBe('Azərbaycan Supermarket MMC (Bravo) - Baş Auditor');
    expect(rows[0].postedDate).toBe('2026-09-09');
    expect(rows[0].location).toBe('Baku, Azerbaijan');
    expect(rows[0].detailUrl).toBe(`${WORKABLE_ORIGIN}/pasha-holding/jobs/view/AAFCBFE72F.md`);
  });

  it('returns empty array for a listing with verified table and no vacancies', () => {
    const rows = parseWorkableListing('pasha-holding', EMPTY_LISTING);
    expect(rows).toHaveLength(0);
  });

  it('returns empty array when listing has explicit no open positions notice', () => {
    const notice = `# PASHA Holding — All Open Positions\n\nThere are currently no open positions.`;
    expect(parseWorkableListing('pasha-holding', notice)).toEqual([]);
  });

  it('skips rows with non-Azerbaijan locations from valid tables', () => {
    const foreignListing = SAMPLE_LISTING.replace(
      'Baku, Azerbaijan | Full-time | — | 2026-08-26',
      'Istanbul, Turkey | Full-time | — | 2026-08-26',
    );
    const rows = parseWorkableListing('pasha-holding', foreignListing);
    // The replaced row should be excluded
    expect(rows.length).toBe(3);
    expect(rows.every((r) => /azerbaijan|baku/i.test(r.location))).toBe(true);
  });

  it('throws on missing header or unrecognized error page', () => {
    expect(() => parseWorkableListing('pasha-holding', '| Title | Dept |\n| job | dept |'))
      .toThrow('Unrecognized or invalid Workable listing header');
    expect(() => parseWorkableListing('pasha-holding', '# Unexpected error page'))
      .toThrow('Unrecognized or invalid Workable listing header in pasha-holding feed');
  });

  it('throws on rows with invalid date format (fails closed)', () => {
    const badDateListing = SAMPLE_LISTING.replace('2026-09-09', '09/09/2026');
    expect(() => parseWorkableListing('pasha-holding', badDateListing))
      .toThrow('Invalid posted date format in Workable listing row: 09/09/2026');
  });

  it('keeps a role returned by the verified Azerbaijan country filter when Workable displays its first foreign office', () => {
    const feed = fs.readFileSync(path.join(__dirname, 'fixtures', 'workable', 'supportyourapp-azerbaijan-list.md'), 'utf8');
    const rows = parseWorkableListing('supportyourapp', feed, 'Azerbaijan');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: '79FF3D4315',
      title: '(Fluent English) Technical Support Consultant (remote)',
      location: 'Azerbaijan',
    });
  });

  it('does not treat the multi-location tenant as Azerbaijan-eligible without explicit filter evidence', () => {
    const feed = fs.readFileSync(path.join(__dirname, 'fixtures', 'workable', 'supportyourapp-azerbaijan-list.md'), 'utf8');
    expect(parseWorkableListing('supportyourapp', feed)).toEqual([]);
    expect(() => parseWorkableListing('supportyourapp', feed, 'Georgia')).toThrow('Unverified Workable location eligibility');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Detail parser
// ──────────────────────────────────────────────────────────────────────────────

const SAMPLE_DETAIL = `# Azərbaycan Supermarket MMC (Bravo) - Baş Auditor

> PASHA Holding · Baku, Azerbaijan · Full-time · Posted 2026-09-09

**Workplace:** on_site

**Department:** Group Audit

## Description

·       Təsdiq olunmuş İllik Audit Planına əsasən audit layihələrini həyata keçirir.

·       Audit layihəsi çərçivəsində risklərin idarə edilməsi proseslərinin effektivliyini qiymətləndirir.

## Requirements

·       Ali iqtisadi təhsil (minimum dörd illik təcrübə);

·       Müvafiq iş təcrübəsi: 4 ildən artıq ümumi.

## Apply

[Apply at PASHA Holding](https://apply.workable.com/pasha-holding/j/AAFCBFE72F/apply)

`;

const DETAIL_URL = `${WORKABLE_ORIGIN}/pasha-holding/jobs/view/AAFCBFE72F.md`;
const NOW = new Date('2026-10-02T12:00:00Z');

describe('parseWorkableDetail', () => {
  it('parses a real Azerbaijani posting correctly', () => {
    const job = parseWorkableDetail('pasha-holding', SAMPLE_DETAIL, DETAIL_URL, NOW);
    expect(job).not.toBeNull();
    expect(job!.externalId).toBe('pasha-holding:AAFCBFE72F');
    expect(job!.title).toBe('Azərbaycan Supermarket MMC (Bravo) - Baş Auditor');
    expect(job!.company).toBe('PASHA Holding');
    expect(job!.location).toBe('Baku, Azerbaijan');
    expect(job!.postedAt).toBe('2026-09-09T00:00:00.000Z'); // YYYY-MM-DD with no TZ → UTC midnight
    expect(job!.description).toContain('Audit Planına');
    expect(job!.description).toContain('Ali iqtisadi');
    expect(job!.url).toBe(`${WORKABLE_ORIGIN}/pasha-holding/j/AAFCBFE72F`);
    expect(job!.rawPayload?.source).toBe('pasha-holding');
    expect(job!.rawPayload?.tenant).toBe('pasha-holding');
    expect(job!.rawPayload?.workplaceType).toBe('on_site');
    expect(job!.rawPayload?.department).toBe('Group Audit');
  });

  it('rejects a posting with future datePosted', () => {
    const futureDetail = SAMPLE_DETAIL.replace('Posted 2026-09-09', 'Posted 2027-01-01');
    const pastNow = new Date('2026-10-02T00:00:00Z');
    const job = parseWorkableDetail('pasha-holding', futureDetail, DETAIL_URL, pastNow);
    expect(job).toBeNull();
  });

  it('throws on missing title', () => {
    const noTitle = SAMPLE_DETAIL.replace(/^# .+$/m, '');
    expect(() => parseWorkableDetail('pasha-holding', noTitle, DETAIL_URL, NOW)).toThrow('Missing Workable job title');
  });

  it('throws on missing meta line with Posted date', () => {
    const noMeta = SAMPLE_DETAIL.replace(/^> .+$/m, '');
    expect(() => parseWorkableDetail('pasha-holding', noMeta, DETAIL_URL, NOW)).toThrow('Missing Workable job meta line');
  });

  it('throws on impossible calendar date 2026-02-30', () => {
    const badDate = SAMPLE_DETAIL.replace('Posted 2026-09-09', 'Posted 2026-02-30');
    expect(() => parseWorkableDetail('pasha-holding', badDate, DETAIL_URL, NOW))
      .toThrow(/impossible|invalid|calendar/i);
  });

  it('returns null for explicitly foreign posting (Istanbul, Turkey)', () => {
    const foreign = SAMPLE_DETAIL.replace('Baku, Azerbaijan', 'Istanbul, Turkey');
    const job = parseWorkableDetail('pasha-holding', foreign, DETAIL_URL, NOW);
    expect(job).toBeNull();
  });

  it('does not set deadline when none provided (no validThrough in source)', () => {
    const job = parseWorkableDetail('pasha-holding', SAMPLE_DETAIL, DETAIL_URL, NOW);
    expect(job!.deadline).toBeUndefined();
  });

  it('preserves employer identity in rawPayload', () => {
    const job = parseWorkableDetail('pasha-holding', SAMPLE_DETAIL, DETAIL_URL, NOW);
    expect(job!.rawPayload?.employer).toBe('pasha-holding');
    expect(job!.rawPayload?.tenantVerified).toBe('2026-10-02');
  });

  it('does not include application form URL in job.url', () => {
    const job = parseWorkableDetail('pasha-holding', SAMPLE_DETAIL, DETAIL_URL, NOW);
    // The canonical URL is the vacancy page, NOT the apply form endpoint
    expect(job!.url).not.toMatch(/\/j\/[0-9A-F]+\/apply$/);
    // It should be the public job detail path
    expect(job!.url).toMatch(/\/pasha-holding\/j\/[0-9A-F]+$/);
  });

  it('records the country-filter evidence for an eligible multi-location role without exposing the first office as the candidate location', () => {
    const detail = fs.readFileSync(path.join(__dirname, 'fixtures', 'workable', 'supportyourapp-technical-support.md'), 'utf8');
    const url = `${WORKABLE_ORIGIN}/supportyourapp/jobs/view/79FF3D4315.md`;
    const job = parseWorkableDetail('supportyourapp', detail, url, new Date('2026-10-26T12:00:00Z'), 'Azerbaijan');
    expect(job).toMatchObject({
      title: '(Fluent English) Technical Support Consultant (remote)',
      location: 'Azerbaijan',
      rawPayload: {
        sourceLocation: 'Buenos Aires, Argentina (Remote)',
        locationEvidence: 'workable-country-filter',
        countryEligibility: 'Azerbaijan',
        workplaceType: 'remote',
      },
    });
    expect(() => parseWorkableDetail('supportyourapp', detail, url, NOW, 'Georgia'))
      .toThrow('Unverified Workable location eligibility');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Collector
// ──────────────────────────────────────────────────────────────────────────────

const ROBOTS_ALLOW = 'User-agent: *\nDisallow: \n';

function makeReader(pages: Record<string, string>) {
  return async (url: string) => {
    if (url in pages) return pages[url];
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

describe('WorkableCollector', () => {
  const listUrl = `${WORKABLE_ORIGIN}/pasha-holding/jobs.md`;
  const detail1 = `${WORKABLE_ORIGIN}/pasha-holding/jobs/view/AAFCBFE72F.md`;
  const detail2 = `${WORKABLE_ORIGIN}/pasha-holding/jobs/view/C81AC3343B.md`;

  const MULTI_LISTING = `# PASHA Holding — All Open Positions

> Last updated: 2026-10-02

| Title | Department | Location | Type | Salary | Posted | Details |
|-------|-----------|----------|------|--------|--------|---------| 
| Baş Auditor | Group Audit | Baku, Azerbaijan | Full-time | — | 2026-09-09 | [View](${detail1}) |
| AI Manager | Other | Baku, Azerbaijan | Full-time | — | 2026-08-26 | [View](${detail2}) |

---
Powered by [Workable](https://www.workable.com)
`;

  const detail1Md = `# Baş Auditor
> PASHA Holding · Baku, Azerbaijan · Full-time · Posted 2026-09-09
**Workplace:** on_site
**Department:** Group Audit
## Description
Audit layihələrini həyata keçirir.
## Requirements
Ali iqtisadi təhsil.
## Apply
[Apply at PASHA Holding](${WORKABLE_ORIGIN}/pasha-holding/j/AAFCBFE72F/apply)
`;

  const detail2Md = `# AI Manager
> PASHA Holding · Baku, Azerbaijan · Full-time · Posted 2026-08-26
**Workplace:** on_site
**Department:** Other
## Description
AI transformation program management.
## Requirements
Complex project delivery.
## Apply
[Apply at PASHA Holding](${WORKABLE_ORIGIN}/pasha-holding/j/C81AC3343B/apply)
`;

  it('collects all discovered jobs from listing + details', async () => {
    const accepted: any[] = [];
    const collector = new WorkableCollector(
      'pasha-holding',
      makeReader({
        [`${WORKABLE_ORIGIN}/robots.txt`]: ROBOTS_ALLOW,
        [listUrl]: MULTI_LISTING,
        [detail1]: detail1Md,
        [detail2]: detail2Md,
      }),
      async () => {},
      () => new Date('2026-10-02T12:00:00Z'),
    );
    const report = await collector.collect({ maxPages: 10, maxJobs: 100, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.source).toBe('pasha-holding');
    expect(report.discovered).toBe(2);
    expect(report.fetched).toBe(2);
    expect(report.accepted).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.complete).toBe(true);
    expect(report.error).toBeUndefined();
    expect(accepted).toHaveLength(2);
    expect(accepted[0].externalId).toBe('pasha-holding:AAFCBFE72F');
    expect(accepted[1].externalId).toBe('pasha-holding:C81AC3343B');
  });

  it('collects an Azerbaijan-filtered multi-location Workable job and preserves eligibility provenance', async () => {
    const listUrl = workableListUrl('supportyourapp');
    const detailUrl = `${WORKABLE_ORIGIN}/supportyourapp/jobs/view/79FF3D4315.md`;
    const list = fs.readFileSync(path.join(__dirname, 'fixtures', 'workable', 'supportyourapp-azerbaijan-list.md'), 'utf8');
    const detail = fs.readFileSync(path.join(__dirname, 'fixtures', 'workable', 'supportyourapp-technical-support.md'), 'utf8');
    const read = jest.fn(makeReader({
      [`${WORKABLE_ORIGIN}/robots.txt`]: ROBOTS_ALLOW,
      [listUrl]: list,
      [detailUrl]: detail,
    }));
    const accepted: any[] = [];
    const report = await new WorkableCollector('supportyourapp', read, async () => {}, () => new Date('2026-10-26T12:00:00Z'))
      .collect({ maxPages: 10, maxJobs: 100, delayMs: 1000 }, async (job) => { accepted.push(job); });

    expect(report).toMatchObject({ source: 'supportyourapp', discovered: 1, fetched: 1, accepted: 1, failed: 0, complete: true });
    expect(read).toHaveBeenCalledWith(listUrl);
    expect(accepted[0]).toMatchObject({ location: 'Azerbaijan', rawPayload: { countryEligibility: 'Azerbaijan' } });
  });

  it('reports complete=true with 0 accepted when tenant has verified empty listing', async () => {
    const accepted: any[] = [];
    const collector = new WorkableCollector(
      'pasha-holding',
      makeReader({
        [`${WORKABLE_ORIGIN}/robots.txt`]: ROBOTS_ALLOW,
        [listUrl]: EMPTY_LISTING,
      }),
      async () => {},
      () => NOW,
    );
    const report = await collector.collect({ maxPages: 10, maxJobs: 100, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.source).toBe('pasha-holding');
    expect(report.discovered).toBe(0);
    expect(report.accepted).toBe(0);
    expect(report.complete).toBe(true);
    expect(report.error).toBeUndefined();
  });

  it('fails closed when listing returns unexpected error page', async () => {
    const accepted: any[] = [];
    const collector = new WorkableCollector(
      'pasha-holding',
      makeReader({
        [`${WORKABLE_ORIGIN}/robots.txt`]: ROBOTS_ALLOW,
        [listUrl]: '# Unexpected error page',
      }),
      async () => {},
      () => NOW,
    );
    const report = await collector.collect({ maxPages: 10, maxJobs: 100, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.complete).toBe(false);
    expect(report.error).toMatch(/Unrecognized or invalid Workable listing header/);
    expect(report.accepted).toBe(0);
  });

  it('stops immediately on 403 / 429 blocking responses during detail fetch', async () => {
    const accepted: any[] = [];
    let detail2Calls = 0;
    const collector = new WorkableCollector(
      'pasha-holding',
      async (url) => {
        if (url === `${WORKABLE_ORIGIN}/robots.txt`) return ROBOTS_ALLOW;
        if (url === listUrl) return MULTI_LISTING;
        if (url === detail1) throw new Error('Source HTTP 403');
        if (url === detail2) { detail2Calls++; return detail2Md; }
        throw new Error(`Unexpected: ${url}`);
      },
      async () => {},
      () => NOW,
    );
    const report = await collector.collect({ maxPages: 10, maxJobs: 100, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.complete).toBe(false);
    expect(report.error).toBe('Source HTTP 403');
    expect(detail2Calls).toBe(0);
    expect(report.accepted).toBe(0);
  });

  it('reports complete=false when maxJobs limit is reached', async () => {
    const accepted: any[] = [];
    const collector = new WorkableCollector(
      'pasha-holding',
      makeReader({
        [`${WORKABLE_ORIGIN}/robots.txt`]: ROBOTS_ALLOW,
        [listUrl]: MULTI_LISTING,
        [detail1]: detail1Md,
        // detail2 not provided — should not be fetched with maxJobs=1
      }),
      async () => {},
      () => new Date('2026-10-02T12:00:00Z'),
    );
    const report = await collector.collect({ maxPages: 10, maxJobs: 1, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.discovered).toBe(2);
    expect(report.fetched).toBe(1);
    expect(report.accepted).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.error).toMatch(/Collection limit reached/);
  });

  it('reports a detail transport failure as an upstream failure and stops without misclassifying it as a parse error', async () => {
    const accepted: any[] = [];
    let calls = 0;
    const collector = new WorkableCollector(
      'pasha-holding',
      async (url) => {
        if (url === `${WORKABLE_ORIGIN}/robots.txt`) return ROBOTS_ALLOW;
        if (url === listUrl) return MULTI_LISTING;
        if (url === detail1) return detail1Md;
        if (url === detail2) { calls++; throw new Error('Network timeout'); }
        throw new Error(`Unexpected: ${url}`);
      },
      async () => {},
      () => new Date('2026-10-02T12:00:00Z'),
    );
    const report = await collector.collect({ maxPages: 10, maxJobs: 100, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.failed).toBe(1);
    expect(report.accepted).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.outcome).toBe('UPSTREAM_FAILURE');
    expect(report.error).toMatch(/Network timeout/);
    expect(calls).toBe(1);
  });

  it('throws on invalid collection options', async () => {
    const collector = new WorkableCollector('pasha-holding', makeReader({}), async () => {}, () => new Date());
    await expect(collector.collect({ maxPages: 0, maxJobs: 100, delayMs: 1000 }, async () => {}))
      .rejects.toThrow('Invalid collection limits');
  });

  it('throws on unknown tenant', () => {
    expect(() => new WorkableCollector('nonexistent-company' as any)).toThrow('Unknown Workable tenant');
  });

  it('rejects robots-blocked path', async () => {
    const accepted: any[] = [];
    const blockingRobots = 'User-agent: *\nDisallow: /pasha-holding/\n';
    const collector = new WorkableCollector(
      'pasha-holding',
      makeReader({ [`${WORKABLE_ORIGIN}/robots.txt`]: blockingRobots }),
      async () => {},
      () => new Date('2026-10-02T12:00:00Z'),
    );
    const report = await collector.collect({ maxPages: 10, maxJobs: 10, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.error).toMatch(/prohibit/i);
    expect(report.accepted).toBe(0);
  });

  it('skips foreign postings (returns null from parser)', async () => {
    const foreignDetail = detail1Md.replace('Baku, Azerbaijan', 'Istanbul, Turkey');
    const accepted: any[] = [];
    const collector = new WorkableCollector(
      'pasha-holding',
      makeReader({
        [`${WORKABLE_ORIGIN}/robots.txt`]: ROBOTS_ALLOW,
        [listUrl]: `# PASHA Holding — All Open Positions
> Last updated: 2026-10-02
| Title | Department | Location | Type | Salary | Posted | Details |
|-------|-----------|----------|------|--------|--------|---------|
| Baş Auditor | Group Audit | Baku, Azerbaijan | Full-time | — | 2026-09-09 | [View](${detail1}) |
---
Powered by [Workable](https://www.workable.com)
`,
        [detail1]: foreignDetail,
      }),
      async () => {},
      () => new Date('2026-10-02T12:00:00Z'),
    );
    const report = await collector.collect({ maxPages: 10, maxJobs: 100, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.fetched).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.accepted).toBe(0);
  });

  it('does not accept a detail page with impossible date 2026-02-30', async () => {
    const badDateDetail = detail1Md.replace('Posted 2026-09-09', 'Posted 2026-02-30');
    const accepted: any[] = [];
    const collector = new WorkableCollector(
      'pasha-holding',
      makeReader({
        [`${WORKABLE_ORIGIN}/robots.txt`]: ROBOTS_ALLOW,
        [listUrl]: `# PASHA Holding — All Open Positions
> Last updated: 2026-10-02
| Title | Department | Location | Type | Salary | Posted | Details |
|-------|-----------|----------|------|--------|--------|---------|
| Baş Auditor | Group Audit | Baku, Azerbaijan | Full-time | — | 2026-09-09 | [View](${detail1}) |
---
Powered by [Workable](https://www.workable.com)
`,
        [detail1]: badDateDetail,
      }),
      async () => {},
      () => new Date('2026-10-02T12:00:00Z'),
    );
    const report = await collector.collect({ maxPages: 10, maxJobs: 100, delayMs: 1000 }, async (j) => { accepted.push(j); });
    // Parser throws → counted as failed, not accepted
    expect(report.failed).toBe(1);
    expect(report.accepted).toBe(0);
  });

  it('collects and maps ALUMIL Workable postings for Azerbaijan', async () => {
    const alumilListUrl = `${WORKABLE_ORIGIN}/alumil/jobs.md`;
    const alumilDetailUrl = `${WORKABLE_ORIGIN}/alumil/jobs/view/AD3F562A59.md`;
    const alumilListMd = `# ALUMIL — All Open Positions
> Last updated: 2026-10-26
| Title | Department | Location | Type | Salary | Posted | Details |
|-------|-----------|----------|------|--------|--------|---------|
| General Accountant | Finance | Gaziemir, Turkey | Full-time | — | 2026-05-22 | [View](${WORKABLE_ORIGIN}/alumil/jobs/view/ECACCB8A15.md) |
| Sales Executive | Other | Baku, Azerbaijan (Hybrid) | Full-time | — | 2026-09-10 | [View](${alumilDetailUrl}) |
---
Powered by [Workable](https://www.workable.com)
`;
    const alumilDetailMd = `# Sales Executive
> ALUMIL · Baku, Azerbaijan (Hybrid) · Full-time · Posted 2026-09-10
**Workplace:** hybrid
## Description
Sales Executive based in Azerbaijan.
## Requirements
4+ years of experience in sales.
## Apply
[Apply at ALUMIL](https://apply.workable.com/alumil/j/AD3F562A59/apply)
`;
    const accepted: any[] = [];
    const collector = new WorkableCollector(
      'alumil',
      makeReader({
        [`${WORKABLE_ORIGIN}/robots.txt`]: ROBOTS_ALLOW,
        [alumilListUrl]: alumilListMd,
        [alumilDetailUrl]: alumilDetailMd,
      }),
      async () => {},
      () => new Date('2026-10-26T12:00:00Z'),
    );
    const report = await collector.collect({ maxPages: 10, maxJobs: 100, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report).toMatchObject({
      source: 'alumil',
      complete: true,
      discovered: 1,
      fetched: 1,
      accepted: 1,
      failed: 0,
    });
    expect(accepted[0]).toMatchObject({
      externalId: 'alumil:AD3F562A59',
      title: 'Sales Executive',
      company: 'ALUMIL',
      location: 'Baku, Azerbaijan (Hybrid)',
      url: 'https://apply.workable.com/alumil/j/AD3F562A59',
      rawPayload: {
        source: 'alumil',
        workplaceType: 'hybrid',
      },
    });
  });
});
