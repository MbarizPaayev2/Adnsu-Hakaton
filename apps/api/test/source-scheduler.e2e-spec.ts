import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../src/database/database.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobSourceService } from '../src/jobs/job-source.service';
import { FeatureFlagsService } from '../src/operations/feature-flags.service';
import { EMPLOYER_BUDGET, SCHEDULED_LIMITS, SourceScheduler, defaultCollectorFactory, nextRunAfter, type CollectorLike } from '../src/jobs/source-scheduler.service';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';

/** Synthetic source responses only: no network. Local rehearsal of the scheduler; production schedules stay off. */
describe('scheduled source refresh (disabled by default; synthetic collectors, isolated Postgres)', () => {
  const stamp = `${Date.now()}`;
  const keyA = `sch${stamp}a`, keyB = `sch${stamp}b`;
  let prisma: PrismaService, scheduler: SourceScheduler, flags: FeatureFlagsService;
  const calls: { key: string; options: unknown }[] = [];
  let behavior: Record<string, 'ok' | 'throw' | 'incomplete' | 'slow' | 'bounded'> = {};
  let release: (() => void) | undefined;
  const t0 = new Date('2026-10-02T08:00:00Z');
  const min = (n: number) => new Date(t0.getTime() + n * 60_000);

  const collectorFor = (key: string): CollectorLike | null => (![keyA, keyB].includes(key) ? null : {
    async collect(options, accept) {
      calls.push({ key, options });
      const mode = behavior[key] ?? 'ok';
      if (mode === 'throw') throw new Error('synthetic source outage');
      if (mode === 'slow') await new Promise<void>((resolve) => { release = resolve; });
      await accept({ externalId: `${key}:one`, title: 'Scheduled Role', company: `${stamp} Co`, description: 'Public description', location: 'Bakı', url: 'https://example.org/1', postedAt: '2026-09-01T00:00:00Z' });
      return {
        source: key, complete: mode === 'ok' || mode === 'slow',
        outcome: mode === 'incomplete' ? 'UPSTREAM_FAILURE' : mode === 'bounded' ? 'BOUNDED_PROGRESS' : 'COMPLETE_CENSUS',
        pages: 1, discovered: 1, fetched: 1, accepted: 1, expired: 0, failed: 0,
        ...(mode === 'incomplete' ? { error: 'Some details could not be parsed; no closures inferred' } : {}),
        ...(mode === 'bounded' ? { error: 'Collection limit reached; run is bounded and incomplete' } : {}),
      };
    },
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService, JobsService, JobSourceService, FeatureFlagsService, SourceScheduler, { provide: getQueueToken('job-ingested'), useValue: { add: async () => ({}) } }],
    }).compile();
    prisma = module.get(PrismaService); scheduler = module.get(SourceScheduler); flags = module.get(FeatureFlagsService);
    scheduler.collectors = collectorFor;
    for (const key of [keyA, keyB]) await prisma.jobSource.create({ data: { key, name: key, homepageUrl: 'https://example.org', collectionMethod: 'synthetic', scope: 'test', applicationMethods: ['EXTERNAL_SITE'] } });
  });
  afterAll(async () => {
    delete process.env.SOURCE_SCHEDULE_ENABLED;
    await prisma.job.deleteMany({ where: { externalId: { startsWith: `sch${stamp}` } } });
    await prisma.jobImportRun.deleteMany({ where: { source: { in: [keyA, keyB] } } });
    await prisma.jobSource.deleteMany({ where: { key: { in: [keyA, keyB] } } });
    await prisma.featureFlag.deleteMany({ where: { key: 'import.scheduled' } });
    await prisma.$disconnect();
  });
  beforeEach(() => { calls.length = 0; behavior = {}; delete process.env.SOURCE_SCHEDULE_ENABLED; });

  it('does nothing at all unless the deployment enables it, and then only for scheduled, unpaused, unrestricted sources', async () => {
    await prisma.jobSource.update({ where: { key: keyA }, data: { scheduled: true } });
    expect((await scheduler.tick(t0)).ran).toBeNull(); // deployment switch off
    process.env.SOURCE_SCHEDULE_ENABLED = 'true';
    await prisma.featureFlag.upsert({ where: { key: 'import.scheduled' }, create: { key: 'import.scheduled', paused: true }, update: { paused: true } });
    expect((await scheduler.tick(t0)).ran).toBeNull(); // operator pause
    await prisma.featureFlag.update({ where: { key: 'import.scheduled' }, data: { paused: false } });
    await prisma.jobSource.update({ where: { key: keyA }, data: { schedulePausedAt: new Date() } });
    expect((await scheduler.tick(t0)).ran).toBeNull(); // per-source pause
    await prisma.jobSource.update({ where: { key: keyA }, data: { schedulePausedAt: null, accessReview: 'RESTRICTED' } });
    expect((await scheduler.tick(t0)).ran).toBeNull(); // restricted
    await prisma.jobSource.update({ where: { key: keyA }, data: { accessReview: 'UNREVIEWED', scheduled: false } });
    expect((await scheduler.tick(t0)).ran).toBeNull(); // not scheduled
    await prisma.jobSource.update({ where: { key: 'glorri' }, data: { nextRunAt: null } });
    expect((await scheduler.tick(t0)).ran).toBeNull(); // Glorri keeps its own importer
    expect(calls).toEqual([]);
  });

  it('runs one due source per tick within bounded limits, records the run, and schedules the next at the interval', async () => {
    process.env.SOURCE_SCHEDULE_ENABLED = 'true';
    await prisma.jobSource.updateMany({ where: { key: { in: [keyA, keyB] } }, data: { scheduled: true, intervalMinutes: 720, nextRunAt: null, consecutiveFailures: 0 } });
    const first = await scheduler.tick(t0);
    expect(first).toMatchObject({ result: 'SUCCEEDED' });
    expect(calls).toHaveLength(1); // one source per tick
    expect(calls[0].options).toMatchObject(EMPLOYER_BUDGET); // not a job board: the employer budget (boards: see source-automation.e2e-spec)
    expect(EMPLOYER_BUDGET.maxPages).toBeLessThanOrEqual(SCHEDULED_LIMITS.maxPages);
    expect(EMPLOYER_BUDGET.maxJobs).toBeLessThanOrEqual(SCHEDULED_LIMITS.maxJobs);
    expect(EMPLOYER_BUDGET.delayMs).toBeGreaterThanOrEqual(1500);
    const ran = first.ran!;
    expect(await prisma.job.count({ where: { externalId: `${ran}:one` } })).toBe(1);
    expect(await prisma.jobSource.findUniqueOrThrow({ where: { key: ran } })).toMatchObject({ consecutiveFailures: 0, leaseUntil: null });
    const nextAt = (await prisma.jobSource.findUniqueOrThrow({ where: { key: ran } })).nextRunAt!;
    expect(nextAt.getTime() - Date.now()).toBeGreaterThan(719 * 60_000); // measured from the real clock the run finished at
    // The other source is still due, so the next tick takes it; the first is not due again.
    const second = await scheduler.tick(min(1));
    expect(second.ran).not.toBe(ran);
    expect((await scheduler.tick(min(2))).ran).toBeNull();
    expect(nextRunAfter(t0, 720, 0).getTime() - t0.getTime()).toBe(720 * 60_000);
  });

  it('cannot run the same source twice at once across overlapping processes', async () => {
    process.env.SOURCE_SCHEDULE_ENABLED = 'true';
    await prisma.jobSource.updateMany({ where: { key: { in: [keyA, keyB] } }, data: { scheduled: false } });
    await prisma.jobSource.update({ where: { key: keyA }, data: { scheduled: true, nextRunAt: null, leaseUntil: null } });
    behavior[keyA] = 'slow';
    const one = scheduler.tick(t0);
    await new Promise((r) => setTimeout(r, 300));
    const two = await scheduler.tick(t0); // a second process while the first holds the lease
    expect(two.ran).toBeNull();
    release!();
    expect((await one).ran).toBe(keyA);
    expect(calls.filter((c) => c.key === keyA)).toHaveLength(1);
  });

  it('backs off exponentially after failures, closes nothing, and recovers on success', async () => {
    process.env.SOURCE_SCHEDULE_ENABLED = 'true';
    await prisma.jobSource.updateMany({ where: { key: { in: [keyA, keyB] } }, data: { scheduled: false } });
    await prisma.jobSource.update({ where: { key: keyB }, data: { scheduled: true, intervalMinutes: 360, nextRunAt: null, consecutiveFailures: 0, leaseUntil: null } });
    behavior[keyB] = 'throw';
    expect(await scheduler.tick(t0)).toMatchObject({ ran: keyB, result: 'FAILED' });
    let row = await prisma.jobSource.findUniqueOrThrow({ where: { key: keyB } });
    expect(row.consecutiveFailures).toBe(1);
    expect(row.nextRunAt!.getTime() - Date.now()).toBeGreaterThan(719 * 60_000); // 360 * 2
    await prisma.jobSource.update({ where: { key: keyB }, data: { nextRunAt: null } });
    behavior[keyB] = 'incomplete';
    expect((await scheduler.tick(t0)).result).toBe('PARTIAL');
    row = await prisma.jobSource.findUniqueOrThrow({ where: { key: keyB } });
    expect(row.consecutiveFailures).toBe(2);
    expect(row.nextRunAt!.getTime() - Date.now()).toBeGreaterThan(1439 * 60_000); // 360 * 4
    expect((await prisma.job.findUniqueOrThrow({ where: { externalId: `${keyB}:one` } })).status).toBe('ACTIVE'); // an incomplete run closes nothing
    await prisma.jobSource.update({ where: { key: keyB }, data: { nextRunAt: null } });
    behavior[keyB] = 'ok';
    expect((await scheduler.tick(t0)).result).toBe('SUCCEEDED');
    expect((await prisma.jobSource.findUniqueOrThrow({ where: { key: keyB } })).consecutiveFailures).toBe(0);
    expect(nextRunAfter(t0, 10_000, 8).getTime() - t0.getTime()).toBe(7 * 24 * 60 * 60_000); // capped at a week
  });

  it('treats a run bounded by its limits (as every board collector is) as healthy, not as a failure, while it never counts as a fresh complete listing', async () => {
    process.env.SOURCE_SCHEDULE_ENABLED = 'true';
    await prisma.jobSource.updateMany({ where: { key: { in: [keyA, keyB] } }, data: { scheduled: false } });
    await prisma.jobSource.update({ where: { key: keyA }, data: { scheduled: true, intervalMinutes: 360, nextRunAt: null, consecutiveFailures: 0, leaseUntil: null } });
    await prisma.jobImportRun.deleteMany({ where: { source: keyA } }); // earlier tests left a complete run for this source
    behavior[keyA] = 'bounded';
    expect((await scheduler.tick(t0)).result).toBe('PARTIAL');
    const row = await prisma.jobSource.findUniqueOrThrow({ where: { key: keyA } });
    expect(row.consecutiveFailures).toBe(0);
    expect(row.nextRunAt!.getTime() - Date.now()).toBeLessThan(361 * 60_000);
    const health = (await new JobSourceService(prisma, undefined as never).health()).find((s) => s.key === keyA)!;
    expect(health.schedule.staleness).toBe('never_completed');
  });

  it('knows every reviewed collector and none of the quarantined tenants', () => {
    for (const key of ['hellojob', 'abb', 'pwc', 'smartjob', 'boss', 'work', 'yelo', 'socar', 'azercell', 'ey', 'halliburton', 'pasha-holding', 'pasha-insurance']) expect(defaultCollectorFactory(key)).not.toBeNull();
    for (const key of ['accessbank', 'azerconnect', 'pasha-capital', 'bakcell', 'unibank', 'glorri']) expect(defaultCollectorFactory(key)).toBeNull();
  });

  it('labels sources honestly: scheduled, paused or manual, with stale and never-completed visible', async () => {
    const sources = new JobSourceService(prisma, undefined as never);
    await prisma.jobSource.update({ where: { key: keyA }, data: { scheduled: false } });
    await prisma.jobSource.update({ where: { key: keyB }, data: { scheduled: true, schedulePausedAt: new Date() } });
    const health = await sources.health();
    const a = health.find((s) => s.key === keyA)!, b = health.find((s) => s.key === keyB)!, g = health.find((s) => s.key === 'glorri')!;
    expect(a.schedule).toMatchObject({ mode: 'manual', staleness: 'not_scheduled' });
    expect(b.schedule.mode).toBe('paused');
    expect(g.schedule).toMatchObject({ mode: 'scheduled', staleness: 'own_importer' });
    expect(SourceScheduler.staleness({ scheduled: true, intervalMinutes: 60 }, null)).toBe('never_completed');
    expect(SourceScheduler.staleness({ scheduled: true, intervalMinutes: 60 }, new Date(Date.now() - 3 * 3600_000))).toBe('stale');
    expect(SourceScheduler.staleness({ scheduled: true, intervalMinutes: 60 }, new Date(Date.now() - 30 * 60_000))).toBe('fresh');
  });
});
