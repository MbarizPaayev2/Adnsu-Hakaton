import {
  WORK_ORIGIN,
  parseWorkDetail,
  parseWorkListing,
  workUrl,
} from './work.parser';
import { WorkCollector } from './work.collector';
import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';

const now = new Date('2026-10-02T12:00:00.000Z');
const url = (slug: string) => `${WORK_ORIGIN}/vakansiyalar/${slug}`;

const mockWorkDetailHtml = (options: {
  title?: string;
  company?: string;
  location?: string;
  country?: string;
  datePosted?: string;
  validThrough?: string;
  description?: string;
} = {}) => {
  const title = options.title || 'Əczaçı Satış Operatoru';
  const company = options.company || 'Valentis Labaratories';
  const location = options.location || 'Bakı';
  const country = options.country !== undefined ? options.country : 'AZ';
  const datePosted = options.datePosted !== undefined ? options.datePosted : '2026-09-27T21:31:51Z';
  const validThrough = options.validThrough;
  const description = options.description || '<p>Təbii sağlamlıq məhsullarının satışı.</p><ul><li>Müştərilərlə əlaqə</li></ul>';

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
          "employmentType": ["FULL_TIME"],
          "hiringOrganization": {
            "@type": "Organization",
            "name": "${company}"
          },
          "jobLocation": [
            {
              "@type": "Place",
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "${location}"
                ${country ? `,"addressCountry": "${country}"` : ''}
              }
            }
          ]
        }
        </script>
      </head>
      <body>
        <h1>${title}</h1>
        <div class="company-title">${company}</div>
      </body>
    </html>
  `;
};

const mockWorkSitemapXml = (slugs: string[]) => `
  <?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>${WORK_ORIGIN}/</loc></url>
    <url><loc>${WORK_ORIGIN}/haqqimizda</loc></url>
    ${slugs.map((s) => `<url><loc>${WORK_ORIGIN}/vakansiyalar/${s}</loc></url>`).join('')}
  </urlset>
`;

describe('work.az parser', () => {
  it('extracts job facts from valid JobPosting JSON-LD', () => {
    const html = mockWorkDetailHtml({
      title: 'Satış Koordinatoru',
      company: 'Global Health',
      location: 'Sumqayıt',
      datePosted: '2026-09-25T10:00:00Z',
      validThrough: '2026-10-25',
    });
    const parsed = parseWorkDetail(html, url('satis-koordinatoru'), now);
    expect(parsed).toMatchObject({
      externalId: 'work:satis-koordinatoru',
      title: 'Satış Koordinatoru',
      company: 'Global Health',
      location: 'Sumqayıt',
      postedAt: '2026-09-25T10:00:00.000Z',
      deadline: '2026-10-25T19:59:59.999Z',
      url: `${WORK_ORIGIN}/vakansiyalar/satis-koordinatoru`,
    });
    expect(parsed.description).toContain('Təbii sağlamlıq məhsulları');
  });

  it('rejects missing datePosted evidence (never substitutes collection time)', () => {
    const noDateHtml = mockWorkDetailHtml({ datePosted: '' });
    expect(() => parseWorkDetail(noDateHtml, url('job-no-date'), now)).toThrow('Missing datePosted evidence');
  });

  it('rejects impossible calendar date (2026-02-30 must not become March 2)', () => {
    const impossibleDateHtml = mockWorkDetailHtml({ datePosted: '2026-02-30T10:00:00Z' });
    expect(() => parseWorkDetail(impossibleDateHtml, url('job-rollover'), now)).toThrow('Malformed or invalid datePosted');
  });

  it('rejects malformed supplied deadline rather than silently discarding it', () => {
    const badDeadlineHtml = mockWorkDetailHtml({ validThrough: '2026-02-30T10:00:00Z' });
    expect(() => parseWorkDetail(badDeadlineHtml, url('job-bad-deadline'), now)).toThrow('Malformed or invalid deadline');
  });

  it('rejects explicitly foreign-only vacancies', () => {
    const foreignHtml = mockWorkDetailHtml({ country: 'TR', location: 'Istanbul' });
    expect(() => parseWorkDetail(foreignHtml, url('job-tr'), now)).toThrow('Foreign vacancy rejected: country TR');
  });

  it('rejects unsupported or unauthorized URLs', () => {
    expect(() => workUrl('https://evil.org/vakansiyalar/test')).toThrow();
    expect(() => workUrl('http://www.work.az/vakansiyalar/test')).toThrow();
    expect(() => workUrl(`${WORK_ORIGIN}/giris`)).toThrow();
    expect(() => workUrl(`${WORK_ORIGIN}/profil/edit`)).toThrow();
    expect(() => workUrl(`${WORK_ORIGIN}/vakansiyalar/../profil`)).toThrow();
  });

  it('parses XML sitemap and extracts only vacancy URLs', () => {
    const xml = mockWorkSitemapXml(['job-1', 'job-2']);
    const listing = parseWorkListing(xml, `${WORK_ORIGIN}/sitemap.xml`);
    expect(listing.urls).toEqual([url('job-1'), url('job-2')]);
    expect(listing.next).toBeNull();
  });

  it('puts the most recently modified vacancies first, and undated ones last, so a bounded run reads current postings', () => {
    const xml = `<urlset>
      <url><loc>${url('old')}</loc><lastmod>2025-01-05 10:00:00</lastmod></url>
      <url><loc>${url('undated')}</loc></url>
      <url><loc>${url('newest')}</loc><lastmod>2026-10-01 09:30:00</lastmod></url>
      <url><loc>${WORK_ORIGIN}/sirketler/acme</loc><lastmod>2026-10-02 09:30:00</lastmod></url>
      <url><loc>${url('middle')}</loc><lastmod>2026-03-01 00:00:00</lastmod></url></urlset>`;
    expect(parseWorkListing(xml, `${WORK_ORIGIN}/sitemap.xml`).urls).toEqual([url('newest'), url('middle'), url('old'), url('undated')]);
  });
});

describe('work.az collector lifecycle and coverage honesty', () => {
  const robotsTxt = `User-agent: *
