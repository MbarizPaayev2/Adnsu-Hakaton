import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KpmgCcaCollector, parseKpmgCcaDetail, parseKpmgCcaListing } from './kpmg-cca.collector';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures/kpmg-cca', name), 'utf8');

describe('KPMG CCA collector outcome', () => {
  it('labels a useful initial snapshot as bounded progress, without implying a complete census', async () => {
    const listing = fixture('listing.html');
    const detail = fixture('detail.html');
    const read = jest.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return fixture('robots.txt');
      if (url === 'https://kpmgcca.global.huntflow.io/') return listing;
      const title = url.endsWith('/audit-intern') ? 'Audit Intern' : 'Accounting Specialist / Junior Accounting Specialist';
      return detail.replace('href="https://kpmgcca.global.huntflow.io/vacancy/accounting-specialist"', `href="${url}"`).replace('<h1>Accounting Specialist / Junior Accounting Specialist</h1>', `<h1>${title}</h1>`);
    });
    const accept = jest.fn(async () => undefined);
    const report = await new KpmgCcaCollector(read, async () => undefined, () => new Date('2026-10-27T08:00:00Z')).collect(
      { maxPages: 12, maxJobs: 200, delayMs: 1500 }, accept,
    );
    const firstEntry = parseKpmgCcaListing(listing).entries[0];
    expect(parseKpmgCcaDetail(detail, firstEntry, new Date('2026-10-27T08:00:00Z'))).not.toBeNull();

    expect(read.mock.calls[0][0]).toContain('/robots.txt');
    expect(report.discovered).toBe(2); // the regional Almaty job is excluded
    expect(report.accepted).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.complete).toBe(false);
    expect(report.outcome).toBe('BOUNDED_PROGRESS');
    expect(report.error).toMatch(/Initial KPMG CCA snapshot only/);
  });

  it('classifies a transport failure as upstream failure, even after listing data was read', async () => {
    let detailReads = 0;
    const read = async (url: string) => {
      if (url.endsWith('/robots.txt')) return fixture('robots.txt');
      if (url === 'https://kpmgcca.global.huntflow.io/') return fixture('listing.html');
      detailReads++;
      throw new Error('Source HTTP 503');
    };
    const report = await new KpmgCcaCollector(read, async () => undefined).collect(
      { maxPages: 12, maxJobs: 200, delayMs: 1500 }, async () => undefined,
    );

    expect(detailReads).toBeGreaterThan(0);
    expect(report.failed).toBe(2);
    expect(report.outcome).toBe('UPSTREAM_FAILURE');
    expect(report.accepted).toBe(0);
  });
});
