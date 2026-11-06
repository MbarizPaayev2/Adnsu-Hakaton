/**
 * The scheduler process of the acquisition trial: the REAL registrar, BullMQ worker, scheduler and collectors against an isolated database copy.
 * Only what makes the trial conservative differs from a deployment, and each difference is stated:
 *  - collectors are the real ones, but every run is clamped to a few pages, a few details and a slow request rate (TRIAL_MAX_PAGES / TRIAL_MAX_JOBS / TRIAL_DELAY_MS);
 *  - the only hosts reachable are the sources under test (everything else is refused), and every request is counted (host, method, status; no bodies);
 *  - the "job-ingested" queue is a stub, so ingesting a posting starts no candidate matching and sends nothing to anyone;
 *  - the repeating tick is every minute instead of every ten (SOURCE_SCHEDULE_TICK_PATTERN).
 * Started and stopped by scheduler-acquisition-trial.ts. Refuses any database that is not a trial copy.
 */
import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { appendFileSync } from 'node:fs';
import { PrismaService } from '../../src/database/database.service';
import { JobsService } from '../../src/jobs/jobs.service';
import { JobSourceService } from '../../src/jobs/job-source.service';
import { FeatureFlagsService } from '../../src/operations/feature-flags.service';
import { SourceScheduler } from '../../src/jobs/source-scheduler.service';
import { SourceScheduleProcessor, SourceScheduleRegistrar } from '../../src/jobs/source-schedule.processor';
import { collectorFor } from '../../src/scrapers/public-jobs/collector-registry';

async function main() {
  const url = process.env.TRIAL_DATABASE_URL ?? '';
  const dbName = new URL(url).pathname.slice(1);
  if (!/^aise_sched_trial_\d+$/.test(dbName)) throw new Error(`Refusing to run against ${dbName}: only a trial copy (aise_sched_trial_<n>) is allowed`);
  process.env.DATABASE_URL = url;
  process.env.SOURCE_SCHEDULE_ENABLED = 'true';
  process.env.SOURCE_SCHEDULE_TICK_PATTERN = '*/1 * * * *';
  const prefix = process.env.TRIAL_PREFIX!;
  const logFile = process.env.TRIAL_REQUEST_LOG!;
  const maxPages = Number(process.env.TRIAL_MAX_PAGES || 3), maxJobs = Number(process.env.TRIAL_MAX_JOBS || 12), delayMs = Math.max(1500, Number(process.env.TRIAL_DELAY_MS || 2000));
  const hosts = new Set((process.env.TRIAL_HOSTS || '').split(',').filter(Boolean));

  const nativeFetch = global.fetch;
  global.fetch = (async (input: any, init?: any) => {
    const u = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    if (!hosts.has(u.hostname)) throw new Error(`The trial refuses traffic to ${u.hostname}`);
    const res = await nativeFetch(input, init);
    appendFileSync(logFile, `${JSON.stringify({ t: new Date().toISOString(), host: u.hostname, method: init?.method ?? 'GET', path: u.pathname.slice(0, 60), status: res.status })}\n`);
    return res;
  }) as typeof fetch;

  const module = await Test.createTestingModule({
    imports: [BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }), BullModule.registerQueue({ name: 'source-schedule' })],
    providers: [PrismaService, JobsService, JobSourceService, FeatureFlagsService, SourceScheduler, SourceScheduleProcessor, SourceScheduleRegistrar,
      { provide: getQueueToken('job-ingested'), useValue: { add: async () => ({}) } }],
  }).compile();
  const scheduler = module.get(SourceScheduler);
  scheduler.collectors = (key) => {
    const real = collectorFor(key);
    if (!real) return null;
    return { collect: (options: any, accept: any) => (real as any).collect({ ...options, maxPages: Math.min(options.maxPages, maxPages), maxJobs: Math.min(options.maxJobs, Number(process.env[`TRIAL_MAX_JOBS_${key}`] || maxJobs)), delayMs: Math.max(options.delayMs, delayMs) }, accept) } as any;
  };
  const app = module.createNestApplication();
  app.useLogger(new ConsoleLogger());
  await app.init();
  console.log(`TRIAL_APP_READY pid=${process.pid} db=${dbName} limits=${maxPages}p/${maxJobs}j/${delayMs}ms`);
  const stop = async () => { await app.close().catch(() => undefined); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
main().catch((e) => { console.error(e); process.exit(1); });
