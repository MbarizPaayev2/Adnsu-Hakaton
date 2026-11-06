import { parseAzDate, parseHellojobDetail, parseHellojobListing, sourceUrl, HELLOJOB_ORIGIN as O } from './hellojob.parser';
import { PublicJobCollector, fetchPublicHtml, postPublicJson, robotsAllows, robotsCrawlDelayMs } from './public-job-collector';
import { parseImportArgs } from '../../scripts/import-public-jobs';
import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';

// Synthetic fixtures, not copies of third-party descriptions or candidate data.
const url = (id: string) => `${O}/vakansiya/${id}`;
const listing = (ids: string[], page?: number) => `<h1>Vakansiyalar</h1>${ids.map((id) => `<a class="vacancies__body" href="${url(id)}">Job</a>`).join('')}${page ? `<a class="pagination__btn next" href="/vakansiyalar?page=${page}">Next</a>` : ''}`;
const detail = (deadline = '15 oktyabr 2026', posted = '01 oktyabr 2026') => `<div class="company__body"><div class="company__item vacancies__body">
  <h2 class="vacancies__subTitle">Backend mühəndisi</h2><a class="vacancies__category" href="/sirket/synthetic">Synthetic Labs</a>
  <ul class="company__item__details"><li><span>Şəhər</span><p>Gəncə</p></li><li><span>İş rejimi</span><p>Tam-ştat</p></li>
  <li><span>Maaş</span><p>Razılaşma ilə</p></li><li><span>Yerləşmə tarixi</span><p>${posted}</p></li>
  <li><span>Bitmə tarixi</span><p>${deadline}</p></li></ul></div><div class="company__text"><p>TypeScript tətbiqləri.</p>
  <ul><li>PostgreSQL bilikləri.</li></ul><script>bad()</script><p><a href="https://t.me/hellojobaz">Source promotion</a></p></div></div>
  <h2>Related jobs</h2><h1>FAQ</h1>`;
const now = new Date('2026-10-01T09:00:00Z');
const options = { maxPages: 5, maxJobs: 20, delayMs: 1000 };

