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
import { EmailService } from '../src/common/email.service';
import { AuthModule } from '../src/auth/auth.module';
import { BillingModule } from '../src/billing/billing.module';
import { JobsModule } from '../src/jobs/jobs.module';
import { SavedModule } from '../src/saved/saved.module';
import { AlertsModule } from '../src/alerts/alerts.module';
import { CompaniesModule } from '../src/companies/companies.module';
import { NotificationsModule } from '../src/notifications/notifications.module';
import { AlertsService } from '../src/alerts/alerts.service';
import { PreferencesService } from '../src/alerts/preferences.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { JobCatalogueService } from '../src/jobs/job-catalogue.service';
import { rowMatchesCriteria } from '../src/alerts/criteria-match';
import { normalizeSearchCriteria } from '../src/saved/search-criteria';

// New-job alerts and notification preferences over the real routes, services and the isolated aise_phase2_test database. The e-mail transport is a
// local capture (no message leaves this machine). Synthetic data only.
const stamp = `${Date.now()}`;
const prefix = `aise-alerts-${stamp}`;
const mail = (who: string) => `aise-alerts-${who}-${stamp}@example.com`;

class CaptureEmail {
  sent: { to: string; subject: string; html: string }[] = [];
  failFor = new Set<string>();
  async send(to: string, subject: string, html: string) {
    if (this.failFor.has(to)) throw Object.assign(new Error('provider down'), { code: 'provider_error' });
    this.sent.push({ to, subject, html });
    return { id: `cap_${this.sent.length}`, mock: true };
  }
  to(email: string) { return this.sent.filter((m) => m.to === email); }
  getCapturedEmails() { return []; }
}

