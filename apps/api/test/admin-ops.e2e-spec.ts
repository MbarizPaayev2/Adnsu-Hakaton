import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import IORedis from 'ioredis';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { EmailModule } from '../src/common/email.module';
import { AdminModule } from '../src/admin/admin.module';
import { AuthModule } from '../src/auth/auth.module';
import { JobsModule } from '../src/jobs/jobs.module';
import { JobsService, isJobActionable } from '../src/jobs/jobs.service';
import { ExternalApplyModule } from '../src/external-apply/external-apply.module';
import { ExternalApplyService } from '../src/external-apply/external-apply.service';
import { ExternalDestinationRegistry, GLORRI_DESTINATION } from '../src/external-apply/destinations';
import { activePlanOverrides, effectivePlan } from '../src/billing/entitlement';

// Founder operations over the real HTTP routes: bounded actions take effect
// in the server (not just the UI), restricted roles cannot call them, and
// every action is audited. Synthetic data in the isolated aise_phase2_test.

const stamp = `${Date.now()}`;
const prefix = `aise-ops-${stamp}`;
const password = 'Synthetic-Ops-Pass-1';
const mail = (who: string) => `aise-ops-${who}-${stamp}@example.com`;
class FixtureRegistry extends ExternalDestinationRegistry {
  protected readonly destinations = [{ ...GLORRI_DESTINATION, notice: { url: 'https://jobs.glorri.com/privacy', version: 'v1', declarationText: 'x' } }];
}