describe('public vacancy parser', () => {
  const modernDetail = () => `<section class="vp" data-advert-root data-id="123"><div class="vp__head">
    <h1 class="vp__title">Backend mühəndisi</h1><div class="vp__company"><a href="/sirket/synthetic">Synthetic Labs</a></div>
    <ul class="vp__meta"><li><svg><circle cx="12" cy="10"/></svg>Gəncə</li><li><a>İT</a></li><li>1 oktyabr 2026</li><li>386 baxış</li></ul></div>
    <ul class="vp__facts"><li class="vp__fact"><span class="vp__fact-label">Bitmə tarixi</span><span class="vp__fact-value">15 oktyabr 2026</span><span>14 gün qalıb</span></li></ul>
    <article><div class="vp__text"><p>TypeScript tətbiqləri.<br>CV-ni jobs@synthetic.example ünvanına göndərin.</p></div>
    <div class="vp__source">Telegram promotion</div></article><aside><a href="/vakansiya/job-123/giris">Müraciət et</a><p>contact@hidden.example</p></aside></section>`;
  it('parses the redesigned public detail without sidebar contacts or promotions', () => {
    expect(parseHellojobDetail(modernDetail(), url('job-123'), now)).toMatchObject({
      title: 'Backend mühəndisi', company: 'Synthetic Labs', location: 'Gəncə',
      postedAt: '2026-09-30T20:00:00.000Z', deadline: '2026-10-15T19:59:59.000Z',
      description: 'TypeScript tətbiqləri.\nCV-ni jobs@synthetic.example ünvanına göndərin.',
    });
  });
  it('reads the current hero header and span-based publication metadata', () => {
    const html = modernDetail().replace('class="vp__head"', 'class="vp__hero-main"')
      .replace('<ul class="vp__meta">', '<p class="vp__meta">').replace('</ul></div>', '</p></div>')
      .replaceAll('<li>', '<span>').replaceAll('</li>', '</span>');
    expect(parseHellojobDetail(html, url('job-123'), now)).toMatchObject({
      title: 'Backend mühəndisi', company: 'Synthetic Labs', postedAt: '2026-09-30T20:00:00.000Z',
      deadline: '2026-10-15T19:59:59.000Z',
    });
  });
  it('rejects a redesigned page for another vacancy or without its publication date', () => {
    expect(() => parseHellojobDetail(modernDetail(), url('job-456'), now)).toThrow('identity');
    expect(() => parseHellojobDetail(modernDetail().replace('1 oktyabr 2026', 'unknown'), url('job-123'), now)).toThrow();
  });
  it('uses an exact canonical identity when a legacy slug suffix is not the advert ID', () => {
    const html = `<link rel="canonical" href="${url('data-analyst-8756')}">` + modernDetail();
    expect(parseHellojobDetail(html, url('data-analyst-8756'), now).title).toBe('Backend mühəndisi');
    expect(() => parseHellojobDetail(html, url('another-123'), now)).toThrow('identity');
    expect(() => parseHellojobDetail(html.replace(url('data-analyst-8756'), 'https://evil.example/vakansiya/job'), url('data-analyst-8756'), now)).toThrow('identity');
  });

  it('extracts a single job, real dates, company and location without FAQ, HTML or promotion', () => {
    expect(parseHellojobDetail(detail(), url('backend-1'), now)).toMatchObject({
      externalId: 'hellojob:backend-1', title: 'Backend mühəndisi', company: 'Synthetic Labs', location: 'Gəncə',
      postedAt: '2026-09-30T20:00:00.000Z', deadline: '2026-10-15T19:59:59.000Z',
      description: 'TypeScript tətbiqləri.\nPostgreSQL bilikləri.', rawPayload: { source: 'hellojob', salary: 'Razılaşma ilə' },
    });
  });
  it.each(['31 fevral 2026', '01 unknown 2026', '32 oktyabr 2026', '2026-10-01'])('does not invent a date for %s', (s) => {
    expect(parseAzDate(s)).toBeUndefined();
    expect(() => parseHellojobDetail(detail(s), url('job'), now)).toThrow();
  });
  it('does not substitute an employment type for a missing city', () => {
    const html = detail().replace('<li><span>Şəhər</span><p>Gəncə</p></li>', '');
    expect(parseHellojobDetail(html, url('job'), now).location).toBe('Azerbaijan');
  });
  it('deduplicates promoted cards but continues through the real next link', () => {
    expect(parseHellojobListing(listing(['one', 'one', 'two'], 2), `${O}/vakansiyalar`)).toEqual({ urls: [url('one'), url('two')], next: `${O}/vakansiyalar?page=2` });
  });
  it('reads the current heading and ignores rotating talent-pool promotions without treating them as vacancies', () => {
    const promos = ['proqramcilar', 'satis-mutexessisleri', 'marketoloqlar', 'dizaynerler']
      .map(slug => `<div class="vacancies__item vfp"><a class="vacancies__body" href="${O}/${slug}#apply">Talent pool</a></div>`).join('');
    const html = listing(['one', 'two'], 2).replace('Vakansiyalar</h1>', 'İş elanları 2026</h1>') + promos;
    expect(parseHellojobListing(html, `${O}/vakansiyalar`)).toEqual({ urls: [url('one'), url('two')], next: `${O}/vakansiyalar?page=2` });
  });
  it('does not silently discard foreign or unrecognized vacancy cards, even when styled as promotions', () => {
    for (const href of ['https://evil.example/designer#apply', `${O}/cv/person`, `${O}/proqramcilar#apply`]) {
      const html = listing(['one']) + `<a class="vacancies__body" href="${href}">Unexpected</a>`;
      expect(() => parseHellojobListing(html, `${O}/vakansiyalar`)).toThrow('Unsupported');
    }
    expect(() => parseHellojobListing(listing(['one']), url('detail'))).toThrow('Unrecognized listing');
  });
  it('recognizes paginated headings only for the requested page, so discovery continues past page one', () => {
    const html = listing(['two'], 3).replace('Vakansiyalar</h1>', 'Vakansiyalar — səhifə 2</h1>');
    expect(parseHellojobListing(html, `${O}/vakansiyalar?page=2`)).toEqual({urls:[url('two')],next:`${O}/vakansiyalar?page=3`});
    expect(() => parseHellojobListing(html, `${O}/vakansiyalar?page=3`)).toThrow('Unrecognized listing');
  });
  it.each(['<h1>Attention required</h1>', '<h1>Vakansiyalar</h1>'])('does not call an unknown/empty page complete', (html) => {
    expect(() => parseHellojobListing(html, `${O}/vakansiyalar`)).toThrow();
  });
  it.each(['https://evil.example/vakansiya/job', 'http://127.0.0.1/vakansiya/job', '/cv/person', '/vakansiya/../cv/person', '/vakansiya/%2e%2e%2fcv', '/vakansiya/x%5ccv', 'https://user:pass@www.hellojob.az/vakansiya/job'])('rejects unsafe URL %s', (u) => expect(() => sourceUrl(u)).toThrow());
});

