import { KAPITAL_API_ORIGIN, KapitalCollector, kapitalDate, kapitalUrl, parseKapitalJob, parseKapitalList } from './kapital.collector';

const detail = (over: Record<string, unknown> = {}) => ({
  id: 8499, header: 'Kürdəmir Filialının Kassa üzrə Kiçik Mütəxəssisi', location: 'Kürdəmir filialı, ', field: 'Müştəri xidmətləri', region: 'Quba', level: 'Kiçik mütəxəssis',
  employmentOpportunity: 'Ofisdən işləmək', endDate: '2026-10-16', isPrivate: false, createdDate: '2026-10-06',
  description: '<p>Birbankın Kürdəmir filialına kassa üzrə kiçik mütəxəssis axtarılır.</p>', requirement: '<p>Ali təhsil&nbsp;</p><p>Azərbaycan dili mükəmməl səviyyədə</p>',
  liability: '<ul><li>Dövlət rüsumlarını qəbul etmək;</li><li>Ödəniş əməliyyatları aparmaq.</li></ul>', advantage: '<ul><li>Rus dili biliyi</li></ul>', roleInfo: null,
  companyDto: { id: 1, displayName: 'Birbank', logoPath: 'birbank.png' }, ...over,
});
const list = (ids: number[], total = ids.length, priv: number[] = []) => JSON.stringify({ data: ids.map((id) => ({ id, isPrivate: priv.includes(id) })), totalCount: total });
const FETCHED = new Date('2026-10-12T08:00:00Z');

describe('Kapital Bank group career site collector (fixtures, no source traffic)', () => {
  it('reads only the two public read endpoints and the robots file', () => {
    expect(kapitalUrl(`${KAPITAL_API_ORIGIN}/api/Vacancy/vacancies?Skip=0&Take=100&SortField=createdAt&OrderBy=desc`)).toContain('/api/Vacancy/vacancies');
    expect(kapitalUrl(`${KAPITAL_API_ORIGIN}/api/Vacancy/getVacancyById?id=8499`)).toContain('id=8499');
    for (const bad of [`${KAPITAL_API_ORIGIN}/api/Profile/cv`, `${KAPITAL_API_ORIGIN}/api/Vacancy/apply`, 'https://evil.example/api/Vacancy/vacancies', `${KAPITAL_API_ORIGIN}/api/Vacancy/getVacancyById?id=1&x=2`, `${KAPITAL_API_ORIGIN}/api/Vacancy/getVacancyById?id=abc`, `${KAPITAL_API_ORIGIN}/api/Vacancy/vacancies?Take=5000`]) {
      expect(() => kapitalUrl(bad)).toThrow();
    }
  });

  it('builds a posting from the detail record: own words, deadline for the whole Baku day, page link, no guessed place', () => {
    const j = parseKapitalJob(detail(), FETCHED)!;
    expect(j).toMatchObject({ externalId: 'kapital:8499', title: 'Kürdəmir Filialının Kassa üzrə Kiçik Mütəxəssisi', company: 'Birbank', url: 'https://careers.bir.az/vacancies/8499' });
    expect(j.deadline).toBe('2026-10-16T19:59:59.999Z');
    expect(j.postedAt).toBe('2026-10-05T20:00:00.000Z');
    expect(j.description).toContain('Vəzifə öhdəlikləri:\nDövlət rüsumlarını qəbul etmək;');
    expect(j.description).toContain('Tələblər:\nAli təhsil');
    // "Kürdəmir" is not in the place list: the unreliable region field ("Quba") is ignored, so the place stays country-level
    expect(j.location).toBe('Azerbaijan');
    expect(parseKapitalJob(detail({ location: 'Qusar filialı, ', header: 'Məlumat xidməti üzrə kiçik mütəxəssis/Qusar Filialı', region: 'Ağstafa' }), FETCHED)!.location).toBe('Qusar');
    expect(parseKapitalJob(detail({ location: 'PBT2   (Port Baku Tower 2), ', region: '' }), FETCHED)!.location).toBe('Bakı');
  });

  it('skips private and not-yet-public postings and refuses malformed records', () => {
    expect(parseKapitalJob(detail({ isPrivate: true }), FETCHED)).toBeNull();
    expect(parseKapitalJob(detail({ createdDate: '2026-10-13' }), FETCHED)).toBeNull();
    expect(() => parseKapitalJob(detail({ endDate: '2026-02-31' }), FETCHED)).toThrow();
    expect(() => parseKapitalJob({ id: 0 }, FETCHED)).toThrow();
    expect(() => parseKapitalList(JSON.stringify({ data: [{ id: 1 }], totalCount: -1 }))).toThrow();
    expect(kapitalDate('2026-10-16')).toBe('2026-10-15T20:00:00.000Z');
  });

  const collector = (pages: Record<string, string>) => {
    const reads: string[] = [];
    const c = new KapitalCollector(async (url) => {
      reads.push(url);
      const hit = Object.keys(pages).find((k) => url.includes(k));
      if (!hit) throw new Error('Source HTTP 404');
      return pages[hit];
    }, async () => undefined, () => FETCHED);
    return { c, reads };
  };
  const opts = { maxPages: 20, maxJobs: 300, delayMs: 1000 };

  it('a complete listing reads every posting once and reports completeness (an app-shell robots.txt is "no robots file")', async () => {
    const { c } = collector({ '/robots.txt': '<!DOCTYPE html><html></html>', 'vacancies?Skip=0': list([8499, 8605]), 'getVacancyById?id=8499': JSON.stringify(detail()), 'getVacancyById?id=8605': JSON.stringify(detail({ id: 8605, header: 'Sistemlərin idarə edilməsi üzrə Aparıcı mütəxəssis', location: '' })) });
    const out: any[] = [];
    const report = await c.collect(opts, async (j) => { out.push(j); });
    expect(report).toMatchObject({ complete: true, discovered: 2, fetched: 2, accepted: 2, failed: 0 });
    expect(out.map((j) => j.externalId)).toEqual(['kapital:8499', 'kapital:8605']);
  });

  it('is incomplete (never closes anything) when a detail fails, when the count disagrees or when the budget stops it', async () => {
    const base = { '/robots.txt': 'User-agent: *\nAllow: /', 'getVacancyById?id=2': JSON.stringify(detail({ id: 2 })) };
    const failed = await collector({ ...base, 'vacancies?Skip=0': list([1, 2]) }).c.collect(opts, async () => undefined);
    expect(failed).toMatchObject({ complete: false, failed: 1 });
    const shrunk = await collector({ ...base, 'vacancies?Skip=0': list([2], 3) }).c.collect(opts, async () => undefined);
    expect(shrunk.complete).toBe(false);
    const capped = await collector({ ...base, 'vacancies?Skip=0': list([2]) }).c.collect({ ...opts, maxJobs: 1 }, async () => undefined);
    expect(capped.complete).toBe(true); // one posting, one allowed fetch
    const cappedTwo = await collector({ ...base, 'getVacancyById?id=3': JSON.stringify(detail({ id: 3 })), 'vacancies?Skip=0': list([2, 3]) }).c.collect({ ...opts, maxJobs: 1 }, async () => undefined);
    expect(cappedTwo.complete).toBe(false);
  });

  it('honours a real robots.txt that disallows the endpoint', async () => {
    const { c } = collector({ '/robots.txt': 'User-agent: *\nDisallow: /api/' });
    const report = await c.collect(opts, async () => undefined);
    expect(report.complete).toBe(false);
    expect(report.error).toMatch(/rules prohibit/);
  });
});
