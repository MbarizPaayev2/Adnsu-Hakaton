import type { CareerEntry } from '@prisma/client';
import { fullCareerSections, leftOutEntries, selectCareerSections } from './career-selection';

const entry = (over: Partial<CareerEntry>): CareerEntry => ({
  id: 'e', userId: 'u', kind: 'PROJECT', status: 'CONFIRMED', origin: 'USER_ADDED', title: '', organization: null, role: null, startDate: null, endDate: null, current: false,
  issuedAt: null, datePrecision: 'YEAR', level: null, description: null, result: null, situation: null, action: null, url: null, alwaysInclude: false, sortOrder: 0,
  sourceEvidence: null, confirmedAt: new Date(), editedAt: null, createdAt: new Date(), updatedAt: new Date(), ...over,
} as CareerEntry);

describe('career master versus the concise resume', () => {
  const entries = [
    entry({ id: 'p1', title: 'Hesabat paneli', description: 'PostgreSQL hesabatları', startDate: new Date('2023-01-01') }),
    entry({ id: 'p2', title: 'Foto qalereya', description: 'Şəkil saytı', startDate: new Date('2021-01-01') }),
    entry({ id: 'p3', title: 'Oyun prototipi', description: 'Unity oyunu', startDate: new Date('2019-01-01') }),
    entry({ id: 'c1', kind: 'CERTIFICATION', title: 'PostgreSQL Professional', organization: 'Org', issuedAt: new Date('2022-01-01') }),
    entry({ id: 'c2', kind: 'CERTIFICATION', title: 'Fotoqrafiya kursu', organization: 'Org', issuedAt: new Date('2020-01-01') }),
    entry({ id: 'l1', kind: 'LANGUAGE', title: 'English', level: 'B2' }),
    entry({ id: 'h1', status: 'HIDDEN', title: 'Gizlədilib' }),
    entry({ id: 's0', status: 'SUGGESTED', title: 'Təsdiqlənməyib' }),
    entry({ id: 'st', kind: 'STORY', title: 'Hesabat sürəti', situation: 'a', action: 'b', result: 'c' }),
  ];
  const ids = (s: ReturnType<typeof fullCareerSections>) => [...s.projects, ...s.certifications, ...s.languages, ...s.activities, ...s.awards].map((x) => x.entryId).sort();

  it('the master holds every confirmed entry and nothing else', () => {
    const full = fullCareerSections(entries);
    expect(ids(full)).toEqual(['c1', 'c2', 'l1', 'p1', 'p2', 'p3']);
    expect(full.stories.map((x) => x.entryId)).toEqual(['st']);
  });

  it('the concise resume is a relevant subset of the master, chosen by the vacancy; the full CV keeps all projects and certificates', () => {
    const jobText = 'Backend developer, PostgreSQL hesabatları və sertifikat';
    const resume = selectCareerSections(entries, { format: 'resume', experienceMonths: 60, jobText });
    expect(resume.projects.map((p) => p.entryId)).toEqual(['p1']);
    expect(resume.certifications.map((c) => c.entryId)).toEqual(['c1']);
    expect(resume.languages.map((l) => l.entryId)).toEqual(['l1']);
    const cv = selectCareerSections(entries, { format: 'cv', experienceMonths: 60, jobText });
    expect(cv.projects.map((p) => p.entryId).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(cv.certifications.map((c) => c.entryId).sort()).toEqual(['c1', 'c2']);
    // Every selected item exists in the master (selection never invents or edits), and unconfirmed, hidden and story entries never reach a document.
    const master = new Set(ids(fullCareerSections(entries)));
    for (const doc of [resume, cv]) {
      ids(doc).forEach((id) => expect(master.has(id)).toBe(true));
      expect(ids(doc)).not.toEqual(expect.arrayContaining(['h1']));
      expect(ids(doc)).not.toEqual(expect.arrayContaining(['s0']));
      expect(doc.stories).toEqual([]);
    }
  });

  it('a resume keeps at most two projects and the selection leaves the master untouched', () => {
    const many = Array.from({ length: 6 }, (_, i) => entry({ id: `m${i}`, title: `PostgreSQL layihə ${i}`, description: 'PostgreSQL', startDate: new Date(`20${10 + i}-01-01`) }));
    const before = JSON.stringify(many);
    expect(selectCareerSections(many, { format: 'resume', experienceMonths: 60, jobText: 'PostgreSQL' }).projects).toHaveLength(2);
    expect(fullCareerSections(many).projects).toHaveLength(6);
    expect(JSON.stringify(many)).toBe(before);
  });
});

describe('leftOutEntries (nothing relevant disappears silently)', () => {
  it('names confirmed entries a resume left out, never stories, hidden or unconfirmed ones', () => {
    const entries = [
      entry({ id: 'p1', kind: 'PROJECT', title: 'Panel', description: 'Excel hesabat paneli' }),
      entry({ id: 'p2', kind: 'PROJECT', title: 'Oyun', description: 'sadə oyun' }),
      entry({ id: 'p3', kind: 'PROJECT', title: 'Foto', description: 'foto qalereya' }),
      entry({ id: 's1', kind: 'STORY', title: 'Hekayə' }),
      entry({ id: 'o1', kind: 'OTHER', title: 'Əlavə qeyd' }),
      entry({ id: 'x1', kind: 'AWARD', title: 'Gizli', status: 'SUGGESTED' }),
    ];
    const sections = selectCareerSections(entries, { format: 'resume', experienceMonths: 60, jobText: 'Excel hesabat' });
    const gone = leftOutEntries(entries, sections);
    expect(sections.projects.map((p) => p.name)).toEqual(['Panel']);
    expect(gone.map((g) => g.title).sort()).toEqual(['Foto', 'Oyun']);
    expect(gone.some((g) => g.kind === 'STORY' || g.kind === 'OTHER')).toBe(false);
    expect(leftOutEntries(entries, selectCareerSections(entries, { format: 'cv', experienceMonths: 60, jobText: '' }))).toEqual([]);
  });
});


describe('explicit candidate career selection', () => {
  const entries = [entry({ id: 'project', title: 'SQL panel', description: 'SQL hesabat' }),
    entry({ id: 'award', kind: 'AWARD', title: 'Community award' }),
    entry({ id: 'hidden', status: 'HIDDEN', title: 'Hidden' }),
    entry({ id: 'language', kind: 'LANGUAGE', title: 'English' })];
  it('honours inclusion outside default relevance and intentional empty selection without removing languages', () => {
    const opts = { format: 'resume' as const, experienceMonths: 120, jobText: 'SQL' };
    const selected = selectCareerSections(entries, { ...opts, selectedCareerEntryIds: ['award', 'hidden', 'foreign'] });
    expect(selected.projects).toEqual([]);
    expect(selected.awards.map((e) => e.entryId)).toEqual(['award']);
    expect(selected.languages.map((e) => e.entryId)).toEqual(['language']);
    const empty = selectCareerSections(entries, { ...opts, selectedCareerEntryIds: [] });
    expect(empty.projects).toEqual([]);
    expect(empty.awards).toEqual([]);
    expect(empty.languages).toHaveLength(1);
  });
});
