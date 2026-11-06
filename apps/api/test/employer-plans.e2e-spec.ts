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
import { VacanciesModule } from '../src/vacancies/vacancies.module';
import { JobApplicationsModule } from '../src/job-applications/job-applications.module';
import { JobsModule } from '../src/jobs/jobs.module';
import { CompaniesModule } from '../src/companies/companies.module';
import { EmployerPlansService } from '../src/employer-plans/employer-plans.service';
import { JobCatalogueService } from '../src/jobs/job-catalogue.service';
import { LocalStorageService } from '../src/resumes/local-storage.service';
import { ApplyWorkerClient } from '../src/external-apply/apply-worker.client';

// Employer plans (Sınaq / Tək vakansiya / Biznes) over the real HTTP routes and the isolated aise_phase2_test database.
// The payment provider is a local fake: no request leaves this machine and no real payment exists.

const stamp = `${Date.now()}`;
const prefix = `aise-employer-${stamp}`;
const mail = (who: string) => `aise-employer-${who}-${stamp}@example.com`;
const WEBHOOK_SECRET = `whsec_${Buffer.from(`synthetic-webhook-secret-${stamp}`).toString('base64')}`;
const PRODUCTS = { SINGLE: 'pdt_fixture_employer_single', BUSINESS: 'pdt_fixture_employer_business', CANDIDATE: 'pdt_fixture_standard' };
const DAY = 86_400_000;

type Payment = { payment_id: string; status: string; total_amount: number; currency: string; product_cart: { product_id: string }[]; metadata: Record<string, string>; checkout_session_id?: string | null };
type Sub = { subscription_id: string; status: string; product_id: string; next_billing_date: string; cancel_at_next_billing_date: boolean; metadata: Record<string, string>; customer: { customer_id: string } };

class FakeDodo {
  paid = new Map<string, Payment>();
  subs = new Map<string, Sub>();
  sessions: any[] = [];
  down = false;
  paymentsApi = {
    retrieve: async (id: string) => {
      if (this.down) throw Object.assign(new Error('connect ECONNREFUSED'), { status: undefined });
      const p = this.paid.get(id);
      if (!p) throw Object.assign(new Error('not found'), { status: 404 });
      return { ...p };
    },
  };
  subscriptions = {
    retrieve: async (id: string) => {
      if (this.down) throw Object.assign(new Error('connect ECONNREFUSED'), { status: undefined });
      const s = this.subs.get(id);
      if (!s) throw Object.assign(new Error('not found'), { status: 404 });
      return { ...s };
    },
    update: async () => ({}),
  };
  checkoutSessions = {
    create: async (body: any) => {
      this.sessions.push(body);
      return { session_id: `cks_${stamp}_${this.sessions.length}`, checkout_url: `https://checkout.invalid/${this.sessions.length}` };
    },
  };
  refundsMade: any[] = [];
  refundOutcome: 'succeeded' | 'failed' | 'pending' | 'throw' = 'succeeded';
  refundStore = new Map<string, any>();
  refunds = {
    create: async (body: any) => {
      if (this.refundOutcome === 'throw') throw Object.assign(new Error('provider down'), { status: 500 });
      this.refundsMade.push(body);
      const r = { refund_id: `re_${stamp}_${this.refundsMade.length}`, payment_id: body.payment_id, status: this.refundOutcome };
      this.refundStore.set(r.refund_id, r);
      return r;
    },
    retrieve: async (id: string) => {
      const r = this.refundStore.get(id);
      if (!r) throw Object.assign(new Error('not found'), { status: 404 });
      return { ...r };
    },
  };
  customers = { customerPortal: { create: async (id: string) => ({ link: `https://portal.invalid/${id}` }) } };
}

