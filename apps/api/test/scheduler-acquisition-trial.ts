/**
 * Acquisition trial: REAL collectors (work.az, Xsolla's Lever feed) run by the REAL scheduler (BullMQ repeating tick -> processor -> SourceScheduler ->
 * collector -> ingestion -> run recording -> discovery progress) in a child process, against a DISPOSABLE COPY of the isolated acquisition database.
 * No import command is run by anyone: the driver only prepares the copy, starts/kills/restarts the scheduler process and reads results from the database.
 *
 * What is NOT real here, stated so the evidence is not over-read: time is compressed (the driver moves nextRunAt/lastHeadAt of the COPY's rows into the
 * past between cycles; production waits the source interval), budgets are clamped to a few pages/details, and the matching queue is a stub.
 *
 * Run from apps/api: TRIAL_OUT=~/aise-preview/trial/result.json npx ts-node -r tsconfig-paths/register --transpile-only test/scheduler-acquisition-trial.ts
 */
import { PrismaClient } from '@prisma/client';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, createWriteStream } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const ADMIN = 'postgresql://postgres:postgrespassword@127.0.0.1:5433/postgres?schema=public';
const TEMPLATE = 'aise_census_growth_test';
const SOURCES = (process.env.TRIAL_SOURCES || 'work,xsolla').split(',');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dir = path.join(homedir(), 'aise-preview', 'trial');
const stamp = Date.now();
const name = `aise_sched_trial_${stamp}`;
const url = `postgresql://postgres:postgrespassword@127.0.0.1:5433/${name}?schema=public`;
const prefix = `aise-sched-trial-${stamp}`;
const trialStart = new Date();
const requestLog = path.join(dir, `requests-${stamp}.jsonl`);
const hostsOf: Record<string, string[]> = {
  work: ['work.az', 'www.work.az', 'api.work.az'],
  xsolla: ['api.lever.co', 'jobs.lever.co'],
  'pasha-insurance': ['career.pasha-insurance.az'],
};

function freeGiB() { return Number(execFileSync('df', ['-g', '/']).toString().trim().split('\n')[1].split(/\s+/)[3]); }

async function start(db: PrismaClient): Promise<{ child: ChildProcess; log: string }> {
  const log = path.join(dir, `scheduler-${stamp}.log`);
  writeFileSync(log, '', { flag: 'a' });
  const out = createWriteStream(log, { flags: 'a' });
  const child = spawn('npx', ['ts-node', '-r', 'tsconfig-paths/register', '--transpile-only', 'test/support/scheduler-trial-app.ts'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, TRIAL_DATABASE_URL: url, TRIAL_PREFIX: prefix, TRIAL_REQUEST_LOG: requestLog, TRIAL_HOSTS: SOURCES.flatMap((s) => hostsOf[s] ?? []).join(','), TRIAL_MAX_PAGES: '3', TRIAL_MAX_JOBS: '40', TRIAL_MAX_JOBS_xsolla: '150', TRIAL_DELAY_MS: '2500' },
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.pipe(out); child.stderr!.pipe(out);
  for (let i = 0; i < 90; i++) { if (readFileSync(log, 'utf8').includes('TRIAL_APP_READY')) return { child, log }; await sleep(1000); }
  try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ }
  throw new Error('scheduler process did not become ready');
}

