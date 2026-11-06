import {
  YELO_ORIGIN,
  YELO_LIST_PATH,
  YELO_DETAIL_PATH,
  yeloUrl,
  yeloDate,
  parseYeloListing,
  parseYeloDetail,
} from './yelo.parser';
import { YeloCollector } from './yelo.collector';

describe('yeloUrl', () => {
  it('accepts robots.txt path', () => {
    expect(yeloUrl(`${YELO_ORIGIN}/robots.txt`)).toBe(`${YELO_ORIGIN}/robots.txt`);
  });

  it('normalizes yelo.az to www.yelo.az', () => {
    expect(yeloUrl('https://yelo.az/az/about-bank/career/')).toBe(`${YELO_ORIGIN}/az/about-bank/career/`);
  });

  it('accepts listing path', () => {
    expect(yeloUrl(`${YELO_ORIGIN}${YELO_LIST_PATH}`)).toBe(`${YELO_ORIGIN}${YELO_LIST_PATH}`);
  });

  it('accepts a valid detail URL with vacancy parameter', () => {
    expect(yeloUrl(`${YELO_ORIGIN}${YELO_DETAIL_PATH}?vacancy=yelo-data-analitik-55734744`))
      .toBe(`${YELO_ORIGIN}${YELO_DETAIL_PATH}?vacancy=yelo-data-analitik-55734744`);
  });

  it('rejects wrong origin', () => {
    expect(() => yeloUrl('https://evil.example/az/about-bank/career/')).toThrow('Unsupported Yelo public URL');
  });

  it('rejects credentials', () => {
    expect(() => yeloUrl('https://u:p@www.yelo.az/az/about-bank/career/')).toThrow('Unsupported Yelo public URL');
  });

  it('rejects path traversal', () => {
    expect(() => yeloUrl(`${YELO_ORIGIN}/az/about-bank/%2e%2e/passports`)).toThrow('Unsupported Yelo public URL');
  });

  it('rejects query parameters on listing page', () => {
    expect(() => yeloUrl(`${YELO_ORIGIN}${YELO_LIST_PATH}?page=2`)).toThrow('Unsupported Yelo listing URL options');
  });

  it('rejects extra query parameters on detail page', () => {
    expect(() => yeloUrl(`${YELO_ORIGIN}${YELO_DETAIL_PATH}?vacancy=yelo-dev-123&extra=bad`))
      .toThrow('Unsupported Yelo detail URL options');
  });

  it('rejects malformed vacancy slug without numeric ID', () => {
    expect(() => yeloUrl(`${YELO_ORIGIN}${YELO_DETAIL_PATH}?vacancy=yelo-developer`))
      .toThrow('Invalid Yelo vacancy slug');
  });

  it('rejects unapproved paths', () => {
    expect(() => yeloUrl(`${YELO_ORIGIN}/site/assets/files/passports/secret`))
      .toThrow('Unsupported Yelo URL path');
  });
});

describe('yeloDate', () => {
  it('parses valid DD-MM-YYYY format into UTC ISO string (start of day)', () => {
    expect(yeloDate('30-09-2026', false)).toBe('2026-09-30T00:00:00.000Z');
  });

  it('parses valid DD-MM-YYYY into Baku end-of-day UTC ISO string', () => {
    // 23:59:59.999 in UTC+4 -> 19:59:59.999Z
    expect(yeloDate('30-10-2026', true)).toBe('2026-10-30T19:59:59.999Z');
  });

  it('rejects calendar rollover date (30-02-2026)', () => {
    expect(() => yeloDate('30-02-2026')).toThrow(/Invalid Yelo calendar date|Strict date validation failed/);
  });

  it('rejects impossible day (32-01-2026)', () => {
    expect(() => yeloDate('32-01-2026')).toThrow(/Invalid Yelo calendar date|Strict date validation failed/);
  });

  it('rejects invalid format (YYYY-MM-DD instead of DD-MM-YYYY)', () => {
    expect(() => yeloDate('2026-09-30')).toThrow(/Invalid Yelo date format/);
  });
});

