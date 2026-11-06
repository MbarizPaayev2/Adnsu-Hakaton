import {
  SMARTJOB_ORIGIN,
  parseIsoDate,
  parseSmartjobDetail,
  parseSmartjobListing,
  smartjobUrl,
} from './smartjob.parser';
import { SmartjobCollector } from './smartjob.collector';
import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';

const now = new Date('2026-10-02T12:00:00.000Z');
const url = (slug: string) => `${SMARTJOB_ORIGIN}/vakansiyalar/${slug}`;

const mockDetailHtml = (options: {
  id?: string;
  title?: string;
  company?: string;
  location?: string;
  country?: string;
  datePosted?: string;
  validThrough?: string;
  description?: string;
} = {}) => {
  const id = options.id || '123456';
  const title = options.title || 'Backend proqramçı';
  const company = options.company || 'Tech MMC';
  const location = options.location || 'Bakı';
  const country = options.country !== undefined ? options.country : 'AZ';
  const datePosted = options.datePosted !== undefined ? options.datePosted : '2026-10-01T10:00:00.000Z';
  const validThrough = options.validThrough;
  const description = options.description || '<p>Node.js və TypeScript üzrə biliklər tələb olunur.</p><ul><li>PostgreSQL</li></ul>';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title} - ${company}</title>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "JobPosting",
          "title": "${title}",
          "description": "${description}",
          ${datePosted ? `"datePosted": "${datePosted}",` : ''}
          ${validThrough ? `"validThrough": "${validThrough}",` : ''}
          "employmentType": "FULL_TIME",
          "hiringOrganization": {
            "@type": "Organization",
            "name": "${company}"
          },
          "identifier": {
            "@type": "PropertyValue",
            "name": "SmartJob.az",
            "value": "${id}"
          },
          "jobLocation": {
            "@type": "Place",
            "address": {
              "@type": "PostalAddress",
              "addressLocality": "${location}"
              ${country ? `,"addressCountry": "${country}"` : ''}
            }
          }
        }
        </script>
      </head>
      <body>
        <h1>${title}</h1>
        <div class="company-title">${company}</div>
        <div class="job-body">${description}</div>
      </body>
    </html>
  `;
};

const mockListingHtml = (slugs: string[]) => `
  <div class="jobs-listing">
    ${slugs.map((s) => `<a href="/vakansiyalar/${s}">Vakansiya</a>`).join('')}
  </div>
`;

const mockSitemapIndexXml = (shards: string[]) => `
  <?xml version="1.0" encoding="UTF-8"?>
  <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${shards.map((s) => `<sitemap><loc>${s}</loc></sitemap>`).join('')}
  </sitemapindex>
`;

const mockSitemapXml = (slugs: string[]) => `
  <?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${slugs.map((s) => `<url><loc>${SMARTJOB_ORIGIN}/vakansiyalar/${s}</loc></url>`).join('')}
  </urlset>
