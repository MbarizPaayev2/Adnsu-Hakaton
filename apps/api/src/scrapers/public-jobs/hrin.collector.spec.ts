import { HrinCollector } from './hrin.collector';
import { COLLECTOR_KEYS, collectorFor } from './collector-registry';
import { HRIN_ORIGIN, hrinUrl, parseHrinDetail, parseHrinListing } from './hrin.parser';

const now = new Date('2026-10-26T12:00:00.000Z');
const detailUrl = (id: string, slug = 'data-analitik') => `${HRIN_ORIGIN}/vakansiya/${slug}-${id}`;
const posting = (id: string, o: Record<string, unknown> = {}) => ({
  '@context': 'https://schema.org/', '@type': 'JobPosting', title: 'Data Analitik',
  description: '<p>Vakansiyanın əsas vəzifələri:</p><ul><li>SQL ilə hesabat hazırlamaq</li></ul><p>Tələblər: Power BI.</p>',
  datePosted: '2026-10-20T00:00:00.000Z', validThrough: '2026-11-20T00:00:00.000Z',
  hiringOrganization: { '@type': 'Organization', name: 'Nümunə MMC' },
  jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Bakı', addressCountry: 'AZ' } },
  identifier: { '@type': 'PropertyValue', name: 'hrin.az', value: id }, url: detailUrl(id),
  employmentType: 'FULL_TIME', baseSalary: { currency: 'AZN', value: { minValue: 1000, maxValue: 1400 } }, ...o,
});
const detail = (id: string, o: Record<string, unknown> = {}) => `<html><head><link rel="canonical" href="${detailUrl(id)}"><script type="application/ld+json">${JSON.stringify(posting(id, o))}</script></head><body><main><h1>Data Analitik</h1></main></body></html>`;
const card = (id: string, title = 'Data Analitik') => `<a href="/vakansiya/${id === '1' ? 'data-analitik' : 'data-analitik'}-${id}"><p>${title}</p><p>Nümunə MMC</p></a>`;
const listing = (...cards: string[]) => `<html><body><main><div>${cards.join('')}</div></main></body></html>`;