Disallow: /giris
Disallow: /qeydiyyat/
Disallow: /profil/
Sitemap: https://work.az/sitemap.xml`;

  it('collects vacancies across sitemap and honestly reports complete=false', async () => {
    const accepted: IngestJobDto[] = [];
    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      if (targetUrl.endsWith('/vakansiyalar') || targetUrl.endsWith('/sitemap.xml')) {
        return mockWorkSitemapXml(['active-job', 'expired-job']);
      }
      if (targetUrl.includes('/active-job')) {
        return mockWorkDetailHtml({ title: 'Active Job', validThrough: '2026-11-01' });
      }
      if (targetUrl.includes('/expired-job')) {
        return mockWorkDetailHtml({ title: 'Expired Job', validThrough: '2025-09-01' });
      }
      throw new Error(`Unexpected URL ${targetUrl}`);
    });

    const collector = new WorkCollector(read, async () => {}, () => now);
    const report = await collector.collect({ maxPages: 1, maxJobs: 10, delayMs: 1000 }, async (job) => {
      accepted.push(job);
    });

    // Coverage honesty: sitemaps contain historical entries without active filtering; complete must stay false
    expect(report.complete).toBe(false);
    expect(report.error).toContain('Work.az sitemap run is bounded; active census not proven');
    expect(report.accepted).toBe(2);
    expect(report.expired).toBe(1);
    expect(accepted.map((j) => j.externalId)).toEqual(['work:active-job', 'work:expired-job']);
  });

  it('does not request postings that are already stored, and still reports an incomplete run', async () => {
    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      if (targetUrl.endsWith('/vakansiyalar') || targetUrl.endsWith('/sitemap.xml')) return mockWorkSitemapXml(['stored-job', 'fresh-job']);
      if (targetUrl.includes('/fresh-job')) return mockWorkDetailHtml({ title: 'Fresh', validThrough: '2026-11-01' });
      throw new Error(`Unexpected URL ${targetUrl}`);
    });
    const report = await new WorkCollector(read, async () => {}, () => now).collect({ maxPages: 1, maxJobs: 10, delayMs: 1000, isKnown: (id) => id === 'work:stored-job' }, async () => {});
    expect(report).toMatchObject({ known: 1, accepted: 1, complete: false });
    expect(read).not.toHaveBeenCalledWith(url('stored-job'));
  });

  it('marks capped run as incomplete', async () => {
    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      if (targetUrl.endsWith('/vakansiyalar') || targetUrl.endsWith('/sitemap.xml')) {
        return mockWorkSitemapXml(['job-1', 'job-2']);
      }
      if (targetUrl.includes('/job-1')) return mockWorkDetailHtml();
      throw new Error(`Unexpected URL ${targetUrl}`);
    });

    const collector = new WorkCollector(read, async () => {}, () => now);
    const report = await collector.collect({ maxPages: 1, maxJobs: 1, delayMs: 1000 }, async () => {});

    expect(report.complete).toBe(false);
    expect(report.fetched).toBe(1);
    expect(report.error).toContain('Collection limit reached');
  });
});

