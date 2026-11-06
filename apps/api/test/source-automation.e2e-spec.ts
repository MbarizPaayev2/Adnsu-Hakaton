import { Test } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../src/database/database.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobSourceService, coverageSummary, sourceHealth } from '../src/jobs/job-source.service';
import { FeatureFlagsService } from '../src/operations/feature-flags.service';
import {
  EMPLOYER_BUDGET, INCREMENTAL_BUDGET_BOARDS, RECONCILIATION_BUDGET_BOARDS, SourceScheduler, chooseRunMode, type CollectorLike,
} from '../src/jobs/source-scheduler.service';
import { SourceScheduleRegistrar } from '../src/jobs/source-schedule.processor';
import { COOLDOWN_AFTER_FAILURES, COOLDOWN_BASE_MS, COOLDOWN_MAX_MS, cooldownLength, failureSettlement } from '../src/jobs/source-scheduler.service';
import { importRules } from '../src/admin/ops/recommendations';
import { AdminEmailOpsService } from '../src/admin/ops/admin-email-ops.service';
import { AdminEmailOpsController } from '../src/admin/ops/admin-email-ops.controller';
import { ADMIN_PERMISSION_KEY, roleCan } from '../src/admin/permissions';

// Run against a DISPOSABLE database you created for this suite (DATABASE_URL), never a shared one: it registers, runs and deletes synthetic sources.
// Everything is synthetic: collectors are in-process fakes, there is no network, nothing is scheduled outside the test, and no e-mail is involved.
process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';

