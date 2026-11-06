import { TeamtailorCollector } from './teamtailor.collector';
import { parseTeamtailorFeed, teamtailorUrl } from './teamtailor.parser';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IngestJobDto } from '../../jobs/dto/ingest-job.dto';

const O = 'https://career.pasha-insurance.az';
const NOW = new Date('2026-10-02T12:00:00Z');
const item = (id: number, over: { title?: string; pub?: string; country?: string | null; desc?: string; remote?: string } = {}) => `<item><title>${over.title ?? `Role ${id}`}</title>
  <description>${(over.desc ?? '<p>Vəzifə <strong>təsviri</strong>.</p><ul><li>Bir</li><li>İki</li></ul><script>x()</script>').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</description>
  <pubDate>${over.pub ?? 'Thu, 01 Oct 2026 14:17:09 +0400'}</pubDate><link>${O}/jobs/${id}-role-${id}</link><remoteStatus>${over.remote ?? 'none'}</remoteStatus><guid>g-${id}</guid>
  <company_name>PASHA Insurance</company_name>${over.country === null ? '' : `<tt:locations><tt:location><tt:name>Bakı</tt:name><tt:city>Baku</tt:city><tt:country>${over.country ?? 'Azerbaijan'}</tt:country></tt:location></tt:locations>`}
  <tt:department>Dept</tt:department></item>`;
const feed = (...items: string[]) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><title>PASHA Insurance</title><link>${O}/jobs</link>${items.join('')}</channel></rss>`;
const ROBOTS = 'User-agent: *\nDisallow: /app/\nDisallow: /jobs/internal/';
const opts = { maxPages: 1, maxJobs: 50, delayMs: 1000 };
const setup = (pages: Record<string, string | Error>) => {
  const read = jest.fn(async (url: string) => { const v = pages[url]; if (v instanceof Error) throw v; if (v === undefined) throw new Error('Unexpected URL'); return v; });
  const accept = jest.fn(async () => undefined);
  return { collector: new TeamtailorCollector('pasha-insurance', read, async () => undefined, () => NOW), read, accept };
};

describe('Teamtailor career feed (PASHA Insurance)', () => {
  it('turns a fully parsed feed into valid, attributed, complete postings with identity and text intact', async () => {
    const { collector, accept } = setup({ [`${O}/robots.txt`]: ROBOTS, [`${O}/jobs.rss`]: feed(item(8484906), item(8452560, { remote: 'fully' })) });
    expect(await collector.collect(opts, accept)).toMatchObject({ source: 'pasha-insurance', complete: true, discovered: 2, accepted: 2, failed: 0, skipped: 0 });
    const first = accept.mock.calls[0][0] as unknown as IngestJobDto;
    expect(first).toMatchObject({ externalId: 'pasha-insurance:8484906', company: 'PASHA Insurance', location: 'Bakı', url: `${O}/jobs/8484906-role-8484906`, postedAt: '2026-10-01T10:17:09.000Z' });
    expect(first.description).toBe('Vəzifə təsviri.\nBir\nİki');
    expect(first.deadline).toBeUndefined(); // the feed gives none; none is invented
    expect(await validate(plainToInstance(IngestJobDto, first))).toEqual([]);
    expect((accept.mock.calls[1][0] as unknown as IngestJobDto).rawPayload).toMatchObject({ isRemote: true });
  });
  it('excludes postings without a stated Azerbaijani location, without failing the run', () => {
    const parsed = parseTeamtailorFeed('pasha-insurance', feed(item(1001), item(1002, { country: 'Turkey' }), item(1003, { country: null })), NOW);
    expect(parsed).toMatchObject({ discovered: 3, skipped: 2, failed: 0 });
    expect(parsed.jobs).toHaveLength(1);
  });
  it('treats an unparseable item, implausible date or repeated id as a failure, so the run is incomplete and closes nothing', async () => {
    for (const bad of [item(2001, { pub: 'not a date' }), item(2002, { pub: 'Sun, 29 Nov 2026 20:00:00 +0000' }), item(2003, { title: '' })]) {
      const { collector, accept } = setup({ [`${O}/robots.txt`]: ROBOTS, [`${O}/jobs.rss`]: feed(item(2000), bad) });
      expect(await collector.collect(opts, accept)).toMatchObject({ complete: false, failed: 1, accepted: 1 });
    }
    const repeated = parseTeamtailorFeed('pasha-insurance', feed(item(3001), item(3001)), NOW);
    expect(repeated).toMatchObject({ failed: 1 });
  });
  it('never mistakes an error, challenge or foreign page for an empty inventory', async () => {
    for (const body of ['<html><h1>Maintenance</h1></html>', '', '{"error":"x"}', feed().replace(O, 'https://career.other.example')]) {
      const { collector, accept } = setup({ [`${O}/robots.txt`]: ROBOTS, [`${O}/jobs.rss`]: body });
      const report = await collector.collect(opts, accept);
      expect(report.complete).toBe(false);
      expect(report.error).toBeTruthy();
      expect(accept).not.toHaveBeenCalled();
    }
  });
  it('stops on a block or a robots prohibition without further requests', async () => {
    for (const [robots, feedValue, expected] of [[ROBOTS, new Error('Source HTTP 429'), /429/], ['User-agent: *\nDisallow: /jobs.rss', feed(item(1)), /prohibit/]] as const) {
      const { collector, read, accept } = setup({ [`${O}/robots.txt`]: robots, [`${O}/jobs.rss`]: feedValue });
      const report = await collector.collect(opts, accept);
      expect(report).toMatchObject({ complete: false, accepted: 0 });
      expect(report.error).toMatch(expected);
      expect(read.mock.calls.length).toBeLessThanOrEqual(2);
    }
  });
  it('is incomplete when the job cap held postings back, and bounds its limits', async () => {
    const { collector, accept } = setup({ [`${O}/robots.txt`]: ROBOTS, [`${O}/jobs.rss`]: feed(item(4001), item(4002), item(4003)) });
    expect(await collector.collect({ ...opts, maxJobs: 2 }, accept)).toMatchObject({ complete: false, accepted: 2, discovered: 3 });
    await expect(collector.collect({ ...opts, delayMs: 10 }, accept)).rejects.toThrow('Invalid collection limits');
  });
  it.each(['https://evil.example/jobs.rss', `${O}/jobs.rss?x=1`, `${O}/app/jobs`, `${O}/jobs/internal/1`, `${O}/jobs/12%2f34-x`, 'https://user:pw@career.pasha-insurance.az/jobs.rss', `${O}/jobs.rss#frag`])('refuses URL %s', (url) => {
    expect(() => teamtailorUrl('pasha-insurance', url)).toThrow();
  });
});