const SAMPLE_LISTING_HTML = `
<html>
<body>
  <div class="vacancies-list">
    <a href="/az/about-bank/vacancies/?vacancy=yelo-data-analitik-biznes-mutexessis-55734744">
      Data analitik Bakı Tam ştat
    </a>
    <a href="/az/about-bank/vacancies/?vacancy=yelo-lenkeran-filiali-mikro-biznes-534">
      (Lənkəran filialı) Mikro biznes Lənkəran Tam ştat
    </a>
    <a href="/az/about-bank/vacancies/?vacancy=yelo-data-analitik-biznes-mutexessis-55734744">
      Data analitik duplicate
    </a>
  </div>
</body>
</html>
`;

describe('parseYeloListing', () => {
  it('parses distinct vacancies and extracts location hints', () => {
    const result = parseYeloListing(SAMPLE_LISTING_HTML);
    expect(result.total).toBe(2);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].id).toBe('55734744');
    expect(result.entries[0].cardLocation).toBe('Bakı');
    expect(result.entries[1].id).toBe('534');
    expect(result.entries[1].cardLocation).toBe('Lənkəran');
  });

  it('returns empty result when recognized career container has no vacancy links', () => {
    const result = parseYeloListing('<html><body><div class="vacancies-list"><p>Hazırda aktiv vakansiya yoxdur</p></div></body></html>');
    expect(result.total).toBe(0);
    expect(result.entries).toEqual([]);
  });

  it('throws on maintenance or error pages', () => {
    expect(() => parseYeloListing('<html><h1>Maintenance</h1></html>'))
      .toThrow('Yelo career listing indicates maintenance or error page');
    expect(() => parseYeloListing('<html><title>503 Service Unavailable</title></html>'))
      .toThrow('Yelo career listing indicates maintenance or error page');
  });

  it('throws on unrecognized layouts without career structure', () => {
    expect(() => parseYeloListing('<html><body><p>Random page content</p></body></html>'))
      .toThrow('Unrecognized Yelo listing page layout');
  });

  it('throws on malformed vacancy link', () => {
    const malformed = '<html><body><div class="vacancies-list"><a href="/az/about-bank/vacancies/?vacancy=no-numeric-id">Role</a></div></body></html>';
    expect(() => parseYeloListing(malformed)).toThrow('Invalid Yelo vacancy slug');
  });
});

const SAMPLE_DETAIL_HTML = `
<html>
<body>
  <div class="vac_top">
    <h1>Data analitik (Biznes) / Mütəxəssis</h1>
  </div>
  <div class="text_content_career_vacancies">
    <ul>
      <li><strong>Vakansiya növü:</strong> Tam ştat</li>
      <li><strong>Kateqoriya:</strong> Elm və Texnologiya</li>
      <li><strong>Elan tarixi:</strong> 30-09-2026</li>
      <li><strong>Son Tarix:</strong> 30-10-2026</li>
    </ul>
    <p><strong>Vəzifə və öhdəliklər</strong></p>
    <ul>
      <li>Data əsaslı analizlərin aparılması.</li>
    </ul>
    <p><strong>Tələblər</strong></p>
    <ul>
      <li>SQL və Python bilikləri.</li>
    </ul>
  </div>
</body>
</html>
`;

const DETAIL_URL = `${YELO_ORIGIN}/az/about-bank/vacancies/?vacancy=yelo-data-analitik-55734744`;
const NOW = new Date('2026-10-02T12:00:00Z');

