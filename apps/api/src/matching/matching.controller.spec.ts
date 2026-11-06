import { MatchingController, nextRecommendationSelectionAt } from './matching.controller';
const active = (id: string, extra = {}) => ({ id, userId: 'owner', score: 0.9, status: 'NEW', createdAt: new Date(), job: { status: 'ACTIVE', deadline: null }, vacancy: null, ...extra });
describe('candidate match visibility', () => {
  let prisma: any;
  let controller: MatchingController;
  beforeEach(() => {
    prisma = { match: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) }, matchCandidate: { count: jest.fn().mockResolvedValue(0) }, user: { findUnique: jest.fn().mockResolvedValue({ subscription: { plan: 'FREE' } }) } };
    controller = new MatchingController({} as any, prisma);
  });
  it('excludes expired/closed/low-score recommendations before applying the cap, keeping application history separately', async () => {
    prisma.match.findMany.mockResolvedValue([
      active('closed', { job: { status: 'CLOSED', deadline: null } }),
      active('expired', { job: { status: 'ACTIVE', deadline: new Date(0) } }),
      active('history', { status: 'APPLIED', job: { status: 'CLOSED', deadline: null } }),
      active('weak', { score: 0.1 }), ...['a','b','c','d'].map((id) => active(id)),
    ]);
    const result = await controller.getMatches('owner');
    expect(result.map((m) => m.id)).toEqual(['history','a','b','c']);
    expect(result[0].actionable).toBe(false);
    expect(prisma.match.findMany.mock.calls[0][0].where.userId).toBe('owner');
  });
  it('omits occupation-mismatched recommendations before the Free cap while preserving applied history', async () => {
    const details = { breakdown: { filters: {role_relevant:false} } };
    prisma.match.findMany.mockResolvedValue([active('wrong', {details}), active('history', {details, status:'APPLIED'}), ...['a','b','c'].map(id=>active(id))]);
    expect((await controller.getMatches('owner')).map(m=>m.id)).toEqual(['history','a','b','c']);
  });
  it('applies the status filter inside the FREE entitlement, never to reveal more than the plan shows', async () => {
    const rows = [active('a'), active('b'), active('c'), active('v1', { status: 'VIEWED', score: 0.8 }), active('v2', { status: 'VIEWED', score: 0.8 }), active('v3', { status: 'VIEWED', score: 0.8 })];
    prisma.match.findMany.mockResolvedValue(rows);
    expect((await controller.getMatches('owner')).map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(await controller.getMatches('owner', 'VIEWED' as any)).toEqual([]); // the viewed ones are outside the three entitled slots
    expect((await controller.getMatches('owner', 'NEW' as any)).map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(prisma.match.findMany.mock.calls.every((c: any[]) => c[0].where.status === undefined)).toBe(true);
  });
  it('lets a paid account filter by status over everything it is entitled to', async () => {
    prisma.user.findUnique.mockResolvedValue({ subscription: { plan: 'LIMITSIZ', status: 'active' } });
    prisma.match.findMany.mockResolvedValue([active('a'), active('b'), active('c'), active('v1', { status: 'VIEWED', score: 0.8 }), active('v2', { status: 'VIEWED', score: 0.8 }), active('d1', { status: 'DISMISSED', score: 0.7 })]);
    expect((await controller.getMatches('owner')).length).toBe(6);
    expect((await controller.getMatches('owner', 'VIEWED' as any)).map((m) => m.id)).toEqual(['v1', 'v2']);
    expect((await controller.getMatches('owner', 'DISMISSED' as any)).map((m) => m.id)).toEqual(['d1']);
  });
  it('treats a missing subscription as FREE', async () => {
    prisma.user.findUnique.mockResolvedValue({ subscription: null });
    prisma.match.findMany.mockResolvedValue(['a','b','c','d'].map((id) => active(id)));
    expect(await controller.getMatches('owner')).toHaveLength(3);
  });
  it('keeps up to three current-week recommendations, fills unused space with older ones, and retains applied history', async () => {
    const lastWeek = new Date(Date.now() - 8 * 86_400_000);
    prisma.match.findMany.mockResolvedValue([
      active('old', { createdAt: lastWeek }),
      active('this-week'),
      active('history', { status: 'APPLIED', createdAt: lastWeek }),
    ]);
    expect((await controller.getMatches('owner')).map((m) => m.id)).toEqual(['old', 'this-week', 'history']);
  });
  it('keeps up to three legacy active recommendations visible until the first weekly batch arrives', async () => {
    const lastWeek = new Date(Date.now() - 8 * 86_400_000);
    prisma.match.findMany.mockResolvedValue(['old-a', 'old-b', 'old-c', 'old-d'].map((id) => active(id, { createdAt: lastWeek })));
    expect((await controller.getMatches('owner')).map((m) => m.id)).toEqual(['old-a', 'old-b', 'old-c']);
  });
  it('explains that Free candidates are queued for the next weekly ranked selection', async () => {
    prisma.matchCandidate.count.mockResolvedValue(2);
    const status = await controller.getSelectionStatus('owner');
    expect(status.cadence).toBe('weekly');
    expect(status.pendingCount).toBe(2);
    expect(new Date(status.nextSelectionAt).getTime()).toBeGreaterThan(Date.now());
  });
  it('offers an immediate first batch only when scored candidates exist and no period slot was already used', async () => {
    prisma.matchCandidate.count.mockResolvedValue(2);
    const status = await controller.getSelectionStatus('owner');
    expect(status.firstBatchAvailable).toBe(true);

    prisma.match.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const afterSelection = await controller.getSelectionStatus('owner');
    expect(afterSelection.firstBatchAvailable).toBe(false);
  });
  it('publishes the existing ranked pool for one account on explicit first-batch request', async () => {
    const publishRankedRecommendations = jest.fn().mockResolvedValue(2);
    (controller as any).matchingService = { publishRankedRecommendations };
    prisma.matchCandidate.count.mockResolvedValue(4);
    await expect(controller.selectFirstBatch('owner')).resolves.toEqual({ status: 'published', published: 2 });
    expect(publishRankedRecommendations).toHaveBeenCalledWith('weekly', 'owner');
  });
  it('does not invoke the publisher when there are no staged candidates', async () => {
    const publishRankedRecommendations = jest.fn();
    (controller as any).matchingService = { publishRankedRecommendations };
    await expect(controller.selectFirstBatch('owner')).resolves.toEqual({ status: 'no_pending_candidates', published: 0 });
    expect(publishRankedRecommendations).not.toHaveBeenCalled();
  });
  it('uses the daily selection cadence for Plus accounts', async () => {
    prisma.user.findUnique.mockResolvedValue({ subscription: { plan: 'PLUS', status: 'active', currentPeriodEnd: null } });
    prisma.matchCandidate.count.mockResolvedValue(1);
    const status = await controller.getSelectionStatus('owner');
    expect(status).toMatchObject({ cadence: 'daily', pendingCount: 1 });
  });
  it('does not advertise inactive/unapproved native vacancies', async () => {
    prisma.match.findMany.mockResolvedValue([
      active('native', { job: null, vacancy: { status: 'ACTIVE', deadline: null, company: { status: 'PENDING' } } }),
    ]);
    expect(await controller.getMatches('owner')).toEqual([]);
  });
  it('rejects another owner and invalid status', async () => {
    prisma.match.findUnique.mockResolvedValue(active('foreign', { userId: 'other' }));
    await expect(controller.updateMatchStatus('owner', 'foreign', { status: 'VIEWED' })).rejects.toThrow('Uyğunluq tapılmadı');
    expect(prisma.match.update).not.toHaveBeenCalled();
    await expect(controller.getMatches('owner', 'INVALID' as any)).rejects.toThrow();
  });
  it('delegates getMatchSkills to matchingService', async () => {
    const mockMatchingService = { getMatchSkills: jest.fn().mockResolvedValue({ matchId: 'm1', evidenced: [] }) };
    const c = new MatchingController(mockMatchingService as any, prisma);
    const result = await c.getMatchSkills('owner', 'm1');
    expect(mockMatchingService.getMatchSkills).toHaveBeenCalledWith('owner', 'm1');
    expect(result.matchId).toBe('m1');
  });

  describe('getMatch', () => {
    it('resolves an owned match (including unscored saved jobs) with actionable status and ref', async () => {
      const savedMatch = {
        id: 'saved_match_1',
        userId: 'owner',
        score: 0,
        status: 'VIEWED',
        jobId: 'job_99',
        vacancyId: null,
        job: { id: 'job_99', title: 'Data Lead', company: 'DataLead MMC', location: 'Bakı', status: 'ACTIVE', deadline: null },
        vacancy: null,
      };
      prisma.match.findUnique.mockResolvedValue(savedMatch);

      const result = await controller.getMatch('owner', 'saved_match_1');
      expect(result.id).toBe('saved_match_1');
      expect(result.actionable).toBe(true);
      expect(result.ref).toBe('imported:job_99');
      expect(result.job?.title).toBe('Data Lead');
    });

    it('rejects foreign or missing match with NotFoundException', async () => {
      prisma.match.findUnique.mockResolvedValue(null);
      await expect(controller.getMatch('owner', 'missing')).rejects.toThrow('Uyğunluq tapılmadı');

      prisma.match.findUnique.mockResolvedValue({ id: 'm1', userId: 'other_user' });
      await expect(controller.getMatch('owner', 'm1')).rejects.toThrow('Uyğunluq tapılmadı');
    });
  });
});

describe('nextRecommendationSelectionAt', () => {
  it('reports the same-day daily run when it is only minutes away in Baku', () => {
    expect(nextRecommendationSelectionAt('daily', new Date('2026-10-26T20:03:00Z')).toISOString())
      .toBe('2026-10-26T20:05:00.000Z');
  });
  it('moves to the next Baku day after the daily cutoff has passed', () => {
    expect(nextRecommendationSelectionAt('daily', new Date('2026-10-26T20:06:00Z')).toISOString())
      .toBe('2026-10-27T20:05:00.000Z');
  });
  it('reports the upcoming Monday weekly run when it is only minutes away', () => {
    expect(nextRecommendationSelectionAt('weekly', new Date('2026-10-25T20:03:00Z')).toISOString())
      .toBe('2026-10-25T20:10:00.000Z');
  });
});
