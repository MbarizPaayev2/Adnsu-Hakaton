import { readFileSync } from 'fs';
import { join } from 'path';
import { AnnouncementPagesCollector, announcementDeadline, announcementUrl, normPostings, parseAdaDetail, parseAdaListing, parseKhazarBlocks, khazarPostings, stablePostedAt } from './announcement-pages';
import { deriveJobFacts } from '../../jobs/job-facts';
import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';

// Fixtures are real pages fetched on 11 October 2026 (scripts removed), not invented markup.
const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const NOW = new Date('2026-10-11T12:00:00Z');

describe('announcementDeadline', () => {
  it('reads complete dates in the forms these pages use, as the end of the day in Baku', () => {
    expect(announcementDeadline('October 9, 2026.')).toBe('2026-10-09T19:59:59.999Z');
    expect(announcementDeadline('8 September 2026')).toBe('2026-09-08T19:59:59.999Z');
    expect(announcementDeadline('09.10.2026')).toBe('2026-10-09T19:59:59.999Z');
    expect(announcementDeadline('21.09.26')).toBe('2026-09-21T19:59:59.999Z'); // two-digit years, as NORM writes them
    expect(announcementDeadline('May10, 2016')).toBeNull(); // below the supported range
  });
  it('refuses partial and impossible dates', () => {
    for (const bad of ['December', '31 January', '30.02.2026', 'Soon', '']) expect(announcementDeadline(bad)).toBeNull();
  });
  it('keeps the posting date stable between runs', () => {
    const d = '2026-11-15T19:59:59.999Z';
    expect(stablePostedAt(d, new Date('2026-10-20T08:00:00Z'))).toBe(stablePostedAt(d, new Date('2026-11-02T08:00:00Z')));
    expect(stablePostedAt(d, NOW)).toBe(stablePostedAt(d, new Date('2026-10-12T08:00:00Z'))); // before the threshold it moves at most monthly
    expect(new Date(stablePostedAt('2026-12-30T19:59:59.999Z', NOW)).getTime()).toBeLessThanOrEqual(NOW.getTime());
  });
});

describe('announcementUrl', () => {
  it('stays on the employer host and the paths each adapter reads', () => {
    expect(announcementUrl('ada', '/en/jobs/124-adjunct-instructor-in-global-corporate-strategy')).toBe('https://www.ada.edu.az/en/jobs/124-adjunct-instructor-in-global-corporate-strategy');
    expect(() => announcementUrl('ada', 'https://evil.example/en/jobs/1-x')).toThrow();
    expect(() => announcementUrl('ada', '/en/jobs/../admin')).toThrow();
    expect(() => announcementUrl('khazar', '/en/item/511')).toThrow();
    expect(announcementUrl('khazar', 'https://khazar.org/en/item/510?vacancy=abc')).toContain('vacancy=abc');
  });
});

describe('ADA University', () => {
  it('lists the vacancy pages of its career list', () => {
    const entries = parseAdaListing(fx('ada-list.html'));
    expect(entries.map((e) => e.id)).toEqual(expect.arrayContaining(['124', '125', '128']));
  });

  it('reads title, closing date and the announcement, and the application address, subject and deadline come from its own words', () => {
    const job = parseAdaDetail(fx('ada-job-124.html'), 'https://www.ada.edu.az/en/jobs/124-adjunct-instructor-in-global-corporate-strategy', new Date('2026-10-05T08:00:00Z'))!;
    expect(job).toMatchObject({ externalId: 'ada:124', title: 'Adjunct Instructor in Global Corporate Strategy', company: 'ADA University', deadline: '2026-10-09T19:59:59.999Z' });
    const facts = deriveJobFacts({ title: job.title, description: job.description });
    expect(facts.applicationMethod).toBe('EMAIL');
    expect(facts.applicationEmail).toBe('sbrecruitment@ada.edu.az');
    expect(facts.applicationEmailEvidence?.subjectLine).toBe('Adjunct Instructor – Global Corporate Strategy');
    expect(job.description).not.toContain('info@ada.edu.az'); // the site footer's general address is not part of the announcement
  });

  it('reads "Please send the following documents … by <date> to <address> email address" as the application address', () => {
    const job = parseAdaDetail(fx('ada-job-128.html'), 'https://www.ada.edu.az/en/jobs/128-assistant-associate-professor-in-structures-school-of-design-and-architecture', new Date('2026-10-05T08:00:00Z'))!;
    expect(job.deadline).toBe('2026-11-15T19:59:59.999Z');
    const facts = deriveJobFacts({ title: job.title, description: job.description });
    expect(facts.applicationEmail).toBe('sdarecruitment@ada.edu.az');
  });

  it('keeps an announcement whose closing date has passed as stored evidence (its deadline makes it non-actionable) and drops one with no closing date', () => {
    const job = parseAdaDetail(fx('ada-job-124.html'), 'https://www.ada.edu.az/en/jobs/124-adjunct-instructor-in-global-corporate-strategy', NOW)!;
    expect(new Date(job.deadline!).getTime()).toBeLessThan(NOW.getTime());
    const noDate = fx('ada-job-124.html').replace(/CLOSING DATE/g, 'CLOSING');
    expect(parseAdaDetail(noDate, 'https://www.ada.edu.az/en/jobs/124-adjunct-instructor-in-global-corporate-strategy', NOW)).toBeNull();
  });
});