describe('robots rules', () => {
  it('honors a blanket restriction', () => expect(robotsAllows('User-agent: *\nDisallow: /', '/vakansiyalar')).toBe(false));
  it('honors more specific allow paths and query patterns', () => {
    const rules = 'User-agent: *\nDisallow: /\nAllow: /vakansiya/\nDisallow: /*?page=*';
    expect(robotsAllows(rules, '/vakansiya/job')).toBe(true);
    expect(robotsAllows(rules, '/vakansiyalar?page=2')).toBe(false);
  });
  it('honors collector-specific restrictions over wildcard allow', () => {
    expect(robotsAllows('User-agent: *\nAllow: /\nUser-agent: AISEVacancyCollector\nDisallow: /', '/vakansiyalar')).toBe(false);
  });
  it('refuses HTML and directives that cannot be honored', () => {
    expect(() => robotsAllows('<html>Challenge</html>', '/')).toThrow();
    expect(() => robotsAllows('User-agent: *\nCrawl-delay: 90', '/')).toThrow();
  });
  it('crawl-delay is only readable by a collector that declares it enforces it; the allow/disallow decision is unchanged', () => {
    const robots = 'User-agent: *\nCrawl-delay: 30\nDisallow: /unsu';
    expect(() => robotsAllows(robots, '/vacancies')).toThrow('crawl-delay');
    expect(robotsAllows(robots, '/vacancies', { crawlDelayHonored: true })).toBe(true);
    expect(robotsAllows(robots, '/unsubscribe', { crawlDelayHonored: true })).toBe(false);
  });
  it('reports the crawl-delay that applies to our own agent, not one addressed to other crawlers', () => {
    expect(robotsCrawlDelayMs('User-agent: *\nCrawl-delay: 30\nDisallow: /x')).toBe(30_000);
    expect(robotsCrawlDelayMs('User-agent: *\nDisallow: /x\n\nUser-agent: GPTBot\nCrawl-delay: 5\nUser-agent: ClaudeBot\nCrawl-delay: 5')).toBeNull();
    expect(robotsCrawlDelayMs('User-agent: *\nCrawl-delay: 2\n\nUser-agent: AISEVacancyCollector\nCrawl-delay: 20')).toBe(20_000);
    expect(robotsCrawlDelayMs('User-agent: *\nAllow: /')).toBeNull();
  });
  it('does not apply another crawler\'s delay to us, while enforcing a matching collector delay', () => {
    const robots = 'User-agent: *\nAllow: /\nDisallow: /private\nUser-agent: Bytespider\nCrawl-delay: 10';
    expect(robotsAllows(robots, '/vacancies')).toBe(true);
    expect(robotsAllows(robots, '/private')).toBe(false);
    expect(robotsCrawlDelayMs(robots)).toBeNull();
    const own = robots + '\nUser-agent: AISEVacancyCollector\nCrawl-delay: 20\nDisallow: /private';
    expect(() => robotsAllows(own, '/vacancies')).toThrow('crawl-delay');
    expect(robotsAllows(own, '/private', {crawlDelayHonored: true})).toBe(false);
    expect(robotsCrawlDelayMs(own)).toBe(20000);
  });
  it('refuses an unreadable crawl-delay', () => {
    expect(() => robotsCrawlDelayMs('User-agent: *\nCrawl-delay: soon')).toThrow();
    expect(() => robotsCrawlDelayMs('User-agent: *\nCrawl-delay: 99999')).toThrow();
  });
  it('accepts recognized non-access directives such as sitemap and host without weakening rules', () => {
    const robots = 'User-agent: *\nAllow: /\nDisallow: /api/\nHost: https://smartjob.az\nSitemap: https://smartjob.az/sitemap.xml';
    expect(robotsAllows(robots, '/vakansiyalar')).toBe(true);
    expect(robotsAllows(robots, '/api/private')).toBe(false);
  });
  it('accepts content-signal directive with search=yes and rejects when search=no', () => {
    const allowed = 'User-agent: *\nContent-Signal: search=yes, ai-input=yes, ai-train=no\nDisallow: ';
    expect(robotsAllows(allowed, '/pasha-holding/jobs.md')).toBe(true);
    const prohibited = 'User-agent: *\nContent-Signal: search=no\nDisallow: ';
    expect(() => robotsAllows(prohibited, '/jobs')).toThrow(/content-signal explicitly disallows/);
  });
});

