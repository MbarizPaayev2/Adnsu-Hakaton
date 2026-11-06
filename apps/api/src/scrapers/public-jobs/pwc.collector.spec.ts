import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { PWC_LIST, PWC_ORIGIN, PwcCollector, parsePwcJob, parsePwcListing, publicPhenomData, pwcUrl } from './pwc.collector';
const NOW = new Date('2026-10-01T12:00:00Z');
const ID = '123456WD', URL = `${PWC_ORIGIN}/ea/en/job/${ID}/Engineer`;
const script = (data: unknown) => `<script>phApp.ddo = ${JSON.stringify(data)}; phApp.sessionParams = {"doNotCollect":"private-session-fixture"};</script>`;
const row = { jobId: ID, title: 'Engineer', country: 'Azerbaijan', visibilityType: 'External' };
const list = (jobs: unknown[] = [row], total = jobs.length, country = ['Azerbaijan']) => script({ eagerLoadRefineSearch: { status: 200, hits: jobs.length, totalHits: total, data: { jobs, ui_selections: { country } } } });
const detail = (overrides: Record<string, any> = {}, status = 'OPEN', id = ID) => script({ jobDetail: { status: 200, hits: 1, data: { job: { ...row, jobId: id, postingStatus: status } } } }) +
  `<link rel="canonical" href="${URL}"><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', identifier: { value: ID }, hiringOrganization: { name: 'Pwc CEE' }, jobLocation: { address: { addressCountry: 'Azerbaijan', addressLocality: 'Baku' } }, title: 'Engineer', datePosted: '2026-09-11', description: 'Requirements &lt;p&gt;TypeScript &amp; SQL.&lt;/p&gt;&lt;script&gt;not-content&lt;/script&gt;', ...overrides }).replace(/</g, '\\u003c')}</script>`;
const opts = { maxPages: 3, maxJobs: 50, delayMs: 1500 };

