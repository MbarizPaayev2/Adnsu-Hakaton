import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import IORedis from 'ioredis';
import request from 'supertest';
import { randomBytes, randomUUID, createHash } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { AuthModule } from '../src/auth/auth.module';
import { ResumesModule } from '../src/resumes/resumes.module';
import { ExternalApplyModule } from '../src/external-apply/external-apply.module';
import { ExternalApplyService } from '../src/external-apply/external-apply.service';
import { ApplyWorkerClient } from '../src/external-apply/apply-worker.client';
import { LocalStorageService } from '../src/resumes/local-storage.service';
import {
  ExternalDestination,
  ExternalDestinationRegistry,
  GLORRI_DESTINATION,
  noticeFingerprint,
} from '../src/external-apply/destinations';
import { FakeApplyWorker } from './support/fake-apply-worker';

// Synthetic accounts, documents and vacancies only, in the isolated local
// aise_phase2_test database. The apply worker is a loopback HTTP stand-in
// (test/support/fake-apply-worker.ts); nothing is sent to Glorri or any real
// destination. The production registry keeps Glorri on assisted apply; this
// suite substitutes a fixture notice + receipt contract through DI only.

const stamp = `${Date.now()}`;
const queuePrefix = `aise-extapply-${stamp}`;
const workerToken = randomBytes(16).toString('hex');
const NOTICE = { url: 'https://jobs.glorri.com/privacy', version: 'fixture-2026-09', declarationText: 'Sintetik bəyanat: məlumatlarımın işlənməsinə razıyam.' };
const FIXTURE: ExternalDestination = {
  ...GLORRI_DESTINATION,
  notice: NOTICE,
  receipt: { textPattern: /Müraciət nömrəsi:\s*([A-Z0-9-]+)/, urlPathPattern: /^\/applications\/done$/ },
};
class FixtureRegistry extends ExternalDestinationRegistry {
  protected readonly destinations = [FIXTURE];
}
const RECEIPT = { url: 'https://jobs.glorri.com/applications/done', text: 'Təşəkkürlər, Sintetik! Müraciət nömrəsi: GL-E2E-0001' };
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
jest.setTimeout(30_000);

