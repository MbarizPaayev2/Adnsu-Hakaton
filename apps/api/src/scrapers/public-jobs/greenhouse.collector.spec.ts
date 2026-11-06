import * as fs from 'fs';
import * as path from 'path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import { GreenhouseCollector } from './greenhouse.collector';
import {
  greenhouseUrl,
  greenhouseListApiUrl,
  greenhouseDetailApiUrl,
  parseGreenhouseListing,
  parseGreenhouseDetail,
  GREENHOUSE_API_ORIGIN,
  GREENHOUSE_JOB_BOARDS_ORIGIN,
  GREENHOUSE_TENANTS,
} from './greenhouse.parser';

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'greenhouse');
const listFixture = fs.readFileSync(path.join(FIXTURES_DIR, 'wolt-list.json'), 'utf8');
const detailFixture = fs.readFileSync(path.join(FIXTURES_DIR, 'wolt-detail-6693347.json'), 'utf8');
const completeListFixture = JSON.stringify({ ...JSON.parse(listFixture), meta: { total: 3 } });

const ROBOTS = 'User-agent: *\nDisallow: /embed/\n';
const NOW = new Date('2026-10-27T12:00:00Z');
const opts = { maxPages: 1, maxJobs: 50, delayMs: 1000 };
const greenhouseCanonicalForTest = (id: number) => `https://job-boards.greenhouse.io/wolt/jobs/${id}`;

const setup = (pages: Record<string, string | Error>) => {
  const read = jest.fn(async (url: string) => {
    const v = pages[url];
    if (v instanceof Error) throw v;
    if (v === undefined) throw new Error(`Unexpected URL: ${url}`);
    return v;
  });
  const accept = jest.fn(async () => undefined);
  return {
    collector: new GreenhouseCollector('wolt', read, async () => undefined, () => NOW),
    read,
    accept,
  };
};

