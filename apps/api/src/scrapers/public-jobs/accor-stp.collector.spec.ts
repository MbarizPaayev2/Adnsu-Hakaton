import fs from 'node:fs';
import path from 'node:path';
import { LocalEmployerCollector, localEmployerUrl, parseEmployerDetail, parseEmployerListing } from './local-employer.collector';
import { robotsAllows } from './public-job-collector';
import { deriveJobFacts } from '../../jobs/job-facts';
import { classifyLocation } from '../../jobs/az-regions';

const fixture = (dir: string, name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', dir, name), 'utf8');
const at = new Date('2026-10-16T12:00:00Z');
const ACCOR = 'https://careers.accor.com';
const accorJob = (slug: string) => `${ACCOR}/global/en/job/${slug}`;
const DIRECTOR = accorJob('director-of-food-and-beverage-in-fairmont-baku-flame-towers-baku-azerbaijan-jid-110365');

describe('Accor careers, Baku facet (real pages, 16 Oct 2026)', () => {
  it('reads both listing pages: 12 + 7 tiles against the stated total of 19', () => {
    const p1 = parseEmployerListing('fairmont-baku', fixture('accor', 'listing_p1.html'));
    const p2 = parseEmployerListing('fairmont-baku', fixture('accor', 'listing_p2.html'));
    expect([p1.urls.length, p2.urls.length, p1.total, p2.total, p1.complete]).toEqual([12, 7, 19, 19, false]);
    expect(new Set([...p1.urls, ...p2.urls]).size).toBe(19);
    expect(p2.urls).toContain(DIRECTOR);
  });

  it("its robots rule \"Disallow: /jobs?*\" is root-anchored, so the localised listing is allowed and login/profile paths are not", () => {
    const robots = fixture('accor', 'robots.txt');
    expect(robotsAllows(robots, '/global/en/jobs?options=313&page=1')).toBe(true);
    expect(robotsAllows(robots, '/jobs?options=313')).toBe(false);
    expect(robotsAllows(robots, '/login')).toBe(false);
  });

  it('only reaches the Baku listing pages and job pages, never apply, login or other facets', () => {
    expect(localEmployerUrl('fairmont-baku', '/global/en/jobs?options=313&page=2')).toBe(`${ACCOR}/global/en/jobs?options=313&page=2`);
    for (const u of ['/global/en/jobs?options=999&page=1', '/global/en/jobs?options=313', '/global/en/jobs?options=313&page=1&q=x', '/login',
      `${DIRECTOR}?apply=1`, 'https://jobs.smartrecruiters.com/AccorHotel/1', '/global/en/job/x-jid-1/apply'])
      expect(() => localEmployerUrl('fairmont-baku', u)).toThrow();
  });

  it('maps a posting from its JobPosting data: hotel as employer, posting date, no placeholder deadline', () => {
    const job = parseEmployerDetail('fairmont-baku', fixture('accor', 'detail_110365.html'), DIRECTOR, at);
    expect(job).toMatchObject({ externalId: 'fairmont-baku:110365', title: 'Director of Food & Beverage', company: 'Fairmont Baku',
      location: 'Fairmont Baku - Flame Towers, Baku, Azerbaijan', rawPayload: { postedAtBasis: 'source-date', hotel: 'Fairmont Baku - Flame Towers' } });
    expect(job.postedAt.slice(0, 10)).toBe('2026-09-15');
    expect(job.deadline).toBeUndefined(); // validThrough is posting date + 100 years
    expect(job.description.length).toBeGreaterThan(200);
    expect(job.description).not.toMatch(/<\w/);
    expect(classifyLocation(job.location).region).toBe('Bakı');
    expect(deriveJobFacts(job).applicationMethod).not.toBe('EMAIL');
  });

  it('rejects a page whose canonical identity is another posting', () => {
    expect(() => parseEmployerDetail('fairmont-baku', fixture('accor', 'detail_110365.html'), accorJob('chef-de-partie-in-fairmont-baku-flame-towers-baku-azerbaijan-jid-113301'), at)).toThrow('identity');
  });

  it('walks both pages and reports complete only when 19 distinct, valid postings were listed', async () => {
    const l1 = fixture('accor', 'listing_p1.html'), l2 = fixture('accor', 'listing_p2.html');
    const robots = fixture('accor', 'robots.txt'), detail = fixture('accor', 'detail_110365.html');
    const read = jest.fn(async (url: string) => (url.endsWith('robots.txt') ? robots : url.endsWith('page=1') ? l1 : url.endsWith('page=2') ? l2 : detail.replaceAll(DIRECTOR, url)));
    expect(await new LocalEmployerCollector('fairmont-baku', read, async () => {}, () => at).collect({ maxPages: 5, maxJobs: 50, delayMs: 1500 }, async () => {})).toMatchObject({ pages: 2, complete: true, discovered: 19, fetched: 19, failed: 0 });
    expect(read.mock.calls.some(([u]) => /page=3/.test(u))).toBe(false);

    // A detail page that is not the listed posting fails validation: the run stays incomplete, so nothing is closed from it.
    const wrong = jest.fn(async (url: string) => (url.endsWith('robots.txt') ? robots : url.endsWith('page=1') ? l1 : url.endsWith('page=2') ? l2 : url === DIRECTOR ? detail : detail.replaceAll(DIRECTOR, url).replace('"title":"Director', '"x":"')));
    expect(await new LocalEmployerCollector('fairmont-baku', wrong, async () => {}, () => at).collect({ maxPages: 5, maxJobs: 50, delayMs: 1500 }, async () => {})).toMatchObject({ complete: false, accepted: 1, failed: 18 });
    // A total that changes between pages aborts.
    const drift = jest.fn(async (url: string) => (url.endsWith('robots.txt') ? robots : url.endsWith('page=1') ? l1 : url.endsWith('page=2') ? l2.replace('<span>19</span>', '<span>20</span>') : fixture('accor', 'detail_110365.html').replaceAll(DIRECTOR, url)));
    expect(await new LocalEmployerCollector('fairmont-baku', drift, async () => {}, () => at).collect({ maxPages: 5, maxJobs: 50, delayMs: 1500 }, async () => {})).toMatchObject({ complete: false, error: 'Employer result count changed during collection' });
  });
});

describe('STP career portal (real pages, 16 Oct 2026)', () => {
  const STP = 'https://www.stpcareer.com';

  it('lists all 9 vacancies on its single page', () => {
    const list = parseEmployerListing('stp', fixture('stp', 'vakansiyalar_p1.html'));
    expect(list.complete).toBe(true);
    expect(list.urls).toHaveLength(9);
    expect(list.urls).toContain(`${STP}/vakansiya-haqqinda/356`);
  });

  it('never requests the application form, registration or company filters', () => {
    for (const u of ['/muraciet-et', '/qeydiyyat', '/vakansiyalar/9', '/vakansiya-haqqinda/356?x=1', 'https://stp.az/vakansiya-haqqinda/356'])
      expect(() => localEmployerUrl('stp', u)).toThrow();
  });

  it('maps a posting with its stated posting date and deadline, company and requirements', () => {
    const job = parseEmployerDetail('stp', fixture('stp', 'detail_356.html'), `${STP}/vakansiya-haqqinda/356`, at);
    expect(job).toMatchObject({ externalId: 'stp:356', title: 'Maliyyə nəzarəti və xəzinədarlıq üzrə mütəxəssis', company: 'STP-HEAVY ENGINEERING', location: 'Sumqayıt',
      postedAt: '2026-10-05T20:00:00.000Z', deadline: '2026-11-06T19:59:59.000Z', rawPayload: { postedAtBasis: 'source-date', locationBasis: 'employer-head-office', deadlineText: '2026-11-06' } });
    expect(job.description).toContain('Namizədə olan tələblər');
    expect(job.description).not.toContain('Müraciət et');
    expect(classifyLocation(job.location).region).toBe('Abşeron-Xızı');
    // The portal footer's general contact address is not an application instruction.
    expect(deriveJobFacts(job).applicationMethod).not.toBe('EMAIL');
  });

  it('keeps a posting with blank dates as first-observed with no deadline', () => {
    const job = parseEmployerDetail('stp', fixture('stp', 'detail_354.html'), `${STP}/vakansiya-haqqinda/354`, at);
    expect(job).toMatchObject({ title: 'Baş hüquqşünas', company: 'STP MMC', postedAt: at.toISOString(), rawPayload: { postedAtBasis: 'first-observed' } });
    expect(job.deadline).toBeUndefined();
    expect(job.description).toContain('Təcrübə tələbi: 3-5 il');
  });

  it('rejects a page that is another vacancy', () => {
    expect(() => parseEmployerDetail('stp', fixture('stp', 'detail_356.html'), `${STP}/vakansiya-haqqinda/355`, at)).toThrow('identity');
  });
});