async function snapshot(db: PrismaClient, label: string) {
  const runs = await db.jobImportRun.findMany({ where: { source: { in: SOURCES }, startedAt: { gte: trialStart } }, orderBy: { startedAt: 'asc' } });
  const progress = await db.sourceDiscoveryProgress.findMany({ where: { sourceKey: { in: SOURCES } } });
  const jobs = await db.$queryRaw<{ source: string; status: string; n: number }[]>`SELECT split_part("externalId", ':', 1) AS source, status::text AS status, COUNT(*)::int AS n FROM "Job" WHERE split_part("externalId", ':', 1) = ANY(${SOURCES}) GROUP BY 1, 2 ORDER BY 1, 2`;
  const src = await db.jobSource.findMany({ where: { key: { in: SOURCES } }, select: { key: true, scheduled: true, consecutiveFailures: true, leaseUntil: true, cooldownUntil: true, nextRunAt: true } });
  return { label, at: new Date().toISOString(), runs: runs.map((r) => ({ source: r.source, status: r.status, started: r.startedAt, finished: r.finishedAt, pages: r.pagesFetched, listed: r.listed, discovered: r.discovered, created: r.created, updated: r.updated, unchanged: r.unchanged, reopened: r.reopened, closed: r.closed, failures: r.detailFailures, rejected: r.rejected, skipped: r.skipped, complete: r.listingComplete, closureSkipped: r.closureSkipped, error: r.error })), progress: progress.map((p) => ({ ...p, anchors: Array.isArray(p.anchors) ? (p.anchors as string[]).length : 0 })), jobs, sources: src };
}

async function waitForRuns(db: PrismaClient, atLeast: number, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const runs = await db.jobImportRun.findMany({ where: { source: { in: SOURCES }, status: { not: 'RUNNING' }, startedAt: { gte: trialStart } } });
    const running = await db.jobImportRun.count({ where: { source: { in: SOURCES }, status: 'RUNNING', startedAt: { gte: trialStart } } });
    if (runs.length >= atLeast && !running) return;
    await sleep(5000);
  }
  throw new Error(`timeout waiting for ${atLeast} finished runs`);
}