describe('PwC public Azerbaijan careers', () => {
  it('parses the JSON literal without executing script or keeping session data', () => {
    const data = { nested: { description: 'quoted " value }; with braces { and backslash \\' } };
    expect(publicPhenomData(script(data))).toEqual(data);
    expect(() => publicPhenomData('<script>phApp.ddo = { unquoted: execute() };</script>')).toThrow();
    expect(() => publicPhenomData('<script>phApp.ddo = {"incomplete":true</script>')).toThrow();
    expect(() => publicPhenomData('<h1>challenge</h1>')).toThrow();
  });
  it('uses the verified public links and requires the country filter', () => {
    expect(parsePwcListing(list())).toEqual({ total: 1, urls: [URL] });
    expect(parsePwcListing(list([{ ...row, title: 'Tax & Legal Department' }])).urls[0]).toBe(`${PWC_ORIGIN}/ea/en/job/${ID}/Tax-Legal-Department`);
    expect(() => parsePwcListing(list([row], 1, ['United States']))).toThrow();
    expect(() => parsePwcListing(list([{ ...row, country: 'United States' }]))).toThrow();
    expect(() => parsePwcListing(list([{ ...row, visibilityType: 'Internal' }]))).toThrow();
    expect(() => parsePwcListing(list([row, row]))).toThrow();
  });
  it('recognizes explicit empty results and exposes a larger result count as incomplete', () => {
    expect(parsePwcListing(list([]))).toEqual({ total: 0, urls: [] });
    expect(parsePwcListing(list([row], 20))).toEqual({ total: 20, urls: [URL] });
    expect(() => parsePwcListing(list([], 1))).toThrow();
  });
  it('imports full job metadata and original link, without invented deadlines or candidate/session data', async () => {
    const job = parsePwcJob(detail(), URL, NOW)!;
    expect(job).toMatchObject({ externalId: `pwc:${ID}`, title: 'Engineer', company: 'PwC', location: 'Baku', postedAt: '2026-09-10T20:00:00.000Z', url: URL, description: 'Requirements\nTypeScript & SQL.' });
    expect(job.deadline).toBeUndefined();
    expect(JSON.stringify(job)).not.toContain('doNotCollect');
    expect(await validate(plainToInstance(IngestJobDto, job))).toEqual([]);
    expect(parsePwcJob(detail({ description: 'Requirements<p>TypeScript &amp; SQL.</p><script>not-content</script>' }), URL, NOW)?.description).toBe(job.description);
  });
  it('rejects identity mismatches, changed status and invalid content', () => {
    for (const html of [detail({ identifier: { value: '999999WD' } }), detail({}, 'UNKNOWN'), detail({}, 'OPEN', '999999WD'), detail({ hiringOrganization: { name: 'Other' } }), detail({ description: '' }), detail({ description: 'x'.repeat(40_001) }), detail({ datePosted: '2026-02-31' }), detail({ validThrough: '2027-01-01' }), detail().replace(URL, `${PWC_ORIGIN}/ea/en/job/999999WD/Engineer`)]) expect(() => parsePwcJob(html, URL, NOW)).toThrow();
  });
  it('excludes confirmed closed, foreign, internal and future postings', () => {
    expect(parsePwcJob(detail({}, 'CLOSED'), URL, NOW)).toBeNull();
    expect(parsePwcJob(detail({ jobLocation: { address: { addressCountry: 'US', addressLocality: 'Phoenix, AZ' } } }), URL, NOW)).toBeNull();
    expect(parsePwcJob(detail({ datePosted: '2026-10-03' }), URL, NOW)).toBeNull();
    expect(parsePwcJob(detail().replace('External', 'Internal'), URL, NOW)).toBeNull();
  });
  it.each(['https://example.com/ea/en/job/123456WD/Engineer', 'https://jobs-cee.pwc.com/ea/en/apply/123456WD', `${URL}?token=unsafe`, `${URL}#private`, 'https://jobs-cee.pwc.com/ea/en/job/123456WD/E%2Fprivate'])('refuses unsupported URL %s', input => expect(() => pwcUrl(input)).toThrow());
  it('collects public source details with bounded spacing and no browser/widget requests', async () => {
    const read = jest.fn(async (url: string) => url.endsWith('robots.txt') ? 'User-agent: *\nDisallow: /apply/' : url === PWC_LIST ? list() : detail());
    const pause = jest.fn(async () => {}), accept = jest.fn(async () => {});
    expect(await new PwcCollector(read, pause, () => NOW).collect(opts, accept)).toMatchObject({ complete: true, accepted: 1, fetched: 1, pages: 1 });
    expect(read.mock.calls.map(([url]) => url)).toEqual([`${PWC_ORIGIN}/robots.txt`, PWC_LIST, URL]);
    expect(pause).toHaveBeenCalledTimes(2); expect(accept).toHaveBeenCalledTimes(1);
  });
  it('does not claim full coverage when pagination is unverified, details change or robots block access', async () => {
    const read = async (url: string) => url.endsWith('robots.txt') ? 'User-agent: *\nAllow: /' : url === PWC_LIST ? list([row], 20) : detail();
    expect(await new PwcCollector(read, async () => {}, () => NOW).collect(opts, async () => {})).toMatchObject({ complete: false, discovered: 20, fetched: 1 });
    expect(await new PwcCollector(async url => url === URL ? '<h1>challenge</h1>' : read(url), async () => {}, () => NOW).collect(opts, async () => {})).toMatchObject({ complete: false, failed: 1 });
    const blocked = jest.fn(async () => 'User-agent: *\nDisallow: /');
    expect(await new PwcCollector(blocked, async () => {}).collect(opts, async () => {})).toMatchObject({ complete: false, pages: 0 });
    expect(blocked).toHaveBeenCalledTimes(1);
  });
  it('stops on transport and destination errors rather than claiming a successful import', async () => {
    const read = async (url: string) => url.endsWith('robots.txt') ? 'User-agent: *\nAllow: /' : url === PWC_LIST ? list() : detail();
    expect(await new PwcCollector(read, async () => {}, () => NOW).collect(opts, async () => { throw new Error('Import API HTTP 500'); })).toMatchObject({ complete: false, accepted: 0, error: 'Import API HTTP 500' });
    expect(await new PwcCollector(async () => { throw new Error('Source HTTP 403'); }, async () => {}).collect(opts, async () => {})).toMatchObject({ complete: false, pages: 0, error: 'Source HTTP 403' });
    await expect(new PwcCollector(read, async () => {}).collect({ ...opts, maxJobs: -1 }, async () => {})).rejects.toThrow();
  });
});
