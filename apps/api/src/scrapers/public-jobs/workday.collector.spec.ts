import fs from 'node:fs';
import path from 'node:path';
import { WorkdayCollector, parseWorkdayDetail, parseWorkdaySearch, workdayUrl } from './workday.collector';

const at = new Date('2026-10-16T12:00:00Z');
const ROBOTS = 'Sitemap: https://bakerhughes.wd5.myworkdayjobs.com/BakerHughes/siteMap.xml\n\nUser-agent: *\nAllow: /BakerHughes/\nDisallow: /BHSensitiveSite/\nDisallow: /refreshFacet/';
const search = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'workday', 'baker-hughes-search.json'), 'utf8'));
const BASE = 'https://bakerhughes.wd5.myworkdayjobs.com/wday/cxs/bakerhughes/BakerHughes';
// Shape of Workday's public posting JSON (jobPostingInfo); values follow the first search result.
const detail = (over: Record<string, unknown> = {}) => ({
  jobPostingInfo: {
    title: 'Production Technologist', jobReqId: 'R165833', startDate: '2026-10-14', timeType: 'Full time',
    location: 'AZ-Baku-Baku-15th Km of the Baku-Salyan Highway, 1F, Garadag District', country: { descriptor: 'Azerbaijan' },
    jobDescription: '<p><b>Partner with the best</b></p><ul><li>Optimise well production</li></ul><p>Apply online.</p><script>x()</script>',
    externalUrl: 'https://bakerhughes.wd5.myworkdayjobs.com/BakerHughes/job/AZ-Baku/Production-Technologist_R165833', ...over,
  },
});

