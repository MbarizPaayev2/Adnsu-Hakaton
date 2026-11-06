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
import { TelegramModule } from '../src/telegram/telegram.module';
import { TelegramClient } from '../src/telegram/telegram.client';
import { AlertsService } from '../src/alerts/alerts.service';

// Telegram adapter over the real routes and the isolated aise_phase2_test database. The Telegram API is a local capture: no bot exists and no
// message leaves this machine. Synthetic data only.
const stamp = `${Date.now()}`;
const prefix = `aise-telegram-${stamp}`;
const mail = (who: string) => `aise-telegram-${who}-${stamp}@example.com`;
const SECRET = 'synthetic_webhook_secret_0123456789';

class FakeClient { sent: { chatId: string; text: string }[] = []; fail = false; async sendMessage(chatId: string, text: string) { if (this.fail) throw Object.assign(new Error('x'), { code: 'telegram_500' }); this.sent.push({ chatId, text }); } to(chatId: string) { return this.sent.filter((m) => m.chatId === chatId); } }

describe('Telegram adapter (disabled by default; isolated synthetic data)', () => {
  let app: INestApplication; let server: any; let prisma: PrismaService; let alerts: AlertsService;
  const client = new FakeClient();
  const env = { ...process.env };
  const updateBase = Date.now() * 1000; // unique per run: Telegram update ids are only ever compared with each other
  let updateId = updateBase;
  let chatSeq = 7_000_000_000 + Math.floor(Math.random() * 1_000_000);

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Refusing to run outside the isolated local aise_phase2_test');
    process.env.DATABASE_URL = db.toString();
    Object.assign(process.env, { NODE_ENV: 'test', RESEND_API_KEY: 're_mock_key', MATCHING_SERVICE_URL: 'http://127.0.0.1:9', APPLY_WORKER_URL: 'http://127.0.0.1:9', DODO_PAYMENTS_API_KEY: '', FRONTEND_URL: 'https://app.invalid',
      NOTIFICATION_LINK_SECRET: 'synthetic-notification-link-secret-0123456789abcdef', SCRAPER_SERVICE_TOKEN: 'synthetic-scraper-token-0123456789' });
    delete process.env.TELEGRAM_ENABLED; delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_BOT_USERNAME; delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, EmailModule, AuthModule, BillingModule, JobsModule, SavedModule, AlertsModule, TelegramModule,
    ] }).overrideProvider(TelegramClient).useValue(client).overrideProvider(EmailService).useValue({ send: async () => ({ id: 'x', mock: true }), getCapturedEmails: () => [] }).compile();
    app = module.createNestApplication({ logger: ['error'], bodyParser: false });
    app.use(express.json()); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init(); server = app.getHttpServer(); prisma = app.get(PrismaService); alerts = app.get(AlertsService);
  }, 60_000);

  afterAll(async () => {
    if (prisma) { await prisma.telegramUpdate.deleteMany({ where: { updateId: { gte: BigInt(updateBase) } } }); await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } }); await prisma.job.deleteMany({ where: { externalId: { startsWith: `tg-${stamp}` } } }); }
    await app?.close();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 }); const keys = await redis.keys(`${prefix}:*`); if (keys.length) await redis.del(...keys); await redis.quit();
    process.env = { ...env };
  }, 60_000);

  const enable = () => Object.assign(process.env, { TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: '000000:synthetic-token', TELEGRAM_BOT_USERNAME: 'aise_test_bot', TELEGRAM_WEBHOOK_SECRET: SECRET });
  const disable = () => { delete process.env.TELEGRAM_ENABLED; };
  async function user(who: string, plan: 'FREE' | 'PREMIUM' = 'FREE') {
    const u = await prisma.user.create({ data: { email: mail(who), hashedPassword: await bcrypt.hash('Synthetic-Candidate-1', 4), emailVerified: new Date(), subscription: { create: { plan, status: 'active', currentPeriodEnd: plan === 'FREE' ? null : new Date(Date.now() + 30 * 86_400_000) } } } });
    const token = randomBytes(32).toString('hex'); await prisma.session.create({ data: { sessionToken: token, userId: u.id, expires: new Date(Date.now() + 3_600_000) } });
    return { u, auth: { Authorization: `Bearer ${token}` } };
  }
  const post = (body: unknown, secret: string | null = SECRET) => { const r = request(server).post('/webhooks/telegram'); if (secret !== null) r.set('X-Telegram-Bot-Api-Secret-Token', secret); return r.send(body as object); };
  const msg = (chatId: number | string, text: string | undefined, extra: Record<string, unknown> = {}, chatType = 'private', fromId: number | string = chatId) => ({ update_id: ++updateId, message: { message_id: 1, from: { id: fromId, is_bot: false }, chat: { id: chatId, type: chatType }, ...(text !== undefined ? { text } : {}), ...extra } });
  const tokenOf = (deepLink: string) => deepLink.split('?start=')[1];
  async function link(a: { auth: any }, chat: number) {
    const t = tokenOf((await request(server).post('/telegram/link-token').set(a.auth).expect(200)).body.deepLink);
    const r = await post(msg(chat, `/start ${t}`)).expect(200);
    expect(r.body.ok).toBe(true);
    return t;
  }

  it('is disabled until fully configured: no link token, no webhook, no deliveries, nothing sent', async () => {
    disable();
    const a = await user('off');
    expect((await request(server).get('/telegram').set(a.auth).expect(200)).body).toMatchObject({ enabled: false, status: 'NOT_LINKED' });
    await request(server).post('/telegram/link-token').set(a.auth).expect(503);
    await post(msg(chatSeq++, '/start x')).expect(404);
    await request(server).post('/telegram/link-token').expect(401);
    expect(client.sent).toHaveLength(0);
    // Partially configured is still disabled.
    Object.assign(process.env, { TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'x' });
    await request(server).post('/telegram/link-token').set(a.auth).expect(503);
    delete process.env.TELEGRAM_BOT_TOKEN; disable();
  });

  it('creates a single-use, expiring token stored only as a hash, and rejects a webhook without the secret', async () => {
    enable();
    const a = await user('token');
    const res = (await request(server).post('/telegram/link-token').set(a.auth).expect(200)).body;
    expect(res.deepLink).toMatch(/^https:\/\/t\.me\/aise_test_bot\?start=[A-Za-z0-9_-]{40,}$/);
    const row = await prisma.telegramLink.findUniqueOrThrow({ where: { userId: a.u.id } });
    expect(row.tokenHash).not.toContain(tokenOf(res.deepLink)); // the token itself is never stored
    expect(row.tokenHash).toHaveLength(64);
    expect(row.tokenExpiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    await post(msg(chatSeq++, '/start x'), null).expect(401);
    await post(msg(chatSeq++, '/start x'), 'wrong-secret-value-0123456789').expect(401);
    await post(msg(chatSeq++, '/start x'), SECRET.slice(0, -1)).expect(401);
    expect((await prisma.telegramLink.findUniqueOrThrow({ where: { userId: a.u.id } })).status).toBe('PENDING');
  });

  it('links only from the owner\'s private chat, once, and never across accounts', async () => {
    enable();
    const a = await user('link-a'); const b = await user('link-b');
    const chatA = chatSeq++; const chatB = chatSeq++; client.sent.length = 0;
    const tokenA = tokenOf((await request(server).post('/telegram/link-token').set(a.auth).expect(200)).body.deepLink);
    // Not a private chat / not the sender's own chat / a bot: ignored, the token stays valid.
    await post(msg(chatA, `/start ${tokenA}`, {}, 'group')).expect(200);
    await post(msg(chatA, `/start ${tokenA}`, {}, 'private', 999)).expect(200); // from.id != chat.id
    await post({ update_id: ++updateId, message: { from: { id: chatA, is_bot: true }, chat: { id: chatA, type: 'private' }, text: `/start ${tokenA}` } }).expect(200);
    expect((await prisma.telegramLink.findUniqueOrThrow({ where: { userId: a.u.id } })).status).toBe('PENDING');
    // The owner's private chat links.
    await post(msg(chatA, `/start ${tokenA}`)).expect(200);
    const linked = await prisma.telegramLink.findUniqueOrThrow({ where: { userId: a.u.id } });
    expect(linked).toMatchObject({ status: 'ACTIVE', chatId: String(chatA), tokenHash: null });
    // Single use: the same token from another chat does nothing.
    await post(msg(chatB, `/start ${tokenA}`)).expect(200);
    expect(await prisma.telegramLink.count({ where: { chatId: String(chatB) } })).toBe(0);
    // Account B's fresh token cannot attach the chat that is already bound to account A.
    const tokenB = tokenOf((await request(server).post('/telegram/link-token').set(b.auth).expect(200)).body.deepLink);
    await post(msg(chatA, `/start ${tokenB}`)).expect(200);
    expect((await prisma.telegramLink.findUniqueOrThrow({ where: { userId: b.u.id } })).status).toBe('PENDING');
    expect((await prisma.telegramLink.findUniqueOrThrow({ where: { userId: a.u.id } })).chatId).toBe(String(chatA));
    expect(client.to(String(chatA)).some((m) => m.text.includes('başqa hesaba'))).toBe(true);
    // Expired tokens fail.
    await prisma.telegramLink.update({ where: { userId: b.u.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    await post(msg(chatB, `/start ${tokenB}`)).expect(200);
    expect((await prisma.telegramLink.findUniqueOrThrow({ where: { userId: b.u.id } })).status).toBe('PENDING');
    // A token already linked cannot be created again while linked.
    await request(server).post('/telegram/link-token').set(a.auth).expect(400);
  });

  it('processes each update id once', async () => {
    enable();
    const a = await user('idem'); const chat = chatSeq++;
    const t = tokenOf((await request(server).post('/telegram/link-token').set(a.auth).expect(200)).body.deepLink);
    client.sent.length = 0;
    const update = msg(chat, `/start ${t}`);
    expect((await post(update).expect(200)).body).toEqual({ ok: true });
    expect((await post(update).expect(200)).body).toEqual({ ok: true, duplicate: true });
    expect(client.to(String(chat))).toHaveLength(1);
    expect(await prisma.telegramUpdate.count({ where: { updateId: BigInt(update.update_id) } })).toBe(1);
  });

  it('supports pause, resume, stop and status from the chat and from the account, and frees the chat on disconnect', async () => {
    enable();
    const a = await user('cmds'); const chat = chatSeq++; await link(a, chat); client.sent.length = 0;
    await post(msg(chat, '/pause')).expect(200);
    expect((await request(server).get('/telegram').set(a.auth)).body.status).toBe('PAUSED');
    await post(msg(chat, '/resume')).expect(200);
    expect((await request(server).get('/telegram').set(a.auth)).body.status).toBe('ACTIVE');
    await request(server).post('/telegram/pause').set(a.auth).expect(200);
    await request(server).post('/telegram/pause').set(a.auth).expect(400); // already paused
    await request(server).post('/telegram/resume').set(a.auth).expect(200);
    await post(msg(chat, '/status')).expect(200);
    expect(client.to(String(chat)).at(-1)!.text).toContain('aktivdir');
    await post(msg(chat, '/stop')).expect(200);
    expect(await prisma.telegramLink.findUniqueOrThrow({ where: { userId: a.u.id } })).toMatchObject({ status: 'DISCONNECTED', chatId: null, telegramUserId: null });
    const other = await user('cmds-other'); await link(other, chat); // the freed chat can now be linked to another account, deliberately
    expect((await prisma.telegramLink.findUniqueOrThrow({ where: { userId: other.u.id } })).status).toBe('ACTIVE');
    await request(server).delete('/telegram').set(other.auth).expect(200);
    expect((await request(server).get('/telegram').set(other.auth)).body.status).toBe('DISCONNECTED');
    // Commands from an unlinked chat do nothing.
    const stranger = chatSeq++; client.sent.length = 0;
    await post(msg(stranger, '/pause')).expect(200);
    expect(client.to(String(stranger))[0].text).toContain('bağlı deyil');
  });

  it('never accepts CVs or files: documents, photos and plain text get a fixed reply and nothing is stored', async () => {
    enable();
    const a = await user('files'); const chat = chatSeq++; await link(a, chat); client.sent.length = 0;
    const before = await prisma.resume.count({ where: { userId: a.u.id } });
    await post(msg(chat, undefined, { document: { file_id: 'F', file_name: 'cv.pdf', mime_type: 'application/pdf' } })).expect(200);
    await post(msg(chat, undefined, { photo: [{ file_id: 'P' }] })).expect(200);
    await post(msg(chat, 'here is my CV text')).expect(200);
    expect(client.to(String(chat)).every((m) => m.text.includes('CV və ya fayl qəbul etmir'))).toBe(true);
    expect(client.to(String(chat))).toHaveLength(3);
    expect(await prisma.resume.count({ where: { userId: a.u.id } })).toBe(before);
  });

  it('delivers new-job alerts only to an active, unpaused link, respecting caps and failures, and goes quiet on disconnect', async () => {
    enable();
    const a = await user('deliver', 'PREMIUM'); const chat = chatSeq++; await link(a, chat);
    await request(server).post('/saved-searches').set(a.auth).send({ criteria: { q: 'telegram' } }).expect(201);
    await request(server).put('/notification-preferences').set(a.auth).send({ newJobTelegram: 'DAILY', newJobEmail: 'OFF' }).expect(200);
    const mk = (i: number) => prisma.job.create({ data: { externalId: `tg-${stamp}-${i}`, title: `Telegram vakansiya ${stamp}-${i}`, company: 'Tg MMC', description: 'x', location: 'Bakı', url: `https://example.invalid/${stamp}/tg${i}`, postedAt: new Date(), companyKey: 'tg' } as any });
    const j1 = await mk(1); await alerts.fanOutNewJob(j1.id);
    expect(await prisma.alertDelivery.count({ where: { channel: 'TELEGRAM', status: 'PENDING', event: { userId: a.u.id } } })).toBe(1);
    client.sent.length = 0; client.fail = true;
    const r = await alerts.runDailyDigest();
    expect(r.failed).toBeGreaterThanOrEqual(1); // transport failure is isolated and the alert stays pending
    expect(await prisma.alertDelivery.count({ where: { channel: 'TELEGRAM', status: 'PENDING', event: { userId: a.u.id } } })).toBe(1);
    client.fail = false;
    await alerts.runDailyDigest();
    expect(client.to(String(chat))).toHaveLength(1);
    expect(client.to(String(chat))[0].text).toContain(j1.title);
    expect(client.to(String(chat))[0].text).toContain('/jobs/imported/');
    // A link paused after the alert was created: the pause is re-checked at dispatch, so nothing is sent and the alert is skipped with a reason.
    const j2 = await mk(2); await alerts.fanOutNewJob(j2.id);
    expect(await prisma.alertDelivery.count({ where: { channel: 'TELEGRAM', status: 'PENDING', event: { userId: a.u.id, jobId: j2.id } } })).toBe(1);
    await request(server).post('/telegram/pause').set(a.auth).expect(200);
    client.sent.length = 0; await alerts.runDailyDigest();
    expect(client.to(String(chat))).toHaveLength(0);
    expect((await prisma.alertDelivery.findFirstOrThrow({ where: { channel: 'TELEGRAM', event: { userId: a.u.id, jobId: j2.id } } })).skipReason).toBe('telegram_not_active');
    // While paused, new alerts do not even create a Telegram delivery.
    const j2b = await mk(5); await alerts.fanOutNewJob(j2b.id);
    expect(await prisma.alertDelivery.count({ where: { channel: 'TELEGRAM', event: { userId: a.u.id, jobId: j2b.id } } })).toBe(0);
    // Disconnected: no TELEGRAM delivery is even created.
    await request(server).delete('/telegram').set(a.auth).expect(200);
    const j3 = await mk(3); await alerts.fanOutNewJob(j3.id);
    expect(await prisma.alertDelivery.count({ where: { channel: 'TELEGRAM', event: { userId: a.u.id, jobId: j3.id } } })).toBe(0);
    // And with the adapter off again nothing is created for anyone.
    disable();
    const j4 = await mk(4); await alerts.fanOutNewJob(j4.id);
    expect(await prisma.alertDelivery.count({ where: { channel: 'TELEGRAM', event: { jobId: j4.id } } })).toBe(0);
  });

  it('leaves no active link or token when the account is deleted', async () => {
    enable();
    const a = await user('del'); const chat = chatSeq++; await link(a, chat);
    expect(await prisma.telegramLink.count({ where: { userId: a.u.id, status: 'ACTIVE' } })).toBe(1);
    await prisma.user.delete({ where: { id: a.u.id } });
    expect(await prisma.telegramLink.count({ where: { chatId: String(chat) } })).toBe(0);
    const b = await user('del-b'); await link(b, chat); // the chat is free again
    expect((await prisma.telegramLink.findUniqueOrThrow({ where: { userId: b.u.id } })).status).toBe('ACTIVE');
  });
});
