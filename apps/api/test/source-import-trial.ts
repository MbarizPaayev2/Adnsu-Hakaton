/** Local-only, bounded, sequential import trial of the public sources through the REAL guarded ingestion path, into a DISPOSABLE database that this script
 * creates and drops. Nothing is published, no notification or application is sent (the matching queue is a stub; there is no mailer in this module).
 * Run from apps/api: TRIAL_OUT=/path/metrics.json TRIAL_DETAILS=50 npx ts-node --transpile-only test/source-import-trial.ts
 * Crawl delays are honoured by the collectors (JobSearch 30 s, eJob >= 5 s). Source page content is kept only in memory and in TRIAL_OUT's sibling
 * .dtos.json (a scratch file that must not be committed). */
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaClient } from '@prisma/client';
import { TestLeases } from './support/source-lease';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { PrismaService } from '../src/database/database.service';
import { ApiKeyGuard } from '../src/jobs/api-key.guard';
import { JobsController } from '../src/jobs/jobs.controller';
import { JobsService } from '../src/jobs/jobs.service';
import { JobSourceService } from '../src/jobs/job-source.service';
import { EjobCollector } from '../src/scrapers/public-jobs/ejob.collector';
import { JobsearchCollector } from '../src/scrapers/public-jobs/jobsearch.collector';
import { WorkCollector } from '../src/scrapers/public-jobs/work.collector';
import { ingestPublicJob, reportImportRun, type IngestOutcome } from '../src/scripts/import-public-jobs';
import type { IngestJobDto } from '../src/jobs/dto/ingest-job.dto';
import assert from 'node:assert/strict';

const ADMIN = 'postgresql://postgres:postgrespassword@127.0.0.1:5433/postgres?schema=public';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Tally = Record<IngestOutcome, number>;
const emptyTally = (): Tally => ({ created: 0, updated: 0, reopened: 0, unchanged: 0 });

