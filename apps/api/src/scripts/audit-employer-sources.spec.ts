import { ADDED_VERIFIED_EMPLOYERS, EMPLOYER_TARGETS, validateEmployerRegistry } from '../scrapers/public-jobs/employer-registry';
import { COLLECTOR_KEYS } from '../scrapers/public-jobs/collector-registry';
import { auditEmployer, careerCandidates, publicCandidate, runEmployerAudit } from './audit-employer-sources';

/** The 100 companies originally requested. Frozen: none may be removed, renamed away or replaced. */
const ORIGINAL_REQUESTED_IDS: readonly string[] = [
  'socar', 'socar-polymer', 'socar-aqs', 'socar-downstream', 'bp-azerbaijan', 'totalenergies', 'slb', 'halliburton', 'baker-hughes', 'weatherford',
  'saipem', 'nobel-energy', 'azfen', 'technip-energies', 'azergold', 'azeraluminium', 'holcim-azerbaijan', 'norm', 'stp', 'baku-steel-company',
  'pasha-holding', 'pasha-bank', 'pasha-insurance', 'pasha-life', 'kapital-bank', 'abb', 'xalq-bank', 'bank-of-baku', 'bank-respublika', 'unibank',
  'accessbank', 'yelo-bank', 'rabitabank', 'turanbank', 'expressbank', 'azer-turk-bank', 'bank-avrasiya', 'afb-bank', 'premium-bank', 'asb-bank',
  'atasigorta', 'ateshgah-insurance', 'azercell', 'bakcell', 'nar-azerfon', 'azerconnect', 'azintelecom', 'aztelekom', 'delta-telecom',
  'enginet-citynet', 'pashapay', 'azericard', 'goldenpay', 'sinam', 'deloitte', 'ey', 'pwc', 'kpmg', 'mckinsey', 'bcg', 'bain', 'grant-thornton',
  'bdo', 'azal', 'asg-aviation', 'azerbaijan-railways-ady', 'asco', 'port-of-baku', 'silk-way-airlines', 'silk-way-west-airlines', 'bravo',
  'araz-supermarket', 'oba-market', 'bazarstore', 'kontakt', 'baku-electronics', 'irshad', 'soliton', 'veyseloglu', 'azersun', 'coca-cola-cci',
  'carlsberg-azerbaijan', 'a-co', 'nestle', 'procter-gamble', 'jti', 'british-american-tobacco', 'pmd-group', 'pasha-construction',
  'pasha-real-estate', 'gilan-holding', 'ag-group', 'cahan-holding', 'agro-dairy', 'grand-agro', 'four-seasons-baku', 'fairmont-baku', 'hilton-baku',
  'marriott-baku', 'pasha-capital',
];
/** Adapters (reviewed collectors) the original 100 had. Each later addition with a collector raises the total by one, declared in ADDED_VERIFIED_EMPLOYERS. */
// 11 verified on 1-11 October; İrşad (local employer page) and Baker Hughes (Workday) verified 16 October; Fairmont Baku (Accor careers, Baku facet)
// and STP (stpcareer.com) verified 16 October from links on fairmont.com and stp.az; Norm (norm.az careers), Kapital Bank / Bir (careers.bir.az), and SupportYourApp verified 26 October; Bravo (bravosupermarket.az) verified 27 October.
const ORIGINAL_ADAPTERS = 19;

