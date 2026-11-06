import { EMPLOYER_TARGETS } from './employer-registry';
import { collectorTenants, detectAtsLinks, officialPageLinksToTenant } from './ats-tenants';
import { COLLECTOR_KEYS } from './collector-registry';

const page = (hrefs: string[]) => `<html><body>${hrefs.map((h) => `<a href="${h}">x</a>`).join('')}</body></html>`;

describe('collectorTenants — every tenant a collector exists for is vouched for by an official employer entry', () => {
  const tenants = collectorTenants();
  it('covers every ATS-backed collector key', () => {
    const atsKeys = COLLECTOR_KEYS.filter((k) => !['hellojob', 'abb', 'pwc', 'kpmg-cca', 'smartjob', 'boss', 'work', 'ejob', 'jobsearch', 'hrin', 'linkedin', 'yelo', 'kapital', 'banker', 'ada', 'khazar', 'norm', 'avrora', 'azergold', 'veyseloglu', 'irshad', 'fairmont-baku', 'stp', 'bravo'].includes(k));
    expect(tenants.map((t) => t.source).sort()).toEqual([...atsKeys].sort());
  });

  it.each(collectorTenants().map((t) => [t.source, t] as const))('%s has an official-career-link-checked employer entry whose career page is on the tenant', (_k, t) => {
    expect(t.employerId).toBe(t.source);
    const employer = EMPLOYER_TARGETS.find((e) => e.id === t.employerId)!;
    expect(employer.evidence).toBe('official-career-link-checked');
    expect(employer.adapter).toBe(t.vendor === 'sap-successfactors' ? 'sap-careers' : t.vendor);
    expect(new URL(employer.careerUrl!).hostname).toBe(new URL(t.entryUrl).hostname);
    if (t.vendor !== 'sap-successfactors') {
      expect(t.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.evidence).toMatch(/Official site https?:\/\//i);
    }
  });

  it('keeps quarantined candidates out of the collector set', () => {
    const quarantined = EMPLOYER_TARGETS.filter((e) => /quarantined|needs-direct-employer-ats-verification/.test(e.evidence)).map((e) => e.id);
    expect(quarantined.length).toBeGreaterThan(0);
    for (const id of quarantined) expect(tenants.some((t) => t.source === id)).toBe(false);
  });
});

describe('detectAtsLinks', () => {
  it('recognises vendors and tenants in links on an official page, and says whether a collector exists', () => {
    const links = detectAtsLinks(page([
      'https://apply.workable.com/pasha-holding/j/BDD973568D', 'https://career.example.az/jobs', 'https://acme.teamtailor.com/jobs',
      'https://boards.greenhouse.io/acme/jobs/1', 'https://jobs.lever.co/acme', 'https://acme.recruitee.com/o/x', 'https://jobs.smartrecruiters.com/AcmeInc/1',
      'https://acme.bamboohr.com/careers', 'https://acme.wd3.myworkdayjobs.com/en-US/Careers', '/relative', 'mailto:hr@x.az', 'http://apply.workable.com/insecure/', 'https://user:pw@apply.workable.com/cred/',
    ]), 'https://employer.example/careers');
    expect(links.map((l) => `${l.vendor}:${l.tenant}`)).toEqual([
      'workable:pasha-holding', 'teamtailor:acme.teamtailor.com', 'greenhouse:acme', 'lever:acme', 'recruitee:acme', 'smartrecruiters:AcmeInc', 'bamboohr:acme', 'workday:acme.wd3.myworkdayjobs.com',
    ]);
    expect(links.find((l) => l.vendor === 'workable')).toMatchObject({ collector: true, url: 'https://apply.workable.com/pasha-holding/j/BDD973568D' });
    expect(links.find((l) => l.vendor === 'greenhouse')).toMatchObject({ collector: true });
    expect(links.find((l) => l.vendor === 'recruitee')).toMatchObject({ collector: false });
  });
});

describe('officialPageLinksToTenant — the same vendor is not the same employer', () => {
  const official = page(['https://apply.workable.com/pasha-holding/j/ABC', 'https://career.pasha-insurance.az/jobs']);
  it('requires the same tenant, not just the same vendor', () => {
    expect(officialPageLinksToTenant(official, 'https://pasha-holding.az/career', 'https://apply.workable.com/pasha-holding/')).toBe(true);
    // The AccessBank mistake: a Workable tenant that exists but is another company's.
    expect(officialPageLinksToTenant(official, 'https://pasha-holding.az/career', 'https://apply.workable.com/accessbank/')).toBe(false);
  });
  it('accepts an employer-hosted career domain only when the host is exactly the tenant host', () => {
    expect(officialPageLinksToTenant(official, 'https://pasha-insurance.az', 'https://career.pasha-insurance.az/jobs')).toBe(true);
    expect(officialPageLinksToTenant(official, 'https://pasha-insurance.az', 'https://career.pasha-insurance.com/jobs')).toBe(false);
    expect(officialPageLinksToTenant(page(['https://evil.example/?next=https://career.pasha-insurance.az/jobs']), 'https://x.az', 'https://career.pasha-insurance.az/jobs')).toBe(false);
  });
});
