import { matchDayStart } from '@aise/shared-types';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { MatchingService } from './matching.service';
import { JobMatchingService } from './job-matching.service';
import { PrismaService } from '../database/database.service';
import { PostHogService } from '../common/posthog.service';
import { JobCatalogueService } from '../jobs/job-catalogue.service';

describe('MatchingService', () => {
  let service: MatchingService;
  let prisma: {
    $transaction: jest.Mock;
    job: Record<string, jest.Mock>;
    vacancy: Record<string, jest.Mock>;
    profile: Record<string, jest.Mock>;
    match: Record<string, jest.Mock>;
    matchCandidate: Record<string, jest.Mock>;
    subscription: Record<string, jest.Mock>;
    planOverride: Record<string, jest.Mock>;
  };
  let jobMatchingService: { scoreBatch: jest.Mock; scoreProfileBatch: jest.Mock };
  let matchCreatedQueue: { add: jest.Mock };

  const JOB = { id: 'job_1', title: 'Engineer', status: 'ACTIVE', deadline: null };
  const scoreDetails = { score: 0.5, matchedKeywords: ['react'] };

  function profileWithPlan(plan: string, matchesUsedThisPeriod: number, quotaPeriodStart = new Date()) {
    return {
      id: 'profile_1',
      userId: 'user_1',
      user: {
        subscription: { userId: 'user_1', plan, status: 'active', currentPeriodEnd: null, matchesUsedThisPeriod, quotaPeriodStart },
      },
    };
  }

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn((work) => work(prisma)),
      job: { findUnique: jest.fn().mockResolvedValue(JOB), findMany: jest.fn().mockResolvedValue([]) },
      vacancy: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      profile: { findMany: jest.fn(), findUnique: jest.fn() },
      match: { count: jest.fn().mockResolvedValue(0), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      matchCandidate: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      planOverride: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      subscription: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockImplementation(({ create }: any) =>
          Promise.resolve({ userId: 'user_1', plan: 'BASIC', matchesUsedThisPeriod: 0, quotaPeriodStart: new Date(), ...create }),
        ),
      },
    };
    jobMatchingService = { scoreBatch: jest.fn(), scoreProfileBatch: jest.fn() };
    matchCreatedQueue = { add: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchingService,
        { provide: PrismaService, useValue: prisma },
        { provide: JobMatchingService, useValue: jobMatchingService },
        { provide: PostHogService, useValue: { capture: jest.fn() } },
        { provide: JobCatalogueService, useValue: { skillGuidance: jest.fn() } },
        { provide: getQueueToken('match-created'), useValue: matchCreatedQueue },
      ],
    }).compile();

    service = module.get<MatchingService>(MatchingService);
  });

  it('creates a match and increments quota usage when the user is under their plan quota', async () => {
    const profile = profileWithPlan('BASIC', 2); // 2 of 3 used
    prisma.profile.findMany.mockResolvedValue([profile]);
    jobMatchingService.scoreBatch.mockResolvedValue(new Map([[profile.id, scoreDetails]]));
    prisma.match.create.mockResolvedValue({ id: 'match_1' });

    await service.runMatching('job_1');

    expect(prisma.match.create).toHaveBeenCalled();
    // updateMany (not update) is what makes the increment atomic: the WHERE
    // clause re-checks quota against the live row instead of trusting the
    // value read earlier in this same call.
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', matchesUsedThisPeriod: { lt: 10 } },
      data: { matchesUsedThisPeriod: { increment: 1 } },
    });
    expect(matchCreatedQueue.add).toHaveBeenCalledWith(
      'send-notification',
      { matchId: 'match_1', userId: 'user_1' },
      expect.objectContaining({ removeOnComplete: true }),
    );
  });

  it('skips creating a match and does not notify once the FREE quota is exhausted', async () => {
    const profile = profileWithPlan('BASIC', 10); // already at the 3/month cap
    prisma.profile.findMany.mockResolvedValue([profile]);
    jobMatchingService.scoreBatch.mockResolvedValue(new Map([[profile.id, scoreDetails]]));

    await service.runMatching('job_1');

    expect(prisma.match.create).not.toHaveBeenCalled();
    expect(matchCreatedQueue.add).not.toHaveBeenCalled();
  });

  it('applies an active operator plan override without touching the subscription', async () => {
    prisma.planOverride.findMany.mockResolvedValue([{ plan: 'Limitsiz', expiresAt: new Date(Date.now() + 86_400_000), revokedAt: null, academySeatGrantId: null }]);
    await expect((service as any).consumeMatchQuota('user_1', { userId: 'user_1', plan: 'FREE', matchesUsedThisPeriod: 999, quotaPeriodStart: new Date() })).resolves.toBe(true);
    expect(prisma.subscription.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ plan: expect.anything() }) }));
  });

  it('never blocks on quota for the Limitsiz plan regardless of usage', async () => {
    const profile = profileWithPlan('Limitsiz', 9999);
    prisma.profile.findMany.mockResolvedValue([profile]);
    jobMatchingService.scoreBatch.mockResolvedValue(new Map([[profile.id, scoreDetails]]));
    prisma.match.create.mockResolvedValue({ id: 'match_1' });

    await service.runMatching('job_1');

    expect(prisma.match.create).toHaveBeenCalled();
    // Limitsiz has no quota to race against, so it takes the plain-update
    // path rather than the conditional updateMany.
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      data: { matchesUsedThisPeriod: { increment: 1 } },
    });
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('does not create a match if a concurrent worker consumes the last slot first', async () => {
    // Locally read as "2 of 3 used" (under quota), but the atomic
    // updateMany's WHERE re-check fails — e.g. a different BullMQ worker
    // scoring a different job for this same user already pushed it to 3/3
    // between this read and this write.
    const profile = profileWithPlan('BASIC', 2);
    prisma.profile.findMany.mockResolvedValue([profile]);
    jobMatchingService.scoreBatch.mockResolvedValue(new Map([[profile.id, scoreDetails]]));
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

    await service.runMatching('job_1');

    expect(prisma.subscription.updateMany).toHaveBeenCalled();
    expect(prisma.match.create).not.toHaveBeenCalled();
    expect(matchCreatedQueue.add).not.toHaveBeenCalled();
  });

  it('resets usage once the 30-day quota period has elapsed, then allows the match', async () => {
    const staleStart = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const profile = profileWithPlan('BASIC', 3, staleStart); // at cap, but period is stale
    prisma.profile.findMany.mockResolvedValue([profile]);
    jobMatchingService.scoreBatch.mockResolvedValue(new Map([[profile.id, scoreDetails]]));
    prisma.match.create.mockResolvedValue({ id: 'match_1' });

    await service.runMatching('job_1');

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', quotaPeriodStart: { lt: expect.any(Date) } },
      data: { matchesUsedThisPeriod: 0, quotaPeriodStart: expect.any(Date) },
    });
    expect(prisma.match.create).toHaveBeenCalled();
  });

  it('enforces Free three per Baku week even when the monthly count is high', async () => {
    prisma.match.count.mockImplementation(({where}) => Promise.resolve(where.details ? 0 : 3));
    const sub = profileWithPlan('FREE', 999).user.subscription;
    await expect((service as any).consumeMatchQuota('user_1', sub)).resolves.toBe(false);
    prisma.match.count.mockImplementation(({where}) => Promise.resolve(where.details ? 0 : 2));
    await expect((service as any).consumeMatchQuota('user_1', sub)).resolves.toBe(true);
  });
  describe('paid daily allowances', () => {
    afterEach(() => jest.useRealTimers());
    it.each([['PLUS', 1], ['PREMIUM', 5]])('enforces %s daily cap with a stale monthly snapshot', async (plan, cap) => {
      const sub = profileWithPlan(plan as string, 999).user.subscription;
      prisma.match.count.mockImplementation(({where}) => Promise.resolve(where.details ? 0 : cap));
      await expect((service as any).consumeMatchQuota('user_1', sub)).resolves.toBe(false);
      expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
      expect(prisma.subscription.update.mock.calls[0][0].data.matchesUsedThisPeriod.increment).toBe(0);
      prisma.match.count.mockImplementation(({where}) => Promise.resolve(where.details ? 0 : (cap as number) - 1));
      await expect((service as any).consumeMatchQuota('user_1', sub)).resolves.toBe(true);
      expect(prisma.subscription.update).toHaveBeenLastCalledWith({ where: { userId: 'user_1' }, data: { matchesUsedThisPeriod: { increment: 1 } } });
    });
    it('resets at midnight Baku, including the last day of a 31-day month', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-30T19:59:59Z'));
      expect(matchDayStart().toISOString()).toBe('2026-10-29T20:00:00.000Z');
      jest.setSystemTime(new Date('2026-10-30T20:00:00Z'));
      await expect((service as any).consumeMatchQuota('user_1', profileWithPlan('PLUS', 30).user.subscription)).resolves.toBe(true);
      expect(prisma.match.count).toHaveBeenCalledWith({ where: { userId: 'user_1', createdAt: { gte: new Date('2026-10-30T20:00:00Z'), lt: new Date('2026-10-31T20:00:00Z') } } });
    });
    it('uses operator entitlement and falls back to FREE after cancellation', async () => {
      const sub = profileWithPlan('BASIC', 10).user.subscription;
      prisma.planOverride.findMany.mockResolvedValue([{ plan: 'PREMIUM', expiresAt: new Date(Date.now() + 86_400_000), revokedAt: null, academySeatGrantId: null }]);
      await expect((service as any).consumeMatchQuota('user_1', sub)).resolves.toBe(true);
      prisma.planOverride.findMany.mockResolvedValue([]);
      await expect((service as any).consumeMatchQuota('user_1', { ...sub, plan: 'BASIC', status: 'active' })).resolves.toBe(false);
    });
    it('rechecks live daily usage after waiting for the account lock', async () => {
      let unlock!: () => void;
      prisma.subscription.update.mockImplementationOnce(() => new Promise<void>((resolve) => { unlock = resolve; }));
      const pending = (service as any).consumeMatchQuota('user_1', profileWithPlan('PLUS', 0).user.subscription);
      await Promise.resolve(); await Promise.resolve();
      expect(prisma.match.count).not.toHaveBeenCalled();
      prisma.match.count.mockImplementation(({where}) => Promise.resolve(where.details ? 0 : 1));
      unlock();
      await expect(pending).resolves.toBe(false);
    });
  });

  it('re-scores an existing match without touching quota', async () => {
    const profile = profileWithPlan('BASIC', 10); // at cap — would block a new match
    prisma.profile.findMany.mockResolvedValue([profile]);
    jobMatchingService.scoreBatch.mockResolvedValue(new Map([[profile.id, { ...scoreDetails, score: 0.7 }]]));
    prisma.match.findUnique.mockResolvedValue({ id: 'existing_match', score: 0.5 });

    await service.runMatching('job_1');

    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'existing_match' },
      data: { score: 0.7, details: expect.anything() },
    });
    expect(prisma.match.create).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('re-enqueues an unsent existing-match notification after a previous Redis enqueue failure', async () => {
    const profile = profileWithPlan('BASIC', 0);
    prisma.profile.findMany.mockResolvedValue([profile]);
    jobMatchingService.scoreBatch.mockResolvedValue(new Map([[profile.id, scoreDetails]]));
    prisma.match.findUnique.mockResolvedValue({ id: 'existing_match', score: 0.5, details: scoreDetails, status: 'NEW', notifiedAt: null, suppressedRollout: null });

    await service.runMatching('job_1');

    expect(matchCreatedQueue.add).toHaveBeenCalledWith('send-notification', { matchId: 'existing_match', userId: 'user_1' }, expect.objectContaining({
      jobId: 'match-created-existing_match',
      attempts: 5,
      removeOnComplete: true,
    }));
  });

  it('refreshes a match whose explanation changed even when the score did not', async () => {
    const profile = profileWithPlan('BASIC', 10);
    prisma.profile.findMany.mockResolvedValue([profile]);
    jobMatchingService.scoreBatch.mockResolvedValue(
      new Map([[profile.id, { score: 0.5, matchedKeywords: ['react', 'nestjs'] }]]),
    );
    prisma.match.findUnique.mockResolvedValue({ id: 'existing_match', score: 0.5, details: scoreDetails });

    await service.runMatching('job_1');

    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'existing_match' },
      data: { score: 0.5, details: expect.objectContaining({ matchedKeywords: ['react', 'nestjs'], source: 'job' }) },
    });
  });

  it('leaves an unchanged match untouched', async () => {
    const profile = profileWithPlan('BASIC', 10);
    prisma.profile.findMany.mockResolvedValue([profile]);
    jobMatchingService.scoreBatch.mockResolvedValue(new Map([[profile.id, scoreDetails]]));
    prisma.match.findUnique.mockResolvedValue({ id: 'existing_match', score: 0.5, details: scoreDetails });

    await service.runMatching('job_1');

    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it.each([
    ['closed', { ...JOB, status: 'CLOSED' }],
    ['past its deadline', { ...JOB, deadline: new Date(Date.now() - 60_000) }],
  ])('does not score a job that is %s', async (_label, job) => {
    prisma.job.findUnique.mockResolvedValue(job);

    await service.runMatching('job_1');

    expect(jobMatchingService.scoreBatch).not.toHaveBeenCalled();
    expect(prisma.match.create).not.toHaveBeenCalled();
  });

  it('skips profiles scoring below the calibrated threshold', async () => {
    const profile = profileWithPlan('BASIC', 0);
    prisma.profile.findMany.mockResolvedValue([profile]);
    jobMatchingService.scoreBatch.mockResolvedValue(new Map([[profile.id, { ...scoreDetails, score: 0.1 }]]));

    await service.runMatching('job_1');

    expect(prisma.match.create).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('accepts a 0.4 score — below the old 0.5 cutoff but above the calibrated one', async () => {
    const profile = profileWithPlan('BASIC', 0);
    prisma.profile.findMany.mockResolvedValue([profile]);
    jobMatchingService.scoreBatch.mockResolvedValue(new Map([[profile.id, { ...scoreDetails, score: 0.4 }]]));
    prisma.match.create.mockResolvedValue({ id: 'match_1' });

    await service.runMatching('job_1');

    expect(prisma.match.create).toHaveBeenCalled();
  });

  it('stages a missing-subscription FREE candidate and creates the FREE subscription when its weekly slot is published', async () => {
    const profile = { id: 'profile_1', userId: 'user_1', user: { subscription: null } };
    prisma.profile.findMany.mockResolvedValue([profile]);
    jobMatchingService.scoreBatch.mockResolvedValue(new Map([[profile.id, scoreDetails]]));
    prisma.match.create.mockResolvedValue({ id: 'match_1' });

    await service.runMatching('job_1');

    expect(prisma.matchCandidate.upsert).toHaveBeenCalled();
    const staged = prisma.matchCandidate.upsert.mock.calls[0][0].create;
    prisma.subscription.findUnique = jest.fn().mockResolvedValue(null);
    prisma.matchCandidate.findMany.mockResolvedValueOnce([{ userId: 'user_1' }]).mockResolvedValueOnce([
      { id: 'candidate_1', ...staged, scoredAt: new Date(), job: JOB, vacancy: null },
    ]);
    await service.publishRankedRecommendations('weekly');

    expect(prisma.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_1' } }),
    );
    expect(prisma.match.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ jobId: 'job_1' }) }));
  });

  describe('runMatchingForProfile', () => {
    it('scores every existing job and vacancy in one batched call and creates matches for the ones that qualify', async () => {
      const profile = profileWithPlan('BASIC', 0);
      prisma.profile.findUnique.mockResolvedValue(profile);
      prisma.job.findMany.mockResolvedValue([{ id: 'job_1' }, { id: 'job_2' }]);
      prisma.vacancy.findMany.mockResolvedValue([{ id: 'vac_1' }]);
      jobMatchingService.scoreProfileBatch.mockResolvedValue(
        new Map([
          ['job:job_1', { source: 'job', postingId: 'job_1', score: 0.6, details: { ...scoreDetails, score: 0.6 } }],
          ['job:job_2', { source: 'job', postingId: 'job_2', score: 0.1, details: { ...scoreDetails, score: 0.1 } }],
          ['vacancy:vac_1', { source: 'vacancy', postingId: 'vac_1', score: 0.7, details: { ...scoreDetails, score: 0.7 } }],
        ]),
      );
      prisma.match.create.mockResolvedValue({ id: 'match_1' });

      await service.runMatchingForProfile('user_1');

      // Only jobs that can still be applied to are scored.
      expect(prisma.job.findMany).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', hiddenAt: null, duplicateOfId: null, OR: [{ deadline: null }, { deadline: { gte: expect.any(Date) } }] },
      });
      expect(jobMatchingService.scoreProfileBatch).toHaveBeenCalledTimes(1);
      expect(jobMatchingService.scoreProfileBatch).toHaveBeenCalledWith(
        profile,
        [{ id: 'job_1' }, { id: 'job_2' }],
        [expect.objectContaining({ id: 'vac_1', companyName: 'Unknown' })],
      );
      // job_1 (0.6) and vac_1 (0.7) qualify; job_2 (0.1) is skipped.
      expect(prisma.match.create).toHaveBeenCalledTimes(2);
      expect(prisma.match.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user_1', jobId: 'job_1' }) }),
      );
      expect(prisma.match.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user_1', vacancyId: 'vac_1' }) }),
      );
    });

    it('refreshes old occupation mismatches and stages eligible results for ranked selection', async () => {
      prisma.profile.findUnique.mockResolvedValue(profileWithPlan('FREE',3));
      prisma.job.findMany.mockResolvedValue([{id:'old'},{id:'new'}]);
      prisma.vacancy.findMany.mockResolvedValue([]);
      const rejected = {score:0,matchedKeywords:[],breakdown:{filters:{role_relevant:false}}};
      jobMatchingService.scoreProfileBatch.mockResolvedValue(new Map([
        ['job:new',{source:'job',postingId:'new',score:.9,details:{...scoreDetails,score:.9}}],
        ['job:old',{source:'job',postingId:'old',score:0,details:rejected}],
      ]));
      let refreshed=false;
      prisma.match.findUnique.mockImplementation(({where})=>Promise.resolve(where.userId_jobId?.jobId==='old' ? {id:'old-match',score:.4,details:{}} : null));
      prisma.match.update.mockImplementation(async()=>{refreshed=true;return {};});
      prisma.match.count.mockImplementation(({where})=>Promise.resolve(where.details ? (refreshed ? 1 : 0) : 3));
      prisma.match.create.mockResolvedValue({id:'new-match'});
      await service.runMatchingForProfile('user_1');
      expect(refreshed).toBe(true);
      expect(prisma.match.create).not.toHaveBeenCalled();
      expect(prisma.matchCandidate.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ userId: 'user_1', jobId: 'new', score: 0.9 }),
      }));
    });

    it('spends a limited quota on the best matches, not the first postings', async () => {
      const profile = profileWithPlan('BASIC', 2); // one match left this month
      prisma.profile.findUnique.mockResolvedValue(profile);
      prisma.job.findMany.mockResolvedValue([{ id: 'low' }, { id: 'best' }, { id: 'mid' }]);
      prisma.vacancy.findMany.mockResolvedValue([]);
      jobMatchingService.scoreProfileBatch.mockResolvedValue(
        new Map([
          ['job:low', { source: 'job', postingId: 'low', score: 0.4, details: { ...scoreDetails, score: 0.4 } }],
          ['job:best', { source: 'job', postingId: 'best', score: 0.9, details: { ...scoreDetails, score: 0.9 } }],
          ['job:mid', { source: 'job', postingId: 'mid', score: 0.6, details: { ...scoreDetails, score: 0.6 } }],
        ]),
      );
      prisma.match.create.mockResolvedValue({ id: 'match_1' });
      // One match left: the first atomic increment succeeds, the next is refused.
      prisma.subscription.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });

      await service.runMatchingForProfile('user_1');

      expect(prisma.match.create).toHaveBeenCalledTimes(1);
      expect(prisma.match.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ jobId: 'best' }) }));
    });

    it('breaks equal scores in favour of the newer posting, deterministically', async () => {
      prisma.profile.findUnique.mockResolvedValue(profileWithPlan('BASIC', 2)); // one match left
      prisma.job.findMany.mockResolvedValue([
        { id: 'old', postedAt: new Date('2026-09-01') },
        { id: 'new', postedAt: new Date('2026-10-01') },
      ]);
      prisma.vacancy.findMany.mockResolvedValue([]);
      jobMatchingService.scoreProfileBatch.mockResolvedValue(
        new Map([
          ['job:old', { source: 'job', postingId: 'old', score: 0.7, details: { ...scoreDetails, score: 0.7 } }],
          ['job:new', { source: 'job', postingId: 'new', score: 0.7, details: { ...scoreDetails, score: 0.7 } }],
        ]),
      );
      prisma.match.create.mockResolvedValue({ id: 'match_1' });
      prisma.subscription.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
      await service.runMatchingForProfile('user_1');
      expect(prisma.match.create).toHaveBeenCalledTimes(1);
      expect(prisma.match.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ jobId: 'new' }) }));
    });

    it('does nothing if the user has no profile yet', async () => {
      prisma.profile.findUnique.mockResolvedValue(null);

      await service.runMatchingForProfile('user_1');

      expect(prisma.job.findMany).not.toHaveBeenCalled();
      expect(jobMatchingService.scoreProfileBatch).not.toHaveBeenCalled();
    });

    it('still enforces the plan quota the same way as the ingest-time pass', async () => {
      const profile = profileWithPlan('BASIC', 10); // already at cap
      prisma.profile.findUnique.mockResolvedValue(profile);
      prisma.job.findMany.mockResolvedValue([{ id: 'job_1' }]);
      prisma.vacancy.findMany.mockResolvedValue([]);
      jobMatchingService.scoreProfileBatch.mockResolvedValue(
        new Map([['job:job_1', { source: 'job', postingId: 'job_1', score: 0.6, details: scoreDetails }]]),
      );

      await service.runMatchingForProfile('user_1');

      expect(prisma.match.create).not.toHaveBeenCalled();
    });
  });

  describe('publishRankedRecommendations', () => {
    it('bounds each user pool at 250 candidates and prunes older in-window overflow', async () => {
      const recent = new Date();
      const candidates = Array.from({ length: 250 }, (_, index) => ({
        id: `candidate_${index}`,
        userId: 'user_1',
        jobId: `job_${index}`,
        vacancyId: null,
        score: 0.9 - index / 10_000,
        details: { score: 0.9 - index / 10_000, matchedKeywords: ['SQL'] },
        scoredAt: recent,
        job: { id: `job_${index}`, status: 'ACTIVE', deadline: null, postedAt: recent },
        vacancy: null,
      }));
      prisma.matchCandidate.findMany.mockResolvedValueOnce([{ userId: 'user_1' }]).mockResolvedValueOnce(candidates);
      prisma.subscription.findUnique = jest.fn().mockResolvedValue({ userId: 'user_1', plan: 'PLUS', status: 'active', currentPeriodEnd: null, matchesUsedThisPeriod: 0, quotaPeriodStart: recent });
      prisma.match.create.mockResolvedValue({ id: 'selected_match' });

      await service.publishRankedRecommendations('daily');

      expect(prisma.matchCandidate.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 250 }));
      expect(prisma.matchCandidate.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ userId: 'user_1', id: { notIn: candidates.map(({ id }) => id) } }),
      });
    });

    it('uses the highest scoring actionable candidate for a Plus daily slot', async () => {
      const recent = new Date();
      const candidates = [
        { id: 'lower', userId: 'user_1', jobId: 'job_low', vacancyId: null, score: 0.55, details: { score: 0.55, matchedKeywords: ['Excel'] }, scoredAt: recent, job: { id: 'job_low', status: 'ACTIVE', deadline: null, postedAt: recent }, vacancy: null },
        { id: 'higher', userId: 'user_1', jobId: 'job_high', vacancyId: null, score: 0.88, details: { score: 0.88, matchedKeywords: ['SQL'] }, scoredAt: recent, job: { id: 'job_high', status: 'ACTIVE', deadline: null, postedAt: recent }, vacancy: null },
      ];
      prisma.matchCandidate.findMany.mockResolvedValueOnce([{ userId: 'user_1' }]).mockResolvedValueOnce(candidates);
      prisma.subscription.findUnique = jest.fn().mockResolvedValue({ userId: 'user_1', plan: 'PLUS', status: 'active', currentPeriodEnd: null, matchesUsedThisPeriod: 0, quotaPeriodStart: recent });
      prisma.match.create.mockResolvedValue({ id: 'selected_match' });

      await service.publishRankedRecommendations('daily');

      expect(prisma.match.create).toHaveBeenCalledTimes(1);
      expect(prisma.match.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ jobId: 'job_high', score: 0.88 }) }));
      expect(prisma.matchCandidate.deleteMany).toHaveBeenCalledWith({ where: { id: 'higher' } });
      expect(prisma.matchCandidate.deleteMany).not.toHaveBeenCalledWith({ where: { id: 'lower' } });
    });

    it('does not publish a candidate whose posting closed before selection', async () => {
      const recent = new Date();
      prisma.matchCandidate.findMany.mockResolvedValueOnce([{ userId: 'user_1' }]).mockResolvedValueOnce([
        { id: 'closed', userId: 'user_1', jobId: 'job_closed', vacancyId: null, score: 0.9, details: { score: 0.9, matchedKeywords: ['SQL'] }, scoredAt: recent, job: { id: 'job_closed', status: 'CLOSED', deadline: null, postedAt: recent }, vacancy: null },
      ]);
      prisma.subscription.findUnique = jest.fn().mockResolvedValue({ userId: 'user_1', plan: 'PLUS', status: 'active', currentPeriodEnd: null, matchesUsedThisPeriod: 0, quotaPeriodStart: recent });

      await service.publishRankedRecommendations('daily');

      expect(prisma.match.create).not.toHaveBeenCalled();
      expect(prisma.matchCandidate.deleteMany).toHaveBeenCalledWith({ where: { id: 'closed' } });
    });
  });

  describe('runVacancyMatching', () => {
    const VACANCY = { id: 'vac_1', title: 'Frontend Dev', status: 'ACTIVE', skills: [], company: { name: 'ACME', status: 'APPROVED' }, deadline: null };

    it('scores all profiles against the vacancy and links matches via vacancyId', async () => {
      const profile = profileWithPlan('BASIC', 0);
      prisma.vacancy.findUnique.mockResolvedValue(VACANCY);
      prisma.profile.findMany.mockResolvedValue([profile]);
      jobMatchingService.scoreBatch.mockResolvedValue(new Map([[profile.id, scoreDetails]]));
      prisma.match.create.mockResolvedValue({ id: 'match_1' });

      await service.runVacancyMatching('vac_1');

      expect(prisma.match.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user_1', vacancyId: 'vac_1', jobId: null }),
        }),
      );
      expect(matchCreatedQueue.add).toHaveBeenCalled();
    });

    it('does nothing for missing or non-ACTIVE vacancies', async () => {
      prisma.vacancy.findUnique.mockResolvedValue(null);
      await service.runVacancyMatching('missing');
      expect(jobMatchingService.scoreBatch).not.toHaveBeenCalled();

      prisma.vacancy.findUnique.mockResolvedValue({ ...VACANCY, status: 'PAUSED' });
      await service.runVacancyMatching('vac_1');
      expect(jobMatchingService.scoreBatch).not.toHaveBeenCalled();
    });
  });
  it('fails a partially scored run for retry instead of reporting success', async () => {
    prisma.profile.findMany.mockResolvedValue([profileWithPlan('BASIC', 0)]);
    jobMatchingService.scoreBatch.mockResolvedValue(new Map());
    await expect(service.runMatching('job_1')).rejects.toThrow('Incomplete job scoring');
    expect(prisma.match.create).not.toHaveBeenCalled();
  });

  it('fails incomplete inverse scoring so profile queue retries can recover', async () => {
    prisma.profile.findUnique.mockResolvedValue(profileWithPlan('BASIC', 0));
    prisma.job.findMany.mockResolvedValue([JOB]);
    jobMatchingService.scoreProfileBatch.mockResolvedValue(new Map());
    await expect(service.runMatchingForProfile('user_1')).rejects.toThrow('Incomplete profile scoring');
  });

  it('stores nothing and spends no quota when profile scoring is only partly complete', async () => {
    prisma.profile.findUnique.mockResolvedValue(profileWithPlan('BASIC', 0));
    prisma.job.findMany.mockResolvedValue([{ id: 'low' }, { id: 'best' }]);
    prisma.vacancy.findMany.mockResolvedValue([]);
    jobMatchingService.scoreProfileBatch.mockResolvedValue(
      new Map([['job:low', { source: 'job', postingId: 'low', score: 0.7, details: { ...scoreDetails, score: 0.7 } }]]),
    );
    await expect(service.runMatchingForProfile('user_1')).rejects.toThrow('Incomplete profile scoring; retry required (1/2 postings scored)');
    expect(prisma.match.create).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('runs one scoring pass per profile at a time and shares its outcome with a concurrent request', async () => {
    prisma.profile.findUnique.mockResolvedValue(profileWithPlan('BASIC', 0));
    prisma.job.findMany.mockResolvedValue([]);
    prisma.vacancy.findMany.mockResolvedValue([]);
    let release!: () => void;
    jobMatchingService.scoreProfileBatch.mockImplementation(() => new Promise((resolve) => { release = () => resolve(new Map()); }));
    const first = service.runMatchingForProfile('user_1');
    const second = service.runMatchingForProfile('user_1');
    await new Promise((r) => setImmediate(r));
    expect(jobMatchingService.scoreProfileBatch).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    // Once the pass is over a new request starts a new pass.
    jobMatchingService.scoreProfileBatch.mockResolvedValue(new Map());
    await service.runMatchingForProfile('user_1');
    expect(jobMatchingService.scoreProfileBatch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: 'ACTIVE', deadline: new Date(0), company: { status: 'APPROVED' } },
    { status: 'ACTIVE', deadline: null, company: { status: 'PENDING' } },
  ])('does not score unavailable native vacancies (%o)', async (vacancy) => {
    prisma.vacancy.findUnique.mockResolvedValue({ id: 'vac_1', ...vacancy });
    await service.runVacancyMatching('vac_1');
    expect(jobMatchingService.scoreBatch).not.toHaveBeenCalled();
  });

  it('restores slots only for explicitly revalidated occupation mismatches', async () => {
    const recent = new Date();
    prisma.subscription.findUnique = jest.fn().mockResolvedValue({ userId: 'user_1', plan: 'FREE', status: 'active', currentPeriodEnd: null, matchesUsedThisPeriod: 3, quotaPeriodStart: recent });
    prisma.matchCandidate.findMany.mockResolvedValueOnce([{ userId: 'user_1' }]).mockResolvedValueOnce([
      { id: 'eligible', userId: 'user_1', jobId: 'job_1', vacancyId: null, score: 0.5, details: scoreDetails, scoredAt: recent, job: JOB, vacancy: null },
    ]);
    prisma.match.count.mockImplementation(({where}) => Promise.resolve(where.details ? 1 : 3));
    prisma.match.create.mockResolvedValue({id:'valid-match'});
    await service.publishRankedRecommendations('weekly');
    expect(prisma.match.create).toHaveBeenCalledTimes(1);
    expect(prisma.match.count).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({details:{path:['breakdown','filters','role_relevant'],equals:false}})}));
  });

  it('rejects an occupation-mismatched score before consuming quota or queueing a notification', async () => {
    const details = { score: .9, matchedKeywords: ['Excel'], breakdown: { roleFit: .4, filters: { role_relevant: false } } };
    expect(await (service as any).upsertMatch('user_1', {kind:'job',id:'job_1'}, details, null)).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(matchCreatedQueue.add).not.toHaveBeenCalled();
  });

  describe('getMatchSkills', () => {
    it('returns guidance with up to 3 guided evidence prompts linking to profile sections with query before fragment', async () => {
      prisma.match.findUnique.mockResolvedValue({
        id: 'match_1',
        userId: 'user_1',
        jobId: 'job_1',
        vacancyId: null,
      });
      const catalogueService = (service as any).jobCatalogueService;
      // Real catalogue output shape: skill is string
      catalogueService.skillGuidance = jest.fn().mockResolvedValue({
        hasProfile: true,
        evidenced: [{ skill: 'SQL', level: 'required', via: 'skills' }],
        missingRequired: [
          { skill: 'Power BI', level: 'required', requirement: 'Power BI ilə hesabatlar' },
          { skill: 'DAX', level: 'required', requirement: 'DAX sorğuları' },
        ],
        missingPreferred: [{ skill: 'Python', level: 'preferred', requirement: 'Python bilikləri' }],
        other: [{ text: 'İqtisadiyyat üzrə ali təhsil', kind: 'degree', level: 'required' }],
      });

      const result = await service.getMatchSkills('user_1', 'match_1');
      expect(result.matchId).toBe('match_1');
      expect(result.motivationSuggestions[0].text).toContain('Power BI');
      expect(result.motivationSuggestions.some((s) => s.field === 'whyCompany')).toBe(false);
      expect(result.motivationSuggestions.map((s) => s.text).join(' ')).not.toContain('peşəkar standartları');
      expect(result.guidedPrompts.length).toBeLessThanOrEqual(3);
      expect(result.guidedPrompts[0].title).toBe('Power BI');
      expect(result.guidedPrompts[0].section).toBe('skills');
      expect(result.guidedPrompts[0].link).toBe(
        '/dashboard/profile?matchId=match_1&returnTo=%2Fdashboard%2Fresumes%3FmatchId%3Dmatch_1#skills'
      );
      expect(result.guidedPrompts[2].title).toBe('İqtisadiyyat üzrə ali təhsil');
      expect(result.guidedPrompts[2].section).toBe('education');
      expect(result.guidedPrompts[2].link).toBe(
        '/dashboard/profile?matchId=match_1&returnTo=%2Fdashboard%2Fresumes%3FmatchId%3Dmatch_1#education'
      );
    });

    it('proposes the named role and company from the posting and selects a relevant later source fact', async () => {
      prisma.match.findUnique.mockResolvedValue({ id: 'match_1', userId: 'user_1', jobId: 'job_1', vacancyId: null,
        job: { title: 'BI Analyst', company: 'Example Payments', description: 'SQL ilə hesabatların hazırlanması' } });
      prisma.profile.findUnique.mockResolvedValue({ experiences: [{ title: 'Analyst Intern', company: 'Example Studio',
        description: 'Tədbir materiallarını hazırladım. SQL ilə sifariş məlumatlarını təhlil edib hesabat hazırladım.' }] });
      (service as any).jobCatalogueService.skillGuidance = jest.fn().mockResolvedValue({ hasProfile: true,
        evidenced: [{ skill: 'SQL', level: 'required', via: 'skills', requirement: 'SQL ilə hesabatların hazırlanması' }],
        missingRequired: [], missingPreferred: [], other: [] });
      const result = await service.getMatchSkills('user_1', 'match_1');
      const proposal = (field: string) => result.motivationSuggestions.find((s) => s.field === field)?.text;
      expect(proposal('whyRole')).toContain('BI Analyst');
      expect(proposal('whyCompany')).toContain('Example Payments');
      expect(proposal('whyCompany')).toContain('[yoxladığınız konkret');
      expect(proposal('contribution')).toContain('SQL');
      expect(proposal('formative')).toContain('SQL ilə sifariş məlumatlarını təhlil edib hesabat hazırladım.');
      expect(proposal('formative')).not.toContain('Tədbir materiallarını');
      expect(result.motivationSuggestions.map((s) => s.text).join(' ')).not.toMatch(/lider|mədəniyyət|prestij|innovativ/i);
    });

    it('proposes actual work rather than the first office skill, without fabricated employer praise', async () => {
      prisma.match.findUnique.mockResolvedValue({id:'match_1',userId:'user_1',jobId:'job_1',job:{title:'Corporate Sales Specialist',company:'Example Distribution',description:`Responsibilities:
Müştəri sifarişləri üzrə satış hesabatlarının hazırlanması;
Rəqib qiymətlərinin monitorinq edilməsi;
Requirements:
Excel bilikləri;`}});
      prisma.profile.findUnique.mockResolvedValue({experiences:[{title:'Research Intern',company:'Example',description:'Müştəri sifarişləri üzrə satış hesabatlarını hazırladım.'}]});
      (service as any).jobCatalogueService.skillGuidance=jest.fn().mockResolvedValue({evidenced:[{skill:'MS Excel',requirement:'Excel bilikləri'}],missingRequired:[],missingPreferred:[],other:[]});
      const result=await service.getMatchSkills('user_1','match_1');
      const proposal=(field:string)=>result.motivationSuggestions.find((s)=>s.field===field)?.text;
      expect(proposal('whyRole')).toContain('Müştəri sifarişləri üzrə satış hesabatlarının hazırlanması');
      expect(proposal('whyRole')).toContain('[bu tapşırığın sizi niyə cəlb etdiyini yazın]');
      expect(proposal('whyRole')).not.toContain('MS Excel');
      expect(proposal('whyCompany')).toContain('Example Distribution');
      expect(proposal('whyCompany')).toContain('[yoxladığınız konkret məhsul');
      expect(proposal('whyCompany')).not.toContain('qiymətlərinin monitorinq');
      expect(proposal('contribution')).toContain('MS Excel');
      expect(result.motivationSuggestions.map((s)=>s.text).join(' ')).not.toMatch(/lider|prestij|innovativ|mədəniyyət|konkret nəticələr verən/iu);
    });

    it('frames nominal responsibility phrases as quoted tasks instead of attaching them to an unnatural verb', async () => {
      prisma.match.findUnique.mockResolvedValue({ id: 'match_1', userId: 'user_1', jobId: 'job_1', job: {
        title: 'Müştəri xidmətləri üzrə kiçik mütəxəssis', company: 'Example Bank',
        description: 'Responsibilities:\nMövcud müştərilərlə danışıqların aparılması;\nMüştəri müraciətlərinin cavablandırılması;',
      } });
      prisma.profile.findUnique.mockResolvedValue({ experiences: [{ title: 'Service Intern', company: 'Example',
        description: 'Müştəri müraciətlərini qeydiyyata aldım.' }] });
      (service as any).jobCatalogueService.skillGuidance = jest.fn().mockResolvedValue({
        evidenced: [], missingRequired: [], missingPreferred: [], other: [],
      });

      const result = await service.getMatchSkills('user_1', 'match_1');
      const roleProposals = result.motivationSuggestions.filter((s) => s.field === 'whyRole');
      expect(roleProposals.length).toBeGreaterThan(0);
      expect(roleProposals[0].text).toContain('“Müştəri müraciətlərinin cavablandırılması” tapşırığı');
      expect(roleProposals[0].text).toContain('[bu tapşırığın sizi niyə cəlb etdiyini yazın]');
      expect(roleProposals.map((s) => s.text).join(' ')).not.toMatch(/Məni bu vəzifədə .* cəlb edir/iu);
      expect(roleProposals.every((s) => s.sourceText)).toBe(true);
    });

    it('offers multiple grounded alternatives and actionable tips without mixing English facts into AZ answers', async () => {
      prisma.match.findUnique.mockResolvedValue({id:'match_1', userId:'user_1',jobId:'j1',job:{title:'Sales Specialist',company:'Example',description:`Responsibilities:
Satış hesabatlarının hazırlanması;
Müştəri sifarişlərinin təhlili;
Requirements:
Excel bilikləri;`}});
      prisma.profile.findUnique.mockResolvedValue({experiences:[{title:'Analyst',description:'Created sales reports for 10,000 customers using Excel.'}]});
      (service as any).jobCatalogueService.skillGuidance.mockResolvedValue({evidenced:[{skill:'Excel',requirement:'Excel bilikləri'}], missingRequired:[{skill:'CRM',requirement:'CRM bilikləri'}],missingPreferred:[],other:[]});
      const result = await service.getMatchSkills('user_1','match_1');
      expect(result.motivationSuggestions.filter(s=>s.field==='whyRole').length).toBeGreaterThan(1);
      expect(result.motivationSuggestions.filter(s=>s.field==='contribution').length).toBeGreaterThan(1);
      expect(result.motivationSuggestions.map(s=>s.text).join(' ')).not.toContain('Created sales');
      expect(result.motivationGuidance.some(g=>g.field==='translation')).toBe(true);
      expect(result.motivationGuidance.find(g=>g.field==='gaps')?.tip).toContain('CRM');
      expect(result.motivationSuggestions.every(s=>!!s.tip)).toBe(true);
      expect(result.motivationSuggestions.find(s=>s.field==='whyRole')?.sourceText).toBe('Satış hesabatlarının hazırlanması');
    });

    it('rejects another user accessing match skills', async () => {
      prisma.match.findUnique.mockResolvedValue({ id: 'match_1', userId: 'other_user', jobId: 'job_1' });
      await expect(service.getMatchSkills('user_1', 'match_1')).rejects.toThrow('Uyğunluq tapılmadı');
    });
  });
});