describe('founder operations (isolated synthetic data)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  const env = { ...process.env };
  const tokens: Record<string, string> = {};
  let statusDir: string;

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Refusing ops test outside isolated local aise_phase2_test');
    process.env.DATABASE_URL = db.toString();
    statusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aise-backup-status-'));
    fs.writeFileSync(path.join(statusDir, 'status.json'), JSON.stringify({ lastBackupAt: new Date(Date.now() - 5 * 3_600_000).toISOString(), lastRestoreTestAt: '', lastRestoreTestResult: '', lastOffhostCopyAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), lastOffhostResult: 'VERIFIED', lastBackupFailureAt: '2026-09-30T03:10:00Z', lastBackupError: 'off-host copy failed' }));
    Object.assign(process.env, {
      NODE_ENV: 'test', RESEND_API_KEY: 're_mock_key', EXTERNAL_APPLY_LIVE_ENABLED: 'true', RELEASE_SHA: 'abc1234', APP_ENV: 'staging',
      BACKUP_STATUS_FILE: path.join(statusDir, 'status.json'), MATCHING_SERVICE_URL: 'http://127.0.0.1:9', APPLY_WORKER_URL: 'http://127.0.0.1:9',
    });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, EmailModule, AdminModule, AuthModule, JobsModule, ExternalApplyModule,
    ] }).overrideProvider(ExternalDestinationRegistry).useValue(new FixtureRegistry()).compile();
    app = module.createNestApplication({ logger: ['error'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'] as const) {
      await prisma.adminUser.create({ data: { email: mail(role.toLowerCase()), hashedPassword: await bcrypt.hash(password, 4), role } });
      tokens[role] = (await request(server).post('/admin/auth/login').send({ email: mail(role.toLowerCase()), password }).expect(200)).body.sessionToken;
    }
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      const ids = (await prisma.adminUser.findMany({ where: { email: { contains: `-${stamp}@` } }, select: { id: true } })).map((u) => u.id);
      await prisma.adminAuditLog.deleteMany({ where: { adminUserId: { in: ids } } });
      await prisma.adminUser.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
      await prisma.business.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `glorri:ops-${stamp}` } } });
      await prisma.featureFlag.deleteMany({});
    }
    await app?.close();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    fs.rmSync(statusDir, { recursive: true, force: true });
    process.env = { ...env };
  }, 60_000);

  const as = (role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT') => ({ Authorization: `Bearer ${tokens[role]}` });

  async function candidate(who: string) {
    const user = await prisma.user.create({ data: { email: mail(who), hashedPassword: await bcrypt.hash(password, 4), emailVerified: new Date(), subscription: { create: { plan: 'FREE', status: 'active' } } } });
    await prisma.session.create({ data: { sessionToken: `sess-${who}-${stamp}`, userId: user.id, expires: new Date(Date.now() + 3_600_000) } });
    return user;
  }
  async function job(n: string) {
    return prisma.job.create({ data: {
      externalId: `glorri:ops-${stamp}-${n}`, title: `Sintetik ${n}`, company: 'Sintetik MMC', description: 'x', location: 'Bakı',
      url: `https://jobs.glorri.com/vacancies/sintetik/ops-${n}`, postedAt: new Date(), rawPayload: { slug: `ops-${n}`, company: { slug: 'sintetik' } },
    } });
  }

  it('shows overview, health with release/environment and backup age; restricted roles can read but not act', async () => {
    const overview = await request(server).get('/admin/ops/overview').set(as('SUPPORT')).expect(200);
    expect(overview.body).toMatchObject({ users: expect.any(Object), jobs: expect.any(Object), failures: expect.any(Object), features: expect.any(Array) });
    const health = await request(server).get('/admin/ops/health').set(as('SUPPORT')).expect(200);
    expect(health.body).toMatchObject({
      environment: 'staging', release: { sha: 'abc1234' },
      services: { database: { ok: true }, redis: { ok: true }, matching: { ok: false }, applyWorker: { ok: false } },
      backup: { known: true, lastBackupAgeHours: 5, lastRestoreTestAt: '', lastOffhostCopyAgeHours: 2, lastOffhostResult: 'VERIFIED', lastBackupFailureAt: '2026-09-30T03:10:00Z', lastBackupError: 'off-host copy failed' },
    });
    for (const [method, url, body] of [
      ['put', '/admin/ops/features/import.glorri', { paused: true, reason: 'x' }], ['post', '/admin/ops/imports/glorri', {}],
      ['post', '/admin/ops/queues/job-ingested/jobs/1/retry', {}], ['post', '/admin/listings/x/hide', { reason: 'x' }],
      ['post', '/admin/users/x/suspend', { reason: 'x' }], ['post', '/admin/users/x/plan-overrides', { plan: 'Limitsiz', reason: 'x', days: 1 }],
      ['get', '/admin/audit', {}], ['post', '/admin/companies/x/suspend', { reason: 'x' }],
    ] as const) {
      await request(server)[method](url).set(as('SUPPORT')).send(body).expect(403);
    }
    // The Docker-socket restart endpoint no longer exists.
    await request(server).post('/admin/deploy/restart').set(as('SUPER_ADMIN')).expect(404);
  });

  it('pausing external applications is enforced by the server, not just shown', async () => {
    const user = await candidate('pilot');
    await prisma.subscription.update({ where: { userId: user.id }, data: { plan: 'Limitsiz' } });
    process.env.EXTERNAL_APPLY_PILOT_USER_IDS = user.id;
    const j = await job('pilot');
    const match = await prisma.match.create({ data: { userId: user.id, jobId: j.id, score: 0.9 } });
    const external = app.get(ExternalApplyService);
    expect((await external.capabilities(user.id, [match.id]))[match.id]).toMatchObject({ available: true });

    await request(server).put('/admin/ops/features/external_apply.submissions').set(as('ADMIN')).send({ paused: true }).expect(400);
    await request(server).put('/admin/ops/features/external_apply.submissions').set(as('ADMIN')).send({ paused: true, reason: 'Synthetic incident' }).expect(200);
    expect((await external.capabilities(user.id, [match.id]))[match.id]).toMatchObject({ available: false, reason: 'OPERATOR_PAUSED' });
    await expect(external.create(user.id, match.id)).rejects.toMatchObject({ status: 403 });
    await request(server).put('/admin/ops/features/external_apply.submissions').set(as('ADMIN')).send({ paused: false }).expect(200);
    expect((await external.capabilities(user.id, [match.id]))[match.id]).toMatchObject({ available: true });
    const log = await prisma.adminAuditLog.findFirst({ where: { action: 'FEATURE_PAUSED', targetId: 'external_apply.submissions' } });
    expect(log?.metadata).toMatchObject({ before: 'running', after: 'paused', reason: 'Synthetic incident' });
  });

  it('an import cannot be requested while paused, and a request is deduplicated', async () => {
    await request(server).put('/admin/ops/features/import.glorri').set(as('ADMIN')).send({ paused: true, reason: 'Source maintenance' }).expect(200);
    await request(server).post('/admin/ops/imports/glorri').set(as('ADMIN')).expect(409);
    await request(server).put('/admin/ops/features/import.glorri').set(as('ADMIN')).send({ paused: false }).expect(200);
    expect((await request(server).post('/admin/ops/imports/glorri').set(as('ADMIN')).expect(200)).body).toEqual({ queued: true });
    expect((await request(server).post('/admin/ops/imports/glorri').set(as('ADMIN')).expect(200)).body).toMatchObject({ queued: false });
    // Only provably idempotent queues can be retried from the panel.
    await request(server).post('/admin/ops/queues/resume-tailor/jobs/1/retry').set(as('ADMIN')).expect(400);
    await request(server).post('/admin/ops/queues/external-apply/jobs/1/retry').set(as('ADMIN')).expect(400);
    await request(server).post('/admin/ops/queues/job-ingested/jobs/does-not-exist/retry').set(as('ADMIN')).expect(404);
  });

  it('a hidden listing stops being actionable and stays hidden when an import reopens it', async () => {
    const j = await job('hide');
    await request(server).post(`/admin/listings/${j.id}/hide`).set(as('ADMIN')).send({}).expect(400);
    await request(server).post(`/admin/listings/${j.id}/hide`).set(as('ADMIN')).send({ reason: 'Misleading ad' }).expect(200);
    const hidden = await prisma.job.findUniqueOrThrow({ where: { id: j.id } });
    expect(isJobActionable(hidden)).toBe(false);
    await prisma.job.update({ where: { id: j.id }, data: { status: 'CLOSED', closedAt: new Date(), lastSeenAt: new Date(Date.now() - 60_000) } });
    await app.get(JobsService).upsertJob({ externalId: j.externalId, title: j.title, company: j.company, description: 'x', location: 'Bakı', url: j.url, postedAt: j.postedAt.toISOString(), rawPayload: j.rawPayload as any }, new Date());
    const reopened = await prisma.job.findUniqueOrThrow({ where: { id: j.id } });
    expect(reopened.status).toBe('ACTIVE');
    expect(reopened.hiddenAt).not.toBeNull();
    expect(isJobActionable(reopened)).toBe(false);
    const list = await request(server).get('/admin/listings').query({ hidden: 'true', q: 'Sintetik hide' }).set(as('SUPPORT')).expect(200);
    expect(list.body.data.map((x: any) => x.id)).toContain(j.id);
    await request(server).post(`/admin/listings/${j.id}/restore`).set(as('ADMIN')).expect(200);
    expect(isJobActionable(await prisma.job.findUniqueOrThrow({ where: { id: j.id } }))).toBe(true);
  });

  it('suspending a candidate ends their session and blocks sign-in until restored', async () => {
    const user = await candidate('suspend');
    await request(server).post(`/admin/users/${user.id}/suspend`).set(as('ADMIN')).send({ reason: 'Abuse report' }).expect(200);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    await request(server).post('/auth/login').send({ email: mail('suspend'), password }).expect(403);
    await request(server).post(`/admin/users/${user.id}/restore`).set(as('ADMIN')).expect(200);
    await request(server).post('/auth/login').send({ email: mail('suspend'), password }).expect(201);
  });

  it('suspends and restores an approved employer; an unapproved one cannot be suspended', async () => {
    const business = await prisma.business.create({ data: { email: mail('biz'), hashedPassword: 'x', company: { create: { name: `Sintetik ${stamp}`, status: 'APPROVED' } } }, include: { company: true } });
    await request(server).post(`/admin/companies/${business.company!.id}/suspend`).set(as('ADMIN')).send({ reason: 'Fake vacancies' }).expect(200);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: business.company!.id } })).status).toBe('SUSPENDED');
    await request(server).post(`/admin/companies/${business.company!.id}/suspend`).set(as('ADMIN')).send({ reason: 'again' }).expect(409);
    await request(server).post(`/admin/companies/${business.company!.id}/restore`).set(as('ADMIN')).expect(200);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: business.company!.id } })).status).toBe('APPROVED');
  });

  it('a plan override is auditable, expires and never edits the payment subscription', async () => {
    const user = await candidate('plan');
    const load = () => prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { subscription: true, planOverrides: activePlanOverrides() } });
    await request(server).post(`/admin/users/${user.id}/plan-overrides`).set(as('ADMIN')).send({ plan: 'Limitsiz', reason: 'Pilot partner', days: 0 }).expect(400);
    const granted = await request(server).post(`/admin/users/${user.id}/plan-overrides`).set(as('ADMIN')).send({ plan: 'Limitsiz', reason: 'Pilot partner', days: 30 }).expect(201);
    expect(effectivePlan(await load())).toBe('Limitsiz');
    expect((await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } })).plan).toBe('FREE');
    const view = await request(server).get(`/admin/users/${user.id}/plan-overrides`).set(as('SUPPORT')).expect(200);
    expect(view.body).toMatchObject({ subscription: { plan: 'FREE', providerManaged: false }, overrides: [expect.objectContaining({ plan: 'Limitsiz', active: true, reason: 'Pilot partner' })] });
    // Expired overrides no longer count.
    await prisma.planOverride.update({ where: { id: granted.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(effectivePlan(await load())).toBe('FREE');
    await prisma.planOverride.update({ where: { id: granted.body.id }, data: { expiresAt: new Date(Date.now() + 86_400_000) } });
    await request(server).delete(`/admin/users/${user.id}/plan-overrides/${granted.body.id}`).set(as('ADMIN')).expect(200);
    expect(effectivePlan(await load())).toBe('FREE');
    const log = await prisma.adminAuditLog.findFirst({ where: { action: 'PLAN_OVERRIDE_GRANTED', targetId: user.id } });
    expect(log?.metadata).toMatchObject({ plan: 'Limitsiz', days: 30, reason: 'Pilot partner' });
    // The old direct subscription edit is gone.
    await request(server).patch(`/admin/users/${user.id}/plan`).set(as('SUPER_ADMIN')).send({ plan: 'Limitsiz' }).expect(404);
  });

  it('audits sensitive record access and lists the audit trail with filters', async () => {
    const user = await candidate('viewed');
    await request(server).get(`/admin/users/${user.id}`).set(as('ADMIN')).expect(200);
    const audit = await request(server).get('/admin/audit').query({ action: 'USER_RECORD_VIEWED' }).set(as('ADMIN')).expect(200);
    expect(audit.body.data[0]).toMatchObject({ action: 'USER_RECORD_VIEWED', targetId: user.id, actor: mail('admin') });
    expect(audit.body.actions).toEqual(expect.arrayContaining(['USER_RECORD_VIEWED', 'FEATURE_PAUSED']));
    const apps = await request(server).get('/admin/applications').query({ kind: 'external' }).set(as('SUPPORT')).expect(200);
    expect(apps.body).toMatchObject({ data: expect.any(Array), meta: expect.any(Object) });
  });

  describe('recommended actions', () => {
    const recommendations = (role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT') => request(server).get('/admin/ops/recommendations').set(as(role));
    const byId = (body: any) => Object.fromEntries(body.items.map((i: any) => [i.id, i]));

    it('requires an operator session, reports what was actually observed, and says which areas were checked', async () => {
      await request(server).get('/admin/ops/recommendations').expect(401);
      const { body } = await recommendations('SUPPORT').expect(200);
      expect(body).toMatchObject({ contractVersion: 1, environment: 'staging', role: 'SUPPORT', generatedAt: expect.any(String) });
      const items = byId(body);
      // The harness points the matching service and worker at a closed port and writes a backup status with a recorded failure.
      expect(items['service.matching.down']).toMatchObject({ status: 'attention', severity: 'high', area: 'services', requiredPermission: 'ops.read', canAct: true });
      expect(items['service.applyWorker.down']).toMatchObject({ severity: 'medium' });
      expect(items['service.database.down']).toBeUndefined();
      expect(items['service.redis.down']).toBeUndefined();
      expect(items['backup.failed']).toMatchObject({ status: 'attention', severity: 'high', facts: { lastBackupAt: expect.any(String) } });
      // No restore test was ever recorded: that is unknown, not a pass and not a failure.
      expect(items['backup.restore-untested']).toMatchObject({ status: 'unknown' });
      expect(items['documents.provider.not-configured']).toMatchObject({ area: 'documents', status: 'attention' });
      const checked = Object.fromEntries(body.checked.map((c: any) => [c.area, c.status]));
      expect(checked).toMatchObject({ services: 'attention', backup: 'attention', email: 'skipped' });
      expect(Object.keys(checked).sort()).toEqual(['backup', 'documents', 'email', 'imports', 'moderation', 'queues', 'services']);
      expect(body.summary.attention + body.summary.unknown).toBe(body.items.length);
      // Every item carries the contract fields the UI needs.
      for (const item of body.items) {
        expect(item).toMatchObject({ id: expect.any(String), area: expect.any(String), status: expect.stringMatching(/^(attention|unknown)$/), severity: expect.stringMatching(/^(critical|high|medium|low|info)$/), title: expect.any(String), condition: expect.any(String), nextStep: expect.any(String), observedAt: expect.any(String), freshness: { source: expect.any(String) }, link: expect.any(Object), requiredPermission: expect.any(String), canAct: expect.any(Boolean) });
      }
      // Sorted most severe first.
      const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as any;
      expect(body.items.map((i: any) => rank[i.severity])).toEqual([...body.items.map((i: any) => rank[i.severity])].sort((a, b) => a - b));
    });

    it('computes canAct from the role: the same condition is actionable for an administrator and not for support, and the action keeps its own guard', async () => {
      const [support, admin] = await Promise.all([recommendations('SUPPORT'), recommendations('ADMIN')]);
      const failedQueueLike = (body: any) => body.items.filter((i: any) => i.requiredPermission === 'ops.control');
      for (const item of failedQueueLike(support.body)) expect(item.canAct).toBe(false);
      for (const item of failedQueueLike(admin.body)) expect(item.canAct).toBe(true);
      // Pointing at an action never performs it: the guarded route still refuses support.
      await request(server).post('/admin/ops/imports/glorri').set(as('SUPPORT')).expect(403);
    });

    it('keeps unknown unknown: an unreadable backup status, a check that fails, and an import that never ran are never reported as healthy', async () => {
      const original = process.env.BACKUP_STATUS_FILE;
      process.env.BACKUP_STATUS_FILE = path.join(statusDir, 'missing.json');
      try {
        const { body } = await recommendations('ADMIN').expect(200);
        expect(byId(body)['backup.unknown']).toMatchObject({ status: 'unknown', area: 'backup' });
        expect(body.checked.find((c: any) => c.area === 'backup').status).toBe('unknown');
        expect(byId(body)['backup.failed']).toBeUndefined();
      } finally { process.env.BACKUP_STATUS_FILE = original; }

      const spy = jest.spyOn(prisma.company, 'count').mockRejectedValueOnce(new Error('connection reset'));
      try {
        const { body } = await recommendations('ADMIN').expect(200);
        expect(byId(body)['check.moderation.failed']).toMatchObject({ status: 'unknown', area: 'moderation' });
        expect(body.checked.find((c: any) => c.area === 'moderation')).toMatchObject({ status: 'unknown', note: expect.any(String) });
        expect(JSON.stringify(body)).not.toContain('connection reset'); // internal error text is never shown
      } finally { spy.mockRestore(); }
    });

    it('turns recorded facts into items with their own age: a failed Glorri import, lost document workers and stranded reservations', async () => {
      const user = await candidate('recs');
      const old = new Date(Date.now() - 30 * 60_000);
      const stuck = await prisma.resume.create({ data: { userId: user.id, isBase: false, status: 'PENDING', createdAt: old } });
      await prisma.documentCharge.create({ data: { userId: user.id, resumeId: stuck.id, periodKey: '2026-10', status: 'RESERVED', expiresAt: new Date(Date.now() - 60_000) } });
      const run = await prisma.jobImportRun.create({ data: { source: 'glorri', status: 'FAILED', startedAt: new Date(Date.now() - 20 * 60_000), runKey: `ops-rec-${stamp}`, error: 'boom' } });
      try {
        const { body } = await recommendations('ADMIN').expect(200);
        const items = byId(body);
        expect(items['imports.glorri.failed']).toMatchObject({ status: 'attention', severity: 'high', requiredPermission: 'ops.control', freshness: { source: 'import run records', stale: false } });
        expect(items['documents.stale-pending']).toMatchObject({ facts: { stalePending: expect.any(Number), oldestPendingAt: expect.any(String) } });
        expect(items['documents.stranded-reservations']).toMatchObject({ severity: 'low' });
        expect(items['imports.glorri.failed'].freshness.ageSeconds).toBeGreaterThan(19 * 60);
        // Nothing the endpoint did changed any of it.
        expect((await prisma.resume.findUniqueOrThrow({ where: { id: stuck.id } })).status).toBe('PENDING');
        expect((await prisma.documentCharge.findFirstOrThrow({ where: { resumeId: stuck.id } })).status).toBe('RESERVED');
      } finally {
        await prisma.documentCharge.deleteMany({ where: { userId: user.id } });
        await prisma.resume.deleteMany({ where: { userId: user.id } });
        await prisma.jobImportRun.delete({ where: { id: run.id } });
      }
    });

    it('never exposes secrets, addresses or destructive instructions', async () => {
      const text = JSON.stringify((await recommendations('SUPER_ADMIN').expect(200)).body);
      for (const secret of [process.env.RESEND_API_KEY, process.env.DATABASE_URL, password, 'postgrespassword', 'whsec_']) if (secret) expect(text).not.toContain(secret);
      expect(text).not.toMatch(/\b(rm -|sudo|docker |DROP |TRUNCATE|curl )/i);
    });
  });
});