describe('HRIN public listing and detail parser', () => {
  it('validates only public vacancy, robots and sitemap paths and canonicalizes query/fragment', () => {
    expect(hrinUrl(`${detailUrl('123')}?utm_source=x#job`)).toBe(detailUrl('123'));
    for (const bad of [
      'https://evil.example/vakansiya/data-123', 'http://hrin.az/vakansiya/data-123', 'https://hrin.az/api/vacancies',
      'https://hrin.az/profil', 'https://hrin.az/isegoturen', 'https://hrin.az/vakansiya/%2e%2e%2fprofil-1',
      'https://user:pass@hrin.az/vakansiya/data-123',
    ]) expect(() => hrinUrl(bad)).toThrow();
  });

  it('extracts only valid public vacancy card links and stable numeric ids', () => {
    expect(parseHrinListing(listing(card('1'), card('2'), '<a href="/profil"><p>Profile</p></a>'))).toEqual([
      { id: '1', url: detailUrl('1'), title: 'Data Analitik' }, { id: '2', url: detailUrl('2'), title: 'Data Analitik' },
    ]);
    expect(() => parseHrinListing('<html><main><p>No jobs</p></main></html>')).toThrow('no recognizable');
  });

  it('maps JobPosting data, requires matching canonical/id/title, and cleans HTML from the description', () => {
    const entry = parseHrinListing(listing(card('123')))[0];
    expect(parseHrinDetail(detail('123'), entry.url, now, entry)).toMatchObject({
      externalId: 'hrin:123', title: 'Data Analitik', company: 'Nümunə MMC', location: 'Bakı', url: entry.url,
      postedAt: '2026-10-20T00:00:00.000Z', deadline: '2026-11-20T00:00:00.000Z',
      rawPayload: { source: 'hrin', locationKnown: true, employmentType: 'FULL_TIME', salary: '1000-1400 AZN', sourceAttribution: HRIN_ORIGIN },
    });
    const parsed = parseHrinDetail(detail('123'), entry.url, now, entry);
    expect(parsed.description).toContain('SQL ilə hesabat hazırlamaq');
    expect(parsed.description).not.toContain('<li>');
    expect(() => parseHrinDetail(detail('123', { identifier: { value: '999' } }), entry.url, now)).toThrow('identifier mismatch');
    expect(() => parseHrinDetail(detail('123').replace(detailUrl('123'), detailUrl('999')), entry.url, now)).toThrow('canonical');
    expect(() => parseHrinDetail(detail('123', { title: 'Other role' }), entry.url, now)).toThrow('title disagree');
    expect(() => parseHrinDetail(detail('123', { jobLocation: { address: { addressCountry: 'US', addressLocality: 'New York' } } }), entry.url, now)).toThrow('Foreign vacancy');
  });

  it('uses only robots-allowed public pages, respects delay, skips known entries and never claims a complete census', async () => {
    const calls: string[] = []; const delays: number[] = [];
    const robots = 'User-agent: *\nAllow: /\nDisallow: /api\nDisallow: /profil\nDisallow: /muracietlerim';
    const read = jest.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/robots.txt')) return robots;
      if (url.endsWith('/vakansiyalar')) return listing(card('1'), card('2'));
      if (url === detailUrl('2')) return detail('2');
      throw new Error(`unexpected ${url}`);
    });
    const collector = new HrinCollector(read, async (ms) => { delays.push(ms); }, () => now);
    const accepted: string[] = [];
    const report = await collector.collect({ maxPages: 3, maxJobs: 5, delayMs: 1000, isKnown: (id) => id === 'hrin:1' }, async (job) => { accepted.push(job.externalId); });
    expect(report).toMatchObject({ complete: false, pages: 1, discovered: 2, fetched: 1, known: 1, accepted: 1, failed: 0, delayMs: 1500 });
    expect(accepted).toEqual(['hrin:2']);
    expect(Math.min(...delays)).toBe(1500);
    expect(calls).toEqual([`${HRIN_ORIGIN}/robots.txt`, `${HRIN_ORIGIN}/vakansiyalar`, detailUrl('2')]);
    expect(report.error).toContain('no closures inferred');
  });

  it('resumes at the stable item cursor, respects fetch budget and does not ingest expired vacancies', async () => {
    const calls: string[] = [];
    const read = async (url: string) => {
      calls.push(url);
      if (url.endsWith('/robots.txt')) return 'User-agent: *\nAllow: /\nDisallow: /api';
      if (url.endsWith('/vakansiyalar')) return listing(card('1'), card('2'), card('3'));
      if (url === detailUrl('1')) return detail('1');
      if (url === detailUrl('2')) return detail('2');
      if (url === detailUrl('3')) return detail('3', { validThrough: '2026-10-01T00:00:00.000Z' });
      throw new Error(`unexpected ${url}`);
    };
    const collector = new HrinCollector(read, async () => {}, () => now);
    const accepted: string[] = [];
    const first = await collector.collect({ maxPages: 1, maxJobs: 1, delayMs: 1000 }, async (job) => { accepted.push(job.externalId); });
    expect(first.cursor).toEqual({ kind: 'cursor', value: 'hrin:2' });
    expect(accepted).toEqual(['hrin:1']);
    const resumed = await collector.collect({ maxPages: 1, maxJobs: 2, delayMs: 1000, resume: first.cursor! }, async (job) => { accepted.push(job.externalId); });
    expect(resumed).toMatchObject({ complete: false, discovered: 2, fetched: 2, expired: 1, accepted: 1 });
    expect(accepted).toEqual(['hrin:1', 'hrin:2']);
    expect(calls.filter((url) => /\/api|\/profil|muracietlerim/.test(url))).toHaveLength(0);
  });

  it('registers as a bounded job-board source', () => {
    expect(COLLECTOR_KEYS).toContain('hrin');
    expect(collectorFor('hrin')).toBeInstanceOf(HrinCollector);
  });
});