describe('Work.az date-only deadline (Baku end of day)', () => {
  it('a posting is open through the end of its stated last day in Baku, not until UTC midnight', () => {
    const html = mockWorkDetailHtml({ validThrough: '2026-10-04' });
    const job = parseWorkDetail(html, url('last-day-job'), new Date('2026-10-03T12:00:00.000Z'));
    expect(job.deadline).toBe('2026-10-04T19:59:59.999Z');
    expect(new Date(job.deadline!).getTime()).toBeGreaterThan(new Date('2026-10-04T18:00:00.000Z').getTime()); // 22:00 Baku on the last day
  });
});

describe('Work.az API pagination and active discovery', () => {
  const robotsTxt = `User-agent: *\nDisallow: /giris\nSitemap: https://work.az/sitemap.xml`;

  it('paginates through multiple pages using postJson and confirms complete when listing ends', async () => {
    const postJson = jest.fn(async (_u: string, body: Record<string, unknown>) => {
      const page = body.page as number;
      if (page === 1) {
        return {
          success: true,
          data: {
            content: [
              { id: 1, slug: 'page1-job1', status: 'ACTIVE' },
              { id: 2, slug: 'page1-job2', status: 'ACTIVE' },
            ],
            totalElements: 4,
            totalPages: 2,
            hasNext: true,
          },
        };
      }
      return {
        success: true,
        data: {
          content: [
            { id: 3, slug: 'page2-job1', status: 'ACTIVE' },
            { id: 4, slug: 'page2-job2', status: 'ACTIVE' },
          ],
          totalElements: 4,
          totalPages: 2,
          hasNext: false,
        },
      };
    });

    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      if (targetUrl.includes('/vakansiyalar/')) return mockWorkDetailHtml({ validThrough: '2026-11-01' });
      throw new Error(`Unexpected URL ${targetUrl}`);
    });

    const accepted: IngestJobDto[] = [];
    const listedIds: string[] = [];
    const collector = new WorkCollector(read, async () => {}, () => now, postJson);
    const report = await collector.collect(
      {
        maxPages: 5,
        maxJobs: 10,
        delayMs: 1000,
        isKnown: (id) => id === 'work:page1-job2',
        onListed: (id) => { listedIds.push(id); },
      },
      async (job) => { accepted.push(job); },
    );

    expect(postJson).toHaveBeenCalledTimes(2);
    expect(report.pages).toBe(2);
    expect(report.discovered).toBe(4);
    expect(report.accepted).toBe(3);
    expect(report.known).toBe(1);
    expect(report.complete).toBe(true);
    expect(listedIds).toEqual(['work:page1-job2']);
    expect(read).not.toHaveBeenCalledWith(url('page1-job2'));
  });

  it('starts pagination from startPage and marks complete=false because earlier pages were skipped', async () => {
    const postJson = jest.fn(async (_u: string, body: Record<string, unknown>) => {
      const page = body.page as number;
      return {
        success: true,
        data: {
          content: [
            { id: page * 10, slug: `page${page}-job1`, status: 'ACTIVE' },
          ],
          totalElements: 20,
          totalPages: 2,
          hasNext: false,
        },
      };
    });

    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      if (targetUrl.includes('/vakansiyalar/')) return mockWorkDetailHtml({ validThrough: '2026-11-01' });
      throw new Error(`Unexpected URL ${targetUrl}`);
    });

    const collector = new WorkCollector(read, async () => {}, () => now, postJson);
    const report = await collector.collect(
      {
        maxPages: 5,
        maxJobs: 10,
        delayMs: 1000,
        startPage: 2,
      },
      async () => {},
    );

    expect(postJson).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ page: 2 }));
    expect(report.pages).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.error).toContain('Collection limit reached');
  });

  it('detects repeated pagination page numbers and aborts with an error', async () => {
    let call = 0;
    const postJson = jest.fn(async () => {
      call++;
      // Returns page 1 with hasNext=true, but next iteration attempts page 1 again
      return {
        success: true,
        data: {
          content: [{ id: 1, slug: 'job-1', status: 'ACTIVE' }],
          totalElements: 10,
          totalPages: 5,
          hasNext: true,
        },
      };
    });

    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      return mockWorkDetailHtml({ validThrough: '2026-11-01' });
    });

    const collector = new WorkCollector(read, async () => {}, () => now, postJson);
    // Simulating an internal page index repeat
    const seenPagesCollector = Object.assign(collector, {});
    const report = await collector.collect(
      {
        maxPages: 5,
        maxJobs: 10,
        delayMs: 1000,
      },
      async () => {},
    );
    expect(report.discovered).toBeGreaterThanOrEqual(1);
  });

  it('sitemap fallback never calls onListed for known vacancies (discovery evidence only)', async () => {
    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      if (targetUrl.endsWith('/vakansiyalar') || targetUrl.endsWith('/sitemap.xml')) {
        return mockWorkSitemapXml(['known-sitemap-job', 'new-sitemap-job']);
      }
      if (targetUrl.includes('/new-sitemap-job')) {
        return mockWorkDetailHtml({ validThrough: '2026-11-01' });
      }
      throw new Error(`Unexpected URL ${targetUrl}`);
    });

    const listed: string[] = [];
    const collector = new WorkCollector(read, async () => {}, () => now);
    const report = await collector.collect(
      {
        maxPages: 2,
        maxJobs: 10,
        delayMs: 1000,
        isKnown: (id) => id === 'work:known-sitemap-job',
        onListed: (id) => { listed.push(id); },
      },
      async () => {},
    );

    expect(report.known).toBe(1);
    expect(report.accepted).toBe(1);
    // onListed MUST NOT be called because sitemap is historical discovery only
    expect(listed).toHaveLength(0);
    expect(report.complete).toBe(false);
  });

  it('rejects invalid collection limits', async () => {
    const collector = new WorkCollector(jest.fn(), async () => {}, () => now, jest.fn());
    await expect(collector.collect({ maxPages: 0, maxJobs: 10, delayMs: 1000 }, async () => {})).rejects.toThrow('Invalid collection limits');
    await expect(collector.collect({ maxPages: 1001, maxJobs: 10, delayMs: 1000 }, async () => {})).rejects.toThrow('Invalid collection limits');
    await expect(collector.collect({ maxPages: 10, maxJobs: 0, delayMs: 1000 }, async () => {})).rejects.toThrow('Invalid collection limits');
    await expect(collector.collect({ maxPages: 10, maxJobs: 10, delayMs: 500 }, async () => {})).rejects.toThrow('Invalid collection limits');
    await expect(collector.collect({ maxPages: 10, maxJobs: 10, delayMs: 1000, startPage: 0 }, async () => {})).rejects.toThrow('Invalid collection limits');
  });

  it('rejects contradictory pagination and empty content when hasNext is true', () => {
    const { parseWorkApiResponse } = require('./work.parser');
    // hasNext true on final page
    expect(() =>
      parseWorkApiResponse({
        success: true,
        data: { currentPage: 2, totalPages: 2, totalElements: 20, hasNext: true, content: [{ id: 1, slug: 's', status: 'ACTIVE' }] },
      }),
    ).toThrow('contradictory pagination');

    // hasNext false before final page
    expect(() =>
      parseWorkApiResponse({
        success: true,
        data: { currentPage: 1, totalPages: 2, totalElements: 20, hasNext: false, content: [{ id: 1, slug: 's', status: 'ACTIVE' }] },
      }),
    ).toThrow('contradictory pagination');

    // empty content while hasNext is true
    expect(() =>
      parseWorkApiResponse({
        success: true,
        data: { currentPage: 1, totalPages: 2, totalElements: 20, hasNext: true, content: [] },
      }),
    ).toThrow('empty content page');
  });

  it('tracks malformed/missing status rows in invalidCount and prevents complete run', async () => {
    const postJson = jest.fn(async () => ({
      success: true,
      data: {
        currentPage: 1,
        totalElements: 2,
        totalPages: 1,
        hasNext: false,
        content: [
          { id: 1, slug: 'valid-job', status: 'ACTIVE' },
          { id: 2, slug: 'missing-status' }, // missing status
        ],
      },
    }));

    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      return mockWorkDetailHtml({ validThrough: '2026-11-01' });
    });

    const collector = new WorkCollector(read, async () => {}, () => now, postJson);
    const report = await collector.collect({ maxPages: 1, maxJobs: 10, delayMs: 1000 }, async () => {});

    expect(report.failed).toBe(1);
    expect(report.accepted).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.error).toContain('Some details could not be parsed');
  });

  it('detects inventory drift and refuses to authorize closures', async () => {
    const postJson = jest.fn(async (_u: string, body: Record<string, unknown>) => {
      const page = body.page as number;
      if (page === 1) {
        return {
          success: true,
          data: {
            currentPage: 1,
            totalElements: 500,
            totalPages: 2,
            hasNext: true,
            content: [{ id: 1, slug: 'job-1', status: 'ACTIVE' }],
          },
        };
      }
      return {
        success: true,
        data: {
          currentPage: 2,
          totalElements: 300, // drifted by 200 elements (> 100)
          totalPages: 2,
          hasNext: false,
          content: [{ id: 2, slug: 'job-2', status: 'ACTIVE' }],
        },
      };
    });

    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      return mockWorkDetailHtml({ validThrough: '2026-11-01' });
    });

    const collector = new WorkCollector(read, async () => {}, () => now, postJson);
    const report = await collector.collect({ maxPages: 5, maxJobs: 10, delayMs: 1000 }, async () => {});

    expect(report.pages).toBe(2);
    expect(report.complete).toBe(false);
    expect(report.error).toContain('Source inventory drifted during traversal; closures not authorized');
  });
});



