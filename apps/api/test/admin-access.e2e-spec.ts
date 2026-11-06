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
const queuePrefix = `aise-admin-${stamp}`;
const password = 'Synthetic-Admin-Pass-1';
const mail = (who: string) => `aise-admin-${who}-${stamp}@example.com`;

describe('admin roles, MFA, invitations and recovery (isolated synthetic data)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  let emails: EmailService;
  const env = { ...process.env };
  let clock = Date.now();
  let nowSpy: jest.SpyInstance;

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') {
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
      await prisma.user.deleteMany({ where: { email: mail('candidate') } });
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

  it('rejects candidate, business and forged tokens on every admin surface', async () => {
    const user = await prisma.user.create({ data: { email: mail('candidate'), hashedPassword: 'x', sessions: { create: { sessionToken: `cand-${stamp}`, expires: new Date(Date.now() + 3_600_000) } } } });
    expect(user.id).toBeTruthy();
    for (const token of [`cand-${stamp}`, 'forged-token', '']) {
      for (const [method, path] of [['get', '/admin/users'], ['get', '/admin/operators'], ['post', '/admin/ops/imports/glorri'], ['get', '/admin/auth/me'], ['post', '/admin/account/mfa/setup']] as const) {
        await request(server)[method](path).set(bearer(token)).expect(401);
      }
    }
  });

  it('enforces the role matrix server-side, including direct calls to hidden actions', async () => {
    await operator('support', 'SUPPORT');
    await operator('admin', 'ADMIN');
    const support = await session('support');
    const admin = await session('admin');
    const me = await request(server).get('/admin/auth/me').set(bearer(support)).expect(200);
    expect(me.body).toMatchObject({ role: 'SUPPORT', mfaEnabled: false, permissions: ['self', 'companies.read', 'users.read', 'vacancies.read', 'ops.read', 'listings.read', 'applications.read'] });
    expect(JSON.stringify(me.body)).not.toMatch(/hashedPassword|mfaSecret|Recovery/);

    await request(server).get('/admin/users').set(bearer(support)).expect(200);
    await request(server).get('/admin/companies').set(bearer(support)).expect(200);
    for (const [method, path, body] of [
      ['patch', '/admin/companies/x/approve', {}], ['post', '/admin/users/x/plan-overrides', { plan: 'Limitsiz', reason: 'x', days: 1 }], ['delete', '/admin/users/x', {}],
      ['get', '/admin/audit-log', {}], ['get', '/admin/operators', {}], ['post', '/admin/operators/invitations', { email: 'x@example.com', role: 'SUPER_ADMIN' }],
      ['put', '/admin/ops/features/import.glorri', { paused: true, reason: 'x' }],
    ] as const) {
      await request(server)[method](path).set(bearer(support)).send(body).expect(403);
    }
    // ADMIN moderates, but cannot delete accounts or manage operators.
    await request(server).patch('/admin/companies/does-not-exist/approve').set(bearer(admin)).expect(404);
    await request(server).get('/admin/audit-log').set(bearer(admin)).expect(200);
    await request(server).delete('/admin/users/x').set(bearer(admin)).expect(403);
    await request(server).get('/admin/operators').set(bearer(admin)).expect(403);
    await request(server).patch(`/admin/operators/${(await prisma.adminUser.findFirstOrThrow({ where: { email: mail('admin') } })).id}/role`).set(bearer(admin)).send({ role: 'SUPER_ADMIN' }).expect(403);
    expect((await prisma.adminUser.findFirstOrThrow({ where: { email: mail('admin') } })).role).toBe('ADMIN');
  });

  it('requires a second-factor session for super-admin operator management; MFA login rejects wrong, replayed and recovery-reused codes', async () => {
    await operator('founder', 'SUPER_ADMIN');
    const plain = await session('founder');
    expect((await request(server).get('/admin/operators').set(bearer(plain)).expect(403)).body.reason).toBe('MFA_REQUIRED');

    const { secret, recoveryCodes } = await enrol(plain);
    expect(recoveryCodes).toHaveLength(10);
    const stored = await prisma.adminUser.findFirstOrThrow({ where: { email: mail('founder') } });
    expect(stored.mfaSecretEnc).not.toContain(secret);
    expect(stored.mfaRecoveryCodeHashes).not.toContain(recoveryCodes[0]);
    // The enrolling session is now verified; operator management opens.
    await request(server).get('/admin/operators').set(bearer(plain)).expect(200);

    // Password alone no longer yields a session.
    const first = await login('founder');
    expect(first.body.sessionToken).toBeUndefined();
    await request(server).post('/admin/auth/mfa').send({ challengeToken: first.body.challengeToken, code: '000000' }).expect(401);
    const good = code(secret);
    await request(server).post('/admin/auth/mfa').send({ challengeToken: first.body.challengeToken, code: good }).expect(200);
    // The same challenge and the same code cannot be used again.
    await request(server).post('/admin/auth/mfa').send({ challengeToken: first.body.challengeToken, code: good }).expect(401);
    const second = await login('founder');
    await request(server).post('/admin/auth/mfa').send({ challengeToken: second.body.challengeToken, code: good }).expect(401);
    // A recovery code works exactly once.
    await request(server).post('/admin/auth/mfa').send({ challengeToken: second.body.challengeToken, code: recoveryCodes[0].toUpperCase() }).expect(200);
    const third = await login('founder');
    await request(server).post('/admin/auth/mfa').send({ challengeToken: third.body.challengeToken, code: recoveryCodes[0] }).expect(401);
    // Five wrong guesses exhaust a challenge even for the right code.
    const fourth = await login('founder');
    for (let i = 0; i < 5; i++) await request(server).post('/admin/auth/mfa').send({ challengeToken: fourth.body.challengeToken, code: '111111' }).expect(401);
    await request(server).post('/admin/auth/mfa').send({ challengeToken: fourth.body.challengeToken, code: code(secret) }).expect(401);
    // A super-admin cannot turn MFA off.
    await request(server).post('/admin/account/mfa/disable').set(bearer(plain)).send({ password, code: code(secret) }).expect(409);
  });

  it('invites an operator through a single-use, expiring link delivered by email; replayed, revoked and expired links fail', async () => {
    await operator('boss', 'SUPER_ADMIN');
    const { secret } = await enrol(await session('boss'));
    const boss = await mfaSession('boss', secret);

    emails.clearCapturedEmails();
    const invited = await request(server).post('/admin/operators/invitations').set(bearer(boss)).send({ email: mail('newbie').toUpperCase(), role: 'SUPPORT' }).expect(201);
    expect(invited.body).toMatchObject({ email: mail('newbie'), role: 'SUPPORT', deliveryStatus: 'MOCK' });
    expect(JSON.stringify(invited.body)).not.toMatch(/token/i);
    const link = /href="([^"]+)"/.exec(emails.getCapturedEmails().find((m) => m.to === mail('newbie'))!.html)![1];
    const token = new URL(link).searchParams.get('token')!;
    expect(link.startsWith('http://127.0.0.1:3450/admin/setup?token=')).toBe(true);
    expect(await prisma.adminInvitation.count({ where: { tokenHash: token } })).toBe(0);

    await request(server).get('/admin/auth/setup').query({ token }).expect(200).expect((r) => expect(r.body).toMatchObject({ kind: 'INVITE', email: mail('newbie'), role: 'SUPPORT' }));
    await request(server).post('/admin/auth/setup').send({ token, password: 'short' }).expect(400);
    // Two concurrent submissions of the same link: exactly one account.
    const [a, b] = await Promise.all([
      request(server).post('/admin/auth/setup').send({ token, password: 'Newbie-Synthetic-Pass-1', name: 'Newbie' }),
      request(server).post('/admin/auth/setup').send({ token, password: 'Newbie-Synthetic-Pass-2' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(await prisma.adminUser.count({ where: { email: mail('newbie') } })).toBe(1);
    await request(server).post('/admin/auth/setup').send({ token, password: 'Newbie-Synthetic-Pass-3' }).expect(400);
    const newbie = await prisma.adminUser.findFirstOrThrow({ where: { email: mail('newbie') } });
    expect(newbie.role).toBe('SUPPORT');

    // Revoked and expired links.
    emails.clearCapturedEmails();
    const second = await request(server).post('/admin/operators/invitations').set(bearer(boss)).send({ email: mail('late'), role: 'ADMIN' }).expect(201);
    const lateToken = new URL(/href="([^"]+)"/.exec(emails.getCapturedEmails()[0].html)![1]).searchParams.get('token')!;
    await request(server).delete(`/admin/operators/invitations/${second.body.id}`).set(bearer(boss)).expect(200);
    await request(server).get('/admin/auth/setup').query({ token: lateToken }).expect(400);
    emails.clearCapturedEmails();
    const third = await request(server).post('/admin/operators/invitations').set(bearer(boss)).send({ email: mail('late'), role: 'ADMIN' }).expect(201);
    const expiredToken = new URL(/href="([^"]+)"/.exec(emails.getCapturedEmails()[0].html)![1]).searchParams.get('token')!;
    await prisma.adminInvitation.update({ where: { id: third.body.id }, data: { expiresAt: new Date(0) } });
    await request(server).post('/admin/auth/setup').send({ token: expiredToken, password: 'Late-Synthetic-Pass-1' }).expect(400);
    expect(await prisma.adminUser.count({ where: { email: mail('late') } })).toBe(0);
    // An existing operator cannot be invited again.
    await request(server).post('/admin/operators/invitations').set(bearer(boss)).send({ email: mail('newbie'), role: 'ADMIN' }).expect(409);
  });

  it('protects the last active super-admin, including two concurrent demotions', async () => {
    await operator('solo', 'SUPER_ADMIN');
    const { secret } = await enrol(await session('solo'));
    const solo = await mfaSession('solo', secret);
    const soloId = (await prisma.adminUser.findFirstOrThrow({ where: { email: mail('solo') } })).id;
    // Other super-admins from earlier tests are disabled to make "solo" the last one.
    await prisma.adminUser.updateMany({ where: { role: 'SUPER_ADMIN', id: { not: soloId } }, data: { disabledAt: new Date() } });
    await request(server).patch(`/admin/operators/${soloId}/role`).set(bearer(solo)).send({ role: 'ADMIN' }).expect(409);
    await request(server).post(`/admin/operators/${soloId}/disable`).set(bearer(solo)).send({}).expect(409);

    // Two super-admins demote each other at the same moment: one must remain.
    await operator('twin', 'SUPER_ADMIN');
    const twin = (await enrol(await session('twin'))).secret;
    const twinSession = await mfaSession('twin', twin);
    const twinId = (await prisma.adminUser.findFirstOrThrow({ where: { email: mail('twin') } })).id;
    const [x, y] = await Promise.all([
      request(server).patch(`/admin/operators/${twinId}/role`).set(bearer(solo)).send({ role: 'SUPPORT' }),
      request(server).patch(`/admin/operators/${soloId}/role`).set(bearer(twinSession)).send({ role: 'SUPPORT' }),
    ]);
    const statuses = [x.status, y.status].sort();
    expect(statuses[1]).toBe(409);
    expect(await prisma.adminUser.count({ where: { role: 'SUPER_ADMIN', disabledAt: null } })).toBe(1);
    const log = await prisma.adminAuditLog.findFirst({ where: { action: 'ADMIN_ROLE_CHANGED', targetId: { in: [soloId, twinId] } } });
    expect(log?.metadata).toMatchObject({ before: 'SUPER_ADMIN', after: 'SUPPORT' });
  });

  it('disabling, demoting, password rotation and reset links take effect on existing sessions', async () => {
    await operator('chief', 'SUPER_ADMIN');
    const { secret } = await enrol(await session('chief'));
    const chief = await mfaSession('chief', secret);
    const ops = await operator('ops', 'ADMIN');
    const opsSession = await session('ops');
    const opsOther = await session('ops');

    // Demotion applies to the very next request.
    await request(server).patch(`/admin/operators/${ops.id}/role`).set(bearer(chief)).send({ role: 'SUPPORT' }).expect(200);
    await request(server).get('/admin/audit-log').set(bearer(opsSession)).expect(403);

    // Password rotation: wrong current refused; success ends the other sessions only.
    await request(server).post('/admin/account/password').set(bearer(opsSession)).send({ currentPassword: 'nope', newPassword: 'Rotated-Synthetic-Pass-1' }).expect(401);
    await request(server).post('/admin/account/password').set(bearer(opsSession)).send({ currentPassword: password, newPassword: 'Rotated-Synthetic-Pass-1' }).expect(200);
    await request(server).get('/admin/auth/me').set(bearer(opsSession)).expect(200);
    await request(server).get('/admin/auth/me').set(bearer(opsOther)).expect(401);
    expect((await login('ops')).status).toBe(401);
    expect((await login('ops', 'Rotated-Synthetic-Pass-1')).status).toBe(200);

    // Reset link issued by the super-admin ends every session of that operator.
    emails.clearCapturedEmails();
    await request(server).post(`/admin/operators/${ops.id}/reset-link`).set(bearer(chief)).expect(200);
    const token = new URL(/href="([^"]+)"/.exec(emails.getCapturedEmails()[0].html)![1]).searchParams.get('token')!;
    await request(server).post('/admin/auth/setup').send({ token, password: 'Reset-Synthetic-Pass-1' }).expect(200);
    await request(server).get('/admin/auth/me').set(bearer(opsSession)).expect(401);
    const fresh = (await login('ops', 'Reset-Synthetic-Pass-1')).body.sessionToken;

    // Disabling ends access immediately and cannot target oneself.
    await request(server).post(`/admin/operators/${ops.id}/disable`).set(bearer(chief)).send({ reason: 'test' }).expect(200);
    await request(server).get('/admin/auth/me').set(bearer(fresh)).expect(401);
    expect((await login('ops', 'Reset-Synthetic-Pass-1')).status).toBe(401);
    const chiefId = (await prisma.adminUser.findFirstOrThrow({ where: { email: mail('chief') } })).id;
    await request(server).post(`/admin/operators/${chiefId}/disable`).set(bearer(chief)).send({}).expect(409);

    // Operator list and audit carry no secrets.
    const list = await request(server).get('/admin/operators').set(bearer(chief)).expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(/hashedPassword|mfaSecret|tokenHash|Recovery/);
    const audit = await request(server).get('/admin/audit-log').set(bearer(chief)).expect(200);
    expect(JSON.stringify(audit.body)).not.toMatch(/Synthetic-Pass|tokenHash|token=/);
  });
});
