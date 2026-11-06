import { LeverCollector } from './lever.collector';
import { parseLeverFeed, leverUrl, LEVER_API_ORIGIN } from './lever.parser';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IngestJobDto } from '../../jobs/dto/ingest-job.dto';

const O = 'https://jobs.lever.co/xsolla';
const API_URL = 'https://api.lever.co/v0/postings/xsolla?mode=json';
const NOW = new Date('2026-10-04T12:00:00Z');

const validItem = (uuid: string, overrides: Record<string, unknown> = {}) => ({
  id: uuid,
  text: 'Senior Software Engineer (Go)',
  createdAt: 1763389485691,
  hostedUrl: `https://jobs.lever.co/xsolla/${uuid}`,
  applyUrl: `https://jobs.lever.co/xsolla/${uuid}/apply`,
  categories: {
    location: 'Baku',
    allLocations: ['Baku'],
    commitment: 'Full time',
    team: 'GameTech',
    department: 'Technology',
  },
  country: 'AZ',
  workplaceType: 'hybrid',
  descriptionPlain: 'We are seeking a senior Go developer to build high-scale game backend services.',
  lists: [
    {
      text: 'RESPONSIBILITIES',
      content: '<li>Design and maintain scalable microservices in Go.</li><li>Optimize SQL and NoSQL database queries.</li>',
    },
    {
      text: 'REQUIREMENTS',
      content: '<li>3+ years of professional Go experience.</li><li>Strong background in distributed systems.</li>',
    },
  ],
  additionalPlain: 'Privacy policy: https://xsolla.com/privacy',
  ...overrides,
});

const ROBOTS = 'User-agent: *\nAllow: /\nCrawl-delay: 1\n';
const opts = { maxPages: 1, maxJobs: 50, delayMs: 1000 };

const setup = (pages: Record<string, string | Error>) => {
  const read = jest.fn(async (url: string) => {
    const v = pages[url];
    if (v instanceof Error) throw v;
    if (v === undefined) throw new Error(`Unexpected URL: ${url}`);
    return v;
  });
  const accept = jest.fn(async () => undefined);
  return { collector: new LeverCollector('xsolla', read, async () => undefined, () => NOW), read, accept };
};

