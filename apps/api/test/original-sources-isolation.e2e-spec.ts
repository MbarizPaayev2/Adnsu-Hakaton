import { TestLeases } from './support/source-lease';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../src/database/database.service';
import { ApiKeyGuard } from '../src/jobs/api-key.guard';
import { JobsController } from '../src/jobs/jobs.controller';
import { JobsService } from '../src/jobs/jobs.service';
import { JobSourceService, sourceHealth } from '../src/jobs/job-source.service';
import { ingestPublicJob, reportImportRun } from '../src/scripts/import-public-jobs';
import type { IngestJobDto } from '../src/jobs/dto/ingest-job.dto';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';

describe('Original sources isolation, source health, and closure reconciliation', () => {
  const token = 'test-orig-sources-token';
  let leases: TestLeases;
  const stamp = `orig-iso-${Date.now()}`;
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  let jobs: JobsService;
  let sources: JobSourceService;

  const queue = { add: jest.fn(async () => ({})) };

  const pashaJob1: IngestJobDto = {
    externalId: `pasha-holding:${stamp}-1`,
    title: 'Audit Manager',
    company: 'PASHA Holding',
    description: 'Lead audit team and ensure financial regulatory compliance.',
    location: 'Baku, Azerbaijan',
    url: `https://apply.workable.com/pasha-holding/j/${stamp}1`,
    postedAt: '2026-09-01T00:00:00.000Z',
    rawPayload: { source: 'pasha-holding', tenant: 'pasha-holding', employer: 'pasha-holding' },
  };

  const pashaJob2: IngestJobDto = {
    externalId: `pasha-holding:${stamp}-2`,
    title: 'Senior Risk Analyst',
    company: 'PASHA Holding',
    description: 'Enterprise risk management and credit risk modeling.',
    location: 'Baku, Azerbaijan',
    url: `https://apply.workable.com/pasha-holding/j/${stamp}2`,
    postedAt: '2026-09-05T00:00:00.000Z',
    rawPayload: { source: 'pasha-holding', tenant: 'pasha-holding', employer: 'pasha-holding' },
  };

  const yeloJob1: IngestJobDto = {
    externalId: `yelo:${stamp}-1`,
    title: 'Data Analyst',
    company: 'Yelo Bank',
    description: 'Analyze retail banking customer retention and credit card portfolio.',
    location: 'Bakı',
    url: `https://www.yelo.az/az/about-bank/vacancies/?vacancy=${stamp}-1`,
    postedAt: '2026-09-10T00:00:00.000Z',
    rawPayload: { source: 'yelo', employer: 'yelo-bank' },
  };

  const yeloJob2: IngestJobDto = {
    externalId: `yelo:${stamp}-2`,
    title: 'Branch Specialist',
    company: 'Yelo Bank',
    description: 'Serve retail banking clients in Ganja regional branch.',
    location: 'Gəncə',
    url: `https://www.yelo.az/az/about-bank/vacancies/?vacancy=${stamp}-2`,
    postedAt: '2026-09-12T00:00:00.000Z',
    rawPayload: { source: 'yelo', employer: 'yelo-bank' },
  };

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') {
      throw new Error('Requires the isolated local aise_phase2_test database on 5433');
    }

    const module = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        PrismaService,
        JobsService,
        JobSourceService,
        ApiKeyGuard,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'SCRAPER_SERVICE_TOKEN' ? token : undefined) },
        },
        { provide: getQueueToken('job-ingested'), useValue: queue },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();

    prisma = app.get(PrismaService);
    jobs = app.get(JobsService);
    sources = app.get(JobSourceService);
    leases = new TestLeases(prisma);
    await leases.take('pasha-holding', 'yelo');
  });

  afterAll(async () => {
    await leases?.releaseAll();
    if (prisma) {
      await prisma.job.deleteMany({
        where: {
          externalId: {
            in: [pashaJob1.externalId, pashaJob2.externalId, yeloJob1.externalId, yeloJob2.externalId],
          },
        },
      });
      await prisma.jobImportRun.deleteMany({
        where: {
          source: { in: ['pasha-holding', 'yelo'] },
          runKey: { contains: stamp },
        },
      });
    }
    if (app) await app.close();
  });

  it('1. accepts authentic jobs for pasha-holding and yelo through local ingest route', async () => {
    const out1 = await ingestPublicJob(pashaJob1, base, token, leases.of('pasha-holding'));
    const out2 = await ingestPublicJob(pashaJob2, base, token, leases.of('pasha-holding'));
    const out3 = await ingestPublicJob(yeloJob1, base, token, leases.of('yelo'));
    const out4 = await ingestPublicJob(yeloJob2, base, token, leases.of('yelo'));

    expect(out1).toBe('created');
    expect(out2).toBe('created');
    expect(out3).toBe('created');
    expect(out4).toBe('created');

    const dbPasha1 = await prisma.job.findUniqueOrThrow({ where: { externalId: pashaJob1.externalId } });
    expect(dbPasha1.company).toBe('PASHA Holding');
    expect(dbPasha1.status).toBe('ACTIVE');

    const dbYelo1 = await prisma.job.findUniqueOrThrow({ where: { externalId: yeloJob1.externalId } });
    expect(dbYelo1.company).toBe('Yelo Bank');
    expect(dbYelo1.status).toBe('ACTIVE');
  });

  it('2. accepts run reports with source="pasha-holding" and rejects colons like "workable:pasha-holding"', async () => {
    const startedAt = new Date(Date.now() - 30_000);

    // Rejected because of colons
    const badReport = {
      source: 'workable:pasha-holding',
      startedAt: startedAt.toISOString(),
      complete: true,
      pages: 1,
      discovered: 2,
      fetched: 2,
      accepted: 2,
      created: 2,
      updated: 0,
      unchanged: 0,
      reopened: 0,
      expired: 0,
      skipped: 0,
      failed: 0,
    };
    const resBad = await fetch(`${base}/internal/jobs/import-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(badReport),
    });
    expect(resBad.status).toBe(400);

    // Accepted with standard per-employer source: "pasha-holding"
    const pashaReport = {
      source: 'pasha-holding',
      complete: true,
      pages: 1,
      discovered: 2,
      fetched: 2,
      accepted: 2,
      expired: 0,
      failed: 0,
    };
    const tally = { created: 2, updated: 0, unchanged: 0, reopened: 0 };
    const pashaRun = await reportImportRun(pashaReport, tally, startedAt, base, token, leases.of('pasha-holding'));
    expect(pashaRun.status).toBe('SUCCEEDED');

    // Accepted for yelo
    const yeloReport = {
      source: 'yelo',
      complete: true,
      pages: 1,
      discovered: 2,
      fetched: 2,
      accepted: 2,
      expired: 0,
      failed: 0,
    };
    const yeloRun = await reportImportRun(yeloReport, tally, startedAt, base, token, leases.of('yelo'));
    expect(yeloRun.status).toBe('SUCCEEDED');
  });

  it('3. reports correct per-employer counts in sourceHealth', async () => {
    const health = await sourceHealth(prisma, new Date());

    const pashaHealth = health.find((s) => s.key === 'pasha-holding');
    expect(pashaHealth).toBeDefined();
    expect(pashaHealth!.enabled).toBe(true);
    expect(pashaHealth!.counts.active).toBeGreaterThanOrEqual(2);
    expect(pashaHealth!.lastRunStatus).toBe('SUCCEEDED');

    const yeloHealth = health.find((s) => s.key === 'yelo');
    expect(yeloHealth).toBeDefined();
    expect(yeloHealth!.enabled).toBe(true);
    expect(yeloHealth!.counts.active).toBeGreaterThanOrEqual(2);
    expect(yeloHealth!.lastRunStatus).toBe('SUCCEEDED');
  });

  it('4. re-import is safe and idempotent', async () => {
    // Re-importing exact same job returns 'unchanged'
    const out = await ingestPublicJob(pashaJob1, base, token, leases.of('pasha-holding'));
    expect(out).toBe('unchanged');

    // Ensure total job count for this externalId is still 1
    const count = await prisma.job.count({ where: { externalId: pashaJob1.externalId } });
    expect(count).toBe(1);
  });

  it('5. one tenant run cannot affect another tenant jobs during closure reconciliation', async () => {
    // Both pasha-holding jobs and yelo jobs start ACTIVE
    const beforeYelo1 = await prisma.job.findUniqueOrThrow({ where: { externalId: yeloJob1.externalId } });
    const beforeYelo2 = await prisma.job.findUniqueOrThrow({ where: { externalId: yeloJob2.externalId } });
    expect(beforeYelo1.status).toBe('ACTIVE');
    expect(beforeYelo2.status).toBe('ACTIVE');

    // Clear prior import runs for pasha-holding to test clean 2-step closure sequence
    await prisma.jobImportRun.deleteMany({ where: { source: 'pasha-holding' } });

    // Set baseline lastSeenAt for pashaJob2 to 3 minutes ago
    const t0 = new Date(Date.now() - 180_000);
    await prisma.job.update({
      where: { externalId: pashaJob2.externalId },
      data: { lastSeenAt: t0, missedImports: 0, status: 'ACTIVE' },
    });

    // Simulate run 1 for pasha-holding where job-2 is omitted from source
    // Only job-1 is refreshed at run1StartedAt
    const run1StartedAt = new Date(Date.now() - 60_000);
    await jobs.upsertJob(pashaJob1, new Date(Date.now() - 50_000));
    const pashaRun1 = await sources.recordRun(
      {
        source: 'pasha-holding',
        startedAt: run1StartedAt.toISOString(),
        complete: true,
        pages: 1,
        discovered: 1,
        fetched: 1,
        accepted: 1,
        created: 0,
        updated: 0,
        unchanged: 1,
        reopened: 0,
        expired: 0,
        skipped: 0,
        failed: 0,
      },
      new Date(Date.now() - 40_000),
    );
    expect(pashaRun1.status).toBe('SUCCEEDED');
    expect(pashaRun1.closed).toBe(0);

    const midPasha2 = await prisma.job.findUniqueOrThrow({ where: { externalId: pashaJob2.externalId } });
    expect(midPasha2.missedImports).toBe(1);
    expect(midPasha2.status).toBe('ACTIVE');

    // Simulate run 2 for pasha-holding where job-2 is omitted AGAIN
    const run2StartedAt = new Date(Date.now() - 20_000);
    await jobs.upsertJob(pashaJob1, new Date(Date.now() - 15_000));
    const pashaRun2 = await sources.recordRun(
      {
        source: 'pasha-holding',
        startedAt: run2StartedAt.toISOString(),
        complete: true,
        pages: 1,
        discovered: 1,
        fetched: 1,
        accepted: 1,
        created: 0,
        updated: 0,
        unchanged: 1,
        reopened: 0,
        expired: 0,
        skipped: 0,
        failed: 0,
      },
      new Date(),
    );
    expect(pashaRun2.status).toBe('SUCCEEDED');
    expect(pashaRun2.closed).toBe(1);

    const closedPasha2 = await prisma.job.findUniqueOrThrow({ where: { externalId: pashaJob2.externalId } });
    expect(closedPasha2.status).toBe('CLOSED');
    expect(closedPasha2.closedReason).toBe('source_removed_from_complete_listing');

    // Check pashaJob1 is still ACTIVE
    const activePasha1 = await prisma.job.findUniqueOrThrow({ where: { externalId: pashaJob1.externalId } });
    expect(activePasha1.status).toBe('ACTIVE');

    // CRITICAL ISOLATION CHECK:
    // Yelo jobs were NOT refreshed in the pasha-holding run, but MUST NOT be touched!
    const afterYelo1 = await prisma.job.findUniqueOrThrow({ where: { externalId: yeloJob1.externalId } });
    const afterYelo2 = await prisma.job.findUniqueOrThrow({ where: { externalId: yeloJob2.externalId } });
    expect(afterYelo1.status).toBe('ACTIVE');
    expect(afterYelo1.missedImports).toBe(0);
    expect(afterYelo2.status).toBe('ACTIVE');
    expect(afterYelo2.missedImports).toBe(0);
  });

  it('6. rejects run reports for unverified/disabled sources', async () => {
    const disabledSources = ['pasha-capital', 'bakcell', 'azerconnect', 'accessbank', 'unibank'];
    const startedAt = new Date('2026-10-02T15:00:00Z');

    for (const src of disabledSources) {
      const report = {
        source: src,
        startedAt: startedAt.toISOString(),
        complete: true,
        pages: 1,
        discovered: 1,
        fetched: 1,
        accepted: 1,
        created: 1,
        updated: 0,
        unchanged: 0,
        reopened: 0,
        expired: 0,
        skipped: 0,
        failed: 0,
      };
      const res = await fetch(`${base}/internal/jobs/import-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(report),
      });
      // 404 from NotFoundException('Unknown or disabled source')
      expect(res.status).toBe(404);
    }
  });
});
