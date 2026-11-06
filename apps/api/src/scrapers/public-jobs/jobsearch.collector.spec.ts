import { JobsearchCollector } from './jobsearch.collector';
import { JOBSEARCH_ORIGIN, jobsearchUrl, parseJobsearchDetail, parseJobsearchListing } from './jobsearch.parser';
import { COLLECTOR_KEYS, collectorFor } from './collector-registry';
import { extractApplicationEmail } from '../../jobs/job-facts';

// Synthetic fixtures that follow the structure observed on the public classic pages (2026-10-03): `ul.vacancies__item[data-id]` cards with title, employer and
// day/month "Published"/"Deadline" columns; a detail page whose static HTML has a description block and an EMPTY e-mail placeholder (filled by script).
const now = new Date('2026-10-03T12:00:00.000Z');
const U = (id: number, slug = 'acme-data-analyst') => `${JOBSEARCH_ORIGIN}/vacancies/${slug}-${id}`;
const card = (id: number, o: { title?: string; company?: string; published?: string | null; deadline?: string | null } = {}) => `<ul data-id="${id}" class="vacancies__item"><li><a href="${U(id)}" class="vacancies__mobile-link"></a><h2 class="vacancies__title"><a href="${U(id)}">${o.title ?? 'Data Analyst'}</a></h2></li><li><a href="/companies/acme" class="vacancies__provided"><img src="x.png" alt=""><span>${o.company ?? 'ACME MMC'}</span></a></li>${o.published === null ? '' : `<li class="d-none d-lg-block">${o.published ?? '3 Oktyabr'}</li>`}${o.deadline === null ? '' : `<li class="d-none d-lg-block">${o.deadline ?? '3 Noyabr'}</li>`}<li class="d-block d-lg-none"><span>Bu gün</span></li></ul>`;
const listing = (cards: string[]) => `<html><body><div id="vacancies">${cards.join('')}</div><footer>Contact: support@jobsearch.example</footer></body></html>`;
const detail = (o: { title?: string; company?: string; deadline?: string | null; text?: string } = {}) => `<html><body><header><a href="/companies/acme">x</a></header><section><div class="vacancies__provided"><span>${o.company ?? 'ACME MMC'}</span></div><h1>${o.title ?? 'Data Analyst'}</h1>${o.deadline === null ? '' : `<div>Deadline ${o.deadline ?? '3 Noyabr 2026'}</div>`}<a class="apply">Apply for job</a><span class="apply__send-mail email_placeholder"> </span>
<div class="vacancy__description content"><div class="content"><p>Hesabatların hazırlanması və təhlili.</p><p>Tələblər: SQL.</p><p>${o.text ?? 'CV-nizi “Apply for job” düyməsindəki ünvana göndərin.'}</p></div></div><div class="vacancy__subscribe-block">Our Telegram channel <a href="https://t.me/example">subscribe</a> mail: press@jobsearch.example</div></section></body></html>`;
const entryOf = (id = 152912, o: Parameters<typeof card>[1] = {}) => parseJobsearchListing(listing([card(id, o)])).entries[0];

