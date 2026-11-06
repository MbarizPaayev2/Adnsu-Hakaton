import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkLinkedInDirectAccess, confirmListedJobs, ingestPublicJob, parseImportArgs, reportImportRun, runImport } from './import-public-jobs';

describe('LinkedIn direct-access diagnostic', () => {
  it('accepts the read-only check only as a standalone LinkedIn command', () => {
    expect(parseImportArgs(['--source', 'linkedin', '--check-direct-access'])).toMatchObject({ checkDirectAccess: true, apply: false });
    expect(() => parseImportArgs(['--source', 'linkedin', '--check-direct-access', '--apply'])).toThrow('read-only');
    expect(() => parseImportArgs(['--source', 'hellojob', '--check-direct-access'])).toThrow('read-only');
  });

  it('requests only robots.txt and reports that automated fetching stays disabled', async () => {
    const fetcher = jest.fn().mockResolvedValue(new Response('User-agent: *\nDisallow: /jobs-guest/\n', { status: 200 }));
    const result = await checkLinkedInDirectAccess(fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://www.linkedin.com/robots.txt');
    expect(result).toMatchObject({ status: 200, robotsDisallowJobsGuest: true, automatedFetchAllowed: false });
  });

  it('fails closed after one network error', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('offline'));
    const result = await checkLinkedInDirectAccess(fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: null, automatedFetchAllowed: false });
  });

  it('caps the robots response body and fails closed', async () => {
    const fetcher = jest.fn().mockResolvedValue(new Response('x'.repeat(256 * 1024 + 1), { status: 200 }));
    const result = await checkLinkedInDirectAccess(fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.status).toBeNull();
    expect(result.automatedFetchAllowed).toBe(false);
  });

  it('does not acquire a lease or invoke a collector', async () => {
    const log = jest.fn();
    const directAccessProbe = jest.fn().mockResolvedValue({ status: 200, robotsDisallowJobsGuest: true, automatedFetchAllowed: false, note: 'blocked' });
    const collectorFor = jest.fn();
    const result = await runImport(['--source', 'linkedin', '--check-direct-access'], {}, { log, directAccessProbe, collectorFor });
    expect(result.exitCode).toBe(0);
    expect(directAccessProbe).toHaveBeenCalledTimes(1);
    expect(collectorFor).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('linkedin-direct-access'));
  });
});

describe('reviewed public source selection', () => {
  it.each(['hellojob', 'abb', 'socar', 'azercell', 'ey', 'pwc', 'halliburton', 'smartjob', 'boss', 'work', 'pasha-holding', 'hrin', 'linkedin', 'yelo'])('permits %s previews but never defaults to writing', (source) => {
    expect(parseImportArgs(['--source', source])).toMatchObject({ source, apply: false, delayMs: 1500 });
  });
  it('refuses an arbitrary employer URL or unreviewed source', () => {
    expect(() => parseImportArgs(['--source', 'https://example.com'])).toThrow();
    expect(() => parseImportArgs(['--source', 'unreviewed-employer'])).toThrow();
  });
});

