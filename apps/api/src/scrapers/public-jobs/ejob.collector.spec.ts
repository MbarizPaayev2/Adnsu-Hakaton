import { EjobCollector } from './ejob.collector';
import { EJOB_ORIGIN, ejobUrl, parseEjobDetail, parseEjobListing } from './ejob.parser';
import { COLLECTOR_KEYS, collectorFor } from './collector-registry';
import { extractApplicationEmail } from '../../jobs/job-facts';
import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';

// Synthetic fixtures that follow the structure observed on the public pages (2026-10-03): numbered listing with featured entries repeated on every page,
// detail page with a JobPosting JSON-LD block (ISO datePosted, zone-less validThrough) and a table of labelled fields. No third-party text is reproduced.
const now = new Date('2026-10-03T12:00:00.000Z');
const U = (id: number, slug = 'data-analyst') => `${EJOB_ORIGIN}/is-elani/${id}-${slug}/`;
const listing = (ids: number[], pages: number[] = []) => `<html><body><div class="vip"><a href="/is-elani/900-featured-role/">Featured</a></div>${ids.map((i) => `<a href='/is-elani/${i}-data-analyst/'>Job ${i}</a>`).join('')}${pages.map((p) => `<a href="/is-elanlari/page-${p}/">${p}</a>`).join('')}</body></html>`;
const ld = (over: Record<string, unknown> = {}, id = 104700) => JSON.stringify({ '@context': 'https://schema.org/', '@type': 'JobPosting', title: 'Data Analyst', description: '<p>stub</p>', identifier: { '@type': 'PropertyValue', name: 'ACME MMC', value: String(id) }, datePosted: '2026-09-30', validThrough: '2026-12-31T00:00', jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Bakı', addressCountry: 'AZ' } }, employmentType: 'FULL_TIME', hiringOrganization: { '@type': 'Organization', name: 'ACME MMC' }, baseSalary: { '@type': 'MonetaryAmount', currency: 'AZN', value: { minValue: 1000, maxValue: 1200 } }, ...over });
const detail = (o: { id?: number; ld?: string | null; title?: string; company?: string; text?: string; posted?: string; city?: string } = {}) => `<!doctype html><html><head>${o.ld === null ? '' : `<script type="application/ld+json">${o.ld ?? ld({}, o.id)}</script>`}</head><body>
<div class="nav">Support: help@ejob.example · Vakansiya yüklə</div>
<table><tr><td colspan='2'><h1 class='position'>${o.title ?? 'Data Analyst'}</h1></td></tr><tr><td colspan='2'><a href='/company/acme-mmc/'><div class='name'>${o.company ?? 'ACME MMC'}</div></a></td></tr>
<tr><td class='ttitle'>Şəhər :</td><td>${o.city ?? 'Bakı'}</td></tr><tr><td class='ttitle'>Əlaqədar şəxs :</td><td>HR</td></tr></table>
<strong class='salary'>Əmək haqqı : 1000 - 1200 AZN</strong>
<table><tr><td>İş barədə məlumat:<br>• Hesabatların hazırlanması;<br>• Məlumatların təhlili.<br>Tələblər:<br>• SQL və Excel bilikləri.<br>${o.text ?? ''}</td></tr></table>
<p>Əlavə olunub : ${o.posted ?? '2026-09-30'} </p><p>Baxılıb : 42</p><p>Şikayət ✉ abuse@ejob.example</p></body></html>`;

describe('eJob parser', () => {
  it('walks listing entries and the next numbered page; repeated featured entries are tolerated, params dropped', () => {
    const parsed = parseEjobListing(listing([1, 2], [2, 3, 60]), `${EJOB_ORIGIN}/is-elanlari/`);
    expect(parsed.urls).toEqual([U(900, 'featured-role'), U(1), U(2)]);
    expect(parsed.next).toBe(`${EJOB_ORIGIN}/is-elanlari/page-2/`);
    expect(parseEjobListing(listing([3]), `${EJOB_ORIGIN}/is-elanlari/page-60/`).next).toBeNull();
    expect(ejobUrl(`${EJOB_ORIGIN}/is-elani/104700-data-analyst/?utm_source=x#frag`)).toBe(U(104700));
  });
  it('rejects non-vacancy URLs, other origins and credentials (cabinet, message, upload, PDF are never fetched)', () => {
    for (const bad of ['https://ejob.az/cabinet/x', 'https://ejob.az/message/', 'https://ejob.az/pdf/vakansiya/1/', 'https://evil.example/is-elani/1-a/', 'https://u:p@ejob.az/is-elani/1-a/', 'https://ejob.az/is-elani/1-a/%2e%2e/']) expect(() => ejobUrl(bad)).toThrow();
  });
  it('an empty or unrecognised listing is an error, never an empty census', () => {
    expect(() => parseEjobListing('<html><body>Maintenance</body></html>', `${EJOB_ORIGIN}/is-elanlari/`)).toThrow('no recognizable');
  });
  it('parses identity, employer, location, ISO publication date, deadline and salary with Baku-time dates', () => {
    const job = parseEjobDetail(detail(), U(104700), now);
    expect(job).toMatchObject({ externalId: 'ejob:104700', title: 'Data Analyst', company: 'ACME MMC', location: 'Bakı', url: U(104700), postedAt: '2026-09-29T20:00:00.000Z', deadline: '2026-12-30T20:00:00.000Z' });
    expect(job.description).toContain('Hesabatların hazırlanması');
    expect(job.description).toContain('SQL və Excel');
    expect(job.rawPayload).toMatchObject({ source: 'ejob', salary: '1000-1200 AZN', employmentType: 'FULL_TIME', locationKnown: true });
  });
  it('decodes HTML entities that eJob leaves inside its structured data (observed: a quoted restaurant name) instead of calling it a disagreement', () => {
    const job = parseEjobDetail(detail({ company: '&quot;Kitchen Plus&quot; restoranı', ld: ld({ hiringOrganization: { name: '&quot;Kitchen Plus&quot; restoranı' } }) }), U(104700), now);
    expect(job.company).toBe('"Kitchen Plus" restoranı');
  });
  it('falls back to the visible fields when structured data is absent', () => {
    expect(parseEjobDetail(detail({ ld: null }), U(104700), now)).toMatchObject({ company: 'ACME MMC', location: 'Bakı', postedAt: '2026-09-29T20:00:00.000Z' });
  });
  it('page chrome (support, complaint addresses, cabinet text) never reaches the description or the application address', () => {
    const job = parseEjobDetail(detail(), U(104700), now);
    expect(job.description).not.toMatch(/@|ejob\.example|Vakansiya yüklə|Şikayət/);
    expect(extractApplicationEmail(job.description)).toBeNull();
  });
  it('an application address is produced only from an explicit instruction inside the vacancy text', () => {
    const withInstruction = parseEjobDetail(detail({ text: 'CV-nizi hr@acme.example ünvanına göndərin.' }), U(104700), now);
    expect(extractApplicationEmail(withInstruction.description)?.email).toBe('hr@acme.example');
    const questions = parseEjobDetail(detail({ text: 'Suallar üçün info@acme.example ilə əlaqə saxlayın.' }), U(104700), now);
    expect(extractApplicationEmail(questions.description)).toBeNull();
  });
  it('rejects instead of inventing: missing/invalid date, missing text, disagreeing structured data, bad deadline, foreign location, wrong id', () => {
    expect(() => parseEjobDetail(detail({ posted: '03-10-2026', ld: ld({ datePosted: undefined }) }), U(104700), now)).toThrow();
    expect(() => parseEjobDetail(detail({ ld: ld({ datePosted: '2026-02-30' }) }), U(104700), now)).toThrow();
    expect(() => parseEjobDetail(detail().replace('İş barədə məlumat:', 'Məlumat:'), U(104700), now)).toThrow('vacancy text');
    expect(() => parseEjobDetail(detail({ title: 'Different Role' }), U(104700), now)).toThrow('disagree');
    expect(() => parseEjobDetail(detail({ company: 'Other MMC' }), U(104700), now)).toThrow('disagree');
    expect(() => parseEjobDetail(detail({ ld: ld({ validThrough: 'soon' }) }), U(104700), now)).toThrow('deadline');
    expect(() => parseEjobDetail(detail({ ld: ld({ jobLocation: { '@type': 'Place', address: { addressLocality: 'Istanbul', addressCountry: 'TR' } } }) }), U(104700), now)).toThrow();
    expect(() => parseEjobDetail(detail({ id: 1 }), U(104700), now)).toThrow('identifier');
    expect(() => parseEjobDetail('<html><body>Not found</body></html>', U(104700), now)).toThrow();
  });
  it('an unknown location stays flagged unknown (the country-level fallback is not presented as a city)', () => {
    const job = parseEjobDetail(detail({ ld: ld({ jobLocation: undefined }), city: '' }).replace(/<tr><td class='ttitle'>Şəhər :<\/td>.*?<\/tr>/s, ''), U(104700), now);
    expect(job.location).toBe('Azerbaijan');
    expect(job.rawPayload?.locationKnown).toBe(false);
  });
});

describe('eJob collector', () => {
  const robots = 'User-agent: *\nDisallow: /cabinet/*\n\nUser-agent: GPTBot\nCrawl-delay: 5';
  const setup = (pages: Record<string, string>, over: { robots?: string; fail?: string } = {}) => {
    const calls: string[] = [];
    const delays: number[] = [];
    const read = jest.fn(async (url: string) => {
      calls.push(url);
      if (url === over.fail) throw new Error('Source HTTP 429');
      if (url.endsWith('/robots.txt')) return over.robots ?? robots;
      if (pages[url] !== undefined) return pages[url];
      if (url.includes('/is-elani/')) return detail({ id: Number(/is-elani\/(\d+)-/.exec(url)![1]) });
      throw new Error(`unexpected ${url}`);
    });
    const collector = new EjobCollector(read, async (ms) => { delays.push(ms); }, () => now);
    return { calls, delays, read, collector };
  };
  const pages = {
    [`${EJOB_ORIGIN}/is-elanlari/`]: listing([1, 2], [2]),
    [`${EJOB_ORIGIN}/is-elanlari/page-2/`]: listing([3], []),
  };

  it('walks to the last page, de-duplicates featured entries, and still never claims a complete census', async () => {
    const { collector, calls } = setup(pages);
    const accepted: IngestJobDto[] = [];
    const report = await collector.collect({ maxPages: 5, maxJobs: 50, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report).toMatchObject({ complete: false, pages: 2, discovered: 4, fetched: 4, accepted: 4, failed: 0 });
    expect(report.error).toMatch(/^Collection limit reached; .*census is not proven/);
    expect(accepted.map((j) => j.externalId).sort()).toEqual(['ejob:1', 'ejob:2', 'ejob:3', 'ejob:900']);
    expect(calls.filter((u) => u.endsWith('/is-elani/900-featured-role/'))).toHaveLength(1);
  });
  it('a page or job cap keeps the run incomplete with a limit message', async () => {
    const { collector } = setup(pages);
    const report = await collector.collect({ maxPages: 1, maxJobs: 2, delayMs: 1000 }, async () => {});
    expect(report.complete).toBe(false);
    expect(report.error).toContain('Collection limit reached');
    expect(report.fetched).toBe(2);
  });
  it('paces at no less than 5 s even when asked for 1 s, and never below a crawl-delay that applies to us', async () => {
    const a = setup(pages);
    await a.collector.collect({ maxPages: 1, maxJobs: 1, delayMs: 1000 }, async () => {});
    expect(Math.min(...a.delays)).toBe(5000);
    const b = setup(pages, { robots: 'User-agent: *\nCrawl-delay: 12\nDisallow: /cabinet/*' });
    const report = await b.collector.collect({ maxPages: 1, maxJobs: 1, delayMs: 1000 }, async () => {});
    expect(Math.min(...b.delays)).toBe(12_000);
    expect(report.delayMs).toBe(12_000);
  });
  it('stops on a blocking response and never retries around it; the run is incomplete and reports the error', async () => {
    const { collector, read } = setup(pages, { fail: U(1) });
    const report = await collector.collect({ maxPages: 5, maxJobs: 50, delayMs: 1000 }, async () => {});
    expect(report.error).toContain('429');
    expect(report.complete).toBe(false);
    expect(read.mock.calls.filter(([u]) => u === U(1))).toHaveLength(1);
  });
  it('honours robots rules for the listing path itself', async () => {
    const { collector } = setup(pages, { robots: 'User-agent: *\nDisallow: /is-elanlari/' });
    const report = await collector.collect({ maxPages: 2, maxJobs: 5, delayMs: 1000 }, async () => {});
    expect(report.error).toContain('crawler rules prohibit');
    expect(report.discovered).toBe(0);
  });
  it('counts unparseable details as failed (never accepted) and skips stored postings', async () => {
    const withBad = { ...pages, [U(2)]: '<html><body>Layout changed</body></html>' };
    const { collector, calls } = setup(withBad);
    const accepted: string[] = [];
    const report = await collector.collect({ maxPages: 5, maxJobs: 50, delayMs: 1000, isKnown: (id) => id === 'ejob:3' }, async (j) => { accepted.push(j.externalId); });
    expect(report).toMatchObject({ failed: 1, known: 1, fetched: 3 });
    expect(Object.values(report.rejections ?? {})).toEqual([1]);
    expect(Object.keys(report.rejections ?? {})[0]).not.toContain('Layout');
    expect(accepted).not.toContain('ejob:2');
    expect(accepted).not.toContain('ejob:3');
    expect(report.error).toContain('no closures inferred');
    expect(calls.some((u) => u === U(3))).toBe(false);
  });
  it('counts a posting whose stated deadline has passed as expired, not as a live job', async () => {
    const past = { ...pages, [U(1)]: detail({ id: 1, ld: ld({ validThrough: '2026-09-01T00:00' }, 1) }) };
    const { collector } = setup(past);
    const report = await collector.collect({ maxPages: 1, maxJobs: 5, delayMs: 1000 }, async () => {});
    expect(report.expired).toBe(1);
  });
  it('refuses unsafe limits and is registered for the CLI and scheduler under its source key', async () => {
    await expect(new EjobCollector().collect({ maxPages: 0, maxJobs: 1, delayMs: 1000 }, async () => {})).rejects.toThrow('Invalid collection limits');
    expect(COLLECTOR_KEYS).toContain('ejob');
    expect(collectorFor('ejob')).toBeInstanceOf(EjobCollector);
  });
});

describe('eJob resumable discovery (cursor)', () => {
  const robots = 'User-agent: *\nDisallow: /cabinet/*';
  const map: Record<string, string> = {
    [`${EJOB_ORIGIN}/is-elanlari/`]: listing([1, 2], [2]),
    [`${EJOB_ORIGIN}/is-elanlari/page-2/`]: listing([3, 4], [3]),
    [`${EJOB_ORIGIN}/is-elanlari/page-3/`]: listing([5], []),
  };
  const run = (extra: Record<string, unknown> = {}) => {
    const asked: string[] = [];
    const read = jest.fn(async (url: string) => {
      asked.push(url);
      if (url.endsWith('/robots.txt')) return robots;
      if (map[url] !== undefined) return map[url];
      if (url.includes('/is-elani/')) return detail({ id: Number(/is-elani\/(\d+)-/.exec(url)![1]) });
      throw new Error(`unexpected ${url}`);
    });
    return { asked, go: () => new EjobCollector(read, async () => {}, () => now).collect({ maxPages: 9, maxJobs: 50, delayMs: 1000, ...extra } as never, async () => {}) };
  };

  it('a bounded run stops with the next listing URL and the page before it; the resumed run starts at that earlier page and never claims completeness', async () => {
    const a = run({ maxPages: 2 });
    const r1 = await a.go();
    expect(r1.cursor).toEqual({ kind: 'url', url: `${EJOB_ORIGIN}/is-elanlari/page-3/`, prev: `${EJOB_ORIGIN}/is-elanlari/page-2/` });
    const b = run({ resume: r1.cursor });
    const r2 = await b.go();
    expect(b.asked.filter((u) => u.includes('/is-elanlari/'))).toEqual([`${EJOB_ORIGIN}/is-elanlari/page-2/`, `${EJOB_ORIGIN}/is-elanlari/page-3/`]);
    expect(r2.cursor).toBeNull();
    expect(r2.complete).toBe(false);
  });

  it('when the fetch budget ends inside a page the cursor stays on that page', async () => {
    const r = await run({ maxJobs: 3 }).go();
    expect(r.cursor).toMatchObject({ kind: 'url', url: `${EJOB_ORIGIN}/is-elanlari/page-2/` });
  });
});
