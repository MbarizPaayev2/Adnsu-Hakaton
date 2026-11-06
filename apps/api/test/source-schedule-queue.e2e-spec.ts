import { Test } from '@nestjs/testing';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../src/database/database.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobSourceService } from '../src/jobs/job-source.service';
import { FeatureFlagsService } from '../src/operations/feature-flags.service';
import { SourceScheduler, type CollectorLike } from '../src/jobs/source-scheduler.service';
import { SourceScheduleProcessor, SourceScheduleRegistrar } from '../src/jobs/source-schedule.processor';

// Real Redis/BullMQ under a private prefix and a disposable Postgres (DATABASE_URL): the real registrar, processor and worker, synthetic collector, no network.
process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';

describe('scheduled collection through the real BullMQ worker (private Redis prefix)', () => {
  const stamp = `${Date.now()}`;
  const prefix = `aise-sched-${stamp}`;
  const key = `qu${stamp}`;
  const boot = async () => {
    const module = await Test.createTestingModule({
      imports: [BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }), BullModule.registerQueue({ name: 'source-schedule' })],
      providers: [PrismaService, JobsService, JobSourceService, FeatureFlagsService, SourceScheduler, SourceScheduleProcessor, SourceScheduleRegistrar,
        { provide: getQueueToken('job-ingested'), useValue: { add: async () => ({}) } }],
    }).compile();
    const app = module.createNestApplication();
    const collector: CollectorLike = { async collect(_o, accept) {
      await accept({ externalId: `${key}:1`, title: 'Queued Role', company: `${stamp} Co`, description: 'd', location: 'Bakı', url: 'https://example.org/1', postedAt: '2026-09-01T00:00:00Z' });
      return { source: key, complete: true, pages: 1, discovered: 1, fetched: 1, accepted: 1, expired: 0, failed: 0 };
    } };
    module.get(SourceScheduler).collectors = (k) => (k === key ? collector : null);
    await app.init();
    return { app, module };
  };
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.SOURCE_SCHEDULE_ENABLED = 'true';
    const probe = await Test.createTestingModule({ providers: [PrismaService] }).compile();
    prisma = probe.get(PrismaService);
    await prisma.jobSource.create({ data: { key, name: key, homepageUrl: 'https://example.org', collectionMethod: 'synthetic', scope: 'test', applicationMethods: ['EXTERNAL_SITE'], scheduled: true, intervalMinutes: 720 } });
  });
  afterAll(async () => {
    delete process.env.SOURCE_SCHEDULE_ENABLED;
    await prisma.job.deleteMany({ where: { externalId: { startsWith: `${key}:` } } });
    await prisma.jobImportRun.deleteMany({ where: { source: key } });
    await prisma.jobSource.deleteMany({ where: { key } });
    await prisma.$disconnect();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 }); // only this test's private prefix
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('registers one repeating tick however many times the API restarts, and removes it when the schedule is switched off', async () => {
    for (let i = 0; i < 3; i++) { const { app, module } = await boot(); const q = module.get<Queue>(getQueueToken('source-schedule')); expect((await q.getRepeatableJobs())).toHaveLength(1); await app.close(); }
    delete process.env.SOURCE_SCHEDULE_ENABLED;
    const { app, module } = await boot();
    const q = module.get<Queue>(getQueueToken('source-schedule'));
    expect(await q.getRepeatableJobs()).toHaveLength(0);
    process.env.SOURCE_SCHEDULE_ENABLED = 'true';
    await app.close();
  });

  it('a tick delivered to the real worker collects the due source, records the run and schedules the next', async () => {
    const { app, module } = await boot();
    const queue = module.get<Queue>(getQueueToken('source-schedule'));
    try {
      await prisma.jobSource.update({ where: { key }, data: { nextRunAt: null, leaseUntil: null, consecutiveFailures: 0 } });
      await queue.add('source-schedule-tick', {}); // what the repeating job delivers
      const end = Date.now() + 30_000;
      while (Date.now() < end && !(await prisma.jobImportRun.count({ where: { source: key, status: 'SUCCEEDED' } }))) await new Promise((r) => setTimeout(r, 250));
      expect(await prisma.jobImportRun.count({ where: { source: key, status: 'SUCCEEDED' } })).toBe(1);
      expect(await prisma.job.count({ where: { externalId: `${key}:1`, status: 'ACTIVE' } })).toBe(1);
      const row = await prisma.jobSource.findUniqueOrThrow({ where: { key } });
      expect(row.leaseUntil).toBeNull();
      expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    } finally {
      await queue.obliterate({ force: true }).catch(() => undefined);
      await app.close();
    }
  });
});