// Actual HTTP on a temporary loopback port, no database or real token.
describe('public job import HTTP boundary', () => {
  const job = { externalId: 'hellojob:synthetic', title: 'Engineer', company: 'Synthetic Labs', description: 'TypeScript', location: 'Gəncə', url: 'https://www.hellojob.az/vakansiya/synthetic', postedAt: '2026-10-01T00:00:00Z' };
  let server: Server;
  let base: string;
  let requests: { url?: string; authorization?: string; body: string }[];
  let status: number;
  let responseBody: string;
  let redirect: string | undefined;
  beforeEach(async () => {
    requests = []; status = 201; responseBody = JSON.stringify({ success: true, jobId: 'synthetic-job', outcome: 'created' }); redirect = undefined;
    server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      requests.push({ url: req.url, authorization: req.headers.authorization, body });
      res.writeHead(status, { 'content-type': 'application/json', ...(redirect ? { location: redirect } : {}) });
      res.end(responseBody);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });

  it('uses the guarded ingest route and only accepts a saved-job acknowledgement', async () => {
    expect(await ingestPublicJob(job, base, 'synthetic-service-token')).toBe('created');
    expect(requests).toEqual([{ url: '/internal/jobs/ingest', authorization: 'Bearer synthetic-service-token', body: JSON.stringify(job) }]);
  });
  it.each([401, 429, 500])('refuses HTTP %s without retrying or returning private response text', async (code) => {
    status = code; responseBody = 'do-not-report-this-provider-body';
    await expect(ingestPublicJob(job, base, 'synthetic-service-token')).rejects.toThrow(`Import API HTTP ${code}`);
    expect(requests).toHaveLength(1);
  });
  it.each([{ success: false, jobId: 'id' }, { success: true }, { success: true, jobId: '' }, { success: true, jobId: 'id' }, { success: true, jobId: 'id', outcome: 'deleted' }])('does not count an invalid acknowledgement as an imported job: %j', async (value) => {
    responseBody = JSON.stringify(value);
    await expect(ingestPublicJob(job, base, 'synthetic-service-token')).rejects.toThrow('invalid acknowledgement');
  });
  it('does not forward a service token across redirects', async () => {
    status = 307; redirect = `${base}/unexpected`;
    await expect(ingestPublicJob(job, base, 'synthetic-service-token')).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
  it.each(['https://example.com', 'http://127.0.0.1/private', 'http://user:pass@127.0.0.1', 'http://127.0.0.1?token=unsafe'])('refuses an unsafe import destination before sending credentials: %s', async (destination) => {
    await expect(ingestPublicJob(job, destination, 'synthetic-service-token')).rejects.toThrow('loopback');
    expect(requests).toHaveLength(0);
  });
  it('requires a configured service token before contacting the API', async () => {
    await expect(ingestPublicJob(job, base, undefined)).rejects.toThrow('required');
    expect(requests).toHaveLength(0);
  });

  describe('confirm listed postings', () => {
    it('sends externalIds to the guarded confirm-listed endpoint', async () => {
      responseBody = JSON.stringify({ success: true, confirmed: 2, reopened: 1 });
      const result = await confirmListedJobs(['hellojob:1', 'hellojob:2'], base, 'synthetic-service-token');
      expect(result).toEqual({ confirmed: 2, reopened: 1 });
      expect(requests[0].url).toBe('/internal/jobs/confirm-listed');
      expect(JSON.parse(requests[0].body)).toEqual({ externalIds: ['hellojob:1', 'hellojob:2'] });
    });
    it('returns zeroes immediately when given empty array without making HTTP request', async () => {
      const result = await confirmListedJobs([], base, 'synthetic-service-token');
      expect(result).toEqual({ confirmed: 0, reopened: 0 });
      expect(requests).toHaveLength(0);
    });
  });

  describe('run report', () => {
    const report = { source: 'pwc', complete: true, pages: 1, discovered: 3, fetched: 3, accepted: 3, expired: 0, skipped: 0, failed: 0 };
    const tally = { created: 2, updated: 0, reopened: 0, unchanged: 1 };
    it('sends counts only (no job content) to the guarded run route and requires a valid acknowledgement', async () => {
      responseBody = JSON.stringify({ success: true, status: 'SUCCEEDED', closed: 1, closureSkipped: null });
      const result = await reportImportRun(report, tally, new Date('2026-10-02T08:00:00Z'), base, 'synthetic-service-token');
      expect(result).toEqual({ status: 'SUCCEEDED', closed: 1, closureSkipped: null });
      expect(requests[0].url).toBe('/internal/jobs/import-runs');
      expect(JSON.parse(requests[0].body)).toEqual({ source: 'pwc', startedAt: '2026-10-02T08:00:00.000Z', complete: true, pages: 1, discovered: 3, fetched: 3, accepted: 3, created: 2, updated: 0, unchanged: 1, reopened: 0, expired: 0, skipped: 0, failed: 0 });
    });
    it('refuses an unsafe destination or an invalid acknowledgement', async () => {
      await expect(reportImportRun(report, tally, new Date(), 'https://example.com', 'synthetic-service-token')).rejects.toThrow('loopback');
      responseBody = JSON.stringify({ success: true });
      await expect(reportImportRun(report, tally, new Date(), base, 'synthetic-service-token')).rejects.toThrow('invalid acknowledgement');
    });
  });
  it('reads what is already stored from the database (--skip-known, needs --apply); the temp-file option is gone', () => {
    expect(parseImportArgs(['--source', 'work', '--apply', '--skip-known']).skipKnown).toBe(true);
    expect(() => parseImportArgs(['--source', 'work', '--skip-known'])).toThrow('--apply');
    expect(() => parseImportArgs(['--apply', '--skip-known', '--skip-known'])).toThrow('Repeated');
    expect(() => parseImportArgs(['--source', 'work', '--skip-known-file', '/tmp/known.txt'])).toThrow('Unknown option');
  });
  it('sends the lease token on every write, and says it was a segment only when it was', async () => {
    const seen: Record<string, string | undefined>[] = [];
    const server = createServer((req, res) => {
      seen.push({ url: req.url, lease: req.headers['x-source-lease'] as string | undefined });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url?.includes('confirm') ? { success: true, confirmed: 1, reopened: 0 } : req.url?.includes('import-runs') ? { success: true, status: 'PARTIAL', closed: 0 } : { success: true, jobId: 'j', outcome: 'created' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await ingestPublicJob({ externalId: 'work:1' } as any, base, 't', 'LEASE');
      await confirmListedJobs(['work:1'], base, 't', undefined, 'LEASE');
      await reportImportRun({ source: 'work', complete: false, pages: 1, discovered: 1, fetched: 1, accepted: 1, expired: 0, failed: 0 }, { created: 1, updated: 0, reopened: 0, unchanged: 0 }, new Date(), base, 't', 'LEASE', true);
      expect(seen.map((r) => r.lease)).toEqual(['LEASE', 'LEASE', 'LEASE']);
    } finally { server.close(); }
  });
});