describe('source scheduling automation (synthetic collectors, isolated Postgres)', () => {
  const stamp = `${Date.now()}`;
  const key = (n: string) => `au${stamp}${n}`;
  const K = { modes: 'boss', quiet: key('q'), crash: key('c'), restart: key('r'), overlap: key('o'), close: key('x'), admin: key('a'), orphan: key('p'), cool: key('k') };
  let prisma: PrismaService, jobs: JobsService, sources: JobSourceService, flags: FeatureFlagsService;
  let scheduler: SourceScheduler;
  const OPTIONS: Record<string, unknown[]> = {};

  const makeScheduler = async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService, JobsService, JobSourceService, FeatureFlagsService, SourceScheduler, { provide: getQueueToken('job-ingested'), useValue: { add: async () => ({}) } }],
    }).compile();
    return { module, scheduler: module.get(SourceScheduler) };
  };

  /** A collector over a fixed listing that honours the real contract: known postings are confirmed (onListed), not fetched; the others are fetched and accepted. */
  const listing = (ids: string[], opts: { complete?: boolean; throwAfter?: number; error?: string; slow?: () => Promise<void>; unparseable?: Record<string, string> } = {}) => {
    const fetched: string[] = [];
    const collector = (source: string): CollectorLike => ({
      async collect(options: any, accept) {
        (OPTIONS[source] ??= []).push(options);
        let discovered = 0, known = 0, accepted = 0, failed = 0;
        for (const id of ids) {
          discovered++;
          if (options.isKnown?.(id)) { known++; await options.onListed?.(id); continue; }
          if (opts.unparseable?.[id]) { failed++; await options.onFailedDetail?.(id, opts.unparseable[id]); continue; }
          if (opts.throwAfter !== undefined && accepted >= opts.throwAfter) throw new Error('synthetic connection reset');
          fetched.push(id);
          await opts.slow?.();
          await accept({ externalId: id, title: `Role ${id}`, company: `${stamp} Co`, description: 'Public description', location: 'Bakı', url: `https://example.org/${id}`, postedAt: '2026-09-01T00:00:00Z' });
          accepted++;
        }
        return { source, complete: opts.complete ?? true, pages: 1, discovered, fetched: accepted + failed, accepted, expired: 0, failed, ...(failed ? { complete: false, error: 'Some details could not be parsed; no closures inferred' } : opts.error ? { error: opts.error } : {}) };
      },
    });
    return { fetched, collector };
  };
  const use = (s: SourceScheduler, source: string, collector: (k: string) => CollectorLike) => { s.collectors = (k) => (k === source ? collector(k) : null); };
  const enable = () => { process.env.SOURCE_SCHEDULE_ENABLED = 'true'; };
  const due = (k: string, data: Record<string, unknown> = {}) => prisma.jobSource.update({ where: { key: k }, data: { scheduled: true, intervalMinutes: 720, nextRunAt: null, consecutiveFailures: 0, leaseUntil: null, schedulePausedAt: null, ...data } });
  const src = (k: string) => prisma.jobSource.findUniqueOrThrow({ where: { key: k } });
  const runs = (k: string) => prisma.jobImportRun.findMany({ where: { source: k }, orderBy: { startedAt: 'asc' } });

  beforeAll(async () => {
    const made = await makeScheduler();
    scheduler = made.scheduler;
    prisma = made.module.get(PrismaService); jobs = made.module.get(JobsService); sources = made.module.get(JobSourceService); flags = made.module.get(FeatureFlagsService);
    for (const k of [K.quiet, K.crash, K.restart, K.overlap, K.close, K.admin, K.orphan, K.cool]) {
      await prisma.jobSource.create({ data: { key: k, name: k, homepageUrl: 'https://example.org', collectionMethod: 'synthetic', scope: 'test', applicationMethods: ['EXTERNAL_SITE'] } });
    }
    await prisma.jobSource.update({ where: { key: K.modes }, data: { enabled: true, accessReview: 'UNREVIEWED' } });
  });
  afterAll(async () => {
    delete process.env.SOURCE_SCHEDULE_ENABLED;
    const all = [K.quiet, K.crash, K.restart, K.overlap, K.close, K.admin, K.orphan, K.cool];
    await prisma.job.deleteMany({ where: { OR: [{ externalId: { startsWith: `au${stamp}` } }, { externalId: { startsWith: `${K.modes}:au${stamp}` } }] } });
    await prisma.jobImportRun.deleteMany({ where: { source: { in: [...all, K.modes] } } });
    await prisma.jobSource.deleteMany({ where: { key: { in: all } } });
    await prisma.jobSource.update({ where: { key: K.modes }, data: { scheduled: false, nextRunAt: null, consecutiveFailures: 0, leaseUntil: null } });
    await prisma.featureFlag.deleteMany({ where: { key: 'import.scheduled' } });
    await prisma.adminAuditLog.deleteMany({ where: { targetId: { in: all }, action: 'SOURCE_RUN_TRIGGERED' } });
    await prisma.$disconnect();
  });
  beforeEach(async () => { delete process.env.SOURCE_SCHEDULE_ENABLED; await prisma.featureFlag.deleteMany({ where: { key: 'import.scheduled' } }); });

  describe('budgets and modes', () => {
    it('chooses the budget by source type and the mode by the age of the last verified-complete listing', () => {
      const t = new Date('2026-10-04T12:00:00Z');
      const hours = (h: number) => new Date(t.getTime() - h * 3_600_000);
      expect(chooseRunMode('abb', { intervalMinutes: 1440 }, null, t)).toEqual({ mode: 'employer', budget: EMPLOYER_BUDGET });
      expect(chooseRunMode('xsolla', { intervalMinutes: 1440 }, hours(1), t).mode).toBe('employer');
      expect(chooseRunMode('work', { intervalMinutes: 1440 }, null, t)).toEqual({ mode: 'reconciliation', budget: RECONCILIATION_BUDGET_BOARDS });
      expect(chooseRunMode('work', { intervalMinutes: 1440 }, hours(24 * 3 + 1), t).mode).toBe('reconciliation');
      expect(chooseRunMode('work', { intervalMinutes: 1440 }, hours(24), t)).toEqual({ mode: 'incremental', budget: INCREMENTAL_BUDGET_BOARDS });
      for (const b of [EMPLOYER_BUDGET, INCREMENTAL_BUDGET_BOARDS, RECONCILIATION_BUDGET_BOARDS]) {
        expect(b.delayMs).toBeGreaterThanOrEqual(1500); // never faster than the polite floor
      }
      // Boards keep the small budget; employer sites may walk a long feed (ABB: 11 pages, 106 postings) in one run.
      for (const b of [INCREMENTAL_BUDGET_BOARDS, RECONCILIATION_BUDGET_BOARDS]) {
        expect(b.maxPages).toBeLessThanOrEqual(12);
        expect(b.maxJobs).toBeLessThanOrEqual(200);
      }
      expect(EMPLOYER_BUDGET.maxPages).toBeLessThanOrEqual(20);
      expect(EMPLOYER_BUDGET.maxJobs).toBeLessThanOrEqual(300);
    });

    it('a board is reconciled until it has a verified-complete listing, then runs cheap incremental passes', async () => {
      enable();
      const ids = [`${K.modes}:au${stamp}1`, `${K.modes}:au${stamp}2`];
      const { collector } = listing(ids);
      use(scheduler, K.modes, collector);
      await due(K.modes);
      expect((await scheduler.tick(new Date())).ran).toBe(K.modes);
      expect(OPTIONS[K.modes][0]).toMatchObject(RECONCILIATION_BUDGET_BOARDS); // no complete listing yet
      await due(K.modes);
      await scheduler.tick(new Date());
      expect(OPTIONS[K.modes][1]).toMatchObject(INCREMENTAL_BUDGET_BOARDS); // a fresh complete listing exists
      expect(OPTIONS[K.modes][1]).toHaveProperty('isKnown'); // progress comes from the database
      await prisma.jobImportRun.updateMany({ where: { source: K.modes, status: 'SUCCEEDED' }, data: { finishedAt: new Date(Date.now() - 4 * 1440 * 60_000) } });
      await due(K.modes);
      await scheduler.tick(new Date());
      expect(OPTIONS[K.modes][2]).toMatchObject(RECONCILIATION_BUDGET_BOARDS); // stale: reconcile again
    });
  });

  describe('a source with nothing new is healthy, not failing', () => {
    it('a bounded run that only confirmed known postings is PARTIAL, adds no failure and moves no closure', async () => {
      enable();
      const ids = [`${K.quiet}:1`, `${K.quiet}:2`, `${K.quiet}:3`];
      use(scheduler, K.quiet, listing(ids).collector);
      await due(K.quiet);
      expect((await scheduler.tick(new Date())).result).toBe('SUCCEEDED'); // seeds three postings
      const bounded = listing(ids, { complete: false, error: 'Collection limit reached; coverage incomplete' });
      use(scheduler, K.quiet, bounded.collector);
      for (let i = 0; i < 6; i++) { // more than the five failures that would trip the breaker
        await due(K.quiet);
        expect((await scheduler.tick(new Date())).result).toBe('PARTIAL');
      }
      expect(bounded.fetched).toEqual([]); // nothing re-fetched
      expect(await src(K.quiet)).toMatchObject({ consecutiveFailures: 0, leaseUntil: null });
      expect((await sourceHealth(prisma)).find((s) => s.key === K.quiet)).toMatchObject({ operationalStatus: 'HEALTHY' });
      expect(await prisma.job.count({ where: { externalId: { startsWith: `${K.quiet}:` }, status: 'ACTIVE' } })).toBe(3);
    });

    it('a run that produced no evidence at all is a failure and backs off', async () => {
      enable();
      use(scheduler, K.quiet, listing([], { complete: false, error: 'Collection limit reached; coverage incomplete' }).collector);
      await due(K.quiet);
      expect((await scheduler.tick(new Date())).result).toBe('FAILED');
      expect(await src(K.quiet)).toMatchObject({ consecutiveFailures: 1 });
    });
  });

  describe('postings whose own detail page does not validate', () => {
    const known = (k: string, n: number) => Array.from({ length: n }, (_, i) => `${k}:${i + 1}`);
    it('a few permanently unparseable postings in a long listing do not make the source fail, stop its progress or close anything, and are named', async () => {
      enable();
      const ids = [...known(K.quiet, 40), `${K.quiet}:bad1`, `${K.quiet}:bad2`];
      use(scheduler, K.quiet, listing(known(K.quiet, 40)).collector);
      await due(K.quiet); await scheduler.tick(new Date()); // seed 40 stored postings
      const bad = { [`${K.quiet}:bad1`]: 'Incomplete or invalid Work.az vacancy detail', [`${K.quiet}:bad2`]: 'Incomplete or invalid Work.az vacancy detail' };
      use(scheduler, K.quiet, listing(ids, { unparseable: bad }).collector);
      for (let i = 0; i < 6; i++) { // more than the five failures that trip the cooldown
        await due(K.quiet);
        expect((await scheduler.tick(new Date())).result).toBe('PARTIAL');
      }
      expect(await src(K.quiet)).toMatchObject({ consecutiveFailures: 0, cooldownUntil: null });
      const summary = scheduler.summaries.get(K.quiet)!;
      expect(summary).toMatchObject({ ok: true, failed: 2, complete: false });
      expect(summary.failedDetails.map((f) => f.id).sort()).toEqual([`${K.quiet}:bad1`, `${K.quiet}:bad2`]);
      expect((await runs(K.quiet)).at(-1)).toMatchObject({ listingComplete: false, closed: 0, detailFailures: 2 });
      expect(await prisma.job.count({ where: { externalId: { startsWith: `${K.quiet}:` }, status: 'ACTIVE' } })).toBe(40);
    });

      it('a board whose head has a permanently unparseable posting still stores its discovery progress (it used to stay stuck on the head for ever)', async () => {
      enable();
      const base = Array.from({ length: 30 }, (_, i) => `${K.modes}:au${stamp}u${i}`);
      use(scheduler, K.modes, listing(base).collector);
      await prisma.sourceDiscoveryProgress.deleteMany({ where: { sourceKey: K.modes } });
      await due(K.modes); await scheduler.tick(new Date());
      const bad = `${K.modes}:au${stamp}bad`;
      use(scheduler, K.modes, listing([bad, ...base], { unparseable: { [bad]: 'Incomplete or invalid Work.az vacancy detail' } }).collector);
      await prisma.sourceDiscoveryProgress.deleteMany({ where: { sourceKey: K.modes } });
      await due(K.modes);
      expect((await scheduler.tick(new Date())).result).toBe('PARTIAL');
      expect(await src(K.modes)).toMatchObject({ consecutiveFailures: 0 });
      expect(await prisma.sourceDiscoveryProgress.findUnique({ where: { sourceKey: K.modes } })).toMatchObject({ headReachedEnd: true });
    });

  it('a blocked or rate-limited detail fetch is still a failure, and so is a listing where most pages do not validate', async () => {
      enable();
      const ids = [...known(K.quiet, 10), `${K.quiet}:b1`];
      use(scheduler, K.quiet, listing(ids, { unparseable: { [`${K.quiet}:b1`]: 'HTTP 429 from the source' } }).collector);
      await due(K.quiet);
      expect((await scheduler.tick(new Date())).result).toBe('PARTIAL');
      expect(await src(K.quiet)).toMatchObject({ consecutiveFailures: 1 });
      const many = Array.from({ length: 6 }, (_, i) => `${K.quiet}:z${i}`);
      use(scheduler, K.quiet, listing([...known(K.quiet, 4), ...many], { unparseable: Object.fromEntries(many.map((m) => [m, 'Incomplete or invalid detail'])) }).collector);
      await due(K.quiet);
      await scheduler.tick(new Date());
      expect(await src(K.quiet)).toMatchObject({ consecutiveFailures: 1 }); // 6 of 10 listed is far over the tolerance (a tolerated run would leave 0)
    });
  });

  describe('crashes, restarts and durable progress', () => {
    it('a collector that dies mid-run leaves no RUNNING row, releases the lease, backs off, keeps what it stored and closes nothing', async () => {
      enable();
      const ids = [`${K.crash}:1`, `${K.crash}:2`, `${K.crash}:3`, `${K.crash}:4`];
      use(scheduler, K.crash, listing(ids).collector);
      await due(K.crash);
      await scheduler.tick(new Date()); // four active postings from a complete run
      // Two known postings are confirmed, one new posting is stored, then the worker dies on the next new one.
      use(scheduler, K.crash, listing([...ids.slice(0, 2), `${K.crash}:5`, `${K.crash}:6`], { throwAfter: 1 }).collector);
      await due(K.crash);
      expect((await scheduler.tick(new Date())).result).toBe('FAILED');
      const all = await runs(K.crash);
      expect(all.map((r) => r.status)).toEqual(['SUCCEEDED', 'FAILED']);
      expect(all[1].error).toMatch(/connection reset/);
      expect(await src(K.crash)).toMatchObject({ consecutiveFailures: 1, leaseUntil: null });
      expect((await src(K.crash)).nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await prisma.job.count({ where: { externalId: { startsWith: `${K.crash}:` }, status: 'ACTIVE' } })).toBe(5); // the four from before plus the one stored before the crash; nothing closed or lost
      expect(await prisma.job.count({ where: { externalId: `${K.crash}:6` } })).toBe(0);
      expect(await prisma.job.count({ where: { externalId: { startsWith: `${K.crash}:` }, missedImports: { gt: 0 } } })).toBe(0);
    });

    it('after a restart the next run fetches only what is still missing', async () => {
      enable();
      const ids = ['1', '2', '3', '4', '5'].map((n) => `${K.restart}:${n}`);
      use(scheduler, K.restart, listing(ids, { throwAfter: 2 }).collector);
      await due(K.restart);
      expect((await scheduler.tick(new Date())).result).toBe('FAILED'); // two stored, then the worker dies
      expect(await prisma.job.count({ where: { externalId: { startsWith: `${K.restart}:` } } })).toBe(2);
      const second = await makeScheduler(); // a new process
      const resumed = listing(ids);
      use(second.scheduler, K.restart, resumed.collector);
      await due(K.restart);
      expect((await second.scheduler.tick(new Date())).result).toBe('SUCCEEDED');
      expect(resumed.fetched).toEqual(ids.slice(2)); // the two stored postings were not requested again
      expect(await prisma.job.count({ where: { externalId: { startsWith: `${K.restart}:` }, status: 'ACTIVE' } })).toBe(5);
      expect(await src(K.restart)).toMatchObject({ consecutiveFailures: 0 });
      await second.module.close();
    });

    it('a worker killed mid-run (lease left behind) is recovered once, by whichever process notices first, and the source runs again', async () => {
      enable();
      const startedAt = new Date(Date.now() - 2 * 3_600_000);
      await prisma.jobImportRun.create({ data: { runKey: `${K.orphan}@${startedAt.toISOString()}`, source: K.orphan, status: 'RUNNING', startedAt, listingComplete: false } });
      await due(K.orphan, { leaseUntil: new Date(Date.now() - 3_600_000), consecutiveFailures: 1 });
      const other = await makeScheduler();
      const [a, b] = await Promise.all([scheduler.recoverAbandonedRuns(), other.scheduler.recoverAbandonedRuns()]);
      expect(a + b).toBeGreaterThanOrEqual(1);
      expect(await src(K.orphan)).toMatchObject({ leaseUntil: null, consecutiveFailures: 2 }); // counted exactly once
      expect((await runs(K.orphan)).map((r) => r.status)).toEqual(['FAILED']);
      expect((await runs(K.orphan))[0].error).toMatch(/terminated or lease expired/);
      use(scheduler, K.orphan, listing([`${K.orphan}:1`]).collector);
      await due(K.orphan, { consecutiveFailures: 0 });
      expect((await scheduler.tick(new Date())).result).toBe('SUCCEEDED');
      await other.module.close();
    });

    it('closes a run left RUNNING with no live lease behind it', async () => {
      const startedAt = new Date(Date.now() - 3 * 3_600_000);
      await prisma.jobImportRun.deleteMany({ where: { source: K.orphan } });
      await prisma.jobImportRun.create({ data: { runKey: `${K.orphan}@${startedAt.toISOString()}`, source: K.orphan, status: 'RUNNING', startedAt, listingComplete: false } });
      await prisma.jobSource.update({ where: { key: K.orphan }, data: { leaseUntil: null } });
      await scheduler.recoverAbandonedRuns();
      expect((await runs(K.orphan)).map((r) => [r.status, r.error])).toEqual([['FAILED', 'Run never finished and holds no lease']]);
    });

    it('the repeating tick is registered exactly once however often the API restarts, and not at all when the schedule is off', async () => {
      const store = new Map<string, string>();
      const queue: any = {
        getRepeatableJobs: async () => [...store.entries()].map(([k, name]) => ({ key: k, name })),
        removeRepeatableByKey: async (k: string) => { store.delete(k); },
        add: async (name: string) => { store.set(`${name}:${store.size}:*/10`, name); return {}; },
      };
      const registrar = new SourceScheduleRegistrar(queue);
      enable();
      for (let i = 0; i < 3; i++) await registrar.onApplicationBootstrap();
      expect(store.size).toBe(1);
      delete process.env.SOURCE_SCHEDULE_ENABLED;
      await registrar.onApplicationBootstrap();
      expect(store.size).toBe(0);
    });
  });

  describe('sources never overlap', () => {
    it('while a run is in progress neither the schedule, another process nor an operator can start the same source', async () => {
      enable();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const slow = listing([`${K.overlap}:1`], { slow: () => gate });
      use(scheduler, K.overlap, slow.collector);
      await due(K.overlap);
      const other = await makeScheduler();
      use(other.scheduler, K.overlap, listing([`${K.overlap}:1`]).collector);
      const first = scheduler.tick(new Date());
      await new Promise((r) => setTimeout(r, 300));
      expect((await other.scheduler.tick(new Date())).ran).toBeNull(); // the lease is held
      await expect(other.scheduler.runSourceNow(K.overlap)).rejects.toBeInstanceOf(ConflictException);
      expect((await runs(K.overlap)).map((r) => r.status)).toEqual(['RUNNING']); // visible as running
      release();
      expect((await first).result).toBe('SUCCEEDED');
      expect((await runs(K.overlap)).map((r) => r.status)).toEqual(['SUCCEEDED']);
      await other.module.close();
    });

    it('two processes ticking at the same moment run a due source exactly once', async () => {
      enable();
      await prisma.jobImportRun.deleteMany({ where: { source: K.overlap } });
      const one = listing([`${K.overlap}:1`]), two = listing([`${K.overlap}:1`]);
      const other = await makeScheduler();
      use(scheduler, K.overlap, one.collector); use(other.scheduler, K.overlap, two.collector);
      await due(K.overlap);
      await prisma.jobSource.updateMany({ where: { key: { not: K.overlap } }, data: { scheduled: false } }).catch(() => undefined);
      const results = await Promise.all([scheduler.tick(new Date()), other.scheduler.tick(new Date())]);
      expect(results.filter((r) => r.ran === K.overlap)).toHaveLength(1);
      await other.module.close();
    });

    it('a slow run keeps renewing its lease so it cannot be claimed while it is still working', async () => {
      enable();
      scheduler.leaseRenewMs = 0;
      const seen: Date[] = [];
      const slow = listing([`${K.overlap}:a`, `${K.overlap}:b`, `${K.overlap}:c`], { slow: async () => { seen.push((await src(K.overlap)).leaseUntil!); await new Promise((r) => setTimeout(r, 30)); } });
      use(scheduler, K.overlap, slow.collector);
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `${K.overlap}:` } } });
      await due(K.overlap);
      await scheduler.tick(new Date());
      scheduler.leaseRenewMs = 60_000;
      expect(seen).toHaveLength(3);
      expect(seen[2].getTime()).toBeGreaterThan(seen[0].getTime()); // extended while running
    });
  });

  describe('closures are safe', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `${K.close}:${i + 1}`);
    const active = () => prisma.job.count({ where: { externalId: { startsWith: `${K.close}:` }, status: 'ACTIVE' } });

    it('only repeated verified-complete listings close a posting; bounded, incomplete, failed and crashed runs never do', async () => {
      enable();
      use(scheduler, K.close, listing(ids(4)).collector);
      await due(K.close);
      await scheduler.tick(new Date());
      expect(await active()).toBe(4);

      const absent = ids(3); // posting 4 disappears from the listing
      for (const [label, collector] of [
        ['bounded', listing(absent, { complete: false, error: 'Collection limit reached; coverage incomplete' }).collector],
        ['incomplete', listing(absent, { complete: false, error: 'Some details could not be parsed; no closures inferred' }).collector],
        ['crashed', listing([...absent, `${K.close}:new`], { throwAfter: 0 }).collector], // the three known are listed, then the worker dies on a new one
      ] as const) {
        use(scheduler, K.close, collector as any);
        await due(K.close);
        await scheduler.tick(new Date());
        expect(await active()).toBe(4); // eslint-disable-line jest/no-conditional-expect
        void label;
      }
      expect(await prisma.job.count({ where: { externalId: `${K.close}:4`, missedImports: { gt: 0 } } })).toBe(0);

      use(scheduler, K.close, listing(absent).collector); // first verified-complete miss: counted, not closed
      await due(K.close);
      await scheduler.tick(new Date());
      expect(await active()).toBe(4);
      expect((await prisma.job.findFirstOrThrow({ where: { externalId: `${K.close}:4` } })).missedImports).toBe(1);

      await due(K.close); // second verified-complete miss: closed, and only that posting
      await scheduler.tick(new Date());
      expect(await active()).toBe(3);
      expect((await prisma.job.findFirstOrThrow({ where: { externalId: `${K.close}:4` } }))).toMatchObject({ status: 'CLOSED', closedReason: 'source_removed_from_complete_listing' });
    });

    it('a listing that shrank sharply closes nothing, even when it claims to be complete', async () => {
      enable();
      use(scheduler, K.close, listing(ids(10)).collector);
      await due(K.close);
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `${K.close}:` } } });
      await scheduler.tick(new Date());
      const before = await active();
      use(scheduler, K.close, listing(ids(2)).collector); // 2 of 10: a drifted page, not a real shrink
      await due(K.close);
      const out = await scheduler.tick(new Date());
      expect(out.result).toBe('PARTIAL');
      expect(await active()).toBe(before);
      expect((await runs(K.close)).pop()).toMatchObject({ closureSkipped: 'listing_shrank', closed: 0 });
    });

    it('an incremental pass (known postings confirmed, not re-fetched) keeps them from counting as missed', async () => {
      enable();
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `${K.close}:` } } });
      await prisma.jobImportRun.deleteMany({ where: { source: K.close } });
      use(scheduler, K.close, listing(ids(3)).collector);
      await due(K.close);
      await scheduler.tick(new Date());
      const again = listing(ids(3));
      use(scheduler, K.close, again.collector);
      for (let i = 0; i < 3; i++) { await due(K.close); await scheduler.tick(new Date()); }
      expect(again.fetched).toEqual([]);
      expect(await prisma.job.count({ where: { externalId: { startsWith: `${K.close}:` }, status: 'ACTIVE', missedImports: 0 } })).toBe(3);
    });
  });

  describe('operator controls', () => {
    let ops: AdminEmailOpsService;
    beforeAll(() => { ops = new AdminEmailOpsService(prisma, flags, {} as any, scheduler); });
    const admin = async () => (await prisma.adminUser.create({ data: { email: `auto-${stamp}-${Math.random()}@example.com`, hashedPassword: 'x', role: 'ADMIN' } })).id;

    it('run-now returns at once, runs in the background, holds the lease, and is audited', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      use(scheduler, K.admin, listing([`${K.admin}:1`], { slow: () => gate }).collector);
      await due(K.admin, { scheduled: false });
      const actor = await admin();
      const started = Date.now();
      expect(await ops.runNow(actor, K.admin)).toEqual({ key: K.admin, status: 'STARTED' });
      expect(Date.now() - started).toBeLessThan(2000); // did not wait for the collection
      expect((await src(K.admin)).leaseUntil).not.toBeNull();
      expect((await sourceHealth(prisma)).find((s) => s.key === K.admin)).toMatchObject({ operationalStatus: 'RUNNING', schedule: { leaseUntil: expect.any(Date) } });
      await expect(ops.runNow(actor, K.admin)).rejects.toBeInstanceOf(ConflictException);
      release();
      await scheduler.idle();
      expect((await runs(K.admin)).map((r) => r.status)).toEqual(['SUCCEEDED']);
      expect(await src(K.admin)).toMatchObject({ leaseUntil: null });
      expect(await prisma.adminAuditLog.count({ where: { adminUserId: actor, action: 'SOURCE_RUN_TRIGGERED', targetId: K.admin } })).toBe(1);
      await prisma.adminAuditLog.deleteMany({ where: { adminUserId: actor } });
      await prisma.adminUser.delete({ where: { id: actor } });
    });

    it('refuses an unknown, Glorri, disabled, restricted or collector-less source, and the emergency pause stops it too', async () => {
      const actor = await admin();
      use(scheduler, K.admin, listing([`${K.admin}:1`]).collector);
      await expect(ops.runNow(actor, `nope${stamp}`)).rejects.toThrow(/tapılmadı/);
      await expect(ops.runNow(actor, 'glorri')).rejects.toBeInstanceOf(BadRequestException);
      await expect(ops.runNow(actor, K.crash)).rejects.toBeInstanceOf(BadRequestException); // no collector for it in this scheduler
      await prisma.jobSource.update({ where: { key: K.admin }, data: { enabled: false } });
      await expect(ops.runNow(actor, K.admin)).rejects.toThrow(/Söndürülmüş/);
      await prisma.jobSource.update({ where: { key: K.admin }, data: { enabled: true, accessReview: 'RESTRICTED' } });
      await expect(ops.runNow(actor, K.admin)).rejects.toThrow(/Məhdudiyyətli/);
      await prisma.jobSource.update({ where: { key: K.admin }, data: { accessReview: 'UNREVIEWED' } });
      await ops.setGlobalSchedulerPause(actor, true, 'drill');
      await expect(ops.runNow(actor, K.admin)).rejects.toBeInstanceOf(ConflictException);
      await ops.setGlobalSchedulerPause(actor, false);
      expect(await prisma.adminAuditLog.count({ where: { adminUserId: actor, action: { in: ['FEATURE_PAUSED', 'FEATURE_RESUMED'] } } })).toBe(2);
      await prisma.adminAuditLog.deleteMany({ where: { adminUserId: actor } });
      await prisma.adminUser.delete({ where: { id: actor } });
    });

    it('the global pause stops the schedule at once and resuming restores it; a source pause keeps that source out', async () => {
      enable();
      const actor = await admin();
      use(scheduler, K.admin, listing([`${K.admin}:1`]).collector);
      await due(K.admin);
      await ops.setGlobalSchedulerPause(actor, true, 'drill');
      expect((await scheduler.tick(new Date())).ran).toBeNull();
      await ops.setGlobalSchedulerPause(actor, false);
      await ops.updateSchedule(actor, K.admin, { paused: true });
      expect((await scheduler.tick(new Date())).ran).toBeNull();
      expect((await sourceHealth(prisma)).find((s) => s.key === K.admin)).toMatchObject({ operationalStatus: 'PAUSED', schedule: { isPaused: true } });
      await ops.updateSchedule(actor, K.admin, { paused: false });
      expect((await scheduler.tick(new Date())).ran).toBe(K.admin);
      await prisma.adminAuditLog.deleteMany({ where: { adminUserId: actor } });
      await prisma.adminUser.delete({ where: { id: actor } });
    });

    it('only operators with the control permission may use them', () => {
      for (const handler of ['runNow', 'setGlobalPause'] as const) {
        expect(Reflect.getMetadata(ADMIN_PERMISSION_KEY, AdminEmailOpsController.prototype[handler])).toBe('ops.control');
      }
      expect(roleCan('SUPPORT', 'ops.control')).toBe(false);
      expect(roleCan('ADMIN', 'ops.control')).toBe(true);
      expect(roleCan('SUPER_ADMIN', 'ops.control')).toBe(true);
    });

    it('source health tells the operator what is wrong and what to do', async () => {
      await prisma.jobSource.update({ where: { key: K.admin }, data: { scheduled: true, schedulePausedAt: null, consecutiveFailures: 5 } });
      expect((await sourceHealth(prisma)).find((s) => s.key === K.admin)).toMatchObject({ operationalStatus: 'CIRCUIT_BROKEN', recommendedAction: expect.stringMatching(/5/) });
      await prisma.jobSource.update({ where: { key: K.admin }, data: { consecutiveFailures: 0, enabled: false } });
      expect((await sourceHealth(prisma)).find((s) => s.key === K.admin)).toMatchObject({ operationalStatus: 'DISABLED' });
      await prisma.jobSource.update({ where: { key: K.admin }, data: { enabled: true } });
    });
  });

  describe('durable cooldown after repeated failure or a block', () => {
    const failing = (message: string) => ({ async collect() { throw new Error(message); } }) as CollectorLike;
    const calls = () => (OPTIONS[K.cool] ??= []).length;
    const count = { n: 0 };
    const counting = (collector: CollectorLike): CollectorLike => ({ collect: async (o: any, a: any) => { count.n++; return collector.collect(o, a); } });
    const admin = async () => (await prisma.adminUser.create({ data: { email: `cool-${stamp}-${Math.random()}@example.com`, hashedPassword: 'x', role: 'ADMIN' } })).id;
    beforeEach(async () => { count.n = 0; await due(K.cool, { cooldownUntil: null, cooldownReason: null, cooldownCount: 0 }); await prisma.jobImportRun.deleteMany({ where: { source: K.cool } }); });

    it('the policy: five failures or any block starts a cooldown that doubles up to seven days', () => {
      const src = { intervalMinutes: 720, cooldownCount: 0 };
      const now = new Date('2026-10-04T12:00:00Z');
      expect(failureSettlement(src, 1, 'NETWORK_ERROR', 'timeout', now).cooldownUntil).toBeNull();
      expect(failureSettlement(src, COOLDOWN_AFTER_FAILURES - 1, 'UNKNOWN_ERROR', 'x', now).cooldownUntil).toBeNull();
      const fifth = failureSettlement(src, COOLDOWN_AFTER_FAILURES, 'UPSTREAM_UNAVAILABLE', '503', now);
      expect(fifth).toMatchObject({ cooldownCount: 1, cooldownReason: 'UPSTREAM_UNAVAILABLE: 503' });
      expect(fifth.cooldownUntil!.getTime() - now.getTime()).toBe(COOLDOWN_BASE_MS);
      expect(fifth.nextRunAt.getTime()).toBeGreaterThanOrEqual(fifth.cooldownUntil!.getTime());
      const blocked = failureSettlement(src, 1, 'BLOCKED', '403 Forbidden', now); // a block does not wait for five
      expect(blocked.cooldownUntil).not.toBeNull();
      expect([0, 1, 2, 3, 10].map(cooldownLength)).toEqual([COOLDOWN_BASE_MS, 2 * COOLDOWN_BASE_MS, 4 * COOLDOWN_BASE_MS, COOLDOWN_MAX_MS, COOLDOWN_MAX_MS]);
    });

    it('five failed runs in a row start a cooldown that survives a restart and a cleared backoff, and the source is not hammered', async () => {
      enable();
      use(scheduler, K.cool, () => counting(failing('synthetic upstream error')));
      for (let i = 1; i <= COOLDOWN_AFTER_FAILURES; i++) {
        await due(K.cool, { consecutiveFailures: i - 1, cooldownUntil: null });
        await scheduler.tick(new Date());
      }
      const cooled = await src(K.cool);
      expect(cooled.consecutiveFailures).toBe(COOLDOWN_AFTER_FAILURES);
      expect(cooled.cooldownUntil!.getTime()).toBeGreaterThan(Date.now() + COOLDOWN_BASE_MS - 60_000);
      expect(cooled).toMatchObject({ cooldownCount: 1, leaseOwner: null });
      expect(count.n).toBe(COOLDOWN_AFTER_FAILURES);
      // Even with the backoff cleared, and in a brand-new process, nothing runs before the cooldown ends.
      await prisma.jobSource.update({ where: { key: K.cool }, data: { nextRunAt: null } });
      const restarted = await makeScheduler();
      use(restarted.scheduler, K.cool, () => counting(failing('should not run')));
      expect((await restarted.scheduler.tick(new Date())).ran).toBeNull();
      expect(count.n).toBe(COOLDOWN_AFTER_FAILURES);
      await restarted.module.close();
    });

    it('a block (403) cools the source down at once and is never retried', async () => {
      enable();
      use(scheduler, K.cool, () => counting(failing('Source responded 403 Forbidden (challenge)')));
      await due(K.cool);
      await scheduler.tick(new Date());
      const row = await src(K.cool);
      expect(row.consecutiveFailures).toBe(1);
      expect(row.cooldownUntil).not.toBeNull();
      expect(row.cooldownReason).toMatch(/^BLOCKED:/);
      await prisma.jobSource.update({ where: { key: K.cool }, data: { nextRunAt: null } });
      expect((await scheduler.tick(new Date())).ran).toBeNull();
      expect(count.n).toBe(1);
      expect((await sourceHealth(prisma)).find((s) => s.key === K.cool)).toMatchObject({ operationalStatus: 'COOLING_DOWN', schedule: { cooldownReason: expect.stringMatching(/^BLOCKED/), isPaused: false } });
    });

    it('when the cooldown ends the source gets one probe run: failing again lengthens the cooldown, succeeding clears everything', async () => {
      enable();
      await due(K.cool, { consecutiveFailures: 5, cooldownCount: 1, cooldownUntil: new Date(Date.now() - 1000), cooldownReason: 'UPSTREAM_UNAVAILABLE: 503' });
      use(scheduler, K.cool, () => counting(failing('synthetic 503 Service Unavailable')));
      await scheduler.tick(new Date());
      expect(count.n).toBe(1); // exactly one probe
      const again = await src(K.cool);
      expect(again).toMatchObject({ cooldownCount: 2, consecutiveFailures: 6 });
      expect(again.cooldownUntil!.getTime()).toBeGreaterThan(Date.now() + 2 * COOLDOWN_BASE_MS - 60_000); // 48 hours this time
      await due(K.cool, { consecutiveFailures: 6, cooldownCount: 2, cooldownUntil: new Date(Date.now() - 1000) });
      use(scheduler, K.cool, () => counting(listing([`${K.cool}:1`]).collector(K.cool)));
      await scheduler.tick(new Date());
      expect(await src(K.cool)).toMatchObject({ consecutiveFailures: 0, cooldownUntil: null, cooldownReason: null, cooldownCount: 0 });
    });

    it('a worker that keeps dying also ends in cooldown (abandoned runs count as failures)', async () => {
      await due(K.cool, { consecutiveFailures: 4, leaseUntil: new Date(Date.now() - 1000), leaseOwner: 'scheduler:dead' });
      await scheduler.recoverAbandonedRuns();
      expect(await src(K.cool)).toMatchObject({ consecutiveFailures: 5, cooldownCount: 1, leaseOwner: null });
      expect((await src(K.cool)).cooldownUntil).not.toBeNull();
    });

    it('the operator sees it and can recover: run-now is refused while cooling, "recover" resets deliberately and is audited, and can start the run', async () => {
      const ops = new AdminEmailOpsService(prisma, flags, {} as any, scheduler);
      const actor = await admin();
      use(scheduler, K.cool, listing([`${K.cool}:2`]).collector);
      await due(K.cool, { consecutiveFailures: 5, cooldownCount: 2, cooldownUntil: new Date(Date.now() + 3_600_000), cooldownReason: 'RATE_LIMITED: 429' });
      await expect(ops.runNow(actor, K.cool)).rejects.toThrow(/soyutma/);
      const health = (await sourceHealth(prisma)).find((s) => s.key === K.cool)!;
      expect(health).toMatchObject({ operationalStatus: 'COOLING_DOWN', recommendedAction: expect.stringMatching(/Bərpa et/) });
      const recs = importRules(null, [{ key: K.cool, name: K.cool, scheduled: true, paused: false, consecutiveFailures: 5, staleness: 'fresh', lastSuccessAt: null, lastRunStatus: 'FAILED', completeness: 'x', openFreshnessUnknown: 0, open: 0, cooldownUntil: health.schedule.cooldownUntil, cooldownReason: health.schedule.cooldownReason, cooldownCount: 2 }], false, new Date());
      expect(recs.filter((r) => r.id.startsWith(`source.${K.cool}.`)).map((r) => r.id)).toEqual([`source.${K.cool}.cooling-down`]); // replaces the generic failing item
      expect(recs.find((r) => r.id.endsWith('cooling-down'))).toMatchObject({ status: 'attention', severity: 'high', requiredPermission: 'ops.control' });
      expect(await ops.recoverSource(actor, K.cool, false)).toEqual({ key: K.cool, reset: true, run: null });
      expect(await src(K.cool)).toMatchObject({ consecutiveFailures: 0, cooldownUntil: null, cooldownCount: 0, nextRunAt: null });
      expect(await prisma.adminAuditLog.count({ where: { adminUserId: actor, action: 'SOURCE_COOLDOWN_RESET', targetId: K.cool } })).toBe(1);
      await prisma.jobSource.update({ where: { key: K.cool }, data: { cooldownUntil: new Date(Date.now() + 3_600_000), cooldownCount: 1, consecutiveFailures: 5 } });
      expect(await ops.recoverSource(actor, K.cool, true)).toEqual({ key: K.cool, reset: true, run: { key: K.cool, status: 'STARTED' } });
      await scheduler.idle();
      expect((await runs(K.cool)).map((r) => r.status)).toEqual(['SUCCEEDED']);
      await prisma.adminAuditLog.deleteMany({ where: { adminUserId: actor } });
      await prisma.adminUser.delete({ where: { id: actor } });
    });

    it('the recovery action needs the control permission and refuses Glorri and unknown sources', async () => {
      expect(Reflect.getMetadata(ADMIN_PERMISSION_KEY, AdminEmailOpsController.prototype.recover)).toBe('ops.control');
      const ops = new AdminEmailOpsService(prisma, flags, {} as any, scheduler);
      await expect(ops.recoverSource('x', 'glorri')).rejects.toBeInstanceOf(BadRequestException);
      await expect(ops.recoverSource('x', `nope${stamp}`)).rejects.toThrow(/tapılmadı/);
      void COOLDOWN_MAX_MS; void calls;
    });
  });

  describe('census reporting excludes expired postings', () => {
    it('open, e-mail and verified counts count only actionable postings; expired ones are reported separately', async () => {
      const k = key('census');
      await prisma.jobSource.create({ data: { key: k, name: k, homepageUrl: 'https://example.org', collectionMethod: 'synthetic', scope: 'test', applicationMethods: ['EMAIL'] } });
      const day = 86_400_000;
      const base = { title: 'Role', company: `${stamp} Co`, description: 'd', location: 'Bakı', url: 'https://example.org/x', postedAt: '2026-09-01T00:00:00Z', applicationEmail: 'hr@example.org' };
      const add = async (id: string, extra: Record<string, unknown> = {}) => { const { job } = await jobs.upsertJob({ ...base, externalId: `${k}:${id}`, ...extra }); return job; };
      const open1 = await add('open1', { deadline: new Date(Date.now() + 5 * day).toISOString() });
      await add('open2');
      await add('expired', { deadline: new Date(Date.now() - 2 * day).toISOString() });
      await prisma.job.updateMany({ where: { externalId: { startsWith: `${k}:` } }, data: { applicationMethod: 'EMAIL' } });
      const dup = await add('dup'); await prisma.job.update({ where: { id: dup.id }, data: { duplicateOfId: open1.id } });
      const hidden = await add('hidden'); await prisma.job.update({ where: { id: hidden.id }, data: { hiddenAt: new Date() } });
      const row = (await sourceHealth(prisma)).find((s) => s.key === k)!;
      expect(row.counts).toMatchObject({ total: 5, active: 5, open: 2, expiredByDeadline: 1, duplicates: 1, hidden: 1, emailApplicable: 2 });
      const summary = await coverageSummary(prisma, []);
      expect(summary.openPostings).toBeGreaterThanOrEqual(2);
      expect(summary.caveats.join(' ')).toMatch(/Open means/);
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `${k}:` } } });
      await prisma.jobSource.delete({ where: { key: k } });
    });
  });
});
