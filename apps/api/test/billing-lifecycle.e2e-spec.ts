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
import { Webhook } from 'standardwebhooks';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { EmailModule } from '../src/common/email.module';
import { AuthModule } from '../src/auth/auth.module';
import { BillingModule } from '../src/billing/billing.module';
import { BillingService } from '../src/billing/billing.service';
import { AccountsModule } from '../src/accounts/accounts.module';
import { AdminModule } from '../src/admin/admin.module';
import { LocalStorageService } from '../src/resumes/local-storage.service';
import { ApplyWorkerClient } from '../src/external-apply/apply-worker.client';
import { activePlanOverrides, effectivePlan } from '../src/billing/entitlement';

// Billing lifecycle and account deletion over the real HTTP routes and the
// isolated aise_phase2_test database. The payment provider is a local fake:
// no request leaves this machine and no real payment exists.

const stamp = `${Date.now()}`;
const prefix = `aise-billing-${stamp}`;
const mail = (who: string) => `aise-billing-${who}-${stamp}@example.com`;
const WEBHOOK_SECRET = `whsec_${Buffer.from(`synthetic-webhook-secret-${stamp}`).toString('base64')}`;
const PRODUCTS = { BASIC: 'pdt_fixture_basic', STANDARD: 'pdt_fixture_standard', UNLIMITED: 'pdt_fixture_unlimited' };

type RemoteSub = { subscription_id: string; status: string; product_id: string; next_billing_date: string; cancel_at_next_billing_date: boolean; metadata: Record<string, string>; customer: { customer_id: string } };

class FakeDodo {
  subs = new Map<string, RemoteSub>();
  down = false;
  updates: Array<{ id: string; body: any }> = [];
  subscriptions = {
    retrieve: async (id: string) => {
      if (this.down) throw Object.assign(new Error('connect ECONNREFUSED'), { status: undefined });
      const sub = this.subs.get(id);
      if (!sub) throw Object.assign(new Error('not found'), { status: 404 });
      return { ...sub };
    },
    update: async (id: string, body: any) => {
      if (this.down) throw Object.assign(new Error('connect ECONNREFUSED'), { status: undefined });
      this.updates.push({ id, body });
      const sub = this.subs.get(id);
      if (sub && body.status) sub.status = body.status;
      return sub;
    },
  };
}

