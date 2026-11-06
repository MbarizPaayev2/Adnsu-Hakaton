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
import { PublicJobCollector } from '../src/scrapers/public-jobs/public-job-collector';
import { AbbCollector, ABB_ORIGIN } from '../src/scrapers/public-jobs/abb.collector';
import { ingestPublicJob } from '../src/scripts/import-public-jobs';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';

/** Real collector, HTTP controller, service token guard, validation and Postgres.
 * Source HTML and matching queue are synthetic; no source traffic, email or model calls. */
describe('public collector to local import API', () => {
  const stamp = `public-import-${Date.now()}`;
  const origin = 'https://www.hellojob.az';
  const vacancyUrl = `${origin}/vakansiya/${stamp}`;
  const externalId = `hellojob:${stamp}`;
  const token = 'synthetic-public-import-token';
  const description = 'TypeScript proqramları hazırlamaq PostgreSQL verilənlər bazası ilə işləmək testlər yazmaq komanda ilə əlaqə saxlamaq istifadəçilər üçün etibarlı proqram təminatı yaratmaq sənədləşdirmə aparmaq və mövcud sistemləri yaxşılaşdırmaq';
  const detail = (deadline = '15 oktyabr 2099', posted = '01 oktyabr 2026') => `<div class="company__body"><div class="company__item vacancies__body">
    <h2 class="vacancies__subTitle">Backend mühəndisi</h2><a class="vacancies__category" href="/sirket/synthetic">Synthetic ${stamp} MMC</a>
    <ul class="company__item__details"><li><span>Şəhər</span><p>Gəncə</p></li><li><span>Yerləşmə tarixi</span><p>${posted}</p></li>
    <li><span>Bitmə tarixi</span><p>${deadline}</p></li></ul></div><div class="company__text"><p>${description}</p></div></div>`;
  let app: INestApplication;
  let prisma: PrismaService;
  let jobs: JobsService;
  let base: string;
  let leases: TestLeases;
  let currentDetail: string;
  let firstId: string;
  const abbId = Date.now();
  let abbDeadline = '01.11.2099';
  let savedAbbId: string;
  const queue = { add: jest.fn(async (_name: string, _data: { jobId: string }, _options: { jobId: string }) => ({})) };
  const collect = () => new PublicJobCollector(async (url) => {
    if (url.endsWith('/robots.txt')) return 'User-agent: *\nAllow: /';
    if (url.endsWith('/vakansiyalar')) return `<h1>Vakansiyalar</h1><a class="vacancies__body" href="${vacancyUrl}">Job</a>`;
    if (url === vacancyUrl) return currentDetail;
    throw new Error('Unexpected source URL');
  }, async () => {}).collect({ maxPages: 1, maxJobs: 2, delayMs: 1000 }, async (job) => { await ingestPublicJob(job, base, token, leases.of(job.externalId)); });
  const collectAbb = () => new AbbCollector(async (url) => url.endsWith('/robots.txt') ? 'User-agent: *\nDisallow:' : JSON.stringify({
    current_page: 1, last_page: 1, total: 1, next_page_url: null, data: [{
      id: abbId, title: `${stamp} Backend mühəndisi - Gəncə`, description: `<p>${description}</p>`,
      url: `${ABB_ORIGIN}/vakansiyalar/v2/${abbId}`, is_public: 1, status: '1', begin_date: '01.09.2026', end_date: abbDeadline,
    }],
  }), async () => {}, () => new Date('2026-10-01T12:00:00Z')).collect({ maxPages: 1, maxJobs: 2, delayMs: 1000 }, async (job) => { await ingestPublicJob(job, base, token, leases.of(job.externalId)); });

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
    prisma = app.get(PrismaService); jobs = app.get(JobsService);
    leases = new TestLeases(prisma); await leases.take('hellojob', 'abb');
    currentDetail = detail();
  });
  afterAll(async () => {
    if (prisma) await prisma.job.deleteMany({ where: { externalId: { in: [externalId, `glorri:${stamp}`, `abb:${abbId}`] } } });
    await leases?.releaseAll();
    if (app) await app.close();
  });

  it('requires authentication and rejects invalid data without creating a row', async () => {
    const response = await fetch(`${base}/internal/jobs/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(401);
    const invalid = await fetch(`${base}/internal/jobs/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ externalId }) });
    expect(invalid.status).toBe(400);
    expect(await prisma.job.findUnique({ where: { externalId } })).toBeNull();
  });
  it('imports parsed fields, retains the source link and queues an actionable job', async () => {
    expect(await collect()).toMatchObject({ complete: true, accepted: 1, failed: 0 });
    const row = await prisma.job.findUniqueOrThrow({ where: { externalId } });
    firstId = row.id;
    expect(row).toMatchObject({ title: 'Backend mühəndisi', company: `Synthetic ${stamp} MMC`, location: 'Gəncə', description, url: vacancyUrl });
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(isJobActionable(row)).toBe(true);
  });
  it('repeat collection preserves the row and the matching queue deduplication key', async () => {
    const queueId = queue.add.mock.calls[0][2].jobId;
    expect(await collect()).toMatchObject({ complete: true, accepted: 1 });
    expect((await prisma.job.findUniqueOrThrow({ where: { externalId } })).id).toBe(firstId);
    expect(await prisma.job.count({ where: { externalId } })).toBe(1);
    expect(queue.add.mock.calls[1][2].jobId).toBe(queueId);
  });
  it('cross-source duplicates stay linked without another matching job', async () => {
    const original = await prisma.job.findUniqueOrThrow({ where: { externalId } });
    const count = queue.add.mock.calls.length;
    const duplicate = (await jobs.upsertJob({ externalId: `glorri:${stamp}`, title: original.title, company: original.company, location: original.location, description, url: `https://jobs.glorri.com/vacancies/synthetic/${stamp}`, postedAt: original.postedAt.toISOString(), deadline: original.deadline!.toISOString() })).job;
    expect(duplicate.duplicateOfId).toBe(firstId);
    expect(queue.add).toHaveBeenCalledTimes(count);
  });
  it('refreshes an expired deadline without replacing the row or queueing matching', async () => {
    const count = queue.add.mock.calls.length;
    currentDetail = detail('30 sentyabr 2026', '15 sentyabr 2026');
    expect(await collect()).toMatchObject({ complete: true, expired: 1, accepted: 1 });
    const row = await prisma.job.findUniqueOrThrow({ where: { externalId } });
    expect(row.id).toBe(firstId); expect(isJobActionable(row)).toBe(false);
    expect(queue.add).toHaveBeenCalledTimes(count);
  });
  it('imports ABB through the guarded HTTP route with original link and regional city', async () => {
    const before = queue.add.mock.calls.length;
    expect(await collectAbb()).toMatchObject({ complete: true, accepted: 1, failed: 0 });
    const job = await prisma.job.findUniqueOrThrow({ where: { externalId: `abb:${abbId}` } });
    savedAbbId = job.id;
    expect(job).toMatchObject({ company: 'ABB', location: 'Gəncə', url: `${ABB_ORIGIN}/vakansiyalar/v2/${abbId}`, description });
    expect(job.deadline?.toISOString()).toBe('2099-11-01T19:59:59.999Z');
    expect(queue.add).toHaveBeenCalledTimes(before + 1);
  });
  it('repeated ABB collection preserves the same row and queue deduplication key', async () => {
    const queueId = queue.add.mock.calls.at(-1)![2].jobId;
    expect(await collectAbb()).toMatchObject({ complete: true, accepted: 1 });
    expect((await prisma.job.findUniqueOrThrow({ where: { externalId: `abb:${abbId}` } })).id).toBe(savedAbbId);
    expect(queue.add.mock.calls.at(-1)![2].jobId).toBe(queueId);
  });
  it('refreshes ABB expiration without queuing another match or removing the historical row', async () => {
    const before = queue.add.mock.calls.length;
    abbDeadline = '30.09.2026';
    expect(await collectAbb()).toMatchObject({ complete: true, accepted: 1, expired: 1 });
    const job = await prisma.job.findUniqueOrThrow({ where: { externalId: `abb:${abbId}` } });
    expect(job.id).toBe(savedAbbId); expect(isJobActionable(job)).toBe(false);
    expect(queue.add).toHaveBeenCalledTimes(before);
  });
});
