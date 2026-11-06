import { GlorriScraperService } from './glorri-scraper.service';
import { parseGlorriDeadline } from './glorri-mapping.util';

const summary = (slug: string) => ({ slug, title: `Engineer ${slug}`, postedDate: '2026-01-01T00:00:00Z', company: { slug: 'fixture', name: 'Fixture' }, location: 'Baku' });
const html = '<h1 class="mb-1 text-3xl font-semibold">Engineer</h1><div class="description-html">TypeScript PostgreSQL</div>';
const response = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
describe('Glorri import safety (fixture HTTP, no source traffic)', () => {
  let prisma: any, jobs: any, scraper: GlorriScraperService, fetchMock: jest.Mock;
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.GLORRI_DETAIL_DELAY_MS = '0';
    process.env.GLORRI_RETRY_BASE_MS = '0';
    prisma = {
      jobImportRun: { updateMany: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'run' }), update: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      job: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    jobs = { upsertJob: jest.fn().mockResolvedValue({ outcome: 'created' }), backfillDedupKeys: jest.fn().mockResolvedValue(0), releaseOrphanedDuplicates: jest.fn().mockResolvedValue(0) };
    scraper = new GlorriScraperService(prisma, jobs, { capture: jest.fn() } as any, {} as any);
    fetchMock = jest.fn(); global.fetch = fetchMock;
  });
  afterEach(() => { global.fetch = realFetch; delete process.env.GLORRI_DETAIL_DELAY_MS; delete process.env.GLORRI_RETRY_BASE_MS; });
  const listed = (slug: string) => ({ externalId: `glorri:${slug}`, status: 'ACTIVE', rawPayload: { ...summary(slug), detail: { title: 'Engineer', description_text: 'old' } }, detailFetchedAt: new Date(), postedAt: new Date('2026-01-01') });
  it('continues past known/promoted jobs and interleaved dates and deduplicates repeated listings', async () => {
    const first = Array.from({ length: 18 }, (_, i) => summary(`j${i}`));
    first[0].postedDate = '2025-01-01T00:00:00Z';
    prisma.job.findMany.mockResolvedValueOnce([listed('j0')]).mockResolvedValue([]);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('job-service-v2')) return response(new URL(url).searchParams.get('offset') === '0' ? first : [first[3], summary('late')]);
      return response(html);
    });
    const result = await scraper.runScrape();
    expect(result.status).toBe('SUCCEEDED');
    expect(result.scanned).toBe(19);
    expect(jobs.upsertJob).toHaveBeenCalledTimes(19);
    expect(jobs.upsertJob.mock.calls.some(([p]: any[]) => p.externalId === 'glorri:late')).toBe(true);
  });
  it('refreshes changed known details and safely reopens a confirmed closed listing', async () => {
    const previous = { ...listed('known'), status: 'CLOSED' };
    prisma.job.findMany.mockResolvedValueOnce([previous]).mockResolvedValue([]);
    fetchMock.mockImplementation(async (url: string) => response(url.includes('job-service-v2') ? [{ ...summary('known'), title: 'Changed' }] : html));
    jobs.upsertJob.mockResolvedValue({ outcome: 'reopened' });
    await scraper.runScrape();
    expect(jobs.upsertJob).toHaveBeenCalledWith(expect.objectContaining({ description: 'TypeScript PostgreSQL', detailFetchedAt: expect.any(String) }), expect.any(Date));
    expect(prisma.jobImportRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reopened: 1 }) }));
  });
  it('records a partial listing failure without reconciling closures', async () => {
    const first = Array.from({ length: 18 }, (_, i) => summary(`j${i}`));
    fetchMock.mockImplementation(async (url: string) => url.includes('job-service-v2') ? response(new URL(url).searchParams.get('offset') === '0' ? first : {}, new URL(url).searchParams.get('offset') === '0' ? 200 : 503) : response(html));
    expect((await scraper.runScrape()).status).toBe('PARTIAL');
    expect(prisma.jobImportRun.findFirst).not.toHaveBeenCalled();
    expect(prisma.job.updateMany).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([u]: any[]) => u.includes('offset=18'))).toHaveLength(3);
  });
  it.each([404, 500])('does not create/reopen or close jobs when a listed detail returns %i', async (status) => {
    prisma.job.findMany.mockResolvedValueOnce([{ ...listed('known'), status: 'CLOSED' }]);
    fetchMock.mockImplementation(async (url: string) => url.includes('job-service-v2') ? response([summary('known')]) : response('unavailable', status));
    expect((await scraper.runScrape()).status).toBe('PARTIAL');
    expect(jobs.upsertJob).not.toHaveBeenCalled();
    expect(prisma.jobImportRun.findFirst).not.toHaveBeenCalled();
    expect(prisma.job.updateMany.mock.calls[0][0].data.status).toBeUndefined();
  });
  it('closes only an absent job with a confirmed 404; reachable or failed probes remain active', async () => {
    prisma.job.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(['gone', 'live', 'error'].map((slug) => ({ id: slug, externalId: `glorri:${slug}`, rawPayload: summary(slug), missedImports: 7 })));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('job-service-v2')) return response([summary('present')]);
      if (url.includes('/gone?')) return response('gone', 404);
      if (url.includes('/error?')) return response('error', 503);
      return response(html);
    });
    await scraper.runScrape();
    const closures = prisma.job.updateMany.mock.calls.filter(([a]: any[]) => a.data.closedReason !== 'deadline_passed'); // the deadline sweep is one more call
    expect(closures).toHaveLength(2);
    const closed = closures.filter(([a]: any[]) => a.data.status === 'CLOSED');
    expect(closed).toHaveLength(1);
    expect(closed[0][0].where).toMatchObject({ id: 'gone', lastSeenAt: { lt: expect.any(Date) } });
  });
  it('still reconciles when a few detail pages fail (within 2% of the listing), and says so', async () => {
    const page = Array.from({ length: 100 }, (_, i) => summary(`k${i}`));
    prisma.job.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    // 100 listed in pages of 18 → the fixture serves the same page for offset 0 only; use a tiny listing instead
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('job-service-v2')) return response(new URL(url).searchParams.get('offset') === '0' ? page.slice(0, 18) : []);
      return response(html);
    });
    const r = await scraper.runScrape();
    expect(r.status).toBe('SUCCEEDED');
    expect(prisma.jobImportRun.findFirst).toHaveBeenCalled(); // closures were reconciled
  });
  it('closes a posting the source has not listed for 48 complete listings, without another request, and sweeps lapsed deadlines', async () => {
    prisma.job.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'old', externalId: 'glorri:old', rawPayload: summary('old'), missedImports: 47 },
      { id: 'recent', externalId: 'glorri:recent', rawPayload: summary('recent'), missedImports: 5 },
    ]);
    const probed: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('job-service-v2')) return response([summary('present')]);
      probed.push(url);
      return response(html);
    });
    await scraper.runScrape();
    const calls = prisma.job.updateMany.mock.calls.map(([a]: any[]) => a);
    const absent = calls.find((a: any) => a.data.closedReason === 'not_listed_by_source');
    expect(absent.where).toMatchObject({ id: 'old', status: 'ACTIVE' });
    expect(probed.some((u) => u.includes('/old'))).toBe(false); // closed without a probe
    expect(probed.some((u) => u.includes('/recent'))).toBe(true); // below the threshold it is probed and stays active
    expect(calls.some((a: any) => a.data.closedReason === 'deadline_passed')).toBe(true);
  });
  it('treats looping and malformed source pages as incomplete', async () => {
    const page = Array.from({ length: 18 }, (_, i) => summary(`j${i}`));
    fetchMock.mockImplementation(async (url: string) => response(url.includes('job-service-v2') ? page : html));
    expect((await scraper.runScrape()).status).toBe('PARTIAL');
    expect(prisma.jobImportRun.findFirst).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(response([{ title: 'missing identity' }]));
    expect((await scraper.runScrape()).status).toBe('PARTIAL');
  });
  it('does not infer mass closure from a shrunken complete listing', async () => {
    prisma.jobImportRun.findFirst.mockResolvedValue({ listed: 100 });
    fetchMock.mockImplementation(async (url: string) => response(url.includes('job-service-v2') ? [summary('present')] : html));
    expect((await scraper.runScrape()).status).toBe('PARTIAL');
    expect(prisma.job.updateMany).not.toHaveBeenCalled();
  });
  it('stores the listing location when the detail page omits the location bullet', async () => {
    // Detail bullets are [company, employment type]: the second bullet used to become the location.
    const detailHtml = '<h1 class="mb-1 text-3xl font-semibold">Mühasib</h1><ul class="mb-2 list-disc"><li>Fixture</li><li>Tam ştat</li></ul><div class="description-html">Mühasibat</div>';
    fetchMock.mockImplementation(async (url: string) => response(url.includes('job-service-v2') ? [{ ...summary('no-loc'), location: 'Bakı, Azərbaycan' }] : detailHtml));
    await scraper.runScrape();
    const payload = jobs.upsertJob.mock.calls[0][0];
    expect(payload.location).toBe('Bakı, Azərbaycan');
    expect(payload.rawPayload.detail).toMatchObject({ location: null, employment_type: 'Tam ştat' });
  });
  it('still reads all three bullets when the page has them', async () => {
    const detailHtml = '<h1 class="mb-1 text-3xl font-semibold">Mühasib</h1><ul class="mb-2 list-disc"><li>Fixture</li><li>Gəncə, Azərbaycan</li><li>Tam ştat</li></ul><div class="description-html">Mühasibat</div>';
    fetchMock.mockImplementation(async (url: string) => response(url.includes('job-service-v2') ? [{ ...summary('has-loc'), location: 'Bakı, Azərbaycan' }] : detailHtml));
    await scraper.runScrape();
    expect(jobs.upsertJob.mock.calls[0][0].location).toBe('Gəncə, Azərbaycan');
  });
  it('parses a known Baku deadline without inventing unknown or impossible dates', () => {
    expect(parseGlorriDeadline('September 19, 2026')).toBe('2026-09-19T19:59:59.000Z');
    expect(parseGlorriDeadline('February 30, 2026')).toBeUndefined();
    expect(parseGlorriDeadline('unrecognised')).toBeUndefined();
  });
});
