import { TestLeases } from './support/source-lease';
import request from 'supertest';
import { randomBytes } from 'crypto';
import { startPhase2App } from './support/phase2-local-app';
import { AlertsService } from '../src/alerts/alerts.service';

// One authenticated candidate journey through the supported HTTP routes and the REAL queues and workers (isolated aise_phase2_test database,
// capture e-mail transport, fixture matching scorer): register -> verify -> login -> entitlements -> saved search / follow / saved job ->
// a new posting arrives through the real ingestion route -> in-app alert -> digest e-mail with unsubscribe -> unsubscribe -> no more e-mail.
// Nothing leaves this machine; no real e-mail, Telegram or payment exists here.
const stamp = `${Date.now()}`;
const email = `aise-journey-${stamp}@example.com`;
const password = 'Synthetic-Journey-Pass-1';
const TOKEN = `journey-ingest-token-${randomBytes(8).toString('hex')}`;

describe('retention journey over the real API, queues and workers (synthetic data)', () => {
  let env: Awaited<ReturnType<typeof startPhase2App>>;
  let server: any;
  let leases: TestLeases;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ['SCRAPER_SERVICE_TOKEN', 'NOTIFICATION_LINK_SECRET', 'API_PUBLIC_URL', 'TELEGRAM_ENABLED']) saved[k] = process.env[k];
    process.env.SCRAPER_SERVICE_TOKEN = TOKEN;
    process.env.NOTIFICATION_LINK_SECRET = 'synthetic-journey-link-secret-0123456789abcdef';
    process.env.API_PUBLIC_URL = 'https://api.invalid';
    delete process.env.TELEGRAM_ENABLED;
    env = await startPhase2App({ native: true, retention: true });
    server = env.app.getHttpServer();
    leases = new TestLeases(env.prisma);
    await leases.take('hellojob');
  }, 90_000);

  afterAll(async () => {
    await leases?.releaseAll();
    await env.prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    await env.prisma.job.deleteMany({ where: { externalId: { startsWith: `hellojob:journey-${stamp}` } } });
    await env.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }, 60_000);

  const ingest = (n: number, extra: Record<string, unknown> = {}) => request(server).post('/internal/jobs/ingest').set('Authorization', `Bearer ${TOKEN}`).set('x-source-lease', leases.of('hellojob')).send({
    externalId: `hellojob:journey-${stamp}-${n}`, title: `Mühasib journey ${stamp} ${n}`, company: 'Journey Bank ASC', description: 'Mühasibat uçotu, 1C.', location: 'Bakı',
    url: `https://hellojob.az/journey-${stamp}-${n}`, postedAt: new Date().toISOString(), ...extra,
  });
  async function until<T>(fn: () => Promise<T | undefined | false>, ms = 20_000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() > end) throw new Error('timed out waiting for the queue'); await new Promise((r) => setTimeout(r, 150)); }
  }

  it('walks the whole journey', async () => {
    // ── account ──
    await request(server).post('/auth/register').send({ email, password }).expect(201);
    const mail = env.emails.getCapturedEmails().filter((m) => m.to === email).at(-1)!;
    const token = new URL(/href="([^"]+verify-email[^"]+)"/.exec(mail.html)![1]).searchParams.get('token')!;
    await request(server).post('/auth/verify-email').send({ token }).expect(201);
    const login = await request(server).post('/auth/login').send({ email, password }).expect(201);
    const auth = { Authorization: `Bearer ${login.body.sessionToken}` };
    const user = await env.prisma.user.findUniqueOrThrow({ where: { email } });

    // ── product: Free entitlements and honest catalogue ──
    const ent = (await request(server).get('/billing/entitlements').set(auth).expect(200)).body;
    expect(ent).toMatchObject({ plan: 'FREE', offer: 'free' });
    expect(ent.features['saved.searches'].limit).toBe(3);
    const cat = (await request(server).get('/billing/catalogue').expect(200)).body;
    expect(cat.candidate.offers.find((o: any) => o.id === 'premium')).toMatchObject({ price: 15, purchasable: true }); // the approved price; purchasable here only because this harness runs the provider in local mock mode
    expect(cat.positioning.cvPreview.az).toContain('Harvard CV şablonu əsasında hazırlanmış');

    // ── saved items ──
    const first = await ingest(1);
    expect(first.status).toBe(201);
    const listed = (await request(server).get('/jobs').query({ q: `journey ${stamp} 1` }).expect(200)).body.data;
    expect(listed).toHaveLength(1);
    await request(server).put(`/saved-jobs/imported:${listed[0].id}`).set(auth).expect(200);
    const search = (await request(server).post('/saved-searches').set(auth).send({ criteria: { q: `Mühasib journey ${stamp}`, location: 'Bakı' } }).expect(201)).body;
    await request(server).put('/company-follows').set(auth).send({ company: 'Journey Bank' }).expect(200);
    expect((await request(server).get('/saved-jobs').set(auth)).body[0]).toMatchObject({ state: 'open' });
    const prefs = (await request(server).get('/notification-preferences').set(auth).expect(200)).body;
    expect(prefs).toMatchObject({ newJobInApp: true, newJobEmail: 'DAILY', emailEnabled: true });

    // ── a new posting arrives through the real ingestion route; the real workers fan it out ──
    const second = await ingest(2);
    expect(second.status).toBe(201);
    const note = await until(async () => (await request(server).get('/notifications').set(auth)).body.find((n: any) => n.type === 'NEW_JOB'));
    expect(note.message).toContain(`journey ${stamp} 2`);
    expect(note.payload.searchIds).toContain(search.id);
    expect(note.payload.followed).toBe(true); // the search and the follow both hit: still one notification
    await ingest(2, { description: 'Mühasibat uçotu, 1C. Yenilənmiş mətn.' }).expect(201); // an update of the same posting
    await env.settle();
    expect((await request(server).get('/notifications').set(auth)).body.filter((n: any) => n.type === 'NEW_JOB')).toHaveLength(1);
    expect(await env.prisma.alertEvent.count({ where: { userId: user.id } })).toBe(1);

    // ── daily digest by e-mail (capture transport), once ──
    const alerts = env.app.get(AlertsService);
    const sentBefore = env.emails.getCapturedEmails().length;
    await alerts.runDailyDigest();
    const digest = env.emails.getCapturedEmails().slice(sentBefore).filter((m) => m.to === email);
    expect(digest).toHaveLength(1);
    expect(digest[0].html).toContain(`journey ${stamp} 2`);
    expect(digest[0].html).not.toContain('uyğunluq balı:');
    const link = new URL(/href="([^"]+unsubscribe[^"]+)"/.exec(digest[0].html)![1].replace(/&amp;/g, '&'));
    await alerts.runDailyDigest();
    expect(env.emails.getCapturedEmails().slice(sentBefore).filter((m) => m.to === email)).toHaveLength(1);

    // ── the timeline and Telegram are reachable and honest ──
    expect((await request(server).get('/applications/timeline').set(auth).expect(200)).body).toEqual([]);
    expect((await request(server).get('/telegram').set(auth).expect(200)).body).toMatchObject({ enabled: false, status: 'NOT_LINKED' });
    await request(server).post('/telegram/link-token').set(auth).expect(503);

    // ── unsubscribe from the e-mail link: no more e-mail, in-app alerts continue ──
    await request(server).get(link.pathname).query({ token: link.searchParams.get('token')! }).expect(200, { unsubscribed: true });
    expect((await request(server).get('/notification-preferences').set(auth)).body.emailEnabled).toBe(false);
    await ingest(3).expect(201);
    await until(async () => (await request(server).get('/notifications').set(auth)).body.filter((n: any) => n.type === 'NEW_JOB').length === 2);
    const mailsBefore = env.emails.getCapturedEmails().length;
    await alerts.runDailyDigest();
    expect(env.emails.getCapturedEmails().length).toBe(mailsBefore);
    expect(await env.prisma.alertDelivery.count({ where: { channel: 'EMAIL', event: { userId: user.id }, status: 'PENDING' } })).toBe(0);

    // ── unsave / unfollow / delete search, then everything goes with the account ──
    await request(server).delete(`/saved-jobs/imported:${listed[0].id}`).set(auth).expect(200);
    await request(server).delete(`/saved-searches/${search.id}`).set(auth).expect(200);
    await env.prisma.user.delete({ where: { id: user.id } });
    for (const model of ['savedJob', 'savedSearch', 'companyFollow', 'alertEvent', 'notificationPreference', 'telegramLink', 'usageCounter'] as const) {
      expect(await (env.prisma as any)[model].count({ where: { userId: user.id } })).toBe(0);
    }
  }, 120_000);
});
