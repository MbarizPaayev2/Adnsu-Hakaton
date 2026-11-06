import fs from 'node:fs';
import path from 'node:path';
import { LocalEmployerCollector, localEmployerUrl, parseEmployerDetail, parseEmployerListing } from './local-employer.collector';
import { deriveJobFacts } from '../../jobs/job-facts';
import { classifyLocation } from '../../jobs/az-regions';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'irshad', name), 'utf8');
const at = new Date('2026-10-16T12:00:00Z');
const ROBOTS = 'User-agent: *\nCrawl-delay: 30\nSitemap: https://irshad.az/sitemap.xml\nDisallow: /?checkout_product=&id=&page=8';

describe('İrşad careers (real pages, 16 Oct 2026)', () => {
  it('lists every posting on the single unpaginated page', () => {
    expect(parseEmployerListing('irshad', fixture('list.html'))).toEqual({
      complete: true,
      urls: ['kredit-muetexessisi-5', 'magaza-meneceri', 'satis-temsilcisi', 'fehle'].map((s) => `https://irshad.az/az/sirket/vakansiyalar/${s}`),
    });
  });

  it('refuses an unrecognised or empty page instead of reporting an empty complete listing', () => {
    expect(() => parseEmployerListing('irshad', '<h1>Texniki işlər</h1>')).toThrow('Unrecognized');
    expect(() => parseEmployerListing('irshad', '<section class="career"><div class="career__item"><h3>Fəhlə</h3></div></section>')).toThrow('without a vacancy link');
  });

  it('never requests the application form or other site paths', () => {
    for (const url of ['/az/sirket/vakansiyalar/muraciet-et/fehle', '/az/sirket/vakansiyalar/muraciet-et', '/az/sebet', '/az/sirket/vakansiyalar/fehle?x=1', 'https://evil.example/az/sirket/vakansiyalar/fehle'])
      expect(() => localEmployerUrl('irshad', url)).toThrow();
  });

  it('reads title, branch towns and duties; the apply button is not part of the description', () => {
    const job = parseEmployerDetail('irshad', fixture('satis-temsilcisi.html'), 'https://irshad.az/az/sirket/vakansiyalar/satis-temsilcisi', at);
    expect(job).toMatchObject({ externalId: 'irshad:satis-temsilcisi', title: 'Satış məsləhətçisi', company: 'İrşad Electronics', location: 'Füzuli, Şərur, İmişli, Biləsuvar, Şamaxı, Bakı', rawPayload: { postedAtBasis: 'first-observed' } });
    expect(job.description).toContain('Satış üzrə minimum 1 il iş təcrübəsi');
    expect(job.description).not.toContain('Müraciət et');
    expect(job.deadline).toBeUndefined();
    expect(classifyLocation(job.location).region).toBe('Qarabağ');
    expect(deriveJobFacts(job).applicationMethod).not.toBe('EMAIL');
    const branch = parseEmployerDetail('irshad', fixture('magaza-meneceri.html'), 'https://irshad.az/az/sirket/vakansiyalar/magaza-meneceri', at);
    expect(branch.location).toBe('Qazax filialı');
    expect(classifyLocation(branch.location).region).toBe('Qazax-Tovuz');
  });

  it('rejects a page whose canonical identity is another vacancy', () => {
    expect(() => parseEmployerDetail('irshad', fixture('magaza-meneceri.html'), 'https://irshad.az/az/sirket/vakansiyalar/fehle', at)).toThrow('identity');
  });

  it('honours the 30 s crawl delay and stays on reviewed pages', async () => {
    const pages: Record<string, string> = {
      'https://irshad.az/robots.txt': ROBOTS,
      'https://irshad.az/az/sirket/vakansiyalar': fixture('list.html').replace(/<div class="col-md-6"> <div class="career__item"> <div class="career__item__content"> <h3 class="career__item__title"> (Kredit|Fəhlə).*?<\/a> <\/div> <\/div>/g, ''),
      'https://irshad.az/az/sirket/vakansiyalar/magaza-meneceri': fixture('magaza-meneceri.html'),
      'https://irshad.az/az/sirket/vakansiyalar/satis-temsilcisi': fixture('satis-temsilcisi.html'),
    };
    const read = jest.fn(async (url: string) => { if (!(url in pages)) throw new Error(`unexpected ${url}`); return pages[url]; });
    const pause = jest.fn(async () => {});
    const accepted: string[] = [];
    const report = await new LocalEmployerCollector('irshad', read, pause, () => at).collect({ maxPages: 1, maxJobs: 10, delayMs: 1500 }, async (j) => { accepted.push(j.externalId); });
    expect(report).toMatchObject({ complete: true, discovered: 2, fetched: 2, accepted: 2, failed: 0 });
    expect(accepted).toEqual(['irshad:magaza-meneceri', 'irshad:satis-temsilcisi']);
    expect(pause.mock.calls.every(([ms]) => ms === 30_000)).toBe(true);
  });
});
