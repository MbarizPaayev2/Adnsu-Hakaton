import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  TrackerService,
  csvCell,
  trackerColumns,
  trackerFields,
} from './tracker.service';

describe('free application tracker', () => {
  const columns = [{ id: 'c_contact', name: 'Əlaqə' }];
  const entry = {
    id: 'email:own1',
    channel: 'email',
    title: 'Analyst',
    company: 'Acme',
    createdAt: new Date('2026-10-15'),
    current: 'DELIVERED',
    problem: null,
    dryRun: false,
  };
  const make = (records: any[] = []) => {
    const prisma: any = {
      match: { findMany: jest.fn(async () => []) },
      $executeRaw: jest.fn(),
      applicationTrackerRecord: {
        findMany: jest.fn(async () => records),
        create: jest.fn(),
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(),
      },
      applicationTrackerSettings: {
        findUnique: jest.fn(async () => ({ columns })),
        upsert: jest.fn(),
      },
    };
    const timeline: any = { timeline: jest.fn(async () => [entry]) };
    return { service: new TrackerService(prisma, timeline), prisma, timeline };
  };
  it('loads all channels for the caller without a 200-row cap, with no plan gate', async () => {
    const { service, timeline, prisma } = make();
    const data = await service.list('free-user', {});
    expect(timeline.timeline).toHaveBeenCalledWith(
      'free-user',
      expect.any(Date),
      null,
    );
    expect(prisma.applicationTrackerRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'free-user' } }),
    );
    expect(data.rows[0]).toMatchObject({
      stage: 'APPLIED',
      evidence: 'DELIVERED',
    });
  });
  it('keeps personal notes and stage while system evidence advances, and never invents a deleted source', async () => {
    const { service } = make([
      {
        createdAt: new Date(),
        sourceKey: entry.id,
        fields: { notes: 'I called', stage: 'INTERVIEW' },
        hidden: false,
      },
      {
        createdAt: new Date(),
        sourceKey: 'email:deleted',
        fields: { title: 'Deleted' },
        hidden: false,
      },
    ]);
    const data = await service.list('owner', {});
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]).toMatchObject({
      stage: 'INTERVIEW',
      notes: 'I called',
      evidence: 'DELIVERED',
    });
  });
  it('never treats a dry run as applied', async () => {
    const { service, timeline } = make();
    timeline.timeline.mockResolvedValue([{ ...entry, dryRun: true }]);
    expect((await service.list('u', {})).rows[0]).toMatchObject({
      stage: 'PLANNED',
      evidence: 'DRY_RUN',
    });
  });
  it('refuses an application belonging to another user before writing any override', async () => {
    const { service, prisma } = make();
    await expect(
      service.edit('owner', 'email:someoneElse', { notes: 'attack' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.applicationTrackerRecord.upsert).not.toHaveBeenCalled();
  });
  it('adds manual entries owned by a free user and exports custom columns', async () => {
    const { service, prisma } = make([
      {
        sourceKey: 'manual:one',
        fields: {
          title: '=HYPERLINK("x")',
          company: 'New',
          custom: { c_contact: 'Leyla' },
        },
        createdAt: new Date('2026-10-14'),
        hidden: false,
      },
    ]);
    await service.create('free', {
      title: 'Analyst',
      company: 'Acme',
      url: 'https://example.com/job',
      stage: 'APPLIED',
    });
    expect(prisma.applicationTrackerRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'free',
        sourceKey: expect.stringMatching(/^manual:/),
      }),
    });
    const csv = await service.csv('free');
    expect(csv).toContain('Leyla');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv.startsWith('\uFEFF')).toBe(true);
  });
  it('paginates and searches the whole history rather than filtering a first page', async () => {
    const { service, timeline } = make();
    timeline.timeline.mockResolvedValue(
      Array.from({ length: 251 }, (_, i) => ({
        ...entry,
        id: `email:a${i}`,
        title: `Role ${i}`,
      })),
    );
    expect(await service.list('u', { page: '6' })).toMatchObject({
      total: 251,
      page: 6,
      rows: [expect.objectContaining({ title: 'Role 250' })],
    });
    expect((await service.list('u', { q: 'Role 250' })).rows).toHaveLength(1);
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'https://user:secret@example.com',
  ])('rejects unsafe URL %s', (url) =>
    expect(() => trackerFields({ url }, columns)).toThrow(BadRequestException),
  );
  it('validates dates, stage names, custom-column IDs and column bounds', () => {
    expect(() => trackerFields({ date: '2026-02-31' }, columns)).toThrow();
    expect(() => trackerFields({ stage: 'MAGIC' }, columns)).toThrow();
    expect(() =>
      trackerFields({ custom: { __proto__: 'x', unknown: 'y' } }, columns),
    ).toThrow();
    expect(() => trackerColumns([{ id: '__proto__', name: 'x' }])).toThrow();
    expect(() => trackerColumns([...columns, ...columns])).toThrow();
    expect(() =>
      trackerColumns(
        Array.from({ length: 21 }, (_, i) => ({ id: `c_${i}`, name: 'x' })),
      ),
    ).toThrow();
  });
  it.each(['=1+1', '+SUM(1)', '-2+3', '@SUM(1)', '\t=cmd()', '\r=cmd()'])(
    'escapes Excel formulas %j',
    (value) => expect(csvCell(value)).toMatch(/^"'/),
  );
  it('allows candidate to record personal stage directly as HIRED or OFFER without artificial sequence gating', async () => {
    const { service, timeline, prisma } = make();
    timeline.timeline.mockResolvedValue([{ ...entry, current: 'DRAFT', dryRun: true }]);
    await expect(
      service.edit('u', entry.id, { stage: 'HIRED' }),
    ).resolves.toMatchObject({ saved: true });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });
  it('filters by stage group before pagination on multi-page datasets (>50 applications), returning matching records outside initial page', async () => {
    const { service, timeline, prisma } = make();
    const closedRows = Array.from({ length: 50 }, (_, i) => ({
      ...entry,
      id: `email:closed_${i}`,
      title: `Closed Role ${i}`,
      company: `Closed Corp ${i}`,
    }));
    const activeRows = Array.from({ length: 10 }, (_, i) => ({
      ...entry,
      id: `email:active_${i}`,
      title: `Active Role ${i}`,
      company: `Active Corp ${i}`,
    }));

    timeline.timeline.mockResolvedValue([...closedRows, ...activeRows]);

    const records = [
      ...closedRows.map((r) => ({
        sourceKey: r.id,
        fields: { stage: 'REJECTED' },
        createdAt: new Date(),
        hidden: false,
      })),
      ...activeRows.map((r) => ({
        sourceKey: r.id,
        fields: { stage: 'APPLIED' },
        createdAt: new Date(),
        hidden: false,
      })),
    ];
    prisma.applicationTrackerRecord.findMany.mockResolvedValue(records);

    // 1. Unfiltered page 1: contains only 50 closed applications, total is 60, pages is 2.
    const unfilteredPage1 = await service.list('u', {});
    expect(unfilteredPage1.total).toBe(60);
    expect(unfilteredPage1.pages).toBe(2);
    expect(unfilteredPage1.page).toBe(1);
    expect(unfilteredPage1.rows).toHaveLength(50);
    expect(unfilteredPage1.rows.every((r) => r.stage === 'REJECTED')).toBe(true);

    // Unfiltered page 2: contains the 10 active applications.
    const unfilteredPage2 = await service.list('u', { page: '2' });
    expect(unfilteredPage2.rows).toHaveLength(10);
    expect(unfilteredPage2.rows.every((r) => r.stage === 'APPLIED')).toBe(true);

    // 2. Filter by group='active':
    // Pre-pagination filtering ensures all 10 active applications are found and placed on page 1.
    const activeResult = await service.list('u', { group: 'active' });
    expect(activeResult.total).toBe(10);
    expect(activeResult.pages).toBe(1);
    expect(activeResult.page).toBe(1);
    expect(activeResult.rows).toHaveLength(10);
    expect(activeResult.rows[0].title).toBe('Active Role 0');
    expect(activeResult.rows[9].title).toBe('Active Role 9');
    expect(activeResult.rows.every((r) => r.stage === 'APPLIED')).toBe(true);

    // 3. Filter by group='closed':
    const closedResult = await service.list('u', { group: 'closed' });
    expect(closedResult.total).toBe(50);
    expect(closedResult.pages).toBe(1);
    expect(closedResult.page).toBe(1);
    expect(closedResult.rows).toHaveLength(50);
    expect(closedResult.rows.every((r) => r.stage === 'REJECTED')).toBe(true);

    // 4. Switching to group='active' from a later page (e.g. page 2) clamps page back to 1:
    const activePage2Clamped = await service.list('u', { group: 'active', page: '2' });
    expect(activePage2Clamped.total).toBe(10);
    expect(activePage2Clamped.page).toBe(1);
    expect(activePage2Clamped.pages).toBe(1);
    expect(activePage2Clamped.rows).toHaveLength(10);

    // 5. Combining group with specific stage:
    const concordant = await service.list('u', { group: 'active', stage: 'APPLIED' });
    expect(concordant.total).toBe(10);
    expect(concordant.rows).toHaveLength(10);

    const contradictory = await service.list('u', { group: 'active', stage: 'REJECTED' });
    expect(contradictory.total).toBe(0);
    expect(contradictory.pages).toBe(1);
    expect(contradictory.rows).toHaveLength(0);

    // 6. Combining group with search query:
    const searchedActive = await service.list('u', { group: 'active', q: 'Active Role 5' });
    expect(searchedActive.total).toBe(1);
    expect(searchedActive.rows[0].title).toBe('Active Role 5');

    const searchedClosedInActive = await service.list('u', { group: 'active', q: 'Closed Role 5' });
    expect(searchedClosedInActive.total).toBe(0);
    expect(searchedClosedInActive.rows).toHaveLength(0);
  });
});