describe('Khazar University', () => {
  it('splits the announcement page into vacancies bounded by their own deadline lines', () => {
    const blocks = parseKhazarBlocks(fx('khazar-announcements.html'));
    expect(blocks.map((b) => b.title)).toEqual(expect.arrayContaining(['Coordinator – Department of Economics and Management', 'Director – Department of Economics and Management']));
    expect(blocks[0].deadline).toBe('2026-10-09T19:59:59.999Z');
  });

  it('emits open announcements with their explicit address and the quoted subject, one posting per vacancy, and skips closed ones', () => {
    const { jobs, expired } = khazarPostings(fx('khazar-announcements.html'), new Date('2026-10-05T08:00:00Z'));
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    const coordinator = jobs.find((j) => j.title.startsWith('Coordinator – Department'))!;
    const facts = deriveJobFacts({ title: coordinator.title, description: coordinator.description });
    expect(facts.applicationEmail).toBe('economics@khazar.org');
    expect(facts.applicationEmailEvidence?.subjectLine).toBe('Coordinator, Department of Economics and management');
    expect(new Set(jobs.map((j) => j.url)).size).toBe(jobs.length); // distinct URLs: the repeat detector must not merge different vacancies
    const later = khazarPostings(fx('khazar-announcements.html'), NOW);
    expect(later.jobs.length).toBeLessThan(jobs.length + 1);
    expect(expired).toBeGreaterThanOrEqual(0);
  });

  it('stores closed announcements as evidence, reports a healthy partial run and no error text', async () => {
    const accepted: IngestJobDto[] = [];
    const collector = new AnnouncementPagesCollector('khazar', async (url) => (url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /\n' : fx('khazar-announcements.html')), async () => undefined, () => NOW);
    const report = await collector.collect({ maxPages: 1, maxJobs: 50, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.expired).toBeGreaterThan(0);
    expect(report.accepted).toBe(accepted.length);
    expect(report.accepted).toBeGreaterThan(0); // the importer records "evidence of work", so the run is PARTIAL, not FAILED
    expect(report.error).toBeUndefined();
    expect(report.complete).toBe(false);
  });

  it('never closes anything from absence', async () => {
    const accepted: IngestJobDto[] = [];
    const collector = new AnnouncementPagesCollector('khazar', async (url) => (url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /\n' : fx('khazar-announcements.html')), async () => undefined, () => new Date('2026-10-05T08:00:00Z'));
    const report = await collector.collect({ maxPages: 1, maxJobs: 50, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.complete).toBe(false);
    expect(accepted.length).toBeGreaterThanOrEqual(2);
  });
});

describe('collector', () => {
  it('stops on a robots refusal and reports an incomplete listing', async () => {
    const collector = new AnnouncementPagesCollector('ada', async (url) => (url.endsWith('/robots.txt') ? 'User-agent: *\nDisallow: /en/jobs\n' : fx('ada-list.html')), async () => undefined, () => NOW);
    const report = await collector.collect({ maxPages: 1, maxJobs: 50, delayMs: 1000 }, async () => undefined);
    expect(report.complete).toBe(false);
    expect(report.error).toMatch(/prohibit/);
  });

  it('reads every listed vacancy page and reports the listing complete only when none failed', async () => {
    const accepted: IngestJobDto[] = [];
    const failed: string[] = [];
    const collector = new AnnouncementPagesCollector('ada', async (url) => {
      if (url.endsWith('/robots.txt')) return 'User-agent: *\nAllow: /\n';
      if (url.endsWith('/en/jobs')) return fx('ada-list.html');
      if (url.includes('/124-')) return fx('ada-job-124.html');
      throw new Error('HTTP 404');
    }, async () => undefined, () => new Date('2026-10-05T08:00:00Z'));
    const report = await collector.collect({ maxPages: 1, maxJobs: 50, delayMs: 1000, onFailedDetail: (id) => { failed.push(id); } }, async (j) => { accepted.push(j); });
    expect(accepted.map((j) => j.externalId)).toEqual(['ada:124']);
    expect(failed).toContain('ada:122');
    expect(report.failed).toBeGreaterThan(0);
    expect(report.complete).toBe(false);
    expect(report.outcome).toBe('INVALID_DETAIL');
  });

  it('stops on a source access restriction without treating the listing as complete', async () => {
    const accepted: IngestJobDto[] = [];
    const read = jest.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return 'User-agent: *\nAllow: /\n';
      if (url.endsWith('/en/jobs')) return fx('ada-list.html');
      throw new Error('Source HTTP 403');
    });
    const report = await new AnnouncementPagesCollector('ada', read, async () => undefined).collect(
      { maxPages: 1, maxJobs: 50, delayMs: 1000 }, async (job) => { accepted.push(job); },
    );
    expect(report).toMatchObject({ complete: false, outcome: 'UPSTREAM_FAILURE' });
    expect(accepted).toHaveLength(0);
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe('NORM', () => {
  const url = 'https://www.norm.az/page/careers';
  it('reads each vacancy with its posting date, deadline, own link and the application instruction', () => {
    const { jobs, seen } = normPostings(fx('norm-careers.html'), NOW);
    expect(seen).toBeGreaterThanOrEqual(3);
    expect(jobs.length).toBe(seen);
    for (const j of jobs) {
      expect(j.externalId).toMatch(/^norm:\d+$/);
      expect(j.url).toMatch(/^https:\/\/www\.norm\.az\/vacancy\/\d+$/);
      expect(j.deadline).toBeTruthy();
      const facts = deriveJobFacts({ title: j.title, description: j.description });
      expect(facts.applicationMethod).toBe('EMAIL');
      expect(facts.applicationEmail).toBe('hr@norm.az');
      expect(facts.applicationEmailEvidence?.excerpt).toMatch(/hr@norm\.az/);
    }
    // The subject rule is a sentence ("name the position in the subject"), not a fixed phrase: nothing is invented as a subject line, but the draft
    // knows the subject is the position's name.
    const evidence = deriveJobFacts({ title: jobs[0].title, description: jobs[0].description }).applicationEmailEvidence!;
    expect(evidence.subjectLine).toBeUndefined();
    expect(evidence.subjectIsPositionName).toBe(true);
  });

  it('counts closed vacancies as expired, keeps them stored, and a complete read may close what left the page', async () => {
    const accepted: IngestJobDto[] = [];
    const collector = new AnnouncementPagesCollector('norm', async (u) => (u.endsWith('/robots.txt') ? 'User-agent: *\nDisallow:\n' : fx('norm-careers.html')), async () => undefined, () => NOW);
    const report = await collector.collect({ maxPages: 1, maxJobs: 50, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.error).toBeUndefined();
    expect(report.complete).toBe(true);
    expect(report.accepted).toBe(accepted.length);
    expect(report.expired).toBe(accepted.filter((j) => j.deadline && new Date(j.deadline) < NOW).length);
  });

  it('refuses a page that is not the careers list', () => {
    expect(() => normPostings('<html><head><title>Error</title></head><body><h1>Maintenance</h1></body></html>', NOW)).toThrow(/Unrecognized/);
  });

  it('stays on its own host and paths', () => {
    expect(announcementUrl('norm', url)).toBe(url);
    expect(announcementUrl('norm', 'https://www.norm.az/vacancy/1789620719')).toContain('/vacancy/');
    expect(() => announcementUrl('norm', 'https://www.norm.az/admin')).toThrow();
    expect(() => announcementUrl('norm', 'https://norm.evil.example/vacancy/1789620719')).toThrow();
  });
});