describe('Workday career sites', () => {
  it('preserves BP RQ requisition identity and closing date with the same collector', async () => {
    const base = 'https://bpinternational.wd3.myworkdayjobs.com/wday/cxs/bpinternational/bpCareers';
    const path = '/job/Azerbaijan---Baku/Staff-Software-Engineer_RQ116746-1';
    const posting = detail({ title: 'Software Engineer', jobReqId: 'RQ116746', startDate: '2026-10-14', endDate: '2026-10-30',
      location: 'Azerbaijan - Baku', externalUrl: 'https://bpinternational.wd3.myworkdayjobs.com/bpCareers' + path });
    expect(workdayUrl('bp-azerbaijan', base + path)).toBe(base + path);
    expect(() => workdayUrl('bp-azerbaijan', base + path + '/apply')).toThrow();
    expect(() => workdayUrl('bp-azerbaijan', BASE + '/jobs')).toThrow();
    const read = jest.fn(async (u: string) => u.endsWith('/robots.txt')
      ? 'User-agent: *\nDisallow: /bpCareers/\nDisallow: /refreshFacet/' : JSON.stringify(posting));
    const post = jest.fn(async () => ({total: 1, jobPostings: [{externalPath: path}]}));
    const accept = jest.fn(async () => {});
    expect(await new WorkdayCollector('bp-azerbaijan', read, post, async () => {}, () => at)
      .collect({maxPages: 2, maxJobs: 3, delayMs: 1500}, accept)).toMatchObject({complete: true, accepted: 1, failed: 0});
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({externalId:'bp-azerbaijan:RQ116746', company:'bp Azerbaijan',
      location:'Azerbaijan - Baku', deadline:'2026-10-30T19:59:59.000Z'}));
    expect(read.mock.calls.every(([u]) => new URL(u).pathname === '/robots.txt' || new URL(u).pathname.startsWith('/wday/cxs/'))).toBe(true);
    expect(parseWorkdayDetail('bp-azerbaijan', detail({country:{descriptor:'Georgia'}}), path, at)).toBeNull();
  });
  it('reads the real Fugro search response and maps posting from saved fixture', () => {
    const fugroSearch = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'workday', 'fugro-search.json'), 'utf8'));
    const page = parseWorkdaySearch(fugroSearch);
    expect(page.total).toBe(1);
    expect(page.paths).toHaveLength(1);
    const fugroBase = 'https://fugro.wd3.myworkdayjobs.com/wday/cxs/fugro/Careers';
    const postingPath = page.paths[0];
    expect(workdayUrl('fugro', fugroBase + postingPath)).toBe(fugroBase + postingPath);
    const fugroJob = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'workday', 'fugro-job-R0032325.json'), 'utf8'));
    const job = parseWorkdayDetail('fugro', fugroJob, postingPath, new Date('2026-10-26T12:00:00Z'))!;
    expect(job).toMatchObject({
      externalId: 'fugro:R0032325',
      company: 'Fugro',
      title: 'Asset Management Lead',
      location: 'Baku, Azerbaijan',
      postedAt: '2026-10-18T20:00:00.000Z',
      rawPayload: {
        source: 'fugro',
        vendor: 'workday',
        reqId: 'R0032325',
        postedAtBasis: 'source-start-date',
      },
    });
    expect(job.description).toContain('management, maintenance, calibration, and operational readiness');
  });
  it('reads the real search response for Azerbaijan', () => {
    const page = parseWorkdaySearch(search);
    expect(page.total).toBe(5);
    expect(page.paths).toHaveLength(5);
    for (const p of page.paths) expect(() => workdayUrl('baker-hughes', `/wday/cxs/bakerhughes/BakerHughes${p}`)).not.toThrow();
  });

  it('only reaches the search, posting JSON and robots: never apply, sign-in or other hosts', () => {
    for (const u of [`${BASE}/job/AZ-Baku/Production-Technologist_R165833/apply`, 'https://bakerhughes.wd5.myworkdayjobs.com/BakerHughes/userHome', `${BASE}/jobs?x=1`,
      'https://other.wd5.myworkdayjobs.com/wday/cxs/bakerhughes/BakerHughes/jobs', `${BASE}/job/a/b/../../apply_R1`, 'https://bakerhughes.wd5.myworkdayjobs.com/wday/cxs/other/Site/jobs'])
      expect(() => workdayUrl('baker-hughes', u)).toThrow();
  });

  it('maps a posting: Baku location, posting date, plain-text description, career-site URL', () => {
    const job = parseWorkdayDetail('baker-hughes', detail(), search.jobPostings[0].externalPath, at)!;
    expect(job).toMatchObject({ externalId: 'baker-hughes:R165833', company: 'Baker Hughes', title: 'Production Technologist', postedAt: '2026-10-13T20:00:00.000Z', rawPayload: { postedAtBasis: 'source-start-date', vendor: 'workday' } });
    expect(job.location).toBe('Azerbaijan, Baku-Baku-15th Km of the Baku-Salyan Highway, 1F, Garadag District');
    expect(job.description).toBe('Partner with the best\nOptimise well production\nApply online.');
    expect(job.url).toBe('https://bakerhughes.wd5.myworkdayjobs.com/BakerHughes/job/AZ-Baku/Production-Technologist_R165833');
  });

  it('maps a real posting response (saved 16 Oct 2026): requisition with a suffix, posting date and closing date', () => {
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'workday', 'baker-hughes-job-R169768.json'), 'utf8'));
    const p = '/job/AZ-BAKU-ABSERON-SALYAN-HIGHWAY-22-KM/Quality-Compliance-Specialist_R169768-1';
    expect(() => workdayUrl('baker-hughes', `/wday/cxs/bakerhughes/BakerHughes${p}`)).not.toThrow();
    const job = parseWorkdayDetail('baker-hughes', real, p, at)!;
    expect(job).toMatchObject({ externalId: 'baker-hughes:R169768', title: 'Quality Compliance Specialist', location: 'Azerbaijan, BAKU-ABSERON-SALYAN HIGHWAY 22 KM',
      postedAt: '2026-10-13T20:00:00.000Z', deadline: '2026-10-21T19:59:59.000Z', url: real.jobPostingInfo.externalUrl, rawPayload: { timeType: 'Full time' } });
    expect(job.description).toContain('Have fluent Azerbaijani and upper-intermediate English');
    expect(job.description).not.toMatch(/<|&#39;/);
    // A closing date before the posting date is not trusted as a deadline.
    expect(parseWorkdayDetail('baker-hughes', detail({ endDate: '2026-10-01' }), search.jobPostings[0].externalPath, at)!.deadline).toBeUndefined();
  });

  it('drops a fuzzy search hit outside Azerbaijan and never trusts a future or malformed date', () => {
    expect(parseWorkdayDetail('baker-hughes', detail({ country: { descriptor: 'Kazakhstan' } }), search.jobPostings[0].externalPath, at)).toBeNull();
    expect(parseWorkdayDetail('baker-hughes', detail({ startDate: '2027-01-01' }), search.jobPostings[0].externalPath, at)!.rawPayload).toMatchObject({ postedAtBasis: 'first-observed' });
    expect(() => parseWorkdayDetail('baker-hughes', { error: 'x' }, search.jobPostings[0].externalPath, at)).toThrow();
  });

  it('collects the complete list with pacing; a count change or 429 stops without a complete listing', async () => {
    const read = jest.fn(async (u: string) => (u.endsWith('/robots.txt') ? ROBOTS : JSON.stringify(detail({ jobReqId: /_(R\d+)/.exec(u)![1] }))));
    const post = jest.fn(async () => search);
    const accepted: string[] = [];
    const report = await new WorkdayCollector('baker-hughes', read, post, async () => {}, () => at).collect({ maxPages: 5, maxJobs: 50, delayMs: 1500 }, async (j) => { accepted.push(j.externalId); });
    expect(report).toMatchObject({ complete: true, discovered: 5, accepted: 5, failed: 0, pages: 1 });
    expect(post).toHaveBeenCalledWith(`${BASE}/jobs`, { appliedFacets: {}, limit: 20, offset: 0, searchText: 'Azerbaijan' });
    expect(new Set(accepted).size).toBe(5);

    const blocked = jest.fn(async (u: string) => { if (u.endsWith('/robots.txt')) return ROBOTS; throw new Error('Source HTTP 429'); });
    const r2 = await new WorkdayCollector('baker-hughes', blocked, post, async () => {}, () => at).collect({ maxPages: 5, maxJobs: 50, delayMs: 1500 }, async () => {});
    expect(r2.complete).toBe(false); expect(r2.error).toContain('429'); expect(blocked).toHaveBeenCalledTimes(2);
  });

  it('honours robots before the search', async () => {
    const post = jest.fn();
    const report = await new WorkdayCollector('baker-hughes', async () => 'User-agent: *\nDisallow: /wday/', post, async () => {}, () => at).collect({ maxPages: 1, maxJobs: 5, delayMs: 1500 }, async () => {});
    expect(report.complete).toBe(false); expect(post).not.toHaveBeenCalled();
  });
});