describe('collection lifecycle', () => {
  const setup = (pages: Record<string, string>) => {
    const read = jest.fn(async (u: string) => {
      if (u === `${O}/robots.txt`) return 'User-agent: *\nAllow: /';
      if (!(u in pages)) throw new Error('Source HTTP 403');
      return pages[u];
    });
    const accept = jest.fn(async (_job: IngestJobDto) => {});
    const collector = new PublicJobCollector(read, async () => {}, () => now);
    return { collector, read, accept };
  };
  it('walks multiple pages without stopping at known/promoted jobs', async () => {
    const { collector, accept } = setup({ [`${O}/vakansiyalar`]: listing(['one'], 2), [`${O}/vakansiyalar?page=2`]: listing(['one', 'two']), [url('one')]: detail(), [url('two')]: detail() });
    expect(await collector.collect(options, accept)).toMatchObject({ complete: true, pages: 2, discovered: 2, fetched: 2, accepted: 2 });
    expect(accept).toHaveBeenCalledTimes(2);
  });
  it('reports a cap as incomplete, not a complete national inventory', async () => {
    const { collector, accept } = setup({ [`${O}/vakansiyalar`]: listing(['one', 'two']), [url('one')]: detail() });
    expect(await collector.collect({ ...options, maxJobs: 1 }, accept)).toMatchObject({ complete: false, discovered: 2, accepted: 1 });
  });
  it('stops at a source restriction without retries or visiting later jobs', async () => {
    const { collector, read, accept } = setup({ [`${O}/vakansiyalar`]: listing(['blocked', 'later']), [url('later')]: detail() });
    expect(await collector.collect(options, accept)).toMatchObject({ complete: false, error: 'Source HTTP 403' });
    expect(read).not.toHaveBeenCalledWith(url('later')); expect(accept).not.toHaveBeenCalled();
  });
  it('retains expired deadlines for refresh; the existing ingestion path excludes them from matching', async () => {
    const { collector, accept } = setup({ [`${O}/vakansiyalar`]: listing(['expired']), [url('expired')]: detail('30 sentyabr 2026', '15 sentyabr 2026') });
    expect(await collector.collect(options, accept)).toMatchObject({ complete: true, expired: 1, accepted: 1 });
    expect(new Date(accept.mock.calls[0][0].deadline!).getTime()).toBeLessThan(now.getTime());
  });
  it('never stores an impossible publication date: a demonstrably open posting is kept with its first-seen day and says so', async () => {
    for (const html of [detail('15 oktyabr 2026', '29 noyabr 2026'), detail('15 oktyabr 2026', '20 oktyabr 2026')]) {
      const { collector, accept } = setup({ [`${O}/vakansiyalar`]: listing(['odd']), [url('odd')]: html });
      expect(await collector.collect(options, accept)).toMatchObject({ failed: 0, accepted: 1 });
      const job = accept.mock.calls[0][0] as unknown as IngestJobDto;
      expect(job.postedAt).toBe(now.toISOString());
      expect(job.rawPayload).toMatchObject({ postedAtEvidence: expect.stringContaining('first-seen') });
    }
    const normal = setup({ [`${O}/vakansiyalar`]: listing(['fine']), [url('fine')]: detail() });
    await normal.collector.collect(options, normal.accept);
    expect((normal.accept.mock.calls[0][0] as unknown as IngestJobDto).rawPayload).not.toHaveProperty('postedAtEvidence');
  });
  it('rejects an impossible publication date when the posting is not demonstrably open (no deadline in the future)', async () => {
    for (const html of [detail('30 sentyabr 2026', '29 noyabr 2026'), detail('01 oktyabr 2026', '05 oktyabr 2026').replace('<li><span>Bitmə tarixi</span><p>01 oktyabr 2026</p></li>', '')]) {
      const { collector, accept } = setup({ [`${O}/vakansiyalar`]: listing(['odd']), [url('odd')]: html });
      expect(await collector.collect(options, accept)).toMatchObject({ complete: false, failed: 1, accepted: 0 });
      expect(accept).not.toHaveBeenCalled();
    }
  });
  it('does not request the detail page of a posting that is already stored, and never calls such a run complete', async () => {
    const { collector, read, accept } = setup({ [`${O}/vakansiyalar`]: listing(['kept', 'new']), [url('new')]: detail() });
    const report = await collector.collect({ ...options, isKnown: (id) => id === 'hellojob:kept' }, accept);
    expect(report).toMatchObject({ known: 1, accepted: 1, complete: false });
    expect(read).not.toHaveBeenCalledWith(url('kept'));
  });
  it('names an undisclosed employer as such instead of a generic parse failure', () => {
    const html = detail().replace('<a class="vacancies__category" href="/sirket/synthetic">Synthetic Labs</a>', '');
    expect(() => parseHellojobDetail(html, url('anon'), now)).toThrow('Employer not disclosed');
  });
  it('refuses loops and does not infer closures from source failure', async () => {
    const { collector, accept } = setup({ [`${O}/vakansiyalar`]: listing(['one'], 1), [`${O}/vakansiyalar?page=1`]: listing(['one'], 1), [url('one')]: detail() });
    expect(await collector.collect(options, accept)).toMatchObject({ complete: false }); expect(accept).toHaveBeenCalledTimes(1);
  });
  it('reports invalid details instead of saving blank jobs', async () => {
    const { collector, accept } = setup({ [`${O}/vakansiyalar`]: listing(['broken']), [url('broken')]: '<h1>Oops</h1>' });
    const onFailedDetail = jest.fn();
    expect(await collector.collect({ ...options, onFailedDetail }, accept)).toMatchObject({ complete: false, failed: 1 }); expect(accept).not.toHaveBeenCalled();
    expect(onFailedDetail).toHaveBeenCalledWith('hellojob:broken', 'Incomplete or invalid vacancy detail');
  });
  it('never requests or imports talent-pool campaign forms in the current listing', async () => {
    const html = listing(['one']).replace('Vakansiyalar</h1>', 'İş elanları 2026</h1>') +
      `<div class="vfp"><a class="vacancies__body" href="${O}/marketoloqlar#apply">Campaign</a></div>`;
    const { collector, read, accept } = setup({ [`${O}/vakansiyalar`]: html, [url('one')]: detail() });
    expect(await collector.collect(options, accept)).toMatchObject({ complete: true, discovered: 1, accepted: 1, failed: 0 });
    expect(read).not.toHaveBeenCalledWith(expect.stringContaining('marketoloqlar'));
  });
  it('stops if the destination fails', async () => {
    const { collector } = setup({ [`${O}/vakansiyalar`]: listing(['one', 'two']), [url('one')]: detail() });
    expect(await collector.collect(options, async () => { throw new Error('Import API HTTP 401'); })).toMatchObject({ complete: false, accepted: 0, error: 'Import API HTTP 401' });
  });
});

