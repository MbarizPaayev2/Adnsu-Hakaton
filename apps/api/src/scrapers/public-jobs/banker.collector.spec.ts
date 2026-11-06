import { BankerCollector } from './banker.collector';
import { BANKER_ORIGIN, bankerUrl, parseBankerDetail, parseBankerListing } from './banker.parser';
import { COLLECTOR_KEYS, collectorFor } from './collector-registry';
import { deriveJobFacts } from '../../jobs/job-facts';

const at = new Date('2026-10-27T12:00:00Z');

const listCard = (slug: string, title: string, company: string, location = '', date = '') => `
<div class="row sjb-list-row">
  <div class="col-md-5 col-sm-12">
    <div class="job-info">
      <h4>
        <a href="https://banker.az/jobs/${slug}/">
          <span class="job-title">${title} – ${company}</span>
        </a>
      </h4>
      ${location ? `<div class="job-location">${location}</div>` : ''}
      ${date ? `<div class="job-date">${date}</div>` : ''}
    </div>
  </div>
</div>`;

const sampleList = (cards: string[]) => `
<html>
  <head><title>Vakansiyalar | Banker.az</title></head>
  <body>
    <div class="sjb-page">
      ${cards.join('')}
    </div>
  </body>
</html>`;

const sampleDetail = (slug: string, title: string, company: string, loc: string, email: string) => `
<html>
  <head>
    <title>${title} – ${company} | Banker.az</title>
  </head>
  <body>
    <header class="td-post-header">
      <time class="entry-date updated td-module-date" datetime="2026-10-05T16:36:13+00:00">05/10/2026</time>
    </header>
    <div class="td-post-content">
      <p><strong>${title}</strong></p>
      <p>İş yeri: ${loc} filialı</p>
      <p>Tələblər: Ali maliyyə təhsili və kreditləşmə təcrübəsi.</p>
      <p>Namizədlərdən CV formalarını mövzu hissəsində vakansiya adını qeyd etməklə ${email} ünvanına göndərmələri xahiş olunur.</p>
    </div>
  </body>
</html>`;

