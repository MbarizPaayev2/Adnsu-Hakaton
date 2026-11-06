import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import IORedis from 'ioredis';
import request from 'supertest';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { randomBytes, randomUUID, createHash } from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { AuthModule } from '../src/auth/auth.module';
import { ResumesModule } from '../src/resumes/resumes.module';
import { UploadsModule } from '../src/uploads/uploads.module';
import { ExternalApplyModule } from '../src/external-apply/external-apply.module';
import { ExternalApplyService } from '../src/external-apply/external-apply.service';
import { LocalStorageService } from '../src/resumes/local-storage.service';
import { ExternalDestination, ExternalDestinationRegistry, GLORRI_DESTINATION } from '../src/external-apply/destinations';
import {
  FixtureAts,
  FIXTURE_DECLARATION,
  FIXTURE_OTP,
  FIXTURE_POLICY_URL,
  FIXTURE_RECEIPT_PATH,
  FIXTURE_RECEIPT_PATTERN,
  FIXTURE_REJECTION_PATTERN,
} from '../../apply-worker/test/support/fixture-ats';

// apps/api + the REAL apply-worker (separate process, real token guard,
// Playwright, headless Chromium) against the local fixture ATS. The fixture
// destination (notice + receipt/rejection contract) is injected into the API
// through DI; the worker's browser routes only jobs.glorri.com to the fixture
// (test entry point apps/apply-worker/test/support/fixture-worker-main.ts).
// Synthetic candidate and documents; isolated local aise_phase2_test.

