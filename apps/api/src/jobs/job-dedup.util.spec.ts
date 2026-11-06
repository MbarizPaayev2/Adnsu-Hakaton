import { canonicalizeUrl, compareJobs, descriptionSimilarity, normalizeCompany, normalizeLocation, normalizeTitle, sourceOf, type DedupJob } from './job-dedup.util';

const TEXT =
  'Şirkətin mühasibat uçotuna rəhbərlik etmək vergi hesabatlarını hazırlamaq ilkin sənədləri yoxlamaq əmək haqqı hesablanması 1C proqramında işləmək maliyyə hesabatlarını təqdim etmək və komanda ilə əlaqə saxlamaq';

const job = (over: Partial<DedupJob> = {}): DedupJob => ({
  externalId: 'glorri:a',
  title: 'Baş mühasib',
  company: 'Nur Holding MMC',
  location: 'Bakı, Azərbaycan',
  description: TEXT,
  url: 'https://jobs.glorri.com/vacancies/nur/a?isLocal=true',
  postedAt: new Date('2026-09-10'),
  ...over,
});

describe('canonicalizeUrl', () => {
  it('normalises scheme, host case, www, fragment, tracking parameters and trailing slash', () => {
    const a = canonicalizeUrl('HTTP://WWW.Example.com/careers/42/?utm_source=x&b=2&a=1#apply');
    expect(a).toBe('https://example.com/careers/42?a=1&b=2');
    expect(canonicalizeUrl('https://example.com/careers/42?a=1&b=2&fbclid=zzz')).toBe(a);
  });

  it('keeps parameters that identify the posting', () => {
    expect(canonicalizeUrl('https://x.az/vacancy?id=10')).not.toBe(canonicalizeUrl('https://x.az/vacancy?id=11'));
  });

  it('names no posting for a bare domain or a non-web URL', () => {
    expect(canonicalizeUrl('https://example.com')).toBeNull();
    expect(canonicalizeUrl('https://example.com/')).toBeNull();
    expect(canonicalizeUrl('mailto:hr@example.com')).toBeNull();
    expect(canonicalizeUrl('')).toBeNull();
    expect(canonicalizeUrl(null)).toBeNull();
  });
});

describe('normalisation', () => {
  it('folds legal suffixes, case and punctuation in company names', () => {
    expect(normalizeCompany('Nur Holding MMC')).toBe(normalizeCompany('NUR HOLDING'));
    expect(normalizeCompany('Kapital Bank ASC')).toBe('kapital bank');
  });

  it('folds Azerbaijani letters in titles', () => {
    expect(normalizeTitle('Baş Mühasib (Tam ştat)')).toBe(normalizeTitle('bas muhasib tam stat'));
  });

  it('treats unknown and employment-type locations as no location, and drops the country', () => {
    expect(normalizeLocation('Tam ştat')).toBeNull();
    expect(normalizeLocation('')).toBeNull();
    expect(normalizeLocation('Bakı, Azərbaycan')).toBe(normalizeLocation('Baki, Azerbaijan'));
  });

  it('reads the source from the external id', () => {
    expect(sourceOf('glorri:abc')).toBe('glorri');
    expect(sourceOf('hellojob:12:x')).toBe('hellojob');
  });
});

describe('descriptionSimilarity', () => {
  it('is 1 for identical text and low for different text', () => {
    expect(descriptionSimilarity(TEXT, TEXT)).toBe(1);
    expect(descriptionSimilarity(TEXT, 'Mağazada müştərilərə məhsulları təqdim etmək satış aparmaq aylıq hədəfləri yerinə yetirmək müştəri suallarına cavab vermək və kassa ilə işləmək')).toBeLessThan(0.1);
  });

  it('gives no evidence from text too short to judge', () => {
    expect(descriptionSimilarity('Looking for a sales manager.', 'Looking for a sales manager.')).toBe(0);
  });
});