describe('new-job alerts, preferences and unsubscribe (isolated synthetic data)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  let alerts: AlertsService;
  let prefs: PreferencesService;
  let notifications: NotificationsService;
  let catalogue: JobCatalogueService;
  const mailer = new CaptureEmail();
  const env = { ...process.env };

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Refusing to run outside the isolated local aise_phase2_test');
    process.env.DATABASE_URL = db.toString();
    Object.assign(process.env, { NODE_ENV: 'test', RESEND_API_KEY: 're_mock_key', MATCHING_SERVICE_URL: 'http://127.0.0.1:9', APPLY_WORKER_URL: 'http://127.0.0.1:9', DODO_PAYMENTS_API_KEY: '', FRONTEND_URL: 'https://app.invalid', API_PUBLIC_URL: 'https://api.invalid',
      NOTIFICATION_LINK_SECRET: 'synthetic-notification-link-secret-0123456789abcdef', SCRAPER_SERVICE_TOKEN: 'synthetic-scraper-token-0123456789' });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, EmailModule, AuthModule, BillingModule, JobsModule, SavedModule, AlertsModule, NotificationsModule, CompaniesModule,
    ] }).overrideProvider(EmailService).useValue(mailer).compile();
    app = module.createNestApplication({ logger: ['error'], bodyParser: false });
    app.use(express.json());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService); alerts = app.get(AlertsService); prefs = app.get(PreferencesService); notifications = app.get(NotificationsService); catalogue = app.get(JobCatalogueService);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `alerts-${stamp}` } } });
      await prisma.business.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
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
    return { u, email: u.email, auth: { Authorization: `Bearer ${token}` } };
  }
  let n = 0;
  async function job(extra: Record<string, unknown> = {}) {
    const i = ++n;
    return prisma.job.create({ data: { externalId: `alerts-${stamp}-${i}`, title: `Mühasib ${stamp}-${i}`, company: 'Alfa Bank ASC', description: 'x', location: 'Bakı', url: `https://example.invalid/${stamp}/a${i}`, postedAt: new Date(), companyKey: 'alfa bank', ...extra } as any });
  }
  const search = (auth: any, criteria: any) => request(server).post('/saved-searches').set(auth).send({ criteria }).expect(201);
  const pendingFor = (userId: string, frequency?: string) => prisma.alertDelivery.findMany({ where: { channel: 'EMAIL', status: 'PENDING', event: { userId }, ...(frequency ? { frequency: frequency as any } : {}) } });

  it('defaults reproduce today, preferences are validated, and Free cannot enable instant alerts', async () => {
    const a = await user('prefs');
    const view = (await request(server).get('/notification-preferences').set(a.auth).expect(200)).body;
    expect(view).toMatchObject({ matchInApp: true, matchEmail: true, newJobInApp: true, newJobEmail: 'DAILY', emailEnabled: true, quietStartMinute: null, instant: { available: false, dailyLimit: 0 } });
    await request(server).get('/notification-preferences').expect(401);
    for (const bad of [{ newJobEmail: 'HOURLY' }, { matchEmail: 'yes' }, { instantDailyCap: 0 }, { instantDailyCap: 99 }, { quietStartMinute: 60 }, { quietStartMinute: 60, quietEndMinute: 60 }, { quietStartMinute: 1500, quietEndMinute: 10 }, { pausedUntil: 'tomorrow' }, { pausedUntil: new Date(Date.now() + 200 * 86_400_000).toISOString() }]) {
      await request(server).put('/notification-preferences').set(a.auth).send(bad).expect(400);
    }
    await request(server).put('/notification-preferences').set(a.auth).send({ newJobEmail: 'INSTANT' }).expect(400); // not in the Free plan
    const ok = (await request(server).put('/notification-preferences').set(a.auth).send({ matchEmail: false, quietStartMinute: 1320, quietEndMinute: 420, newJobEmail: 'OFF' }).expect(200)).body;
    expect(ok).toMatchObject({ matchEmail: false, quietStartMinute: 1320, quietEndMinute: 420, newJobEmail: 'OFF' });
    const p = await user('prefs-prem', 'PREMIUM');
    expect((await request(server).get('/notification-preferences').set(p.auth)).body.instant).toEqual({ available: true, dailyLimit: 10 });
    await request(server).put('/notification-preferences').set(p.auth).send({ newJobEmail: 'INSTANT', instantDailyCap: 3 }).expect(200);
  });

  it('creates one alert per user and posting across overlapping searches, follows, retries and duplicate postings', async () => {
    const a = await user('fan-a');
    const b = await user('fan-b'); // nothing saved: must receive nothing
    await search(a.auth, { q: 'mühasib' });
    await search(a.auth, { location: 'Bakı' }); // overlapping second search
    await request(server).put('/company-follows').set(a.auth).send({ company: 'Alfa Bank' }).expect(200); // and a follow of the same company
    const j = await job();
    const first = await alerts.fanOutNewJob(j.id);
    expect(first.created).toBe(1);
    expect((await alerts.fanOutNewJob(j.id)).created).toBe(0); // a retry of the same fan-out
    expect(await prisma.alertEvent.count({ where: { userId: a.u.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: a.u.id, type: 'NEW_JOB' } })).toBe(1);
    expect(await prisma.alertEvent.count({ where: { userId: b.u.id } })).toBe(0);
    const reasons = (await prisma.alertEvent.findFirstOrThrow({ where: { userId: a.u.id } })).reasons as any;
    expect(reasons.searchIds).toHaveLength(2);
    expect(reasons.companyKey).toBe('alfa bank');
    // The same posting from a second source is linked as a duplicate and is not open in the catalogue: nothing more is announced.
    const dup = await job({ duplicateOfId: j.id, title: j.title });
    expect((await alerts.fanOutNewJob(dup.id)).created).toBe(0);
    expect(await prisma.alertEvent.count({ where: { userId: a.u.id } })).toBe(1);
    // Closed, hidden and expired postings are never announced.
    for (const extra of [{ status: 'CLOSED' }, { hiddenAt: new Date() }, { deadline: new Date(Date.now() - 86_400_000) }]) {
      expect((await alerts.fanOutNewJob((await job(extra)).id)).created).toBe(0);
    }
    // A posting that does not match the criteria does not alert.
    const other = await job({ title: 'Aşpaz', location: 'Gəncə', company: 'Zeta MMC', companyKey: 'zeta' });
    expect((await alerts.fanOutNewJob(other.id)).created).toBe(0);
  });

  it('honours the in-app and e-mail preferences at fan-out, and an unsubscribed account gets no e-mail delivery', async () => {
    const a = await user('fan-pref');
    await search(a.auth, { q: 'mühasib' });
    await request(server).put('/notification-preferences').set(a.auth).send({ newJobInApp: false, newJobEmail: 'OFF' }).expect(200);
    await alerts.fanOutNewJob((await job()).id);
    expect(await prisma.alertEvent.count({ where: { userId: a.u.id } })).toBe(0); // other users' searches may match too; this user wants nothing
    await request(server).put('/notification-preferences').set(a.auth).send({ newJobInApp: true, emailEnabled: false }).expect(200);
    await alerts.fanOutNewJob((await job()).id);
    expect(await prisma.alertEvent.count({ where: { userId: a.u.id } })).toBe(1);
    expect(await pendingFor(a.u.id)).toHaveLength(0);
    expect(await prisma.notification.count({ where: { userId: a.u.id, type: 'NEW_JOB' } })).toBe(1);
  });

  it('sends one daily digest with an unsubscribe link, exactly once', async () => {
    const a = await user('digest');
    await search(a.auth, { q: 'mühasib' });
    const jobs = [await job(), await job()];
    for (const j of jobs) await alerts.fanOutNewJob(j.id);
    expect(await pendingFor(a.u.id, 'DAILY')).toHaveLength(2);
    mailer.sent.length = 0;
    await alerts.runDailyDigest();
    const mine = mailer.to(a.email);
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toContain('2 yeni vakansiya');
    expect(mine[0].html).toContain('/notifications/unsubscribe?token=');
    expect(mine[0].html).toContain(jobs[0].title);
    expect(mine[0].html).not.toContain('uyğunluq balı:'); // new-job alerts never show a fit score
    expect(await prisma.alertDelivery.count({ where: { channel: 'EMAIL', status: 'SENT', event: { userId: a.u.id } } })).toBe(2);
    await alerts.runDailyDigest();
    expect(mailer.to(a.email)).toHaveLength(1); // a rerun sends nothing new
  });

  it('re-checks everything at dispatch: closed postings, removed subscriptions, unsubscribe, pause and quiet hours', async () => {
    const a = await user('recheck');
    const s = (await search(a.auth, { q: 'mühasib' })).body;
    const j1 = await job(), j2 = await job(), j3 = await job();
    for (const j of [j1, j2, j3]) await alerts.fanOutNewJob(j.id);
    await prisma.job.update({ where: { id: j1.id }, data: { status: 'CLOSED' } }); // closed after the event was created
    mailer.sent.length = 0;
    // Quiet hours (Baku 22:00-07:00): at 23:30 Baku nothing is sent and the work is deferred, not lost.
    await prisma.notificationPreference.upsert({ where: { userId: a.u.id }, create: { userId: a.u.id, quietStartMinute: 1320, quietEndMinute: 420 }, update: { quietStartMinute: 1320, quietEndMinute: 420 } });
    const night = new Date(Date.UTC(2026, 9, 10, 19, 30)); // 23:30 Baku
    const deferred = await alerts.dispatchEmail(a.u.id, 'daily', night);
    expect(deferred.sent).toBe(0);
    expect(deferred.deferredUntil?.toISOString()).toBe(new Date(Date.UTC(2026, 9, 11, 3, 0)).toISOString()); // 07:00 Baku
    expect(await pendingFor(a.u.id)).toHaveLength(3);
    // Paused: skipped with a reason, nothing piles up.
    await prisma.notificationPreference.update({ where: { userId: a.u.id }, data: { quietStartMinute: null, quietEndMinute: null, pausedUntil: new Date(Date.now() + 86_400_000) } });
    await alerts.dispatchEmail(a.u.id, 'daily');
    expect(mailer.to(a.email)).toHaveLength(0);
    expect((await prisma.alertDelivery.findMany({ where: { event: { userId: a.u.id } , channel: 'EMAIL' } })).every((d) => d.status === 'SKIPPED' && d.skipReason === 'paused')).toBe(true);
    // Fresh events: subscription removed before dispatch.
    await prisma.notificationPreference.update({ where: { userId: a.u.id }, data: { pausedUntil: null } });
    const j4 = await job(), j5 = await job();
    await alerts.fanOutNewJob(j4.id); await alerts.fanOutNewJob(j5.id);
    await request(server).delete(`/saved-searches/${s.id}`).set(a.auth).expect(200);
    await alerts.dispatchEmail(a.u.id, 'daily');
    expect(mailer.to(a.email)).toHaveLength(0);
    expect((await prisma.alertDelivery.findMany({ where: { event: { userId: a.u.id, jobId: { in: [j4.id, j5.id] } }, channel: 'EMAIL' } })).every((d) => d.skipReason === 'subscription_removed')).toBe(true);
    // Closed posting with a live subscription: skipped as closed, the open one is sent.
    const s2 = (await search(a.auth, { q: 'mühasib' })).body;
    expect(s2.id).toBeTruthy();
    const j6 = await job(), j7 = await job();
    await alerts.fanOutNewJob(j6.id); await alerts.fanOutNewJob(j7.id);
    await prisma.job.update({ where: { id: j6.id }, data: { status: 'CLOSED' } });
    const r = await alerts.dispatchEmail(a.u.id, 'daily');
    expect(r.sent).toBe(1);
    expect(r.skipped).toBe(1);
    expect(mailer.to(a.email)[0].html).toContain(j7.title);
    expect(mailer.to(a.email)[0].html).not.toContain(j6.title);
  });

  it('isolates transport failures per user, keeps the failed alerts pending and retry-safe, and bounds the retries', async () => {
    const bad = await user('fail-a');
    const good = await user('fail-b');
    for (const x of [bad, good]) await search(x.auth, { q: 'mühasib' });
    const j = await job();
    await alerts.fanOutNewJob(j.id);
    mailer.sent.length = 0;
    mailer.failFor.add(bad.email);
    const result = await alerts.runDailyDigest();
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(mailer.to(good.email)).toHaveLength(1); // another user's failure did not stop this one
    const pending = await pendingFor(bad.u.id);
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(1);
    mailer.failFor.delete(bad.email);
    await alerts.runDailyDigest(); // the retry sends it, once
    expect(mailer.to(bad.email)).toHaveLength(1);
    expect(await pendingFor(bad.u.id)).toHaveLength(0);
    // Permanent failure becomes FAILED after the bounded number of attempts.
    const worse = await user('fail-c');
    await search(worse.auth, { q: 'mühasib' });
    await alerts.fanOutNewJob((await job()).id);
    mailer.failFor.add(worse.email);
    for (let i = 0; i < 6; i++) await alerts.dispatchEmail(worse.u.id, 'daily').catch(() => undefined);
    expect((await prisma.alertDelivery.findMany({ where: { event: { userId: worse.u.id }, channel: 'EMAIL' } })).map((d) => d.status)).toEqual(['FAILED']);
    mailer.failFor.clear();
  });

  it('keeps instant alerts bounded by the plan and the user cap, folding the rest into the daily digest', async () => {
    const p = await user('instant', 'PREMIUM');
    await search(p.auth, { q: 'mühasib' });
    await request(server).put('/notification-preferences').set(p.auth).send({ newJobEmail: 'INSTANT', instantDailyCap: 2 }).expect(200);
    const js = [await job(), await job(), await job(), await job()];
    for (const j of js) await alerts.fanOutNewJob(j.id);
    expect(await pendingFor(p.u.id, 'INSTANT')).toHaveLength(4);
    mailer.sent.length = 0;
    const first = await alerts.dispatchEmail(p.u.id, 'instant');
    expect(first.sent).toBe(2); // the cap
    expect(await pendingFor(p.u.id, 'DAILY')).toHaveLength(2); // the rest waits for the digest
    expect((await alerts.dispatchEmail(p.u.id, 'instant')).sent).toBe(0); // allowance used up today
    await alerts.runDailyDigest();
    expect(mailer.to(p.email).map((m) => m.subject).length).toBe(2); // one instant e-mail, one digest
    expect(await pendingFor(p.u.id)).toHaveLength(0);
    // A downgrade removes the instant right: pending instant alerts join the digest instead of being lost.
    const q = await user('instant-down', 'PREMIUM');
    await search(q.auth, { q: 'mühasib' });
    await request(server).put('/notification-preferences').set(q.auth).send({ newJobEmail: 'INSTANT' }).expect(200);
    await alerts.fanOutNewJob((await job()).id);
    await prisma.subscription.update({ where: { userId: q.u.id }, data: { plan: 'FREE' } });
    expect((await alerts.dispatchEmail(q.u.id, 'instant')).sent).toBe(0);
    expect(await pendingFor(q.u.id, 'DAILY')).toHaveLength(1);
  });

  it('unsubscribes with a signed link, rejects forged ones, and is idempotent (also one-click and for deleted accounts)', async () => {
    const a = await user('unsub');
    const token = prefs.unsubscribeToken(a.u.id)!;
    await request(server).get('/notifications/unsubscribe').query({ token: `${token}x` }).expect(400);
    await request(server).get('/notifications/unsubscribe').query({ token: 'garbage' }).expect(400);
    const other = await user('unsub-other');
    const forged = `${Buffer.from(other.u.id).toString('base64url')}.${token.split('.')[1]}`; // another user's id with this user's signature
    await request(server).get('/notifications/unsubscribe').query({ token: forged }).expect(400);
    expect((await prefs.get(other.u.id)).emailEnabled).toBe(true);
    await request(server).get('/notifications/unsubscribe').query({ token }).expect(200, { unsubscribed: true });
    await request(server).post('/notifications/unsubscribe').query({ token }).expect(200, { unsubscribed: true });
    expect((await prefs.get(a.u.id)).emailEnabled).toBe(false);
    expect((await request(server).get('/notification-preferences').set(a.auth)).body.emailEnabled).toBe(false);
    await prisma.user.delete({ where: { id: a.u.id } });
    await request(server).get('/notifications/unsubscribe').query({ token }).expect(200); // deleted account: same answer, nothing revealed
  });

  it('keeps match events separate from new-job alerts and applies the same preferences to match e-mail', async () => {
    const a = await user('match');
    const j = await job();
    const m = await prisma.match.create({ data: { userId: a.u.id, jobId: j.id, score: 0.9, details: {} as any } });
    mailer.sent.length = 0;
    await notifications.sendMatchEmailDigest(a.u.id);
    expect(mailer.to(a.email)).toHaveLength(1); // default preferences = today's behaviour
    expect(mailer.to(a.email)[0].html).toContain('/notifications/unsubscribe?token=');
    await prisma.match.update({ where: { id: m.id }, data: { notifiedAt: null } });
    await prisma.notificationPreference.upsert({ where: { userId: a.u.id }, create: { userId: a.u.id, matchEmail: false }, update: { matchEmail: false } });
    await notifications.sendMatchEmailDigest(a.u.id);
    expect(mailer.to(a.email)).toHaveLength(1); // switched off: nothing new
    await prisma.notificationPreference.update({ where: { userId: a.u.id }, data: { matchEmail: true, matchInApp: false } });
    await notifications.handleMatchCreated(m.id, a.u.id);
    expect(await prisma.notification.count({ where: { userId: a.u.id, type: 'NEW_MATCH' } })).toBe(0); // in-app off
    expect(await prisma.notification.count({ where: { userId: a.u.id, type: 'NEW_JOB' } })).toBe(0); // and a match is never a new-job alert
    await prisma.notificationPreference.update({ where: { userId: a.u.id }, data: { quietStartMinute: 0, quietEndMinute: 1439 } }); // quiet nearly all day
    await prisma.match.update({ where: { id: m.id }, data: { notifiedAt: null } });
    const before = mailer.to(a.email).length;
    await notifications.sendMatchEmailDigest(a.u.id, new Date(Date.UTC(2026, 9, 10, 10, 0)));
    expect(mailer.to(a.email).length).toBe(before); // deferred inside quiet hours
  });

  it('matches saved-search criteria exactly like the catalogue listing does (parity with the SQL filters)', async () => {
    const rows = [
      await job({ title: `Paritet Mühasib ${stamp}`, company: 'Paritet Bank ASC', location: 'Bakı, Azərbaycan', companyKey: 'paritet bank' }),
      await job({ title: `Paritet Aşpaz ${stamp}`, company: 'Paritet Food MMC', location: 'Gəncə', companyKey: 'paritet food' }),
      await job({ title: `Paritet İnженер ${stamp}`, company: 'Paritet Bank ASC', location: 'Baku', companyKey: 'paritet bank' }),
    ];
    const criteriaSets = [{ q: `paritet mühasib ${stamp}` }, { q: 'PARITET', location: 'baku' }, { q: `paritet ${stamp}`, location: 'gence' }, { q: 'paritet', company: 'paritet bank asc' }, { q: 'paritet', source: 'nope' }, { q: 'paritet', work: 'unknown' }];
    for (const raw of criteriaSets) {
      let criteria;
      try { criteria = normalizeSearchCriteria(raw); } catch { continue; } // an unknown source is rejected up front
      const listed = await catalogue.list({ ...(criteria as Record<string, string>), limit: '50' });
      const ids = new Set((listed.data as { id: string }[]).map((r) => r.id));
      for (const r of rows) {
        const item = await catalogue.openItem('imported', r.id);
        expect({ criteria: raw, id: r.title, match: item ? rowMatchesCriteria(item, criteria) : false }).toEqual({ criteria: raw, id: r.title, match: ids.has(r.id) });
      }
    }
  });


  it('announces employer vacancies by stable company id (never by name), by saved search, once, and re-checks them at dispatch', async () => {
    const mkCompany = async (name: string, status: 'APPROVED' | 'PENDING' = 'APPROVED') => {
      const biz = await prisma.business.create({ data: { email: mail(`biz${++n}`), hashedPassword: 'x', emailVerified: new Date() } });
      return prisma.company.create({ data: { businessId: biz.id, name, status } });
    };
    const mkVacancy = (companyId: string, extra: Record<string, unknown> = {}) => prisma.vacancy.create({ data: { companyId, title: `Native Mühasib ${stamp}-${++n}`, status: 'ACTIVE', location: 'Bakı', ...extra } as any });
    const a = await user('native-a');
    const b = await user('native-b');
    const c = await user('native-c');
    const alfa = await mkCompany('Eyni Ad MMC');
    const twin = await mkCompany('Eyni Ad MMC'); // a different employer with the same name
    await request(server).put('/company-follows').set(a.auth).send({ companyId: alfa.id }).expect(200); // follows employer ALFA by id
    await request(server).put('/company-follows').set(b.auth).send({ companyId: twin.id }).expect(200); // follows the other employer
    await search(c.auth, { q: 'native mühasib', location: 'Bakı' }); // a saved search
    const v = await mkVacancy(alfa.id);
    await alerts.fanOutNewVacancy(v.id); // other users' searches from earlier tests may match too; this test looks at its own three users
    expect(await prisma.alertEvent.count({ where: { userId: a.u.id, vacancyId: v.id } })).toBe(1);
    expect(await prisma.alertEvent.count({ where: { userId: b.u.id } })).toBe(0);
    expect(await prisma.alertEvent.count({ where: { userId: c.u.id, vacancyId: v.id } })).toBe(1);
    await alerts.fanOutNewVacancy(v.id); // retry: no repeat
    expect(await prisma.alertEvent.count({ where: { userId: a.u.id, vacancyId: v.id } })).toBe(1);
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: a.u.id, type: 'NEW_JOB' } });
    expect((note.payload as any).ref).toBe(`native:${v.id}`);
    // Not announced: paused, expired, and a vacancy of an unapproved employer.
    for (const extra of [{ status: 'PAUSED' }, { deadline: new Date(Date.now() - 86_400_000) }]) {
      await alerts.fanOutNewVacancy((await mkVacancy(alfa.id, extra)).id);
    }
    await alerts.fanOutNewVacancy((await mkVacancy((await mkCompany('Pending MMC', 'PENDING')).id)).id);
    expect(await prisma.alertEvent.count({ where: { userId: a.u.id } })).toBe(1); // none of those announced
    // Dispatch: the e-mail links the native page, and a vacancy paused after the event is skipped, not sent.
    mailer.sent.length = 0;
    await alerts.runDailyDigest();
    expect(mailer.to(a.email)).toHaveLength(1);
    expect(mailer.to(a.email)[0].html).toContain(`/jobs/native/${v.id}`);
    const v2 = await mkVacancy(alfa.id);
    await alerts.fanOutNewVacancy(v2.id);
    await prisma.vacancy.update({ where: { id: v2.id }, data: { status: 'PAUSED' } });
    mailer.sent.length = 0;
    await alerts.runDailyDigest();
    expect(mailer.to(a.email)).toHaveLength(0);
    expect((await prisma.alertDelivery.findFirstOrThrow({ where: { channel: 'EMAIL', event: { userId: a.u.id, vacancyId: v2.id } } })).skipReason).toBe('posting_closed');
  });

  it('counts only open vacancies for a company and returns an authoritative application count to its owner', async () => {
    const biz = await prisma.business.create({ data: { email: mail(`biz${++n}`), hashedPassword: 'x', emailVerified: new Date() } });
    const company = await prisma.company.create({ data: { businessId: biz.id, name: `Count Co ${stamp}`, status: 'APPROVED' } });
    await prisma.vacancy.create({ data: { companyId: company.id, title: 'Open', status: 'ACTIVE' } });
    await prisma.vacancy.create({ data: { companyId: company.id, title: 'Expired', status: 'ACTIVE', deadline: new Date(Date.now() - 86_400_000) } });
    await prisma.vacancy.create({ data: { companyId: company.id, title: 'Paused', status: 'PAUSED' } });
    const list = await (app.get(require('../src/companies/companies.service').CompaniesService) as any).findAllApproved();
    expect(list.find((x: any) => x.id === company.id)._count.vacancies).toBe(1);
    const one = await (app.get(require('../src/companies/companies.service').CompaniesService) as any).findOneApproved(company.id);
    expect(one.vacancies.map((x: any) => x.title)).toEqual(['Open']);
  });

  it('removes preferences, events and deliveries with the account', async () => {
    const a = await user('gone');
    await search(a.auth, { q: 'mühasib' });
    await request(server).put('/notification-preferences').set(a.auth).send({ matchEmail: false }).expect(200);
    await alerts.fanOutNewJob((await job()).id);
    expect(await prisma.alertEvent.count({ where: { userId: a.u.id } })).toBe(1);
    await prisma.user.delete({ where: { id: a.u.id } });
    expect(await prisma.alertEvent.count({ where: { userId: a.u.id } })).toBe(0);
    expect(await prisma.alertDelivery.count({ where: { event: { userId: a.u.id } } })).toBe(0);
    expect(await prisma.notificationPreference.count({ where: { userId: a.u.id } })).toBe(0);
  });
});