describe('Greenhouse career board and API (Wolt)', () => {
  describe('greenhouseUrl validation', () => {
    it('accepts valid Greenhouse API endpoints and board URLs', () => {
      expect(greenhouseUrl('wolt', 'https://boards-api.greenhouse.io/robots.txt'))
        .toBe('https://boards-api.greenhouse.io/robots.txt');
      expect(greenhouseUrl('wolt', 'https://boards-api.greenhouse.io/v1/boards/wolt/jobs'))
        .toBe('https://boards-api.greenhouse.io/v1/boards/wolt/jobs');
      expect(greenhouseUrl('wolt', 'https://boards-api.greenhouse.io/v1/boards/wolt/jobs?content=true'))
        .toBe('https://boards-api.greenhouse.io/v1/boards/wolt/jobs?content=true');
      expect(greenhouseUrl('wolt', 'https://boards-api.greenhouse.io/v1/boards/wolt/jobs/6693347'))
        .toBe('https://boards-api.greenhouse.io/v1/boards/wolt/jobs/6693347');
      expect(greenhouseUrl('wolt', 'https://job-boards.greenhouse.io/wolt'))
        .toBe('https://job-boards.greenhouse.io/wolt');
      expect(greenhouseUrl('wolt', 'https://job-boards.greenhouse.io/wolt/jobs/6693347'))
        .toBe('https://job-boards.greenhouse.io/wolt/jobs/6693347');
      expect(greenhouseUrl('wolt', 'https://boards.greenhouse.io/wolt/jobs/6693347'))
        .toBe('https://boards.greenhouse.io/wolt/jobs/6693347');
    });

    it('rejects foreign hosts, credentials, directory traversal, and malformed queries', () => {
      expect(() => greenhouseUrl('wolt', 'https://evil.com/wolt/jobs/6693347')).toThrow('wrong origin');
      expect(() => greenhouseUrl('wolt', 'https://user:pass@boards-api.greenhouse.io/v1/boards/wolt/jobs')).toThrow('credentials');
      expect(() => greenhouseUrl('wolt', 'https://boards-api.greenhouse.io/v1/boards/wolt/jobs/..%2fadmin')).toThrow('traversal');
      expect(() => greenhouseUrl('wolt', 'https://boards-api.greenhouse.io/v1/boards/wolt/jobs?filter=evil')).toThrow('unexpected query');
      expect(() => greenhouseUrl('wolt', 'https://boards-api.greenhouse.io/v1/boards/other_tenant/jobs')).toThrow('invalid path');
    });
  });

  describe('parseGreenhouseListing', () => {
    it('extracts Azerbaijan openings and filters out non-Azerbaijan international jobs', () => {
      const listing = parseGreenhouseListing('wolt', listFixture);
      expect(listing.totalDiscovered).toBe(3);
      expect(listing.skippedNonMatching).toBe(2);
      expect(listing.matchingJobs).toHaveLength(1);

      const job = listing.matchingJobs[0];
      expect(job).toMatchObject({
        id: '6693347',
        title: 'Grocery Associate - Wolt Market (full-time)',
        locationName: 'Baku, Azerbaijan',
        absoluteUrl: 'https://job-boards.greenhouse.io/wolt/jobs/6693347',
      });
    });

    it('handles an empty jobs list gracefully', () => {
      const listing = parseGreenhouseListing('wolt', JSON.stringify({ jobs: [] }));
      expect(listing.totalDiscovered).toBe(0);
      expect(listing.skippedNonMatching).toBe(0);
      expect(listing.matchingJobs).toEqual([]);
    });

    it('rejects invalid or missing jobs payloads', () => {
      expect(() => parseGreenhouseListing('wolt', 'not-json')).toThrow();
      expect(() => parseGreenhouseListing('wolt', JSON.stringify({ status: 'ok' }))).toThrow('missing jobs array');
    });

    it('does not treat an AZ entity as proof that a foreign vacancy is in Azerbaijan', () => {
      const job = JSON.parse(detailFixture);
      job.location = { name: 'Berlin, Germany' };
      job.metadata = [{ name: 'Entity', value: 'Wolt Azerbaijan' }];
      expect(parseGreenhouseListing('wolt', { jobs: [job], meta: { total: 1 } }).matchingJobs).toHaveLength(0);
    });
  });

  describe('parseGreenhouseDetail', () => {
    it('turns Wolt detail fixture into a valid IngestJobDto passing class-validator', async () => {
      const dto = parseGreenhouseDetail('wolt', detailFixture, NOW);

      expect(dto).toMatchObject({
        externalId: 'wolt:6693347',
        company: 'Wolt Azerbaijan',
        title: 'Grocery Associate - Wolt Market (full-time)',
        location: 'Baku, Azerbaijan',
        url: 'https://job-boards.greenhouse.io/wolt/jobs/6693347',
      });
      expect(dto.description).toContain('About Wolt');
      expect(dto.description).toContain('Görəcəyiniz işlər');
      expect(dto.description).toContain('Wolt Market');
      expect(dto.rawPayload).toMatchObject({
        source: 'wolt',
        platform: 'greenhouse',
        boardToken: 'wolt',
        metadata: {
          Entity: 'Wolt Services Azerbaijan Limited Liability Company',
          Market: 'Azerbaijan',
        },
      });

      const errors = await validate(plainToInstance(IngestJobDto, dto));
      expect(errors).toEqual([]);
    });

    it('rejects a detail payload with foreign locality', () => {
      const foreignDetail = JSON.parse(detailFixture);
      foreignDetail.location = { name: 'Berlin, Germany' };
      foreignDetail.offices = [{ name: 'Berlin Office', location: 'Berlin, Germany' }];
      foreignDetail.metadata = [{ name: 'Market', value: 'Germany' }, { name: 'Entity', value: 'Wolt Germany GmbH' }];

      expect(() => parseGreenhouseDetail('wolt', JSON.stringify(foreignDetail), NOW))
        .toThrow(/Foreign vacancy rejected/);
    });

    it('rejects detail with empty or missing description', () => {
      const emptyDesc = JSON.parse(detailFixture);
      emptyDesc.content = '   ';
      expect(() => parseGreenhouseDetail('wolt', JSON.stringify(emptyDesc), NOW))
        .toThrow('Missing job content');
    });

    it('rejects mismatched detail identities and keeps missing publication dates distinct from observation', () => {
      const item = JSON.parse(detailFixture);
      const summary = parseGreenhouseListing('wolt', completeListFixture).matchingJobs[0];
      item.id = 999999;
      expect(() => parseGreenhouseDetail('wolt', item, NOW, summary)).toThrow(/listing identity/);
      item.id = 6693347;
      item.first_published = null;
      item.updated_at = '2026-01-01T00:00:00Z';
      const dto = parseGreenhouseDetail('wolt', item, NOW, summary);
      expect(dto.postedAt).toBe(NOW.toISOString());
      expect(dto.rawPayload).toMatchObject({ sourcePostedAt: null, postedAtBasis: 'first-observed' });
    });
  });

  describe('GreenhouseCollector', () => {
    it('collects a Wolt fixture while keeping filtered global coverage incomplete', async () => {
      const listUrl = greenhouseListApiUrl('wolt');
      const detailUrl = greenhouseDetailApiUrl('wolt', '6693347');

      const { collector, accept } = setup({
        [`${GREENHOUSE_API_ORIGIN}/robots.txt`]: ROBOTS,
        [listUrl]: completeListFixture,
        [detailUrl]: detailFixture,
      });

      const report = await collector.collect(opts, accept);

      expect(report).toMatchObject({
        source: 'wolt',
        complete: false,
        outcome: 'BOUNDED_PROGRESS',
        pages: 1,
        discovered: 1,
        totalSeen: 3,
        skipped: 2,
        fetched: 1,
        accepted: 1,
        failed: 0,
      });

      expect(accept).toHaveBeenCalledTimes(1);
      const ingested = accept.mock.calls[0][0] as IngestJobDto;
      expect(ingested.externalId).toBe('wolt:6693347');
      expect(ingested.company).toBe('Wolt Azerbaijan');
      expect(ingested.title).toBe('Grocery Associate - Wolt Market (full-time)');
    });

    it('skips known jobs without fetching detail', async () => {
      const listUrl = greenhouseListApiUrl('wolt');
      const detailUrl = greenhouseDetailApiUrl('wolt', '6693347');

      const { collector, accept, read } = setup({
        [`${GREENHOUSE_API_ORIGIN}/robots.txt`]: ROBOTS,
        [listUrl]: completeListFixture,
        [detailUrl]: detailFixture,
      });

      const isKnown = (id: string) => id === 'wolt:6693347';
      const onListed = jest.fn();
      const report = await collector.collect({ ...opts, isKnown, onListed }, accept);

      expect(report).toMatchObject({
        source: 'wolt',
        complete: false,
        outcome: 'BOUNDED_PROGRESS',
        discovered: 1,
        totalSeen: 3,
        skipped: 2,
        fetched: 0,
        accepted: 0,
        known: 1,
      });

      expect(accept).not.toHaveBeenCalled();
      expect(onListed).toHaveBeenCalledWith('wolt:6693347');
      // Verify detail URL was never requested
      expect(read).not.toHaveBeenCalledWith(detailUrl);
    });

    it('handles zero vacancies cleanly', async () => {
      const listUrl = greenhouseListApiUrl('wolt');

      const { collector, accept } = setup({
        [`${GREENHOUSE_API_ORIGIN}/robots.txt`]: ROBOTS,
        [listUrl]: JSON.stringify({ jobs: [], meta: { total: 0 } }),
      });

      const report = await collector.collect(opts, accept);

      expect(report).toMatchObject({
        source: 'wolt',
        complete: true,
        discovered: 0,
        accepted: 0,
      });
      expect(accept).not.toHaveBeenCalled();
    });

    it('does not infer a full census when the upstream total is missing or traversal resumes', async () => {
      const listUrl = greenhouseListApiUrl('wolt');
      const detailUrl = greenhouseDetailApiUrl('wolt', '6693347');
      const { collector, accept } = setup({
        [`${GREENHOUSE_API_ORIGIN}/robots.txt`]: ROBOTS,
        [listUrl]: listFixture,
        [detailUrl]: detailFixture,
      });
      const report = await collector.collect({ ...opts, resume: { kind: 'page', page: 1 } }, accept);
      expect(report).toMatchObject({ complete: false, outcome: 'BOUNDED_PROGRESS', cursor: { kind: 'page', page: 1 } });
    });

    it('uses the detail budget for a new listing after confirming known listings', async () => {
      const first = JSON.parse(listFixture).jobs[0];
      const second = { ...first, id: 6693348, absolute_url: greenhouseCanonicalForTest(6693348) };
      const detail = { ...JSON.parse(detailFixture), id: 6693348, absolute_url: greenhouseCanonicalForTest(6693348) };
      const listUrl = greenhouseListApiUrl('wolt');
      const { collector, accept } = setup({
        [`${GREENHOUSE_API_ORIGIN}/robots.txt`]: ROBOTS,
        [listUrl]: JSON.stringify({ jobs: [first, second], meta: { total: 2 } }),
        [greenhouseDetailApiUrl('wolt', 6693348)]: JSON.stringify(detail),
      });
      const onListed = jest.fn();
      const report = await collector.collect({ ...opts, maxJobs: 1, isKnown: (id) => id === 'wolt:6693347', onListed }, accept);
      expect(onListed).toHaveBeenCalledWith('wolt:6693347');
      expect(accept).toHaveBeenCalledTimes(1);
      expect(report).toMatchObject({ known: 1, fetched: 1, accepted: 1 });
    });

    it('stops closed when robots.txt disallows jobs path', async () => {
      const { collector, accept } = setup({
        [`${GREENHOUSE_API_ORIGIN}/robots.txt`]: 'User-agent: *\nDisallow: /v1/boards/\n',
      });

      const report = await collector.collect(opts, accept);

      expect(report.complete).toBe(false);
      expect(report.error).toContain('prohibit');
      expect(accept).not.toHaveBeenCalled();
    });

    it('aborts gracefully without crash when detail request encounters HTTP 429 rate limit', async () => {
      const listUrl = greenhouseListApiUrl('wolt');
      const detailUrl = greenhouseDetailApiUrl('wolt', '6693347');

      const { collector, accept } = setup({
        [`${GREENHOUSE_API_ORIGIN}/robots.txt`]: ROBOTS,
        [listUrl]: listFixture,
        [detailUrl]: new Error('Source HTTP 429 (rate limit)'),
      });

      const report = await collector.collect(opts, accept);

      expect(report.complete).toBe(false);
      expect(report.error).toContain('429');
      expect(accept).not.toHaveBeenCalled();
    });

    it('rejects invalid collection limits', async () => {
      const { collector, accept } = setup({});
      await expect(collector.collect({ maxPages: 0, maxJobs: 10, delayMs: 1000 }, accept))
        .rejects.toThrow('Invalid collection limits');
      await expect(collector.collect({ maxPages: 1, maxJobs: 0, delayMs: 1000 }, accept))
        .rejects.toThrow('Invalid collection limits');
      await expect(collector.collect({ maxPages: 1, maxJobs: 10, delayMs: 500 }, accept))
        .rejects.toThrow('Invalid collection limits');
    });
  });
});