describe('bounded network access', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([403, 429, 503])('stops on HTTP %s without retries', async (status) => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status }));
    await expect(fetchPublicHtml(`${O}/vakansiyalar`)).rejects.toThrow(`HTTP ${status}`); expect(request).toHaveBeenCalledTimes(1);
  });
  it('refuses redirects outside the source', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
    await expect(fetchPublicHtml(`${O}/vakansiyalar`)).rejects.toThrow('Unsupported');
  });

  it('postPublicJson rejects oversized payloads exceeding maxBytes', async () => {
    const largeData = 'x'.repeat(1024);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(largeData));
        controller.enqueue(new TextEncoder().encode(largeData));
        controller.close();
      },
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(
      postPublicJson('https://api.work.az/v1/test', {}, (u) => u, {}, 1024),
    ).rejects.toThrow('Source response too large');
  });

  it('postPublicJson rejects malformed JSON', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{ not valid json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(
      postPublicJson('https://api.work.az/v1/test', {}, (u) => u),
    ).rejects.toThrow('Malformed JSON from source');
  });
});

describe('operator options', () => {
  it('defaults to preview, bounded pacing and no writes', () => expect(parseImportArgs([])).toMatchObject({ apply: false, source: 'hellojob', delayMs: 1500 }));
  it.each([['--source', 'unsupported-source'], ['--max-pages', '0'], ['--delay-ms', '0'], ['--max-jobs', 'NaN'], ['--apply', '--apply'], ['--max-pages'], ['--unknown']])('rejects invalid options %j', (...args) => expect(() => parseImportArgs(args)).toThrow());
});

