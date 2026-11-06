import { Test } from '@nestjs/testing';
import { ConflictException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../src/database/database.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobSourceService } from '../src/jobs/job-source.service';
import { JobsController } from '../src/jobs/jobs.controller';
import { ApiKeyGuard } from '../src/jobs/api-key.guard';
import { FeatureFlagsService } from '../src/operations/feature-flags.service';
import { SourceScheduler, type CollectorLike } from '../src/jobs/source-scheduler.service';
import { LEASE_TTL_MS, SourceLeaseService } from '../src/jobs/source-lease.service';
import { acquireSourceLease, ingestPublicJob, renewSourceLease, runImport } from '../src/scripts/import-public-jobs';

// One lease per source for the scheduler, an operator's run-now and the import CLI. Run against a DISPOSABLE database you created (DATABASE_URL):
// it uses the registered `hellojob` row, which it restores. Synthetic in-process collectors, a loopback API, no network.
process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';

describe('one source lease for the scheduler, run-now and the manual import (isolated Postgres)', () => {
  const stamp = `${Date.now()}`;
  const SRC = 'hellojob';
  const token = 'synthetic-lease-token';
  const id = (n: string) => `${SRC}:lease${stamp}-${n}`;
  const synthetic = `ls${stamp}`;
  let app: INestApplication, prisma: PrismaService, scheduler: SourceScheduler, sources: JobSourceService, lease: SourceLeaseService, base: string;
  const env = () => ({ AISE_INGEST_API_URL: base, SCRAPER_SERVICE_TOKEN: token }) as NodeJS.ProcessEnv;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const job = (n: string) => ({ externalId: id(n), title: `Role ${n}`, company: `${stamp} Co`, description: 'Public description', location: 'Bakı', url: `https://example.org/${stamp}-${n}`, postedAt: '2026-09-01T00:00:00Z' });

  /** A collector over a fixed listing. `gate` pauses it mid-run so other holders can be tried against it. */
  const listing = (ids: string[], o: { gate?: () => Promise<void>; complete?: boolean } = {}) => {
    const calls: unknown[] = [];
    const collector: CollectorLike = {
      async collect(options: any, accept) {
        calls.push(options);
        let accepted = 0;
        for (const n of ids) {
          if (options.isKnown?.(id(n))) { await options.onListed?.(id(n)); continue; }
          await o.gate?.();
          await accept(job(n));
          accepted++;
        }
        await options.onListed?.(id(ids[0]));
        return { source: SRC, complete: o.complete ?? true, pages: 1, discovered: ids.length, fetched: accepted, accepted, expired: 0, failed: 0 };
      },
    };
    return { calls, collector };
  };
  const use = (c: CollectorLike) => { scheduler.collectors = (k) => (k === SRC ? c : null); };
  const source = () => prisma.jobSource.findUniqueOrThrow({ where: { key: SRC } });
  const reset = async () => { await prisma.jobSource.update({ where: { key: SRC }, data: { scheduled: true, intervalMinutes: 720, nextRunAt: null, consecutiveFailures: 0, leaseUntil: null, leaseOwner: null, leaseHeartbeatAt: null, schedulePausedAt: null, cooldownUntil: null } }); };
  const runs = () => prisma.jobImportRun.findMany({ where: { source: SRC, startedAt: { gte: new Date(Number(stamp) - 1000) } }, orderBy: { startedAt: 'asc' } });

  let original: { scheduled: boolean; intervalMinutes: number; nextRunAt: Date | null; enabled: boolean };
  beforeAll(async () => {
    process.env.SOURCE_SCHEDULE_ENABLED = 'true';
    const module = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [PrismaService, JobsService, JobSourceService, FeatureFlagsService, SourceScheduler, ApiKeyGuard,
        { provide: ConfigService, useValue: { get: (key: string) => (key === 'SCRAPER_SERVICE_TOKEN' ? token : undefined) } },
        { provide: getQueueToken('job-ingested'), useValue: { add: async () => ({}) } }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    prisma = app.get(PrismaService); scheduler = app.get(SourceScheduler); sources = app.get(JobSourceService); lease = sources.lease;
    const row = await prisma.jobSource.findUniqueOrThrow({ where: { key: SRC } });
    original = { scheduled: row.scheduled, intervalMinutes: row.intervalMinutes, nextRunAt: row.nextRunAt, enabled: row.enabled };
    await prisma.jobSource.update({ where: { key: SRC }, data: { enabled: true } });
    await prisma.jobSource.create({ data: { key: synthetic, name: synthetic, homepageUrl: 'https://example.org', collectionMethod: 'synthetic', scope: 'test', applicationMethods: ['EXTERNAL_SITE'] } });
    await prisma.jobSource.updateMany({ where: { key: { not: SRC } }, data: { scheduled: false } }); // the disposable database: only this source is eligible
  });
  afterAll(async () => {
    delete process.env.SOURCE_SCHEDULE_ENABLED;
    await prisma.job.deleteMany({ where: { externalId: { startsWith: `${SRC}:lease${stamp}` } } });
    await prisma.job.deleteMany({ where: { externalId: { startsWith: `${synthetic}:` } } });
    await prisma.jobImportRun.deleteMany({ where: { source: { in: [SRC, synthetic] }, startedAt: { gte: new Date(Number(stamp) - 1000) } } });
    await prisma.jobSource.update({ where: { key: SRC }, data: { ...original, leaseUntil: null, leaseOwner: null, leaseHeartbeatAt: null, consecutiveFailures: 0 } });
    await prisma.jobSource.delete({ where: { key: synthetic } });
    await prisma.featureFlag.deleteMany({ where: { key: 'import.scheduled' } });
    await app.close();
  });
  beforeEach(async () => { await reset(); });

  describe('the lease itself', () => {
    it('is exclusive, only its owner can renew or release it, and a dead holder\'s lease expires', async () => {
      const a = await lease.acquire(SRC, 'scheduler');
      expect(a).toMatch(/^scheduler:/);
      expect(await lease.acquire(SRC, 'cli')).toBeNull();
      expect(await lease.describe(SRC)).toMatchObject({ holder: 'scheduler' });
      expect(await lease.renew(SRC, 'cli:not-the-owner')).toBe(false);
      expect(await lease.release(SRC, 'cli:not-the-owner')).toBe(false);
      expect(await lease.holds(SRC, a!)).toBe(true);
      expect(await lease.renew(SRC, a!)).toBe(true);
      // The holder dies: nothing renews it, it expires, another holder takes over, and the dead holder's token is worthless.
      await prisma.jobSource.update({ where: { key: SRC }, data: { leaseUntil: new Date(Date.now() - 1000) } });
      expect(await lease.holds(SRC, a!)).toBe(false);
      const b = await lease.acquire(SRC, 'operator');
      expect(b).toMatch(/^operator:/);
      expect(await lease.renew(SRC, a!)).toBe(false);
      expect(await lease.release(SRC, a!)).toBe(false);
      expect(await lease.holds(SRC, b!)).toBe(true);
      expect(await lease.release(SRC, b!)).toBe(true);
      expect(await source()).toMatchObject({ leaseUntil: null, leaseOwner: null });
    });
  });

  describe('imports require the lease', () => {
    it('refuses a write to a reviewed source without the lease, with the wrong one or after it expired; other sources are not lease-managed', async () => {
      const call = (path: string, body: object, lease?: string) => fetch(`${base}/internal/jobs/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(lease ? { 'x-source-lease': lease } : {}) }, body: JSON.stringify(body) });
      const run = { source: SRC, startedAt: new Date().toISOString(), complete: false, pages: 1, discovered: 1, fetched: 1, accepted: 1, created: 1, updated: 0, unchanged: 0, reopened: 0, expired: 0, skipped: 0, failed: 0 };
      for (const lease of [undefined, 'cli:wrong']) {
        expect((await call('ingest', job('w'), lease)).status).toBe(409);
        expect((await call('confirm-listed', { externalIds: [id('w')] }, lease)).status).toBe(409);
        expect((await call('import-runs', run, lease)).status).toBe(409);
      }
      expect(await prisma.job.count({ where: { externalId: id('w') } })).toBe(0);
      const mine = (await acquireSourceLease(SRC, base, token));
      expect((await call('ingest', job('w'), mine)).status).toBe(201);
      await prisma.jobSource.update({ where: { key: SRC }, data: { leaseUntil: new Date(Date.now() - 1000) } });
      expect((await call('ingest', job('w2'), mine)).status).toBe(409); // expired
      await lease.release(SRC, mine);
      const res = await call('ingest', { ...job('s'), externalId: `${synthetic}:1` });
      expect(res.status).toBe(201); // a source with no reviewed collector is not lease-managed
    });
  });

  describe('manual import versus the scheduler and run-now', () => {
    it('while the CLI imports, the schedule skips the source and run-now is refused; when it finishes the source is free', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const cli = listing(['m1'], { gate: () => gate });
      const slow = runImport(['--apply', '--source', SRC, '--max-pages', '1', '--max-jobs', '5'], env(), { collectorFor: () => cli.collector as any, heartbeatMs: 60_000, log: () => {} });
      for (let i = 0; i < 40 && !(await source()).leaseOwner; i++) await sleep(50);
      expect((await source()).leaseOwner).toMatch(/^cli:/);
      const sched = listing(['x1']);
      use(sched.collector);
      expect((await scheduler.tick(new Date())).ran).toBeNull(); // the schedule does not run a source the CLI holds
      await expect(scheduler.runSourceNow(SRC)).rejects.toThrow(/cli/);
      release();
      expect((await slow).exitCode).toBe(0);
      expect(await source()).toMatchObject({ leaseUntil: null, leaseOwner: null });
      expect((await scheduler.tick(new Date())).ran).toBe(SRC);
      expect(sched.calls).toHaveLength(1);
    });

    it('while the scheduler or run-now collects, the CLI stops before fetching anything', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      use(listing(['s1'], { gate: () => gate }).collector);
      const scheduled = scheduler.tick(new Date());
      for (let i = 0; i < 40 && !(await source()).leaseOwner; i++) await sleep(50);
      const fetched = listing(['c1']);
      await expect(runImport(['--apply', '--source', SRC], env(), { collectorFor: () => fetched.collector as any, log: () => {} })).rejects.toThrow(/another process \(scheduler\)/);
      expect(fetched.calls).toHaveLength(0);
      release();
      await scheduled;
      // The same with an operator's run-now.
      let release2!: () => void;
      const gate2 = new Promise<void>((resolve) => { release2 = resolve; });
      use(listing(['s2'], { gate: () => gate2 }).collector);
      await reset();
      expect(await scheduler.runSourceNow(SRC)).toEqual({ key: SRC, status: 'STARTED' });
      await expect(runImport(['--apply', '--source', SRC], env(), { collectorFor: () => fetched.collector as any, log: () => {} })).rejects.toThrow(/another process \(operator\)/);
      expect(fetched.calls).toHaveLength(0);
      release2();
      await scheduler.idle();
    });

    it('two holders racing for the same source: exactly one wins', async () => {
      const results = await Promise.all([lease.acquire(SRC, 'scheduler'), lease.acquire(SRC, 'cli'), lease.acquire(SRC, 'operator'), acquireSourceLease(SRC, base, token).catch(() => null)]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  describe('renewal and crash recovery', () => {
    it('a running CLI renews its lease; a slow run does not lose it', async () => {
      const seen: number[] = [];
      const slow = listing(['r1', 'r2', 'r3'], { gate: async () => { seen.push((await source()).leaseHeartbeatAt!.getTime()); await sleep(120); } });
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `${SRC}:lease${stamp}-r` } } });
      const out = await runImport(['--apply', '--source', SRC], env(), { collectorFor: () => slow.collector as any, heartbeatMs: 40, log: () => {} });
      expect(out.exitCode).toBe(0);
      expect(seen).toHaveLength(3);
      expect(seen[2]).toBeGreaterThan(seen[0]); // the heartbeat advanced while it worked
    });

    it('a CLI killed mid-run leaves a lease that expires; the schedule recovers and runs, and the dead CLI can no longer write or renew', async () => {
      const dead = await acquireSourceLease(SRC, base, token); // the CLI got the lease, then its process died (never renewed, never released)
      const diedAt = new Date(Date.now() - 2000); // the dead CLI had started a run
      await prisma.jobImportRun.create({ data: { runKey: `${SRC}@${diedAt.toISOString()}`, source: SRC, status: 'RUNNING', startedAt: diedAt, listingComplete: false } });
      expect((await scheduler.tick(new Date())).ran).toBeNull(); // still held: not recovered early
      await prisma.jobSource.update({ where: { key: SRC }, data: { leaseUntil: new Date(Date.now() - LEASE_TTL_MS) } });
      const sched = listing(['k1']);
      use(sched.collector);
      expect((await scheduler.tick(new Date())).ran).toBeNull(); // recovered: the dead run is closed and the source backs off before it is tried again
      expect(await source()).toMatchObject({ leaseOwner: null, consecutiveFailures: 1 });
      expect((await source()).nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      await prisma.jobSource.update({ where: { key: SRC }, data: { nextRunAt: null } }); // the backoff has passed
      expect((await scheduler.tick(new Date())).ran).toBe(SRC);
      expect((await prisma.jobImportRun.findUniqueOrThrow({ where: { runKey: `${SRC}@${diedAt.toISOString()}` } })).status).toBe('FAILED'); // the dead CLI's run is closed
      expect(['SUCCEEDED', 'PARTIAL']).toContain((await runs()).pop()!.status); // and the schedule's own run completed (PARTIAL when an earlier test's larger listing makes this one look shrunk)
      expect(await renewSourceLease(SRC, dead, base, token)).toBe(false);
      await expect(ingestPublicJob(job('k2') as any, base, token, dead)).rejects.toThrow('HTTP 409');
    });

    it('a CLI whose lease is taken over stops and records nothing', async () => {
      const slow = listing(['t1', 't2', 't3'], { gate: async () => { await sleep(150); } });
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `${SRC}:lease${stamp}-t` } } });
      const importing = runImport(['--apply', '--source', SRC], env(), { collectorFor: () => slow.collector as any, heartbeatMs: 40, log: () => {} });
      for (let i = 0; i < 40 && !(await source()).leaseOwner; i++) await sleep(50);
      const before = (await runs()).length;
      await prisma.jobSource.update({ where: { key: SRC }, data: { leaseUntil: new Date(Date.now() - 1000) } }); // it stopped heartbeating long enough to expire...
      const thief = await lease.acquire(SRC, 'operator'); // ...and another holder took the source over
      expect(thief).not.toBeNull();
      await expect(importing).rejects.toThrow(/lease on hellojob was lost/);
      expect((await runs()).length).toBe(before); // nothing recorded as if it still owned the source
      expect(await lease.holds(SRC, thief!)).toBe(true); // the new owner is undisturbed
      await lease.release(SRC, thief!);
    });

    it('a scheduled run whose lease is taken over stops, and does not settle the source over the new owner', async () => {
      scheduler.leaseRenewMs = 0;
      let first = true;
      const run = listing(['l1', 'l2', 'l3'], { gate: async () => {
        if (first) { first = false; await prisma.jobSource.update({ where: { key: SRC }, data: { leaseUntil: new Date(Date.now() - 1000) } }); await lease.acquire(SRC, 'cli'); }
      } });
      use(run.collector);
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `${SRC}:lease${stamp}-l` } } });
      const out = await scheduler.tick(new Date());
      scheduler.leaseRenewMs = 60_000;
      expect(out.result).toBe('FAILED');
      const row = await source();
      expect(row.leaseOwner).toMatch(/^cli:/); // the new owner keeps the source
      expect(row.consecutiveFailures).toBe(0); // and the loser did not settle it
      expect((await runs()).pop()).toMatchObject({ status: 'FAILED' });
    });
  });

  describe('a resumed segment never closes anything', () => {
    it('a run that started mid-listing is recorded as a segment even if the collector calls it complete', async () => {
      const t0 = new Date(Date.now() - 10_000);
      for (const n of ['g1', 'g2', 'g3']) await prisma.job.create({ data: { externalId: id(n), title: n, company: 'Co', description: 'd', location: 'Bakı', url: 'https://example.org/g', postedAt: new Date('2026-09-01'), lastSeenAt: new Date(t0.getTime() - 86_400_000), missedImports: 1 } });
      const startedAt = new Date(Date.now() - 5000);
      const report = { source: SRC, startedAt: startedAt.toISOString(), complete: true, segment: true, pages: 1, discovered: 1, fetched: 0, accepted: 0, created: 0, updated: 0, unchanged: 1, reopened: 0, expired: 0, skipped: 0, failed: 0 };
      const out = await sources.recordRun(report as any, new Date());
      expect(out).toMatchObject({ status: 'PARTIAL', closed: 0, closureSkipped: 'resumed_segment' });
      expect(await prisma.job.count({ where: { externalId: { in: ['g1', 'g2', 'g3'].map(id) }, status: 'ACTIVE' } })).toBe(3);
    });

    it('the CLI reports a run that starts after page 1 as a segment, and --skip-known uses what the database already holds', async () => {
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `${SRC}:lease${stamp}-` } } });
      const collector = listing(['h1', 'h2'], { complete: true });
      const first = await runImport(['--apply', '--source', SRC, '--start-page', '3'], env(), { collectorFor: () => collector.collector as any, log: () => {} });
      expect(first.exitCode).toBe(0);
      expect((await runs()).pop()).toMatchObject({ status: 'PARTIAL', closureSkipped: 'resumed_segment', closed: 0 });
      const second = listing(['h1', 'h2']);
      await runImport(['--apply', '--source', SRC, '--skip-known'], env(), { collectorFor: () => second.collector as any, log: () => {} });
      expect((second.calls[0] as any).isKnown(id('h1'))).toBe(true); // stored by the first run: not fetched again
      expect((second.calls[0] as any).isKnown(id('never-seen'))).toBe(false);
    });
  });

  it('the ordinary import path has no way around the lease: no lock file, no skip-known file, no write without a token', () => {
    const src = require('node:fs').readFileSync(require.resolve('../src/scripts/import-public-jobs'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/tmpdir|lockPath|open\(.*wx|appendFile|unlink|skip-known-file|\/tmp\//);
    expect(src).toMatch(/acquireSourceLease\(options\.source/);
  });
});