describe('billing lifecycle and account deletion (isolated synthetic data)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  let storage: LocalStorageService;
  const dodo = new FakeDodo();
  const env = { ...process.env };
  const deletedSessions: string[] = [];
  let adminToken = '';

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Refusing billing test outside isolated local aise_phase2_test');
    process.env.DATABASE_URL = db.toString();
    Object.assign(process.env, {
      NODE_ENV: 'test', RESEND_API_KEY: 're_mock_key', MATCHING_SERVICE_URL: 'http://127.0.0.1:9', APPLY_WORKER_URL: 'http://127.0.0.1:9',
      // Not a real key (no 'mock' substring, so the real code path runs); the
      // client it builds is replaced by FakeDodo below before any call.
      DODO_PAYMENTS_API_KEY: 'fixture_offline_key_0000', DODO_ENV: 'test_mode', PAYMENTS_ENABLED: 'true', DODO_WEBHOOK_KEY: WEBHOOK_SECRET,
      DODO_PRODUCT_ID_BASIC: PRODUCTS.BASIC, DODO_PRODUCT_ID_STANDARD: PRODUCTS.STANDARD, DODO_PRODUCT_ID_UNLIMITED: PRODUCTS.UNLIMITED,
    });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, EmailModule, AuthModule, BillingModule, AccountsModule, AdminModule,
    ] }).overrideProvider(ApplyWorkerClient).useValue({ deleteSession: async (id: string) => { deletedSessions.push(id); return { ok: true }; } }).compile();
    app = module.createNestApplication({ logger: ['error'], bodyParser: false });
    app.use('/webhooks/dodo', express.raw({ type: 'application/json' }));
    app.use(express.json());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    storage = app.get(LocalStorageService);
    (app.get(BillingService) as any).dodo = dodo;

    const admin = await prisma.adminUser.create({ data: { email: mail('admin'), hashedPassword: await bcrypt.hash('Synthetic-Billing-Pass-1', 4), role: 'SUPER_ADMIN' } });
    adminToken = randomBytes(32).toString('hex');
    await prisma.adminSession.create({ data: { sessionToken: adminToken, adminUserId: admin.id, expires: new Date(Date.now() + 3_600_000), mfaVerified: true } });
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      const events = await prisma.billingWebhookEvent.findMany({ where: { id: { startsWith: `msg_${stamp}` } }, select: { id: true } });
      await prisma.billingWebhookEvent.deleteMany({ where: { id: { in: events.map((e) => e.id) } } });
      const admins = (await prisma.adminUser.findMany({ where: { email: { contains: `-${stamp}@` } }, select: { id: true } })).map((u) => u.id);
      await prisma.adminAuditLog.deleteMany({ where: { adminUserId: { in: admins } } });
      await prisma.adminUser.deleteMany({ where: { id: { in: admins } } });
      await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    }
    await app?.close();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    process.env = { ...env };
  }, 60_000);

  let seq = 0;
  function deliver(type: string, subscriptionId: string, extra: Record<string, unknown> = {}, id = `msg_${stamp}_${++seq}`) {
    const body = JSON.stringify({ business_id: 'bus_fixture', type, timestamp: new Date().toISOString(), data: { payload_type: 'Subscription', subscription_id: subscriptionId, ...extra } });
    const now = new Date();
    const signature = new Webhook(WEBHOOK_SECRET).sign(id, now, body);
    return request(server).post('/webhooks/dodo').set('Content-Type', 'application/json')
      .set('webhook-id', id).set('webhook-timestamp', `${Math.floor(now.getTime() / 1000)}`).set('webhook-signature', signature).send(body);
  }

  async function candidate(who: string) {
    const password = 'Synthetic-Candidate-1';
    const user = await prisma.user.create({ data: { email: mail(who), hashedPassword: await bcrypt.hash(password, 4), emailVerified: new Date(), subscription: { create: { plan: 'FREE', status: 'active' } } } });
    const token = randomBytes(32).toString('hex');
    await prisma.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) } });
    return { user, token, password, auth: { Authorization: `Bearer ${token}` } };
  }

  function remote(id: string, userId: string, patch: Partial<RemoteSub> = {}) {
    const sub: RemoteSub = {
      subscription_id: id, status: 'active', product_id: PRODUCTS.STANDARD, next_billing_date: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      cancel_at_next_billing_date: false, metadata: { userId }, customer: { customer_id: `cus_${id}` }, ...patch,
    };
    dodo.subs.set(id, sub);
    return sub;
  }

  const planOf = async (userId: string) => effectivePlan(await prisma.user.findUnique({ where: { id: userId }, include: { subscription: true, planOverrides: activePlanOverrides() } }));

  it('rejects an unsigned or tampered delivery and records nothing', async () => {
    const { user } = await candidate('forged');
    remote(`sub_${stamp}_forged`, user.id);
    await request(server).post('/webhooks/dodo').set('Content-Type', 'application/json').set('webhook-id', `msg_${stamp}_forged`).set('webhook-timestamp', `${Math.floor(Date.now() / 1000)}`).set('webhook-signature', 'v1,AAAA').send('{"type":"subscription.active"}').expect(400);
    expect(await prisma.billingWebhookEvent.findUnique({ where: { id: `msg_${stamp}_forged` } })).toBeNull();
    expect(await planOf(user.id)).toBe('FREE');
  });

  it('activates from the provider state, applies a redelivery once, and ignores forged plan claims in the payload', async () => {
    const { user, auth } = await candidate('activate');
    const id = `sub_${stamp}_act`;
    remote(id, user.id, { product_id: PRODUCTS.BASIC });
    const msg = `msg_${stamp}_act`;
    // The payload claims Limitsiz; the provider says the product bought is Basic.
    await deliver('subscription.active', id, { product_id: PRODUCTS.UNLIMITED, metadata: { userId: user.id, plan: 'Limitsiz' } }, msg).expect(201);
    expect(await planOf(user.id)).toBe('BASIC');
    const first = await prisma.billingWebhookEvent.findUnique({ where: { id: msg } });
    expect(first?.processedAt).toBeTruthy();

    // Redelivery of the same id after the provider changed: acknowledged, not re-applied.
    dodo.subs.get(id)!.product_id = PRODUCTS.STANDARD;
    const dup = await deliver('subscription.active', id, {}, msg).expect(201);
    expect(dup.body).toEqual({ received: true, duplicate: true });
    expect(await planOf(user.id)).toBe('BASIC');

    const view = await request(server).get('/billing/subscription').set(auth).expect(200);
    expect(view.body).toMatchObject({ plan: 'BASIC', subscriptionPlan: 'BASIC', status: 'active', providerManaged: true, cancelAtPeriodEnd: false });
  });

  it('applies plan changes and out-of-order events by reading the current provider state', async () => {
    const { user } = await candidate('order');
    const id = `sub_${stamp}_order`;
    remote(id, user.id, { product_id: PRODUCTS.BASIC });
    await deliver('subscription.active', id).expect(201);
    expect(await planOf(user.id)).toBe('BASIC');

    // plan_changed: the old handler ignored the product; now the plan follows it.
    dodo.subs.get(id)!.product_id = PRODUCTS.UNLIMITED;
    await deliver('subscription.plan_changed', id).expect(201);
    expect(await planOf(user.id)).toBe('Limitsiz');

    // The subscription is put on hold (payment failed) …
    dodo.subs.get(id)!.status = 'on_hold';
    await deliver('subscription.on_hold', id).expect(201);
    expect(await planOf(user.id)).toBe('FREE');
    // … and a late, out-of-order "active" event must not resurrect it.
    await deliver('subscription.active', id).expect(201);
    expect(await planOf(user.id)).toBe('FREE');
    const row = await prisma.subscription.findUnique({ where: { userId: user.id } });
    expect(row).toMatchObject({ status: 'on_hold', plan: 'Limitsiz' });

    // Scheduled cancellation keeps access until the period ends, and says so.
    Object.assign(dodo.subs.get(id)!, { status: 'active', cancel_at_next_billing_date: true });
    await deliver('subscription.updated', id).expect(201);
    expect(await planOf(user.id)).toBe('Limitsiz');
    expect((await prisma.subscription.findUnique({ where: { userId: user.id } }))?.cancelAtPeriodEnd).toBe(true);

    // Final cancellation drops to FREE.
    dodo.subs.get(id)!.status = 'cancelled';
    await deliver('subscription.cancelled', id).expect(201);
    expect(await prisma.subscription.findUnique({ where: { userId: user.id } })).toMatchObject({ plan: 'FREE', status: 'cancelled', currentPeriodEnd: null });
  });

  it('leaves a delivery unprocessed when the provider cannot be reached, so the provider retries it', async () => {
    const { user } = await candidate('retry');
    const id = `sub_${stamp}_retry`;
    remote(id, user.id);
    const msg = `msg_${stamp}_retry`;
    dodo.down = true;
    try {
      await deliver('subscription.active', id, {}, msg).expect(503);
    } finally {
      dodo.down = false;
    }
    expect((await prisma.billingWebhookEvent.findUnique({ where: { id: msg } }))?.processedAt).toBeNull();
    expect(await planOf(user.id)).toBe('FREE');
    await deliver('subscription.active', id, {}, msg).expect(201);
    expect(await planOf(user.id)).toBe('STANDARD');
  });

  it('never grants a plan for an unknown product or an unmapped subscription', async () => {
    const { user } = await candidate('unknown');
    remote(`sub_${stamp}_unk`, user.id, { product_id: 'pdt_not_ours' });
    await deliver('subscription.active', `sub_${stamp}_unk`).expect(201);
    expect(await planOf(user.id)).toBe('FREE');
    remote(`sub_${stamp}_orphan`, 'no-such-user');
    await deliver('subscription.active', `sub_${stamp}_orphan`).expect(201);
    const events = await prisma.billingWebhookEvent.findMany({ where: { subscriptionId: { in: [`sub_${stamp}_unk`, `sub_${stamp}_orphan`] } } });
    expect(events.map((e) => e.outcome).sort()).toEqual(['unknown_product', 'unmapped']);
  });

  it('recovers a verified payment for an account that has no subscription row: grants it once, never twice', async () => {
    const user = await prisma.user.create({ data: { email: mail('norow'), hashedPassword: 'x', emailVerified: new Date() } }); // no subscription row on purpose
    expect(await prisma.subscription.count({ where: { userId: user.id } })).toBe(0);
    const id = `sub_${stamp}_norow`;
    remote(id, user.id);
    const msg = `msg_${stamp}_norow`;
    await deliver('subscription.active', id, {}, msg).expect(201);
    expect(await prisma.subscription.count({ where: { userId: user.id } })).toBe(1);
    expect(await planOf(user.id)).toBe('STANDARD');
    expect((await prisma.billingWebhookEvent.findUnique({ where: { id: msg } }))?.outcome).not.toBe('unmapped');
    // the same delivery again, and a different delivery of the same state: nothing changes, still one row
    const before = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } });
    const again = await deliver('subscription.active', id, {}, msg).expect(201);
    expect(again.body).toMatchObject({ duplicate: true });
    await deliver('subscription.updated', id).expect(201);
    expect(await prisma.subscription.count({ where: { userId: user.id } })).toBe(1);
    const after = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect([after.plan, after.status, after.dodoSubscriptionId]).toEqual([before.plan, before.status, before.dodoSubscriptionId]);
  });

  it('reports payment availability and mode', async () => {
    const status = await request(server).get('/billing/status').expect(200);
    expect(status.body).toEqual({ paymentsEnabled: true, mode: 'test', documentGenerationEnabled: true, emailApplicationsEnabled: false, emailAutomationEnabled: false }); // the site never promises what is switched off
  });

  it('self-deletion stops billing first, and refuses (deleting nothing) when that cannot be confirmed', async () => {
    const { user, auth, password } = await candidate('selfdel');
    const id = `sub_${stamp}_del`;
    remote(id, user.id);
    await deliver('subscription.active', id).expect(201);
    const cv = await storage.uploadBuffer(Buffer.from(`%PDF-1.4 synthetic ${stamp}`), 'application/pdf');
    await prisma.resume.create({ data: { userId: user.id, isBase: true, status: 'READY', fileUrl: cv } });

    await request(server).delete('/auth/account').set(auth).send({ password: 'wrong-password-1' }).expect(401);

    dodo.down = true;
    try {
      await request(server).delete('/auth/account').set(auth).send({ password }).expect(503);
    } finally {
      dodo.down = false;
    }
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    expect(storage.fileExists(cv)).toBe(true);

    const res = await request(server).delete('/auth/account').set(auth).send({ password }).expect(200);
    expect(res.body).toEqual({ success: true, leftoverFiles: 0, unconfirmedEmailApplications: 0 });
    expect(dodo.updates).toContainEqual({ id, body: { status: 'cancelled' } });
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(storage.fileExists(cv)).toBe(false);
  });

  it('admin deletion uses the same path: blocks while a send is in flight, closes live sessions, and keeps an audit entry', async () => {
    const { user } = await candidate('admindel');
    const job = await prisma.job.create({ data: { externalId: `glorri:billing-${stamp}`, title: 'Sintetik vakansiya', company: 'Sintetik MMC', description: 'x', location: 'Bakı', url: `https://example.com/${stamp}`, postedAt: new Date() } });
    const match = await prisma.match.create({ data: { userId: user.id, jobId: job.id, score: 0.9 } });
    const ext = await prisma.externalApplication.create({ data: { userId: user.id, matchId: match.id, status: 'SUBMITTING', applyUrl: 'https://example.com/apply' } });
    try {
      await request(server).delete(`/admin/users/${user.id}`).set('Authorization', `Bearer ${adminToken}`).expect(409);
      expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();

      await prisma.externalApplication.update({ where: { id: ext.id }, data: { status: 'READY_FOR_REVIEW' } });
      await request(server).delete(`/admin/users/${user.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(deletedSessions).toContain(ext.id);
      expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
      const audit = await prisma.adminAuditLog.findFirst({ where: { action: 'USER_DELETED', targetId: user.id } });
      expect(audit?.metadata).toMatchObject({ email: expect.stringMatching(/^a\*\*\*@example\.com$/) });
    } finally {
      await prisma.job.delete({ where: { id: job.id } }).catch(() => undefined);
    }
  });
});
