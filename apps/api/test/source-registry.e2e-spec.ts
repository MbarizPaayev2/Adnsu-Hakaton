import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ApiKeyGuard } from '../src/jobs/api-key.guard';
import { JobsController } from '../src/jobs/jobs.controller';
import { ingestPublicJob, reportImportRun } from '../src/scripts/import-public-jobs';
import { PrismaService } from '../src/database/database.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobSourceService } from '../src/jobs/job-source.service';
import type { ImportRunReportDto } from '../src/jobs/dto/import-run.dto';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';

/** Real Postgres, synthetic postings, mocked matching queue. No network, e-mail or model calls. */
describe('source registry, health and closure of removed postings (real isolated Postgres)', () => {
  const key = `ctest${Date.now()}`;
  let prisma: PrismaService, jobs: JobsService, sources: JobSourceService, app: INestApplication, base: string;
  const token = 'synthetic-source-registry-token';
  const queue = { add: jest.fn(async () => ({})) };
  const at = (minutes: number) => new Date(Date.parse('2026-10-02T08:00:00Z') + minutes * 60_000);
  const posting = (id: string, extra: Record<string, unknown> = {}) => ({
    externalId: `${key}:${id}`, title: `Role ${id}`, company: `${key} Employer`, description: 'Plain description of the role', location: 'Bakı',
    url: `https://example.org/${key}/${id}`, postedAt: '2026-09-01T00:00:00Z', ...extra,
  });
  const report = (startedAt: Date, over: Partial<ImportRunReportDto> = {}): ImportRunReportDto => ({
    source: key, startedAt: startedAt.toISOString(), complete: true, pages: 1, discovered: 3, fetched: 3, accepted: 3, created: 0, updated: 0, unchanged: 3, reopened: 0, expired: 0, skipped: 0, failed: 0, ...over,
  });
  const statusOf = async (id: string) => (await prisma.job.findUniqueOrThrow({ where: { externalId: `${key}:${id}` } }));
  // One simulated run: the collector lists `ids` after `startedAt`, then reports.
  const run = async (startedAt: Date, ids: string[], over: Partial<ImportRunReportDto> = {}) => {
    for (const id of ids) await jobs.upsertJob(posting(id), new Date(startedAt.getTime() + 1000));
    return sources.recordRun(report(startedAt, { discovered: ids.length, fetched: ids.length, accepted: ids.length, ...over }), new Date(startedAt.getTime() + 60_000));
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [PrismaService, JobsService, JobSourceService, ApiKeyGuard,
        { provide: ConfigService, useValue: { get: (name: string) => (name === 'SCRAPER_SERVICE_TOKEN' ? token : undefined) } },
        { provide: getQueueToken('job-ingested'), useValue: queue }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = module.get(PrismaService); jobs = module.get(JobsService); sources = module.get(JobSourceService);
    await prisma.jobSource.create({ data: { key, name: 'Closure test source', homepageUrl: 'https://example.org', collectionMethod: 'synthetic', scope: 'test', applicationMethods: ['EXTERNAL_SITE'] } });
  });
  afterAll(async () => {
    await prisma.job.deleteMany({ where: { externalId: { startsWith: `${key}:` } } });
    await prisma.jobImportRun.deleteMany({ where: { source: key } });
    await prisma.jobSource.deleteMany({ where: { key } });
    await app?.close();
  });

  it('closes a deadline-less posting only after two consecutive complete listings without it', async () => {
    expect(await run(at(0), ['a', 'b', 'c'])).toMatchObject({ status: 'SUCCEEDED', closed: 0 });
    expect(await run(at(60), ['a', 'b'])).toMatchObject({ status: 'SUCCEEDED', closed: 0 });
    expect(await statusOf('c')).toMatchObject({ status: 'ACTIVE', missedImports: 1, deadline: null });
    expect(await run(at(120), ['a', 'b'], { discovered: 2 })).toMatchObject({ closed: 1 });
    expect(await statusOf('c')).toMatchObject({ status: 'CLOSED', closedReason: 'source_removed_from_complete_listing' });
    expect(await statusOf('a')).toMatchObject({ status: 'ACTIVE', missedImports: 0 });
  });

  it('infers nothing from an incomplete, errored or shrunken listing', async () => {
    const before = (await statusOf('b')).missedImports;
    expect(await sources.recordRun(report(at(180), { complete: false, discovered: 1, accepted: 1, error: 'Collection limit reached' }), at(181))).toMatchObject({ status: 'PARTIAL', closed: 0, closureSkipped: 'listing_incomplete' });
    expect(await sources.recordRun(report(at(190), { complete: true, discovered: 1, error: 'Careers listing changed during pagination' }), at(191))).toMatchObject({ status: 'PARTIAL', closureSkipped: 'listing_incomplete' });
    expect((await statusOf('b')).missedImports).toBe(before);
    // Previous complete run listed 2; 0 listed now is below half, so a "complete" empty page closes nothing.
    expect(await sources.recordRun(report(at(200), { discovered: 0, fetched: 0, accepted: 0 }), at(201))).toMatchObject({ closed: 0, closureSkipped: 'listing_shrank' });
    expect(await statusOf('b')).toMatchObject({ status: 'ACTIVE', missedImports: 0 });
  });

  it('reopens a returned posting and clears its miss count', async () => {
    const result = await jobs.upsertJob(posting('c'), at(260));
    expect(result.outcome).toBe('reopened');
    expect(await statusOf('c')).toMatchObject({ status: 'ACTIVE', missedImports: 0, closedAt: null });
  });

  it('rejects unknown, disabled and Glorri sources and implausible start times', async () => {
    await expect(sources.recordRun({ ...report(at(300)), source: 'nosuchsource' }, at(301))).rejects.toBeInstanceOf(NotFoundException);
    await expect(sources.recordRun({ ...report(at(300)), source: 'glorri' }, at(301))).rejects.toBeInstanceOf(BadRequestException);
    await expect(sources.recordRun(report(at(1000)), at(300))).rejects.toBeInstanceOf(BadRequestException);
    await expect(sources.recordRun(report(at(0)), at(60 * 24))).rejects.toBeInstanceOf(BadRequestException);
    await prisma.jobSource.update({ where: { key }, data: { enabled: false } });
    await expect(sources.recordRun(report(at(300)), at(301))).rejects.toBeInstanceOf(NotFoundException);
    await prisma.jobSource.update({ where: { key }, data: { enabled: true } });
  });

  it('records application e-mail only from explicit posting text, with evidence', async () => {
    await jobs.upsertJob(posting('mail', { description: 'Send your CV to careers@employer.az with the subject "Analyst - ANL-77".' }), at(310));
    await jobs.upsertJob(posting('plain'), at(310));
    await jobs.upsertJob(posting('generic', { description: 'General office description without apply instructions.', rawPayload: { email: 'office@employer.az' } }), at(310));
    await jobs.upsertJob(posting('ambig', { description: 'Send your CV to a@employer.az or b@employer.az', rawPayload: { email: 'a@employer.az' } }), at(310));
    expect(await statusOf('mail')).toMatchObject({ applicationMethod: 'EMAIL', applicationEmail: 'careers@employer.az', applicationEmailEvidence: { subjectLine: 'Analyst - ANL-77' } });
    expect(await statusOf('plain')).toMatchObject({ applicationMethod: 'EXTERNAL_SITE', applicationEmail: null, applicationEmailEvidence: null });
    expect(await statusOf('generic')).toMatchObject({ applicationMethod: 'EXTERNAL_SITE', applicationEmail: null, applicationEmailEvidence: null });
    expect(await statusOf('ambig')).toMatchObject({ applicationMethod: 'EXTERNAL_SITE', applicationEmail: null, applicationEmailEvidence: null });
  });

  it('reports per-source health computed from runs and postings', async () => {
    const health = (await sources.health(at(320))).find((s) => s.key === key)!;
    expect(health).toMatchObject({ enabled: true, scheduled: false, accessReview: 'UNREVIEWED', lastRunStatus: 'PARTIAL' });
    expect(health.lastCompleteListingAt).toBeInstanceOf(Date);
    expect(health.counts.total).toBe(7);
    expect(health.counts.emailApplicable).toBe(1);
    expect(health.lastRun).toMatchObject({ closureSkipped: 'listing_shrank' });
    expect(health.lastSuccessAt!.getTime()).toBeLessThan(health.lastRunAt!.getTime() + 1);
    expect(await sources.health()).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'glorri' }), expect.objectContaining({ key: 'azercell' })]));
  });

  describe('replay, concurrency and ordering of reports', () => {
    const k2 = `${key}r`;
    const id = (name: string) => `${k2}:${name}`;
    const rep = (startedAt: Date, over: Partial<ImportRunReportDto> = {}) => ({ ...report(startedAt, over), source: k2 });
    const list = async (startedAt: Date, names: string[]) => { for (const n of names) await jobs.upsertJob({ ...posting(n), externalId: id(n) }, new Date(startedAt.getTime() + 1000)); };
    const miss = async (n: string) => (await prisma.job.findUniqueOrThrow({ where: { externalId: id(n) } }));
    beforeAll(async () => { await prisma.jobSource.create({ data: { key: k2, name: 'Replay source', homepageUrl: 'https://example.org', collectionMethod: 'synthetic', scope: 'test', applicationMethods: ['EXTERNAL_SITE'] } }); });
    afterAll(async () => {
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `${k2}:` } } });
      await prisma.jobImportRun.deleteMany({ where: { source: k2 } });
      await prisma.jobSource.deleteMany({ where: { key: k2 } });
    });

    it('counts a listing once however many times, or how concurrently, the same report arrives', async () => {
      await list(at(0), ['a', 'b']);
      await sources.recordRun(rep(at(0), { discovered: 2 }), at(1));
      await list(at(60), ['a']); // b is absent from the second listing
      const second = rep(at(60), { discovered: 1 });
      const first = await sources.recordRun(second, at(61));
      expect(first.closed).toBe(0);
      expect((await miss('b')).missedImports).toBe(1);
      expect(await sources.recordRun(second, at(62))).toEqual(first); // replay: same recorded result
      await Promise.all([1, 2, 3, 4].map(() => sources.recordRun(second, at(63))));
      expect((await miss('b'))).toMatchObject({ missedImports: 1, status: 'ACTIVE' });
      expect(await prisma.jobImportRun.count({ where: { source: k2, startedAt: at(60) } })).toBe(1);
      // A genuinely distinct second complete listing closes it.
      await list(at(120), ['a']);
      expect((await sources.recordRun(rep(at(120), { discovered: 1 }), at(121))).closed).toBe(1);
      expect((await miss('b')).status).toBe('CLOSED');
    });

    it('closes nothing from an older report that arrives late, or from a listing with failed detail parses', async () => {
      await list(at(300), ['c', 'd']);
      await sources.recordRun(rep(at(300), { discovered: 2 }), at(301));
      const outOfOrder = await sources.recordRun(rep(at(250), { discovered: 1 }), at(302));
      expect(outOfOrder).toMatchObject({ status: 'PARTIAL', closed: 0, closureSkipped: 'out_of_order' });
      // 'd' is listed but its detail failed to parse: that is an incomplete listing, not an absence.
      await list(at(360), ['c']);
      const failedParse = await sources.recordRun(rep(at(360), { discovered: 2, fetched: 2, accepted: 1, failed: 1, complete: true }), at(361));
      expect(failedParse).toMatchObject({ closed: 0, closureSkipped: 'listing_incomplete' });
      expect((await miss('d'))).toMatchObject({ missedImports: 0, status: 'ACTIVE' });
    });

    it('does not close a posting that an overlapping collector refreshed after this run began, and a returning posting clears its history', async () => {
      await list(at(500), ['e', 'f']);
      await sources.recordRun(rep(at(500), { discovered: 2 }), at(501));
      await list(at(560), ['e']);
      await sources.recordRun(rep(at(560), { discovered: 1 }), at(561));
      expect((await miss('f')).missedImports).toBe(1);
      // Another run (started later) refreshes f while a run that began at 600 is still reporting.
      await list(at(610), ['f']);
      const overlapped = await sources.recordRun(rep(at(600), { discovered: 1 }), at(611));
      expect(overlapped.closed).toBe(0);
      expect(await miss('f')).toMatchObject({ status: 'ACTIVE', missedImports: 0 });
    });
  });

  it('runs the same flow through the guarded HTTP routes the import CLI uses', async () => {
    const http = `${key}x`; // a second registry source so the first test's rows are untouched
    await prisma.jobSource.create({ data: { key: http, name: 'HTTP flow source', homepageUrl: 'https://example.org', collectionMethod: 'synthetic', scope: 'test', applicationMethods: ['EXTERNAL_SITE'] } });
    try {
      const startedAt = new Date(Date.now() - 5000);
      const outcomes: string[] = [];
      for (const id of ['p', 'q']) outcomes.push(await ingestPublicJob({ ...posting(id), externalId: `${http}:${id}` } as never, base, token));
      expect(outcomes).toEqual(['created', 'created']);
      // A quarantined (disabled, restricted) or unregistered source cannot write postings through the supported path.
      for (const blocked of ['accessbank', 'azerconnect', 'neverregistered']) {
        await expect(ingestPublicJob({ ...posting('x'), externalId: `${blocked}:${key}` } as never, base, token)).rejects.toThrow('HTTP 403');
      }
      expect(await prisma.job.count({ where: { externalId: { in: ['accessbank', 'azerconnect', 'neverregistered'].map((k) => `${k}:${key}`) } } })).toBe(0);
      const tally = { created: 2, updated: 0, reopened: 0, unchanged: 0 };
      const collected = { source: http, complete: true, pages: 1, discovered: 2, fetched: 2, accepted: 2, expired: 0, failed: 0 };
      expect(await reportImportRun(collected, tally, startedAt, base, token)).toEqual({ status: 'SUCCEEDED', closed: 0, closureSkipped: null });
      // Wrong token is refused before anything is recorded.
      await expect(reportImportRun(collected, tally, startedAt, base, 'wrong-token')).rejects.toThrow('HTTP 401');
      // Invalid counts are rejected by validation.
      await expect(reportImportRun({ ...collected, discovered: -1 }, tally, startedAt, base, token)).rejects.toThrow('HTTP 400');
      expect(await prisma.jobImportRun.count({ where: { source: http } })).toBe(1);
    } finally {
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `${http}:` } } });
      await prisma.jobImportRun.deleteMany({ where: { source: http } });
      await prisma.jobSource.deleteMany({ where: { key: http } });
    }
  });
});