describe('parseYeloDetail', () => {
  it('parses valid Azerbaijani vacancy detail correctly', () => {
    const job = parseYeloDetail(SAMPLE_DETAIL_HTML, DETAIL_URL, NOW, 'Bakı');
    expect(job).not.toBeNull();
    expect(job!.externalId).toBe('yelo:55734744');
    expect(job!.title).toBe('Data analitik (Biznes) / Mütəxəssis');
    expect(job!.company).toBe('Yelo Bank');
    expect(job!.location).toBe('Bakı');
    expect(job!.postedAt).toBe('2026-09-30T00:00:00.000Z');
    expect(job!.deadline).toBe('2026-10-30T19:59:59.999Z');
    expect(job!.description).toContain('Data əsaslı analizlərin aparılması');
    expect(job!.description).toContain('SQL və Python bilikləri');
    expect(job!.rawPayload?.category).toBe('Elm və Texnologiya');
    expect(job!.rawPayload?.employmentType).toBe('Tam ştat');
    expect(job!.rawPayload?.employer).toBe('yelo-bank');
  });

  it('rejects future posted date', () => {
    const futureHtml = SAMPLE_DETAIL_HTML.replace('30-09-2026', '15-11-2026');
    const job = parseYeloDetail(futureHtml, DETAIL_URL, NOW);
    expect(job).toBeNull();
  });

  it('throws on inverted date range (deadline before posted date)', () => {
    const invertedHtml = SAMPLE_DETAIL_HTML.replace('Son Tarix:</strong> 30-10-2026', 'Son Tarix:</strong> 15-09-2026');
    expect(() => parseYeloDetail(invertedHtml, DETAIL_URL, NOW))
      .toThrow('Inverted Yelo date range');
  });

  it('throws on missing title', () => {
    const noTitle = SAMPLE_DETAIL_HTML.replace('<h1>Data analitik (Biznes) / Mütəxəssis</h1>', '');
    expect(() => parseYeloDetail(noTitle, DETAIL_URL, NOW)).toThrow('Invalid or missing Yelo vacancy title');
  });

  it('throws on missing content container', () => {
    const noContainer = '<html><body><h1>Title</h1></body></html>';
    expect(() => parseYeloDetail(noContainer, DETAIL_URL, NOW)).toThrow('Missing Yelo vacancy content container');
  });

  it('throws on missing Elan tarixi', () => {
    const noDate = SAMPLE_DETAIL_HTML.replace('<li><strong>Elan tarixi:</strong> 30-09-2026</li>', '');
    expect(() => parseYeloDetail(noDate, DETAIL_URL, NOW)).toThrow('Missing Yelo Elan tarixi');
  });
});