const stamp = `${Date.now()}`;
const queuePrefix = `aise-realworker-${stamp}`;
const workerToken = randomBytes(16).toString('hex');
const FIXTURE: ExternalDestination = {
  ...GLORRI_DESTINATION,
  notice: { url: FIXTURE_POLICY_URL, version: 'fixture-ats-1', declarationText: FIXTURE_DECLARATION },
  receipt: { textPattern: FIXTURE_RECEIPT_PATTERN, urlPathPattern: FIXTURE_RECEIPT_PATH, rejectionPattern: FIXTURE_REJECTION_PATTERN },
};
class FixtureRegistry extends ExternalDestinationRegistry {
  protected readonly destinations = [FIXTURE];
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const chromeCount = () => {
  try { return Number(execSync("pgrep -c -f 'chrome-linux/chrome' || true").toString().trim()) || 0; } catch { return 0; }
};

jest.setTimeout(120_000);

describe('API + real apply worker + local fixture ATS (isolated synthetic data)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  let storage: LocalStorageService;
  let service: ExternalApplyService;
  const fixture = new FixtureAts();
  let worker: ChildProcess | undefined;
  let workerPort = 0;
  const env = { ...process.env };
  const email = `aise-realworker-${stamp}@example.com`;
  let userId = '';
  let token = '';
  let cvBytes: Buffer;
  let idBytes: Buffer;
  const files: string[] = [];
  let seq = 0;
  const chromeBefore = chromeCount();

  async function freePort() {
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const port = (s.address() as net.AddressInfo).port;
    await new Promise<void>((r) => s.close(() => r()));
    return port;
  }

  async function startWorker() {
    const root = path.resolve(__dirname, '../../apply-worker');
    worker = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/support/fixture-worker-main.ts'], {
      cwd: root,
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', TS_NODE_PROJECT: path.join(root, 'tsconfig.json'),
        PORT: String(workerPort), APPLY_WORKER_TOKEN: workerToken, FIXTURE_ATS_ORIGIN: fixture.origin,
        CHROMIUM_PATH: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
        EXTERNAL_APPLY_LIVE_ENABLED: 'true', EXTERNAL_APPLY_MAX_SESSIONS: '2',
        EXTERNAL_APPLY_ACTION_TIMEOUT_MS: '3000', EXTERNAL_APPLY_SEND_OBSERVE_MS: '6000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker did not start')), 60_000);
      worker!.stdout!.on('data', (d) => { if (String(d).includes('FIXTURE_WORKER_READY')) { clearTimeout(timer); resolve(); } });
      worker!.on('exit', (code) => { clearTimeout(timer); reject(new Error(`worker exited ${code}`)); });
    });
    worker.removeAllListeners('exit');
  }

  async function stopWorker(signal: NodeJS.Signals = 'SIGTERM') {
    if (!worker || worker.exitCode !== null || worker.signalCode) return;
    const exited = new Promise<void>((r) => worker!.once('exit', () => r()));
    worker.kill(signal);
    await exited;
  }

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') {
      throw new Error('Refusing real-worker test outside isolated local aise_phase2_test');
    }
    process.env.DATABASE_URL = db.toString();
    await fixture.start();
    workerPort = await freePort();
    await startWorker();
    Object.assign(process.env, {
      NODE_ENV: 'test', APPLY_WORKER_URL: `http://127.0.0.1:${workerPort}`, APPLY_WORKER_TOKEN: workerToken,
      EXTERNAL_APPLY_LIVE_ENABLED: 'true', EXTERNAL_APPLY_SEND_TIMEOUT_MS: '30000', EXTERNAL_APPLY_DAILY_SEND_LIMIT: '100',
    });
    delete process.env.ENABLE_SANDBOX;

    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      BullModule.forRoot({ prefix: queuePrefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, AuthModule, ResumesModule, UploadsModule, ExternalApplyModule,
    ] }).overrideProvider(ExternalDestinationRegistry).useValue(new FixtureRegistry()).compile();
    app = module.createNestApplication({ logger: ['error'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    storage = app.get(LocalStorageService);
    service = app.get(ExternalApplyService);

    cvBytes = Buffer.from(`%PDF-1.4\nSYNTHETIC CV ${stamp}\n%%EOF\n`);
    idBytes = Buffer.from(`\x89PNG\r\n\x1a\nSYNTHETIC ID ${stamp}`);
    const cvUrl = await storage.uploadBuffer(cvBytes, 'application/pdf');
    const idUrl = await storage.uploadBuffer(idBytes, 'image/png');
    files.push(cvUrl, idUrl);
    const user = await prisma.user.create({ data: {
      email, name: 'Sintetik Namizəd', hashedPassword: 'x', emailVerified: new Date(),
      subscription: { create: { plan: 'Limitsiz', status: 'active' } },
      profile: { create: {
        headline: 'Backend developer', skills: ['Node.js'], location: 'Bakı', jobPreferences: {},
        phone: '+994500000000', address: 'Sintetik küçə 1', citizenship: 'Azərbaycan', dob: new Date('1995-05-05'),
        salaryExpectation: 2000, preferredNetGross: 'Net', preferredCurrency: 'AZN', idDocumentUrl: idUrl,
        defaultCoverLetter: 'Sintetik motivasiya məktubu — bu vəzifə üçün müraciət edirəm.',
      } },
      resumes: { create: { isBase: true, status: 'READY', fileUrl: cvUrl } },
    } });
    userId = user.id;
    token = randomBytes(32).toString('hex');
    await prisma.session.create({ data: { sessionToken: token, userId, expires: new Date(Date.now() + 3_600_000) } });
    process.env.EXTERNAL_APPLY_PILOT_USER_IDS = userId;
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      const rows = await prisma.externalApplication.findMany({ where: { userId } });
      for (const r of rows) for (const u of [r.cvSnapshotUrl, r.idDocumentSnapshotUrl, r.reviewScreenshotUrl]) if (u) files.push(u);
      await prisma.user.deleteMany({ where: { email } });
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `glorri:rw${stamp}-` } } });
      for (const u of files) await storage.deleteFile(u).catch(() => undefined);
    }
    await app?.close();
    await stopWorker();
    await fixture.stop();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${queuePrefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    process.env = { ...env };
    await sleep(500);
    // No Chromium outlives the worker, including after the SIGKILL test.
    expect(chromeCount()).toBeLessThanOrEqual(chromeBefore);
  }, 60_000);

  const auth = { Authorization: '' };
  beforeEach(() => {
    auth.Authorization = `Bearer ${token}`;
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'true';
    process.env.EXTERNAL_APPLY_SEND_TIMEOUT_MS = '30000';
  });

  /** A job whose fixture scenario is chosen by its slug. */
  async function match(scenario: string) {
    seq += 1;
    const slug = `${scenario}-${seq}`;
    const job = await prisma.job.create({ data: {
      externalId: `glorri:rw${stamp}-${seq}`, title: `Fixture ${scenario}`, company: 'Fixture MMC', description: 'x', location: 'Bakı',
      url: `https://jobs.glorri.com/vacancies/fixture/${slug}`, postedAt: new Date(), rawPayload: { slug, company: { slug: 'fixture' } },
    } });
    const m = await prisma.match.create({ data: { userId, jobId: job.id, score: 0.9 } });
    return { matchId: m.id, slug };
  }

  async function waitFor(id: string, not: string[]) {
    for (let i = 0; i < 300; i++) {
      const res = await request(server).get(`/external-applications/${id}`).set(auth).expect(200);
      if (!not.includes(res.body.status)) return res.body;
      await sleep(100);
    }
    throw new Error(`${id} stayed in ${not}`);
  }

  async function prepare(scenario: string) {
    const { matchId, slug } = await match(scenario);
    const created = await request(server).post('/external-applications').set(auth).send({ matchId }).expect(201);
    const prep = (await request(server).get(`/external-applications/${created.body.id}/preparation`).set(auth).expect(200)).body;
    await request(server).post(`/external-applications/${created.body.id}/consent`).set(auth).send({
      destinationHost: prep.destination.host, noticeHash: prep.notice.hash, noticeVersion: prep.notice.version,
      disclosureHash: prep.disclosureHash, approvedFields: prep.approvedFieldKeys,
      approvedDocuments: prep.documents.map((d: any) => ({ kind: d.kind, sha256: d.sha256 })), motivationLetter: prep.motivationLetter,
    }).expect(200);
    const row = await waitFor(created.body.id, ['FILLING']);
    return { id: created.body.id as string, row, slug, matchId };
  }

  const confirm = (id: string, reviewVersion: number, extra: object = {}) =>
    request(server).post(`/external-applications/${id}/confirm-submit`).set(auth).send({ attemptId: randomUUID(), reviewVersion, ...extra });

  it('normal: real fill → review → one send → SUBMITTED only with the validated fixture receipt', async () => {
    const { id, row, slug } = await prepare('normal');
    expect(row.status).toBe('READY_FOR_REVIEW');
    expect(row.reviewScreenshotUrl).toBeTruthy();
    expect(fixture.of(slug)).toMatchObject({ clicks: 0, submissions: [] });
    const done = (await confirm(id, row.reviewVersion).expect(200)).body;
    expect(done).toMatchObject({ status: 'SUBMITTED', receiptConfirmed: true, receiptReference: fixture.of(slug).receipts[0] });
    expect(done.receiptEvidence).toMatchObject({ method: 'receipt-contract', urlPath: `/vacancies/fixture/${slug}/apply/done` });
    const [submission] = fixture.of(slug).submissions;
    // The destination received exactly the approved snapshots' bytes.
    expect(submission.files).toEqual([
      { field: 'cv', size: cvBytes.length, sha256: sha(cvBytes) },
      { field: 'idPhoto', size: idBytes.length, sha256: sha(idBytes) },
    ]);
    expect(submission.fields).toMatchObject({ firstName: 'Sintetik', lastName: 'Namizəd', email, isDataPrivacyAccepted: 'on' });
  });

  it('required questions are answered by the candidate, then sent', async () => {
    const { id, row, slug } = await prepare('questions');
    expect(row.status).toBe('NEEDS_INPUT');
    expect(row.missingFields.map((f: any) => f.fieldKey)).toEqual(['questions.0.answer', 'questions.1.answer']);
    const answered = (await request(server).patch(`/external-applications/${id}/answers`).set(auth)
      .send({ answers: [{ fieldKey: 'questions.0.answer', value: 'Bəli' }, { fieldKey: 'questions.1.answer', value: 'Xeyr' }] }).expect(200)).body;
    expect(answered.status).toBe('READY_FOR_REVIEW');
    // The review shows a fresh screenshot of the answered form; the old one is removed.
    expect(answered.reviewScreenshotUrl).toBeTruthy();
    expect(answered.reviewScreenshotUrl).not.toBe(row.reviewScreenshotUrl);
    expect(() => storage.resolveForRead(row.reviewScreenshotUrl)).toThrow();
    expect((await confirm(id, answered.reviewVersion).expect(200)).body.status).toBe('SUBMITTED');
    expect(fixture.of(slug).submissions[0].fields).toMatchObject({ 'questions.0.answer': 'Bəli', 'questions.1.answer': 'Xeyr' });
  });

  it('a changed notice, a refused upload, a CAPTCHA and a changed form stop before anything is sent', async () => {
    const notice = await prepare('notice-changed');
    expect(notice.row).toMatchObject({ status: 'FAILED', stateReason: 'NOTICE_CHANGED' });
    expect((await prisma.externalApplicationConsent.findFirstOrThrow({ where: { externalApplicationId: notice.id } })).revokedReason).toBe('NOTICE_CHANGED');
    const upload = await prepare('upload-error');
    expect(upload.row).toMatchObject({ status: 'FAILED', stateReason: 'UPLOAD_FAILED' });
    const captcha = await prepare('captcha');
    expect(captcha.row).toMatchObject({ status: 'FAILED', stateReason: 'MANUAL_INTERVENTION_REQUIRED' });
    expect(captcha.row.errorMessage).toContain('CAPTCHA');
    const changed = await prepare('changed-dom');
    expect(changed.row).toMatchObject({ status: 'FAILED', stateReason: 'FILL_ERROR' });
    for (const s of [notice, upload, captcha, changed]) expect(fixture.of(s.slug)).toMatchObject({ clicks: 0, submissions: [] });
  });

  it('OTP: wrong code stays retryable, correct code completes with the receipt', async () => {
    const { id, row, slug } = await prepare('otp');
    expect((await confirm(id, row.reviewVersion).expect(200)).body.status).toBe('AWAITING_OTP');
    const bad = (await request(server).post(`/external-applications/${id}/otp`).set(auth).send({ attemptId: randomUUID(), code: '000000' }).expect(200)).body;
    expect(bad).toMatchObject({ status: 'AWAITING_OTP', stateReason: 'OTP_INVALID' });
    const good = (await request(server).post(`/external-applications/${id}/otp`).set(auth).send({ attemptId: randomUUID(), code: FIXTURE_OTP }).expect(200)).body;
    expect(good).toMatchObject({ status: 'SUBMITTED', receiptReference: fixture.of(slug).receipts[0] });
    expect(fixture.of(slug).submissions).toHaveLength(1);
  });

  it('a documented refusal is FAILED; navigation away and a dropped connection stay unconfirmed and are never resent', async () => {
    const rejected = await prepare('reject');
    expect((await confirm(rejected.id, rejected.row.reviewVersion).expect(200)).body).toMatchObject({ status: 'FAILED', stateReason: 'DESTINATION_REJECTED' });

    const nav = await prepare('navigate');
    expect((await confirm(nav.id, nav.row.reviewVersion).expect(200)).body).toMatchObject({ status: 'DELIVERY_UNCONFIRMED', stateReason: 'NO_RECEIPT_EVIDENCE' });

    const challenge = await prepare('captcha-after');
    expect((await confirm(challenge.id, challenge.row.reviewVersion).expect(200)).body).toMatchObject({ status: 'DELIVERY_UNCONFIRMED', stateReason: 'CHALLENGE_AFTER_SEND' });

    const hang = await prepare('hang');
    expect((await confirm(hang.id, hang.row.reviewVersion).expect(200)).body).toMatchObject({ status: 'DELIVERY_UNCONFIRMED', receiptConfirmed: false });
    expect(fixture.of(hang.slug).submissions).toHaveLength(1);
    await confirm(hang.id, hang.row.reviewVersion).expect(409);
    await request(server).post('/external-applications').set(auth).send({ matchId: hang.matchId }).expect(409);
    await service.reconcile();
    expect(fixture.of(hang.slug)).toMatchObject({ clicks: 1 });
    expect(fixture.of(hang.slug).submissions).toHaveLength(1);
  });

  it('dry run with the sandbox rehearses without activating the final control', async () => {
    process.env.ENABLE_SANDBOX = 'true';
    try {
      const { id, row, slug } = await prepare('normal');
      expect((await confirm(id, row.reviewVersion, { dryRun: true }).expect(200)).body.status).toBe('SUBMITTED_DRY_RUN');
      expect(fixture.of(slug)).toMatchObject({ clicks: 0, submissions: [] });
    } finally {
      delete process.env.ENABLE_SANDBOX;
    }
  });

  it('two concurrent confirms send once', async () => {
    const { id, row, slug } = await prepare('slow');
    const [a, b] = await Promise.all([confirm(id, row.reviewVersion), confirm(id, row.reviewVersion)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await waitFor(id, ['SUBMITTING'])).status).toBe('SUBMITTED');
    expect(fixture.of(slug)).toMatchObject({ clicks: 1 });
  });

  it('a destination slower than the API timeout stays uncertain even though it later issued a receipt', async () => {
    fixture.stallMs = 5000;
    process.env.EXTERNAL_APPLY_SEND_TIMEOUT_MS = '2000';
    const { id, row, slug } = await prepare('stall');
    expect((await confirm(id, row.reviewVersion).expect(200)).body).toMatchObject({ status: 'DELIVERY_UNCONFIRMED', stateReason: 'WORKER_TIMEOUT_OR_ERROR' });
    await sleep(5500);
    expect(fixture.of(slug).receipts).toHaveLength(1);
    // AISE never saw the receipt, so it does not claim it, and never resends.
    expect((await request(server).get(`/external-applications/${id}`).set(auth).expect(200)).body.status).toBe('DELIVERY_UNCONFIRMED');
    expect(fixture.of(slug)).toMatchObject({ clicks: 1 });
  });

  it('low worker capacity refuses a third preparation without sending anything', async () => {
    const one = await prepare('normal');
    const two = await prepare('normal');
    const three = await prepare('normal');
    expect(three.row).toMatchObject({ status: 'FAILED', stateReason: 'FILL_FAILED' });
    expect(fixture.of(three.slug)).toMatchObject({ clicks: 0, submissions: [] });
    for (const r of [one, two]) await request(server).post(`/external-applications/${r.id}/cancel`).set(auth).expect(200);
  });

  it('worker process loss during the final send leaves the delivery uncertain; after restart nothing is resent', async () => {
    const { id, row, slug } = await prepare('slow');
    const ready = await prepare('normal');
    const sending = confirm(id, row.reviewVersion).then((r) => r);
    for (let i = 0; i < 100 && !fixture.of(slug).clicks; i++) await sleep(50);
    expect(fixture.of(slug).clicks).toBe(1);
    await stopWorker('SIGKILL');
    expect((await sending).body).toMatchObject({ status: 'DELIVERY_UNCONFIRMED', stateReason: 'WORKER_TIMEOUT_OR_ERROR' });

    await startWorker();
    await service.reconcile();
    // The in-flight application stays uncertain; the untouched review session was lost with the process.
    expect((await request(server).get(`/external-applications/${id}`).set(auth).expect(200)).body.status).toBe('DELIVERY_UNCONFIRMED');
    expect((await request(server).get(`/external-applications/${ready.id}`).set(auth).expect(200)).body).toMatchObject({ status: 'EXPIRED', stateReason: 'SESSION_LOST' });
    await confirm(id, row.reviewVersion).expect(409);
    await confirm(ready.id, ready.row.reviewVersion).expect(409);
    expect(fixture.of(slug).clicks).toBe(1);
    expect(fixture.of(ready.slug)).toMatchObject({ clicks: 0, submissions: [] });
  });
});
