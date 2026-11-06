import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../src/database/database.service';
import { LocalStorageService } from '../src/resumes/local-storage.service';
import { ObservedCompaniesController } from '../src/observed-companies/observed-companies.controller';
import { ObservedCompaniesService } from '../src/observed-companies/observed-companies.service';
import { observedCompanyId, observedCompanyKey } from '../src/observed-companies/observed-company.util';
import { coverageSummary } from '../src/jobs/job-source.service';
import { describeEnvironment } from '../src/scripts/report-source-coverage';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
const stamp = `oc${Date.now()}`;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`synthetic logo ${stamp}`)]);

describe('public pages for observed companies (isolated Postgres, synthetic postings)', () => {
  let app: INestApplication, prisma: PrismaService, storage: LocalStorageService;
  const ids: string[] = [];
  const openAlpha: string[] = [];
  const files: string[] = [];
  let n = 0;
  const alpha = `${stamp} Alpha`;
  const alphaId = observedCompanyId(observedCompanyKey(alpha));
  const get = (url: string) => request(app.getHttpServer()).get(url);

  async function job(company: string, over: Record<string, unknown> = {}, source = 'work') {
    const row = await prisma.job.create({
      data: { externalId: `${source}:${stamp}-${++n}`, title: `Role ${n}`, company, description: 'Synthetic posting text', location: 'Bakı', url: `https://source.example/${stamp}/${n}`, postedAt: new Date(Date.now() - n * 3600_000), applicationMethod: 'EXTERNAL_SITE', ...over },
    });
    ids.push(row.id);
    return row;
  }

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Requires the isolated local aise_phase2_test database');
    const module = await Test.createTestingModule({ controllers: [ObservedCompaniesController], providers: [PrismaService, LocalStorageService, ObservedCompaniesService] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = module.get(PrismaService); storage = module.get(LocalStorageService);

    // Alpha: 3 open (two spellings, two sources) + one of every kind that must NOT count.
    openAlpha.push((await job(alpha)).id, (await job(alpha)).id);
    await job(`${alpha} MMC`, {}, 'smartjob');
    await job(alpha, { status: 'CLOSED' });
    await job(alpha, { hiddenAt: new Date(), hiddenReason: 'moderation' });
    await job(alpha, { deadline: new Date(Date.now() - 86_400_000) });
    const primary = await job(`${stamp} Elsewhere`);
    await job(alpha, { duplicateOfId: primary.id });
    // A company whose only posting is closed keeps its page; one with no usable name is never given a page.
    await job(`${stamp} Gone`, { status: 'CLOSED' });
    await job('— —');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.observedCompanyProfile.deleteMany({ where: { companyKey: { startsWith: stamp } } });
      await prisma.job.deleteMany({ where: { id: { in: ids } } });
    }
    for (const f of files) await storage.deleteFile(f).catch(() => undefined);
    await app?.close();
  });

  it('counts exactly the distinct open postings: closed, hidden, expired and cross-source repeats are not counted', async () => {
    const detail = (await get(`/public/companies/${alphaId}`).expect(200)).body;
    expect(detail).toMatchObject({ id: alphaId, name: alpha, aliases: [`${alpha} MMC`], openCount: 3, total: 3, registered: false, followKey: observedCompanyKey(alpha) });
    expect(detail.jobs).toHaveLength(3);
    expect(detail.jobs.every((j: any) => j.kind === 'imported' && j.url === undefined && j.checkedAt)).toBe(true);
    expect(detail.sources).toEqual([{ key: 'work', name: expect.any(String), count: 2 }, { key: 'smartjob', name: expect.any(String), count: 1 }]);
    expect(detail.attribution.sources.map((s: any) => s.key).sort()).toEqual(['smartjob', 'work']);
    expect(detail.attribution.statement).toContain('qeydiyyatdan keçmiş işəgötürən deyil');
    // Nothing internal or private.
    expect(JSON.stringify(detail)).not.toMatch(/rawPayload|description|hiddenReason|externalId|contactEmail|businessId/);
    const page = (await get(`/public/companies/${alphaId}?limit=2&page=2`).expect(200)).body;
    expect(page).toMatchObject({ page: 2, limit: 2, total: 3 });
    expect(page.jobs).toHaveLength(1);
  });

  it('lists companies with totals that reconcile with the postings table, and reports postings without a usable name separately', async () => {
    const list = (await get('/public/companies?limit=100').expect(200)).body;
    const truth = await prisma.$queryRaw<{ company: string; n: number }[]>`SELECT company, COUNT(*)::int AS n FROM "Job" WHERE status='ACTIVE' AND "hiddenAt" IS NULL AND "duplicateOfId" IS NULL AND (deadline IS NULL OR deadline >= now()) GROUP BY 1`;
    const keyed = truth.filter((r) => observedCompanyKey(r.company));
    expect(list.totals.openPostings).toBe(keyed.reduce((s, r) => s + r.n, 0));
    expect(list.totals.postingsWithoutUsableCompanyName).toBe(truth.filter((r) => !observedCompanyKey(r.company)).reduce((s, r) => s + r.n, 0));
    expect(list.totals.postingsWithoutUsableCompanyName).toBeGreaterThanOrEqual(1);
    expect(list.totals.companies).toBe(new Set(keyed.map((r) => observedCompanyKey(r.company))).size);
    expect(list.total).toBe(list.totals.companies);
    const mine = (await get(`/public/companies?q=${encodeURIComponent(stamp.toUpperCase() + ' alpha')}`).expect(200)).body;
    expect(mine.companies).toHaveLength(1);
    expect(mine.companies[0]).toMatchObject({ id: alphaId, openCount: 3, logo: null, monogram: { text: expect.any(String), color: expect.stringMatching(/^#/) } });
    // A company with no open posting is not listed, but keeps its page and id.
    expect((await get(`/public/companies?q=${stamp}%20gone`).expect(200)).body.companies).toHaveLength(0);
    const goneId = observedCompanyId(observedCompanyKey(`${stamp} Gone`));
    expect((await get(`/public/companies/${goneId}`).expect(200)).body).toMatchObject({ openCount: 0, jobs: [], sources: [] });
    expect((await get('/public/companies?sort=name&limit=100').expect(200)).body.companies.length).toBeGreaterThan(0);
  });

  it('keeps the id stable across re-imports and closures, and answers 404 for unknown or malformed ids', async () => {
    const before = (await get(`/public/companies/${alphaId}`).expect(200)).body.id;
    await prisma.job.updateMany({ where: { id: { in: openAlpha } }, data: { status: 'CLOSED' } });
    expect((await get(`/public/companies/${alphaId}`).expect(200)).body).toMatchObject({ id: before, openCount: 1 }); // the smartjob spelling is still open
    await prisma.job.updateMany({ where: { id: { in: openAlpha } }, data: { status: 'ACTIVE' } });
    expect((await get(`/public/companies/${alphaId}`).expect(200)).body.openCount).toBe(3);
    await get('/public/companies/oc_0000000000000000').expect(404);
    await get('/public/companies/not-an-id').expect(404);
    await get(`/public/companies/${alphaId}?page=0`).expect(400);
    await get('/public/companies?limit=1000').expect(400);
  });

  it('shows a logo only with complete provenance, otherwise a monogram', async () => {
    const key = observedCompanyKey(alpha);
    const stored = await storage.uploadBuffer(png, 'image/png');
    files.push(stored);
    // File and source, but no verification time or source page: not shown.
    await prisma.observedCompanyProfile.create({ data: { companyKey: key, displayName: alpha, logoFile: stored, logoSource: 'employer_website' } });
    expect((await get(`/public/companies/${alphaId}`).expect(200)).body.logo).toBeNull();
    await get(`/public/companies/${alphaId}/logo`).expect(404);
    await prisma.observedCompanyProfile.update({ where: { companyKey: key }, data: { logoSourceUrl: 'https://alpha.example/about', logoVerifiedAt: new Date('2026-10-04T10:00:00Z'), website: 'https://alpha.example' } });
    const detail = (await get(`/public/companies/${alphaId}`).expect(200)).body;
    expect(detail.logo).toMatchObject({ url: `/public/companies/${alphaId}/logo`, source: 'employer_website', sourceUrl: 'https://alpha.example/about', verifiedAt: '2026-10-04T10:00:00.000Z' });
    expect(detail.website).toBe('https://alpha.example');
    const res = await get(detail.logo.url).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (x: Buffer) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(res.body).equals(png)).toBe(true);
    // A stored file that is not an image is never served as one.
    const evil = await storage.uploadBuffer(Buffer.from('<svg onload="alert(1)"/>'), 'image/png');
    files.push(evil);
    await prisma.observedCompanyProfile.update({ where: { companyKey: key }, data: { logoFile: evil } });
    await get(`/public/companies/${alphaId}/logo`).expect(404);
    expect(fs.existsSync(path.join(process.cwd(), 'uploads', stored.split('/').pop()!))).toBe(true);
  });

  it('measures coverage with the fields a reviewer needs and never calls a bounded run complete', async () => {
    const source = `ocsrc${Date.now()}`.slice(0, 20);
    await prisma.jobSource.create({ data: { key: source, name: 'Synthetic source', homepageUrl: 'https://source.example', collectionMethod: 'test', scope: 'test' } });
    try {
      const mk = (over: Record<string, unknown> = {}) => prisma.job.create({ data: { externalId: `${source}:${++n}`, title: `Role ${n}`, company: `${stamp} Cov`, description: 'x', location: 'Bakı', url: `https://source.example/${n}`, postedAt: new Date(), ...over } });
      const [seenInComplete, seenBefore] = [await mk(), await mk({ lastSeenAt: new Date(Date.now() - 3 * 86_400_000) })];
      ids.push(seenInComplete.id, seenBefore.id);
      const dup = await mk({ duplicateOfId: seenInComplete.id });
      ids.push(dup.id);
      const report = async () => (await coverageSummary(prisma as never, [])).sources.find((s) => s.key === source)!;
      expect((await report()).completeness).toBe('never_run');
      // A bounded run: nothing is proven.
      await prisma.jobImportRun.create({ data: { source, status: 'SUCCEEDED', listingComplete: false, discovered: 5, listed: 5, created: 2, rejected: 1, expired: 1, detailFailures: 0, pagesFetched: 1, finishedAt: new Date(), runKey: `${source}-1` } });
      let s = await report();
      expect(s).toMatchObject({ completeness: 'bounded_or_partial', counts: { open: 2, openVerifiedInCompleteListing: 0, openFreshnessUnknown: 2, duplicates: 1 }, lastRun: { discovered: 5, accepted: 2, rejected: 1, expired: 1, failed: 0, pages: 1, listingComplete: false } });
      // A complete run with detail failures is still not verified complete.
      await prisma.jobImportRun.create({ data: { source, status: 'SUCCEEDED', listingComplete: true, discovered: 5, detailFailures: 2, startedAt: new Date(Date.now() + 1000), finishedAt: new Date(Date.now() + 2000), runKey: `${source}-2` } });
      expect((await report()).completeness).toBe('bounded_or_partial');
      // A verified complete run: only postings seen at or after it are proven listed; the older one stays unknown.
      const startedAt = new Date(Date.now() - 3600_000);
      await prisma.job.update({ where: { id: seenInComplete.id }, data: { lastSeenAt: new Date() } });
      await prisma.jobImportRun.create({ data: { source, status: 'SUCCEEDED', listingComplete: true, discovered: 2, listed: 2, unchanged: 2, startedAt: new Date(Date.now() + 5000), finishedAt: new Date(Date.now() + 6000), runKey: `${source}-3` } });
      await prisma.job.update({ where: { id: seenInComplete.id }, data: { lastSeenAt: new Date(Date.now() + 7000) } });
      void startedAt;
      s = await report();
      expect(s).toMatchObject({ completeness: 'verified_complete', counts: { open: 2, openVerifiedInCompleteListing: 1, openFreshnessUnknown: 1 } });
      const summary = await coverageSummary(prisma as never, []);
      expect(summary.openVerifiedInCompleteListing + summary.openFreshnessUnknown).toBe(summary.openPostings);
      // A failed last run proves nothing either.
      await prisma.jobImportRun.create({ data: { source, status: 'FAILED', listingComplete: false, startedAt: new Date(Date.now() + 10_000), runKey: `${source}-4`, error: 'boom' } });
      expect((await report()).completeness).toBe('failed');
    } finally {
      await prisma.jobImportRun.deleteMany({ where: { source } });
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `${source}:` } } });
      await prisma.jobSource.delete({ where: { key: source } });
    }
  });

  it('names its environment and refuses to treat an unclassified database as isolated', () => {
    expect(describeEnvironment('postgresql://u:secret@127.0.0.1:5433/aise_phase2_test?schema=public')).toEqual({ label: '127.0.0.1:5433/aise_phase2_test', isolated: true });
    expect(describeEnvironment('postgresql://u:secret@127.0.0.1:5433/aise_scratch_trial_1?schema=public').isolated).toBe(true);
    expect(describeEnvironment('postgresql://u:secret@db.internal:5432/aise_phase2_test').isolated).toBe(false); // a remote host is never "isolated" by its name
    expect(describeEnvironment('postgresql://u:secret@127.0.0.1:5433/aise').isolated).toBe(false);
    expect(JSON.stringify(describeEnvironment('postgresql://u:secret@127.0.0.1:5433/aise'))).not.toContain('secret');
    expect(describeEnvironment(undefined)).toEqual({ label: 'unknown database', isolated: false });
  });
});