describe('banker.az collector & parser', () => {
  it('validates Banker.az URLs strictly', () => {
    expect(bankerUrl('https://banker.az/vakansiyalar/')).toBe('https://banker.az/vakansiyalar/');
    expect(bankerUrl('https://banker.az/vakansiyalar/?paged=2')).toBe('https://banker.az/vakansiyalar/?paged=2');
    expect(bankerUrl('https://banker.az/jobs/sirvan-filialina-kredit-mutexessisi/')).toBe('https://banker.az/jobs/sirvan-filialina-kredit-mutexessisi/');
    expect(bankerUrl('/jobs/risk-meneceri/')).toBe('https://banker.az/jobs/risk-meneceri/');
    expect(bankerUrl('https://banker.az/robots.txt')).toBe('https://banker.az/robots.txt');

    for (const bad of [
      'https://evil.example/jobs/123',
      'https://user:pw@banker.az/vakansiyalar/',
      'https://banker.az/wp-admin/',
      'https://banker.az/author/admin/',
      'https://banker.az/vakansiyalar/?paged=bad',
      'https://banker.az/jobs/',
    ]) {
      expect(() => bankerUrl(bad)).toThrow();
    }
  });

  it('parses listing cards, splitting title and company', () => {
    const html = sampleList([
      listCard('sirvan-mikro-kredit', 'Şirvan filialına Mikro kredit mütəxəssisi', 'Caspian İnvest BOKT'),
      listCard('aparici-kredit', 'Aparıcı kredit mütəxəssisi', 'AK GROUP Lombard'),
    ]);
    const { entries } = parseBankerListing(html);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      id: 'sirvan-mikro-kredit',
      url: 'https://banker.az/jobs/sirvan-mikro-kredit/',
      title: 'Şirvan filialına Mikro kredit mütəxəssisi',
      company: 'Caspian İnvest BOKT',
    });
    expect(entries[1]).toEqual({
      id: 'aparici-kredit',
      url: 'https://banker.az/jobs/aparici-kredit/',
      title: 'Aparıcı kredit mütəxəssisi',
      company: 'AK GROUP Lombard',
    });

    expect(() => parseBankerListing('<html><body><div>No jobs</div></body></html>')).toThrow('no recognizable vacancy entries');
    expect(parseBankerListing('<html><head><title>Vakansiyalar | Banker.az</title></head><body><div class="sjb-page"></div></body></html>')).toEqual({ entries: [] });
  });

  it('preserves card location and source posting date without replacing them with observation time', () => {
    const { entries } = parseBankerListing(sampleList([
      listCard('dated-job', 'Maliyyə analitiki', 'Example BOKT', 'Şirvan', '05.10.2026'),
    ]));
    expect(entries[0]).toMatchObject({ location: 'Şirvan', postedAt: '2026-10-05T00:00:00.000Z' });
    expect(parseBankerListing(sampleList([
      listCard('bad-date', 'Analitik', 'Example', 'Bakı', '31.02.2026'),
    ])).entries[0].postedAt).toBeUndefined();
  });

  it('parses detail pages with ISO time, location, and email application detection', () => {
    const html = sampleDetail(
      'sirvan-kredit',
      'Kredit mütəxəssisi',
      'Caspian İnvest BOKT',
      'Şirvan',
      'hr@caspianinvest.az',
    );
    const job = parseBankerDetail(html, 'https://banker.az/jobs/sirvan-kredit/', at);
    expect(job).toMatchObject({
      externalId: 'banker:sirvan-kredit',
      title: 'Kredit mütəxəssisi',
      company: 'Caspian İnvest BOKT',
      location: 'Şirvan',
      postedAt: '2026-10-05T16:36:13.000Z',
    });
    expect(job.description).toContain('hr@caspianinvest.az');
    expect(deriveJobFacts(job)).toMatchObject({
      applicationMethod: 'EMAIL',
      applicationEmail: 'hr@caspianinvest.az',
    });
  });

  it('collects banker postings with rate limiting, robots check, and known-skip handling', async () => {
    const listHtml = sampleList([
      listCard('job-1', 'Filial müdiri', 'İnternational BOKT'),
      listCard('job-2', 'Risk üzrə mütəxəssis', 'Caspian İnvest BOKT'),
    ]);
    const detail1 = sampleDetail('job-1', 'Filial müdiri', 'İnternational BOKT', 'Ağdaş', 'vakansiya@icu.az');
    const detail2 = sampleDetail('job-2', 'Risk üzrə mütəxəssis', 'Caspian İnvest BOKT', 'Bakı', 'hr@caspianinvest.az');

    const read = jest.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return 'User-Agent: *\nAllow: /\nCrawl-delay: 2';
      if (url.includes('/vakansiyalar/')) return listHtml;
      if (url.includes('/job-1/')) return detail1;
      if (url.includes('/job-2/')) return detail2;
      throw new Error(`Unexpected URL: ${url}`);
    });
    const pause = jest.fn(async () => {});
    const accepted: string[] = [];

    const collector = new BankerCollector(read, pause, () => at);
    const report = await collector.collect(
      {
        maxPages: 1,
        maxJobs: 5,
        delayMs: 1500,
        isKnown: (id) => id === 'banker:job-1',
      },
      async (job) => {
        accepted.push(job.externalId);
      },
    );

    expect(report).toMatchObject({
      source: 'banker',
      pages: 1,
      discovered: 2,
      known: 1,
      fetched: 1,
      accepted: 1,
      failed: 0,
    });
    expect(accepted).toEqual(['banker:job-2']);
    expect(pause.mock.calls.every(([ms]) => ms >= 2000)).toBe(true);
    expect(report.outcome).toBe('BOUNDED_PROGRESS');
    expect(report.cursor).toEqual({ kind: 'page', page: 2 });
  });

  it('resumes bounded pages with overlap, confirms known listings, and completes on a verified empty page', async () => {
    const page1 = sampleList([listCard('job-1', 'Filial müdiri', 'Example BOKT'), listCard('job-2', 'Risk analitiki', 'Example BOKT')]);
    const empty = '<html><head><title>Vakansiyalar | Banker.az</title></head><body><div class="sjb-page"></div></body></html>';
    const firstRead = jest.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return 'User-Agent: *\nAllow: /';
      if (url.includes('/vakansiyalar/')) return page1;
      if (url.includes('/job-2/')) return sampleDetail('job-2', 'Risk analitiki', 'Example BOKT', 'Bakı', 'hr@example.az');
      throw new Error(`Unexpected URL: ${url}`);
    });
    const listed: string[] = [];
    const first = await new BankerCollector(firstRead, async () => {}, () => at).collect({
      maxPages: 1, maxJobs: 1, delayMs: 1000, isKnown: (id) => id === 'banker:job-1', onListed: (id) => { listed.push(id); },
    }, async () => {});
    expect(first).toMatchObject({ outcome: 'BOUNDED_PROGRESS', complete: false, cursor: { kind: 'page', page: 2 } });
    expect(listed).toEqual(['banker:job-1', 'banker:job-2']);

    const secondRead = jest.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return 'User-Agent: *\nAllow: /';
      if (url.includes('paged=2')) return empty;
      if (url.includes('/vakansiyalar/')) return page1;
      if (url.includes('/job-2/')) return sampleDetail('job-2', 'Risk analitiki', 'Example BOKT', 'Bakı', 'hr@example.az');
      throw new Error(`Unexpected URL: ${url}`);
    });
    const accepted: string[] = [];
    const resumed = await new BankerCollector(secondRead, async () => {}, () => at).collect({
      maxPages: 3, maxJobs: 10, delayMs: 1000, resume: first.cursor!, isKnown: (id) => id === 'banker:job-1',
    }, async (job) => { accepted.push(job.externalId); });
    expect(resumed).toMatchObject({ outcome: 'COMPLETE_CENSUS', complete: true, cursor: null, known: 1, accepted: 1 });
    expect(accepted).toEqual(['banker:job-2']);
    expect(secondRead).toHaveBeenCalledWith(`${BANKER_ORIGIN}/vakansiyalar/?paged=2`);
  });

  it('labels transport failures as upstream failures and retries the same cursor next run', async () => {
    const listHtml = sampleList([listCard('retry-me', 'Mühasib', 'Example BOKT')]);
    const failing = jest.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return 'User-Agent: *\nAllow: /';
      if (url.includes('/vakansiyalar/')) return listHtml;
      throw new Error('Source HTTP 503');
    });
    const failed = await new BankerCollector(failing, async () => {}, () => at).collect({ maxPages: 2, maxJobs: 10, delayMs: 1000 }, async () => {});
    expect(failed).toMatchObject({ outcome: 'UPSTREAM_FAILURE', complete: false, cursor: { kind: 'page', page: 1 } });

    const retry = jest.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return 'User-Agent: *\nAllow: /';
      if (url.includes('paged=2')) return '<html><head><title>Vakansiyalar | Banker.az</title></head><body></body></html>';
      if (url.includes('/vakansiyalar/')) return listHtml;
      if (url.includes('/retry-me/')) return sampleDetail('retry-me', 'Mühasib', 'Example BOKT', 'Bakı', 'hr@example.az');
      throw new Error(`Unexpected URL: ${url}`);
    });
    const retried = await new BankerCollector(retry, async () => {}, () => at).collect({ maxPages: 2, maxJobs: 10, delayMs: 1000, resume: failed.cursor! }, async () => {});
    expect(retried).toMatchObject({ outcome: 'COMPLETE_CENSUS', complete: true, accepted: 1 });
  });

  it('is registered in COLLECTOR_KEYS and collectorFor', () => {
    expect(COLLECTOR_KEYS).toContain('banker');
    expect(collectorFor('banker')).toBeInstanceOf(BankerCollector);
  });
});