`;

describe('smartjob parser', () => {
  it('extracts job facts from valid JobPosting JSON-LD', () => {
    const html = mockDetailHtml({
      id: '998877',
      title: 'Senior Mühəndis',
      company: 'AzeriTech',
      location: 'Gəncə',
      datePosted: '2026-10-01T08:00:00.000Z',
      validThrough: '2026-11-01T20:00:00.000Z',
    });
    const parsed = parseSmartjobDetail(html, url('senior-muhendis-998877'), now);
    expect(parsed).toMatchObject({
      externalId: 'smartjob:998877',
      title: 'Senior Mühəndis',
      company: 'AzeriTech',
      location: 'Gəncə',
      postedAt: '2026-10-01T08:00:00.000Z',
      deadline: '2026-11-01T20:00:00.000Z',
      url: `${SMARTJOB_ORIGIN}/vakansiyalar/senior-muhendis-998877`,
    });
    expect(parsed.description).toContain('Node.js və TypeScript');
  });

  it('rejects missing datePosted evidence (never substitutes collection time)', () => {
    const noDateHtml = mockDetailHtml({ datePosted: '' });
    expect(() => parseSmartjobDetail(noDateHtml, url('job-no-date'), now)).toThrow('Missing datePosted evidence');
  });

  it('rejects impossible calendar date (2026-02-30 must not become March 2)', () => {
    const impossibleDateHtml = mockDetailHtml({ datePosted: '2026-02-30T10:00:00Z' });
    expect(() => parseSmartjobDetail(impossibleDateHtml, url('job-rollover'), now)).toThrow('Malformed or invalid datePosted');
  });

  it('rejects malformed supplied deadline rather than silently discarding it', () => {
    const badDeadlineHtml = mockDetailHtml({ validThrough: '2026-02-30T10:00:00Z' });
    expect(() => parseSmartjobDetail(badDeadlineHtml, url('job-bad-deadline'), now)).toThrow('Malformed or invalid deadline');
  });

  it('rejects explicitly foreign-only vacancies', () => {
    const foreignHtml = mockDetailHtml({ country: 'TR', location: 'Istanbul' });
    expect(() => parseSmartjobDetail(foreignHtml, url('job-tr'), now)).toThrow('Foreign vacancy rejected: country TR');

    const foreignCityHtml = mockDetailHtml({ country: '', location: 'Istanbul' });
    expect(() => parseSmartjobDetail(foreignCityHtml, url('job-istanbul'), now)).toThrow('Foreign vacancy rejected: locality Istanbul');
  });

  it('rejects unsupported or malicious URLs', () => {
    expect(() => smartjobUrl('https://evil.org/vakansiyalar/test')).toThrow();
    expect(() => smartjobUrl('http://smartjob.az/vakansiyalar/test')).toThrow();
    expect(() => smartjobUrl(`${SMARTJOB_ORIGIN}/api/secret`)).toThrow();
    expect(() => smartjobUrl(`${SMARTJOB_ORIGIN}/vakansiyalar/../admin`)).toThrow();
    expect(() => smartjobUrl(`${SMARTJOB_ORIGIN}/vakansiyalar/%2e%2e%2fadmin`)).toThrow();
    expect(() => smartjobUrl(`https://user:pass@smartjob.az/vakansiyalar/job`)).toThrow();
  });

  it('parses sitemap index and extracts job shards', () => {
    const indexXml = mockSitemapIndexXml([
      `${SMARTJOB_ORIGIN}/sitemaps/jobs/1`,
      `${SMARTJOB_ORIGIN}/sitemaps/jobs/2`,
    ]);
    const listing = parseSmartjobListing(indexXml, `${SMARTJOB_ORIGIN}/sitemap.xml`);
    expect(listing.shards).toEqual([
      `${SMARTJOB_ORIGIN}/sitemaps/jobs/1`,
      `${SMARTJOB_ORIGIN}/sitemaps/jobs/2`,
    ]);
  });
});