async function main() {
  const details = Math.min(50, Number(process.env.TRIAL_DETAILS || 50));
  const budgetMs = Number(process.env.TRIAL_BUDGET_MS || 75 * 60_000);
  const out = process.env.TRIAL_OUT || '/tmp/source-import-trial.json';
  const started = Date.now();
  const name = `aise_scratch_trial_${started}`;
  assert.match(name, /^aise_scratch_trial_\d+$/);
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const url = `postgresql://postgres:postgrespassword@127.0.0.1:5433/${name}?schema=public`;
  process.env.DATABASE_URL = url;
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const token = 'synthetic-trial-token';
  let app: INestApplication | undefined; let prisma!: PrismaService;
  const result: Record<string, any> = { startedAt: new Date(started).toISOString(), details, scratchDatabase: name };
  const dtos: IngestJobDto[] = [];
  try {
    const module = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [PrismaService, JobsService, JobSourceService, ApiKeyGuard,
        { provide: ConfigService, useValue: { get: (key: string) => key === 'SCRAPER_SERVICE_TOKEN' ? token : undefined } },
        { provide: getQueueToken('job-ingested'), useValue: { add: async () => ({}) } }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    prisma = app.get(PrismaService);
    const L = new TestLeases(prisma); // the import routes require each reviewed source's lease, as a real importer holds it
    await L.take('work', 'ejob', 'jobsearch');
    result.registryAtStart = await prisma.jobSource.findMany({ where: { key: { in: ['ejob', 'jobsearch', 'work'] } }, select: { key: true, enabled: true, scheduled: true, accessReview: true } });
    // The shipped state holds eJob and JobSearch (enabled=false). Only in THIS disposable database are they enabled so the pipeline can be measured.
    await prisma.jobSource.updateMany({ where: { key: { in: ['ejob', 'jobsearch'] } }, data: { enabled: true } });

    const pause = async (ms: number) => { if (Date.now() - started > budgetMs) throw new Error('Trial runtime budget exhausted'); await sleep(ms); };
    const tallies: Record<string, Tally> = {};
    const reports: Record<string, any> = {};
    const collect = async (key: 'work' | 'ejob' | 'jobsearch', limits: { maxPages: number; maxJobs: number; delayMs: number }, label: string = key) => {
      const tally = emptyTally(); const t0 = Date.now(); const runStart = new Date();
      const collector = key === 'work' ? new WorkCollector(undefined, pause) : key === 'ejob' ? new EjobCollector(undefined, pause) : new JobsearchCollector(undefined, pause);
      const report: any = await (collector as any).collect(limits, async (job: IngestJobDto) => { dtos.push(job); tally[await ingestPublicJob(job, base, token, L.maybe(job.externalId))]++; });
      const ack = await reportImportRun(report, tally, runStart, base, token, L.maybe(key));
      tallies[label] = tally; reports[label] = { ...report, seconds: Math.round((Date.now() - t0) / 1000), ack };
      console.log(`RUN ${label}`, JSON.stringify({ ...reports[label] }));
    };
    // 1. Sequential first import. Work.az reaches only its first listing page (12) through the existing collector.
    await collect('work', { maxPages: 1, maxJobs: 12, delayMs: 1500 });
    await collect('ejob', { maxPages: 3, maxJobs: details, delayMs: 5000 });
    await collect('jobsearch', { maxPages: 1, maxJobs: details, delayMs: 30_000 });
    result.firstRun = { reports, tallies };
    writeFileSync(out.replace(/\.json$/, '') + '.dtos.json', JSON.stringify(dtos));

    // 2. Measurements
    const now = new Date();
    const rows = await prisma.job.findMany({ select: { id: true, externalId: true, company: true, location: true, title: true, postedAt: true, deadline: true, status: true, hiddenAt: true, duplicateOfId: true, applicationMethod: true, applicationEmail: true, url: true, rawPayload: true, contentHash: true, canonicalUrl: true, duplicateReason: true } });
    const src = (r: { externalId: string }) => r.externalId.split(':')[0];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const actionable = (r: (typeof rows)[number]) => r.status === 'ACTIVE' && !r.hiddenAt && !r.duplicateOfId && (!r.deadline || r.deadline >= now);
    const days = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86_400_000);
    const metrics: Record<string, any> = {};
    for (const key of ['work', 'ejob', 'jobsearch']) {
      const mine = rows.filter((r) => src(r) === key);
      const intervals = mine.filter((r) => r.deadline).map((r) => days(r.deadline!, r.postedAt));
      const hist = new Map<number, number>(); intervals.forEach((d) => hist.set(d, (hist.get(d) ?? 0) + 1));
      const modal = [...hist.entries()].sort((a, b) => b[1] - a[1])[0];
      const modalShare = intervals.length ? (modal?.[1] ?? 0) / intervals.length : 0;
      const platformGenerated = intervals.length >= 10 && modalShare >= 0.6;
      const age = (r: (typeof rows)[number]) => days(now, r.postedAt);
      const dups = mine.filter((r) => r.duplicateOfId);
      const own = mine.filter(actionable);
      metrics[key] = {
        stored: mine.length,
        active: mine.filter((r) => r.status === 'ACTIVE').length,
        expired: mine.filter((r) => r.status === 'ACTIVE' && r.deadline && r.deadline < now).length,
        hidden: mine.filter((r) => r.hiddenAt).length,
        duplicateLinkedAcrossOrWithin: dups.length,
        duplicateLinkedTo: dups.reduce<Record<string, number>>((m, r) => { const k = src(byId.get(r.duplicateOfId!) ?? { externalId: '?:' }); m[k] = (m[k] ?? 0) + 1; return m; }, {}),
        uniquelyActionable: own.length,
        withStatedDeadline: mine.filter((r) => r.deadline).length,
        deadlineMinusPublishedDays: { min: Math.min(...intervals), max: Math.max(...intervals), modal: modal ? { days: modal[0], share: Number(modalShare.toFixed(2)) } : null },
        deadlineLooksPlatformGenerated: platformGenerated,
        // Freshness evidence: a deadline that is the same interval for most postings is the platform's default window, not the employer's statement.
        unknownFreshnessActionable: own.filter((r) => !r.deadline || platformGenerated).length,
        publicationAgeDays: { le7: mine.filter((r) => age(r) <= 7).length, d8to30: mine.filter((r) => age(r) > 7 && age(r) <= 30).length, d31to90: mine.filter((r) => age(r) > 30 && age(r) <= 90).length, gt90: mine.filter((r) => age(r) > 90).length },
        publicationDateViolations: mine.filter((r) => r.postedAt.getTime() > now.getTime() + 86_400_000 || (r.deadline && r.postedAt > r.deadline)).length,
        publicationYearInferred: mine.filter((r) => (r.rawPayload as any)?.postedAtEvidence === 'listing_day_month_year_inferred').length,
        missingEmployerStored: mine.filter((r) => !r.company.trim()).length,
        locationUnknown: mine.filter((r) => r.location === 'Azerbaijan' || (r.rawPayload as any)?.locationKnown === false).length,
        applicationMethod: mine.reduce<Record<string, number>>((m, r) => { m[r.applicationMethod] = (m[r.applicationMethod] ?? 0) + 1; return m; }, {}),
        applicationEmailExtracted: mine.filter((r) => r.applicationEmail).length,
        sourceLinkMissing: mine.filter((r) => !r.url).length,
        distinctEmployers: new Set(mine.map((r) => r.company.toLowerCase())).size,
        rejectedByReason: reports[key]?.rejections ?? {},
      };
    }
    const actionableAll = rows.filter(actionable);
    metrics.total = {
      stored: rows.length, uniquelyActionable: actionableAll.length,
      duplicateLinked: rows.filter((r) => r.duplicateOfId).length,
      crossSourceLinks: rows.filter((r) => r.duplicateOfId && src(byId.get(r.duplicateOfId) ?? { externalId: '?:' }) !== src(r)).length,
      withinSourceLinks: rows.filter((r) => r.duplicateOfId && src(byId.get(r.duplicateOfId) ?? { externalId: '?:' }) === src(r)).length,
    };
    // Within-source repeats that were deliberately NOT linked (same company+title+location in one source): possible reposts, kept separate.
    const key3 = (r: (typeof rows)[number]) => `${src(r)}|${r.company.toLowerCase()}|${r.title.toLowerCase()}|${r.location.toLowerCase()}`;
    const groups = new Map<string, number>(); rows.forEach((r) => groups.set(key3(r), (groups.get(key3(r)) ?? 0) + 1));
    metrics.total.withinSourceSameCompanyTitleLocationKeptSeparate = [...groups.values()].filter((n) => n > 1).length;
    result.metrics = metrics;
    result.unionByEmployer = (() => { const m = new Map<string, Set<string>>(); rows.forEach((r) => { const k = r.company.toLowerCase(); (m.get(k) ?? m.set(k, new Set()).get(k)!).add(src(r)); }); return { employersInMoreThanOneSource: [...m.values()].filter((s) => s.size > 1).length, distinctEmployers: m.size }; })();

    // 3. Idempotency: (a) replay every accepted record through the real ingestion path; (b) a small live re-collection (no state carried over).
    const before = new Map(rows.map((r) => [r.externalId, r.contentHash]));
    const replay = emptyTally();
    for (const dto of dtos) replay[await ingestPublicJob(dto, base, token, L.maybe(dto.externalId))]++;
    const afterRows = await prisma.job.findMany({ select: { externalId: true, contentHash: true, id: true } });
    result.idempotency = {
      replayed: dtos.length, replayOutcomes: replay,
      rowCountBefore: rows.length, rowCountAfter: afterRows.length,
      contentHashesChanged: afterRows.filter((r) => before.get(r.externalId) !== r.contentHash).length,
      idsStable: afterRows.every((r) => rows.find((x) => x.externalId === r.externalId)?.id === r.id),
    };
    const rerun: Record<string, any> = {};
    for (const [key, lim] of [['ejob', { maxPages: 1, maxJobs: 8, delayMs: 5000 }], ['work', { maxPages: 1, maxJobs: 4, delayMs: 1500 }], ['jobsearch', { maxPages: 1, maxJobs: 4, delayMs: 30_000 }]] as const) {
      await collect(key, lim, `${key}-rerun`);
      rerun[key] = { report: reports[`${key}-rerun`], outcomes: tallies[`${key}-rerun`] };
    }
    result.idempotency.liveRecollection = rerun;
    result.idempotency.rowCountAfterRecollection = await prisma.job.count();

    // 4. Moderation and references survive re-ingestion
    const victim = dtos.find((d) => d.externalId.startsWith('jobsearch:')) ?? dtos[0];
    const victimRow = await prisma.job.findUniqueOrThrow({ where: { externalId: victim.externalId } });
    const user = await prisma.user.create({ data: { email: `trial-${started}@example.com`, hashedPassword: 'x' } });
    await prisma.savedJob.create({ data: { userId: user.id, jobId: victimRow.id } });
    await prisma.job.update({ where: { id: victimRow.id }, data: { hiddenAt: new Date(), hiddenReason: 'trial moderation' } });
    const outcome = await ingestPublicJob(victim, base, token, L.maybe(victim.externalId));
    const afterVictim = await prisma.job.findUniqueOrThrow({ where: { id: victimRow.id } });
    result.moderationAndReferences = {
      reingestOutcome: outcome, sameRow: afterVictim.id === victimRow.id, stillHidden: !!afterVictim.hiddenAt && afterVictim.hiddenReason === 'trial moderation',
      savedJobReferenceKept: (await prisma.savedJob.count({ where: { userId: user.id, jobId: victimRow.id } })) === 1,
      notActionableWhileHidden: afterVictim.hiddenAt !== null,
    };

    // 5. Partial, failed and limited runs close nothing; a complete run of ANOTHER source closes only that source's own postings.
    const snapshot = async () => (await prisma.job.findMany({ select: { externalId: true, status: true, missedImports: true, closedAt: true }, orderBy: { externalId: 'asc' } })).map((r) => `${r.externalId}|${r.status}|${r.missedImports}|${r.closedAt ? 1 : 0}`).join('\n');
    const snap0 = await snapshot();
    const bad = { pages: 1, discovered: 3, fetched: 3, accepted: 0, created: 0, updated: 0, unchanged: 0, reopened: 0, expired: 0, skipped: 0 };
    const unsafeReports: Record<string, any>[] = [
      { ...bad, complete: false, failed: 0, error: 'Collection limit reached; coverage incomplete' },
      { ...bad, complete: false, failed: 2, error: 'Some details could not be parsed; no closures inferred' },
      { ...bad, complete: true, failed: 2 },
      { ...bad, complete: true, failed: 0, error: 'Source HTTP 429' },
      { ...bad, complete: false, failed: 0, discovered: 0, error: 'Listing has no recognizable vacancy entries' },
    ];
    const closures: number[] = [];
    for (const key of ['ejob', 'jobsearch', 'work']) for (const rep of unsafeReports) for (let i = 0; i < 4; i++) {
      await sleep(1100);
      const ack = await reportImportRun({ ...rep, source: key } as any, emptyTally(), new Date(), base, token, L.maybe(key));
      closures.push(ack.closed);
    }
    result.unsafeRuns = { reportsSent: closures.length, totalClosed: closures.reduce((a, b) => a + b, 0), jobStateUnchanged: (await snapshot()) === snap0 };
    // Control with a synthetic source that really does report verified-complete listings: only its own missing posting closes.
    await prisma.jobSource.create({ data: { key: 'trialctl', name: 'Trial control', homepageUrl: 'https://example.invalid/', collectionMethod: 'synthetic', scope: 'synthetic', applicationMethods: ['EXTERNAL_SITE'], enabled: true, scheduled: false } });
    const ctl = (id: number): IngestJobDto => ({ externalId: `trialctl:${id}`, title: `Control ${id}`, company: 'Control Co', description: `Synthetic control posting number ${id} with enough text to be a valid vacancy description for the importer.`, location: 'Bakı', url: `https://example.invalid/jobs/${id}`, postedAt: new Date().toISOString() });
    await ingestPublicJob(ctl(1), base, token); await ingestPublicJob(ctl(2), base, token);
    const others0 = (await snapshot()).split('\n').filter((l) => !l.startsWith('trialctl:')).join('\n');
    const ctlClosed: number[] = [];
    for (let i = 0; i < 4; i++) {
      await sleep(1200);
      const runStart = new Date();
      await sleep(1200);
      await ingestPublicJob(ctl(1), base, token); // listed this run; trialctl:2 is not
      const ack = await reportImportRun({ source: 'trialctl', complete: true, pages: 1, discovered: 2, fetched: 1, accepted: 1, created: 0, updated: 0, unchanged: 1, reopened: 0, expired: 0, skipped: 0, failed: 0 } as any, emptyTally(), runStart, base, token);
      ctlClosed.push(ack.closed);
    }
    const others1 = (await snapshot()).split('\n').filter((l) => !l.startsWith('trialctl:')).join('\n');
    const ctl2 = await prisma.job.findUniqueOrThrow({ where: { externalId: 'trialctl:2' } });
    const ctl1 = await prisma.job.findUniqueOrThrow({ where: { externalId: 'trialctl:1' } });
    result.scopedClosureControl = { closedPerCompleteRun: ctlClosed, missingPostingClosed: ctl2.status === 'CLOSED', listedPostingStillActive: ctl1.status === 'ACTIVE', otherSourcesUntouched: others0 === others1 };
    result.finishedAt = new Date().toISOString(); result.elapsedMinutes = Number(((Date.now() - started) / 60_000).toFixed(1));
    writeFileSync(out, JSON.stringify(result, null, 1));
    console.log('TRIAL_DONE', out);
  } finally {
    await app?.close().catch(() => undefined);
    await sleep(500);
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch((e) => console.error('drop failed', e.message));
    await admin.$disconnect();
    console.log('SCRATCH_DATABASE_DROPPED', name);
  }
}
main().catch((e) => { console.error('TRIAL_FAILED', e.message); process.exitCode = 1; });
