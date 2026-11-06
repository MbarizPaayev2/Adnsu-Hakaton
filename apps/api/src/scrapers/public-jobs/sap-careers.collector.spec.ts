import { SAP_SOURCES, SapCareersCollector, parseSapJob, parseSapListing, sapSearchUrl, sapUrl, type SapSource } from './sap-careers.collector';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IngestJobDto } from '../../jobs/dto/ingest-job.dto';

const NOW = new Date('2026-10-01T12:00:00Z');
const url = (source: SapSource, id = 123) => `${SAP_SOURCES[source].origin}${SAP_SOURCES[source].prefix}/job/Baku-Engineer/${id}/`;
const detail = (source: SapSource, country = 'AZ', city = 'Baku', changes = '') => `<div itemscope itemtype="http://schema.org/JobPosting">
  <meta itemprop="hiringOrganization" content="${SAP_SOURCES[source].organizations[0]}"><meta itemprop="addressCountry" content="${country}">
  <meta itemprop="addressLocality" content="${city}"><meta itemprop="datePosted" content="Thu Oct 01 00:00:00 UTC 2026">
  <meta itemprop="validThrough" content="Sat Oct 10 20:00:00 UTC 2026"><span itemprop="title">Backend Engineer</span>
  <div itemprop="description"><p>TypeScript &amp; APIs.</p><script>not-content</script><ul><li>PostgreSQL.</li></ul></div>${changes}</div>`;
const listing = (source: SapSource, ids: number[], total = ids.length, start = 1) => `<div class="paginationLabel">Results ${start} – ${start + ids.length - 1} of ${total}</div>${ids.flatMap((id) => [1, 2].map(() => `<a class="jobTitle-link" href="${url(source, id)}">Engineer</a>`)).join('')}`;
const opts = { maxPages: 3, maxJobs: 20, delayMs: 1500 };

