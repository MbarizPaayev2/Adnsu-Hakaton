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
import { PRODUCT_SPEC } from '@aise/shared-types';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { EmailModule } from '../src/common/email.module';
import { AuthModule } from '../src/auth/auth.module';
import { BillingModule } from '../src/billing/billing.module';
import { BillingService } from '../src/billing/billing.service';
import { periodFor } from '../src/documents/allowance-ledger';
import { UsageService } from '../src/billing/usage.service';

// Product catalogue, entitlements, Premium purchase eligibility, signed-webhook activation and metering over the real HTTP routes and the
// isolated aise_phase2_test database. The payment provider is a local fake; PAYMENTS_ENABLED stays a sandbox value for this test only.

const stamp = `${Date.now()}`;
const prefix = `aise-product-${stamp}`;
const mail = (who: string) => `aise-product-${who}-${stamp}@example.com`;
const WEBHOOK_SECRET = `whsec_${Buffer.from(`synthetic-product-secret-${stamp}`).toString('base64')}`;
const PRODUCTS = { BASIC: 'pdt_fixture_basic', STANDARD: 'pdt_fixture_standard', UNLIMITED: 'pdt_fixture_unlimited', PREMIUM: 'pdt_fixture_premium' };

class FakeDodo {
  subs = new Map<string, any>();
  sessions: any[] = [];
  subscriptions = { retrieve: async (id: string) => { const s = this.subs.get(id); if (!s) throw Object.assign(new Error('not found'), { status: 404 }); return { ...s }; }, update: async () => undefined };
  checkoutSessions = { create: async (body: any) => { this.sessions.push(body); return { checkout_url: 'https://checkout.invalid/fixture' }; } };
}