describe('compareJobs', () => {
  const other = (over: Partial<DedupJob> = {}) => job({ externalId: 'hellojob:99', url: 'https://hellojob.az/vacancy/99', ...over });

  it('links the same posting seen on another source', () => {
    const verdict = compareJobs(other(), job());
    expect(verdict).toMatchObject({ kind: 'same_posting', autoLink: true });
  });

  it('links a posting that points at the same destination URL and agrees on company and title', () => {
    const verdict = compareJobs(other({ url: 'https://nur.az/careers/chief-accountant?utm_source=hj', description: 'short' }), job({ url: 'https://www.nur.az/careers/chief-accountant/' }));
    expect(verdict).toMatchObject({ kind: 'same_destination', autoLink: true });
  });

  it('does NOT link two different postings that share a generic careers page', () => {
    const verdict = compareJobs(
      other({ title: 'Satış meneceri', description: 'Başqa vəzifə üçün tam fərqli təsvir mətni burada yazılıb və digər sözlərdən ibarətdir ki, oxşarlıq olmasın', url: 'https://nur.az/careers' }),
      job({ url: 'https://nur.az/careers' }),
    );
    expect(verdict).toBeNull();
  });

  it('does NOT link when the company differs, even with identical text', () => {
    expect(compareJobs(other({ company: 'Başqa Şirkət' }), job())).toBeNull();
  });

  it('does NOT link distinct openings at different addresses or cities', () => {
    expect(compareJobs(other({ location: 'Gəncə, Azərbaycan' }), job())).toBeNull();
    expect(compareJobs(other({ location: 'Port Baku Towers, Bakı' }), job({ location: '55 Rəşid Behbudov küçəsi, Bakı' }))).toBeNull();
  });

  it('does NOT link when either location is unknown', () => {
    expect(compareJobs(other({ location: 'Tam ştat' }), job({ location: 'Tam ştat' }))).toBeNull();
    expect(compareJobs(other({ location: '' }), job())).toBeNull();
  });

  it('does NOT link when the title differs', () => {
    expect(compareJobs(other({ title: 'Mühasib' }), job())).toBeNull();
  });

  it('does NOT link postings far apart in time (a new season\'s opening)', () => {
    expect(compareJobs(other({ postedAt: new Date('2026-01-01') }), job())).toBeNull();
  });

  it('does NOT link on thin text alone', () => {
    expect(compareJobs(other({ description: 'Looking for an accountant.' }), job({ description: 'Looking for an accountant.' }))).toBeNull();
  });

  it('never auto-links two postings of the same source, only reports a possible repost', () => {
    const verdict = compareJobs(job({ externalId: 'glorri:b' }), job());
    expect(verdict).toMatchObject({ kind: 'possible_repost_same_source', autoLink: false });
    expect(compareJobs(job({ externalId: 'glorri:b', description: TEXT + ' Əlavə məlumat: ofisdə iş qrafiki tam ştat və rəsmi əmək müqaviləsi ilə təmin olunur.' }), job())?.autoLink ?? false).toBe(false);
  });

  it('is null for the same external id', () => {
    expect(compareJobs(job(), job())).toBeNull();
  });

  describe('a source that states no city', () => {
    const text = 'Bankın korporativ müştəriləri ilə işləmək kredit təhlili aparmaq hesabatlar hazırlamaq müştəri görüşləri keçirmək risklərin qiymətləndirilməsi və komandada əməkdaşlıq etmək üçün yüksək təhsilli mütəxəssis axtarılır.';
    const base = { title: 'Xəzinə bölməsi üzrə kiçik mütəxəssis', company: 'ABB', description: text, url: 'https://a.example/1', postedAt: new Date('2026-09-06T00:00:00Z') };
    const abb = { ...base, externalId: 'abb:1', location: 'Azerbaijan' };
    const hello = { ...base, externalId: 'hellojob:x', url: 'https://b.example/9', location: 'Bakı', postedAt: new Date('2026-09-07T00:00:00Z') };
    it('links essentially identical text published within days across sources', () => {
      expect(compareJobs(hello, abb)).toMatchObject({ kind: 'same_posting_location_unspecified', autoLink: true });
    });
    it.each([
      ['a different title', { title: 'Xəzinə bölməsi üzrə aparıcı mütəxəssis' }],
      ['published weeks apart', { postedAt: new Date('2026-10-20T00:00:00Z') }],
      ['text that only resembles it', { description: text.replace('korporativ müştəriləri', 'fərdi müştəriləri').replace('kredit təhlili', 'sığorta təhlili').replace('hesabatlar hazırlamaq', 'sənədlər hazırlamaq') }],
      ['the same source', { externalId: 'abb:2' }],
    ])('does not link %s', (_n, change) => {
      expect(compareJobs({ ...hello, ...change }, abb)).toBeNull();
    });
    it('never links two different specific cities, however alike the text', () => {
      expect(compareJobs({ ...hello, location: 'Gəncə' }, { ...abb, location: 'Bakı' })).toBeNull();
    });
  });
});

describe('postings from the eJob and JobSearch collectors (country-only location for JobSearch)', () => {
  const ejob = job({ externalId: 'ejob:1', location: 'Bakı', url: 'https://ejob.az/is-elani/1-x/', postedAt: new Date('2026-10-02T20:00:00Z') });
  const jobsearch = (over: Partial<DedupJob> = {}) => job({ externalId: 'jobsearch:2', location: 'Azerbaijan', url: 'https://classic.jobsearch.az/vacancies/x-2', postedAt: new Date('2026-10-02T20:00:00Z'), ...over });

  it('links an essentially identical posting that states no city, published the same day (evidence recorded by the caller)', () => {
    expect(compareJobs(jobsearch(), ejob)?.kind).toBe('same_posting_location_unspecified');
  });
  it('keeps same company and title apart when the text differs, the day differs, or the cities differ', () => {
    expect(compareJobs(jobsearch({ description: 'Tamamilə fərqli iş təsviri: satış, müştərilərlə görüş və hesabat.' }), ejob)).toBeNull();
    expect(compareJobs(jobsearch({ postedAt: new Date('2026-09-01T00:00:00Z') }), ejob)).toBeNull();
    expect(compareJobs(jobsearch({ location: 'Gəncə' }), ejob)).toBeNull();
  });
  it('never links on an e-mail or title alone: a different requisition at the same employer stays separate', () => {
    expect(compareJobs(jobsearch({ title: 'Baş mühasib köməkçisi' }), ejob)).toBeNull();
  });
});
