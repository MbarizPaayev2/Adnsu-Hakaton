import { compareSnapshots, summarize } from './report-acquisition-metrics';

const now = new Date('2026-10-16T12:00:00Z');
const since = new Date('2026-10-09T12:00:00Z');
const day = 86_400_000;
const row = (over: Record<string, unknown> = {}) => ({
  externalId: 'glorri:1', company: 'Acme', location: 'Bakı', title: 'Engineer', description: '', postedAt: new Date(now.getTime() - 2 * day),
  lastSeenAt: now, deadline: null, applicationMethod: 'EXTERNAL_SITE', applicationEmail: null, experienceLevel: null, ...over,
});
const ingested = (over: Record<string, unknown> = {}) => ({ ...row(over), status: 'ACTIVE', hiddenAt: null, duplicateOfId: null, ingestedAt: now, ...over });

describe('summarize', () => {
  it('counts employers case-insensitively, regions, e-mail and freshness', () => {
    const s = summarize([
      row(),
      row({ externalId: 'ada:2', company: ' ACME ', location: 'Gəncə', applicationMethod: 'EMAIL', applicationEmail: 'hr@acme.az', postedAt: new Date(now.getTime() - 40 * day), lastSeenAt: new Date(now.getTime() - 5 * day) }),
      row({ externalId: 'ada:3', company: 'Beta', location: 'Azerbaijan', applicationMethod: 'EMAIL', applicationEmail: null }),
    ] as never, { ingested: [], closed: [], deadlinePassed: 0, employersBefore: new Set() }, now, since, 'test');
    expect(s.actionable).toMatchObject({ postings: 3, employers: 2, emailBearing: 1, emailEmployers: 1 });
    expect(s.actionable.byRegion).toMatchObject({ 'Bakı': 1, 'Gəncə-Daşkəsən': 1, unknown: 1 });
    expect(s.actionable.bySource.ada).toEqual({ postings: 2, employers: 2, email: 1 });
    expect(s.actionable.freshness).toMatchObject({ postedWithin7d: 2, postedOlder: 1, seenWithin48h: 2, seenOlder: 1 });
  });

  it('separates new imports from duplicates, already-expired rows and closures', () => {
    const s = summarize([row({ company: 'New Co' })] as never, {
      ingested: [ingested(), ingested({ duplicateOfId: 'x' }), ingested({ deadline: new Date(now.getTime() - day) }), ingested({ applicationMethod: 'EMAIL', applicationEmail: 'cv@x.az' })] as never,
      closed: [{ closedReason: 'not_listed_by_source' }, { closedReason: 'not_listed_by_source' }, { closedReason: null }],
      deadlinePassed: 4, employersBefore: new Set(['acme']),
    }, now, since, 'test');
    expect(s.window).toEqual({ ingested: 4, ingestedActionable: 2, ingestedDuplicateLinked: 1, ingestedAlreadyExpired: 1, ingestedEmailBearing: 1, closed: 3, closedByReason: { not_listed_by_source: 2, unspecified: 1 }, deadlinePassed: 4, newEmployersActionable: 1 });
  });
});

describe('compareSnapshots', () => {
  it('reports net growth and the employers added or gone', () => {
    const before = summarize([row(), row({ company: 'Old' })] as never, { ingested: [], closed: [], deadlinePassed: 0, employersBefore: new Set() }, now, since, 'test');
    const after = summarize([row(), row({ company: 'New', location: 'Şəki' }), row({ company: 'New' })] as never, { ingested: [], closed: [], deadlinePassed: 0, employersBefore: new Set() }, now, since, 'test');
    const c = compareSnapshots(before, after);
    expect(c.postings).toEqual({ before: 2, after: 3, net: 1 });
    expect(c.employers).toMatchObject({ net: 0, added: ['New'], gone: ['Old'] });
    expect(c.regionsWithPostings).toEqual({ before: 1, after: 2 });
  });
});
