import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import IORedis from 'ioredis';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import express from 'express';
import { randomBytes } from 'crypto';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { EmailModule } from '../src/common/email.module';
import { AuthModule } from '../src/auth/auth.module';
import { BillingModule } from '../src/billing/billing.module';
import { SavedModule } from '../src/saved/saved.module';

// Saved jobs, saved searches and company follows over the real HTTP routes and the isolated aise_phase2_test database (synthetic data).
const stamp = `${Date.now()}`;
const prefix = `aise-saved-${stamp}`;
const mail = (who: string) => `aise-saved-${who}-${stamp}@example.com`;

describe('saved jobs, saved searches and company follows (isolated synthetic data)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  const env = { ...process.env };
  const jobIds: string[] = [];

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Refusing to run outside the isolated local aise_phase2_test');
    process.env.DATABASE_URL = db.toString();
    Object.assign(process.env, {
      NODE_ENV: 'test', RESEND_API_KEY: 're_mock_key', MATCHING_SERVICE_URL: 'http://127.0.0.1:9', APPLY_WORKER_URL: 'http://127.0.0.1:9', DODO_PAYMENTS_API_KEY: '',
      // Small limits so the boundary is reachable in a test; they are operator configuration, exactly as in production.
      PRODUCT_CONFIG_JSON: JSON.stringify({ limits: { 'candidate.free.saved.jobs': 3, 'candidate.free.saved.searches': 2, 'candidate.free.follows.companies': 2 } }),
    });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, EmailModule, AuthModule, BillingModule, SavedModule,
    ] }).compile();
    app = module.createNestApplication({ logger: ['error'], bodyParser: false });
    app.use(express.json());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `saved-${stamp}` } } });
    }
    await app?.close();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    process.env = { ...env };
  }, 60_000);

  async function user(who: string, plan: 'FREE' | 'PREMIUM' = 'FREE') {
    const u = await prisma.user.create({ data: { email: mail(who), hashedPassword: await bcrypt.hash('Synthetic-Candidate-1', 4), emailVerified: new Date(), subscription: { create: { plan, status: 'active', currentPeriodEnd: plan === 'FREE' ? null : new Date(Date.now() + 30 * 86_400_000) } } } });
    const token = randomBytes(32).toString('hex');
    await prisma.session.create({ data: { sessionToken: token, userId: u.id, expires: new Date(Date.now() + 3_600_000) } });
    return { u, auth: { Authorization: `Bearer ${token}` } };
  }
  let n = 0;
  async function job(extra: Record<string, unknown> = {}) {
    const i = ++n;
    const j = await prisma.job.create({ data: { externalId: `saved-${stamp}-${i}`, title: `Mühasib ${i}`, company: 'Kapital Bank ASC', description: 'x', location: 'Bakı', url: `https://example.invalid/${stamp}/${i}`, postedAt: new Date(), companyKey: 'kapital bank', ...extra } as any });
    jobIds.push(j.id);
    return j;
  }
  const ref = (j: { id: string }) => `imported:${j.id}`;

  it('requires a session on every route', async () => {
    for (const [m, p] of [['get', '/saved-jobs'], ['get', '/saved-searches'], ['get', '/company-follows'], ['put', '/saved-jobs/imported:x'], ['post', '/saved-searches'], ['put', '/company-follows']] as const) {
      await (request(server) as any)[m](p).expect(401);
    }
  });

  it('saves, lists and unsaves jobs; saving twice is idempotent; a duplicate posting is saved as its original', async () => {
    const { auth } = await user('jobs');
    const original = await job();
    const dup = await job({ duplicateOfId: original.id });
    const a = await request(server).put(`/saved-jobs/${ref(original)}`).set(auth).expect(200);
    expect(a.body.created).toBe(true);
    expect((await request(server).put(`/saved-jobs/${ref(original)}`).set(auth).expect(200)).body).toMatchObject({ id: a.body.id, created: false });
    expect((await request(server).put(`/saved-jobs/${ref(dup)}`).set(auth).expect(200)).body).toMatchObject({ id: a.body.id, created: false }); // same posting, not a second row
    const list = (await request(server).get('/saved-jobs').set(auth).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ref: ref(original), kind: 'imported', state: 'open', company: 'Kapital Bank ASC' });
    await prisma.job.update({ where: { id: original.id }, data: { status: 'CLOSED' } });
    expect((await request(server).get('/saved-jobs').set(auth)).body[0].state).toBe('closed'); // a closed posting stays visible as closed, never as open
    expect((await request(server).delete(`/saved-jobs/${ref(original)}`).set(auth).expect(200)).body).toEqual({ removed: true });
    expect((await request(server).delete(`/saved-jobs/${ref(original)}`).set(auth).expect(200)).body).toEqual({ removed: false });
    expect((await request(server).get('/saved-jobs').set(auth)).body).toEqual([]);
  });

  it('refuses hidden, closed, unknown and malformed postings without revealing which', async () => {
    const { auth } = await user('refuse');
    const hidden = await job({ hiddenAt: new Date() });
    const closed = await job({ status: 'CLOSED' });
    await request(server).put(`/saved-jobs/${ref(hidden)}`).set(auth).expect(404);
    await request(server).put(`/saved-jobs/${ref(closed)}`).set(auth).expect(404);
    await request(server).put('/saved-jobs/imported:doesnotexist').set(auth).expect(404);
    await request(server).put('/saved-jobs/whatever').set(auth).expect(400);
    await request(server).put('/saved-jobs/imported:..%2F..%2Fetc').set(auth).expect(400);
  });

  it('isolates owners: another account cannot read, change or remove what is not theirs', async () => {
    const a = await user('own-a');
    const b = await user('own-b');
    const j = await job();
    await request(server).put(`/saved-jobs/${ref(j)}`).set(a.auth).expect(200);
    const search = (await request(server).post('/saved-searches').set(a.auth).send({ criteria: { q: 'mühasib' } }).expect(201)).body;
    const follow = (await request(server).put('/company-follows').set(a.auth).send({ company: 'Azercell Telekom MMC' }).expect(200)).body;
    expect((await request(server).get('/saved-jobs').set(b.auth)).body).toEqual([]);
    expect((await request(server).get('/saved-searches').set(b.auth)).body).toEqual([]);
    expect((await request(server).get('/company-follows').set(b.auth)).body).toEqual([]);
    expect((await request(server).delete(`/saved-jobs/${ref(j)}`).set(b.auth).expect(200)).body).toEqual({ removed: false });
    await request(server).patch(`/saved-searches/${search.id}`).set(b.auth).send({ name: 'hijack' }).expect(404);
    expect((await request(server).delete(`/saved-searches/${search.id}`).set(b.auth).expect(200)).body).toEqual({ removed: false });
    expect((await request(server).delete(`/company-follows/${follow.id}`).set(b.auth).expect(200)).body).toEqual({ removed: false });
    // Everything is still A's.
    expect(await prisma.savedJob.count({ where: { userId: a.u.id } })).toBe(1);
    expect(await prisma.savedSearch.count({ where: { userId: a.u.id } })).toBe(1);
    expect(await prisma.companyFollow.count({ where: { userId: a.u.id } })).toBe(1);
  });

  it('saves only normalised catalogue criteria, suppresses duplicates, and lets the owner rename, pause and delete', async () => {
    const { auth } = await user('search');
    for (const body of [{ criteria: { q: 'x', url: 'https://evil.example' } }, { criteria: { where: '1=1' } }, { criteria: { category: 'nope' } }, { criteria: {} }, { criteria: 'q=1' }, { name: 'x'.repeat(81), criteria: { q: 'x' } }]) {
      await request(server).post('/saved-searches').set(auth).send(body).expect(400);
    }
    const first = (await request(server).post('/saved-searches').set(auth).send({ criteria: { q: 'Mühasib', location: 'Bakı' } }).expect(201)).body;
    expect(first.created).toBe(true);
    const again = (await request(server).post('/saved-searches').set(auth).send({ criteria: { q: ' muhasib ', location: 'BAKI', sort: 'newest' } }).expect(201)).body;
    expect(again).toMatchObject({ id: first.id, created: false }); // overlapping search, not a second one
    await request(server).patch(`/saved-searches/${first.id}`).set(auth).send({ name: 'Bakı mühasib', alertsEnabled: false }).expect(200);
    await request(server).patch(`/saved-searches/${first.id}`).set(auth).send({ alertsEnabled: 'yes' }).expect(400);
    const list = (await request(server).get('/saved-searches').set(auth)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Bakı mühasib', alertsEnabled: false, criteria: { q: 'Mühasib', location: 'Bakı' } });
    expect((await request(server).delete(`/saved-searches/${first.id}`).set(auth).expect(200)).body).toEqual({ removed: true });
  });

  it('follows one canonical company however it is spelled, from a name or a posting, and unfollows', async () => {
    const { auth } = await user('follow');
    const j = await job();
    const a = (await request(server).put('/company-follows').set(auth).send({ ref: ref(j) }).expect(200)).body;
    expect(a).toMatchObject({ companyKey: 'kapital bank', created: true });
    for (const alias of ['kapital bank', 'KAPITAL  BANK ASC', 'Kapital Bank MMC']) {
      expect((await request(server).put('/company-follows').set(auth).send({ company: alias }).expect(200)).body).toMatchObject({ id: a.id, created: false });
    }
    expect((await request(server).get('/company-follows').set(auth)).body).toHaveLength(1);
    await request(server).put('/company-follows').set(auth).send({ company: '   ' }).expect(400);
    await request(server).put('/company-follows').set(auth).send({ company: '!!!' }).expect(400);
    await request(server).put('/company-follows').set(auth).send({}).expect(400);
    expect((await request(server).delete(`/company-follows/${a.id}`).set(auth).expect(200)).body).toEqual({ removed: true });
    expect((await request(server).get('/company-follows').set(auth)).body).toEqual([]);
  });

  it('follows a registered employer by its stable id: same-named employers stay distinct, unapproved ones are refused', async () => {
    const { auth } = await user('follow-id');
    const mk = async (status: 'APPROVED' | 'PENDING') => {
      const biz = await prisma.business.create({ data: { email: mail(`biz${++n}`), hashedPassword: 'x', emailVerified: new Date() } });
      return prisma.company.create({ data: { businessId: biz.id, name: 'Eyni Ad MMC', status } });
    };
    const one = await mk('APPROVED'); const two = await mk('APPROVED'); const pending = await mk('PENDING');
    const a = (await request(server).put('/company-follows').set(auth).send({ companyId: one.id }).expect(200)).body;
    const b = (await request(server).put('/company-follows').set(auth).send({ companyId: two.id }).expect(200)).body;
    expect(a.id).not.toBe(b.id); // not merged by name
    expect((await request(server).put('/company-follows').set(auth).send({ companyId: one.id }).expect(200)).body).toMatchObject({ id: a.id, created: false });
    await request(server).put('/company-follows').set(auth).send({ companyId: pending.id }).expect(404);
    await request(server).put('/company-follows').set(auth).send({ companyId: 'nope' }).expect(404);
    const list = (await request(server).get('/company-follows').set(auth)).body;
    expect(list.map((f: any) => f.companyId).sort()).toEqual([one.id, two.id].sort());
    await prisma.business.deleteMany({ where: { id: { in: [one.businessId, two.businessId, pending.businessId] } } });
  });

  it('enforces plan limits at the boundary, also under concurrency, and Premium has the larger configured limit', async () => {
    const { auth, u } = await user('limits');
    const js = await Promise.all([1, 2, 3, 4, 5].map(() => job()));
    const results = await Promise.all(js.map((j) => request(server).put(`/saved-jobs/${ref(j)}`).set(auth)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await prisma.savedJob.count({ where: { userId: u.id } })).toBe(3);
    const saved = (await request(server).get('/saved-jobs').set(auth)).body[0];
    await request(server).delete(`/saved-jobs/${saved.ref}`).set(auth).expect(200);
    await request(server).put(`/saved-jobs/${ref(js.find((j) => !results.find((r, i) => js[i] === j && r.status === 200))!)}`).set(auth).expect(200); // room again after an unsave
    for (const q of ['a', 'b']) await request(server).post('/saved-searches').set(auth).send({ criteria: { q } }).expect(201);
    await request(server).post('/saved-searches').set(auth).send({ criteria: { q: 'c' } }).expect(409);
    for (const c of ['Alfa MMC', 'Beta MMC']) await request(server).put('/company-follows').set(auth).send({ company: c }).expect(200);
    await request(server).put('/company-follows').set(auth).send({ company: 'Gamma MMC' }).expect(409);
    // Premium's own limits (spec defaults: 1,000 / 20 / 100) are not the Free ones.
    const prem = await user('limits-prem', 'PREMIUM');
    for (let i = 0; i < 4; i++) await request(server).put(`/saved-jobs/${ref(await job())}`).set(prem.auth).expect(200);
    expect(await prisma.savedJob.count({ where: { userId: prem.u.id } })).toBe(4);
  });

  it('removes everything with the account', async () => {
    const { auth, u } = await user('deleted');
    await request(server).put(`/saved-jobs/${ref(await job())}`).set(auth).expect(200);
    await request(server).post('/saved-searches').set(auth).send({ criteria: { q: 'z' } }).expect(201);
    await request(server).put('/company-follows').set(auth).send({ company: 'Delta MMC' }).expect(200);
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.savedJob.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.savedSearch.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.companyFollow.count({ where: { userId: u.id } })).toBe(0);
  });
});