describe('employer coverage register (the original 100 plus declared, verified additions) and safe discovery', () => {
  it('keeps all 100 originally requested employers, with unique identities, and no implied complete coverage', () => {
    validateEmployerRegistry();
    expect(ORIGINAL_REQUESTED_IDS).toHaveLength(100);
    expect(new Set(ORIGINAL_REQUESTED_IDS).size).toBe(100);
    const ids = EMPLOYER_TARGETS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length); // ids unique
    expect(new Set(EMPLOYER_TARGETS.map((e) => e.name.toLowerCase())).size).toBe(ids.length); // names unique
    for (const id of ORIGINAL_REQUESTED_IDS) expect(ids).toContain(id); // none removed or replaced
    for (const name of ['SOCAR', 'Azercell', 'PASHA Holding', 'Deloitte', 'EY', 'PwC', 'KPMG', 'McKinsey', 'BCG', 'Bain']) expect(EMPLOYER_TARGETS.some((e) => e.name === name)).toBe(true);
  });
  it('lets the list grow only by declared, verified additions', () => {
    const original = new Set(ORIGINAL_REQUESTED_IDS);
    const added = EMPLOYER_TARGETS.filter((e) => !original.has(e.id));
    expect(added.map((e) => e.id).sort()).toEqual([...ADDED_VERIFIED_EMPLOYERS].sort()); // nothing slips in undeclared, nothing declared is missing
    expect(EMPLOYER_TARGETS).toHaveLength(ORIGINAL_REQUESTED_IDS.length + ADDED_VERIFIED_EMPLOYERS.length);
    for (const e of added) {
      expect(e.evidence).toBe('official-career-link-checked'); // an addition has a checked official career source
      expect(e.careerUrl).toMatch(/^https:\/\//);
      expect(e.adapter).toBeTruthy();
      expect(COLLECTOR_KEYS).toContain(e.id); // owned by a reviewed collector under its own key
    }
  });
  it('counts the reviewed adapters: the original verified adapters plus those of the declared additions, each backed by a collector', () => {
    const withAdapter = EMPLOYER_TARGETS.filter((e) => e.adapter);
    const addedWithAdapter = withAdapter.filter((e) => ADDED_VERIFIED_EMPLOYERS.includes(e.id));
    expect(withAdapter).toHaveLength(ORIGINAL_ADAPTERS + addedWithAdapter.length);
    for (const e of withAdapter) expect(e.evidence).toBe('official-career-link-checked');
  });
  it('rejects repeated IDs and nonpublic candidate addresses', () => {
    expect(() => validateEmployerRegistry([EMPLOYER_TARGETS[0], EMPLOYER_TARGETS[0]])).toThrow();
    expect(() => validateEmployerRegistry([{ ...EMPLOYER_TARGETS[0], websiteCandidate: 'http://127.0.0.1' }])).toThrow();
  });
  it('discovers public career links without contacting account or submission endpoints', () => {
    expect(careerCandidates('<a href="/az/career/">Karyera</a><a href="/career/apply/123">Apply</a><a href="/career/login">Sign in</a><a href="https://jobs.example.com/search/?session=private">Jobs</a>', 'https://example.com')).toEqual(['https://example.com/az/career/', 'https://jobs.example.com/search/']);
    expect(publicCandidate('https://user:secret@example.com/jobs', 'https://example.com')).toBeNull();
    expect(publicCandidate('https://127.0.0.1/jobs', 'https://example.com')).toBeNull();
  });
  it('never equates HTTP 200 with a validated collector or vacancy count', async () => {
    jest.useFakeTimers();
    const request = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } }))
      .mockResolvedValueOnce(new Response('<title>Company Careers</title><a href="/career">Careers</a>', { headers: { 'content-type': 'text/html' } }));
    try {
      const task = auditEmployer(EMPLOYER_TARGETS[0]); await jest.advanceTimersByTimeAsync(1600);
      expect(await task).toMatchObject({ status: 'public-page-reachable', coverage: 'not-verified', rules: 'allowed' });
      expect(request).toHaveBeenCalledTimes(2);
    } finally { request.mockRestore(); jest.useRealTimers(); }
  });
  it('does not access disallowed or unrecognized robot responses', async () => {
    const request = jest.spyOn(global, 'fetch');
    try {
      for (const text of ['User-agent: *\nDisallow: /', '<html>challenge</html>']) {
        request.mockResolvedValueOnce(new Response(text, { headers: { 'content-type': 'text/plain' } }));
        expect(await auditEmployer(EMPLOYER_TARGETS[0])).toMatchObject({ status: 'access-needs-review' });
      }
      expect(request).toHaveBeenCalledTimes(2);
    } finally { request.mockRestore(); }
  });
  it('does not follow an unreviewed redirect to another host', async () => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'https://unreviewed.example/robots.txt' } }));
    try { expect(await auditEmployer(EMPLOYER_TARGETS[0])).toMatchObject({ status: 'access-needs-review' }); expect(request).toHaveBeenCalledTimes(1); }
    finally { request.mockRestore(); }
  });
  it('bounds concurrency and leaves imports out of the audit contract', async () => {
    await expect(runEmployerAudit([], 20)).rejects.toThrow('1–4');
    expect(await runEmployerAudit([], 1)).toEqual([]);
  });
});