async function main() {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (freeGiB() < 4) throw new Error('Less than 4 GiB free: not starting');
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE}"`);
  console.log(`trial database ${name} cloned from ${TEMPLATE}`);
  const db = new PrismaClient({ datasources: { db: { url } } });
  const pre = await db.jobImportRun.count({ where: { source: { in: SOURCES } } });
  const result: any = { runsBeforeTrial: pre, database: name, startedAt: new Date().toISOString(), limits: { pages: 3, details: 40, delayMs: 2500 }, notes: [] as string[], steps: [] as any[] };
  let live: { child: ChildProcess; log: string } | null = null;
  const kill = (sig: NodeJS.Signals) => { try { process.kill(-live!.child.pid!, sig); } catch { /* gone */ } };
  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
    // Make the chosen sources eligible: enabled, scheduled, never run, short interval (the trial's compressed clock), no pause/cooldown/lease.
    await db.jobSource.updateMany({ where: { key: { in: SOURCES } }, data: { enabled: true, scheduled: true, intervalMinutes: 60, nextRunAt: null, schedulePausedAt: null, leaseUntil: null, leaseOwner: null, cooldownUntil: null, consecutiveFailures: 0 } });
    // No other source may be scheduled in the copy (Glorri is flagged but the scheduler never claims it: it keeps its own importer).
    const others = await db.jobSource.count({ where: { scheduled: true, key: { notIn: [...SOURCES, 'glorri'] } } });
    if (others) throw new Error(`${others} other sources are scheduled in the copy; refusing`);
    // Compressed time again: the copy's stored postings were fetched days ago, not weeks. Age their detail-fetch time so the 14-day revalidation rule has something to act on.
    result.agedForRevalidation = await db.$executeRaw`UPDATE "Job" SET "detailFetchedAt" = now() - interval '20 days' WHERE split_part("externalId", ':', 1) = ANY(${SOURCES})`;
    // So that discovery of postings NEW TO THE DATABASE can be seen at all (the copy already holds the head of work.az), remove the 12 newest work postings from the COPY.
    // They are not new to the source; the report says so. Nothing outside the disposable copy is touched.
    result.removedFromCopy = await db.$executeRaw`DELETE FROM "Job" WHERE id IN (SELECT id FROM "Job" WHERE "externalId" LIKE 'work:%' ORDER BY "postedAt" DESC LIMIT 12)`;
    result.before = await snapshot(db, 'before');

    // ---- Cycle 1: the scheduler starts and runs each source on its own (one source per tick, every minute).
    live = await start(db);
    await waitForRuns(db, SOURCES.length, 12 * 60_000);
    result.steps.push(await snapshot(db, 'after cycle 1'));

    // ---- Compress time for cycle 2: the head refresh just happened and the deep segment is due (production: the six-hour gap between segments).
    const deepDue = async () => {
      await db.sourceDiscoveryProgress.updateMany({ where: { sourceKey: { in: SOURCES } }, data: { lastHeadAt: new Date(), lastSegmentAt: new Date(Date.now() - 7 * 3_600_000) } });
      await db.jobSource.updateMany({ where: { key: { in: SOURCES } }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
    };
    const finished = () => db.jobImportRun.count({ where: { source: { in: SOURCES }, status: { not: 'RUNNING' }, startedAt: { gte: trialStart } } });
    const cycle1 = await finished();
    await deepDue();
    await waitForRuns(db, cycle1 + SOURCES.length, 12 * 60_000);
    result.steps.push(await snapshot(db, 'after cycle 2 (deep segment due)'));

    // ---- Hard crash in the middle of a third run, then restart: the lease must recover and the scheduler continue without any manual command.
    await deepDue();
    for (let i = 0; i < 180; i++) { if (await db.jobImportRun.count({ where: { source: { in: SOURCES }, status: 'RUNNING', startedAt: { gte: trialStart } } })) break; await sleep(500); }
    kill('SIGKILL');
    await sleep(3000);
    result.steps.push(await snapshot(db, 'after SIGKILL (run interrupted)'));
    // The killed process left a lease. The trial's clock is compressed by moving the lease expiry (the real TTL is 45 minutes); the recovery code path is the real one.
    await db.jobSource.updateMany({ where: { leaseUntil: { not: null } }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    live = await start(db);
    // Recovery marks the interrupted run FAILED and backs the source off; the trial clock makes everything due again so the restarted scheduler's next runs can be seen.
    for (let i = 0; i < 180; i++) { if (await db.jobImportRun.count({ where: { status: 'FAILED', error: { contains: 'terminated or lease expired' }, startedAt: { gte: trialStart } } })) break; await sleep(1000); }
    const afterRecovery = await finished();
    await deepDue();
    await waitForRuns(db, afterRecovery + SOURCES.length, 12 * 60_000);
    result.steps.push(await snapshot(db, 'after restart (recovery, then new runs)'));
    kill('SIGTERM');
    await sleep(2000);
    const events = readFileSync(live.log, 'utf8').replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter((l) => l.includes('"event":"source_collection_')).map((l) => JSON.parse(l.slice(l.indexOf('{"event"'), l.lastIndexOf('}') + 1)));
    result.events = events.map((e: any) => ({ event: e.event, source: e.source, mode: e.mode, status: e.status, resumed: e.resumed, pages: e.pages, discovered: e.discovered, fetched: e.fetched, created: e.created, updated: e.updated, confirmedListed: e.confirmedListed, failed: e.failed, revalidated: e.revalidated, duplicatesLinked: e.duplicatesLinked, cursorAfter: e.cursorAfter, restartReason: e.restartReason, durationMs: e.durationMs, failedDetails: (e.failedDetails ?? []).length }));
    result.requests = existsSync(requestLog) ? readFileSync(requestLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    result.finishedAt = new Date().toISOString();
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    result.notes.push('trial aborted: see error');
    if (live) kill('SIGTERM');
  } finally {
    writeFileSync(process.env.TRIAL_OUT || path.join(dir, `result-${stamp}.json`), JSON.stringify(result, null, 2));
    await db.$disconnect();
    await sleep(1500);
    if (!process.env.TRIAL_KEEP_DB) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$disconnect();
    console.log(`result written; database ${process.env.TRIAL_KEEP_DB ? 'kept' : 'dropped'}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
