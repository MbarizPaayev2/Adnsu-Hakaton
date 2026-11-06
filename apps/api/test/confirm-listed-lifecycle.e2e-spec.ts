import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../src/database/database.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobSourceService } from '../src/jobs/job-source.service';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_lifecycle_isolated_test?schema=public';

describe('confirmListed and lifecycle edge cases against real PostgreSQL', () => {
  const stamp = `lifecycle-${Date.now()}`;
  const prefix = `testsrc_${stamp}`;
  let prisma: PrismaService;
  let jobsService: JobsService;
  let primaryJobId: string;

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_lifecycle_isolated_test') {
      throw new Error('Requires the isolated local aise_lifecycle_isolated_test database');
    }

    const queue = { add: jest.fn(async () => ({})) };
    const module = await Test.createTestingModule({
      providers: [
        PrismaService,
        JobsService,
        JobSourceService,
        { provide: 'BullQueue_job-ingested', useValue: queue },
        { provide: 'BullQueue_new-job-alert', useValue: queue },
      ],
    }).compile();

    prisma = module.get(PrismaService);
    jobsService = module.get(JobsService);

    // Create a base primary job to test duplicate linking
    const primary = await prisma.job.create({
      data: {
        externalId: `${prefix}:primary`,
        title: 'Primary Job',
        company: 'ACME Test',
        location: 'Bakı',
        url: `https://example.org/jobs/${prefix}-primary`,
        description: 'Primary job for testing duplicate preservation in lifecycle tests',
        postedAt: new Date('2026-10-01T10:00:00Z'),
        status: 'ACTIVE',
      },
    });
    primaryJobId = primary.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.job.deleteMany({
        where: {
          externalId: { startsWith: `${prefix}:` },
        },
      });
    }
  });

  it('accurately counts distinct active and reopened jobs without double-counting', async () => {
    const t0 = new Date('2026-10-01T10:00:00Z');
    const t1 = new Date('2026-10-02T10:00:00Z');

    // Create 1 active job and 1 crawler-closed job
    await prisma.job.create({
      data: {
        externalId: `${prefix}:active-1`,
        title: 'Active Job 1',
        company: 'ACME Test',
        location: 'Bakı',
        url: `https://example.org/jobs/${prefix}-active-1`,
        description: 'Test description for active job',
        postedAt: t0,
        lastSeenAt: t0,
        status: 'ACTIVE',
      },
    });

    await prisma.job.create({
      data: {
        externalId: `${prefix}:closed-reopenable`,
        title: 'Closed Reopenable Job',
        company: 'ACME Test',
        location: 'Bakı',
        url: `https://example.org/jobs/${prefix}-closed-reopenable`,
        description: 'Test description for crawler closed job',
        postedAt: t0,
        lastSeenAt: t0,
        status: 'CLOSED',
        closedReason: 'source_removed_from_complete_listing',
        closedAt: t0,
        deadline: new Date('2026-12-01T10:00:00Z'), // valid future deadline
      },
    });

    // Confirm both in a single call
    const result = await jobsService.confirmListed(
      [`${prefix}:active-1`, `${prefix}:closed-reopenable`],
      t1,
    );

    // Must report confirmed: 2, reopened: 1 (active was confirmed, closed was reopened)
    expect(result).toEqual({ confirmed: 2, reopened: 1 });

    // Verify row states
    const activeRow = await prisma.job.findUniqueOrThrow({ where: { externalId: `${prefix}:active-1` } });
    expect(activeRow.status).toBe('ACTIVE');
    expect(activeRow.lastSeenAt.toISOString()).toBe(t1.toISOString());

    const reopenedRow = await prisma.job.findUniqueOrThrow({ where: { externalId: `${prefix}:closed-reopenable` } });
    expect(reopenedRow.status).toBe('ACTIVE');
    expect(reopenedRow.closedAt).toBeNull();
    expect(reopenedRow.closedReason).toBeNull();
    expect(reopenedRow.lastSeenAt.toISOString()).toBe(t1.toISOString());
  });

  it('strictly preserves manually closed postings and never reopens them', async () => {
    const t0 = new Date('2026-10-01T10:00:00Z');
    const t1 = new Date('2026-10-02T10:00:00Z');

    await prisma.job.create({
      data: {
        externalId: `${prefix}:manual-closed`,
        title: 'Manually Closed Job',
        company: 'ACME Test',
        location: 'Bakı',
        url: `https://example.org/jobs/${prefix}-manual-closed`,
        description: 'Closed manually by employer or admin',
        postedAt: t0,
        lastSeenAt: t0,
        status: 'CLOSED',
        closedReason: 'manual_employer_closed',
        closedAt: t0,
      },
    });

    const result = await jobsService.confirmListed([`${prefix}:manual-closed`], t1);
    expect(result).toEqual({ confirmed: 0, reopened: 0 });

    const row = await prisma.job.findUniqueOrThrow({ where: { externalId: `${prefix}:manual-closed` } });
    expect(row.status).toBe('CLOSED');
    expect(row.closedReason).toBe('manual_employer_closed');
  });

  it('strictly preserves moderated postings (hiddenAt !== null) and never reopens them', async () => {
    const t0 = new Date('2026-10-01T10:00:00Z');
    const t1 = new Date('2026-10-02T10:00:00Z');

    await prisma.job.create({
      data: {
        externalId: `${prefix}:moderated`,
        title: 'Moderated Job',
        company: 'ACME Test',
        location: 'Bakı',
        url: `https://example.org/jobs/${prefix}-moderated`,
        description: 'Moderated posting',
        postedAt: t0,
        lastSeenAt: t0,
        status: 'CLOSED',
        closedReason: 'source_removed_from_complete_listing',
        hiddenAt: t0, // moderated
        closedAt: t0,
      },
    });

    const result = await jobsService.confirmListed([`${prefix}:moderated`], t1);
    expect(result).toEqual({ confirmed: 0, reopened: 0 });

    const row = await prisma.job.findUniqueOrThrow({ where: { externalId: `${prefix}:moderated` } });
    expect(row.status).toBe('CLOSED');
    expect(row.hiddenAt).not.toBeNull();
  });

  it('strictly preserves expired postings (deadline < seenAt) and never reopens them', async () => {
    const t0 = new Date('2026-10-01T10:00:00Z');
    const seenAt = new Date('2026-10-04T10:00:00Z');
    const pastDeadline = new Date('2026-10-03T10:00:00Z');

    await prisma.job.create({
      data: {
        externalId: `${prefix}:expired`,
        title: 'Expired Job',
        company: 'ACME Test',
        location: 'Bakı',
        url: `https://example.org/jobs/${prefix}-expired`,
        description: 'Expired posting',
        postedAt: t0,
        lastSeenAt: t0,
        status: 'CLOSED',
        closedReason: 'source_removed_from_complete_listing',
        closedAt: t0,
        deadline: pastDeadline,
      },
    });

    const result = await jobsService.confirmListed([`${prefix}:expired`], seenAt);
    expect(result).toEqual({ confirmed: 0, reopened: 0 });

    const row = await prisma.job.findUniqueOrThrow({ where: { externalId: `${prefix}:expired` } });
    expect(row.status).toBe('CLOSED');
  });

  it('strictly preserves linked duplicate postings (duplicateOfId !== null) and never reopens them', async () => {
    const t0 = new Date('2026-10-01T10:00:00Z');
    const t1 = new Date('2026-10-02T10:00:00Z');

    await prisma.job.create({
      data: {
        externalId: `${prefix}:duplicate-closed`,
        title: 'Duplicate Job',
        company: 'ACME Test',
        location: 'Bakı',
        url: `https://example.org/jobs/${prefix}-duplicate-closed`,
        description: 'Duplicate posting',
        postedAt: t0,
        lastSeenAt: t0,
        status: 'CLOSED',
        closedReason: 'source_removed_from_complete_listing',
        closedAt: t0,
        duplicateOfId: primaryJobId,
      },
    });

    const result = await jobsService.confirmListed([`${prefix}:duplicate-closed`], t1);
    expect(result).toEqual({ confirmed: 0, reopened: 0 });

    const row = await prisma.job.findUniqueOrThrow({ where: { externalId: `${prefix}:duplicate-closed` } });
    expect(row.status).toBe('CLOSED');
    expect(row.duplicateOfId).toBe(primaryJobId);
  });

  it('rejects future observation timestamps', async () => {
    const futureDate = new Date(Date.now() + 120_000);
    await expect(
      jobsService.confirmListed([`${prefix}:active-1`], futureDate),
    ).rejects.toThrow(BadRequestException);
  });

  it('preserves newer observations (does not overwrite lastSeenAt with older timestamp)', async () => {
    const tNewer = new Date('2026-10-03T12:00:00Z');
    const tOlder = new Date('2026-10-02T12:00:00Z');

    await prisma.job.update({
      where: { externalId: `${prefix}:active-1` },
      data: { lastSeenAt: tNewer },
    });

    // Calling confirmListed with tOlder should not overwrite lastSeenAt
    const result = await jobsService.confirmListed([`${prefix}:active-1`], tOlder);
    expect(result.confirmed).toBe(0);

    const row = await prisma.job.findUniqueOrThrow({ where: { externalId: `${prefix}:active-1` } });
    expect(row.lastSeenAt.toISOString()).toBe(tNewer.toISOString());
  });

  it('verifies full closure-reconciliation and reactivation cycle', async () => {
    const sourceKey = `src_${stamp}`;
    await prisma.jobSource.create({
      data: {
        key: sourceKey,
        name: 'Lifecycle Source',
        homepageUrl: 'https://example.org',
        collectionMethod: 'synthetic',
        scope: 'test',
        applicationMethods: ['EXTERNAL_SITE'],
      },
    });

    const jobExtId = `${sourceKey}:reconcile-target`;
    const t0 = new Date('2026-10-01T10:00:00Z');
    const t1 = new Date('2026-10-02T10:00:00Z');
    const t2 = new Date('2026-10-03T10:00:00Z');
    const t3 = new Date('2026-10-04T10:00:00Z');

    // 1. Create active job under sourceKey
    await prisma.job.create({
      data: {
        externalId: jobExtId,
        title: 'Reconciliation Target Job',
        company: 'ACME Test',
        location: 'Bakı',
        url: `https://example.org/jobs/${sourceKey}-target`,
        description: 'Testing full closure and reactivation lifecycle',
        postedAt: t0,
        lastSeenAt: t0,
        status: 'ACTIVE',
      },
    });

    const sourceService = new JobSourceService(prisma, jobsService);

    // Run 1 (t1): complete run, but jobExtId was NOT seen (discovered: 1, but job not touched)
    await sourceService.recordRun(
      {
        source: sourceKey,
        startedAt: t1.toISOString(),
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
      },
      t1,
    );

    let row = await prisma.job.findUniqueOrThrow({ where: { externalId: jobExtId } });
    expect(row.status).toBe('ACTIVE');
    expect(row.missedImports).toBe(1);

    // Run 2 (t2): second consecutive complete run without jobExtId -> closes it
    await sourceService.recordRun(
      {
        source: sourceKey,
        startedAt: t2.toISOString(),
        complete: true,
        pages: 1,
        discovered: 1,
        fetched: 1,
        accepted: 1,
        created: 0,
        updated: 1,
        unchanged: 0,
        reopened: 0,
        expired: 0,
        skipped: 0,
        failed: 0,
      },
      t2,
    );

    row = await prisma.job.findUniqueOrThrow({ where: { externalId: jobExtId } });
    expect(row.status).toBe('CLOSED');
    expect(row.closedReason).toBe('source_removed_from_complete_listing');

    // 3. confirmListed reopens it when it is observed in a live listing again
    const confirmResult = await jobsService.confirmListed([jobExtId], t3);
    expect(confirmResult).toEqual({ confirmed: 1, reopened: 1 });

    row = await prisma.job.findUniqueOrThrow({ where: { externalId: jobExtId } });
    expect(row.status).toBe('ACTIVE');
    expect(row.closedAt).toBeNull();
    expect(row.closedReason).toBeNull();
    expect(row.missedImports).toBe(0);
    expect(row.lastSeenAt.toISOString()).toBe(t3.toISOString());

    // Cleanup source
    await prisma.jobImportRun.deleteMany({ where: { source: sourceKey } });
    await prisma.jobSource.deleteMany({ where: { key: sourceKey } });
  });

  it('handles concurrent confirm-listed requests accurately without race conditions', async () => {
    const t0 = new Date('2026-10-01T10:00:00Z');
    const t1 = new Date('2026-10-02T10:00:00Z');
    const t2 = new Date('2026-10-03T10:00:00Z');

    const jobA = `${prefix}:concurrent-a`;
    const jobB = `${prefix}:concurrent-b`;

    await prisma.job.createMany({
      data: [
        {
          externalId: jobA,
          title: 'Concurrent Job A',
          company: 'ACME Test',
          location: 'Bakı',
          url: `https://example.org/jobs/${prefix}-concurrent-a`,
          description: 'Testing concurrency on Job A',
          postedAt: t0,
          lastSeenAt: t0,
          status: 'ACTIVE',
        },
        {
          externalId: jobB,
          title: 'Concurrent Job B',
          company: 'ACME Test',
          location: 'Bakı',
          url: `https://example.org/jobs/${prefix}-concurrent-b`,
          description: 'Testing concurrency on Job B',
          postedAt: t0,
          lastSeenAt: t0,
          status: 'CLOSED',
          closedReason: 'source_removed_from_complete_listing',
          closedAt: t0,
          deadline: new Date('2026-12-31T10:00:00Z'),
        },
      ],
    });

    // Fire 5 concurrent requests with overlapping job IDs and varying timestamps
    const [r1, r2, r3] = await Promise.all([
      jobsService.confirmListed([jobA, jobB], t1),
      jobsService.confirmListed([jobA], t2),
      jobsService.confirmListed([jobB], t1),
    ]);

    // Total reopened across all concurrent requests must be exactly 1
    const totalReopened = r1.reopened + r2.reopened + r3.reopened;
    expect(totalReopened).toBe(1);

    // Job A was confirmed with t2, its lastSeenAt must be t2
    const rowA = await prisma.job.findUniqueOrThrow({ where: { externalId: jobA } });
    expect(rowA.status).toBe('ACTIVE');
    expect(rowA.lastSeenAt.toISOString()).toBe(t2.toISOString());

    // Job B is now ACTIVE, reopened once
    const rowB = await prisma.job.findUniqueOrThrow({ where: { externalId: jobB } });
    expect(rowB.status).toBe('ACTIVE');
    expect(rowB.closedAt).toBeNull();
    expect(rowB.closedReason).toBeNull();
  });

  it('guarantees malformed, truncated, or drifted listings cannot close existing vacancies', async () => {
    const falseCloseSource = `fc_${stamp}`;
    await prisma.jobSource.create({
      data: {
        key: falseCloseSource,
        name: 'False Close Prevention Source',
        homepageUrl: 'https://example.org',
        collectionMethod: 'synthetic',
        scope: 'test',
        applicationMethods: ['EXTERNAL_SITE'],
      },
    });

    const activeJobId = `${falseCloseSource}:active-vacancy`;
    const t0 = new Date('2026-10-01T10:00:00Z');
    const tRun = new Date('2026-10-02T10:00:00Z');

    await prisma.job.create({
      data: {
        externalId: activeJobId,
        title: 'Active Vacancy Protected From False Closure',
        company: 'ACME Test',
        location: 'Bakı',
        url: `https://example.org/jobs/${falseCloseSource}-active`,
        description: 'Should never be closed by an incomplete run',
        postedAt: t0,
        lastSeenAt: t0,
        status: 'ACTIVE',
      },
    });

    const sourceService = new JobSourceService(prisma, jobsService);

    // Run with complete: false (e.g. malformed rows, drift, or truncation occurred)
    const runResult = await sourceService.recordRun(
      {
        source: falseCloseSource,
        startedAt: tRun.toISOString(),
        complete: false,
        pages: 5,
        discovered: 10,
        fetched: 10,
        accepted: 8,
        created: 2,
        updated: 6,
        unchanged: 0,
        reopened: 0,
        expired: 0,
        skipped: 0,
        failed: 2, // malformed items
        error: 'Some details could not be parsed; no closures inferred',
      },
      tRun,
    );

    expect(runResult.status).toBe('PARTIAL');
    expect(runResult.closed).toBe(0);
    expect(runResult.closureSkipped).toBe('listing_incomplete');

    // Existing active job remains completely ACTIVE, not closed
    const row = await prisma.job.findUniqueOrThrow({ where: { externalId: activeJobId } });
    expect(row.status).toBe('ACTIVE');
    expect(row.missedImports).toBe(0); // missedImports not even incremented on incomplete run

    // Cleanup
    await prisma.jobImportRun.deleteMany({ where: { source: falseCloseSource } });
    await prisma.jobSource.deleteMany({ where: { key: falseCloseSource } });
  });
});