describe('Hellojob resumable discovery (cursor)', () => {
  const pages = (): Record<string, string> => ({
    [`${O}/vakansiyalar`]: listing(['a', 'b'], 2), [`${O}/vakansiyalar?page=2`]: listing(['c', 'd'], 3), [`${O}/vakansiyalar?page=3`]: listing(['e', 'f']),
    ...Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [url(id), detail()])),
  });
  const run = (extra: Record<string, unknown> = {}, map = pages()) => {
    const read = jest.fn(async (u: string) => { if (u === `${O}/robots.txt`) return 'User-agent: *\nAllow: /'; if (!(u in map)) throw new Error('Source HTTP 403'); return map[u]; });
    const accepted: string[] = [];
    const collector = new PublicJobCollector(read, async () => {}, () => now);
    return { read, accepted, go: () => collector.collect({ ...options, ...extra } as never, async (j) => { accepted.push(j.externalId); }) };
  };

  it('a page-bounded run reports where it stopped; the next run continues one page earlier and reaches the end, never claiming completeness', async () => {
    const first = run({ maxPages: 2 });
    const r1 = await first.go();
    expect(r1.cursor).toEqual({ kind: 'url', url: `${O}/vakansiyalar?page=3`, prev: `${O}/vakansiyalar?page=2` });
    expect(first.accepted).toEqual(['hellojob:a', 'hellojob:b', 'hellojob:c', 'hellojob:d']);
    const second = run({ resume: r1.cursor, isKnown: (id: string) => ['hellojob:c', 'hellojob:d', 'hellojob:a', 'hellojob:b'].includes(id) });
    const r2 = await second.go();
    expect(second.read).not.toHaveBeenCalledWith(`${O}/vakansiyalar`); // the head pages are not read again
    expect(second.read).toHaveBeenCalledWith(`${O}/vakansiyalar?page=2`); // the overlap page is
    expect(second.accepted).toEqual(['hellojob:e', 'hellojob:f']); // known postings are not fetched again
    expect(r2.cursor).toBeNull(); // reached the end of the listing
    expect(r2.complete).toBe(false); // but a resumed run never calls the listing complete
  });

  it('when the fetch budget ends inside a page the cursor stays on that page, so nothing on it is skipped', async () => {
    const first = run({ maxJobs: 3 });
    const r1 = await first.go();
    expect(first.accepted).toEqual(['hellojob:a', 'hellojob:b', 'hellojob:c']);
    expect(r1.cursor).toEqual({ kind: 'url', url: `${O}/vakansiyalar?page=2`, prev: `${O}/vakansiyalar` });
    const second = run({ resume: r1.cursor, isKnown: (id: string) => ['hellojob:a', 'hellojob:b', 'hellojob:c'].includes(id) });
    await second.go();
    expect(second.accepted).toEqual(['hellojob:d', 'hellojob:e', 'hellojob:f']);
  });

  it('a run that walks the whole listing from its start reports no cursor and can still be complete', async () => {
    const r = await run().go();
    expect(r).toMatchObject({ complete: true, cursor: null });
  });
});
