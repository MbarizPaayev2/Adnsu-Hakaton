import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/database.service';
import { JobCatalogueService } from '../src/jobs/job-catalogue.service';
import { JobCatalogueController } from '../src/jobs/job-catalogue.controller';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';

describe('public vacancy catalogue (real isolated Postgres, no scoring/email)', () => {
  const stamp = `catalogue-${Date.now()}`;
  let app: INestApplication, prisma: PrismaService;
  let imported: { id: string }[], nativeId: string, companyId: string;
  const get = (params: Record<string, string | number> = {}) => request(app.getHttpServer()).get('/jobs').query({ q: stamp, ...params });

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Requires the isolated local aise_phase2_test database');
    const module = await Test.createTestingModule({ controllers: [JobCatalogueController], providers: [PrismaService, JobCatalogueService] }).compile();
    app = module.createNestApplication(); await app.init(); prisma = app.get(PrismaService);
    imported = [];
    for (const [i, title, location, extra] of [
      [0, 'Backend developer', 'Bakı', {}], [1, 'Mühasib', 'Gəncə', {}], [2, 'Xüsusi mütəxəssis', 'Baku', {}],
      [3, 'Hidden developer', 'Bakı', { hiddenAt: new Date() }], [4, 'Expired developer', 'Bakı', { deadline: new Date(0) }],
      [5, 'Closed developer', 'Bakı', { status: 'CLOSED' }], [6, 'Duplicate developer', 'Bakı', {}],
    ] as const) {
      imported.push(await prisma.job.create({ data: { externalId: `cataloguetest:${stamp}-${i}`, title, company: `${stamp} Labs`, description: 'Public description <script>not executable</script>', location,
        url: 'https://www.hellojob.az/vakansiya/synthetic', postedAt: new Date(`2026-10-01T10:0${i}:00Z`), rawPayload: { privateSyntheticMarker: 'do-not-expose-this' },
        ...extra, ...(i === 6 ? { duplicateOfId: imported[0].id } : {}) } }));
    }
    for (const [suffix, status] of [['approved', 'APPROVED'], ['pending', 'PENDING'], ['suspended', 'SUSPENDED']] as const) {
      const business = await prisma.business.create({ data: { email: `${stamp}-${suffix}@example.com`, hashedPassword: 'synthetic-not-loginable' } });
      const company = await prisma.company.create({ data: { businessId: business.id, name: `${stamp} ${suffix}`, status, contactEmail: 'private-fixture@example.com' } });
      const vacancy = await prisma.vacancy.create({ data: { companyId: company.id, title: 'HR mütəxəssisi', location: 'Sumqayıt', description: 'Public native description', skills: [], status: 'ACTIVE' } });
      if (suffix === 'approved') {
        nativeId = vacancy.id; companyId = company.id;
        await prisma.vacancy.create({ data: { companyId, title: 'Paused role', skills: [], status: 'PAUSED' } });
        await prisma.vacancy.create({ data: { companyId, title: 'Expired role', skills: [], status: 'ACTIVE', deadline: new Date(0) } });
      }
    }
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `cataloguetest:${stamp}` } } });
      await prisma.business.deleteMany({ where: { email: { startsWith: stamp } } });
    }
    if (app) await app.close();
  });

  it('shows every open eligible listing without requiring a profile, plan or session', async () => {
    const res = await get({ limit: 50 }).expect(200);
    expect(res.body.meta.total).toBe(4); // More than the free matching allowance, with no account at all.
    expect(res.body.data.map((j: any) => j.id).sort()).toEqual([nativeId, ...imported.slice(0, 3).map((j) => j.id)].sort());
    expect(res.body.meta.totalOpen).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(res.body)).not.toMatch(/rawPayload|do-not-expose-this|private-fixture|contactEmail/);
  });
  it('paginates across both types together, with no repeats and the correct total', async () => {
    const first = (await get({ limit: 2, page: 1 }).expect(200)).body;
    const second = (await get({ limit: 2, page: 2 }).expect(200)).body;
    expect(first.meta).toMatchObject({ total: 4, page: 1, limit: 2, totalPages: 2 });
    expect(new Set([...first.data, ...second.data].map((j: any) => `${j.kind}:${j.id}`)).size).toBe(4);
    expect([...first.data, ...second.data].some((j: any) => j.kind === 'native')).toBe(true);
  });
  it('filters categories independently of matching and keeps unclassified titles visible', async () => {
    expect((await get({ category: 'technology' }).expect(200)).body.data.map((j: any) => j.id)).toEqual([imported[0].id]);
    expect((await get({ category: 'finance' }).expect(200)).body.data[0].categoryLabel).toBe('Maliyyə və mühasibat');
    expect((await get({ category: 'hr' }).expect(200)).body.data[0].id).toBe(nativeId);
    expect((await get({ category: 'other' }).expect(200)).body.data[0].id).toBe(imported[2].id);
  });
  it.each(['Bakı', 'Baki', 'Baku'])('supports city alias %s', async (location) => {
    expect((await get({ location }).expect(200)).body.meta.total).toBe(2);
  });
  it('filters source, supports empty results and treats SQL/wildcard input as data', async () => {
    expect((await get({ source: 'aise' }).expect(200)).body.data.map((j: any) => j.id)).toEqual([nativeId]);
    expect((await get({ source: 'cataloguetest' }).expect(200)).body.meta.total).toBe(3);
    expect((await get({ location: 'Unlisted city' }).expect(200)).body.meta.total).toBe(0);
    expect((await get({ q: "' OR TRUE --" }).expect(200)).body.meta.total).toBe(0);
    expect((await get({ q: '%' }).expect(200)).body.meta.total).toBe(0);
  });
  it('offers public detail without private source/company fields', async () => {
    const external = (await request(app.getHttpServer()).get(`/jobs/imported/${imported[0].id}`).expect(200)).body;
    expect(external.url).toBe('https://www.hellojob.az/vakansiya/synthetic');
    const native = (await request(app.getHttpServer()).get(`/jobs/native/${nativeId}`).expect(200)).body;
    expect(native).toMatchObject({ companyId, source: 'aise', category: 'hr', url: null });
    expect(JSON.stringify([external, native])).not.toMatch(/private-fixture|do-not-expose-this|hashedPassword/);
  });
  it('denies detail access to hidden, closed, expired and duplicate postings', async () => {
    for (const job of imported.slice(3)) await request(app.getHttpServer()).get(`/jobs/imported/${job.id}`).expect(404);
    await request(app.getHttpServer()).get(`/jobs/unknown/${nativeId}`).expect(404);
  });
  it.each([{ page: 0 }, { limit: 1000 }, { page: 'NaN' }, { category: 'unknown' }, { sort: 'random' }, { source: "' SQL" }, { q: ['one', 'two'] }])('rejects malformed/bulk options %j', async (query) => {
    await request(app.getHttpServer()).get('/jobs').query(query).expect(400);
  });

  it('filters by company, work arrangement and experience, and keeps unknown facts visibly unknown', async () => {
    const facts = [['remote', { workArrangement: 'Remote', experienceLevel: 'Junior' }], ['hybrid', { workArrangement: 'Hybrid', experienceLevel: null }], ['unknown', {}]] as const;
    for (const [name, extra] of facts) {
      await prisma.job.create({ data: { externalId: `cataloguetest:${stamp}-facts-${name}`, title: `Facts ${name}`, company: `${stamp} Facts Employer`, description: 'd', location: 'Bakı', url: 'https://www.hellojob.az/vakansiya/facts', postedAt: new Date('2026-10-01T11:00:00Z'), ...extra } });
    }
    const all = (await get({ company: `${stamp} Facts Employer`, limit: 50 }).expect(200)).body;
    expect(all.meta.total).toBe(3);
    expect(all.data.find((j: any) => j.title === 'Facts unknown')).toMatchObject({ workArrangement: null, experienceLevel: null, applicationMethod: 'UNKNOWN' });
    expect((await get({ company: `${stamp} FACTS employer`, work: 'Remote' }).expect(200)).body.data.map((j: any) => j.title)).toEqual(['Facts remote']);
    expect((await get({ company: `${stamp} Facts Employer`, work: 'unknown' }).expect(200)).body.data.map((j: any) => j.title)).toEqual(['Facts unknown']);
    expect((await get({ company: `${stamp} Facts Employer`, experience: 'unknown', sort: 'oldest' }).expect(200)).body.meta.total).toBe(2);
    const body = (await get({ company: `${stamp} Facts Employer` }).expect(200)).body;
    expect(body.workArrangements).toEqual(expect.arrayContaining([{ value: 'Remote', count: expect.any(Number) }, { value: 'unknown', count: expect.any(Number) }]));
    expect(body.companies.some((c: any) => c.company === `${stamp} Facts Employer` && c.count === 3)).toBe(true);
    for (const bad of [{ work: 'Moon' }, { experience: 'Wizard' }, { company: 'x'.repeat(121) }]) await get(bad).expect(400);
  });
  it('flags a posting whose own deadline statements disagree without exposing the payload', async () => {
    const job = await prisma.job.create({ data: { externalId: `cataloguetest:${stamp}-conflict`, title: 'Conflict role', company: `${stamp} Labs`, description: 'd', location: 'Bakı', url: 'https://www.hellojob.az/vakansiya/c', postedAt: new Date('2026-10-01T12:00:00Z'), deadline: new Date('2099-01-01'), rawPayload: { deadlineConflict: { structured: 'x', statedInDescription: ['y'], used: 'z' } } } });
    const res = await request(app.getHttpServer()).get(`/jobs/imported/${job.id}`).expect(200);
    expect(res.body.deadlineConflict).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/statedInDescription|rawPayload/);
  });

  it('filters eligible email opportunities before pagination and scopes employer facets to that same pool', async () => {
    const company = `${stamp} Email Employer`, blockedEmail = `blocked-${stamp}@example.invalid`;
    const prefix = `cataloguetest:${stamp}-mail-`;
    const base = { company, description: 'Apply by email', location: 'Bakı', url: 'https://example.invalid/jobs/mail', postedAt: new Date(), applicationMethod: 'EMAIL' as const,
      applicationEmail: 'hiring@example.invalid', applicationEmailEvidence: { excerpt: 'Send your CV to hiring@example.invalid', source: 'description' } };
    await prisma.job.createMany({ data: Array.from({ length: 55 }, (_, i) => ({ ...base, title: `Not email ${i}`, externalId: `${prefix}external-${i}`, applicationMethod: 'EXTERNAL_SITE' as const })) });
    for (const i of [1, 2, 3]) await prisma.job.create({ data: { ...base, title: `Email eligible ${i}`, externalId: `${prefix}eligible-${i}` } });
    await prisma.job.create({ data: { ...base, title: 'Email stale', externalId: `${prefix}stale`, lastSeenAt: new Date(0) } });
    await prisma.job.create({ data: { ...base, title: 'Email missing evidence', externalId: `${prefix}no-evidence`, applicationEmailEvidence: undefined } });
    await prisma.job.create({ data: { ...base, title: 'Email suppressed', externalId: `${prefix}suppressed`, applicationEmail: blockedEmail } });
    await prisma.emailSuppression.create({ data: { email: blockedEmail, reason: 'MANUAL' } });
    try {
      const unfiltered = (await get({ company, limit: 50 }).expect(200)).body;
      expect(unfiltered.meta.total).toBe(61);
      expect(unfiltered.data.every((j: { applicationMethod: string }) => j.applicationMethod === 'EXTERNAL_SITE')).toBe(true);
      const first = (await get({ application: 'email', company, limit: 2 }).expect(200)).body;
      const second = (await get({ application: 'email', company, limit: 2, page: 2 }).expect(200)).body;
      expect(first.meta).toMatchObject({ total: 3, totalPages: 2 });
      expect(new Set([...first.data, ...second.data].map((j: { id: string }) => j.id)).size).toBe(3);
      expect([...first.data, ...second.data].every((j: { title: string }) => j.title.startsWith('Email eligible'))).toBe(true);
      expect(first.companies).toContainEqual({ company, count: 3 });
      expect(first.companies).not.toContainEqual(expect.objectContaining({ company: `${stamp} Labs` }));
      expect(JSON.stringify(first)).not.toMatch(/hiring@example|blocked-|applicationEmailEvidence/);
      await get({ application: 'invented' }).expect(400);
    } finally { await prisma.emailSuppression.deleteMany({ where: { email: blockedEmail } }); }
  });
});