describe('product catalogue, entitlements and Premium (isolated synthetic data)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  const dodo = new FakeDodo();
  const env = { ...process.env };

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Refusing to run outside the isolated local aise_phase2_test');
    process.env.DATABASE_URL = db.toString();
    Object.assign(process.env, {
      NODE_ENV: 'test', RESEND_API_KEY: 're_mock_key', MATCHING_SERVICE_URL: 'http://127.0.0.1:9', APPLY_WORKER_URL: 'http://127.0.0.1:9',
      DODO_PAYMENTS_API_KEY: 'fixture_offline_key_0000', DODO_ENV: 'test_mode', PAYMENTS_ENABLED: 'true', DODO_WEBHOOK_KEY: WEBHOOK_SECRET,
      DODO_PRODUCT_ID_BASIC: PRODUCTS.BASIC, DODO_PRODUCT_ID_STANDARD: PRODUCTS.STANDARD, DODO_PRODUCT_ID_UNLIMITED: PRODUCTS.UNLIMITED, DODO_PRODUCT_ID_PREMIUM: PRODUCTS.PREMIUM,
      PRODUCT_CONFIG_JSON: JSON.stringify({ prices: { PREMIUM: 12 }, limits: { 'candidate.premium.documents.generations': 3 } }),
    });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, EmailModule, AuthModule, BillingModule,
    ] }).compile();
    app = module.createNestApplication({ logger: ['error'], bodyParser: false });
    app.use('/webhooks/dodo', express.raw({ type: 'application/json' }));
    app.use(express.json());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    (app.get(BillingService) as any).dodo = dodo;
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      const events = await prisma.billingWebhookEvent.findMany({ where: { id: { startsWith: `msg_${stamp}` } }, select: { id: true } });
      await prisma.billingWebhookEvent.deleteMany({ where: { id: { in: events.map((e) => e.id) } } });
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
  function deliver(type: string, subscriptionId: string, id = `msg_${stamp}_${++seq}`) {
    const body = JSON.stringify({ type, timestamp: new Date().toISOString(), data: { payload_type: 'Subscription', subscription_id: subscriptionId } });
    const now = new Date();
    return request(server).post('/webhooks/dodo').set('Content-Type', 'application/json').set('webhook-id', id)
      .set('webhook-timestamp', `${Math.floor(now.getTime() / 1000)}`).set('webhook-signature', new Webhook(WEBHOOK_SECRET).sign(id, now, body)).send(body);
  }
  async function candidate(who: string, plan: 'FREE' | 'BASIC' | 'PREMIUM' = 'FREE') {
    const user = await prisma.user.create({ data: { email: mail(who), hashedPassword: await bcrypt.hash('Synthetic-Candidate-1', 4), emailVerified: new Date(), subscription: { create: { plan, status: 'active' } } } });
    const token = randomBytes(32).toString('hex');
    await prisma.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) } });
    return { user, auth: { Authorization: `Bearer ${token}` } };
  }
  const remote = (id: string, userId: string, patch: Record<string, unknown> = {}) => {
    dodo.subs.set(id, { subscription_id: id, status: 'active', product_id: PRODUCTS.PREMIUM, next_billing_date: new Date(Date.now() + 30 * 86_400_000).toISOString(), cancel_at_next_billing_date: false, metadata: { userId }, customer: { customer_id: `cus_${id}` }, ...patch });
  };

  it('publishes the effective catalogue: prices unset stay null, configured Premium is purchasable, employer offers are not', async () => {
    const res = await request(server).get('/billing/catalogue').expect(200);
    expect(res.body.specVersion).toBe(PRODUCT_SPEC.version);
    const offers = Object.fromEntries(res.body.candidate.offers.map((o: any) => [o.id, o]));
    expect(offers.premium).toMatchObject({ plan: 'PREMIUM', price: 12, purchasable: true });
    expect(offers.premium.features['documents.generations'].limit).toBe(3); // operator override applied (the approved default is no monthly cap)
    expect(offers.plus).toMatchObject({ plan: 'PLUS', price: 8, purchasable: false }); // approved price, but no provider product is mapped in this deployment
    expect(offers.free.features['documents.generations']).toMatchObject({ enabled: true, limit: 5, period: 'month' });
    expect(offers.free).toMatchObject({ price: null, purchasable: false });
    expect(offers.legacy_basic).toMatchObject({ legacy: true, plan: 'BASIC' });
    const employerOffers = Object.fromEntries(res.body.employer.offers.map((o: any) => [o.id, o]));
    // Approved employer prices are visible, but nothing is purchasable until employer billing is enabled with provider products.
    expect(employerOffers.single_job).toMatchObject({ label: 'Tək vakansiya', price: 20, purchasable: false });
    expect(employerOffers.business).toMatchObject({ label: 'Biznes', price: 100, purchasable: false });
    expect(employerOffers.starter_trial).toMatchObject({ label: 'Sınaq', price: null, purchasable: false });
    expect(res.body.employer.offers.every((o: any) => o.purchasable === false)).toBe(true);
    expect(res.body.employer.addons[0]).toMatchObject({ mustBeLabelled: true, purchasable: false });
    expect(res.body.employer.invariants.importedCvExposure).toBe('never');
    const text = JSON.stringify(res.body).toLowerCase();
    for (const claim of PRODUCT_SPEC.forbiddenClaims) expect(text).not.toContain(claim.toLowerCase());
  });

  it('requires a session for entitlements and shows each owner only their own', async () => {
    await request(server).get('/billing/entitlements').expect(401);
    const a = await candidate('ent-a');
    const b = await candidate('ent-b', 'BASIC');
    const free = (await request(server).get('/billing/entitlements').set(a.auth).expect(200)).body;
    expect(free).toMatchObject({ plan: 'FREE', offer: 'free', legacy: false });
    expect(free.features['saved.jobs']).toMatchObject({ enabled: true, limit: 200 });
    expect(free.features['alerts.instant'].enabled).toBe(false);
    // Letters are part of the shared document allowance now (5 a month on Free).
    expect(free.features['tailored.cover_letter']).toMatchObject({ enabled: true });
    expect(free.features['documents.generations']).toMatchObject({ enabled: true, limit: 5, used: 0, reserved: 0, remaining: 5, resetsAt: expect.any(String) });
    const legacy = (await request(server).get('/billing/entitlements').set(b.auth).expect(200)).body;
    // Existing customers keep their meaning: tailoring stays "included per match", no new metering limit is imposed.
    expect(legacy).toMatchObject({ plan: 'BASIC', offer: 'legacy_basic', legacy: true });
    expect(legacy.features['tailored.cv']).toMatchObject({ enabled: true, limit: null, period: 'per_match' });
    expect(legacy.features['documents.generations']).toMatchObject({ enabled: true, limit: null, remaining: null, protections: { concurrent: 3, perHour: 30 } });
  });

  it('cannot be bypassed from the client: checkout plan ids and forged plan claims grant nothing', async () => {
    const { user, auth } = await candidate('bypass');
    await request(server).post('/billing/checkout-session').send({ planId: 'premium' }).expect(401);
    await request(server).post('/billing/checkout-session').set(auth).send({ planId: 'enterprise' }).expect(400);
    await request(server).post('/billing/checkout-session').set(auth).send({ planId: 'free' }).expect(400);
    for (const legacy of ['basic', 'standard', 'unlimited']) await request(server).post('/billing/checkout-session').set(auth).send({ planId: legacy }).expect(400); // retired products never open a checkout
    const ok = await request(server).post('/billing/checkout-session').set(auth).send({ planId: 'premium' }).expect(201);
    expect(ok.body.url).toContain('checkout.invalid');
    // Product id comes from the server's own catalogue; the plan claimed in metadata is never the source of truth.
    expect(dodo.sessions.at(-1).product_cart[0].product_id).toBe(PRODUCTS.PREMIUM);
    expect((await request(server).get('/billing/entitlements').set(auth).expect(200)).body.plan).toBe('FREE'); // nothing granted by starting checkout
    expect(user.id).toBeTruthy();
  });

  it('activates Premium only from a signed delivery, applies a replay once, and falls back to FREE on failed renewal and cancellation', async () => {
    const { user, auth } = await candidate('premium');
    const id = `sub_${stamp}_prem`;
    remote(id, user.id);
    const forged = `msg_${stamp}_forged`;
    await request(server).post('/webhooks/dodo').set('Content-Type', 'application/json').set('webhook-id', forged).set('webhook-timestamp', `${Math.floor(Date.now() / 1000)}`).set('webhook-signature', 'v1,AAAA').send('{"type":"subscription.active"}').expect(400);
    expect((await request(server).get('/billing/entitlements').set(auth)).body.plan).toBe('FREE');

    const msg = `msg_${stamp}_prem1`;
    await deliver('subscription.active', id, msg).expect(201);
    const prem = (await request(server).get('/billing/entitlements').set(auth).expect(200)).body;
    expect(prem).toMatchObject({ plan: 'PREMIUM', offer: 'premium' });
    expect(prem.features['alerts.instant']).toMatchObject({ enabled: true, limit: 10, period: 'day' });
    expect(prem.features['documents.generations']).toMatchObject({ enabled: true, limit: 3, period: 'month', used: 0, remaining: 3 });

    dodo.subs.get(id).product_id = PRODUCTS.BASIC; // a replay must not re-apply
    expect((await deliver('subscription.active', id, msg).expect(201)).body).toEqual({ received: true, duplicate: true });
    expect((await request(server).get('/billing/entitlements').set(auth)).body.plan).toBe('PREMIUM');
    dodo.subs.get(id).product_id = PRODUCTS.PREMIUM;

    dodo.subs.get(id).status = 'on_hold'; // failed renewal
    await deliver('subscription.on_hold', id).expect(201);
    expect((await request(server).get('/billing/entitlements').set(auth)).body).toMatchObject({ plan: 'FREE', offer: 'free' });
    dodo.subs.get(id).status = 'active';
    await deliver('subscription.active', id).expect(201);
    dodo.subs.get(id).status = 'cancelled';
    await deliver('subscription.cancelled', id).expect(201);
    expect(await prisma.subscription.findUnique({ where: { userId: user.id } })).toMatchObject({ plan: 'FREE', status: 'cancelled' });
  });

  it('meters costly usage atomically: concurrent requests never exceed the limit, and usage shows in entitlements', async () => {
    const { user, auth } = await candidate('usage', 'PREMIUM');
    const usage = app.get(UsageService);
    const granted = (await Promise.all(Array.from({ length: 20 }, () => usage.consume(user.id, 'tailored.cv', 'month', 3)))).filter(Boolean).length;
    expect(granted).toBe(3);
    expect(await usage.consume(user.id, 'tailored.cv', 'month', 0)).toBe(false);
    // The shadow counter keeps counting and never refuses.
    await usage.record(user.id, 'tailored.cv', 'month');
    expect(await usage.usedIn(user.id, 'tailored.cv', 'month')).toBe(4);
    // The document allowance shown in entitlements is the ledger: committed generations, running ones, and nothing expired.
    const period = periodFor();
    const charge = (status: 'COMMITTED' | 'RESERVED', expiresAt: Date) => ({ userId: user.id, periodKey: period.key, status, expiresAt });
    await prisma.documentCharge.createMany({ data: [charge('COMMITTED', new Date()), charge('COMMITTED', new Date()), charge('RESERVED', new Date(Date.now() + 600_000)), charge('RESERVED', new Date(Date.now() - 1000))] });
    const ent = (await request(server).get('/billing/entitlements').set(auth).expect(200)).body;
    expect(ent.features['documents.generations']).toMatchObject({ limit: 3, used: 2, reserved: 1, remaining: 0, periodKey: period.key, resetsAt: period.resetsAt.toISOString() });
    // Another account's usage is separate.
    const other = await candidate('usage-other', 'PREMIUM');
    expect((await request(server).get('/billing/entitlements').set(other.auth)).body.features['documents.generations']).toMatchObject({ used: 0, reserved: 0, remaining: 3 });
  });

  it('leaves no usage rows when an account is deleted (cascade)', async () => {
    const { user } = await candidate('delete');
    await app.get(UsageService).consume(user.id, 'tailored.cv', 'month', 5);
    expect(await prisma.usageCounter.count({ where: { userId: user.id } })).toBe(1);
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.usageCounter.count({ where: { userId: user.id } })).toBe(0);
  });
});
