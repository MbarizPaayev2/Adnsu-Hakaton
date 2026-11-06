import { CareerEntriesService } from './career-entries.service';

/** Re-extraction from an uploaded CV must never lose, change or duplicate what the candidate already confirmed. */
describe('CareerEntriesService.addSuggestionsFromUpload keeps the career master', () => {
  const suggestion = (over: Record<string, unknown>) => ({
    kind: 'PROJECT', title: 'Kredit risk paneli', organization: 'Universitet', role: null, startDate: null, endDate: null, current: false, issuedAt: null,
    level: null, description: 'Power BI ilə panel', precision: 'YEAR', evidence: 'Kredit risk paneli | Universitet layihəsi 2022', ...over,
  });
  const existing = (over: Record<string, unknown>) => ({ kind: 'PROJECT', title: 'Kredit risk paneli', organization: 'Universitet', sourceEvidence: { excerpt: 'Kredit risk paneli | Universitet layihəsi 2022' }, ...over });

  function setup(rows: Record<string, unknown>[]) {
    const careerEntry = { findMany: jest.fn().mockResolvedValue(rows), create: jest.fn().mockResolvedValue({}), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() };
    return { careerEntry, service: new CareerEntriesService({ careerEntry } as any) };
  }
  const neverTouched = (c: ReturnType<typeof setup>['careerEntry']) => { expect(c.update).not.toHaveBeenCalled(); expect(c.updateMany).not.toHaveBeenCalled(); expect(c.delete).not.toHaveBeenCalled(); expect(c.deleteMany).not.toHaveBeenCalled(); };

  it('an extraction that finds the same entry again creates nothing and touches nothing', async () => {
    const { careerEntry, service } = setup([existing({})]);
    expect(await service.addSuggestionsFromUpload('u1', [suggestion({})] as any, 'r1')).toEqual({ created: 0, skipped: 1, limited: 0 });
    expect(careerEntry.create).not.toHaveBeenCalled();
    neverTouched(careerEntry);
  });

  it('a candidate-corrected (retitled) entry is not suggested again from the same lines', async () => {
    const { careerEntry, service } = setup([existing({ title: 'Kredit risk paneli v2' })]);
    expect((await service.addSuggestionsFromUpload('u1', [suggestion({})] as any, 'r1')).created).toBe(0);
    neverTouched(careerEntry);
  });

  it('an extraction that finds FEWER entries removes none of the existing ones', async () => {
    const { careerEntry, service } = setup([existing({}), existing({ kind: 'CERTIFICATION', title: 'Google Data Analytics', organization: 'Coursera', sourceEvidence: { excerpt: 'Google Data Analytics – Coursera 2022' } })]);
    await service.addSuggestionsFromUpload('u1', [suggestion({ title: 'Başqa layihə', evidence: 'Başqa layihə 2023' })] as any, 'r2');
    expect(careerEntry.create).toHaveBeenCalledTimes(1);
    neverTouched(careerEntry);
  });

  it('only genuinely new entries are added, as unconfirmed suggestions', async () => {
    const { careerEntry, service } = setup([existing({})]);
    const out = await service.addSuggestionsFromUpload('u1', [suggestion({}), suggestion({ title: 'Yeni layihə', evidence: 'Yeni layihə 2024' })] as any, 'r3');
    expect(out).toEqual({ created: 1, skipped: 1, limited: 0 });
    expect(careerEntry.create.mock.calls[0][0].data).toMatchObject({ title: 'Yeni layihə', status: 'SUGGESTED', origin: 'EXTRACTED' });
  });

  it('a large extraction stays within the entry limit without disturbing existing entries', async () => {
    const rows = Array.from({ length: 149 }, (_, i) => existing({ title: `Qeyd ${i}`, sourceEvidence: { excerpt: `e${i}` } }));
    const { careerEntry, service } = setup(rows);
    const out = await service.addSuggestionsFromUpload('u1', Array.from({ length: 10 }, (_, i) => suggestion({ title: `Yeni ${i}`, evidence: `yeni ${i}` })) as any, 'r4');
    expect(out).toEqual({ created: 1, skipped: 0, limited: 9 }); // nine new ones did not fit: reported, not silently dropped
    neverTouched(careerEntry);
  });

  it('refreshes only untouched old-parser suggestions from the same CV and hides wrapped-line fragments', async () => {
    const source = { resumeId: 'r1', parserVersion: 1, excerpt: 'Kredit risk paneli\n• Power BI ilə panel\nhazırladım.' };
    const head = existing({ id: 'head', status: 'SUGGESTED', origin: 'EXTRACTED', editedAt: null, sourceEvidence: source });
    const fragment = existing({ id: 'fragment', title: 'hazırladım.', status: 'SUGGESTED', origin: 'EXTRACTED', editedAt: null, sourceEvidence: source });
    const protectedRows = [
      existing({ id: 'confirmed', status: 'CONFIRMED', origin: 'EXTRACTED', sourceEvidence: source }),
      existing({ id: 'edited', status: 'SUGGESTED', origin: 'EXTRACTED', editedAt: new Date(), sourceEvidence: source }),
      existing({ id: 'hidden', status: 'HIDDEN', origin: 'EXTRACTED', sourceEvidence: source }),
      existing({ id: 'other-cv', status: 'SUGGESTED', origin: 'EXTRACTED', sourceEvidence: { ...source, resumeId: 'r2' } }),
    ];
    const { careerEntry, service } = setup([head, fragment, ...protectedRows]);
    (service as any).prisma.$transaction = async (fn: any) => fn({ careerEntry });
    careerEntry.findMany.mockResolvedValueOnce([head, fragment, ...protectedRows]).mockResolvedValueOnce([
      { ...head, sourceEvidence: { ...source, parserVersion: 2 } },
      { ...fragment, status: 'HIDDEN', sourceEvidence: { ...source, supersededByParser: 2 } }, ...protectedRows,
    ]);
    await service.addSuggestionsFromUpload('u1', [suggestion({ evidence: source.excerpt, description: 'Power BI ilə panel hazırladım.' })] as any, 'r1');
    expect(careerEntry.updateMany).toHaveBeenCalledTimes(2);
    expect(careerEntry.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'head', userId: 'u1', status: 'SUGGESTED', origin: 'EXTRACTED', editedAt: null },
      data: { description: 'Power BI ilə panel hazırladım.' },
    });
    expect(careerEntry.updateMany.mock.calls[1][0]).toMatchObject({ where: { id: 'fragment' }, data: { status: 'HIDDEN' } });
    expect(careerEntry.deleteMany).not.toHaveBeenCalled();
    expect(careerEntry.create).not.toHaveBeenCalled();
  });

  it('keeps a text-imported project unconfirmed until the candidate confirms it', async () => {
    const careerEntry = {
      count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'new', ...data })),
    };
    const service = new CareerEntriesService({ careerEntry } as any);
    const result = await service.create('u1', { kind: 'PROJECT', title: 'Imported project', status: 'SUGGESTED' });
    expect(result.status).toBe('SUGGESTED');
    expect(result.confirmedAt).toBeNull();
    const manual = await service.create('u1', { kind: 'PROJECT', title: 'Manual project' });
    expect(manual.status).toBe('CONFIRMED');
    expect(manual.confirmedAt).toBeInstanceOf(Date);
  });
});