describe('YeloCollector', () => {
  const robotsTxt = 'User-agent: *\nDisallow: /site/assets/files/passports/*\n';
  const listUrl = `${YELO_ORIGIN}${YELO_LIST_PATH}`;
  const dUrl1 = `${YELO_ORIGIN}${YELO_DETAIL_PATH}?vacancy=yelo-data-analitik-55734744`;
  const dUrl2 = `${YELO_ORIGIN}${YELO_DETAIL_PATH}?vacancy=yelo-lenkeran-filiali-534`;

  const listingHtml = `
<html>
<body>
  <div class="vacancies-list">
    <a href="${dUrl1}">Data analitik Bakı Tam ştat</a>
    <a href="${dUrl2}">Mikro biznes Lənkəran Tam ştat</a>
  </div>
</body>
</html>
`;

  it('collects all vacancies and sets complete=true when all fetched', async () => {
    const accepted: any[] = [];
    const collector = new YeloCollector(
      async (url) => {
        if (url === `${YELO_ORIGIN}/robots.txt`) return robotsTxt;
        if (url === listUrl) return listingHtml;
        if (url === dUrl1 || url === dUrl2) return SAMPLE_DETAIL_HTML;
        throw new Error(`Unexpected url: ${url}`);
      },
      async () => {},
      () => NOW,
    );

    const report = await collector.collect({ maxPages: 5, maxJobs: 10, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.source).toBe('yelo');
    expect(report.discovered).toBe(2);
    expect(report.fetched).toBe(2);
    expect(report.accepted).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.complete).toBe(true);
    expect(report.error).toBeUndefined();
    expect(accepted).toHaveLength(2);
  });

  it('reports complete=false when bounded by maxJobs', async () => {
    const accepted: any[] = [];
    const collector = new YeloCollector(
      async (url) => {
        if (url === `${YELO_ORIGIN}/robots.txt`) return robotsTxt;
        if (url === listUrl) return listingHtml;
        if (url === dUrl1) return SAMPLE_DETAIL_HTML;
        throw new Error(`Unexpected url: ${url}`);
      },
      async () => {},
      () => NOW,
    );

    const report = await collector.collect({ maxPages: 5, maxJobs: 1, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.discovered).toBe(2);
    expect(report.fetched).toBe(1);
    expect(report.accepted).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.error).toMatch(/Collection limit reached/);
  });

  it('handles empty listing with complete=true when valid container present', async () => {
    const accepted: any[] = [];
    const collector = new YeloCollector(
      async (url) => {
        if (url === `${YELO_ORIGIN}/robots.txt`) return robotsTxt;
        if (url === listUrl) return '<html><body><div class="vacancies-list"><p>Hazırda aktiv vakansiya yoxdur</p></div></body></html>';
        throw new Error(`Unexpected url: ${url}`);
      },
      async () => {},
      () => NOW,
    );

    const report = await collector.collect({ maxPages: 5, maxJobs: 10, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.discovered).toBe(0);
    expect(report.complete).toBe(true);
    expect(report.accepted).toBe(0);
  });

  it('fails closed when listing returns maintenance page', async () => {
    const accepted: any[] = [];
    const collector = new YeloCollector(
      async (url) => {
        if (url === `${YELO_ORIGIN}/robots.txt`) return robotsTxt;
        if (url === listUrl) return '<html><h1>Maintenance</h1></html>';
        throw new Error(`Unexpected url: ${url}`);
      },
      async () => {},
      () => NOW,
    );

    const report = await collector.collect({ maxPages: 5, maxJobs: 10, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.complete).toBe(false);
    expect(report.error).toMatch(/maintenance or error page/);
    expect(report.accepted).toBe(0);
  });

  it('stops immediately on 403 / 429 blocking responses during detail fetch', async () => {
    const accepted: any[] = [];
    let dUrl2Calls = 0;
    const collector = new YeloCollector(
      async (url) => {
        if (url === `${YELO_ORIGIN}/robots.txt`) return robotsTxt;
        if (url === listUrl) return listingHtml;
        if (url === dUrl1) throw new Error('Source HTTP 429');
        if (url === dUrl2) { dUrl2Calls++; return SAMPLE_DETAIL_HTML; }
        throw new Error(`Unexpected url: ${url}`);
      },
      async () => {},
      () => NOW,
    );

    const report = await collector.collect({ maxPages: 5, maxJobs: 10, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.complete).toBe(false);
    expect(report.error).toBe('Source HTTP 429');
    expect(dUrl2Calls).toBe(0);
    expect(report.accepted).toBe(0);
  });

  it('tracks expired jobs accurately in report.expired', async () => {
    const accepted: any[] = [];
    const expiredHtml = SAMPLE_DETAIL_HTML.replace('Son Tarix:</strong> 30-10-2026', 'Son Tarix:</strong> 01-10-2026');
    const collector = new YeloCollector(
      async (url) => {
        if (url === `${YELO_ORIGIN}/robots.txt`) return robotsTxt;
        if (url === listUrl) return listingHtml;
        if (url === dUrl1) return expiredHtml; // deadline 2026-10-01 < NOW 2026-10-02
        if (url === dUrl2) return SAMPLE_DETAIL_HTML; // deadline 2026-10-30 > NOW
        throw new Error(`Unexpected url: ${url}`);
      },
      async () => {},
      () => NOW,
    );

    const report = await collector.collect({ maxPages: 5, maxJobs: 10, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.complete).toBe(true);
    expect(report.accepted).toBe(2);
    expect(report.expired).toBe(1);
  });

  it('continues and reports complete=false when one detail fails to parse', async () => {
    const accepted: any[] = [];
    const collector = new YeloCollector(
      async (url) => {
        if (url === `${YELO_ORIGIN}/robots.txt`) return robotsTxt;
        if (url === listUrl) return listingHtml;
        if (url === dUrl1) return SAMPLE_DETAIL_HTML;
        if (url === dUrl2) return '<html><body>Malformed bad page</body></html>';
        throw new Error(`Unexpected url: ${url}`);
      },
      async () => {},
      () => NOW,
    );

    const report = await collector.collect({ maxPages: 5, maxJobs: 10, delayMs: 1000 }, async (j) => { accepted.push(j); });
    expect(report.discovered).toBe(2);
    expect(report.fetched).toBe(2);
    expect(report.accepted).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.error).toMatch(/could not be parsed/);
  });
});
