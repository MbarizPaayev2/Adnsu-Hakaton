import { AbbCollector, ABB_ORIGIN, abbDate, abbUrl, parseAbbJob, parseAbbPage } from './abb.collector';
import { fetchPublicDocument } from './public-job-collector';
import { parseImportArgs } from '../../scripts/import-public-jobs';

const NOW = new Date('2026-10-01T12:00:00Z');
const row = (id = 5357, changes: Record<string, unknown> = {}) => ({ id, title: 'Satış mütəxəssisi - Lənkəran', description: '<p>Bank məhsulları &amp; xidmətlər.</p><script>private-script</script><ul><li>Ali təhsil.</li></ul>',
  url: `${ABB_ORIGIN}/vakansiyalar/v2/${id}`, is_public: 1, status: '1', begin_date: '01.10.2026', end_date: '01.11.2026', type: 'Tam gün', term: 'Daimi', ...changes });
const page = (data: unknown[], number = 1, total = data.length, next: string | null = null) => JSON.stringify({ current_page: number, last_page: next ? number + 1 : number, total, data, next_page_url: next });
const opts = { maxPages: 3, maxJobs: 50, delayMs: 1500 };

describe('ABB public feed', () => {
  it('preserves original links, source dates and explicit regional location; strips executable content', () => {
    expect(parseAbbJob(row(), NOW)).toMatchObject({ externalId: 'abb:5357', company: 'ABB', location: 'Lənkəran', url: `${ABB_ORIGIN}/vakansiyalar/v2/5357`, postedAt: '2026-09-30T20:00:00.000Z', deadline: '2026-11-01T19:59:59.999Z', description: 'Bank məhsulları & xidmətlər.\nAli təhsil.' });
  });
  it('does not invent Baku when the feed has no city field', () => {
    expect(parseAbbJob(row(1, { title: 'Backend proqramçı' }), NOW)?.location).toBe('Azerbaijan');
    expect(parseAbbJob(row(2, { title: 'Müştəri təmsilçisi - Gəncə' }), NOW)?.location).toBe('Gəncə');
  });
  it('does not count unknown visibility or missing identity as an inactive job', () => {
    expect(() => parseAbbJob({}, NOW)).toThrow('identity/status');
    expect(() => parseAbbJob(row(1, { is_public: undefined }), NOW)).toThrow('identity/status');
  });
  it.each([{ is_public: 0 }, { status: '0' }, { begin_date: '02.10.2026', end_date: '02.11.2026' }])('skips non-public, inactive and not-yet-open rows %j', (changes) => {
    expect(parseAbbJob(row(1, changes), NOW)).toBeNull();
  });
  it.each([{ id: '5357' }, { url: `${ABB_ORIGIN}/vakansiyalar/v2/999` }, { description: '<script>only-script</script>' }, { end_date: 'bad' }, { end_date: '30.09.2026' }])('rejects malformed details %j', (changes) => {
    expect(() => parseAbbJob(row(5357, changes), NOW)).toThrow();
  });
  it.each(['31.02.2026', '00.10.2026', '01.13.2026', '2026-10-01'])('validates calendar dates %s', (date) => expect(() => abbDate(date)).toThrow());
  it.each(['https://example.com/api/vacancy/v2/get', `${ABB_ORIGIN}/login`, `${ABB_ORIGIN}/api/vacancy/v2/get?page=2&page=3`, `${ABB_ORIGIN}/api/vacancy/v2/get?page=0`, `${ABB_ORIGIN}/api/vacancy/v2/get?token=private`, `${ABB_ORIGIN}/vakansiyalar/v2/5357?redirect=private`])('refuses unsupported URL %s', (url) => expect(() => abbUrl(url)).toThrow());
  it('requires coherent consecutive pagination, not arbitrary next endpoints', () => {
    expect(() => parseAbbPage(page([row()], 1, 2, 'https://example.com/page=2'), 1)).toThrow();
    expect(() => parseAbbPage(page([row()], 1, 2, `${ABB_ORIGIN}/api/vacancy/v2/get?page=3`), 1)).toThrow();
    expect(() => parseAbbPage(page([], 1, 10), 1)).toThrow();
  });
  it('collects all pages, including existing IDs, with limits and pause before each request', async () => {
    const read = jest.fn(async (url: string) => url.endsWith('robots.txt') ? 'User-agent: *\nDisallow:' : url.includes('page=2') ? page([row(2)], 2, 2) : page([row()], 1, 2, `${ABB_ORIGIN}/api/vacancy/v2/get?page=2`));
    const pause = jest.fn(async () => {}), accepted = jest.fn(async () => {});
    expect(await new AbbCollector(read, pause, () => NOW).collect(opts, accepted)).toMatchObject({ complete: true, pages: 2, accepted: 2 });
    expect(accepted).toHaveBeenCalledTimes(2); expect(pause.mock.calls).toEqual([[1500], [1500]]);
  });
  it('refreshes expired deadlines rather than leaving an old future deadline active', async () => {
    const accept = jest.fn(async () => {});
    const report = await new AbbCollector(async (url) => url.endsWith('robots.txt') ? 'User-agent: *\nAllow: /' : page([row(1, { begin_date: '01.09.2026', end_date: '30.09.2026' })]), async () => {}, () => NOW).collect(opts, accept);
    expect(report).toMatchObject({ complete: true, accepted: 1, expired: 1 });
    expect(accept.mock.calls[0][0]).toMatchObject({ deadline: '2026-09-30T19:59:59.999Z' });
  });
  it('marks capped collection incomplete even when the cap falls inside the last page', async () => {
    expect(await new AbbCollector(async (url) => url.endsWith('robots.txt') ? 'User-agent: *\nAllow: /' : page([row(1), row(2)]), async () => {}, () => NOW).collect({ ...opts, maxJobs: 1 }, async () => {})).toMatchObject({ complete: false, fetched: 1, accepted: 1 });
  });
  it('stops for access errors without retrying or counting success', async () => {
    const read = jest.fn(async (url: string) => { if (url.endsWith('robots.txt')) return 'User-agent: *\nAllow: /'; throw new Error('Source HTTP 429'); });
    expect(await new AbbCollector(read, async () => {}, () => NOW).collect(opts, async () => {})).toMatchObject({ complete: false, accepted: 0, error: 'Source HTTP 429' });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('does not access forbidden or unrecognized robots responses', async () => {
    for (const robots of ['User-agent: *\nDisallow: /api/', '<html>challenge</html>']) {
      const read = jest.fn(async () => robots);
      expect(await new AbbCollector(read, async () => {}).collect(opts, async () => {})).toMatchObject({ complete: false, pages: 0 });
      expect(read).toHaveBeenCalledTimes(1);
    }
  });
  it('reports parsing and destination failures without claiming complete coverage', async () => {
    const reader = (data: unknown[]) => async (url: string) => url.endsWith('robots.txt') ? 'User-agent: *\nAllow: /' : page(data);
    expect(await new AbbCollector(reader([row(1, { description: '' })]), async () => {}, () => NOW).collect(opts, async () => {})).toMatchObject({ failed: 1, complete: false });
    expect(await new AbbCollector(reader([row(1)]), async () => {}, () => NOW).collect(opts, async () => { throw new Error('Import API HTTP 500'); })).toMatchObject({ accepted: 0, complete: false, error: 'Import API HTTP 500' });
  });
  it('supports ABB in the existing preview-first CLI without enabling apply by default', () => {
    expect(parseImportArgs(['--source', 'abb'])).toMatchObject({ source: 'abb', apply: false });
    expect(() => parseImportArgs(['--source', 'unreviewed'])).toThrow();
  });
  it('validates redirect destinations and JSON content type before reading', async () => {
    const request = jest.spyOn(global, 'fetch');
    try {
      request.mockResolvedValueOnce(new Response('external', { status: 302, headers: { location: 'https://example.com/private' } }));
      await expect(fetchPublicDocument(`${ABB_ORIGIN}/api/vacancy/v2/get`, abbUrl, ['application/json'])).rejects.toThrow('Unsupported ABB');
      expect(request).toHaveBeenCalledTimes(1);
      request.mockResolvedValueOnce(new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } }));
      await expect(fetchPublicDocument(`${ABB_ORIGIN}/api/vacancy/v2/get`, abbUrl, ['application/json'])).rejects.toThrow('content type');
    } finally { request.mockRestore(); }
  });
});