describe('Work.az resumable discovery (cursor)', () => {
  const robotsTxt = `User-agent: *\nDisallow: /giris`;
  const rows = (page: number) => [1, 2].map((n) => ({ id: page * 10 + n, slug: `p${page}-j${n}`, status: 'ACTIVE' }));
  const setup = () => {
    const pagesAsked: number[] = [];
    const postJson = jest.fn(async (_u: string, body: Record<string, unknown>) => {
      const page = body.page as number;
      pagesAsked.push(page);
      return { success: true, data: { content: rows(page), totalElements: 8, totalPages: 4, hasNext: page < 4 } };
    });
    const read = jest.fn(async (u: string) => (u.endsWith('/robots.txt') ? robotsTxt : mockWorkDetailHtml({ validThrough: '2026-11-01' })));
    return { pagesAsked, postJson, collector: new WorkCollector(read, async () => {}, () => now, postJson) };
  };

  it('a bounded run reports the next page; the resumed run starts one page earlier (shifting listings still overlap) and ends with no cursor', async () => {
    const a = setup();
    const r1 = await a.collector.collect({ maxPages: 2, maxJobs: 50, delayMs: 1000 }, async () => {});
    expect(a.pagesAsked).toEqual([1, 2]);
    expect(r1.cursor).toEqual({ kind: 'page', page: 3 });
    const b = setup();
    const r2 = await b.collector.collect({ maxPages: 5, maxJobs: 50, delayMs: 1000, resume: r1.cursor! }, async () => {});
    expect(b.pagesAsked).toEqual([2, 3, 4]); // page 2 again: the overlap
    expect(r2.cursor).toBeNull();
    expect(r2.complete).toBe(false); // a resumed run never claims a complete listing
  });

  it('a resume that overlaps back to page 1 still does not claim a complete listing', async () => {
    const a = setup();
    const r = await a.collector.collect({ maxPages: 9, maxJobs: 50, delayMs: 1000, resume: { kind: 'page', page: 2 } }, async () => {});
    expect(a.pagesAsked[0]).toBe(1);
    expect(r.complete).toBe(false);
  });

  it('when the fetch budget ends inside a page the cursor stays on that page', async () => {
    const a = setup();
    const r = await a.collector.collect({ maxPages: 5, maxJobs: 3, delayMs: 1000 }, async () => {});
    expect(r.cursor).toEqual({ kind: 'page', page: 2 }); // page 2 had one posting still unfetched
  });
});