describe('JobSearch classic parser', () => {
  it('reads cards: id, title, employer, published and deadline day/month; the id must agree with the URL', () => {
    const { entries } = parseJobsearchListing(listing([card(152912), card(152913, { published: '2 Oktyabr', deadline: null })]));
    expect(entries[0]).toEqual({ id: '152912', url: U(152912), title: 'Data Analyst', company: 'ACME MMC', published: { day: 3, month: 10 }, deadline: { day: 3, month: 11 } });
    expect(entries[1].deadline).toBeNull();
    expect(() => parseJobsearchListing(listing([card(152912).replace(/-152912"/g, '-152999"')]))).toThrow('no recognizable');
    // A card with only one date cell is ambiguous: neither date is trusted.
    const one = parseJobsearchListing(listing([card(152912, { published: null })])).entries[0];
    expect([one.published, one.deadline]).toEqual([null, null]);
  });
  it('an unrecognised listing is an error', () => {
    expect(() => parseJobsearchListing('<html><body>Maintenance</body></html>')).toThrow('no recognizable');
  });
  it('only public vacancy URLs are accepted; the unsubscribe and candidate surfaces are not', () => {
    for (const bad of ['https://classic.jobsearch.az/unsubscribe', 'https://classic.jobsearch.az/profile', 'https://jobsearch.az/vacancies/x-1', 'https://u:p@classic.jobsearch.az/vacancies']) expect(() => jobsearchUrl(bad)).toThrow();
  });
  it('builds the job with Baku-time dates: publication from the listing, deadline from the full detail date', () => {
    const job = parseJobsearchDetail(detail(), U(152912), now, entryOf());
    expect(job).toMatchObject({ externalId: 'jobsearch:152912', title: 'Data Analyst', company: 'ACME MMC', postedAt: '2026-10-02T20:00:00.000Z', deadline: '2026-11-03T19:59:59.999Z', location: 'Azerbaijan' });
    expect(job.rawPayload).toMatchObject({ locationKnown: false, deadlineEvidence: 'detail_full_date' });
  });
  it('uses the listing deadline (year inferred) when the detail page has none', () => {
    const job = parseJobsearchDetail(detail({ deadline: null }), U(152912), now, entryOf());
    expect(job.deadline).toBe('2026-11-03T19:59:59.999Z');
    expect(job.rawPayload?.deadlineEvidence).toBe('listing_day_month_year_inferred');
  });
  it('a listing card that does not show both date columns gives no usable publication date, so the posting is rejected, not guessed', () => {
    expect(() => parseJobsearchDetail(detail({ deadline: null }), U(152912), now, entryOf(152912, { deadline: null }))).toThrow('publication');
  });
  it('never invents an application address and keeps support/subscription chrome out of the description', () => {
    const job = parseJobsearchDetail(detail(), U(152912), now, entryOf());
    expect(job.description).not.toMatch(/@|Telegram|support|press/);
    expect(extractApplicationEmail(job.description)).toBeNull();
    const withAddress = parseJobsearchDetail(detail({ text: 'CV-nizi hr@acme.example ünvanına göndərin.' }), U(152912), now, entryOf());
    expect(extractApplicationEmail(withAddress.description)?.email).toBe('hr@acme.example');
  });
  it('rejects instead of inventing: no publication evidence, implausible date, mismatching title/employer, empty text, bad deadline', () => {
    expect(() => parseJobsearchDetail(detail(), U(152912), now, entryOf(152912, { published: null }))).toThrow('publication');
    expect(() => parseJobsearchDetail(detail(), U(152912), now, entryOf(152912, { published: '30 Fevral' }))).toThrow();
    expect(() => parseJobsearchDetail(detail({ title: 'Other' }), U(152912), now, entryOf())).toThrow('disagree');
    expect(() => parseJobsearchDetail(detail({ company: 'Other MMC' }), U(152912), now, entryOf())).toThrow('disagree');
    expect(() => parseJobsearchDetail(detail().replace(/<div class="vacancy__description[\s\S]*?<\/div><\/div>/, ''), U(152912), now, entryOf())).toThrow();
    expect(() => parseJobsearchDetail(detail({ deadline: '31 Fevral 2026' }), U(152912), now, entryOf())).toThrow('deadline');
    expect(() => parseJobsearchDetail(detail(), U(152913), now, entryOf())).toThrow('does not match');
  });
});

describe('JobSearch classic collector', () => {
  const robots = 'User-agent: Yandex\nHost: https://jobsearch.az/\n\nUser-agent: *\nCrawl-delay: 30\nDisallow: /unsu';
  const setup = (cards: string[], over: { robots?: string; failDetail?: number } = {}) => {
    const delays: number[] = []; const calls: string[] = [];
    const read = jest.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/robots.txt')) return over.robots ?? robots;
      if (url.includes('/vacancies?')) return listing(cards);
      if (over.failDetail && url === U(over.failDetail)) throw new Error('Source HTTP 429');
      return detail();
    });
    return { delays, calls, read, collector: new JobsearchCollector(read, async (ms) => { delays.push(ms); }, () => now) };
  };

  it('collects a bounded snapshot at the robots crawl-delay (30 s) and can never claim completeness', async () => {
    const { collector, delays } = setup([card(152912), card(152913)]);
    const seen: string[] = [];
    const report = await collector.collect({ maxPages: 1, maxJobs: 10, delayMs: 1000 }, async (j) => { seen.push(j.externalId); });
    expect(report).toMatchObject({ complete: false, pages: 1, discovered: 2, fetched: 2, failed: 0, delayMs: 30_000 });
    expect(Math.min(...delays)).toBe(30_000);
    expect(report.error).toContain('bounded recent snapshot');
    expect(seen).toHaveLength(report.accepted);
  });
  it('limits detail fetches to maxJobs and keeps counting what it discovered', async () => {
    const { collector, calls } = setup([card(152912), card(152913), card(152914)]);
    const report = await collector.collect({ maxPages: 1, maxJobs: 1, delayMs: 1000 }, async () => {});
    expect(report).toMatchObject({ discovered: 3, fetched: 1 });
    expect(calls.filter((u) => u.includes('/vacancies/'))).toHaveLength(1);
  });
  it('a listing entry without publication evidence is counted as failed and never ingested', async () => {
    const { collector } = setup([card(152912, { published: null })]);
    const accepted: string[] = [];
    const report = await collector.collect({ maxPages: 1, maxJobs: 5, delayMs: 1000 }, async (j) => { accepted.push(j.externalId); });
    expect(report).toMatchObject({ failed: 1, accepted: 0 });
    expect(report.error).toContain('no closures inferred');
  });
  it('stops on a blocking response without retrying and honours robots disallow', async () => {
    const blocked = setup([card(152912), card(152913)], { failDetail: 152912 });
    const report = await blocked.collector.collect({ maxPages: 1, maxJobs: 5, delayMs: 1000 }, async () => {});
    expect(report.error).toContain('429');
    expect(blocked.read.mock.calls.filter(([u]) => u === U(152912))).toHaveLength(1);
    const disallowed = setup([card(152912)], { robots: 'User-agent: *\nCrawl-delay: 30\nDisallow: /vacancies' });
    expect((await disallowed.collector.collect({ maxPages: 1, maxJobs: 5, delayMs: 1000 }, async () => {})).error).toContain('crawler rules prohibit');
  });
  it('skips stored postings and is registered under its source key', async () => {
    const { collector, calls } = setup([card(152912)]);
    const report = await collector.collect({ maxPages: 1, maxJobs: 5, delayMs: 1000, isKnown: (id) => id === 'jobsearch:152912' }, async () => {});
    expect(report).toMatchObject({ known: 1, fetched: 0 });
    expect(calls.some((u) => u.includes('/vacancies/'))).toBe(false);
    expect(COLLECTOR_KEYS).toContain('jobsearch');
    expect(collectorFor('jobsearch')).toBeInstanceOf(JobsearchCollector);
  });
});