describe('smartjob collector lifecycle and coverage honesty', () => {
  const robotsTxt = `User-Agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Host: https://smartjob.az
Sitemap: https://smartjob.az/sitemap.xml`;

  it('reports failed detail identities so a small content error cannot cause source-wide backoff', async () => {
    const onFailedDetail = jest.fn();
    const read = jest.fn(async (target: string) => {
      if (target.endsWith('/robots.txt')) return robotsTxt;
      if (target.endsWith('/vakansiyalar')) return mockListingHtml(['broken-1']);
      return '<h1>Changed detail</h1>';
    });
    const collector = new SmartjobCollector(read, async () => {}, () => now);
    const report = await collector.collect({maxPages: 1, maxJobs: 1, delayMs: 1000, onFailedDetail}, async () => {});
    expect(report).toMatchObject({complete: false, failed: 1, accepted: 0});
    expect(onFailedDetail).toHaveBeenCalledWith('smartjob:1', expect.any(String));
  });

  it('collects vacancies across listing and sitemap index while honestly reporting complete=false', async () => {
    const accepted: IngestJobDto[] = [];
    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      if (targetUrl.endsWith('/vakansiyalar')) return mockListingHtml(['job-1', 'job-2']);
      if (targetUrl.endsWith('/sitemap.xml')) {
        return mockSitemapIndexXml([`${SMARTJOB_ORIGIN}/sitemaps/jobs/1`]);
      }
      if (targetUrl.endsWith('/sitemaps/jobs/1')) return mockSitemapXml(['job-1', 'job-2', 'job-3']);
      if (targetUrl.includes('/vakansiyalar/job-1')) return mockDetailHtml({ id: '1', title: 'Job 1' });
      if (targetUrl.includes('/vakansiyalar/job-2')) return mockDetailHtml({ id: '2', title: 'Job 2' });
      if (targetUrl.includes('/vakansiyalar/job-3')) return mockDetailHtml({ id: '3', title: 'Job 3' });
      throw new Error(`Unexpected URL ${targetUrl}`);
    });

    const collector = new SmartjobCollector(read, async () => {}, () => now);
    const report = await collector.collect({ maxPages: 3, maxJobs: 10, delayMs: 1000 }, async (job) => {
      accepted.push(job);
    });

    // Coverage honesty: sitemaps are not verified complete active censuses; complete must stay false
    expect(report.complete).toBe(false);
    expect(report.error).toContain('Smartjob collection is bounded; complete active census not proven');
    expect(report.accepted).toBe(3);
    expect(accepted.map((j) => j.externalId)).toEqual(['smartjob:1', 'smartjob:2', 'smartjob:3']);
  });

  it('marks capped run as incomplete', async () => {
    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      if (targetUrl.endsWith('/vakansiyalar')) return mockListingHtml(['job-1', 'job-2', 'job-3']);
      if (targetUrl.includes('/vakansiyalar/job-1')) return mockDetailHtml({ id: '1' });
      throw new Error(`Unexpected URL ${targetUrl}`);
    });

    const collector = new SmartjobCollector(read, async () => {}, () => now);
    const report = await collector.collect({ maxPages: 1, maxJobs: 1, delayMs: 1000 }, async () => {});

    expect(report.complete).toBe(false);
    expect(report.fetched).toBe(1);
  });

  it('skips detail fetch for known postings and invokes onListed', async () => {
    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      if (targetUrl.endsWith('/vakansiyalar')) return mockListingHtml(['job-1', 'job-2']);
      if (targetUrl.includes('/vakansiyalar/job-2')) return mockDetailHtml({ id: '2', title: 'Job 2' });
      throw new Error(`Unexpected URL ${targetUrl}`);
    });

    const listed: string[] = [];
    const collector = new SmartjobCollector(read, async () => {}, () => now);
    const report = await collector.collect(
      {
        maxPages: 1,
        maxJobs: 10,
        delayMs: 1000,
        isKnown: (id) => id === 'smartjob:1',
        onListed: (id) => { listed.push(id); },
      },
      async () => {},
    );

    expect(report.known).toBe(1);
    expect(report.fetched).toBe(1);
    expect(listed).toEqual(['smartjob:1']);
    expect(read).not.toHaveBeenCalledWith(expect.stringContaining('/vakansiyalar/job-1'));
  });

  it('sitemap presence is discovery evidence only and does not invoke onListed for known postings', async () => {
    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>${SMARTJOB_ORIGIN}/vakansiyalar/job-known-1</loc></url>
        <url><loc>${SMARTJOB_ORIGIN}/vakansiyalar/job-new-2</loc></url>
      </urlset>`;

    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      if (targetUrl.endsWith('/vakansiyalar')) {
        // Redirects to sitemap
        return mockSitemapIndexXml(['https://smartjob.az/sitemaps/jobs/1']);
      }
      if (targetUrl.includes('/sitemaps/jobs/1')) {
        return sitemapXml;
      }
      if (targetUrl.includes('/vakansiyalar/job-new-2')) {
        return mockDetailHtml({ id: '2', title: 'New Job 2' });
      }
      throw new Error(`Unexpected URL ${targetUrl}`);
    });

    const listed: string[] = [];
    const collector = new SmartjobCollector(read, async () => {}, () => now);
    const report = await collector.collect(
      {
        maxPages: 3,
        maxJobs: 10,
        delayMs: 1000,
        isKnown: (id) => id === 'smartjob:1',
        onListed: (id) => { listed.push(id); },
      },
      async () => {},
    );

    expect(report.known).toBe(1);
    expect(report.accepted).toBe(1);
    // onListed MUST NOT be called because sitemaps are discovery-only
    expect(listed).toHaveLength(0);
  });
});

describe('Smartjob date-only deadline (Baku end of day)', () => {
  it('is open through the end of its stated last day in Baku, not until UTC midnight', () => {
    const job = parseSmartjobDetail(mockDetailHtml({ validThrough: '2026-10-04' }), url('last-day-job'), now);
    expect(job.deadline).toBe('2026-10-04T19:59:59.999Z');
  });
  it('keeps an explicit zone as stated', () => {
    expect(parseSmartjobDetail(mockDetailHtml({ validThrough: '2026-10-04T12:00:00Z' }), url('zoned-job'), now).deadline).toBe('2026-10-04T12:00:00.000Z');
  });
});

describe('Smartjob resumable discovery (cursor)', () => {
  const robotsTxt = 'User-Agent: *\nAllow: /';
  const run = (extra: Record<string, unknown> = {}) => {
    const asked: string[] = [];
    const read = jest.fn(async (target: string) => {
      asked.push(target);
      if (target.endsWith('/robots.txt')) return robotsTxt;
      if (target.endsWith('/vakansiyalar')) return mockListingHtml(['job-1', 'job-2']);
      if (target.endsWith('/sitemaps/jobs/1')) return mockSitemapXml(['job-3', 'job-4']);
      if (target.endsWith('/sitemaps/jobs/2')) return mockSitemapXml(['job-5']);
      const id = /job-(\d)/.exec(target)?.[1];
      if (id) return mockDetailHtml({ id, title: `Job ${id}` });
      throw new Error(`Unexpected URL ${target}`);
    });
    const collector = new SmartjobCollector(read, async () => {}, () => now);
    return { asked, go: () => collector.collect({ maxPages: 9, maxJobs: 50, delayMs: 1000, ...extra } as never, async () => {}) };
  };

  it('a bounded run keeps the pending shards as its cursor and the resumed run starts with them; it never claims a complete census', async () => {
    const a = run({ maxPages: 1 });
    const r1 = await a.go();
    expect(r1.cursor).toEqual({ kind: 'queue', pending: expect.any(Array) });
    expect(r1.complete).toBe(false);
    const b = run({ resume: { kind: 'queue', pending: [`${SMARTJOB_ORIGIN}/sitemaps/jobs/1`, `${SMARTJOB_ORIGIN}/sitemaps/jobs/2`] } });
    const r2 = await b.go();
    expect(b.asked).not.toContain(`${SMARTJOB_ORIGIN}/vakansiyalar`); // the head listing is not read again
    expect(r2.accepted).toBe(3);
    expect(r2.cursor).toBeNull();
    expect(r2.complete).toBe(false);
  });

  it('when the fetch budget ends inside a page, that page goes back to the front of the queue', async () => {
    const r = await run({ maxJobs: 1 }).go();
    expect((r.cursor as { pending: string[] }).pending[0]).toBe(`${SMARTJOB_ORIGIN}/vakansiyalar`);
  });
});