describe('Lever career feed (Xsolla)', () => {
  it('turns a fully parsed feed into valid, attributed postings with identity and text intact', async () => {
    const item1 = validItem('e05085e1-df4d-4bf2-bcf9-96402d21ac07');
    const item2 = validItem('4190ef3b-bac5-44db-8bfe-bec949708955', {
      text: 'Frontend Engineer (React)',
      workplaceType: 'remote',
    });

    const { collector, accept } = setup({
      [`${LEVER_API_ORIGIN}/robots.txt`]: ROBOTS,
      [API_URL]: JSON.stringify([item1, item2]),
    });

    const report = await collector.collect(opts, accept);
    expect(report).toMatchObject({
      source: 'xsolla',
      complete: true,
      discovered: 2,
      accepted: 2,
      failed: 0,
      skipped: 0,
    });

    expect(accept).toHaveBeenCalledTimes(2);
    const first = accept.mock.calls[0][0] as unknown as IngestJobDto;
    expect(first).toMatchObject({
      externalId: 'xsolla:e05085e1-df4d-4bf2-bcf9-96402d21ac07',
      company: 'Xsolla',
      location: 'Baku',
      url: 'https://jobs.lever.co/xsolla/e05085e1-df4d-4bf2-bcf9-96402d21ac07',
    });
    expect(first.description).toContain('We are seeking a senior Go developer');
    expect(first.description).toContain('RESPONSIBILITIES:\n• Design and maintain scalable microservices in Go.');
    expect(first.description).toContain('REQUIREMENTS:\n• 3+ years of professional Go experience.');
    expect(first.deadline).toBeUndefined(); // Lever API gives no artificial deadline

    const errors = await validate(plainToInstance(IngestJobDto, first));
    expect(errors).toEqual([]);

    const second = accept.mock.calls[1][0] as unknown as IngestJobDto;
    expect(second.rawPayload).toMatchObject({ isRemote: true, workplaceType: 'remote' });
  });

  it('skips non-Azerbaijan postings without failing the run', () => {
    const itemBaku = validItem('e05085e1-df4d-4bf2-bcf9-96402d21ac07');
    const itemLA = validItem('11111111-2222-3333-4444-555555555555', {
      categories: { location: 'Los Angeles, CA', allLocations: ['Los Angeles'] },
      country: 'US',
    });
    const itemBerlin = validItem('66666666-7777-8888-9999-000000000000', {
      categories: { location: 'Berlin, Germany', allLocations: ['Berlin'] },
      country: 'DE',
    });

    const parsed = parseLeverFeed('xsolla', [itemBaku, itemLA, itemBerlin], NOW);
    expect(parsed).toMatchObject({ discovered: 3, skipped: 2, failed: 0 });
    expect(parsed.jobs).toHaveLength(1);
    expect(parsed.jobs[0].externalId).toBe('xsolla:e05085e1-df4d-4bf2-bcf9-96402d21ac07');
  });

  it('marks run incomplete if any posting fails parsing', async () => {
    const good = validItem('e05085e1-df4d-4bf2-bcf9-96402d21ac07');
    const badId = validItem('not-a-valid-uuid');
    const badTitle = validItem('4190ef3b-bac5-44db-8bfe-bec949708955', { text: '' });
    const badDate = validItem('56509726-51c6-4b4a-8983-8023cca96bd5', { createdAt: -500 });

    for (const bad of [badId, badTitle, badDate]) {
      const { collector, accept } = setup({
        [`${LEVER_API_ORIGIN}/robots.txt`]: ROBOTS,
        [API_URL]: JSON.stringify([good, bad]),
      });
      const report = await collector.collect(opts, accept);
      expect(report.complete).toBe(false);
      expect(report.failed).toBe(1);
      expect(report.accepted).toBe(1);
    }
  });

  it('stops on a block or a robots prohibition without further requests', async () => {
    const { collector, read, accept } = setup({
      [`${LEVER_API_ORIGIN}/robots.txt`]: 'User-agent: *\nDisallow: /v0/postings/xsolla',
      [API_URL]: JSON.stringify([validItem('e05085e1-df4d-4bf2-bcf9-96402d21ac07')]),
    });
    const report = await collector.collect(opts, accept);
    expect(report).toMatchObject({ complete: false, accepted: 0 });
    expect(report.error).toMatch(/prohibit/);
    expect(read).toHaveBeenCalledTimes(1);
    expect(accept).not.toHaveBeenCalled();
  });

  it('is incomplete when maxJobs limits collection', async () => {
    const item1 = validItem('e05085e1-df4d-4bf2-bcf9-96402d21ac07');
    const item2 = validItem('4190ef3b-bac5-44db-8bfe-bec949708955');
    const item3 = validItem('56509726-51c6-4b4a-8983-8023cca96bd5');

    const { collector, accept } = setup({
      [`${LEVER_API_ORIGIN}/robots.txt`]: ROBOTS,
      [API_URL]: JSON.stringify([item1, item2, item3]),
    });
    const report = await collector.collect({ ...opts, maxJobs: 2 }, accept);
    expect(report).toMatchObject({ complete: false, discovered: 3, accepted: 2 });
  });

  it.each([
    'https://evil.example/xsolla',
    `${O}/not-a-uuid`,
    `${O}/e05085e1-df4d-4bf2-bcf9-96402d21ac07?query=injection`,
    `${O}/e05085e1-df4d-4bf2-bcf9-96402d21ac07#fragment`,
    'https://user:pass@jobs.lever.co/xsolla/e05085e1-df4d-4bf2-bcf9-96402d21ac07',
    `${O}/../../etc/passwd`,
  ])('refuses invalid Lever URL %s', (url) => {
    expect(() => leverUrl('xsolla', url)).toThrow();
  });
});
