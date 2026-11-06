import { TestLeases } from './support/source-lease';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../src/database/database.service';
import { ApiKeyGuard } from '../src/jobs/api-key.guard';
import { JobsController } from '../src/jobs/jobs.controller';
import { JobsService, isJobActionable } from '../src/jobs/jobs.service';
import { JobSourceService } from '../src/jobs/job-source.service';
import { EjobCollector } from '../src/scrapers/public-jobs/ejob.collector';
import { JobsearchCollector } from '../src/scrapers/public-jobs/jobsearch.collector';
import { ingestPublicJob, reportImportRun } from '../src/scripts/import-public-jobs';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';

/**
 * The eJob and JobSearch collectors, fed synthetic pages that follow the structures observed on the public sites, into the REAL guarded ingestion route
 * (DTO validation), lifecycle reconciliation and deduplication on the isolated database. No source traffic, no e-mail, no model calls.
 */
describe('eJob and JobSearch collectors into the import API (isolated database)', () => {
  const stamp = Date.now();
  const ejobId = 900_000_000 + (stamp % 1_000_000);
  const jsId = 800_000_000 + (stamp % 1_000_000);
  const company = `Synthetic New Sources ${stamp} MMC`;
  const token = 'synthetic-new-sources-token';
  const text = 'Hesabatların hazırlanması məlumatların təhlili SQL və Excel bilikləri komanda ilə əməkdaşlıq biznes tələblərinin toplanması dashboardların qurulması nəticələrin təqdim edilməsi və keyfiyyətə nəzarət etmək';
  const now = new Date('2026-10-03T12:00:00.000Z');
  const ejobUrl = `https://ejob.az/is-elani/${ejobId}-synthetic-analyst/`;
  const jsUrl = `https://classic.jobsearch.az/vacancies/synthetic-analyst-${jsId}`;
  const ld = (validThrough: string) => JSON.stringify({ '@type': 'JobPosting', title: `Synthetic Analyst ${stamp}`, identifier: { value: String(ejobId) }, datePosted: '2026-10-03', validThrough, jobLocation: { '@type': 'Place', address: { addressLocality: 'Bakı', addressCountry: 'AZ' } }, hiringOrganization: { name: company } });
  const ejobDetail = (validThrough = '2099-12-31T00:00') => `<html><head><script type="application/ld+json">${ld(validThrough)}</script></head><body><h1 class='position'>Synthetic Analyst ${stamp}</h1><a href='/company/x/'><div class='name'>${company}</div></a><table><tr><td class='ttitle'>Şəhər :</td><td>Bakı</td></tr></table><div>İş barədə məlumat:<br>${text}<br>Əlavə olunub : 2026-10-03</div></body></html>`;
  const jsDetail = `<html><body><div class="vacancies__provided"><span>${company}</span></div><h1>Synthetic Analyst ${stamp}</h1><div>Deadline 3 Noyabr 2099</div><div class="vacancy__description"><p>${text}</p></div></body></html>`;
  const jsListing = (published = '3 Oktyabr') => `<html><body><ul data-id="${jsId}" class="vacancies__item"><li><h2><a href="${jsUrl}">Synthetic Analyst ${stamp}</a></h2></li><li><a class="vacancies__provided"><span>${company}</span></a></li><li class="d-none d-lg-block">${published}</li><li class="d-none d-lg-block">3 Noyabr</li></ul></body></html>`;

  let app: INestApplication; let prisma: PrismaService; let base: string; let leases: TestLeases;
  let ejobValidThrough = '2099-12-31T00:00'; let ejobBroken = false;
  const queue = { add: jest.fn(async () => ({})) };
  const ejobRead = async (url: string) => {
    if (url.endsWith('/robots.txt')) return 'User-agent: *\nDisallow: /cabinet/*';
    if (url.endsWith('/is-elanlari/')) return `<html><body><a href='/is-elani/${ejobId}-synthetic-analyst/'>x</a></body></html>`;
    if (url === ejobUrl) return ejobBroken ? '<html><body>Layout changed</body></html>' : ejobDetail(ejobValidThrough);
    throw new Error(`unexpected ${url}`);
  };
  const jsRead = async (url: string) => {
    if (url.endsWith('/robots.txt')) return 'User-agent: *\nCrawl-delay: 30\nDisallow: /unsu';
    if (url.includes('/vacancies?')) return jsListing();
    if (url === jsUrl) return jsDetail;
    throw new Error(`unexpected ${url}`);
  };
  const outcomes: string[] = [];
  const runEjob = () => new EjobCollector(ejobRead, async () => {}, () => now).collect({ maxPages: 1, maxJobs: 5, delayMs: 1000 }, async (job) => { outcomes.push(await ingestPublicJob(job, base, token, leases.of('ejob'))); });
  const runJs = () => new JobsearchCollector(jsRead, async () => {}, () => now).collect({ maxPages: 1, maxJobs: 5, delayMs: 1000 }, async (job) => { outcomes.push(await ingestPublicJob(job, base, token, leases.of('jobsearch'))); });

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Requires the isolated local aise_phase2_test database');
    const module = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [PrismaService, JobsService, JobSourceService, ApiKeyGuard,
        { provide: ConfigService, useValue: { get: (key: string) => key === 'SCRAPER_SERVICE_TOKEN' ? token : undefined } },
        { provide: getQueueToken('job-ingested'), useValue: queue }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    prisma = app.get(PrismaService);
    leases = new TestLeases(prisma); await leases.take('ejob', 'jobsearch');
  });
  afterAll(async () => {
    await leases?.releaseAll();
    if (prisma) {
      await prisma.job.deleteMany({ where: { externalId: { in: [`ejob:${ejobId}`, `jobsearch:${jsId}`] } } });
      await prisma.jobSource.updateMany({ where: { key: { in: ['ejob', 'jobsearch'] } }, data: { enabled: false } });
      await prisma.jobImportRun.deleteMany({ where: { source: { in: ['ejob', 'jobsearch'] }, startedAt: { gte: new Date(stamp - 1000) } } });
    }
    if (app) await app.close();
  });

  it('while the sources are held (the shipped state) the ingestion API refuses their postings and nothing is stored', async () => {
    await prisma.jobSource.updateMany({ where: { key: { in: ['ejob', 'jobsearch'] } }, data: { enabled: false } });
    const held = await prisma.jobSource.findMany({ where: { key: { in: ['ejob', 'jobsearch'] } }, select: { key: true, enabled: true, scheduled: true } });
    expect(held.every((s) => s.enabled === false && s.scheduled === false)).toBe(true);
    for (const run of [runEjob, runJs]) {
      const report = await run();
      expect(report).toMatchObject({ accepted: 0, complete: false });
      expect(report.error).toContain('403');
    }
    expect(await prisma.job.count({ where: { externalId: { in: [`ejob:${ejobId}`, `jobsearch:${jsId}`] } } })).toBe(0);
    // The remaining tests exercise the pipeline in this disposable test database only, so the sources are enabled here.
    await prisma.jobSource.updateMany({ where: { key: { in: ['ejob', 'jobsearch'] } }, data: { enabled: true } });
  });

  it('eJob output passes the real ingestion validation and is stored with Baku-time dates, identity and source link', async () => {
    expect(await runEjob()).toMatchObject({ complete: false, accepted: 1, failed: 0 });
    const row = await prisma.job.findUniqueOrThrow({ where: { externalId: `ejob:${ejobId}` } });
    expect(row).toMatchObject({ title: `Synthetic Analyst ${stamp}`, company, location: 'Bakı', url: ejobUrl, status: 'ACTIVE' });
    expect(row.postedAt.toISOString()).toBe('2026-10-02T20:00:00.000Z');
    expect(row.deadline?.toISOString()).toBe('2099-12-30T20:00:00.000Z');
    expect(isJobActionable(row)).toBe(true);
    expect(await prisma.job.count({ where: { externalId: `ejob:${ejobId}` } })).toBe(1);
  });

  it('JobSearch output is ingested; an identical posting without a city links to the eJob one (evidence kept), without a second matching job', async () => {
    const queued = queue.add.mock.calls.length;
    expect(await runJs()).toMatchObject({ complete: false, accepted: 1, failed: 0 });
    const original = await prisma.job.findUniqueOrThrow({ where: { externalId: `ejob:${ejobId}` } });
    const js = await prisma.job.findUniqueOrThrow({ where: { externalId: `jobsearch:${jsId}` } });
    expect(js.location).toBe('Azerbaijan');
    expect(js.duplicateOfId).toBe(original.id);
    expect(queue.add.mock.calls.length).toBe(queued);
  });

  it('operator moderation survives a re-collection of the same posting', async () => {
    await prisma.job.update({ where: { externalId: `ejob:${ejobId}` }, data: { hiddenAt: new Date(), hiddenReason: 'synthetic moderation' } });
    await runEjob();
    const row = await prisma.job.findUniqueOrThrow({ where: { externalId: `ejob:${ejobId}` } });
    expect(row.hiddenAt).not.toBeNull();
    expect(row.hiddenReason).toBe('synthetic moderation');
    expect(isJobActionable(row)).toBe(false);
    await prisma.job.update({ where: { externalId: `ejob:${ejobId}` }, data: { hiddenAt: null, hiddenReason: null } });
  });

  it('a layout change is rejected (nothing stored from it) and an incomplete or failed run closes no unseen posting', async () => {
    const before = await prisma.job.findUniqueOrThrow({ where: { externalId: `ejob:${ejobId}` } });
    ejobBroken = true;
    const report = await runEjob();
    ejobBroken = false;
    expect(report).toMatchObject({ failed: 1, accepted: 0, complete: false });
    const tally = { created: 0, updated: 0, reopened: 0, unchanged: 0 } as Record<'created' | 'updated' | 'reopened' | 'unchanged', number>;
    for (let i = 0; i < 4; i++) {
      const ack = await reportImportRun({ ...report, source: 'ejob' }, tally, new Date(), base, token, leases.of('ejob'));
      expect(ack.closed).toBe(0);
    }
    const after = await prisma.job.findUniqueOrThrow({ where: { externalId: `ejob:${ejobId}` } });
    expect(after.status).toBe('ACTIVE');
    expect(after.contentHash).toBe(before.contentHash);
  });

  it('a posting whose source validity has passed is stored but not actionable; the row and history stay', async () => {
    ejobValidThrough = '2026-09-01T00:00';
    const report = await runEjob();
    ejobValidThrough = '2099-12-31T00:00';
    expect(report.expired).toBe(1);
    const row = await prisma.job.findUniqueOrThrow({ where: { externalId: `ejob:${ejobId}` } });
    expect(isJobActionable(row)).toBe(false);
    expect(await prisma.job.count({ where: { externalId: `ejob:${ejobId}` } })).toBe(1);
  });
});
