import {
  BOSS_ORIGIN,
  BOSS_CATEGORY_IDS,
  bossUrl,
  parseBossDetail,
  parseBossListing,
  extractBossApolloPayloads,
  SafeJsonParser,
} from './boss.parser';
import { BossCollector } from './boss.collector';
import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';

const now = new Date('2026-10-02T12:00:00.000Z');
const url = (id: string) => `${BOSS_ORIGIN}/vacancies/${id}`;

const mockBossDetailHtml = (options: {
  id?: string;
  positionName?: string;
  name?: string;
  location?: string;
  approvedAt?: string;
  email?: string;
  status?: string;
  daysLeft?: number | null;
  deadline?: string;
  description?: string;
  requirements?: string;
  responsibilities?: string;
} = {}) => {
  const id = options.id || '274152';
  const positionName = options.positionName || 'Sahə Koordinatoru';
  const name = options.name || 'ORİONLİFT MMC';
  const location = options.location || 'Bakı';
  const approvedAt = options.approvedAt !== undefined ? options.approvedAt : '2026-10-02T18:22:07+04:00';
  const email = options.email || 'accountant@orionlift.az';
  const status = options.status || 'approved';
  const daysLeft = options.daysLeft !== undefined ? options.daysLeft : null;
  const deadline = options.deadline;
  const description = options.description || '<p>Avadanlıqların quraşdırılması üzrə koordinator.</p>';
  const requirements = options.requirements || '<p>Ali təhsil və MS Office bilikləri.</p>';
  const responsibilities = options.responsibilities || '<p>Sənədləşmə işlərinin aparılması.</p>';

  const vacancyObj: Record<string, any> = {
    id,
    positionName,
    name,
    location,
    email,
    status,
    daysLeft,
    approvedAt,
    description,
    requirements,
    responsibilities,
    phones: ['+994125000000'],
    category: { name: 'İnzibati dəstək' },
  };
  if (deadline) vacancyObj.deadline = deadline;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${positionName} - ${name}</title>
        <script>
          (window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({
            "rehydrate": {
              "_R_test_": {
                "data": {
                  "vacancy": ${JSON.stringify(vacancyObj)}
                }
              }
            }
          });
        </script>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "JobPosting",
          "title": "${positionName}",
          "description": "",
          "identifier": {
            "@type": "PropertyValue",
            "name": "Boss.az",
            "value": "${id}"
          },
          ${approvedAt ? `"datePosted": "${approvedAt}",` : ''}
          ${deadline ? `"validThrough": "${deadline}",` : ''}
          "hiringOrganization": {
            "@type": "Organization",
            "name": "${name}"
          },
          "jobLocation": {
            "@type": "Place",
            "address": {
              "@type": "PostalAddress",
              "addressLocality": "${location}",
              "addressCountry": "AZ"
            }
          }
        }
        </script>
      </head>
      <body>
        <h1>${positionName}</h1>
        <div class="company-title">${name}</div>
      </body>
    </html>
  `;
};

const mockBossListingHtml = (ids: string[], extraCategories: string[] = []) => `
  <div>
    ${ids.map((id) => `<a href="/vacancies/${id}">Vakansiya ${id}</a>`).join('')}
    ${extraCategories.map((c) => `<a href="/search/vacancies?categoryIds=${c}">Category ${c}</a>`).join('')}
  </div>
`;


/** A listing whose Apollo payload states the category's own totals (as Boss pages do). */
const apolloListing = (ids: string[], total: number, hasNextPage: boolean) => `
  <div>${ids.map((id) => `<a href="/vacancies/${id}">Vakansiya ${id}</a>`).join('')}</div>
  <script>(window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({"rehydrate":{"_R_1_":{"data":{"vacancies":{"nodes":[${ids.map((id) => `{"id":"${id}"}`).join(',')}],"totalCount":${total},"pageInfo":{"hasNextPage":${hasNextPage},"endCursor":"MjQ"}}}}}})</script>`;

describe('boss.az non-executing parser', () => {
  it('parses real SSR fixture containing undefined, nested objects, and arrays without execution', () => {
    const script = `
      <script>
        (window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({
          "rehydrate": {
            "_R_2lb_": {
              "data": undefined,
              "loading": true,
              "networkStatus": 1,
              "called": true
            },
            "_R_real_": {
              "data": {
                "vacancy": {
                  "id": "274152",
                  "positionName": "SSR Engineer",
                  "name": "Tech Corp",
                  "location": "Bakı",
                  "approvedAt": "2026-10-02T18:22:07+04:00",
                  "description": "Clean description\\nwith unicode \\u0026 symbols"
                }
              }
            }
          },
          "events": []
        });
      </script>
    `;
    const payloads = extractBossApolloPayloads(script);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].rehydrate._R_2lb_.data).toBeUndefined();
    expect(payloads[0].rehydrate._R_real_.data.vacancy.positionName).toBe('SSR Engineer');
  });

  it('rejects executable expressions without executing them', () => {
    let sideEffect = false;
    (globalThis as any).__testSideEffect = () => {
      sideEffect = true;
    };

    const maliciousHtml = `
      <script>
        (window[Symbol.for("ApolloSSRDataTransport")] ??= []).push(globalThis.__testSideEffect());
        (window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({ "data": eval("globalThis.__testSideEffect()") });
        (window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({ "fn": () => globalThis.__testSideEffect() });
        (window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({ "math": 1 + 2 });
      </script>
    `;

    const payloads = extractBossApolloPayloads(maliciousHtml);
    expect(payloads).toHaveLength(0);
    expect(sideEffect).toBe(false);
    delete (globalThis as any).__testSideEffect;
  });

  it('SafeJsonParser fails closed on disallowed tokens', () => {
    expect(() => new SafeJsonParser('process.exit()').parse()).toThrow();
    expect(() => new SafeJsonParser('{ "key": 1 + 1 }').parse()).toThrow();
    expect(() => new SafeJsonParser('{ "key": function(){} }').parse()).toThrow();
    expect(() => new SafeJsonParser('{ "key": new Date() }').parse()).toThrow();
  });
});

describe('boss.az date, location, and status validation', () => {
  it('extracts structured vacancy facts and preserves contact email', () => {
    const html = mockBossDetailHtml({
      id: '274152',
      positionName: 'Sahə Koordinatoru',
      name: 'ORİONLİFT MMC',
      location: 'Bakı',
      email: 'accountant@orionlift.az',
    });

    const parsed = parseBossDetail(html, url('274152'), now);
    expect(parsed).toMatchObject({
      externalId: 'boss:274152',
      title: 'Sahə Koordinatoru',
      company: 'ORİONLİFT MMC',
      location: 'Bakı',
      postedAt: '2026-10-02T14:22:07.000Z',
      url: `${BOSS_ORIGIN}/vacancies/274152`,
      rawPayload: {
        source: 'boss',
        email: 'accountant@orionlift.az',
        category: 'İnzibati dəstək',
      },
    });
  });

  it('rejects vacancy when approvedAt/datePosted is missing or invalid', () => {
    const noDateHtml = mockBossDetailHtml({ approvedAt: '' });
    expect(() => parseBossDetail(noDateHtml, url('274152'), now)).toThrow('Missing approvedAt/datePosted evidence');

    const invalidDateHtml = mockBossDetailHtml({ approvedAt: 'invalid-date' });
    expect(() => parseBossDetail(invalidDateHtml, url('274152'), now)).toThrow('Malformed or invalid approvedAt/datePosted');
  });

  it('rejects impossible calendar date (2026-02-30 must not become March 2)', () => {
    const impossibleDateHtml = mockBossDetailHtml({ approvedAt: '2026-02-30T10:00:00Z' });
    expect(() => parseBossDetail(impossibleDateHtml, url('274152'), now)).toThrow('Malformed or invalid approvedAt/datePosted');
  });

  it('rejects malformed supplied deadline rather than silently discarding it', () => {
    const badDeadlineHtml = mockBossDetailHtml({ deadline: '2026-02-30T10:00:00Z' });
    expect(() => parseBossDetail(badDeadlineHtml, url('274152'), now)).toThrow('Malformed or invalid deadline');
  });

  it('rejects explicitly foreign-only vacancies', () => {
    const foreignHtml = mockBossDetailHtml({ location: 'Istanbul' });
    expect(() => parseBossDetail(foreignHtml, url('274152'), now)).toThrow('Foreign vacancy rejected: locality Istanbul');
  });

  it('handles source-backed closed or expired status without manufacturing freshness', () => {
    const expiredHtml = mockBossDetailHtml({ status: 'expired', approvedAt: '2026-09-01T10:00:00Z' });
    const parsed = parseBossDetail(expiredHtml, url('274152'), now);
    expect(parsed.deadline).toBe('2026-09-01T10:00:00.000Z');
    expect(new Date(parsed.deadline!).getTime()).toBeLessThan(now.getTime());

    const zeroDaysHtml = mockBossDetailHtml({ daysLeft: 0, approvedAt: '2026-09-01T10:00:00Z' });
    const parsedZero = parseBossDetail(zeroDaysHtml, url('274152'), now);
    expect(parsedZero.deadline).toBe('2026-09-01T10:00:00.000Z');
  });
});

describe('boss.az category discovery and pagination', () => {
  it('includes restaurant category 134 in BOSS_CATEGORY_IDS', () => {
    expect(BOSS_CATEGORY_IDS).toContain('134');
  });

  it('parses vacancy listing and discovers categories from HTML links', () => {
    const html = mockBossListingHtml(['274152', '274149'], ['134', '999']);
    const listing = parseBossListing(html, `${BOSS_ORIGIN}/search/vacancies?sortBy=DATE`);
    expect(listing.urls).toEqual([url('274152'), url('274149')]);
    expect(listing.categories).toContain('134');
    expect(listing.categories).toContain('999');
    expect(listing.next).toContain('categoryIds=');
  });

  it('rejects malicious or out-of-scope URLs', () => {
    expect(() => bossUrl('https://evil.org/vacancies/123')).toThrow();
    expect(() => bossUrl('http://boss.az/vacancies/123')).toThrow();
    expect(() => bossUrl(`${BOSS_ORIGIN}/admin`)).toThrow();
    expect(() => bossUrl(`${BOSS_ORIGIN}/vacancies/../admin`)).toThrow();
    expect(() => bossUrl(`${BOSS_ORIGIN}/vacancies/%2e%2e%2fadmin`)).toThrow();
    expect(() => bossUrl(`${BOSS_ORIGIN}/search/vacancies?unknownParam=bad`)).toThrow();
  });
});

describe('boss.az collector lifecycle and honesty', () => {
  const robotsTxt = `User-Agent: *
Allow: /
Allow: /search/*
Allow: /vacancies
Allow: /vacancies/*
Disallow: /admin
Disallow: /login`;

  it('always reports complete=false because cross-category coverage is bounded', async () => {
    const accepted: IngestJobDto[] = [];
    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return robotsTxt;
      if (targetUrl.includes('/search/vacancies')) {
        return mockBossListingHtml(['101', '102']);
      }
      if (targetUrl.includes('/vacancies/101')) return mockBossDetailHtml({ id: '101' });
      if (targetUrl.includes('/vacancies/102')) return mockBossDetailHtml({ id: '102' });
      throw new Error(`Unexpected URL ${targetUrl}`);
    });

    const collector = new BossCollector(read, async () => {}, () => now);
    const report = await collector.collect({ maxPages: 1, maxJobs: 5, delayMs: 1000 }, async (job) => {
      accepted.push(job);
    });

    expect(report.complete).toBe(false);
    expect(report.error).toContain('Boss.az does not establish full pagination coverage; run is bounded and incomplete');
    expect(report.accepted).toBe(2);
  });

  it('stops and reports failure when crawler rules prohibit access', async () => {
    const restrictiveRobots = `User-Agent: *\nDisallow: /search/vacancies`;
    const read = jest.fn(async (targetUrl: string) => {
      if (targetUrl.endsWith('/robots.txt')) return restrictiveRobots;
      return mockBossListingHtml(['101']);
    });

    const collector = new BossCollector(read, async () => {}, () => now);
    const report = await collector.collect({ maxPages: 1, maxJobs: 5, delayMs: 1000 }, async () => {});

    expect(report.complete).toBe(false);
    expect(report.error).toContain('Source crawler rules prohibit this URL');
  });

  describe('empty categories and ambiguous pages', () => {
    const cat = (id: number) => `${BOSS_ORIGIN}/search/vacancies?sortBy=DATE&categoryIds=${id}`;
    it('reads a category the page itself says is empty as an explicit empty listing, not an error', () => {
      const empty = parseBossListing(apolloListing([], 0, false), cat(72));
      expect(empty).toMatchObject({ urls: [], totalCount: 0, hasNextPage: false });
      expect(empty.next).toBeTruthy(); // the walk continues to the next category
    });
    it.each([
      ['a page with no vacancy data at all', '<html><h1>Xəta</h1></html>'],
      ['a challenge page', '<html><title>Just a moment...</title></html>'],
      ['a changed layout that still says zero results in text', '<div>Vakansiya tapılmadı</div>'],
      ['an empty page that claims more pages exist', apolloListing([], 0, true)],
      ['a zero total with no vacancy connection shape', '<script>(window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({"rehydrate":{"_R_1_":{"data":{"other":{"totalCount":0}}}}})</script>'],
    ])('still treats %s as unrecognized', (_name, html) => {
      expect(() => parseBossListing(html, cat(72))).toThrow('Listing has no recognizable vacancy entries');
    });
    it('keeps walking past an empty category, and reports what lies beyond the first page of a larger one', async () => {
      const accepted: IngestJobDto[] = [];
      const read = jest.fn(async (target: string) => {
        if (target.endsWith('/robots.txt')) return 'User-Agent: *\nAllow: /';
        if (target === `${BOSS_ORIGIN}/search/vacancies?sortBy=DATE`) return apolloListing(['101'], 1, false);
        if (target === cat(Number(BOSS_CATEGORY_IDS[0]))) return apolloListing([], 0, false); // empty
        if (target === cat(Number(BOSS_CATEGORY_IDS[1]))) return apolloListing(['102', '103'], 60, true); // 58 beyond the first page
        if (/\/vacancies\/10[123]$/.test(target)) return mockBossDetailHtml({ id: target.split('/').pop() });
        throw new Error(`Unexpected URL ${target}`);
      });
      const report = await new BossCollector(read, async () => {}, () => now).collect({ maxPages: 3, maxJobs: 10, delayMs: 1000 }, async (job) => { accepted.push(job); });
      expect(report.pages).toBe(3);
      expect(accepted.map((j) => j.externalId).sort()).toEqual(['boss:101', 'boss:102', 'boss:103']);
      expect(report.complete).toBe(false); // never a complete inventory
      expect(report.error).toContain('58 listed vacancies lie beyond the first page');
    });
    it('aborts, incomplete, on an ambiguous page in the middle of the walk', async () => {
      const read = jest.fn(async (target: string) => {
        if (target.endsWith('/robots.txt')) return 'User-Agent: *\nAllow: /';
        if (target === `${BOSS_ORIGIN}/search/vacancies?sortBy=DATE`) return apolloListing(['101'], 1, false);
        if (target === cat(Number(BOSS_CATEGORY_IDS[0]))) return '<html>maintenance</html>';
        return mockBossDetailHtml({ id: '101' });
      });
      const report = await new BossCollector(read, async () => {}, () => now).collect({ maxPages: 5, maxJobs: 10, delayMs: 1000 }, async () => {});
      expect(report).toMatchObject({ complete: false, error: 'Listing has no recognizable vacancy entries' });
    });
  });
});

describe('Boss date-only deadline (Baku end of day)', () => {
  it('is open through the end of its stated last day in Baku, not until UTC midnight', () => {
    const parsed = parseBossDetail(mockBossDetailHtml({ deadline: '2026-10-04' }), url('274152'), now);
    expect(parsed.deadline).toBe('2026-10-04T19:59:59.999Z');
  });
  it('keeps an explicit offset as stated', () => {
    expect(parseBossDetail(mockBossDetailHtml({ deadline: '2026-10-04T18:00:00+04:00' }), url('274152'), now).deadline).toBe('2026-10-04T14:00:00.000Z');
  });
});

describe('Boss.az GraphQL pagination and end-of-list detection', () => {
  it('paginates using postJson and marks complete when hasNextPage becomes false', async () => {
    const postJson = jest.fn(async (_u: string, body: Record<string, unknown>) => {
      const vars = body.variables as { first: number; after: string | null };
      if (!vars.after) {
        return {
          data: {
            vacancies: {
              totalCount: 3,
              pageInfo: { hasNextPage: true, endCursor: 'Mg' },
              nodes: [{ id: '101' }, { id: '102' }],
            },
          },
        };
      }
      return {
        data: {
          vacancies: {
            totalCount: 3,
            pageInfo: { hasNextPage: false, endCursor: 'Mw' },
            nodes: [{ id: '103' }],
          },
        },
      };
    });

    const read = jest.fn(async (target: string) => {
      if (target.endsWith('/robots.txt')) return 'User-Agent: *\nAllow: /';
      return mockBossDetailHtml({ id: '101' });
    });

    const accepted: IngestJobDto[] = [];
    const listed: string[] = [];
    const collector = new BossCollector(read, async () => {}, () => now, postJson);
    const report = await collector.collect(
      {
        maxPages: 5,
        maxJobs: 10,
        delayMs: 1000,
        isKnown: (id) => id === 'boss:102',
        onListed: (id) => { listed.push(id); },
      },
      async (job) => { accepted.push(job); },
    );

    expect(postJson).toHaveBeenCalledTimes(2);
    expect(report.pages).toBe(2);
    expect(report.discovered).toBe(3);
    expect(report.accepted).toBe(2);
    expect(report.known).toBe(1);
    expect(report.complete).toBe(true);
    expect(listed).toEqual(['boss:102']);
    expect(read).not.toHaveBeenCalledWith(url('102'));
  });
});


describe('Boss.az resumable discovery (cursor)', () => {
  const run = (extra: Record<string, unknown> = {}) => {
    const afters: (string | null)[] = [];
    const postJson = jest.fn(async (_u: string, body: Record<string, unknown>) => {
      const after = (body.variables as { after: string | null }).after;
      afters.push(after);
      const page = after === null ? 1 : after === 'c1' ? 2 : 3;
      return { data: { vacancies: { totalCount: 5, pageInfo: { hasNextPage: page < 3, endCursor: `c${page}` }, nodes: page === 1 ? [{ id: '1' }, { id: '2' }] : page === 2 ? [{ id: '3' }, { id: '4' }] : [{ id: '5' }] } } };
    });
    const read = jest.fn(async (target: string) => (target.endsWith('/robots.txt') ? 'User-Agent: *\nAllow: /' : mockBossDetailHtml({ id: '1' })));
    const collector = new BossCollector(read, async () => {}, () => now, postJson);
    return { afters, go: () => collector.collect({ maxPages: 5, maxJobs: 50, delayMs: 1000, ...extra } as never, async () => {}) };
  };

  it('stops with the API cursor of the next page and continues from exactly there; a resumed run is never complete', async () => {
    const a = run({ maxPages: 1 });
    const r1 = await a.go();
    expect(r1.cursor).toEqual({ kind: 'cursor', value: 'c1' });
    const b = run({ resume: r1.cursor });
    const r2 = await b.go();
    expect(b.afters).toEqual(['c1', 'c2']);
    expect(r2.cursor).toBeNull();
    expect(r2.complete).toBe(false);
    expect((await run().go()).complete).toBe(true); // from the head, to the end: complete
  });

  it('when the fetch budget ends inside a page the cursor stays where that page began', async () => {
    const a = run({ maxJobs: 1 });
    const r = await a.go();
    expect(r.cursor).toEqual({ kind: 'cursor', value: '' }); // stopped at the head: null is reserved for "reached the end"
    expect(a.afters).toEqual([null]);
  });
});
