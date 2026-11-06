import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import IORedis from 'ioredis';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { EmailModule } from '../src/common/email.module';
import { EmailService } from '../src/common/email.service';
import { AdminModule } from '../src/admin/admin.module';
import { base32Decode, currentStep, totpAt } from '../src/admin/mfa.util';

// Founder super-admin, scoped operators, MFA, invitations and recovery over
// the real HTTP routes. Synthetic operators in the isolated local
// aise_phase2_test database; email is the in-process mock capture.

const stamp = `${Date.now()}`;
const queuePrefix = `aise-founder-${stamp}`;
const password = 'Synthetic-Admin-Pass-1';
const mail = (who: string) => `aise-founder-${who}-${stamp}@example.com`;

describe('founder control: delete employers, remove vacancies, remove operators (isolated synthetic data)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  let emails: EmailService;
  const env = { ...process.env };
  let clock = Date.now();
  let nowSpy: jest.SpyInstance;

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || (db.pathname !== '/aise_phase2_test' && !/^\/aise_release_test_[0-9]+$/.test(db.pathname))) {
      throw new Error('Refusing admin test outside isolated local aise_phase2_test');
    }
    process.env.DATABASE_URL = db.toString();
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 're_mock_key';
    process.env.ADMIN_WEB_URL = 'http://127.0.0.1:3450';
    process.env.ADMIN_MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      BullModule.forRoot({ prefix: queuePrefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, EmailModule, AdminModule,
    ] }).compile();
    app = module.createNestApplication({ logger: ['error'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    emails = app.get(EmailService);
    // TOTP codes are single-use per 30 s step: the test advances a clock.
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
  }, 60_000);

  afterAll(async () => {
    nowSpy?.mockRestore();
    if (prisma) {
      const ids = (await prisma.adminUser.findMany({ where: { email: { endsWith: `-${stamp}@example.com` } }, select: { id: true } })).map((u) => u.id);
      await prisma.adminAuditLog.deleteMany({ where: { OR: [{ adminUserId: { in: ids } }, { targetId: { in: ids } }] } });
      await prisma.adminInvitation.deleteMany({ where: { email: { endsWith: `-${stamp}@example.com` } } });
      await prisma.adminLoginChallenge.deleteMany({ where: { adminUserId: { in: ids } } });
      await prisma.adminUser.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@example.com` } } });
      await prisma.business.deleteMany({ where: { email: { endsWith: `-${stamp}@example.com` } } });
    }
    await app?.close();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${queuePrefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    process.env = { ...env };
  }, 60_000);

  const tick = () => { clock += 30_000; };
  const code = (secret: string) => { tick(); return totpAt(base32Decode(secret), currentStep(clock)); };
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function operator(who: string, role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT') {
    return prisma.adminUser.create({ data: { email: mail(who), hashedPassword: await bcrypt.hash(password, 4), role } });
  }
  async function login(who: string, pw = password) {
    const res = await request(server).post('/admin/auth/login').send({ email: mail(who), password: pw });
    return res;
  }
  async function session(who: string) {
    const res = await login(who);
    expect(res.status).toBe(200);
    return res.body.sessionToken as string;
  }
  /** Enrols MFA for a signed-in operator; returns the secret, recovery codes and the (now verified) session. */
  async function enrol(token: string) {
    const setup = await request(server).post('/admin/account/mfa/setup').set(bearer(token)).expect(200);
    const enabled = await request(server).post('/admin/account/mfa/enable').set(bearer(token)).send({ code: code(setup.body.secret) }).expect(200);
    return { secret: setup.body.secret as string, recoveryCodes: enabled.body.recoveryCodes as string[] };
  }
  async function mfaSession(who: string, secret: string) {
    const first = await login(who);
    expect(first.body).toEqual({ mfaRequired: true, challengeToken: expect.any(String) });
    const res = await request(server).post('/admin/auth/mfa').send({ challengeToken: first.body.challengeToken, code: code(secret) }).expect(200);
    return res.body.sessionToken as string;
  }

  it('removes an employer with its vacancies and their applications, keeps the candidate, and needs a verified second factor', async () => {
    await operator('boss1', 'SUPER_ADMIN');
    await operator('adm1', 'ADMIN');
    const plain = await session('boss1');
    const adminToken = await session('adm1');
    const { secret } = await enrol(plain);
    const boss = await mfaSession('boss1', secret);

    const business = await prisma.business.create({ data: { email: mail('employer'), hashedPassword: 'x', emailVerified: new Date() } });
    const company = await prisma.company.create({ data: { businessId: business.id, name: `Founder Test ${stamp}`, status: 'APPROVED' } });
    const vacancy = await prisma.vacancy.create({ data: { companyId: company.id, title: 'Satış meneceri', status: 'ACTIVE', questions: { create: [{ label: 'Niyə?', type: 'SHORT_TEXT' }] } }, include: { questions: true } });
    const candidate = await prisma.user.create({ data: { email: mail('candidate'), hashedPassword: 'x' } });
    const application = await prisma.application.create({ data: { vacancyId: vacancy.id, userId: candidate.id } });
    await prisma.applicationAnswer.create({ data: { applicationId: application.id, questionId: vacancy.questions[0].id, value: 'Cavab' } });

    // an ADMIN cannot, a super-admin without a verified second factor cannot
    await request(server).delete(`/admin/companies/${company.id}`).set(bearer(adminToken)).send({ reason: 'x' }).expect(403);
    await operator('nomfa1', 'SUPER_ADMIN');
    const noMfa = await session('nomfa1'); // super-admin whose second factor is not enrolled/verified
    await request(server).delete(`/admin/companies/${company.id}`).set(bearer(noMfa)).send({ reason: 'x' }).expect(403);
    expect(await prisma.company.count({ where: { id: company.id } })).toBe(1);

    const res = await request(server).delete(`/admin/companies/${company.id}`).set(bearer(boss)).send({ reason: 'Saxta şirkət' }).expect(200);
    expect(res.body).toEqual({ deleted: true, vacancies: 1, applications: 1 });
    expect(await prisma.company.count({ where: { id: company.id } })).toBe(0);
    expect(await prisma.business.count({ where: { id: business.id } })).toBe(0);
    expect(await prisma.vacancy.count({ where: { id: vacancy.id } })).toBe(0);
    expect(await prisma.application.count({ where: { id: application.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: candidate.id } })).toBe(1); // the candidate's own account is untouched
    const audit = await prisma.adminAuditLog.findFirst({ where: { action: 'COMPANY_DELETED', targetId: company.id } });
    expect(audit?.metadata).toMatchObject({ vacancies: 1, applications: 1, reason: 'Saxta şirkət' });
    await request(server).delete(`/admin/companies/${company.id}`).set(bearer(boss)).send({ reason: 'again' }).expect(404);
  });

  it('refuses to delete an employer account that belongs to an operator', async () => {
    await operator('boss2', 'SUPER_ADMIN');
    const plain = await session('boss2');
    const { secret } = await enrol(plain);
    const boss = await mfaSession('boss2', secret);
    await operator('both2', 'ADMIN');
    const business = await prisma.business.create({ data: { email: mail('both2'), hashedPassword: 'x' } });
    const company = await prisma.company.create({ data: { businessId: business.id, name: `Operator Co ${stamp}`, status: 'APPROVED' } });
    await request(server).delete(`/admin/companies/${company.id}`).set(bearer(boss)).send({ reason: 'x' }).expect(409);
    expect(await prisma.company.count({ where: { id: company.id } })).toBe(1);
  });

  it('removes an employer vacancy softly (applications stay) and records the reason', async () => {
    await operator('boss3', 'SUPER_ADMIN');
    const plain = await session('boss3');
    const { secret } = await enrol(plain);
    const boss = await mfaSession('boss3', secret);
    const business = await prisma.business.create({ data: { email: mail('employer2'), hashedPassword: 'x' } });
    const company = await prisma.company.create({ data: { businessId: business.id, name: `Vac Co ${stamp}`, status: 'APPROVED' } });
    const candidate = await prisma.user.create({ data: { email: mail('candidate2'), hashedPassword: 'x' } });
    const vacancy = await prisma.vacancy.create({ data: { companyId: company.id, title: 'Operator', status: 'ACTIVE' } });
    await prisma.application.create({ data: { vacancyId: vacancy.id, userId: candidate.id } });

    await request(server).post(`/admin/vacancies/${vacancy.id}/remove`).set(bearer(boss)).send({ reason: '' }).expect(400);
    await operator('nomfa3', 'SUPER_ADMIN');
    const noMfa = await session('nomfa3');
    await request(server).post(`/admin/vacancies/${vacancy.id}/remove`).set(bearer(noMfa)).send({ reason: 'Saxta elan' }).expect(403);
    await request(server).post(`/admin/vacancies/${vacancy.id}/remove`).set(bearer(boss)).send({ reason: 'Saxta elan' }).expect(201);
    expect((await prisma.vacancy.findUnique({ where: { id: vacancy.id } }))?.status).toBe('DELETED');
    expect(await prisma.application.count({ where: { vacancyId: vacancy.id } })).toBe(1);
    await request(server).post(`/admin/vacancies/${vacancy.id}/remove`).set(bearer(boss)).send({ reason: 'Saxta elan' }).expect(409);
    expect((await prisma.adminAuditLog.findFirst({ where: { action: 'VACANCY_REMOVED', targetId: vacancy.id } }))?.metadata).toMatchObject({ previousStatus: 'ACTIVE', reason: 'Saxta elan' });
  });

  it('removes an operator for good, never yourself or the last super-admin, and protects a candidate account that is an operator', async () => {
    await operator('boss4', 'SUPER_ADMIN');
    const victim = await operator('victim4', 'ADMIN');
    const bossRow = await prisma.adminUser.findFirstOrThrow({ where: { email: mail('boss4') } });
    const plain = await session('boss4');
    const { secret } = await enrol(plain);
    const boss = await mfaSession('boss4', secret);
    const victimToken = await session('victim4');
    await request(server).get('/admin/auth/me').set(bearer(victimToken)).expect(200);

    await request(server).post(`/admin/operators/${bossRow.id}/remove`).set(bearer(boss)).send({}).expect(409); // yourself
    await request(server).post(`/admin/operators/${victim.id}/remove`).set(bearer(boss)).send({ reason: 'Köhnə hesab' }).expect(200);
    expect(await prisma.adminUser.count({ where: { id: victim.id } })).toBe(0);
    await request(server).get('/admin/auth/me').set(bearer(victimToken)).expect(401); // sessions went with the account
    const audit = await prisma.adminAuditLog.findFirst({ where: { action: 'ADMIN_REMOVED', targetId: victim.id } });
    expect(audit?.adminUserId).toBe(bossRow.id);
    expect(audit?.metadata).toMatchObject({ email: mail('victim4'), reason: 'Köhnə hesab' });

    // a second super-admin may remove the first only while another stays; the last one is protected
    const other = await operator('other4', 'SUPER_ADMIN');
    const otherPlain = await session('other4');
    const otherEnrol = await enrol(otherPlain);
    const otherToken = await mfaSession('other4', otherEnrol.secret);
    await request(server).post(`/admin/operators/${bossRow.id}/remove`).set(bearer(otherToken)).send({}).expect(200);
    await request(server).post(`/admin/operators/${other.id}/remove`).set(bearer(otherToken)).send({}).expect(409);

    // a candidate account whose address is an active operator is not deletable through the user path
    await operator('dual4', 'ADMIN');
    const dual = await prisma.user.create({ data: { email: mail('dual4'), hashedPassword: 'x' } });
    await request(server).delete(`/admin/users/${dual.id}`).set(bearer(otherToken)).expect(409);
    expect(await prisma.user.count({ where: { id: dual.id } })).toBe(1);
  });
});