describe('official SAP career sources', () => {
  it.each(['socar', 'azercell', 'ey', 'halliburton'] as const)('parses %s metadata into a valid import payload', async (source) => {
    const job = parseSapJob(source, detail(source), url(source), NOW)!;
    expect(job).toMatchObject({ externalId: `${source}:123`, company: SAP_SOURCES[source].company, title: 'Backend Engineer', location: 'Baku', description: 'TypeScript & APIs.\nPostgreSQL.', postedAt: '2026-10-01T00:00:00.000Z', deadline: '2026-10-10T20:00:00.000Z' });
    expect(await validate(plainToInstance(IngestJobDto, job))).toEqual([]);
  });
  it('assigns Azercell only to its verified tenant path, not sibling ecosystem employers', () => {
    expect(() => sapUrl('azercell', 'https://careers.digitalecosystem.az/job/Baku-Other/123/')).toThrow();
    expect(parseSapJob('azercell', detail('azercell'), url('azercell'), NOW)?.company).toBe('Azercell');
  });
  it.each([['US', 'Phoenix'], ['US', 'Baku'], ['AE', 'Dubai'], ['', 'Unknown city']])('excludes foreign/unproven geography %s %s', (country, city) => {
    expect(parseSapJob('ey', detail('ey', country, city), url('ey'), NOW)).toBeNull();
  });
  it('uses street-address evidence where the tenant lacks separate city/country fields', () => {
    const html = detail('azercell', '', '').replace('<meta itemprop="addressCountry" content="">', '<meta itemprop="streetAddress" content="Baku, AZ">');
    expect(parseSapJob('azercell', html, url('azercell'), NOW)?.location).toBe('Baku');
    expect(parseSapJob('azercell', html.replace('Baku, AZ', 'Phoenix, AZ'), url('azercell'), NOW)).toBeNull();
    expect(parseSapJob('socar', detail('socar', '', '', '<meta itemprop="streetAddress" content="Bakı">'), url('socar'), NOW)?.location).toBe('Bakı');
    expect(parseSapJob('socar', detail('socar', 'US', '', '<meta itemprop="streetAddress" content="Bakı">'), url('socar'), NOW)).toBeNull();
    expect(parseSapJob('socar', detail('socar', '', '', '<meta itemprop="streetAddress" content="Xankəndi">'), url('socar'), NOW)?.location).toBe('Xankəndi');
    const district = detail('socar', '', '', '<meta itemprop="streetAddress" content="Digər">').replace('Backend Engineer', 'Təcrübəçi (İnsan resursları, Salyan rayonu)');
    expect(parseSapJob('socar', district, url('socar'), NOW)).toMatchObject({ location: 'Salyan', rawPayload: { locationEvidence: 'explicit-title-district' } });
    expect(parseSapJob('socar', district.replace('Salyan', 'Unknown'), url('socar'), NOW)).toBeNull();
    const postal = (street: string) => detail('socar', '', '', `<meta itemprop="streetAddress" content="${street}">`);
    expect(parseSapJob('socar', postal('4770, AZ'), url('socar'), NOW)).toMatchObject({ location: 'Azerbaijan', rawPayload: { locationEvidence: 'source-country-code-without-city' } });
    expect(parseSapJob('socar', postal('85001, AZ'), url('socar'), NOW)).toBeNull(); // a five-digit code is a US ZIP
    expect(parseSapJob('socar', postal('Phoenix, AZ'), url('socar'), NOW)).toBeNull();
    expect(parseSapJob('azercell', detail('azercell', '', '', '<meta itemprop="streetAddress" content="4770, AZ">'), url('azercell'), NOW)).toBeNull(); // only SOCAR's own format
    // Internship postings carry "0" as country and city; only the title's own parenthesis can place them, and only inside Azerbaijan.
    const zero = (title: string) => detail('socar', '0', '', '<meta itemprop="addressLocality" content="0">').replace('Backend Engineer', title);
    expect(parseSapJob('socar', zero('Təcrübəçi (Metrologiya, Naxçıvan şəhəri)'), url('socar'), NOW)).toMatchObject({ location: 'Naxçıvan', rawPayload: { locationEvidence: 'explicit-title-district' } });
    expect(parseSapJob('socar', zero('Təcrübəçi (Kimya mühəndisliyi, Sumqayıt şəhəri)'), url('socar'), NOW)).toMatchObject({ location: 'Sumqayıt' });
    expect(parseSapJob('socar', zero('Təcrübəçi (Geologiya)'), url('socar'), NOW)).toBeNull(); // no place anywhere: not guessed
    expect(parseSapJob('socar', zero('Təcrübəçi (Maliyyə, Tbilisi şəhəri)'), url('socar'), NOW)).toBeNull(); // a place outside the list is never inferred
    expect(parseSapJob('socar', detail('socar', 'US', '', '<meta itemprop="addressLocality" content="Phoenix">').replace('Backend Engineer', 'Təcrübəçi (Maliyyə, Sumqayıt şəhəri)'), url('socar'), NOW)).toBeNull(); // a stated foreign country wins
  });
  it('requires a recognizable organization, posting date, metadata and description', () => {
    for (const html of [detail('socar').replace('content="SOCAR"', 'content="Other employer"'), detail('socar').replace('Thu Oct 01 00:00:00 UTC 2026', 'yesterday'), '<h1>challenge</h1>', detail('socar').replace('itemprop="description"', 'itemprop="missing"')]) {
      expect(() => parseSapJob('socar', html, url('socar'), NOW)).toThrow();
    }
  });
  it('does not fabricate missing deadlines or import future postings', () => {
    expect(parseSapJob('socar', detail('socar').replace('Sat Oct 10 20:00:00 UTC 2026', ''), url('socar'), NOW)?.deadline).toBeUndefined();
    expect(parseSapJob('socar', detail('socar').replace('Thu Oct 01', 'Fri Oct 02'), url('socar'), NOW)).toBeNull();
  });
  it('rejects normalized invalid dates and overlong descriptions instead of inventing or truncating source data', () => {
    for (const value of ['Sun Feb 29 00:00:00 UTC 2026', 'Thu Oct 01 24:00:00 UTC 2026', '2026-02-31T00:00:00Z', '2026-10-01T24:00:00Z']) {
      expect(() => parseSapJob('azercell', detail('azercell').replace('Thu Oct 01 00:00:00 UTC 2026', value), url('azercell'), NOW)).toThrow();
    }
    expect(() => parseSapJob('azercell', detail('azercell').replace('TypeScript &amp; APIs.', 'x'.repeat(40_001)), url('azercell'), NOW)).toThrow();
  });
  it('imports a description above the former 20,000-character limit whole, without truncation', async () => {
    const long = 'y'.repeat(20_367);
    const job = parseSapJob('azercell', detail('azercell').replace('TypeScript &amp; APIs.', long), url('azercell'), NOW)!;
    expect(job.description).toContain(long);
    expect(await validate(plainToInstance(IngestJobDto, job))).toEqual([]);
  });
  it('uses the earliest deadline when the posting text contradicts the structured one, and records why', () => {
    const html = detail('azercell').replace('TypeScript &amp; APIs.', 'Müraciət üçün son tarix: 05.10.2026\nApplication deadline: 05.10.2026');
    const job = parseSapJob('azercell', html, url('azercell'), NOW)!;
    expect(job.deadline).toBe('2026-10-05T19:59:59.999Z');
    expect(job.rawPayload).toMatchObject({ deadlineConflict: { structured: '2026-10-10T20:00:00.000Z', used: '2026-10-05T19:59:59.999Z' } });
    const impossible = detail('azercell').replace('TypeScript &amp; APIs.', 'Application deadline: 30.09.2026');
    expect(parseSapJob('azercell', impossible, url('azercell'), NOW)).toMatchObject({ deadline: '2026-10-10T20:00:00.000Z', rawPayload: { deadlineConflict: { note: expect.stringContaining('ignored') } } });
  });
  it('keeps the structured deadline when the text agrees, and never adds one the source lacks', () => {
    const agrees = detail('azercell').replace('TypeScript &amp; APIs.', 'Application deadline: 10.10.2026');
    const job = parseSapJob('azercell', agrees, url('azercell'), NOW)!;
    expect(job.deadline).toBe('2026-10-10T20:00:00.000Z');
    expect(job.rawPayload).not.toHaveProperty('deadlineConflict');
    const none = detail('azercell').replace('Sat Oct 10 20:00:00 UTC 2026', '').replace('TypeScript &amp; APIs.', 'Application deadline: 30.09.2026');
    expect(parseSapJob('azercell', none, url('azercell'), NOW)?.deadline).toBeUndefined();
  });
  it('deduplicates mobile/desktop cards and validates pagination', () => {
    expect(parseSapListing('socar', listing('socar', [1, 2], 3), 0)).toMatchObject({ urls: [url('socar', 1), url('socar', 2)], total: 3, nextOffset: 2 });
    expect(() => parseSapListing('socar', listing('socar', [1, 2], 3), 10)).toThrow();
    expect(() => parseSapListing('socar', listing('socar', [1, 1], 3), 0)).toThrow();
  });
  it('accepts an explicit zero but refuses layout failures as zero', () => {
    expect(parseSapListing('ey', '<div id="noresults"><div id="noresults-message">The 0 most recent jobs posted are listed below for your convenience.</div></div>', 0)).toMatchObject({ urls: [], total: 0, nextOffset: null });
    expect(() => parseSapListing('ey', '<h1>No jobs</h1>', 0)).toThrow();
  });
  it.each(['https://example.com/job/Engineer/123/', 'https://jobs.socar.az/applybutton/123/', 'https://jobs.socar.az/search/?q=foreign', 'https://jobs.socar.az/search/?startrow=-1', 'https://jobs.socar.az/search/?startrow=1&startrow=2', 'https://jobs.socar.az/job/Baku/123/?token=private', 'https://jobs.socar.az/job/Baku%2Fprivate/123/'])('refuses unsupported URL %s', (input) => expect(() => sapUrl('socar', input)).toThrow());
  it('retains the geography filter when advancing EY pagination', () => {
    expect(new URL(sapSearchUrl('ey', 20)).searchParams.get('locationsearch')).toBe('Baku');
    expect(() => sapUrl('ey', 'https://careers.ey.com/ey/search/?locationsearch=Dubai')).toThrow();
    expect(new URL(sapSearchUrl('halliburton', 20)).searchParams.get('locationsearch')).toBe('Azerbaijan');
    expect(parseSapJob('halliburton', detail('halliburton', 'US', 'Phoenix'), url('halliburton'), NOW)).toBeNull();
  });
  it('collects multiple pages and original details with stable identities', async () => {
    const read = jest.fn(async (input: string) => input.endsWith('robots.txt') ? 'User-agent: *\nDisallow: /applybutton/' : input.includes('/job/') ? detail('socar') : input.includes('startrow=2') ? listing('socar', [3], 3, 3) : listing('socar', [1, 2], 3));
    const pause = jest.fn(async () => {}), accept = jest.fn(async () => {});
    expect(await new SapCareersCollector('socar', read, pause, () => NOW).collect(opts, accept)).toMatchObject({ complete: true, discovered: 3, accepted: 3, pages: 2 });
    expect(accept.mock.calls.map((call) => (call[0] as IngestJobDto).externalId)).toEqual(['socar:1', 'socar:2', 'socar:3']);
    expect(pause).toHaveBeenCalledTimes(5);
  });
  it('reports limits and parse failures without inferring closures', async () => {
    const reader = (bad: boolean) => async (input: string) => input.endsWith('robots.txt') ? 'User-agent: *\nAllow: /' : input.includes('/job/') ? bad ? '<h1>changed layout</h1>' : detail('socar') : listing('socar', [1, 2]);
    expect(await new SapCareersCollector('socar', reader(false), async () => {}, () => NOW).collect({ ...opts, maxJobs: 1 }, async () => {})).toMatchObject({ complete: false, fetched: 1, accepted: 1 });
    expect(await new SapCareersCollector('socar', reader(true), async () => {}, () => NOW).collect(opts, async () => {})).toMatchObject({ complete: false, failed: 2, accepted: 0 });
  });
  it('refreshes expired deadlines and stops on robots or HTTP/API errors', async () => {
    const reader = async (input: string) => input.endsWith('robots.txt') ? 'User-agent: *\nAllow: /' : input.includes('/job/') ? detail('socar').replace('Sat Oct 10 20:00:00 UTC 2026', 'Thu Oct 01 01:00:00 UTC 2026') : listing('socar', [1]);
    expect(await new SapCareersCollector('socar', reader, async () => {}, () => NOW).collect(opts, async () => {})).toMatchObject({ complete: true, accepted: 1, expired: 1 });
    const blocked = jest.fn(async () => 'User-agent: *\nDisallow: /');
    expect(await new SapCareersCollector('socar', blocked, async () => {}).collect(opts, async () => {})).toMatchObject({ complete: false, pages: 0 });
    expect(blocked).toHaveBeenCalledTimes(1);
    expect(await new SapCareersCollector('socar', reader, async () => {}, () => NOW).collect(opts, async () => { throw new Error('Import API HTTP 500'); })).toMatchObject({ complete: false, accepted: 0, error: 'Import API HTTP 500' });
  });
});