describe('external application consent, claim and truthful states (isolated synthetic data)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  let storage: LocalStorageService;
  let service: ExternalApplyService;
  const worker = new FakeApplyWorker(workerToken);
  const env = { ...process.env };
  const emails = [`aise-ext-a-${stamp}@example.com`, `aise-ext-b-${stamp}@example.com`];
  const users: { id: string; token: string; cvUrl: string; cvBytes: Buffer }[] = [];
  const createdFiles: string[] = [];
  let jobSeq = 0;

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') {
      throw new Error('Refusing external-apply test outside isolated local aise_phase2_test');
    }
    process.env.DATABASE_URL = db.toString();
    process.env.NODE_ENV = 'test';
    process.env.APPLY_WORKER_URL = await worker.start();
    process.env.APPLY_WORKER_TOKEN = workerToken;
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'true';
    process.env.EXTERNAL_APPLY_SEND_TIMEOUT_MS = '800';
    process.env.EXTERNAL_APPLY_DAILY_SEND_LIMIT = '100';
    delete process.env.ENABLE_SANDBOX;

    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      BullModule.forRoot({ prefix: queuePrefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, AuthModule, ResumesModule, ExternalApplyModule,
    ] }).overrideProvider(ExternalDestinationRegistry).useValue(new FixtureRegistry()).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    storage = app.get(LocalStorageService);
    service = app.get(ExternalApplyService);

    for (const [i, email] of emails.entries()) {
      const cvBytes = Buffer.from(`%PDF-1.4 synthetic CV ${i} ${stamp}`);
      const cvUrl = await storage.uploadBuffer(cvBytes, 'application/pdf');
      const idUrl = await storage.uploadBuffer(Buffer.from(`89504e47 synthetic id ${i}`), 'image/png');
      createdFiles.push(cvUrl, idUrl);
      const user = await prisma.user.create({ data: {
        email, name: `Sintetik Namizəd${i}`, hashedPassword: 'x', emailVerified: new Date(),
        subscription: { create: { plan: 'Limitsiz', status: 'active' } },
        profile: { create: {
          headline: 'Backend developer', skills: ['Node.js'], location: 'Bakı', jobPreferences: {},
          phone: '+994500000000', address: 'Sintetik küçə 1', citizenship: 'Azərbaycan', dob: new Date('1995-05-05'),
          salaryExpectation: 2000, preferredNetGross: 'Net', preferredCurrency: 'AZN', idDocumentUrl: idUrl,
          defaultCoverLetter: 'Sintetik motivasiya məktubu — bu vəzifə üçün müraciət edirəm.',
        } },
        resumes: { create: { isBase: true, status: 'READY', fileUrl: cvUrl } },
      } });
      const token = randomBytes(32).toString('hex');
      await prisma.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) } });
      users.push({ id: user.id, token, cvUrl, cvBytes });
    }
    process.env.EXTERNAL_APPLY_PILOT_USER_IDS = users.map((u) => u.id).join(',');
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      const rows = await prisma.externalApplication.findMany({ where: { userId: { in: users.map((u) => u.id) } } });
      for (const row of rows) {
        for (const url of [row.cvSnapshotUrl, row.idDocumentSnapshotUrl, row.reviewScreenshotUrl]) if (url) createdFiles.push(url);
      }
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `glorri:e2e-${stamp}-` } } });
      for (const url of createdFiles) await storage.deleteFile(url).catch(() => undefined);
    }
    await app?.close();
    await worker.stop();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${queuePrefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    process.env = { ...env };
  }, 60_000);

  beforeEach(() => {
    worker.handlers = {};
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'true';
  });

  const as = (u: number) => ({ Authorization: `Bearer ${users[u].token}` });

  async function newMatch(u = 0) {
    jobSeq += 1;
    const slug = `e2e-${stamp}-${jobSeq}`;
    const job = await prisma.job.create({ data: {
      externalId: `glorri:${slug}`, title: `Sintetik vakansiya ${jobSeq}`, company: 'Sintetik MMC', description: 'x', location: 'Bakı',
      url: `https://jobs.glorri.com/vacancies/sintetik/${slug}`, postedAt: new Date(), rawPayload: { slug, company: { slug: 'sintetik' } },
    } });
    return prisma.match.create({ data: { userId: users[u].id, jobId: job.id, score: 0.9 } });
  }

  async function consentBody(id: string, u = 0) {
    const prep = await request(server).get(`/external-applications/${id}/preparation`).set(as(u)).expect(200);
    return {
      prep: prep.body,
      body: {
        destinationHost: prep.body.destination.host,
        noticeHash: prep.body.notice.hash,
        noticeVersion: prep.body.notice.version,
        disclosureHash: prep.body.disclosureHash,
        approvedFields: prep.body.approvedFieldKeys,
        approvedDocuments: prep.body.documents.map((d: any) => ({ kind: d.kind, sha256: d.sha256 })),
        motivationLetter: prep.body.motivationLetter,
      },
    };
  }

  async function waitFor(id: string, u = 0, not = ['FILLING']) {
    for (let i = 0; i < 100; i++) {
      const res = await request(server).get(`/external-applications/${id}`).set(as(u)).expect(200);
      if (!not.includes(res.body.status)) return res.body;
      await sleep(100);
    }
    throw new Error(`application ${id} stayed in ${not.join('/')}`);
  }

  /** A fresh application that has reached the candidate's final review. */
  async function reviewed(u = 0) {
    const match = await newMatch(u);
    const created = await request(server).post('/external-applications').set(as(u)).send({ matchId: match.id }).expect(201);
    const { body } = await consentBody(created.body.id, u);
    await request(server).post(`/external-applications/${created.body.id}/consent`).set(as(u)).send(body).expect(200);
    const row = await waitFor(created.body.id, u);
    expect(row.status).toBe('READY_FOR_REVIEW');
    return { id: created.body.id as string, reviewVersion: row.reviewVersion as number, matchId: match.id };
  }

  const confirm = (id: string, reviewVersion: number, attemptId = randomUUID(), u = 0, extra: object = {}) =>
    request(server).post(`/external-applications/${id}/confirm-submit`).set(as(u)).send({ attemptId, reviewVersion, ...extra });

  it('shows destination, notice, exact fields and documents; transmits nothing before scoped consent', async () => {
    const match = await newMatch();
    const created = await request(server).post('/external-applications').set(as(0)).send({ matchId: match.id }).expect(201);
    expect(created.body.status).toBe('DRAFT');
    const { prep, body } = await consentBody(created.body.id);
    expect(prep.destination).toMatchObject({ key: 'glorri', host: 'jobs.glorri.com', applyUrl: expect.stringMatching(/^https:\/\/jobs\.glorri\.com\/vacancies\/sintetik\/.+\/apply$/) });
    expect(prep.notice).toEqual({ ...NOTICE, hash: noticeFingerprint(NOTICE.declarationText, NOTICE.url) });
    expect(prep.fields.map((f: any) => f.key)).toEqual(GLORRI_DESTINATION.fields.map((f) => f.key));
    expect(prep.documents).toEqual([
      expect.objectContaining({ kind: 'CV', sha256: sha256(users[0].cvBytes) }),
      expect.objectContaining({ kind: 'ID_DOCUMENT', reason: GLORRI_DESTINATION.identityDocument.reason }),
    ]);
    expect(prep.documents[0].fileUrl).toBeUndefined();
    expect(prep.canConsent).toBe(true);

    // Absent consent: nothing can be sent from a DRAFT.
    await confirm(created.body.id, 0).expect(409);
    // Consent that does not echo what is shown now is refused.
    await request(server).post(`/external-applications/${created.body.id}/consent`).set(as(0))
      .send({ ...body, noticeHash: 'f'.repeat(64) }).expect(409);
    await request(server).post(`/external-applications/${created.body.id}/consent`).set(as(0))
      .send({ ...body, approvedFields: body.approvedFields.slice(1) }).expect(409);
    await request(server).post(`/external-applications/${created.body.id}/consent`).set(as(0))
      .send({ ...body, approvedDocuments: body.approvedDocuments.slice(0, 1) }).expect(409);
    // Another candidate cannot read, consent to or send it.
    await request(server).get(`/external-applications/${created.body.id}/preparation`).set(as(1)).expect(404);
    await request(server).post(`/external-applications/${created.body.id}/consent`).set(as(1)).send(body).expect(404);
    expect(worker.count('create')).toBe(0);

    const before = worker.count('create');
    await request(server).post(`/external-applications/${created.body.id}/consent`).set(as(0)).send(body).expect(200);
    const row = await waitFor(created.body.id);
    expect(row.status).toBe('READY_FOR_REVIEW');
    expect(worker.count('create')).toBe(before + 1);
    const consent = await prisma.externalApplicationConsent.findFirstOrThrow({ where: { externalApplicationId: created.body.id } });
    expect(consent).toMatchObject({
      userId: users[0].id, jobId: match.jobId, destinationKey: 'glorri', destinationHost: 'jobs.glorri.com',
      noticeVersion: NOTICE.version, noticeHash: body.noticeHash, revokedAt: null,
    });
    expect((consent.approvedDocuments as any[]).map((d) => d.kind)).toEqual(['CV', 'ID_DOCUMENT']);
    // The worker receives the private snapshot, never the mutable base file,
    // and the recorded authority for the recipient's declaration.
    const createCall = worker.calls.filter((c) => c.path === '/sessions' && c.method === 'POST').pop()!;
    expect(createCall.body.privacyAuthority).toEqual({ noticeHash: body.noticeHash, noticeVersion: NOTICE.version });
    expect(createCall.body.fillData.resumeFilePath).not.toContain(users[0].cvUrl.split('/').pop());
    expect(sha256(fs.readFileSync(createCall.body.fillData.resumeFilePath))).toBe(sha256(users[0].cvBytes));
    // A second start for the same match returns the in-progress row.
    const again = await request(server).post('/external-applications').set(as(0)).send({ matchId: match.id }).expect(201);
    expect(again.body.id).toBe(created.body.id);
  });

  it('asks the candidate for unknown screening answers instead of guessing', async () => {
    worker.handlers.create = (req, res) => {
      worker.live.add(req.body.applicationId);
      FakeApplyWorker.json(res, 201, { status: 'NEEDS_INPUT', previewData: {}, missingFields: [
        { fieldKey: 'questions.0.answer', label: 'Sürücülük vəsiqəniz var?', type: 'radio', options: ['Bəli', 'Xeyr'] },
        { fieldKey: 'isDataPrivacyAccepted', label: 'x', type: 'checkbox' },
      ] });
    };
    const match = await newMatch();
    const created = await request(server).post('/external-applications').set(as(0)).send({ matchId: match.id }).expect(201);
    const { body } = await consentBody(created.body.id);
    await request(server).post(`/external-applications/${created.body.id}/consent`).set(as(0)).send(body).expect(200);
    const row = await waitFor(created.body.id);
    expect(row.status).toBe('NEEDS_INPUT');
    // The recipient's declaration is never offered as an ordinary question.
    expect(row.missingFields.map((f: any) => f.fieldKey)).toEqual(['questions.0.answer']);
    await confirm(created.body.id, row.reviewVersion).expect(409);
    await request(server).patch(`/external-applications/${created.body.id}/answers`).set(as(0))
      .send({ answers: [{ fieldKey: 'isDataPrivacyAccepted', value: 'true' }] }).expect(400);
    await request(server).patch(`/external-applications/${created.body.id}/answers`).set(as(0))
      .send({ answers: [{ fieldKey: 'questions.9.answer', value: 'Bəli' }] }).expect(400);
    const answered = await request(server).patch(`/external-applications/${created.body.id}/answers`).set(as(0))
      .send({ answers: [{ fieldKey: 'questions.0.answer', value: 'Bəli' }] }).expect(200);
    expect(answered.body.status).toBe('READY_FOR_REVIEW');
    expect(answered.body.reviewVersion).toBeGreaterThan(row.reviewVersion);
    // The version the candidate saw before answering can no longer be confirmed.
    await confirm(created.body.id, row.reviewVersion).expect(409);
    expect(worker.count('confirm-submit')).toBe(0);
  });

  it('two concurrent confirms with different attempt ids send once', async () => {
    const r = await reviewed();
    const before = worker.count('confirm-submit');
    worker.handlers.confirm = async (req, res) => {
      await sleep(200);
      worker.live.delete(r.id);
      FakeApplyWorker.json(res, 200, { attemptId: req.body.attemptId, outcome: 'SENT_OBSERVED', observation: RECEIPT });
    };
    const [a, b] = await Promise.all([confirm(r.id, r.reviewVersion), confirm(r.id, r.reviewVersion)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(worker.count('confirm-submit')).toBe(before + 1);
    const final = await waitFor(r.id, 0, ['SUBMITTING']);
    expect(final).toMatchObject({ status: 'SUBMITTED', receiptConfirmed: true, receiptReference: 'GL-E2E-0001', stateReason: 'RECEIPT_CONFIRMED' });
    expect(JSON.stringify(final)).not.toContain('Təşəkkürlər');
    expect(await prisma.externalApplicationAttempt.count({ where: { externalApplicationId: r.id } })).toBe(1);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: r.matchId } })).status).toBe('APPLIED');
  });

  it('a double-click (same attempt id) and a later retry replay the single send', async () => {
    const r = await reviewed();
    const attemptId = randomUUID();
    const before = worker.count('confirm-submit');
    worker.handlers.confirm = async (req, res) => {
      await sleep(150);
      worker.live.delete(r.id);
      FakeApplyWorker.json(res, 200, { attemptId: req.body.attemptId, outcome: 'SENT_OBSERVED', observation: { url: RECEIPT.url, text: 'Təşəkkürlər' } });
    };
    const [a, b] = await Promise.all([confirm(r.id, r.reviewVersion, attemptId), confirm(r.id, r.reviewVersion, attemptId)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const later = await confirm(r.id, r.reviewVersion, attemptId).expect(200);
    expect(later.body).toMatchObject({ status: 'DELIVERY_UNCONFIRMED', stateReason: 'NO_RECEIPT_EVIDENCE', receiptConfirmed: false });
    expect(worker.count('confirm-submit')).toBe(before + 1);
    // An attempt id cannot be reused against another candidate's application.
    const other = await reviewed(1);
    await confirm(other.id, other.reviewVersion, attemptId, 1).expect(409);
    expect(worker.count('confirm-submit')).toBe(before + 1);
    // Uncertain delivery blocks a new automated application for the match.
    await request(server).post('/external-applications').set(as(0)).send({ matchId: r.matchId }).expect(409);
    const caps = await request(server).get(`/external-applications/capabilities?matchIds=${r.matchId}`).set(as(0)).expect(200);
    expect(caps.body[r.matchId]).toMatchObject({ available: false, reason: 'ALREADY_SENT', applicationStatus: 'DELIVERY_UNCONFIRMED' });
  });

  it('a timeout after the worker may have sent stays uncertain; a refused connection before sending does not', async () => {
    const r = await reviewed();
    worker.handlers.confirm = async () => { /* never answers: the send may have happened */ };
    const timedOut = await confirm(r.id, r.reviewVersion).expect(200);
    expect(timedOut.body).toMatchObject({ status: 'DELIVERY_UNCONFIRMED', stateReason: 'WORKER_TIMEOUT_OR_ERROR' });
    const attempts = await prisma.externalApplicationAttempt.findMany({ where: { externalApplicationId: r.id } });
    expect(attempts).toEqual([expect.objectContaining({ status: 'UNCONFIRMED', kind: 'CONFIRM' })]);
    // Nothing resends it: neither a new attempt nor the reconciler.
    await confirm(r.id, r.reviewVersion).expect(409);
    await service.reconcile();
    expect(worker.calls.filter((c) => c.path === `/sessions/${r.id}/confirm-submit`)).toHaveLength(1);

    const r2 = await reviewed();
    const client = app.get(ApplyWorkerClient) as any;
    const realUrl = client.baseUrl;
    // A port nothing listens on: the connection is refused before any request.
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as any).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    client.baseUrl = `http://127.0.0.1:${closedPort}`;
    try {
      const refused = await confirm(r2.id, r2.reviewVersion).expect(200);
      expect(refused.body).toMatchObject({ status: 'READY_FOR_REVIEW', stateReason: 'WORKER_UNREACHABLE' });
    } finally {
      client.baseUrl = realUrl;
    }
    expect(await prisma.externalApplicationAttempt.findFirst({ where: { externalApplicationId: r2.id } })).toMatchObject({ status: 'NOT_SENT' });
  });

  it('a reconciler finds a crashed in-flight attempt uncertain and never resends it', async () => {
    const r = await reviewed();
    const attemptId = randomUUID();
    await prisma.$transaction([
      prisma.externalApplication.update({ where: { id: r.id }, data: { status: 'SUBMITTING', activeAttemptId: attemptId } }),
      prisma.externalApplicationAttempt.create({ data: { id: attemptId, externalApplicationId: r.id, userId: users[0].id, kind: 'CONFIRM', status: 'IN_FLIGHT' } }),
    ]);
    await prisma.$executeRaw`UPDATE "ExternalApplication" SET "updatedAt" = now() - interval '1 hour' WHERE id = ${r.id}`;
    const before = worker.count('confirm-submit');
    await service.reconcile();
    const row = await prisma.externalApplication.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: 'DELIVERY_UNCONFIRMED', stateReason: 'STALE_IN_FLIGHT', activeAttemptId: null });
    expect(await prisma.externalApplicationAttempt.findUniqueOrThrow({ where: { id: attemptId } })).toMatchObject({ status: 'UNCONFIRMED' });
    expect(worker.count('confirm-submit')).toBe(before);
  });

  it('cancellation cannot interrupt or undo a send in flight, and a cancelled review cannot be sent', async () => {
    const r = await reviewed();
    let release!: () => void;
    worker.handlers.confirm = async (req, res) => {
      await new Promise<void>((resolve) => { release = resolve; });
      worker.live.delete(r.id);
      FakeApplyWorker.json(res, 200, { attemptId: req.body.attemptId, outcome: 'SENT_OBSERVED', observation: RECEIPT });
    };
    // .then() starts the (lazy) supertest request without awaiting it.
    const sending = confirm(r.id, r.reviewVersion).then((res) => res);
    await waitFor(r.id, 0, ['READY_FOR_REVIEW']);
    const cancel = await request(server).post(`/external-applications/${r.id}/cancel`).set(as(0)).expect(409);
    expect(cancel.body.message).toContain('geri götürmür');
    release();
    expect((await sending).body.status).toBe('SUBMITTED');

    const r2 = await reviewed();
    const before = worker.count('confirm-submit');
    await request(server).post(`/external-applications/${r2.id}/cancel`).set(as(0)).expect(200);
    await confirm(r2.id, r2.reviewVersion).expect(409);
    expect(worker.count('confirm-submit')).toBe(before);
    const consent = await prisma.externalApplicationConsent.findFirstOrThrow({ where: { externalApplicationId: r2.id } });
    expect(consent.revokedReason).toBe('CANCELLED_BY_CANDIDATE');
    expect(worker.live.has(r2.id)).toBe(false);
  });

  it('revoked consent, an expired session and a gate switched off stop the final send', async () => {
    const before = worker.count('confirm-submit');
    const revoked = await reviewed();
    await prisma.externalApplicationConsent.updateMany({ where: { externalApplicationId: revoked.id }, data: { revokedAt: new Date() } });
    expect((await confirm(revoked.id, revoked.reviewVersion).expect(409)).body.reason).toBe('CONSENT_REVOKED');

    const expired = await reviewed();
    await prisma.externalApplication.update({ where: { id: expired.id }, data: { sessionExpiresAt: new Date(Date.now() - 1000) } });
    expect((await confirm(expired.id, expired.reviewVersion).expect(409)).body.reason).toBe('SESSION_EXPIRED');
    expect((await prisma.externalApplication.findUniqueOrThrow({ where: { id: expired.id } })).status).toBe('EXPIRED');

    const gated = await reviewed();
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'false';
    expect((await confirm(gated.id, gated.reviewVersion).expect(403)).body.reason).toBe('LIVE_GATE_OFF');
    expect(worker.count('confirm-submit')).toBe(before);
    expect(await prisma.externalApplicationAttempt.count({ where: { externalApplicationId: { in: [revoked.id, expired.id, gated.id] } } })).toBe(0);
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'true';

    // Gate off between the OTP request and the code: the code is not forwarded.
    const otp = await reviewed();
    const otpBefore = worker.count('otp');
    worker.handlers.confirm = (req, res) => FakeApplyWorker.json(res, 200, { attemptId: req.body.attemptId, outcome: 'AWAITING_OTP' });
    expect((await confirm(otp.id, otp.reviewVersion).expect(200)).body.status).toBe('AWAITING_OTP');
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'false';
    await request(server).post(`/external-applications/${otp.id}/otp`).set(as(0)).send({ attemptId: randomUUID(), code: '123456' }).expect(403);
    expect(worker.count('otp')).toBe(otpBefore);
    // Cancelling now stops AISE but cannot withdraw what the form already
    // submitted, so no new automated application is offered for this match.
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'true';
    const cancelled = await request(server).post(`/external-applications/${otp.id}/cancel`).set(as(0)).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', stateReason: 'CANCELLED_AFTER_SEND_PENDING_OTP' });
    await request(server).post('/external-applications').set(as(0)).send({ matchId: otp.matchId }).expect(409);
  });

  it('OTP: an invalid code stays retryable, a valid one with receipt completes, replays do not resend', async () => {
    const r = await reviewed();
    const otpBefore = worker.count('otp');
    worker.handlers.confirm = (req, res) => FakeApplyWorker.json(res, 200, { attemptId: req.body.attemptId, outcome: 'AWAITING_OTP' });
    worker.handlers.otp = (req, res) => {
      if (req.body.code !== '424242') return FakeApplyWorker.json(res, 200, { attemptId: req.body.attemptId, outcome: 'OTP_INVALID' });
      worker.live.delete(r.id);
      FakeApplyWorker.json(res, 200, { attemptId: req.body.attemptId, outcome: 'SENT_OBSERVED', observation: RECEIPT });
    };
    await confirm(r.id, r.reviewVersion).expect(200);
    const bad = await request(server).post(`/external-applications/${r.id}/otp`).set(as(0)).send({ attemptId: randomUUID(), code: '000000' }).expect(200);
    expect(bad.body).toMatchObject({ status: 'AWAITING_OTP', stateReason: 'OTP_INVALID', otpAttempts: 1 });
    const attemptId = randomUUID();
    const good = await request(server).post(`/external-applications/${r.id}/otp`).set(as(0)).send({ attemptId, code: '424242' }).expect(200);
    expect(good.body).toMatchObject({ status: 'SUBMITTED', receiptReference: 'GL-E2E-0001' });
    expect(good.body.cvSnapshotUrl).toBeUndefined();
    expect(good.body.consent.disclosure.fields).toMatchObject({ firstName: 'Sintetik', email: emails[0] });
    await request(server).post(`/external-applications/${r.id}/otp`).set(as(0)).send({ attemptId, code: '424242' }).expect(200);
    expect(worker.count('otp')).toBe(otpBefore + 2);
  });

  it('a forged status in a request body is ignored and a forged worker reply is not a receipt', async () => {
    const r = await reviewed();
    worker.handlers.confirm = (req, res) => {
      worker.live.delete(r.id);
      FakeApplyWorker.json(res, 200, { attemptId: req.body.attemptId, outcome: 'RECEIVED', status: 'SUBMITTED', receiptReference: 'FORGED-1', observation: RECEIPT });
    };
    const res = await confirm(r.id, r.reviewVersion, randomUUID(), 0, { status: 'SUBMITTED', receiptReference: 'FORGED-2' }).expect(200);
    expect(res.body).toMatchObject({ status: 'DELIVERY_UNCONFIRMED', stateReason: 'MALFORMED_WORKER_RESPONSE', receiptReference: null });
  });

  it('dry run is refused without the sandbox and never reaches OTP or a real send with it', async () => {
    const r = await reviewed();
    const otpBefore = worker.count('otp');
    await confirm(r.id, r.reviewVersion, randomUUID(), 0, { dryRun: true }).expect(400);
    process.env.ENABLE_SANDBOX = 'true';
    try {
      worker.handlers.confirm = (req, res) => {
        expect(req.body.dryRun).toBe(true);
        FakeApplyWorker.json(res, 200, { attemptId: req.body.attemptId, outcome: 'AWAITING_OTP' });
      };
      const res = await confirm(r.id, r.reviewVersion, randomUUID(), 0, { dryRun: true }).expect(200);
      // A rehearsal that claims to have reached OTP is a violation, not progress.
      expect(res.body).toMatchObject({ status: 'DELIVERY_UNCONFIRMED', stateReason: 'DRY_RUN_VIOLATION' });
      await request(server).post(`/external-applications/${r.id}/otp`).set(as(0)).send({ attemptId: randomUUID(), code: '123456' }).expect(409);
      expect(worker.count('otp')).toBe(otpBefore);
    } finally {
      delete process.env.ENABLE_SANDBOX;
    }
  });

  it('replacing the base CV during preparation does not change what is transmitted; a tampered snapshot blocks the send', async () => {
    let release!: () => void;
    worker.handlers.create = async (req, res) => {
      await new Promise<void>((resolve) => { release = resolve; });
      worker.live.add(req.body.applicationId);
      FakeApplyWorker.json(res, 201, { status: 'READY_FOR_REVIEW', previewData: {}, missingFields: [] });
    };
    const match = await newMatch();
    const created = await request(server).post('/external-applications').set(as(0)).send({ matchId: match.id }).expect(201);
    const { body } = await consentBody(created.body.id);
    await request(server).post(`/external-applications/${created.body.id}/consent`).set(as(0)).send(body).expect(200);
    // The candidate replaces their base CV while the worker is filling.
    for (let i = 0; i < 50 && !release; i++) await sleep(50);
    const newCv = await storage.uploadBuffer(Buffer.from(`%PDF-1.4 replacement ${stamp}`), 'application/pdf');
    createdFiles.push(newCv);
    await prisma.resume.updateMany({ where: { userId: users[0].id, isBase: true }, data: { fileUrl: newCv } });
    release();
    const row = await waitFor(created.body.id);
    const snapshot = (await prisma.externalApplication.findUniqueOrThrow({ where: { id: created.body.id } })).cvSnapshotUrl!;
    expect(sha256(fs.readFileSync(storage.resolveForRead(snapshot)))).toBe(sha256(users[0].cvBytes));
    await prisma.resume.updateMany({ where: { userId: users[0].id, isBase: true }, data: { fileUrl: users[0].cvUrl } });

    fs.writeFileSync(storage.resolveForRead(snapshot), 'tampered');
    const before = worker.count('confirm-submit');
    await confirm(created.body.id, row.reviewVersion).expect(409);
    expect(worker.count('confirm-submit')).toBe(before);
    expect((await prisma.externalApplication.findUniqueOrThrow({ where: { id: created.body.id } })).stateReason).toBe('SNAPSHOT_CHANGED');
  });

  it('retained screenshots and document copies expire after the retention period; the record stays', async () => {
    const r = await reviewed();
    worker.handlers.confirm = (req, res) => {
      worker.live.delete(r.id);
      FakeApplyWorker.json(res, 200, { attemptId: req.body.attemptId, outcome: 'SENT_OBSERVED', observation: RECEIPT });
    };
    await confirm(r.id, r.reviewVersion).expect(200);
    const before = await prisma.externalApplication.findUniqueOrThrow({ where: { id: r.id } });
    const retained = [before.reviewScreenshotUrl, before.cvSnapshotUrl, before.idDocumentSnapshotUrl];
    expect(retained.every(Boolean)).toBe(true);
    // Still within the period: nothing is removed.
    await service.expireEvidence();
    expect((await prisma.externalApplication.findUniqueOrThrow({ where: { id: r.id } })).cvSnapshotUrl).toBe(before.cvSnapshotUrl);
    // An in-progress application's files are never expired, however old.
    const active = await reviewed();
    await prisma.$executeRaw`UPDATE "ExternalApplication" SET "updatedAt" = now() - interval '400 days' WHERE id IN (${r.id}, ${active.id})`;
    await service.expireEvidence();
    const after = await prisma.externalApplication.findUniqueOrThrow({ where: { id: r.id } });
    expect(after).toMatchObject({ status: 'SUBMITTED', receiptReference: 'GL-E2E-0001', reviewScreenshotUrl: null, cvSnapshotUrl: null, idDocumentSnapshotUrl: null });
    for (const url of retained) expect(() => storage.resolveForRead(url!)).toThrow();
    expect(await prisma.externalApplicationConsent.count({ where: { externalApplicationId: r.id } })).toBe(1);
    const stillActive = await prisma.externalApplication.findUniqueOrThrow({ where: { id: active.id } });
    expect(stillActive.cvSnapshotUrl).toBeTruthy();
    expect(fs.existsSync(storage.resolveForRead(stillActive.cvSnapshotUrl!))).toBe(true);
  });

  it("another candidate's request is refused everywhere", async () => {
    const r = await reviewed();
    const before = worker.count('confirm-submit');
    await request(server).get(`/external-applications/${r.id}`).set(as(1)).expect(404);
    await confirm(r.id, r.reviewVersion, randomUUID(), 1).expect(404);
    await request(server).post(`/external-applications/${r.id}/otp`).set(as(1)).send({ attemptId: randomUUID(), code: '123456' }).expect(404);
    await request(server).post(`/external-applications/${r.id}/cancel`).set(as(1)).expect(404);
    await request(server).post('/external-applications').set(as(1)).send({ matchId: r.matchId }).expect(404);
    await request(server).get(`/external-applications/${r.id}`).expect(401);
    expect(worker.count('confirm-submit')).toBe(before);
  });
});