describe('employer plans (isolated synthetic data)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  let plans: EmployerPlansService;
  let catalogue: JobCatalogueService;
  const dodo = new FakeDodo();
  // The service reads `payments.retrieve`; expose the map-backed API under that name.
  (dodo as any).payments = dodo.paymentsApi;
  const stored: string[] = [];
  const env = { ...process.env };
  let adminToken = '';
  let n = 0;

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Refusing employer-plans test outside isolated local aise_phase2_test');
    process.env.DATABASE_URL = db.toString();
    Object.assign(process.env, {
      NODE_ENV: 'test', RESEND_API_KEY: 're_mock_key', MATCHING_SERVICE_URL: 'http://127.0.0.1:9', APPLY_WORKER_URL: 'http://127.0.0.1:9',
      DODO_PAYMENTS_API_KEY: 'fixture_offline_key_0000', DODO_ENV: 'test_mode', PAYMENTS_ENABLED: 'true', DODO_WEBHOOK_KEY: WEBHOOK_SECRET,
      DODO_PRODUCT_ID_BASIC: 'pdt_fixture_basic', DODO_PRODUCT_ID_STANDARD: PRODUCTS.CANDIDATE, DODO_PRODUCT_ID_UNLIMITED: 'pdt_fixture_unlimited',
      EMPLOYER_PLANS_ENABLED: 'true', EMPLOYER_BILLING_ENABLED: 'true',
      DODO_PRODUCT_ID_EMPLOYER_SINGLE: PRODUCTS.SINGLE, DODO_PRODUCT_ID_EMPLOYER_BUSINESS: PRODUCTS.BUSINESS,
    });
    delete process.env.EMPLOYER_VACANCY_AUTO_APPROVE;
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, EmailModule, AuthModule, BillingModule, AccountsModule, AdminModule, VacanciesModule, JobApplicationsModule, JobsModule, CompaniesModule,
    ] }).overrideProvider(ApplyWorkerClient).useValue({ deleteSession: async () => ({ ok: true }) }).compile();
    app = module.createNestApplication({ logger: ['error'], bodyParser: false });
    app.use('/webhooks/dodo', express.raw({ type: 'application/json' }));
    app.use(express.json());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    plans = app.get(EmployerPlansService);
    catalogue = app.get(JobCatalogueService, { strict: false });
    (plans as any).dodo = dodo;
    (plans as any).isMock = false;
    (app.get(BillingService) as any).dodo = dodo;

    const admin = await prisma.adminUser.create({ data: { email: mail('admin'), hashedPassword: await bcrypt.hash('Synthetic-Employer-Pass-1', 4), role: 'SUPER_ADMIN' } });
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
      await prisma.business.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    }
    const storage = app?.get(LocalStorageService);
    for (const url of stored) await storage?.deleteFile(url).catch(() => undefined);
    await app?.close();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    process.env = { ...env };
  }, 60_000);

  let seq = 0;
  function deliver(type: string, data: Record<string, unknown>, id = `msg_${stamp}_${++seq}`) {
    const body = JSON.stringify({ business_id: 'bus_fixture', type, timestamp: new Date().toISOString(), data });
    const now = new Date();
    const signature = new Webhook(WEBHOOK_SECRET).sign(id, now, body);
    return request(server).post('/webhooks/dodo').set('Content-Type', 'application/json')
      .set('webhook-id', id).set('webhook-timestamp', `${Math.floor(now.getTime() / 1000)}`).set('webhook-signature', signature).send(body);
  }

  async function employer(who: string, company: { name?: string; website?: string | null; status?: 'APPROVED' | 'PENDING' | 'SUSPENDED' } = {}) {
    const email = mail(`${who}${++n}`);
    const business = await prisma.business.create({
      data: { email, hashedPassword: await bcrypt.hash('Synthetic-Employer-1', 4), emailVerified: new Date(), company: { create: { name: company.name ?? `Sınaq Şirkəti ${who} ${stamp}`, website: company.website ?? null, status: company.status ?? 'APPROVED' } } },
      include: { company: true },
    });
    const token = randomBytes(32).toString('hex');
    await prisma.businessSession.create({ data: { businessId: business.id, sessionToken: token, expires: new Date(Date.now() + 3_600_000) } });
    return { business, company: business.company!, auth: { Authorization: `Bearer ${token}` } };
  }

  async function candidate(who: string) {
    const user = await prisma.user.create({ data: { email: mail(`${who}${++n}`), hashedPassword: await bcrypt.hash('Synthetic-Candidate-1', 4), emailVerified: new Date(), subscription: { create: { plan: 'FREE', status: 'active' } } } });
    const token = randomBytes(32).toString('hex');
    await prisma.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) } });
    const cv = await app.get(LocalStorageService).uploadBuffer(Buffer.from(`%PDF-1.4 synthetic ${stamp} ${user.id}`), 'application/pdf');
    stored.push(cv);
    await prisma.resume.create({ data: { userId: user.id, isBase: true, status: 'READY', fileUrl: cv } });
    return { user, auth: { Authorization: `Bearer ${token}` } };
  }

  const draft = async (e: { auth: any }, title = `Mühasib ${stamp} ${++n}`, extra: Record<string, unknown> = {}) =>
    (await request(server).post('/business/vacancies').set(e.auth).send({
      title, description: 'Bakıda yerləşən şirkətə hesabatların hazırlanması və ilkin sənədlərin uçotu üzrə mühasib axtarılır.', requirements: 'Ali təhsil, iki il təcrübə, Excel bilikləri.', location: 'Bakı', ...extra,
    }).expect(201)).body;
  const submit = (e: { auth: any }, id: string) => request(server).post(`/business/plans/vacancies/${id}/submit`).set(e.auth);
  const approve = (id: string) => request(server).patch(`/admin/employer-vacancies/${id}/approve`).set('Authorization', `Bearer ${adminToken}`);
  const reject = (id: string, reason = 'Elan qaydalara uyğun deyil') => request(server).patch(`/admin/employer-vacancies/${id}/reject`).set('Authorization', `Bearer ${adminToken}`).send({ reason });
  const publish = (e: { auth: any }, id: string) => request(server).post(`/business/plans/vacancies/${id}/publish`).set(e.auth);
  async function approved(e: { auth: any }, extra: Record<string, unknown> = {}) {
    const v = await draft(e, undefined, extra);
    await submit(e, v.id).expect(200);
    await approve(v.id).expect(200);
    return v.id as string;
  }
  const open = async (id: string) => !!(await catalogue.openItem('native', id));

  /** A payment the provider reports as paid for one single listing, mapped to a purchase created through the real checkout route. */
  async function singlePurchase(e: { auth: any; company: { id: string } }, key = `key-${stamp}-${++n}-abcdef`) {
    const res = await request(server).post('/business/plans/checkout/single').set(e.auth).send({ idempotencyKey: key }).expect(200);
    return { ...res.body, key } as { purchaseId: string; url: string | null; key: string };
  }
  function pay(purchaseId: string, companyId: string, patch: Partial<Payment> = {}) {
    const p: Payment = { payment_id: `pay_${stamp}_${++n}`, status: 'succeeded', total_amount: 2000, currency: 'AZN', product_cart: [{ product_id: PRODUCTS.SINGLE }], metadata: { aise: 'employer', kind: 'SINGLE_30D', purchaseId, companyId }, ...patch };
    dodo.paid.set(p.payment_id, p);
    return p;
  }
  const creditsOf = (companyId: string, status = 'AVAILABLE') => prisma.employerCredit.count({ where: { companyId, status: status as any } });

  // ───────────────────────────────────────────────────────────── lifecycle: trial
  it('moves a draft through review, publishes it on the free trial, and lets it be found only while the trial runs', async () => {
    const e = await employer('trial');
    const v = await draft(e);
    expect(v.status).toBe('DRAFT');
    expect(await open(v.id)).toBe(false);

    // Not publishable before the review: nothing is spent, nothing becomes public.
    await publish(e, v.id).expect(409);
    await submit(e, v.id).expect(200);
    expect((await prisma.vacancy.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('PENDING_REVIEW');
    await publish(e, v.id).expect(409);
    expect(await prisma.employerTrial.count({ where: { companyId: e.company.id } })).toBe(0);

    const queue = await request(server).get('/admin/employer-vacancies/pending').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(queue.body.map((x: any) => x.id)).toContain(v.id);
    await approve(v.id).expect(200);
    expect(await open(v.id)).toBe(false); // approved is not public

    const before = Date.now();
    const done = await publish(e, v.id).expect(200);
    expect(done.body).toMatchObject({ status: 'ACTIVE', publicationPlan: 'TRIAL' });
    const trial = await prisma.employerTrial.findUniqueOrThrow({ where: { companyId: e.company.id } });
    // The fourteen days start at actual publication, not at registration or creation.
    expect(trial.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(done.body.expiresAt).getTime() - trial.startedAt.getTime()).toBe(14 * DAY);
    expect(await open(v.id)).toBe(true);
    const pub = await request(server).get(`/vacancies/${v.id}`).expect(200);
    expect(pub.body.id).toBe(v.id);

    // Publishing again is idempotent: still one trial, same expiry.
    const again = await publish(e, v.id).expect(200);
    expect(again.body.expiresAt).toBe(done.body.expiresAt);
    expect(await prisma.employerTrial.count({ where: { companyId: e.company.id } })).toBe(1);

    const overview = await request(server).get('/business/plans').set(e.auth).expect(200);
    expect(overview.body).toMatchObject({ gated: true, checkoutAvailable: true, trial: { used: true, available: false }, nextPublication: 'NONE', credits: { available: 0 } });
  });

  it('gives the trial once per verified company: a second vacancy, a same-name company and a same-website company are refused', async () => {
    const first = await employer('once', { name: `Alfa Qrup MMC ${stamp}`, website: `https://www.alfa-${stamp}.example.az/careers` });
    await publish(first, await approved(first)).expect(200);

    const second = await approved(first);
    const refused = await publish(first, second).expect(403);
    expect(JSON.stringify(refused.body)).toContain('ENTITLEMENT_REQUIRED');
    expect((await prisma.vacancy.findUniqueOrThrow({ where: { id: second } })).status).toBe('APPROVED');

    // Same company name (legal form, case and diacritics ignored) under another account.
    const sameName = await employer('samename', { name: `ALFA  qrup ${stamp}` });
    const o1 = await request(server).get('/business/plans').set(sameName.auth).expect(200);
    expect(o1.body.trial.available).toBe(false);
    await publish(sameName, await approved(sameName)).expect(403);

    // Same website under a different name.
    const sameSite = await employer('samesite', { name: `Tamam Başqa Ad ${stamp}`, website: `alfa-${stamp}.example.az` });
    await publish(sameSite, await approved(sameSite)).expect(403);

    // A genuinely different company still gets its own trial.
    const other = await employer('other');
    await publish(other, await approved(other)).expect(200);
  });

  it('stops new applications the moment the period ends, keeps received ones reachable, and expires the listing on the sweep', async () => {
    const e = await employer('expiry');
    const id = await approved(e);
    await publish(e, id).expect(200);
    const cand = await candidate('apply');
    const applied = await request(server).post(`/vacancies/${id}/apply`).set(cand.auth).send({}).expect(201);
    expect(applied.body.vacancyId ?? applied.body.id).toBeTruthy();

    await prisma.vacancy.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const late = await candidate('late');
    const refused = await request(server).post(`/vacancies/${id}/apply`).set(late.auth).send({}).expect(400);
    expect(JSON.stringify(refused.body)).toContain('müddəti bitib');
    expect(await open(id)).toBe(false);

    const out = await plans.sweep();
    expect(out.expired).toBeGreaterThanOrEqual(1);
    const v = await prisma.vacancy.findUniqueOrThrow({ where: { id } });
    expect(v).toMatchObject({ status: 'EXPIRED', expiryReason: 'TRIAL_ENDED' });
    // Existing applications and the employer's access to them are untouched.
    expect(await prisma.application.count({ where: { vacancyId: id } })).toBe(1);
    const inbox = await request(server).get('/business/applications').set(e.auth).expect(200);
    expect(JSON.stringify(inbox.body)).toContain(cand.user.email);
    // The company profile stays readable and editable once the trial is over.
    const profile = await request(server).get('/business/company').set(e.auth).expect(200);
    expect(profile.body.id).toBe(e.company.id);
    // An expired trial listing cannot be revived without paying.
    await publish(e, id).expect(403);
  });

  // ───────────────────────────────────────────────────────────── Tək vakansiya
  it('sells one 30-day listing for 20 AZN: idempotent checkout, provider-confirmed grant, once per payment', async () => {
    const e = await employer('single');
    const key = `key-${stamp}-single-abcdef`;
    const first = await request(server).post('/business/plans/checkout/single').set(e.auth).send({ idempotencyKey: key }).expect(200);
    expect(first.body.url).toMatch(/^https:\/\/checkout\.invalid\//);
    const sent = dodo.sessions[dodo.sessions.length - 1];
    expect(sent.product_cart).toEqual([{ product_id: PRODUCTS.SINGLE, quantity: 1 }]);
    expect(sent.metadata).toMatchObject({ aise: 'employer', kind: 'SINGLE_30D', purchaseId: first.body.purchaseId, companyId: e.company.id });

    // A double click / retry with the same key neither creates a second purchase nor a second provider session.
    const sessionsBefore = dodo.sessions.length;
    const retry = await request(server).post('/business/plans/checkout/single').set(e.auth).send({ idempotencyKey: key }).expect(200);
    expect(retry.body.purchaseId).toBe(first.body.purchaseId);
    expect(dodo.sessions.length).toBe(sessionsBefore);
    expect(await prisma.employerPurchase.count({ where: { companyId: e.company.id } })).toBe(1);

    // Nothing is granted before the provider says paid.
    expect(await creditsOf(e.company.id)).toBe(0);
    const p = pay(first.body.purchaseId, e.company.id);
    const msg = `msg_${stamp}_pay${++n}`;
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: p.payment_id }, msg).expect(201);
    expect(await creditsOf(e.company.id)).toBe(1);
    expect((await prisma.employerPurchase.findUniqueOrThrow({ where: { id: first.body.purchaseId } })).status).toBe('PAID');

    // The same delivery again, and a second delivery of the same payment: still one credit.
    expect((await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: p.payment_id }, msg).expect(201)).body).toEqual({ received: true, duplicate: true });
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: p.payment_id }).expect(201);
    expect(await creditsOf(e.company.id)).toBe(1);
    // Paid purchases cannot be started again with the same key.
    const paid = await request(server).post('/business/plans/checkout/single').set(e.auth).send({ idempotencyKey: key }).expect(200);
    expect(paid.body).toMatchObject({ alreadyPaid: true });
    expect(await prisma.employerPurchase.count({ where: { companyId: e.company.id } })).toBe(1);
  });

  it('grants nothing for a failed payment, a wrong amount, a wrong company or an unknown purchase, and ignores what the payload claims', async () => {
    const e = await employer('refuse');
    const other = await employer('refuse-other');
    const purchase = await singlePurchase(e);

    const failed = pay(purchase.purchaseId, e.company.id, { status: 'failed' });
    await deliver('payment.failed', { payload_type: 'Payment', payment_id: failed.payment_id }).expect(201);
    expect(await creditsOf(e.company.id)).toBe(0);
    expect((await prisma.employerPurchase.findUniqueOrThrow({ where: { id: purchase.purchaseId } })).status).toBe('FAILED');

    const cheap = pay(purchase.purchaseId, e.company.id, { total_amount: 200 });
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: cheap.payment_id }).expect(201);
    const wrongCurrency = pay(purchase.purchaseId, e.company.id, { currency: 'USD' });
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: wrongCurrency.payment_id }).expect(201);
    expect(await creditsOf(e.company.id)).toBe(0);

    const wrongCompany = pay(purchase.purchaseId, other.company.id);
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: wrongCompany.payment_id }).expect(201);
    expect(await creditsOf(e.company.id) + await creditsOf(other.company.id)).toBe(0);

    const unknown = pay('does-not-exist', e.company.id);
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: unknown.payment_id }).expect(201);
    expect(await creditsOf(e.company.id)).toBe(0);

    // The webhook payload claims a different company and a paid status; only the provider's record counts.
    const real = pay(purchase.purchaseId, e.company.id, { status: 'pending' });
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: real.payment_id, status: 'succeeded', metadata: { companyId: other.company.id, purchaseId: purchase.purchaseId } }).expect(201);
    expect(await creditsOf(e.company.id) + await creditsOf(other.company.id)).toBe(0);

    // A later genuine success for the purchase that had failed still grants exactly once (the provider retried the payment).
    real.status = 'succeeded';
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: real.payment_id }).expect(201);
    expect(await creditsOf(e.company.id)).toBe(1);
  });

  it('maps a payment to its purchase by the stored checkout session when the provider carried no metadata', async () => {
    const e = await employer('session-map');
    const purchase = await singlePurchase(e);
    const stored = await prisma.employerPurchase.findUniqueOrThrow({ where: { id: purchase.purchaseId } });
    expect(stored.checkoutSessionId).toMatch(/^cks_/);
    const p = pay(purchase.purchaseId, e.company.id, { metadata: {}, checkout_session_id: stored.checkoutSessionId });
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: p.payment_id }).expect(201);
    expect(await creditsOf(e.company.id)).toBe(1);
    // A payment that names neither a purchase nor a known session is not guessed at.
    const stray = pay('x', e.company.id, { metadata: {}, checkout_session_id: 'cks_unknown' });
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: stray.payment_id }).expect(201);
    expect(await creditsOf(e.company.id)).toBe(1);
  });

  it('never grants from a provider outage: the delivery is not acknowledged so the provider retries it', async () => {
    const e = await employer('outage');
    const purchase = await singlePurchase(e);
    const p = pay(purchase.purchaseId, e.company.id);
    dodo.down = true;
    const res = await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: p.payment_id });
    dodo.down = false;
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await creditsOf(e.company.id)).toBe(0);
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: p.payment_id }).expect(201);
    expect(await creditsOf(e.company.id)).toBe(1);
  });

  it('publishes a paid listing for 30 days (capped by its deadline), and extends it only by spending another payment', async () => {
    const e = await employer('credit');
    await publish(e, await approved(e)).expect(200); // trial used up
    const target = await approved(e);
    expect((await publish(e, target).expect(403)).body.code ?? 'ENTITLEMENT_REQUIRED').toBeTruthy();

    // Payment BEFORE moderation: the credit waits unspent.
    const waiting = await draft(e);
    await submit(e, waiting.id).expect(200);
    const p1 = pay((await singlePurchase(e)).purchaseId, e.company.id);
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: p1.payment_id }).expect(201);
    await publish(e, waiting.id).expect(409);
    expect(await creditsOf(e.company.id)).toBe(1);

    const now = Date.now();
    const done = await publish(e, target).expect(200);
    expect(done.body).toMatchObject({ status: 'ACTIVE', publicationPlan: 'SINGLE' });
    const days = (new Date(done.body.expiresAt).getTime() - now) / DAY;
    expect(days).toBeGreaterThan(29.99);
    expect(days).toBeLessThan(30.01);
    expect(await creditsOf(e.company.id)).toBe(0);
    expect(await creditsOf(e.company.id, 'CONSUMED')).toBe(1);

    // No credit: extension is refused and nothing changes. No silent renewal exists.
    await request(server).post(`/business/plans/vacancies/${target}/extend`).set(e.auth).expect(403);
    const unchanged = await prisma.vacancy.findUniqueOrThrow({ where: { id: target } });
    expect(unchanged.expiresAt!.toISOString()).toBe(done.body.expiresAt);

    // An explicit second purchase adds another 30 days after the current end.
    const p2 = pay((await singlePurchase(e)).purchaseId, e.company.id);
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: p2.payment_id }).expect(201);
    const extended = await request(server).post(`/business/plans/vacancies/${target}/extend`).set(e.auth).expect(200);
    expect(new Date(extended.body.expiresAt).getTime() - new Date(done.body.expiresAt).getTime()).toBe(30 * DAY);

    // A listing whose own deadline is sooner closes at the deadline, not after 30 days.
    const soon = new Date(Date.now() + 5 * DAY);
    const dl = await approved(e, { deadline: soon.toISOString() });
    const p3 = pay((await singlePurchase(e)).purchaseId, e.company.id);
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: p3.payment_id }).expect(201);
    const capped = await publish(e, dl).expect(200);
    expect(new Date(capped.body.expiresAt).getTime()).toBe(soon.getTime());
  });

  it('spends one payment on exactly one listing under concurrent publish requests', async () => {
    const e = await employer('race');
    await publish(e, await approved(e)).expect(200); // trial
    const ids = [await approved(e), await approved(e), await approved(e), await approved(e), await approved(e)];
    const p = pay((await singlePurchase(e)).purchaseId, e.company.id);
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: p.payment_id }).expect(201);
    const results = await Promise.all(ids.map((id) => publish(e, id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 403)).toHaveLength(4);
    expect(await prisma.vacancy.count({ where: { id: { in: ids }, status: 'ACTIVE' } })).toBe(1);
    expect(await creditsOf(e.company.id, 'CONSUMED')).toBe(1);

    // Two simultaneous first publications of a fresh company start one trial, not two.
    const fresh = await employer('race-trial');
    const two = [await approved(fresh), await approved(fresh)];
    const r = await Promise.all(two.map((id) => publish(fresh, id)));
    expect(r.filter((x) => x.status === 200)).toHaveLength(1);
    expect(await prisma.employerTrial.count({ where: { companyId: fresh.company.id } })).toBe(1);
  });

  // ───────────────────────────────────────────────────────────── refunds (docs/employer-refund-policy-2026-10-11.md)
  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
  async function paidPurchase(e: { auth: any; company: { id: string } }) {
    const purchase = await singlePurchase(e);
    const p = pay(purchase.purchaseId, e.company.id);
    await deliver('payment.succeeded', { payload_type: 'Payment', payment_id: p.payment_id }).expect(201);
    return { purchaseId: purchase.purchaseId, paymentId: p.payment_id };
  }

  it('refunds an unused purchase: the credit is voided before the money moves, cannot be spent, and the refund is applied once', async () => {
    const e = await employer('refund-unused');
    await publish(e, await approved(e)).expect(200); // trial
    const { purchaseId, paymentId } = await paidPurchase(e);
    const target = await approved(e);
    dodo.refundOutcome = 'pending';
    const r = await request(server).post(`/admin/employer-purchases/${purchaseId}/refund`).set(adminAuth()).send({ reason: 'İstifadə olunmamış kredit, işəgötürən tələb etdi' }).expect(201);
    expect(r.body.outcome).toBe('employer_refund_pending');
    expect(dodo.refundsMade.at(-1)).toMatchObject({ payment_id: paymentId });
    expect(await creditsOf(e.company.id)).toBe(0);
    expect((await prisma.employerPurchase.findUniqueOrThrow({ where: { id: purchaseId } })).status).toBe('REFUND_PENDING');
    // The voided credit cannot publish anything while the refund is open.
    await publish(e, target).expect(403);
    // A second request (double click, second operator) does not send a second refund.
    const before = dodo.refundsMade.length;
    const again = await request(server).post(`/admin/employer-purchases/${purchaseId}/refund`).set(adminAuth()).send({ reason: 'Təkrar sorğu yoxlaması' }).expect(201);
    expect(again.body.alreadyRequested).toBe(true);
    expect(dodo.refundsMade.length).toBe(before);
    // The genuine refund.succeeded arrives (re-fetched from the provider), twice.
    const refundId = (await prisma.employerPurchase.findUniqueOrThrow({ where: { id: purchaseId } })).refundId!;
    dodo.refundStore.set(refundId, { refund_id: refundId, payment_id: paymentId, status: 'succeeded' });
    const msg = `msg_${stamp}_rf${++n}`;
    await deliver('refund.succeeded', { payload_type: 'Refund', refund_id: refundId, payment_id: paymentId }, msg).expect(201);
    await deliver('refund.succeeded', { payload_type: 'Refund', refund_id: refundId, payment_id: paymentId }).expect(201);
    const done = await prisma.employerPurchase.findUniqueOrThrow({ where: { id: purchaseId }, include: { credit: true } });
    expect(done.status).toBe('REFUNDED');
    expect(done.credit?.status).toBe('VOIDED');
    expect(done.refundedAt).toBeTruthy();
    await publish(e, target).expect(403);
    dodo.refundOutcome = 'succeeded';
  });

  it('restores the credit when the provider refuses the refund or is unreachable, and records who asked and why', async () => {
    const e = await employer('refund-refused');
    const { purchaseId } = await paidPurchase(e);
    dodo.refundOutcome = 'throw';
    await request(server).post(`/admin/employer-purchases/${purchaseId}/refund`).set(adminAuth()).send({ reason: 'Provayder əlçatan deyil sınağı' }).expect(503);
    let p = await prisma.employerPurchase.findUniqueOrThrow({ where: { id: purchaseId }, include: { credit: true } });
    expect(p).toMatchObject({ status: 'PAID' });
    expect(p.credit?.status).toBe('AVAILABLE');
    dodo.refundOutcome = 'failed';
    const r = await request(server).post(`/admin/employer-purchases/${purchaseId}/refund`).set(adminAuth()).send({ reason: 'Provayder rədd edir sınağı' }).expect(201);
    expect(r.body.outcome).toBe('employer_refund_failed');
    p = await prisma.employerPurchase.findUniqueOrThrow({ where: { id: purchaseId }, include: { credit: true } });
    expect(p.status).toBe('PAID');
    expect(p.credit?.status).toBe('AVAILABLE');
    expect(await prisma.adminAuditLog.count({ where: { targetId: purchaseId, action: 'EMPLOYER_PURCHASE_REFUND_REQUESTED' } })).toBeGreaterThan(0);
    dodo.refundOutcome = 'succeeded';
  });

  it('refunds a delivered listing only when the operator confirms it is withdrawn (platform failure); its applications stay', async () => {
    const e = await employer('refund-delivered');
    await publish(e, await approved(e)).expect(200); // trial
    const { purchaseId } = await paidPurchase(e);
    const id = await approved(e);
    await publish(e, id).expect(200);
    expect(await creditsOf(e.company.id, 'CONSUMED')).toBe(1);
    const refused = await request(server).post(`/admin/employer-purchases/${purchaseId}/refund`).set(adminAuth()).send({ reason: 'Elan yayımlanıb, geri ödəniş soruşulur' }).expect(409);
    expect(JSON.stringify(refused.body)).toContain('LISTING_DELIVERED');
    expect(dodo.refundsMade.filter((r) => r.metadata?.purchaseId === purchaseId)).toHaveLength(0);
    dodo.refundOutcome = 'succeeded';
    await request(server).post(`/admin/employer-purchases/${purchaseId}/refund`).set(adminAuth()).send({ reason: 'Platforma nasazlığı: elan 3 gün göstərilmədi', endListing: true }).expect(201);
    expect(await prisma.vacancy.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'EXPIRED', expiryReason: 'REFUNDED' });
    expect((await prisma.employerPurchase.findUniqueOrThrow({ where: { id: purchaseId } })).status).toBe('REFUNDED');
  });

  it('refuses a refund for an unpaid purchase, requires a reason, and is not available to other roles', async () => {
    const e = await employer('refund-guards');
    const pending = await singlePurchase(e);
    await request(server).post(`/admin/employer-purchases/${pending.purchaseId}/refund`).set(adminAuth()).send({ reason: 'Ödənilməyib sınağı' }).expect(409);
    const { purchaseId } = await paidPurchase(e);
    await request(server).post(`/admin/employer-purchases/${purchaseId}/refund`).set(adminAuth()).send({ reason: '' }).expect(400);
    await request(server).post(`/admin/employer-purchases/${purchaseId}/refund`).send({ reason: 'Giriş yoxdur' }).expect(401);
    const list = await request(server).get('/admin/employer-purchases?status=PAID').set(adminAuth()).expect(200);
    expect(list.body.map((x: any) => x.id)).toContain(purchaseId);
  });

  // ───────────────────────────────────────────────────────────── Biznes
  function businessSub(companyId: string, patch: Partial<Sub> = {}) {
    const s: Sub = {
      subscription_id: `sub_${stamp}_${++n}`, status: 'active', product_id: PRODUCTS.BUSINESS, next_billing_date: new Date(Date.now() + 30 * DAY).toISOString(),
      cancel_at_next_billing_date: false, metadata: { aise: 'employer', kind: 'BUSINESS_MONTHLY', companyId }, customer: { customer_id: `cus_${stamp}_${n}` }, ...patch,
    };
    dodo.subs.set(s.subscription_id, s);
    return s;
  }

  it('lets a Business company publish many listings with no count cap, bounded by reconfirmation and the paid period', async () => {
    const e = await employer('biz');
    const checkout = await request(server).post('/business/plans/checkout/business').set(e.auth).expect(200);
    expect(checkout.body.url).toMatch(/^https:\/\/checkout\.invalid\//);
    expect(dodo.sessions[dodo.sessions.length - 1].product_cart).toEqual([{ product_id: PRODUCTS.BUSINESS, quantity: 1 }]);

    const sub = businessSub(e.company.id);
    await deliver('subscription.active', { payload_type: 'Subscription', subscription_id: sub.subscription_id }).expect(201);
    const row = await prisma.employerSubscription.findUniqueOrThrow({ where: { companyId: e.company.id } });
    expect(row.status).toBe('active');
    // It must not be mistaken for a candidate subscription.
    expect(await prisma.subscription.count({ where: { user: { email: e.business.email } } })).toBe(0);

    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await approved(e));
    for (const id of ids) {
      const r = await publish(e, id).expect(200);
      expect(r.body.publicationPlan).toBe('BUSINESS');
    }
    const first = await prisma.vacancy.findUniqueOrThrow({ where: { id: ids[0] } });
    // Bounded by the shorter of the 60-day reconfirmation window and the paid period (30 days here).
    expect(first.expiresAt!.getTime()).toBeLessThanOrEqual(new Date(sub.next_billing_date).getTime());
    expect(await prisma.employerTrial.count({ where: { companyId: e.company.id } })).toBe(0); // Business does not burn the free trial

    const overview = await request(server).get('/business/plans').set(e.auth).expect(200);
    expect(overview.body.business).toMatchObject({ active: true, status: 'active', cancelAtPeriodEnd: false });
    expect(overview.body.nextPublication).toBe('BUSINESS');

    // Refuses a second subscription while one is active.
    await request(server).post('/business/plans/checkout/business').set(e.auth).expect(409);
  });

  it('keeps data and applications through cancellation, a failed renewal and reactivation; listings follow the subscription', async () => {
    const e = await employer('lapse');
    const sub = businessSub(e.company.id);
    await deliver('subscription.active', { payload_type: 'Subscription', subscription_id: sub.subscription_id }).expect(201);
    const id = await approved(e);
    await publish(e, id).expect(200);
    const cand = await candidate('lapse');
    await request(server).post(`/vacancies/${id}/apply`).set(cand.auth).send({}).expect(201);

    // The customer cancels at period end: still active until the paid period is over.
    sub.cancel_at_next_billing_date = true;
    await deliver('subscription.updated', { payload_type: 'Subscription', subscription_id: sub.subscription_id }).expect(201);
    expect((await request(server).get('/business/plans').set(e.auth).expect(200)).body.business).toMatchObject({ active: true, cancelAtPeriodEnd: true });
    expect(await open(id)).toBe(true);

    // The renewal fails and the provider puts the subscription on hold: after the grace period the listing lapses; nothing is deleted.
    sub.status = 'on_hold';
    await deliver('subscription.on_hold', { payload_type: 'Subscription', subscription_id: sub.subscription_id }).expect(201);
    expect((await request(server).get('/business/plans').set(e.auth).expect(200)).body.business.active).toBe(false);
    await plans.sweep();
    expect(await prisma.vacancy.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'EXPIRED', expiryReason: 'SUBSCRIPTION_LAPSED' });
    expect(await open(id)).toBe(false);
    expect(await prisma.application.count({ where: { vacancyId: id } })).toBe(1);
    await request(server).get('/business/applications').set(e.auth).expect(200);
    // New Business publications are refused while lapsed (and fall to trial/credit rules).
    const another = await approved(e);
    const outcome = await publish(e, another);
    expect(outcome.body.publicationPlan === 'BUSINESS').toBe(false);

    // Reactivation restores only what lapsed because of the subscription, and only inside its own deadline.
    sub.status = 'active'; sub.cancel_at_next_billing_date = false; sub.next_billing_date = new Date(Date.now() + 30 * DAY).toISOString();
    await deliver('subscription.active', { payload_type: 'Subscription', subscription_id: sub.subscription_id }).expect(201);
    const swept = await plans.sweep();
    expect(swept.restored).toBeGreaterThanOrEqual(1);
    expect(await prisma.vacancy.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'ACTIVE', expiryReason: null });
    expect(await open(id)).toBe(true);
  });

  it('ignores a late event from an older subscription and an event for an unknown company', async () => {
    const e = await employer('stale');
    const newer = businessSub(e.company.id);
    await deliver('subscription.active', { payload_type: 'Subscription', subscription_id: newer.subscription_id }).expect(201);
    const older = businessSub(e.company.id, { status: 'cancelled' });
    await deliver('subscription.cancelled', { payload_type: 'Subscription', subscription_id: older.subscription_id }).expect(201);
    const row = await prisma.employerSubscription.findUniqueOrThrow({ where: { companyId: e.company.id } });
    expect(row).toMatchObject({ status: 'active', dodoSubscriptionId: newer.subscription_id });

    const ghost = businessSub('company-that-does-not-exist');
    await deliver('subscription.active', { payload_type: 'Subscription', subscription_id: ghost.subscription_id }).expect(201);
    expect(await prisma.employerSubscription.count({ where: { dodoSubscriptionId: ghost.subscription_id } })).toBe(0);
  });

  // ───────────────────────────────────────────────────────────── moderation and company state
  it('removes a moderated-out listing from public view, keeps its applications, and lets the employer fix and resubmit', async () => {
    const e = await employer('moderate');
    const v = await draft(e);
    await submit(e, v.id).expect(200);
    const rej = await reject(v.id, 'Təsvir kifayət qədər aydın deyil').expect(200);
    expect(rej.body).toMatchObject({ status: 'REJECTED', moderationNote: 'Təsvir kifayət qədər aydın deyil' });
    await publish(e, v.id).expect(409);
    expect(await prisma.employerTrial.count({ where: { companyId: e.company.id } })).toBe(0); // nothing was spent

    await submit(e, v.id).expect(200); // fixed and resubmitted
    await approve(v.id).expect(200);
    await publish(e, v.id).expect(200);
    const cand = await candidate('moderated');
    await request(server).post(`/vacancies/${v.id}/apply`).set(cand.auth).send({}).expect(201);

    // The operator takes a published listing down: it disappears, applications remain, and no money is silently returned or re-spent.
    await reject(v.id, 'Şikayət əsasında').expect(200);
    expect(await open(v.id)).toBe(false);
    await request(server).get(`/vacancies/${v.id}`).expect(404);
    expect(await prisma.application.count({ where: { vacancyId: v.id } })).toBe(1);
    await request(server).post(`/vacancies/${v.id}/apply`).set((await candidate('after')).auth).send({}).expect(400);
  });

  it('sends an approved vacancy back to draft when its text is changed, so approval always covers the reviewed text', async () => {
    const e = await employer('edit');
    const id = await approved(e);
    await request(server).patch(`/business/vacancies/${id}`).set(e.auth).send({ description: 'Tamam başqa və yoxlanılmamış mətn burada yazılıb, sonradan dəyişdirilib.' }).expect(200);
    expect((await prisma.vacancy.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT');
    await publish(e, id).expect(409);
  });

  it('refuses everything for a suspended or unapproved company and takes its listings off public view', async () => {
    const e = await employer('suspend');
    const id = await approved(e);
    await publish(e, id).expect(200);
    expect(await open(id)).toBe(true);
    const next = await draft(e);

    await prisma.company.update({ where: { id: e.company.id }, data: { status: 'SUSPENDED' } });
    expect(await open(id)).toBe(false);
    await request(server).post('/business/plans/checkout/single').set(e.auth).send({ idempotencyKey: `key-${stamp}-susp-abcdef` }).expect(403);
    await request(server).post('/business/plans/checkout/business').set(e.auth).expect(403);
    await submit(e, next.id).expect(403);
    await request(server).post('/business/vacancies').set(e.auth).send({ title: 'Yeni', description: 'x'.repeat(80) }).expect(403);
    expect(await open(id)).toBe(false);

    // Reinstating the company restores the same listing, within its period.
    await prisma.company.update({ where: { id: e.company.id }, data: { status: 'APPROVED' } });
    expect(await open(id)).toBe(true);
  });

  it('isolates companies: another employer can neither publish, extend nor reconfirm a listing it does not own', async () => {
    const a = await employer('iso-a');
    const b = await employer('iso-b');
    const id = await approved(a);
    await publish(b, id).expect(404);
    await request(server).post(`/business/plans/vacancies/${id}/extend`).set(b.auth).expect(404);
    await request(server).post(`/business/plans/vacancies/${id}/reconfirm`).set(b.auth).expect(404);
    await submit(b, id).expect(404);
    // And nobody without a business session reaches any of it.
    await request(server).get('/business/plans').expect(401);
    await request(server).post('/business/plans/checkout/business').expect(401);
  });

  it('keeps candidate subscriptions and employer plans apart', async () => {
    const e = await employer('apart');
    const cand = await candidate('apart');
    const sub = businessSub(e.company.id, { metadata: { aise: 'employer', kind: 'BUSINESS_MONTHLY', companyId: e.company.id, userId: cand.user.id } });
    await deliver('subscription.active', { payload_type: 'Subscription', subscription_id: sub.subscription_id }).expect(201);
    const plan = await prisma.subscription.findUniqueOrThrow({ where: { userId: cand.user.id } });
    expect(plan.plan).toBe('FREE');
    expect(await prisma.employerSubscription.count({ where: { companyId: e.company.id } })).toBe(1);
  });
});
