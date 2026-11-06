import { TrackerService } from '../src/application-timeline/tracker.service';
import { TrackerController } from '../src/application-timeline/tracker.controller';
import { TimelineService } from '../src/application-timeline/timeline.service';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import * as express from 'express';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../src/database/database.service';
import { LocalStorageService } from '../src/resumes/local-storage.service';
import { FeatureFlagsService } from '../src/operations/feature-flags.service';
import { SessionAuthGuard } from '../src/auth/session-auth.guard';
import { EmailApplicationsController } from '../src/email-applications/email-applications.controller';
import { ResendWebhookController } from '../src/email-applications/resend-webhook.controller';
import { EmailAllowanceService } from '../src/email-applications/email-allowance.service';
import { EmailApplicationsService } from '../src/email-applications/email-applications.service';
import { EmailApplicationSender } from '../src/email-applications/email-application.sender';
import { EmailApplicationMaintenance } from '../src/email-applications/email-application.maintenance';
import { DeliveryEvidenceService } from '../src/email-applications/delivery-evidence.service';
import { InboundReplyService } from '../src/email-applications/inbound-reply.service';
import { AUTOMATION_CONSENT_VERSION, EmailAutomationService } from '../src/email-applications/email-automation.service';
import { EmailService } from '../src/common/email.service';
import { AccountDeletionService } from '../src/accounts/account-deletion.service';
import { ResendTransport } from '../src/email-applications/email-transport';
import { FakeProvider } from '../src/email-applications/fake-provider';
import { EMAIL_APPLY_CONFIG, EMAIL_TRANSPORT } from '../src/email-applications/email-apply.tokens';
import { loadEmailApplyConfig, type EmailApplyConfig } from '../src/email-applications/email-apply.config';
import { sha256Hex } from '../src/email-applications/email-application-state';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';

const SECRET = `whsec_${Buffer.from('synthetic-email-application-secret').toString('base64')}`;
const stamp = `ea${Date.now()}`;
const pdf = (marker: string) => Buffer.from(`%PDF-1.4\n% synthetic CV ${marker}\n${'x'.repeat(2000)}\n%%EOF`);

/**
 * Real Postgres, real HTTP routes, real storage, real transport code — with a
 * local fake provider standing in for the e-mail provider. Evidence level:
 * "local fake provider"; no message leaves this machine.
 */
describe('candidate-approved e-mail applications (local fake provider, isolated Postgres)', () => {
  let app: INestApplication, prisma: PrismaService, storage: LocalStorageService, sender: EmailApplicationSender, maintenance: EmailApplicationMaintenance, flags: FeatureFlagsService, automation: EmailAutomationService;
  let cfg: EmailApplyConfig;
  const provider = new FakeProvider();
  const queue = { add: jest.fn(async () => ({})) };
  const mail = { send: jest.fn(async () => ({ id: 'mock', mock: true })) };
  const users: { id: string; token: string; email: string }[] = [];
  const jobIds: string[] = [];
  const recipients: string[] = [];
  let counter = 0;

  const api = (token: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => request(app.getHttpServer()).patch(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body: object = {}) => request(app.getHttpServer()).put(url).set('Authorization', `Bearer ${token}`).send(body),
  });

  async function makeUser(withCv = true, name = 'Aysel Məmmədova') {
    const n = ++counter;
    const user = await prisma.user.create({ data: { email: `${stamp}-u${n}@example.com`, hashedPassword: 'synthetic-not-loginable', name, emailVerified: new Date() } });
    const token = `tok-${stamp}-${n}`;
    await prisma.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3600_000) } });
    let cvBytes: Buffer | undefined;
    if (withCv) {
      cvBytes = pdf(`base-${n}`);
      await prisma.resume.create({ data: { userId: user.id, isBase: true, status: 'READY', fileUrl: await storage.uploadBuffer(cvBytes, 'application/pdf'), parsedContent: {} } });
    }
    users.push({ id: user.id, token, email: user.email });
    return { id: user.id, token, email: user.email, cvBytes };
  }

  async function makeJob(over: Record<string, unknown> = {}, evidence: Record<string, unknown> | null = {}) {
    const n = ++counter;
    const recipient = `hr-${stamp}-${n}@employer.example`;
    recipients.push(recipient);
    const job = await prisma.job.create({
      data: {
        externalId: `eatest:${stamp}-${n}`, title: `Analyst ${n}`, company: `${stamp} Employer`, description: `Send your CV to ${recipient}`, location: 'Bakı',
        url: `https://employer.example/jobs/${n}`, postedAt: new Date('2026-09-20T00:00:00Z'), applicationMethod: 'EMAIL', applicationEmail: recipient,
        applicationEmailEvidence: evidence === null ? undefined : { excerpt: `Send your CV to ${recipient} with the subject "Analyst ${n} - REF-${n}".`, subjectLine: `Analyst ${n} - REF-${n}`, reference: `REF-${n}`, extractedFrom: 'description', extractorVersion: 1, ...evidence },
        ...over,
      },
    });
    jobIds.push(job.id);
    return { ...job, recipient };
  }

  /** Prepare → approve through the real routes; returns the approved view. */
  async function approved(user: { token: string }, jobId: string, edits: object = {}) {
    const prepared = (await api(user.token).post('/email-applications/prepare', { jobId }).expect(200)).body;
    const view = Object.keys(edits).length ? (await api(user.token).patch(`/email-applications/${prepared.id}/draft`, edits).expect(200)).body : prepared;
    const result = await api(user.token).post(`/email-applications/${prepared.id}/approve`, { payloadSha256: view.payloadSha256, consent: true, instructionsAcknowledged: true });
    return { prepared: view, result };
  }

  const row = (id: string) => prisma.emailApplication.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || (db.pathname !== '/aise_phase2_test' && !/^\/aise_release_test_[0-9]+$/.test(db.pathname))) throw new Error('Requires an isolated local test database');
    const url = await provider.start();
    cfg = loadEmailApplyConfig({
      EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_TRANSPORT: 'sink', EMAIL_APPLY_SINK_URL: url, EMAIL_APPLY_WEBHOOK_SECRET: SECRET, EMAIL_APPLY_FROM: 'AISE <applications@aise.example>',
      EMAIL_APPLY_USER_DAILY_LIMIT: '50', EMAIL_APPLY_GLOBAL_DAILY_LIMIT: '5000', EMAIL_APPLY_RECIPIENT_DAILY_LIMIT: '50',
    } as never);
    const module = await Test.createTestingModule({
      controllers: [EmailApplicationsController, ResendWebhookController, TrackerController],
      providers: [
        TrackerService, TimelineService, PrismaService, LocalStorageService, FeatureFlagsService, SessionAuthGuard, EmailApplicationsService, EmailAllowanceService, EmailApplicationSender, EmailApplicationMaintenance, DeliveryEvidenceService, InboundReplyService, EmailAutomationService,
        { provide: EmailService, useValue: mail },
        { provide: EMAIL_APPLY_CONFIG, useValue: cfg },
        { provide: EMAIL_TRANSPORT, useFactory: () => new ResendTransport(cfg, 700) },
        { provide: getQueueToken('email-application'), useValue: queue },
      ],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    app.use('/webhooks/resend', express.raw({ type: '*/*', limit: '1mb' }));
    app.use(express.json());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = module.get(PrismaService); storage = module.get(LocalStorageService); sender = module.get(EmailApplicationSender); maintenance = module.get(EmailApplicationMaintenance); flags = module.get(FeatureFlagsService); automation = module.get(EmailAutomationService);
  });

  afterAll(async () => {
    if (prisma) {
      const snapshots = await prisma.emailApplication.findMany({ where: { userId: { in: users.map((u) => u.id) }, cvSnapshotUrl: { not: null } }, select: { cvSnapshotUrl: true } });
      for (const s of snapshots) await storage.deletePrivate(s.cvSnapshotUrl!);
      const resumes = await prisma.resume.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { fileUrl: true } });
      for (const r of resumes) if (r.fileUrl) await storage.deleteFile(r.fileUrl);
      await prisma.emailDeliveryEvent.deleteMany({ where: { OR: [{ emailApplication: { userId: { in: users.map((u) => u.id) } } }, { providerMessageId: { startsWith: 'fake_' } }] } });
      await prisma.emailSuppression.deleteMany({ where: { email: { in: recipients } } });
      await prisma.emailApplySettings.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
      await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
      await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
      await prisma.featureFlag.deleteMany({ where: { key: 'email_apply.sending' } });
    }
    await app?.close();
    await provider.stop();
  });
  beforeEach(() => { provider.messages.length = 0; provider.requests.length = 0; queue.add.mockClear(); });

  // ── Preview and approval ────────────────────────────────────────────────
  describe('eligibility, preview and approval', () => {
    it('is offered only where the posting itself gives an application address', async () => {
      const user = await makeUser();
      const withEmail = await makeJob();
      const noEmail = await makeJob({ applicationMethod: 'EXTERNAL_SITE', applicationEmail: null }, null);
      const expired = await makeJob({ deadline: new Date('2026-09-01T00:00:00Z') });
      const closed = await makeJob({ status: 'CLOSED' });
      expect((await api(user.token).get(`/email-applications/eligibility/${withEmail.id}`).expect(200)).body).toEqual({ eligible: true });
      for (const [job, reason] of [[noEmail, 'NO_EMAIL_APPLICATION'], [expired, 'JOB_NOT_OPEN'], [closed, 'JOB_NOT_OPEN']] as const) {
        expect((await api(user.token).get(`/email-applications/eligibility/${job.id}`).expect(200)).body).toMatchObject({ eligible: false, reason });
        await api(user.token).post('/email-applications/prepare', { jobId: job.id }).expect(409);
      }
      await request(app.getHttpServer()).get(`/email-applications/eligibility/${withEmail.id}`).expect(401);
    });

    it('shows the whole instruction when the task comes before the sentence naming the address, and warns that extra work is asked', async () => {
      const user = await makeUser();
      const job = await makeJob({}, { excerpt: 'Send the doc, your CV and a few words on why you fit.', extractedFrom: 'description', extractorVersion: 4 });
      await prisma.job.update({ where: { id: job.id }, data: { description: `Junior LinkedIn Specialist\nHow to apply\nFind 5 LinkedIn posts by business owners and write 1 comment under each, in a Google Doc with the post links. Send the doc, your CV and a few words on why you fit to ${job.recipient}.` } });
      const prepared = (await api(user.token).post('/email-applications/prepare', { jobId: job.id }).expect(200)).body;
      expect(prepared.instructions).toContain('How to apply');
      expect(prepared.instructions).toContain('Google Doc');
      expect(prepared.instructionsExtra).toBe(true);
      // an ordinary posting does not raise the warning
      const plain = await makeJob();
      const plainView = (await api(user.token).post('/email-applications/prepare', { jobId: plain.id }).expect(200)).body;
      expect(plainView.instructionsExtra).toBe(false);
    });

    it('shows recipient, published subject, instructions, CV and letter, and what is shared, before anything is queued', async () => {
      const user = await makeUser();
      const job = await makeJob();
      const view = (await api(user.token).post('/email-applications/prepare', { jobId: job.id }).expect(200)).body;
      expect(view).toMatchObject({
        deliveryState: 'AWAITING_APPROVAL', recipient: job.recipient, subject: job.title + ' - REF-' + job.title.split(' ')[1], subjectSource: 'published', subjectLocked: true,
        replyTo: user.email, cv: { kind: 'base', fileName: 'CV-Aysel-Mmmdova.pdf', sha256: sha256Hex(user.cvBytes!) }, copyToSelf: true,
      });
      expect(view.instructions).toContain(job.recipient);
      expect(view.body).toContain(job.title);
      expect(view.body).not.toMatch(/years|experience/i);
      expect(view.sharing.join(' ')).toContain('CV faylı');
      expect(provider.messages).toHaveLength(0);
      expect(queue.add).not.toHaveBeenCalled();
      expect((await api(user.token).get('/email-applications/' + view.id + '/cv').expect(200)).body.equals(user.cvBytes!)).toBe(true);
    });

    it('refuses a missing CV, someone else\'s CV, an unapproved tailored CV and one made for another vacancy', async () => {
      const none = await makeUser(false);
      const job = await makeJob();
      expect((await api(none.token).post('/email-applications/prepare', { jobId: job.id }).expect(400)).body.message).toContain('NO_CV');

      const owner = await makeUser();
      const other = await makeUser();
      const otherResume = await prisma.resume.findFirstOrThrow({ where: { userId: other.id } });
      await api(owner.token).post('/email-applications/prepare', { jobId: job.id, resumeId: otherResume.id }).expect(404);

      const otherJob = await makeJob();
      const match = await prisma.match.create({ data: { userId: owner.id, jobId: otherJob.id, score: 0.5 } });
      const draftCv = await prisma.resume.create({ data: { userId: owner.id, isBase: false, matchId: match.id, status: 'READY', fileUrl: await storage.uploadBuffer(pdf('tailored'), 'application/pdf') } });
      const approvedCv = await prisma.resume.update({ where: { id: draftCv.id }, data: { reviewedAt: new Date() } });
      await prisma.resume.update({ where: { id: draftCv.id }, data: { reviewedAt: null } });
      expect((await api(owner.token).post('/email-applications/prepare', { jobId: otherJob.id, resumeId: draftCv.id }).expect(400)).body.message).toContain('CV_NOT_APPROVED');
      await prisma.resume.update({ where: { id: draftCv.id }, data: { reviewedAt: approvedCv.reviewedAt } });
      // Approved, but made for a different vacancy than this one.
      expect((await api(owner.token).post('/email-applications/prepare', { jobId: job.id, resumeId: draftCv.id }).expect(400)).body.message).toContain('CV_NOT_APPROVED');
      // Approved and for this vacancy: used by default.
      const view = (await api(owner.token).post('/email-applications/prepare', { jobId: otherJob.id }).expect(200)).body;
      expect(view.cv).toMatchObject({ kind: 'tailored', resumeId: draftCv.id });
      await prisma.resume.update({ where: { id: draftCv.id }, data: { status: 'PENDING', fileUrl: null } });
      await api(owner.token).patch(`/email-applications/${view.id}/draft`, { resumeId: draftCv.id }).expect(400);
    });

    it('requires consent and the instructions acknowledgement, and refuses an approval of something other than what was previewed', async () => {
      const user = await makeUser();
      const job = await makeJob();
      const prepared = (await api(user.token).post('/email-applications/prepare', { jobId: job.id }).expect(200)).body;
      await api(user.token).post(`/email-applications/${prepared.id}/approve`, { payloadSha256: prepared.payloadSha256, consent: false }).expect(400);
      await api(user.token).post(`/email-applications/${prepared.id}/approve`, { payloadSha256: prepared.payloadSha256, consent: true }).expect(400);
      // The letter changes after the candidate previewed it (second tab, retry): the old preview cannot be approved.
      await api(user.token).patch(`/email-applications/${prepared.id}/draft`, { body: 'Different words' }).expect(200);
      const stale = await api(user.token).post(`/email-applications/${prepared.id}/approve`, { payloadSha256: prepared.payloadSha256, consent: true, instructionsAcknowledged: true }).expect(409);
      expect(stale.body.message).toContain('PREVIEW_STALE');
      expect((await row(prepared.id)).deliveryState).toBe('AWAITING_APPROVAL');
      // A published subject cannot be rewritten.
      await api(user.token).patch(`/email-applications/${prepared.id}/draft`, { subject: 'Cheaper subject' }).expect(400);
    });

    it('refuses to approve when the CV file changed after the preview', async () => {
      const user = await makeUser();
      const job = await makeJob();
      const prepared = (await api(user.token).post('/email-applications/prepare', { jobId: job.id }).expect(200)).body;
      const resume = await prisma.resume.findFirstOrThrow({ where: { userId: user.id } });
      const replacement = await storage.uploadBuffer(pdf('replacement'), 'application/pdf');
      await prisma.resume.update({ where: { id: resume.id }, data: { fileUrl: replacement } });
      const res = await api(user.token).post(`/email-applications/${prepared.id}/approve`, { payloadSha256: prepared.payloadSha256, consent: true, instructionsAcknowledged: true }).expect(409);
      expect(res.body.message).toContain('CV_CHANGED');
      expect((await row(prepared.id)).cvSnapshotUrl).toBeNull();
    });

    it('keeps every other candidate out: view, edit, approve, cancel and download are all "not found"', async () => {
      const a = await makeUser();
      const b = await makeUser();
      const job = await makeJob();
      const prepared = (await api(a.token).post('/email-applications/prepare', { jobId: job.id }).expect(200)).body;
      const calls = [() => api(b.token).get(`/email-applications/${prepared.id}`), () => api(b.token).get(`/email-applications/${prepared.id}/cv`), () => api(b.token).patch(`/email-applications/${prepared.id}/draft`, { body: 'x' }),
        () => api(b.token).post(`/email-applications/${prepared.id}/approve`, { payloadSha256: prepared.payloadSha256, consent: true, instructionsAcknowledged: true }), () => api(b.token).post(`/email-applications/${prepared.id}/cancel`),
        () => api(b.token).patch(`/email-applications/${prepared.id}/status`, { state: 'ACKNOWLEDGED' })];
      for (const call of calls) await call().expect(404);
      expect((await api(b.token).get('/email-applications').expect(200)).body).toEqual([]);
    });
  });

  // ── Sending ─────────────────────────────────────────────────────────────
  describe('sending', () => {
    it('sends the exact approved bytes, subject and recipient with the candidate as Reply-To, and records provider acceptance only', async () => {
      const user = await makeUser();
      const job = await makeJob();
      const { result } = await approved(user, job.id, { body: 'Hello,\nI would like to apply.\nThanks' });
      expect(result.status).toBe(200);
      const id = result.body.id;
      expect(result.body).toMatchObject({ deliveryState: 'QUEUED', consentVersion: expect.any(String) });
      expect(queue.add).toHaveBeenCalledTimes(1);

      expect(await sender.process(id)).toBe('provider_accepted');
      expect(provider.messages).toHaveLength(1);
      const sent = provider.messages[0];
      expect(sent).toMatchObject({ to: [job.recipient], replyTo: user.email, bcc: [user.email], subject: result.body.subject, text: 'Hello,\nI would like to apply.\nThanks', tags: { application: id } });
      expect(sent.from).toContain('via AISE');
      expect(sent.attachments).toHaveLength(1);
      expect(sent.attachments[0]).toMatchObject({ filename: 'CV-Aysel-Mmmdova.pdf', sha256: sha256Hex(user.cvBytes!) });
      expect(sent.attachments[0].content.equals(user.cvBytes!)).toBe(true);

      const stored = await row(id);
      expect(stored).toMatchObject({ deliveryState: 'PROVIDER_ACCEPTED', recruitmentState: 'SENT', providerMessageId: sent.id, deliveredAt: null, failureCode: null });
      expect(stored.payloadSha256).toHaveLength(64);
      const detail = (await api(user.token).get(`/email-applications/${id}`).expect(200)).body;
      expect(detail.evidence).toMatchObject({ deliveredAt: null });
      expect(detail.history).toEqual([expect.objectContaining({ from: 'NOT_SENT', to: 'SENT', evidence: 'PROVIDER_ACCEPTED' })]);
      // The snapshot is private to this attempt: replacing the live CV later does not change what was sent.
      const resume = await prisma.resume.findFirstOrThrow({ where: { userId: user.id } });
      await prisma.resume.update({ where: { id: resume.id }, data: { fileUrl: await storage.uploadBuffer(pdf('later'), 'application/pdf') } });
      expect((await api(user.token).get(`/email-applications/${id}/cv`).expect(200)).body.equals(user.cvBytes!)).toBe(true);
    });

    it('a double click and a repeated import create one application; concurrent workers send one message', async () => {
      const user = await makeUser();
      const job = await makeJob();
      const prepared = (await api(user.token).post('/email-applications/prepare', { jobId: job.id }).expect(200)).body;
      const body = { payloadSha256: prepared.payloadSha256, consent: true, instructionsAcknowledged: true };
      const results = await Promise.all([1, 2, 3, 4].map(() => api(user.token).post(`/email-applications/${prepared.id}/approve`, body)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect((await row(prepared.id)).generation).toBe(1);
      // The same posting arriving again from an import cannot create a second application.
      await api(user.token).post('/email-applications/prepare', { jobId: job.id }).expect(409);
      expect(await prisma.emailApplication.count({ where: { userId: user.id, jobId: job.id } })).toBe(1);

      const outcomes = await Promise.all([1, 2, 3, 4, 5, 6].map(() => sender.process(prepared.id)));
      expect(outcomes.filter((o) => o === 'provider_accepted')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'skipped')).toHaveLength(5);
      expect(provider.messages).toHaveLength(1);
      expect(await prisma.emailSendAttempt.count({ where: { emailApplicationId: prepared.id } })).toBe(1);
    });

    it('re-checks consent and pauses immediately before sending', async () => {
      const user = await makeUser();
      const jobA = await makeJob(); const jobB = await makeJob(); const jobC = await makeJob();
      const a = (await approved(user, jobA.id)).result.body.id;
      const b = (await approved(user, jobB.id)).result.body.id;
      const c = (await approved(user, jobC.id)).result.body.id;
      // Candidate pauses: nothing is sent and nothing is lost.
      await api(user.token).post('/email-applications/settings/pause').expect(200);
      expect(await sender.process(a)).toBe('held');
      expect(await row(a)).toMatchObject({ deliveryState: 'QUEUED', holdReason: 'USER_PAUSED', attemptCount: 0 });
      await api(user.token).post('/email-applications/settings/resume').expect(200);
      // Operator emergency pause.
      await prisma.featureFlag.upsert({ where: { key: 'email_apply.sending' }, create: { key: 'email_apply.sending', paused: true }, update: { paused: true } });
      expect(await sender.process(a, new Date(Date.now() + 10 * 60_000))).toBe('held');
      expect((await row(a)).holdReason).toBe('EMERGENCY_PAUSE');
      await prisma.featureFlag.update({ where: { key: 'email_apply.sending' }, data: { paused: false } });
      // Cancel one pending application; revoke consent for the rest.
      await api(user.token).post(`/email-applications/${b}/cancel`).expect(200);
      expect(await sender.process(b)).toBe('skipped');
      const revoked = (await api(user.token).post('/email-applications/settings/revoke-consent').expect(200)).body;
      expect(revoked.cancelled).toBeGreaterThanOrEqual(1);
      expect(await sender.process(c)).toBe('skipped');
      expect((await row(c)).deliveryState).toBe('CANCELLED');
      expect((await row(c)).cvSnapshotUrl).toBeNull();
      // A cancel that arrives while a worker holds the row is honoured at the last check before the provider call.
      const d = (await approved(user, (await makeJob()).id)).result.body.id;
      await prisma.emailApplication.update({ where: { id: d }, data: { deliveryState: 'SENDING', lockedAt: new Date() } });
      const requested = (await api(user.token).post(`/email-applications/${d}/cancel`).expect(200)).body;
      expect(requested.cancelRequested).toBe(true);
      expect(await (sender as any).gate(await row(d), new Date(), true)).toEqual({ result: 'cancelled', reason: 'CANDIDATE_CANCELLED' });
      await (sender as any).cancel(d, new Date(), 'CANDIDATE_CANCELLED');
      expect((await row(d)).deliveryState).toBe('CANCELLED');
      expect(provider.messages).toHaveLength(0);
    });

    it('does not send to a closed posting, a suppressed recipient or an unauthorized live recipient', async () => {
      const user = await makeUser();
      const closing = await makeJob();
      const closingId = (await approved(user, closing.id)).result.body.id;
      await prisma.job.update({ where: { id: closing.id }, data: { status: 'CLOSED' } });
      expect(await sender.process(closingId)).toBe('failed');
      expect((await row(closingId)).failureCode).toBe('JOB_CLOSED');

      const suppressedJob = await makeJob();
      const suppressedId = (await approved(user, suppressedJob.id)).result.body.id;
      await prisma.emailSuppression.create({ data: { email: suppressedJob.recipient, reason: 'BOUNCE' } });
      expect(await sender.process(suppressedId)).toBe('failed');
      expect((await row(suppressedId)).failureCode).toBe('RECIPIENT_SUPPRESSED');
      expect((await api(user.token).post('/email-applications/prepare', { jobId: suppressedJob.id }).expect(409)).body.message).toContain('RECIPIENT_SUPPRESSED');

      const liveJob = await makeJob();
      const liveId = (await approved(user, liveJob.id)).result.body.id;
      const liveCfg = { ...cfg, transport: 'live' as const, realRecipients: false, recipientAllowlist: ['someone@else.example'] };
      const liveSender = new EmailApplicationSender(prisma, storage, flags, liveCfg, new ResendTransport(cfg));
      expect(await liveSender.process(liveId)).toBe('failed');
      expect((await row(liveId)).failureCode).toBe('RECIPIENT_NOT_AUTHORIZED');
      expect(provider.messages).toHaveLength(0);
    });

    it('never sends a document or fields that differ from what was approved', async () => {
      const user = await makeUser();
      const job = await makeJob();
      const id = (await approved(user, job.id)).result.body.id;
      const snapshot = (await row(id)).cvSnapshotUrl!;
      fs.appendFileSync(path.join(process.cwd(), 'uploads', ...snapshot.split('/')), 'tampered');
      expect(await sender.process(id)).toBe('failed');
      expect((await row(id)).failureCode).toBe('INTEGRITY_MISMATCH');

      const other = await makeJob();
      const otherId = (await approved(user, other.id)).result.body.id;
      await prisma.emailApplication.update({ where: { id: otherId }, data: { recipient: 'attacker@evil.example' } });
      expect(await sender.process(otherId)).toBe('failed');
      expect((await row(otherId)).failureCode).toBe('RECIPIENT_CHANGED'); // the stored address no longer matches the posting
      expect(provider.messages).toHaveLength(0);
    });

    it('records a provider rejection as a failure and retries a rate limit a bounded number of times', async () => {
      const user = await makeUser();
      const rejected = (await approved(user, (await makeJob()).id)).result.body.id;
      provider.queue({ status: 422, body: { name: 'validation_error' } });
      expect(await sender.process(rejected)).toBe('failed');
      expect(await row(rejected)).toMatchObject({ deliveryState: 'FAILED', failureCode: 'PROVIDER_VALIDATION_ERROR', recruitmentState: 'NOT_SENT' });

      const limited = (await approved(user, (await makeJob()).id)).result.body.id;
      provider.queue({ status: 429, body: { name: 'rate_limit_exceeded' } }, { status: 429, body: { name: 'rate_limit_exceeded' } });
      let now = new Date();
      expect(await sender.process(limited, now)).toBe('retry_scheduled');
      expect(await sender.process(limited, now)).toBe('skipped'); // not due yet
      now = new Date(now.getTime() + 2 * 60_000);
      expect(await sender.process(limited, now)).toBe('retry_scheduled');
      now = new Date(now.getTime() + 10 * 60_000);
      expect(await sender.process(limited, now)).toBe('provider_accepted'); // third attempt succeeds
      expect(provider.messages).toHaveLength(1);
      expect((await row(limited)).attemptCount).toBe(3);

      const exhausted = (await approved(user, (await makeJob()).id)).result.body.id;
      provider.queue({ status: 429 }, { status: 429 }, { status: 429 });
      now = new Date();
      for (let i = 0; i < 3; i++) { await sender.process(exhausted, now); now = new Date(now.getTime() + 60 * 60_000); }
      expect(await row(exhausted)).toMatchObject({ deliveryState: 'FAILED', failureCode: 'RETRIES_EXHAUSTED' });
    });

    it('treats a timeout after the provider took the message as uncertain: never re-sent automatically, safely retryable by the candidate', async () => {
      const user = await makeUser();
      const id = (await approved(user, (await makeJob()).id)).result.body.id;
      provider.queue('record-then-hang');
      expect(await sender.process(id)).toBe('uncertain');
      expect(await row(id)).toMatchObject({ deliveryState: 'UNCERTAIN', failureCode: 'timeout', recruitmentState: 'NOT_SENT' });
      expect(provider.messages).toHaveLength(1);
      // Neither the sweeper nor another worker re-sends it.
      expect(await sender.process(id, new Date(Date.now() + 3600_000))).toBe('skipped');
      expect(await maintenance.sweep(new Date(Date.now() + 3600_000))).toMatchObject({ enqueued: expect.any(Number) });
      expect(await sender.dueIds(new Date(Date.now() + 3600_000))).not.toContainEqual(expect.objectContaining({ id }));
      expect(provider.messages).toHaveLength(1);
      // The candidate must acknowledge the risk; the same idempotency key lets the provider recognise the message it already took.
      await api(user.token).post(`/email-applications/${id}/retry`, { acknowledgeDuplicateRisk: false }).expect(400);
      await api(user.token).post(`/email-applications/${id}/retry`, { acknowledgeDuplicateRisk: true }).expect(200);
      expect(await sender.process(id)).toBe('provider_accepted');
      expect(provider.messages).toHaveLength(1);
      expect(provider.requests.filter((r) => r.idempotencyKey?.includes(id))).toHaveLength(2);
      expect(new Set(provider.requests.map((r) => r.idempotencyKey)).size).toBe(1);
    });

    it('recovers a crashed worker without ever re-sending an attempt that may have reached the provider', async () => {
      const user = await makeUser();
      const mid = (await approved(user, (await makeJob()).id)).result.body.id;
      const old = new Date(Date.now() - 30 * 60_000);
      await prisma.emailApplication.update({ where: { id: mid }, data: { deliveryState: 'SENDING', lockedAt: old, attemptCount: 1 } });
      await prisma.emailSendAttempt.create({ data: { emailApplicationId: mid, generation: 1, number: 1, idempotencyKey: `k-${mid}` } });
      const before = (await row(mid)).generation;
      const early = (await approved(user, (await makeJob()).id)).result.body.id;
      await prisma.emailApplication.update({ where: { id: early }, data: { deliveryState: 'SENDING', lockedAt: old, attemptCount: 1 } });
      expect(await sender.reclaimStale()).toBeGreaterThanOrEqual(2);
      expect(await row(mid)).toMatchObject({ deliveryState: 'UNCERTAIN', failureCode: 'worker_interrupted', generation: before });
      expect((await row(early)).deliveryState).toBe('QUEUED'); // claimed but never started a provider call
      expect(provider.messages).toHaveLength(0);
    });

    it('enforces daily sending limits across attempts', async () => {
      const user = await makeUser();
      const first = (await approved(user, (await makeJob()).id)).result.body.id;
      const second = (await approved(user, (await makeJob()).id)).result.body.id;
      const saved = cfg.userDailyLimit;
      cfg.userDailyLimit = 1;
      try {
        expect(await sender.process(first)).toBe('provider_accepted');
        expect(await sender.process(second)).toBe('held');
        expect((await row(second)).holdReason).toBe('DAILY_LIMIT');
        await api(user.token).post('/email-applications/prepare', { jobId: (await makeJob()).id }).expect(200); // preparing is free
        const third = await approved(user, (await makeJob()).id);
        expect(third.result.status).toBe(409);
        expect(third.result.body.message).toContain('DAILY_LIMIT');
      } finally { cfg.userDailyLimit = saved; }
    });
  });

  // ── Monthly allowance by plan ───────────────────────────────────────────
  describe('monthly e-mail application allowance (Free 5, Plus 30, Premium 100; separate from documents)', () => {
    const view = async (user: { token: string }) => (await api(user.token).get('/email-applications/allowance').expect(200)).body;
    const plan = async (userId: string, plan: 'PLUS' | 'PREMIUM') => prisma.subscription.create({ data: { userId, plan, status: 'active', currentPeriodEnd: new Date(Date.now() + 20 * 86400_000) } });

    it('states the limit and what is left before anything is approved, and refuses the sixth Free application', async () => {
      const user = await makeUser();
      expect(await view(user)).toMatchObject({ plan: 'FREE', limit: 5, used: 0, remaining: 5 });
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push((await approved(user, (await makeJob()).id)).result.body.id);
      expect(await view(user)).toMatchObject({ limit: 5, used: 5, remaining: 0 });
      const job = await makeJob();
      // preparing is refused up front, with the numbers the screen needs
      const prepare = await api(user.token).post('/email-applications/prepare', { jobId: job.id });
      expect(prepare.status).toBe(402);
      expect(prepare.body).toMatchObject({ code: 'EMAIL_ALLOWANCE_EXHAUSTED', limit: 5, used: 5, remaining: 0 });
      expect(await prisma.emailApplication.count({ where: { userId: user.id } })).toBe(5);
      expect(ids).toHaveLength(5);
    });

    it('does not charge a repeated approval, a replayed request or a retry of an uncertain send a second unit', async () => {
      const user = await makeUser();
      const first = await approved(user, (await makeJob()).id);
      const again = await api(user.token).post(`/email-applications/${first.result.body.id}/approve`, { payloadSha256: first.prepared.payloadSha256, consent: true, instructionsAcknowledged: true });
      expect(again.status).toBe(409);
      expect(await view(user)).toMatchObject({ used: 1, remaining: 4 });
      // uncertain outcome: the unit stays held, and the candidate's retry reuses the same application
      provider.queue('record-then-hang');
      expect(await sender.process(first.result.body.id)).toBe('uncertain');
      expect(await view(user)).toMatchObject({ used: 1 });
      await api(user.token).post(`/email-applications/${first.result.body.id}/retry`, { acknowledgeDuplicateRisk: true }).expect(200);
      expect(await view(user)).toMatchObject({ used: 1, remaining: 4 });
    });

    it('gives the unit back when a send definitively fails, is cancelled or bounces', async () => {
      const user = await makeUser();
      const failed = (await approved(user, (await makeJob()).id)).result.body.id;
      const cancelled = (await approved(user, (await makeJob()).id)).result.body.id;
      const ok = (await approved(user, (await makeJob()).id)).result.body.id;
      expect(await view(user)).toMatchObject({ used: 3 });
      provider.queue({ status: 422, body: { name: 'validation_error' } });
      expect(await sender.process(failed)).toBe('failed');
      await api(user.token).post(`/email-applications/${cancelled}/cancel`).expect(200);
      expect(await view(user)).toMatchObject({ used: 1, remaining: 4 });
      expect(await sender.process(ok)).toBe('provider_accepted');
      expect(await view(user)).toMatchObject({ used: 1 }); // provider acceptance keeps its unit
      await prisma.emailApplication.update({ where: { id: ok }, data: { deliveryState: 'BOUNCED', bouncedAt: new Date() } });
      expect(await view(user)).toMatchObject({ used: 0, remaining: 5 });
    });

    it('lets two approvals race for the last unit: exactly one wins', async () => {
      const user = await makeUser();
      for (let i = 0; i < 4; i++) await approved(user, (await makeJob()).id);
      const a = (await api(user.token).post('/email-applications/prepare', { jobId: (await makeJob()).id }).expect(200)).body;
      const b = (await api(user.token).post('/email-applications/prepare', { jobId: (await makeJob()).id }).expect(200)).body;
      const [ra, rb] = await Promise.all([a, b].map((v) => api(user.token).post(`/email-applications/${v.id}/approve`, { payloadSha256: v.payloadSha256, consent: true, instructionsAcknowledged: true })));
      expect([ra.status, rb.status].sort()).toEqual([200, 402]);
      expect(await view(user)).toMatchObject({ used: 5, remaining: 0 });
    });

    it('allows a bounded number of candidate re-sends of an uncertain outcome, each acknowledged, never more', async () => {
      const user = await makeUser();
      const id = (await approved(user, (await makeJob()).id)).result.body.id;
      provider.queue('record-then-hang');
      expect(await sender.process(id)).toBe('uncertain'); // the provider never answered
      for (let i = 0; i < 2; i++) {
        await api(user.token).post(`/email-applications/${id}/retry`, { acknowledgeDuplicateRisk: true }).expect(200);
        // The re-send was not answered either (stand-in for another timeout): back to uncertain without touching the provider.
        await prisma.emailApplication.update({ where: { id }, data: { deliveryState: 'UNCERTAIN', uncertainAt: new Date() } });
      }
      const third = await api(user.token).post(`/email-applications/${id}/retry`, { acknowledgeDuplicateRisk: true });
      expect(third.status).toBe(409);
      expect(third.body.message).toContain('RETRY_LIMIT');
      expect(await view(user)).toMatchObject({ used: 1 }); // still one unit
    });

    it('allows only one concurrent retry when a single uncertain retry remains', async () => {
      const user = await makeUser();
      const id = (await approved(user, (await makeJob()).id)).result.body.id;
      await prisma.emailApplication.update({ where: { id }, data: { deliveryState: 'UNCERTAIN', uncertainAt: new Date(), uncertainRetries: 1 } });
      const results = await Promise.all([1, 2].map(() => api(user.token).post(`/email-applications/${id}/retry`, { acknowledgeDuplicateRisk: true })));
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await row(id)).toMatchObject({ uncertainRetries: 2, deliveryState: 'QUEUED' });
      expect(await view(user)).toMatchObject({ used: 1 });
    });

    it('gives Plus 30 and Premium 100 a month, counts only this month, and keeps documents out of it', async () => {
      const plus = await makeUser();
      await plan(plus.id, 'PLUS');
      expect(await view(plus)).toMatchObject({ plan: 'PLUS', limit: 30, used: 0, remaining: 30 });
      const premium = await makeUser();
      await plan(premium.id, 'PREMIUM');
      expect(await view(premium)).toMatchObject({ plan: 'PREMIUM', limit: 100, remaining: 100 });
      // an application approved in an earlier month does not use this month's allowance
      const free = await makeUser();
      const old = (await approved(free, (await makeJob()).id)).result.body.id;
      await prisma.emailApplication.update({ where: { id: old }, data: { approvedAt: new Date(Date.now() - 45 * 86400_000) } });
      expect(await view(free)).toMatchObject({ used: 0, remaining: 5 });
    });
  });

  // ── Delivery evidence ───────────────────────────────────────────────────
  describe('provider webhooks', () => {
    const hookUrl = () => { const addr = server.address() as { port: number }; return `http://127.0.0.1:${addr.port}/webhooks/resend`; };
    const hook = (type: string, appId: string, messageId: string, extra: object = {}, svixId?: string, opts: object = {}) =>
      provider.emit(hookUrl(), SECRET, { type, messageId, applicationTag: appId, ...extra }, svixId, opts);
    let server: import('http').Server;
    beforeAll(async () => { server = app.getHttpServer(); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); });

    async function sent() {
      const user = await makeUser();
      const job = await makeJob();
      const id = (await approved(user, job.id)).result.body.id;
      await sender.process(id);
      const stored = await row(id);
      return { id, user, job, messageId: stored.providerMessageId! };
    }

    it('rejects unsigned, tampered and replayed requests', async () => {
      const { id, messageId } = await sent();
      expect((await hook('email.delivered', id, messageId, {}, undefined, { tamper: true })).status).toBe(401);
      expect((await hook('email.delivered', id, messageId, {}, undefined, { timestampSeconds: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
      const raw = await fetch(hookUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(raw.status).toBe(401);
      expect((await row(id)).deliveryState).toBe('PROVIDER_ACCEPTED');
    });

    it('marks delivery only on provider evidence, once, however many times the event is replayed', async () => {
      const { id, messageId, user } = await sent();
      expect((await hook('email.delivered', id, messageId, {}, 'svix-delivered-1')).status).toBe(200);
      expect((await hook('email.delivered', id, messageId, {}, 'svix-delivered-1')).status).toBe(200);
      expect(await row(id)).toMatchObject({ deliveryState: 'DELIVERED', recruitmentState: 'SENT' });
      expect(await prisma.emailDeliveryEvent.count({ where: { svixId: 'svix-delivered-1' } })).toBe(1);
      // An open event is not proof of review and changes nothing.
      expect((await hook('email.opened', id, messageId)).status).toBe(200);
      expect(await prisma.emailDeliveryEvent.count({ where: { providerMessageId: messageId, type: 'email.opened' } })).toBe(0);
      expect((await api(user.token).get(`/email-applications/${id}`).expect(200)).body.deliveryState).toBe('DELIVERED');
    });

    it('is not moved backwards by out-of-order events, and suppresses a bounced or complaining recipient', async () => {
      const { id, messageId, job } = await sent();
      await hook('email.bounced', id, messageId, { data: { bounce: { type: 'Permanent' } } });
      await hook('email.delivered', id, messageId); // arrives late
      expect(await row(id)).toMatchObject({ deliveryState: 'BOUNCED', recruitmentState: 'NOT_SENT' });
      expect(await prisma.emailSuppression.findUnique({ where: { email: job.recipient } })).toMatchObject({ reason: 'BOUNCE' });
      const history = await prisma.applicationStatusEvent.findMany({ where: { emailApplicationId: id }, orderBy: { createdAt: 'asc' } });
      expect(history.map((h) => `${h.fromState}>${h.toState}:${h.evidence}`)).toEqual(['NOT_SENT>SENT:PROVIDER_ACCEPTED', 'SENT>NOT_SENT:PROVIDER_EVENT']);
      await hook('email.complained', id, messageId);
      expect((await row(id)).deliveryState).toBe('COMPLAINED');

      const transient = await sent();
      await hook('email.bounced', transient.id, transient.messageId, { data: { bounce: { type: 'Transient' } } });
      expect((await row(transient.id)).deliveryState).toBe('BOUNCED');
      expect(await prisma.emailSuppression.findUnique({ where: { email: transient.job.recipient } })).toBeNull();
    });

    it('resolves an uncertain attempt from provider evidence, and finds an application by its tag when the message id was never stored', async () => {
      const user = await makeUser();
      const id = (await approved(user, (await makeJob()).id)).result.body.id;
      provider.queue('record-then-hang');
      await sender.process(id);
      expect((await row(id)).deliveryState).toBe('UNCERTAIN');
      const messageId = provider.messages[0].id;
      await hook('email.delivered', id, messageId);
      expect(await row(id)).toMatchObject({ deliveryState: 'DELIVERED', recruitmentState: 'SENT', providerMessageId: messageId });
    });

    it('applies an event that arrived before the application row could be matched', async () => {
      const user = await makeUser();
      const id = (await approved(user, (await makeJob()).id)).result.body.id;
      const evidence = app.get(DeliveryEvidenceService);
      const orphan = await prisma.emailDeliveryEvent.create({ data: { svixId: `orphan-${stamp}`, type: 'email.delivered', occurredAt: new Date(), providerMessageId: `fake_orphan_${stamp}` } });
      expect(await evidence.apply(orphan)).toBe('unmatched');
      await sender.process(id);
      await prisma.emailApplication.update({ where: { id }, data: { providerMessageId: `fake_orphan_${stamp}` } });
      expect(await evidence.reconcile(`fake_orphan_${stamp}`)).toBe(1);
      expect((await row(id)).deliveryState).toBe('DELIVERED');
    });
  });

  // ── Recruitment tracking ────────────────────────────────────────────────
  describe('recruitment tracking', () => {
    it('is controlled by the candidate, keeps history with evidence, and validates interview details', async () => {
      const user = await makeUser();
      const id = (await approved(user, (await makeJob()).id)).result.body.id;
      await api(user.token).patch(`/email-applications/${id}/status`, { state: 'ACKNOWLEDGED' }).expect(409); // not sent yet
      await sender.process(id);
      await api(user.token).patch(`/email-applications/${id}/status`, { state: 'HIRED' }).expect(200);
      expect((await row(id)).recruitmentState).toBe('HIRED');
      await api(user.token).patch(`/email-applications/${id}/status`, { state: 'SENT' }).expect(400);

      const second = (await approved(user, (await makeJob()).id)).result.body.id;
      await sender.process(second);
      await api(user.token).patch(`/email-applications/${second}/status`, { state: 'INTERVIEW_SCHEDULED' }).expect(400); // needs date and zone
      await api(user.token).patch(`/email-applications/${second}/status`, { state: 'INTERVIEW_SCHEDULED', interviewAt: '2026-11-20T10:00:00+04:00', interviewTimezone: 'Mars/Olympus' }).expect(400);
      const ok = (await api(user.token).patch(`/email-applications/${second}/status`, { state: 'INTERVIEW_SCHEDULED', interviewAt: '2026-11-20T10:00:00+04:00', interviewTimezone: 'Asia/Baku', interviewNotes: 'Bring ID', reminderOptIn: true, note: 'Phone call' }).expect(200)).body;
      expect(ok).toMatchObject({ recruitmentState: 'INTERVIEW_SCHEDULED', interviewTimezone: 'Asia/Baku', reminderOptIn: true, interviewNotes: 'Bring ID' });
      expect(new Date(ok.interviewAt).toISOString()).toBe('2026-11-20T06:00:00.000Z');
      expect(ok.history.map((h: any) => `${h.from}>${h.to}:${h.evidence}`)).toEqual(['NOT_SENT>SENT:PROVIDER_ACCEPTED', 'SENT>INTERVIEW_SCHEDULED:CANDIDATE_REPORTED']);
      expect(ok.history[1].note).toBe('Phone call');
    });

    it('lets a candidate report a reply for an unconfirmed delivery, because a reply proves it arrived', async () => {
      const user = await makeUser();
      const id = (await approved(user, (await makeJob()).id)).result.body.id;
      provider.queue('record-then-hang');
      await sender.process(id);
      await api(user.token).patch(`/email-applications/${id}/status`, { state: 'SENT' }).expect(400);
      expect((await api(user.token).patch(`/email-applications/${id}/status`, { state: 'ACKNOWLEDGED' }).expect(200)).body.recruitmentState).toBe('ACKNOWLEDGED');
    });
  });

  // ── Optional inbound replies and reminders ──────────────────────────────
  describe('replies and reminders', () => {
    const hookUrl = () => { const addr = app.getHttpServer().address() as { port: number }; return `http://127.0.0.1:${addr.port}/webhooks/resend`; };
    const inbound = (to: string[], data: object = {}, svixId?: string, messageId = `recv_${stamp}_${++counter}`) => provider.emit(hookUrl(), SECRET, { type: 'email.received', messageId, data: { to, from: 'HR Team <hr@employer.example>', subject: 'Re: your application', attachments: [], ...data } }, svixId);
    beforeAll(async () => { const server = app.getHttpServer(); if (!server.address()) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); });
    beforeEach(() => { cfg.inboundEnabled = true; cfg.inboundDomain = 'inbound.example'; mail.send.mockClear(); });
    afterAll(() => { cfg.inboundEnabled = false; cfg.inboundDomain = undefined; });

    async function sentApplication() {
      const user = await makeUser();
      const id = (await approved(user, (await makeJob()).id)).result.body.id;
      await sender.process(id);
      return { user, id, token: (await row(id)).replyToken };
    }

    it('stores only metadata for a reply sent to the per-application address, and suggests a stage without applying it', async () => {
      const { user, id, token } = await sentApplication();
      const view = (await api(user.token).get(`/email-applications/${id}`).expect(200)).body;
      expect(view.inboundAddress).toBe(`track+${token}@inbound.example`);
      const mail1 = `recv_fixed_${stamp}`;
      const res = await inbound([`track+${token}@inbound.example`], { subject: 'Interview invitation - Analyst', attachments: [{ id: 'a1', filename: 'invite.pdf' }, { id: 'a2', filename: 'x.exe' }] }, 'svix-inbound-1', mail1);
      expect(res.status).toBe(200);
      await inbound([`track+${token}@inbound.example`], { subject: 'Interview invitation - Analyst', attachments: [{ id: 'a1', filename: 'invite.pdf' }, { id: 'a2', filename: 'x.exe' }] }, 'svix-inbound-1', mail1); // the provider redelivers the same event
      const replies = (await api(user.token).get(`/email-applications/${id}`).expect(200)).body.replies;
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({ subject: 'Interview invitation - Analyst', suggestedState: 'INTERVIEW_INVITED', status: 'PENDING_REVIEW', attachmentCount: 2 });
      expect(JSON.stringify(replies)).not.toMatch(/invite\.pdf|x\.exe/); // attachments are counted, never kept
      expect((await row(id)).recruitmentState).toBe('SENT'); // a suggestion changes nothing
    });

    it('ignores replies to unknown tokens, to another domain, or when inbound is off', async () => {
      const { user, id, token } = await sentApplication();
      await inbound([`track+${token}@evil.example`]);
      await inbound(['track+nonexistent-token-123@inbound.example']);
      cfg.inboundEnabled = false;
      await inbound([`track+${token}@inbound.example`]);
      cfg.inboundEnabled = true;
      expect(await prisma.emailInboundMessage.count({ where: { emailApplicationId: id } })).toBe(0);
      expect((await api(user.token).get(`/email-applications/${id}`).expect(200)).body.replies).toEqual([]);
    });

    it('applies a suggested stage only when the candidate confirms it, labelled as such; another candidate cannot', async () => {
      const { user, id, token } = await sentApplication();
      await inbound([`track+${token}@inbound.example`], { subject: 'Unfortunately we will not be moving forward' });
      await inbound([`track+${token}@inbound.example`], { subject: 'Thank you for applying' });
      const replies = (await api(user.token).get(`/email-applications/${id}`).expect(200)).body.replies;
      const rejection = replies.find((r: any) => r.suggestedState === 'REJECTED');
      const ack = replies.find((r: any) => r.suggestedState === 'ACKNOWLEDGED');
      const stranger = await makeUser();
      await api(stranger.token).post(`/email-applications/${id}/replies/${rejection.id}`, { accept: true }).expect(404);
      await api(user.token).post(`/email-applications/${id}/replies/${ack.id}`, { accept: false }).expect(200);
      const confirmed = (await api(user.token).post(`/email-applications/${id}/replies/${rejection.id}`, { accept: true }).expect(200)).body;
      expect(confirmed.recruitmentState).toBe('REJECTED');
      expect(confirmed.history.at(-1)).toMatchObject({ to: 'REJECTED', evidence: 'REPLY_CONFIRMED_BY_CANDIDATE' });
      expect(confirmed.replies.map((r: any) => r.status).sort()).toEqual(['CONFIRMED', 'DISMISSED']);
      await api(user.token).post(`/email-applications/${id}/replies/${rejection.id}`, { accept: true }).expect(409);
    });

    it('sends one opt-in reminder to the candidate shortly before a scheduled interview', async () => {
      const { user, id } = await sentApplication();
      const soon = new Date(Date.now() + 6 * 3600_000).toISOString();
      await api(user.token).patch(`/email-applications/${id}/status`, { state: 'INTERVIEW_SCHEDULED', interviewAt: soon, interviewTimezone: 'Asia/Baku', reminderOptIn: false }).expect(200);
      expect(await maintenance.sendDueReminders()).toBe(0); // not opted in
      await api(user.token).patch(`/email-applications/${id}/status`, { reminderOptIn: true }).expect(200);
      expect(await maintenance.sendDueReminders()).toBe(1);
      expect(await maintenance.sendDueReminders()).toBe(0); // once only
      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(mail.send).toHaveBeenCalledWith(user.email, expect.stringContaining('Müsahibə xatırlatması'), expect.not.stringContaining('Bring'));
      // Moving the interview re-arms it; one further than 24 h away is not reminded yet.
      const later = new Date(Date.now() + 72 * 3600_000).toISOString();
      await api(user.token).patch(`/email-applications/${id}/status`, { interviewAt: later, interviewTimezone: 'Asia/Baku' }).expect(200);
      expect(await maintenance.sendDueReminders()).toBe(0);
    });
  });

  // ── Mode B: opt-in automatic applications ───────────────────────────────
  describe('automatic mode', () => {
    const makePremiumUser = async (...args: Parameters<typeof makeUser>) => { const u = await makeUser(...args); await prisma.subscription.create({ data: { userId: u.id, plan: 'PREMIUM', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) } }); return u; };
    const rules = (cvResumeId: string, over: object = {}) => ({
      enabled: true, consent: true, allowedRoles: ['analyst'], allowedLocations: ['Bakı'], excludedEmployers: ['Bad Corp'], dailyLimit: 2, cvResumeId,
      letterTemplate: 'Hello,\nI am applying for {{title}} at {{company}}.\n{{name}}', ...over,
    });
    const baseCv = (userId: string) => prisma.resume.findFirstOrThrow({ where: { userId, isBase: true } });
    const run = async (userId: string, now = new Date()) => automation.runForUser((await prisma.emailApplySettings.findUniqueOrThrow({ where: { userId } })), now);
    const posted = (over: Record<string, unknown> = {}) => makeJob({ location: 'Bakı', ingestedAt: new Date(Date.now() + 1000), description: 'Send your CV to the address', ...over });
    beforeEach(() => { cfg.automationEnabled = true; });
    afterAll(() => { cfg.automationEnabled = false; });

    it('is unavailable unless the deployment enables it, and refuses unsafe or incomplete rules', async () => {
      const user = await makePremiumUser();
      const cv = await baseCv(user.id);
      cfg.automationEnabled = false;
      await api(user.token).put('/email-applications/automation', rules(cv.id)).expect(403);
      cfg.automationEnabled = true;
      await api(user.token).put('/email-applications/automation', rules(cv.id, { consent: false })).expect(400);
      await api(user.token).put('/email-applications/automation', rules(cv.id, { letterTemplate: 'Hi {{salary}}' })).expect(400);
      await api(user.token).put('/email-applications/automation', rules(cv.id, { allowedRoles: [] })).expect(400);
      await api(user.token).put('/email-applications/automation', rules(cv.id, { allowedLocations: [] })).expect(400);
      await api(user.token).put('/email-applications/automation', rules('someone-elses-cv')).expect(400);
      const otherJob = await makeJob();
      const match = await prisma.match.create({ data: { userId: user.id, jobId: otherJob.id, score: 0.5 } });
      const tailored = await prisma.resume.create({ data: { userId: user.id, isBase: false, matchId: match.id, status: 'READY', reviewedAt: new Date(), fileUrl: await storage.uploadBuffer(pdf('t'), 'application/pdf') } });
      await api(user.token).put('/email-applications/automation', rules(tailored.id)).expect(400); // tailored CVs are approved per vacancy
      expect((await api(user.token).get('/email-applications/automation').expect(200)).body).toMatchObject({ available: true, enabled: false });
    });

    it('applies only to new postings that match, using the same approval path, and records why it stopped on the rest', async () => {
      const user = await makePremiumUser();
      const cv = await baseCv(user.id);
      const before = await makeJob({ title: 'Analyst (older)', location: 'Bakı', ingestedAt: new Date(Date.now() - 3600_000) });
      await api(user.token).put('/email-applications/automation', rules(cv.id)).expect(200);
      const match = await posted({ title: 'Credit Analyst' });
      const unknownLocation = await posted({ title: 'Analyst', location: 'Azerbaijan' });
      const wrongRole = await posted({ title: 'Driver' });
      const excluded = await posted({ title: 'Analyst', company: 'Bad Corp LLC' });
      const extra = await posted({ title: 'Analyst', description: 'Send your CV. Include your salary expectation.' });

      expect(await run(user.id)).toEqual({ applied: 1, skipped: 4 });
      const decisions = Object.fromEntries((await prisma.emailAutomationDecision.findMany({ where: { userId: user.id } })).map((d) => [d.jobId, `${d.outcome}:${d.reason}`]));
      expect(decisions).toEqual({ [match.id]: 'APPLIED:RULES_MATCHED', [unknownLocation.id]: 'SKIPPED:LOCATION_UNKNOWN', [wrongRole.id]: 'SKIPPED:ROLE_NOT_ALLOWED', [excluded.id]: 'SKIPPED:EXCLUDED_EMPLOYER', [extra.id]: 'SKIPPED:EXTRA_REQUIREMENTS' });
      expect(await prisma.emailApplication.count({ where: { userId: user.id, jobId: before.id } })).toBe(0);
      expect(await run(user.id)).toEqual({ applied: 0, skipped: 0 }); // nothing is judged twice

      const application = await prisma.emailApplication.findFirstOrThrow({ where: { userId: user.id, jobId: match.id } });
      expect(application).toMatchObject({ mode: 'AUTOMATIC', deliveryState: 'QUEUED', cvKind: 'base', payloadSha256: expect.any(String) });
      expect(application.body).toBe('Hello,\nI am applying for Credit Analyst at ' + match.company + '.\nAysel Məmmədova');
      expect(await sender.process(application.id)).toBe('provider_accepted');
      expect(provider.messages).toHaveLength(1);
      expect(provider.messages[0].attachments[0].content.equals(user.cvBytes!)).toBe(true);
    });

    it('respects the daily limit and stops sending the moment consent, the setting or the global switch changes', async () => {
      const user = await makePremiumUser();
      const cv = await baseCv(user.id);
      await api(user.token).put('/email-applications/automation', rules(cv.id, { dailyLimit: 2 })).expect(200);
      const jobs = [await posted({ title: 'Analyst A' }), await posted({ title: 'Analyst B' }), await posted({ title: 'Analyst C' })];
      expect(await run(user.id)).toEqual({ applied: 2, skipped: 0 });
      const queued = await prisma.emailApplication.findMany({ where: { userId: user.id, mode: 'AUTOMATIC' } });
      expect(queued).toHaveLength(2);
      expect(await prisma.emailAutomationDecision.count({ where: { userId: user.id, jobId: { in: jobs.map((j) => j.id) } } })).toBe(2); // the third is left for tomorrow, not judged

      // The global automation pause holds sending without losing the applications.
      await prisma.featureFlag.upsert({ where: { key: 'email_apply.automation' }, create: { key: 'email_apply.automation', paused: true }, update: { paused: true } });
      expect(await sender.process(queued[0].id)).toBe('held');
      expect((await row(queued[0].id)).holdReason).toBe('AUTOMATION_PAUSED');
      await prisma.featureFlag.update({ where: { key: 'email_apply.automation' }, data: { paused: false } });
      expect(await automation.runAll()).toMatchObject({ users: expect.any(Number) });
      await prisma.featureFlag.update({ where: { key: 'email_apply.automation' }, data: { paused: true } });
      expect(await automation.runAll()).toMatchObject({ users: 0, applied: 0, skipped: 0 });
      await prisma.featureFlag.update({ where: { key: 'email_apply.automation' }, data: { paused: false } });

      // Turning automation off cancels what it queued before it can be sent.
      await api(user.token).post('/email-applications/automation/disable').expect(200);
      expect(await sender.process(queued[0].id, new Date(Date.now() + 10 * 60_000))).toBe('cancelled');
      // Revoking consent cancels the rest and keeps it off.
      const revoked = (await api(user.token).post('/email-applications/settings/revoke-consent').expect(200)).body;
      expect(revoked.settings.automationEnabled).toBe(false);
      expect(await sender.process(queued[1].id)).toBe('skipped');
      expect((await row(queued[1].id)).deliveryState).toBe('CANCELLED');
      expect(provider.messages).toHaveLength(0);
      await prisma.featureFlag.deleteMany({ where: { key: 'email_apply.automation' } });
    });
  });

  describe('review queue (background preparation, candidate approval)', () => {
    const makePremiumUser = async (...args: Parameters<typeof makeUser>) => { const u = await makeUser(...args); await prisma.subscription.create({ data: { userId: u.id, plan: 'PREMIUM', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) } }); return u; };
    const baseCv = (userId: string) => prisma.resume.findFirstOrThrow({ where: { userId, isBase: true } });
    const settings = (userId: string) => prisma.emailApplySettings.findUniqueOrThrow({ where: { userId } });
    const prepareFor = async (userId: string, now = new Date()) => automation.prepareForReview(await settings(userId), now);
    const posted = (over: Record<string, unknown> = {}) => makeJob({ location: 'Bakı', ingestedAt: new Date(Date.now() + 1000), description: 'Send your CV to the address', ...over });
    const turnOn = async (user: { id: string; token: string }, over: object = {}) => {
      const cv = await baseCv(user.id);
      const res = await api(user.token).put('/email-applications/automation', { reviewQueue: true, allowedRoles: ['revizor'], allowedLocations: ['Bakı'], excludedEmployers: ['Bad Corp'], dailyLimit: 5, cvResumeId: cv.id, ...over });
      expect(res.status).toBe(200);
      return res.body;
    };

    it('works without the automatic-sending switch and without a letter template, and sends nothing by itself', async () => {
      cfg.automationEnabled = false;
      const user = await makePremiumUser();
      const older = await makeJob({ title: 'Revizor (older)', location: 'Bakı', ingestedAt: new Date(Date.now() - 3600_000) });
      const on = await turnOn(user);
      expect(on).toMatchObject({ enabled: false, reviewQueue: { available: true, enabled: true, pending: 0 } });
      const match = await posted({ title: 'Credit Revizor' });
      const wrongRole = await posted({ title: 'Driver' });
      const extra = await makeJob({ title: 'Risk Revizor', location: 'Bakı', ingestedAt: new Date(Date.now() + 1000), description: 'Send your CV. Include your salary expectation.' }, { excerpt: 'Send your CV to the address above. Include your salary expectation.' });

      expect((await prepareFor(user.id)).prepared).toBe(2); // other suites' postings may be judged (and skipped) too
      const decisions = Object.fromEntries((await prisma.emailAutomationDecision.findMany({ where: { userId: user.id, jobId: { in: [match.id, extra.id, wrongRole.id] } } })).map((d) => [d.jobId, `${d.outcome}:${d.reason}`]));
      expect(decisions).toEqual({ [match.id]: 'PREPARED:RULES_MATCHED', [extra.id]: 'PREPARED:EXTRA_REQUIREMENTS', [wrongRole.id]: 'SKIPPED:ROLE_NOT_ALLOWED' });
      expect(await prisma.emailApplication.count({ where: { userId: user.id, jobId: older.id } })).toBe(0); // only postings seen after it was turned on

      const rows = await prisma.emailApplication.findMany({ where: { userId: user.id } });
      expect(rows.every((r) => r.mode === 'REVIEW_AND_SEND' && r.deliveryState === 'AWAITING_APPROVAL' && r.preparedByAgentAt && !r.approvedAt && !r.payloadSha256)).toBe(true);
      expect(queue.add).not.toHaveBeenCalled();
      expect(provider.messages).toHaveLength(0);
      // The candidate sees what the posting asks for before deciding.
      const extraView = (await api(user.token).get(`/email-applications/${rows.find((r) => r.jobId === extra.id)!.id}`).expect(200)).body;
      expect(extraView.asksMoreThanCv).toBe(true);
      expect(extraView.preparedByAgentAt).toBeTruthy();

      // One notice for the pass that found something; a repeat finds nothing new and says nothing.
      expect(await prisma.notification.count({ where: { userId: user.id, type: 'AGENT_REVIEW' } })).toBe(1);
      expect(await prepareFor(user.id)).toEqual({ prepared: 0, skipped: 0 });
      expect(await prisma.notification.count({ where: { userId: user.id, type: 'AGENT_REVIEW' } })).toBe(1);
      expect((await api(user.token).get('/email-applications/automation').expect(200)).body.reviewQueue.pending).toBe(2);
    });

    it('is sent only after the candidate approves the exact payload; an edit invalidates an earlier approval hash', async () => {
      const user = await makePremiumUser();
      await turnOn(user);
      const job = await posted({ title: 'Data Revizor' });
      await prepareFor(user.id);
      const draft = await prisma.emailApplication.findFirstOrThrow({ where: { userId: user.id, jobId: job.id } });
      const shown = (await api(user.token).get(`/email-applications/${draft.id}`).expect(200)).body;
      const edited = (await api(user.token).patch(`/email-applications/${draft.id}/draft`, { body: `${shown.body}\n\nP.S. Edited by me.` }).expect(200)).body;
      const stale = await api(user.token).post(`/email-applications/${draft.id}/approve`, { payloadSha256: shown.payloadSha256, consent: true, instructionsAcknowledged: true });
      expect(stale.status).toBeGreaterThanOrEqual(400);
      expect((await row(draft.id)).deliveryState).toBe('AWAITING_APPROVAL');
      await api(user.token).post(`/email-applications/${draft.id}/approve`, { payloadSha256: edited.payloadSha256, consent: true, instructionsAcknowledged: true }).expect(200);
      expect(await sender.process(draft.id)).toBe('provider_accepted');
      expect(provider.messages).toHaveLength(1);
      expect(provider.messages[0].text).toContain('Edited by me');
    });

    it('never touches what the candidate already has for a vacancy, and skips a duplicate of a vacancy already applied to', async () => {
      const user = await makePremiumUser();
      await turnOn(user);
      const mine = await posted({ title: 'Revizor Mine' });
      const own = (await api(user.token).post('/email-applications/prepare', { jobId: mine.id }).expect(200)).body;
      await api(user.token).patch(`/email-applications/${own.id}/draft`, { body: 'My own words.' }).expect(200);
      const original = await posted({ title: 'Revizor Original' });
      await approved(user, original.id);
      const duplicate = await posted({ title: 'Revizor Original', duplicateOfId: original.id });
      await prepareFor(user.id);
      expect((await row(own.id)).body).toBe('My own words.');
      expect((await row(own.id)).preparedByAgentAt).toBeNull();
      expect(await prisma.emailApplication.count({ where: { userId: user.id, jobId: duplicate.id } })).toBe(0);
    });

    it('respects the daily limit and the cap on drafts waiting, and prepares one row when two passes race', async () => {
      const user = await makePremiumUser();
      await turnOn(user, { dailyLimit: 2 });
      await posted({ title: 'Revizor A' }); await posted({ title: 'Revizor B' }); await posted({ title: 'Revizor C' });
      const s = await settings(user.id);
      const [a, b] = await Promise.all([automation.prepareForReview(s), automation.prepareForReview(s)]);
      expect(a.prepared + b.prepared).toBe(2); // one pass did the work, the other found the candidate busy
      const rows = await prisma.emailApplication.findMany({ where: { userId: user.id } });
      expect(new Set(rows.map((r) => r.jobId)).size).toBe(rows.length);
      expect(rows).toHaveLength(2);
      expect(await prepareFor(user.id)).toEqual({ prepared: 0, skipped: 0 }); // the third waits for tomorrow's limit
      // The cap on drafts waiting holds even with a higher daily limit.
      await prisma.emailApplySettings.update({ where: { userId: user.id }, data: { dailyLimit: 10 } });
      for (let i = 0; i < 12; i++) await posted({ title: `Revizor Bulk ${i}` });
      await prepareFor(user.id, new Date(Date.now() + 25 * 3600_000));
      expect(await prisma.emailApplication.count({ where: { userId: user.id, deliveryState: 'AWAITING_APPROVAL', preparedByAgentAt: { not: null } } })).toBe(10);
    });

    it('journey: rules → prepared draft → skip one, approve the other → one send → delivery evidence → tracker; revoked consent stops what is not sent', async () => {
      const server = app.getHttpServer();
      if (!server.listening) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const hookUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/webhooks/resend`;
      const user = await makePremiumUser();
      await turnOn(user);
      const wanted = await posted({ title: 'Journey Revizor' });
      const skipped = await posted({ title: 'Skipped Revizor' });
      const later = await posted({ title: 'Later Revizor' });
      await prepareFor(user.id);
      const drafts = await prisma.emailApplication.findMany({ where: { userId: user.id, jobId: { in: [wanted.id, skipped.id, later.id] } } });
      expect(drafts).toHaveLength(3);
      const byJob = (jobId: string) => drafts.find((d) => d.jobId === jobId)!;

      // Skip: the draft is cancelled and the vacancy is never prepared again.
      await api(user.token).post(`/email-applications/${byJob(skipped.id).id}/cancel`).expect(200);
      await prepareFor(user.id, new Date(Date.now() + 25 * 3600_000));
      expect(await prisma.emailApplication.count({ where: { userId: user.id, jobId: skipped.id } })).toBe(1);
      expect((await row(byJob(skipped.id).id)).deliveryState).toBe('CANCELLED');

      // Approve exactly what was shown; a double click does not send twice.
      const view = (await api(user.token).get(`/email-applications/${byJob(wanted.id).id}`).expect(200)).body;
      const approve = () => api(user.token).post(`/email-applications/${view.id}/approve`, { payloadSha256: view.payloadSha256, consent: true, instructionsAcknowledged: true });
      const [first, second] = await Promise.all([approve(), approve()]);
      expect([first.status, second.status]).toContain(200);
      const approvedRow = await row(view.id);
      expect(approvedRow.payloadSha256).toBe(view.payloadSha256);
      expect(await sender.process(view.id)).toBe('provider_accepted');
      expect(await sender.process(view.id)).not.toBe('provider_accepted');
      expect(provider.messages.filter((m) => m.tags?.application === view.id || m.subject === approvedRow.subject)).toHaveLength(1);

      // Delivery is recorded only from the provider's signed event, then shows in the tracker as system evidence.
      const messageId = (await row(view.id)).providerMessageId!;
      expect((await provider.emit(hookUrl, SECRET, { type: 'email.delivered', messageId, applicationTag: view.id })).status).toBe(200);
      expect((await row(view.id)).deliveryState).toBe('DELIVERED');
      const tracker = (await api(user.token).get('/application-tracker').expect(200)).body;
      const rows = (tracker.rows ?? tracker.items ?? tracker) as { title: string; source: string; evidence: string; stage: string }[];
      const tracked = rows.find((r) => r.title === wanted.title);
      expect(tracked).toBeDefined();
      expect(tracked!.stage).toBe('APPLIED');

      // Revoking consent cancels the draft that was never approved; nothing more is sent.
      await api(user.token).post('/email-applications/settings/revoke-consent').expect(200);
      expect((await row(byJob(later.id).id)).deliveryState).toBe('CANCELLED');
      expect(await prepareFor(user.id, new Date(Date.now() + 50 * 3600_000))).toEqual({ prepared: 0, skipped: 0 });
    });

    it('stops at once when the candidate turns it off, when the operator pauses it, and after a downgrade', async () => {
      const user = await makePremiumUser();
      await turnOn(user);
      await posted({ title: 'Revizor Stop' });
      await prisma.featureFlag.upsert({ where: { key: 'agent.review_queue' }, create: { key: 'agent.review_queue', paused: true }, update: { paused: true } });
      expect(await prepareFor(user.id)).toEqual({ prepared: 0, skipped: 0 });
      await prisma.featureFlag.deleteMany({ where: { key: 'agent.review_queue' } });
      await prisma.subscription.update({ where: { userId: user.id }, data: { plan: 'FREE' } });
      expect(await prepareFor(user.id)).toEqual({ prepared: 0, skipped: 0 });
      await prisma.subscription.update({ where: { userId: user.id }, data: { plan: 'PREMIUM' } });
      await api(user.token).post('/email-applications/automation/review/stop').expect(200);
      expect(await prepareFor(user.id)).toEqual({ prepared: 0, skipped: 0 });
      expect(await prisma.emailApplication.count({ where: { userId: user.id } })).toBe(0);
      cfg.automationEnabled = false;
    });
  });

  // ── The last look before the provider call ──────────────────────────────
  describe('final send gate (controlled barrier between the first checks and the provider call)', () => {
    afterEach(() => { sender.onBeforeFinalCheck = undefined; });
    /** Approve one application, change the world exactly at the barrier, process it, and return what happened. */
    async function atBarrier(change: (ctx: { userId: string; jobId: string; id: string; recipient: string }) => Promise<void>, prep?: (ctx: { userId: string; id: string }) => Promise<void>) {
      const user = await makeUser();
      const job = await makeJob();
      const id = (await approved(user, job.id)).result.body.id;
      await prep?.({ userId: user.id, id });
      sender.onBeforeFinalCheck = async () => { await change({ userId: user.id, jobId: job.id, id, recipient: job.recipient }); };
      const requestsBefore = provider.requests.length;
      const result = await sender.process(id);
      const stored = await row(id);
      const attempts = await prisma.emailSendAttempt.findMany({ where: { emailApplicationId: id } });
      return { result, stored, attempts, providerRequests: provider.requests.length - requestsBefore, user, job };
    }
    const stopped = (o: Awaited<ReturnType<typeof atBarrier>>, reason: string) => {
      expect(o.providerRequests).toBe(0); // a stopped attempt makes no provider request at all
      expect(o.attempts).toHaveLength(1);
      expect(o.attempts[0]).toMatchObject({ outcome: 'REJECTED', errorCode: `stopped_before_send:${reason}` }); // and its history says why
    };

    it.each([
      ['closed', (c: { jobId: string }) => prisma.job.update({ where: { id: c.jobId }, data: { status: 'CLOSED' } })],
      ['expired', (c: { jobId: string }) => prisma.job.update({ where: { id: c.jobId }, data: { deadline: new Date(Date.now() - 1000) } })],
      ['hidden by moderation', (c: { jobId: string }) => prisma.job.update({ where: { id: c.jobId }, data: { hiddenAt: new Date() } })],
    ])('stops when the vacancy is %s after the first checks', async (_name, change) => {
      const o = await atBarrier(async (c) => { await change(c); });
      expect(o.result).toBe('failed');
      expect(o.stored).toMatchObject({ deliveryState: 'FAILED', failureCode: 'JOB_CLOSED' });
      stopped(o, 'JOB_CLOSED');
    });

    it('stops when the recipient becomes suppressed or is no longer authorized', async () => {
      const o = await atBarrier(async (c) => { await prisma.emailSuppression.create({ data: { email: c.recipient, reason: 'BOUNCE' } }); });
      expect(o.result).toBe('failed');
      expect(o.stored.failureCode).toBe('RECIPIENT_SUPPRESSED');
      stopped(o, 'RECIPIENT_SUPPRESSED');
      const saved = { ...cfg };
      const live = new EmailApplicationSender(prisma, storage, flags, { ...cfg, transport: 'live', realRecipients: false, recipientAllowlist: [] }, new ResendTransport(cfg));
      const user = await makeUser(); const job = await makeJob();
      const id = (await approved(user, job.id)).result.body.id;
      live.onBeforeFinalCheck = async () => undefined;
      expect(await live.process(id)).toBe('failed');
      expect((await row(id)).failureCode).toBe('RECIPIENT_NOT_AUTHORIZED');
      Object.assign(cfg, saved);
    });

    it('stops when the candidate pauses or revokes consent, or the operator pauses everything, at the barrier', async () => {
      const paused = await atBarrier(async (c) => { await prisma.emailApplySettings.upsert({ where: { userId: c.userId }, create: { userId: c.userId, sendingPausedAt: new Date() }, update: { sendingPausedAt: new Date() } }); });
      expect(paused.result).toBe('held');
      expect(paused.stored).toMatchObject({ deliveryState: 'QUEUED', holdReason: 'USER_PAUSED' });
      stopped(paused, 'USER_PAUSED');
      const revoked = await atBarrier(async (c) => { await api(paused.user.token); await prisma.emailApplySettings.upsert({ where: { userId: c.userId }, create: { userId: c.userId, consentRevokedAt: new Date(Date.now() + 1000) }, update: { consentRevokedAt: new Date(Date.now() + 1000) } }); });
      expect(revoked.result).toBe('cancelled');
      expect(revoked.stored).toMatchObject({ deliveryState: 'CANCELLED', failureCode: 'CONSENT_REVOKED' });
      stopped(revoked, 'CONSENT_REVOKED');
      const emergency = await atBarrier(async () => { await prisma.featureFlag.upsert({ where: { key: 'email_apply.sending' }, create: { key: 'email_apply.sending', paused: true }, update: { paused: true } }); });
      await prisma.featureFlag.update({ where: { key: 'email_apply.sending' }, data: { paused: false } });
      expect(emergency.result).toBe('held');
      expect(emergency.stored.holdReason).toBe('EMERGENCY_PAUSE');
      stopped(emergency, 'EMERGENCY_PAUSE');
    });

    it('stops an automatic application when automation permission is withdrawn at the barrier', async () => {
      cfg.automationEnabled = true;
      const o = await atBarrier(
        async (c) => { await prisma.emailApplySettings.update({ where: { userId: c.userId }, data: { automationEnabled: false } }); },
        async (c) => { await prisma.subscription.upsert({ where: { userId: c.userId }, create: { userId: c.userId, plan: 'PREMIUM', status: 'active' }, update: { plan: 'PREMIUM', status: 'active' } }); await prisma.emailApplySettings.upsert({ where: { userId: c.userId }, create: { userId: c.userId, automationEnabled: true, consentVersion: AUTOMATION_CONSENT_VERSION }, update: { automationEnabled: true, consentVersion: AUTOMATION_CONSENT_VERSION } }); await prisma.emailApplication.update({ where: { id: c.id }, data: { mode: 'AUTOMATIC' } }); },
      );
      cfg.automationEnabled = false;
      expect(o.result).toBe('cancelled');
      expect(o.stored).toMatchObject({ deliveryState: 'CANCELLED', failureCode: 'AUTOMATION_DISABLED' });
      stopped(o, 'AUTOMATION_DISABLED');
    });

    it('stops when the posting changes the address or the instructions after approval', async () => {
      const addr = await atBarrier(async (c) => { await prisma.job.update({ where: { id: c.jobId }, data: { applicationEmail: 'someone-else@employer.example' } }); });
      expect(addr.stored.failureCode).toBe('RECIPIENT_CHANGED');
      stopped(addr, 'RECIPIENT_CHANGED');
      const instr = await atBarrier(async (c) => {
        const job = await prisma.job.findUniqueOrThrow({ where: { id: c.jobId } });
        // the posting's own text changes: the instruction block the candidate approved is no longer what it says
        await prisma.job.update({ where: { id: c.jobId }, data: { description: `Do NOT attach a CV; apply on our site. (${job.applicationEmail})`, applicationEmailEvidence: { ...(job.applicationEmailEvidence as object), excerpt: 'Do NOT attach a CV; apply on our site.' } } });
      });
      expect(instr.stored.failureCode).toBe('INSTRUCTIONS_CHANGED');
      stopped(instr, 'INSTRUCTIONS_CHANGED');
    });

    it('stops when the approved fields were altered in the database at the barrier', async () => {
      const o = await atBarrier(async (c) => { await prisma.emailApplication.update({ where: { id: c.id }, data: { body: 'Altered after approval' } }); });
      expect(o.stored.failureCode).toBe('INTEGRITY_MISMATCH');
      stopped(o, 'INTEGRITY_MISMATCH');
    });

    it('refuses account deletion while a send is in flight, and sends once the attempt is past that point', async () => {
      const deletion = new AccountDeletionService(prisma, storage, { cancelForDeletion: async () => undefined } as any, { deleteSession: async () => undefined } as any, { capture: () => { throw new Error('analytics down'); } } as any);
      let refused: unknown;
      const o = await atBarrier(async (c) => { refused = await deletion.deleteUser(c.userId, { kind: 'self' }).catch((e) => e); });
      expect((refused as Error).constructor.name).toBe('ConflictException');
      expect(o.result).toBe('provider_accepted'); // the claim came first, so the send was not interrupted
      expect(provider.messages.at(-1)?.tags.application).toBe(o.stored.id);
    });
  });

  // ── Account deletion and the e-mail pipeline ────────────────────────────
  describe('account deletion', () => {
    const deleter = (analyticsDown = false) => new AccountDeletionService(prisma, storage, { cancelForDeletion: async () => undefined } as any, { deleteSession: async () => undefined } as any, { capture: () => { if (analyticsDown) throw new Error('analytics down'); } } as any);

    it('removes queued applications and their private CV copies; nothing is sent afterwards; a failing analytics call does not undo a completed deletion', async () => {
      const user = await makeUser();
      const id = (await approved(user, (await makeJob()).id)).result.body.id;
      const snapshot = (await row(id)).cvSnapshotUrl!;
      const result = await deleter(true).deleteUser(user.id, { kind: 'self' });
      expect(result).toMatchObject({ success: true, unconfirmedEmailApplications: 0 });
      expect(await prisma.emailApplication.count({ where: { id } })).toBe(0);
      expect(fs.existsSync(path.join(process.cwd(), 'uploads', ...snapshot.split('/')))).toBe(false);
      expect(await sender.process(id)).toBe('skipped');
      expect(provider.messages).toHaveLength(0);
    });

    it('is coordinated with a worker claim: whoever locks first wins, and a deleted application is never sent', async () => {
      const user = await makeUser();
      const id = (await approved(user, (await makeJob()).id)).result.body.id;
      // Deletion holds the row locks inside its transaction while a worker tries to claim.
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const tx = prisma.$transaction(async (t) => {
        await t.$queryRaw`SELECT "deliveryState" FROM "EmailApplication" WHERE "userId" = ${user.id} FOR UPDATE`;
        await held;
        await t.user.delete({ where: { id: user.id } });
      });
      await new Promise((r) => setTimeout(r, 200));
      const claim = sender.process(id);
      await new Promise((r) => setTimeout(r, 300)); // the claim is blocked behind the lock
      release();
      await tx;
      expect(await claim).toBe('skipped');
      expect(provider.messages).toHaveLength(0);
    });

    it('reports honestly when an unconfirmed send existed, and late webhooks neither recreate records nor expose anything', async () => {
      const user = await makeUser();
      const id = (await approved(user, (await makeJob()).id)).result.body.id;
      provider.queue('record-then-hang');
      await sender.process(id);
      const messageId = provider.messages[0].id;
      const result = await deleter().deleteUser(user.id, { kind: 'self' });
      expect(result.unconfirmedEmailApplications).toBe(1); // it may have reached the employer; deletion cannot recall it
      const server = app.getHttpServer(); if (!server.address()) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/webhooks/resend`;
      const res = await provider.emit(url, SECRET, { type: 'email.delivered', messageId, applicationTag: id });
      expect(res.status).toBe(200);
      expect(await prisma.emailApplication.count({ where: { id } })).toBe(0);
      const events = await prisma.emailDeliveryEvent.findMany({ where: { providerMessageId: messageId } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ emailApplicationId: null, applied: false });
    });
  });

  // ── Duplication, crash recovery and webhook correlation audit ───────────
  describe('duplication and evidence audit', () => {
    const hookUrl = () => { const server = app.getHttpServer(); return `http://127.0.0.1:${(server.address() as { port: number }).port}/webhooks/resend`; };
    beforeAll(async () => { const server = app.getHttpServer(); if (!server.address()) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); });

    it('does not let a cross-source repeat of one vacancy produce a second application, even after the link is released', async () => {
      const user = await makeUser();
      const a = await makeJob({ title: 'Duplicate Vacancy Analyst' });
      const b = await prisma.job.create({ data: { externalId: `eatest:${stamp}-dupB${++counter}`, title: 'Duplicate Vacancy Analyst', company: a.company, description: a.description, location: 'Bakı', url: 'https://other-board.example/1', postedAt: new Date('2026-09-21T00:00:00Z'), applicationMethod: 'EMAIL', applicationEmail: a.recipient, applicationEmailEvidence: a.applicationEmailEvidence as object, duplicateOfId: a.id } });
      jobIds.push(b.id);
      await approved(user, a.id);
      expect((await api(user.token).post('/email-applications/prepare', { jobId: b.id }).expect(409)).body.message).toMatch(/JOB_NOT_OPEN|ALREADY_APPLIED/);
      await prisma.job.update({ where: { id: b.id }, data: { duplicateOfId: null } }); // the primary closed and the link was released
      expect((await api(user.token).post('/email-applications/prepare', { jobId: b.id }).expect(409)).body.message).toContain('ALREADY_APPLIED');
      expect(await prisma.emailApplication.count({ where: { userId: user.id } })).toBe(1);
    });

    it('lets only one of two concurrent approvals for the same vacancy through', async () => {
      const user = await makeUser();
      const a = await makeJob({ title: 'Concurrent Vacancy' });
      const b = await prisma.job.create({ data: { externalId: `eatest:${stamp}-conB${++counter}`, title: 'Concurrent Vacancy', company: a.company, description: a.description, location: 'Bakı', url: 'https://other-board.example/2', postedAt: new Date('2026-09-21T00:00:00Z'), applicationMethod: 'EMAIL', applicationEmail: a.recipient, applicationEmailEvidence: a.applicationEmailEvidence as object } });
      jobIds.push(b.id);
      const pa = (await api(user.token).post('/email-applications/prepare', { jobId: a.id }).expect(200)).body;
      const pb = (await api(user.token).post('/email-applications/prepare', { jobId: b.id }).expect(200)).body;
      const body = (v: { payloadSha256: string }) => ({ payloadSha256: v.payloadSha256, consent: true, instructionsAcknowledged: true });
      const results = await Promise.all([api(user.token).post(`/email-applications/${pa.id}/approve`, body(pa)), api(user.token).post(`/email-applications/${pb.id}/approve`, body(pb))]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it('treats a crash after the provider took the message as uncertain; the candidate retry reuses the key within the provider window and a new key after it, always with acknowledgment', async () => {
      const user = await makeUser();
      const id = (await approved(user, (await makeJob()).id)).result.body.id;
      const original = (sender as any).record.bind(sender);
      (sender as any).record = async () => { throw new Error('worker died after the provider call'); };
      expect(await sender.process(id)).toBe('uncertain');
      (sender as any).record = original;
      expect(provider.messages).toHaveLength(1);
      expect((await row(id)).failureCode).toBe('worker_interrupted');
      await api(user.token).post(`/email-applications/${id}/retry`, { acknowledgeDuplicateRisk: false }).expect(400);
      await api(user.token).post(`/email-applications/${id}/retry`, { acknowledgeDuplicateRisk: true }).expect(200);
      expect(await sender.process(id)).toBe('provider_accepted');
      expect(provider.messages).toHaveLength(1); // same key inside the window: recognised, not duplicated

      // Outside the provider's 24 h memory a new key is unavoidable: the candidate is told and must still acknowledge.
      const second = (await approved(user, (await makeJob()).id)).result.body.id;
      provider.queue('record-then-hang');
      await sender.process(second);
      const before = (await row(second)).generation;
      await prisma.emailApplication.update({ where: { id: second }, data: { uncertainAt: new Date(Date.now() - 21 * 3600_000) } });
      await api(user.token).post(`/email-applications/${second}/retry`, { acknowledgeDuplicateRisk: true }).expect(200);
      expect((await row(second)).generation).toBe(before + 1);
    });

    it('accepts only evidence that is consistent with the application: the right message, tag and recipient', async () => {
      const user = await makeUser();
      const job = await makeJob();
      const id = (await approved(user, job.id)).result.body.id;
      await sender.process(id);
      const messageId = (await row(id)).providerMessageId!;
      const other = await makeUser();
      const otherId = (await approved(other, (await makeJob()).id)).result.body.id;
      await sender.process(otherId);
      const emit = (type: string, over: { messageId?: string; tag?: string; to?: string[]; data?: object } = {}) =>
        provider.emit(hookUrl(), SECRET, { type, messageId: over.messageId ?? messageId, applicationTag: over.tag ?? id, to: over.to ?? [job.recipient], data: over.data });
      // The candidate's own copy delivering or bouncing is not the employer's delivery or bounce.
      await emit('email.bounced', { to: [user.email], data: { bounce: { type: 'Permanent' } } });
      expect((await row(id)).deliveryState).toBe('PROVIDER_ACCEPTED');
      expect(await prisma.emailSuppression.count({ where: { email: { in: [user.email, job.recipient] } } })).toBe(0);
      // A message id that belongs to another application, with this application's tag, is rejected.
      await emit('email.delivered', { messageId: (await row(otherId)).providerMessageId! });
      expect((await row(id)).deliveryState).toBe('PROVIDER_ACCEPTED');
      expect((await row(otherId)).deliveryState).toBe('PROVIDER_ACCEPTED');
      // A tag for one application with a message id that is not its own is rejected too.
      await emit('email.delivered', { messageId: 'fake_not-this-one' });
      expect((await row(id)).deliveryState).toBe('PROVIDER_ACCEPTED');
      // Consistent evidence counts, once; "delivered" never becomes an employer reply, interview or offer.
      await emit('email.delivered');
      expect(await row(id)).toMatchObject({ deliveryState: 'DELIVERED', recruitmentState: 'SENT' });
      await emit('email.opened');
      expect((await row(id)).recruitmentState).toBe('SENT');
      expect(await prisma.applicationStatusEvent.count({ where: { emailApplicationId: id, toState: { in: ['ACKNOWLEDGED', 'INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED', 'OFFER', 'HIRED'] } } })).toBe(0);
      const recorded = await prisma.emailDeliveryEvent.findMany({ where: { detail: { in: ['inconsistent_correlation', 'recipient_mismatch'] }, providerMessageId: { in: [messageId, (await row(otherId)).providerMessageId!, 'fake_not-this-one'] } } });
      expect(recorded.map((r) => r.detail).sort()).toEqual(['inconsistent_correlation', 'inconsistent_correlation', 'recipient_mismatch']);
    });

    it('keeps the strongest valid evidence when events arrive early, twice and out of order', async () => {
      const user = await makeUser();
      const job = await makeJob();
      const id = (await approved(user, job.id)).result.body.id;
      await sender.process(id);
      const messageId = (await row(id)).providerMessageId!;
      const e = (type: string, svix: string, data?: object) => provider.emit(hookUrl(), SECRET, { type, messageId, applicationTag: id, to: [job.recipient], data }, svix);
      await e('email.complained', 'svix-a-1');
      await e('email.delivered', 'svix-a-2');
      await e('email.delivered', 'svix-a-2');
      await e('email.bounced', 'svix-a-3', { bounce: { type: 'Permanent' } });
      await e('email.sent', 'svix-a-4');
      expect((await row(id)).deliveryState).toBe('COMPLAINED');
      expect(await prisma.emailDeliveryEvent.count({ where: { svixId: 'svix-a-2' } })).toBe(1);
    });
  });

  describe('approved letter attachment, listing evidence and send-time rechecks', () => {
    /** A motivation letter the candidate approved for `jobId`, recorded the way the documents pipeline records it (READY file + APPROVED snapshot). */
    async function approvedLetter(userId: string, jobId: string, marker = 'letter') {
      const match = await prisma.match.upsert({ where: { userId_jobId: { userId, jobId } }, update: {}, create: { userId, jobId, score: 0.7 } });
      const bytes = pdf(`${marker}-${++counter}`);
      const letter = await prisma.resume.create({ data: { userId, isBase: false, docKind: 'LETTER', matchId: match.id, status: 'READY', reviewedAt: new Date(), fileUrl: await storage.uploadBuffer(bytes, 'application/pdf'), parsedContent: {} } });
      await prisma.documentSnapshot.create({ data: { resumeId: letter.id, revision: 0, kind: 'APPROVED', content: {}, contentHash: sha256Hex(marker), fileSha256: sha256Hex(bytes) } });
      return { letter, bytes };
    }
    const body = (v: { payloadSha256: string }) => ({ payloadSha256: v.payloadSha256, consent: true, instructionsAcknowledged: true });

    it('shows where the address came from, then sends exactly the approved CV and letter, and the approval is bound to both', async () => {
      const user = await makeUser();
      const job = await makeJob();
      const { letter, bytes } = await approvedLetter(user.id, job.id);
      const view = (await api(user.token).post('/email-applications/prepare', { jobId: job.id, letterId: letter.id }).expect(200)).body;
      expect(view.recipientEvidence).toMatchObject({ sourceUrl: job.url, observedAt: job.lastSeenAt.toISOString(), listedAt: job.postedAt.toISOString(), excerpt: expect.stringContaining(job.recipient) });
      expect(view.attachments.map((a: any) => a.role)).toEqual(['cv', 'letter']);
      expect(view.letter).toMatchObject({ resumeId: letter.id, fileName: 'Motivation-letter-Aysel-Mmmdova.pdf', sha256: sha256Hex(bytes) });
      expect(view.sharing.join(' ')).toContain('motivasiya');
      expect((await api(user.token).get(`/email-applications/${view.id}/letter`).expect(200)).body.equals(bytes)).toBe(true);

      // The hash the candidate approves covers the letter: the hash of the same application without it is different.
      const without = (await api(user.token).patch(`/email-applications/${view.id}/draft`, { removeLetter: true }).expect(200)).body;
      expect(without.letter).toBeNull();
      expect(without.payloadSha256).not.toBe(view.payloadSha256);
      await api(user.token).post(`/email-applications/${view.id}/approve`, body(view)).expect(409); // the preview the candidate saw is stale
      const again = (await api(user.token).patch(`/email-applications/${view.id}/draft`, { letterId: letter.id }).expect(200)).body;
      expect(again.payloadSha256).toBe(view.payloadSha256);

      const result = await api(user.token).post(`/email-applications/${view.id}/approve`, body(again)).expect(200);
      expect(result.body.payloadSha256).toBe(view.payloadSha256);
      expect(await sender.process(view.id)).toBe('provider_accepted');
      const sent = provider.messages[0];
      expect(sent.attachments.map((a) => a.filename)).toEqual(['CV-Aysel-Mmmdova.pdf', 'Motivation-letter-Aysel-Mmmdova.pdf']);
      expect(sent.attachments[0].content.equals(user.cvBytes!)).toBe(true);
      expect(sent.attachments[1].content.equals(bytes)).toBe(true);
      expect(await row(view.id)).toMatchObject({ letterSha256: sha256Hex(bytes), letterBytes: bytes.length });
    });

    it('keeps an application without a letter hashing and sending exactly as before', async () => {
      const user = await makeUser();
      const job = await makeJob();
      const { prepared, result } = await approved(user, job.id);
      expect(prepared.letter).toBeNull();
      expect(result.body.payloadSha256).toBe(prepared.payloadSha256);
      expect(await sender.process(result.body.id)).toBe('provider_accepted');
      expect(provider.messages[0].attachments).toHaveLength(1);
    });

    it('refuses a letter that is not approved, not a letter, for another vacancy, someone else\'s, or changed since the preview', async () => {
      const user = await makeUser();
      const other = await makeUser();
      const job = await makeJob();
      const otherJob = await makeJob();
      const prepare = (letterId: string, token = user.token) => api(token).post('/email-applications/prepare', { jobId: job.id, letterId });
      const mine = await approvedLetter(user.id, job.id);
      const unapproved = await approvedLetter(user.id, job.id, 'unapproved');
      await prisma.resume.update({ where: { id: unapproved.letter.id }, data: { reviewedAt: null, status: 'NEEDS_REVIEW' } });
      expect((await prepare(unapproved.letter.id).expect(400)).body.message).toContain('LETTER_NOT_APPROVED');
      const forOther = await approvedLetter(user.id, otherJob.id);
      expect((await prepare(forOther.letter.id).expect(400)).body.message).toContain('LETTER_WRONG_JOB');
      await prepare(mine.letter.id, other.token).expect(404);
      const cvRow = await prisma.resume.findFirstOrThrow({ where: { userId: user.id, isBase: true } });
      await prepare(cvRow.id).expect(404); // a base CV is not a letter
      const tailoredCv = await prisma.resume.create({ data: { userId: user.id, isBase: false, matchId: mine.letter.matchId, status: 'READY', reviewedAt: new Date(), fileUrl: await storage.uploadBuffer(pdf('tcv'), 'application/pdf') } });
      expect((await prepare(tailoredCv.id).expect(400)).body.message).toContain('WRONG_DOCUMENT_KIND');
      // A letter cannot stand in for the CV either.
      expect((await api(user.token).post('/email-applications/prepare', { jobId: job.id, resumeId: mine.letter.id }).expect(400)).body.message).toContain('WRONG_DOCUMENT_KIND');
      // A file that is not the one that was approved (the snapshot says otherwise) is refused.
      const tampered = await approvedLetter(user.id, job.id, 'tampered');
      await prisma.documentSnapshot.updateMany({ where: { resumeId: tampered.letter.id }, data: { fileSha256: sha256Hex('some other file') } });
      expect((await prepare(tampered.letter.id).expect(400)).body.message).toContain('LETTER_NOT_APPROVED');

      // Replaced after the preview: approval refuses and nothing is queued.
      const view = (await prepare(mine.letter.id).expect(200)).body;
      const fresh = pdf('replaced');
      await prisma.documentSnapshot.updateMany({ where: { resumeId: mine.letter.id }, data: { fileSha256: sha256Hex(fresh) } });
      await prisma.resume.update({ where: { id: mine.letter.id }, data: { fileUrl: await storage.uploadBuffer(fresh, 'application/pdf') } });
      expect((await api(user.token).post(`/email-applications/${view.id}/approve`, body(view)).expect(409)).body.message).toContain('LETTER_CHANGED');
      expect((await row(view.id)).deliveryState).toBe('AWAITING_APPROVAL');
      expect(provider.messages).toHaveLength(0);
    });

    it('is not offered, prepared or sent from a listing no import has seen for the configured age', async () => {
      const user = await makeUser();
      const stale = await makeJob({ lastSeenAt: new Date(Date.now() - 40 * 24 * 3600_000) });
      expect((await api(user.token).get(`/email-applications/eligibility/${stale.id}`).expect(200)).body).toMatchObject({ eligible: false, reason: 'LISTING_STALE' });
      await api(user.token).post('/email-applications/prepare', { jobId: stale.id }).expect(409);

      // Approved while fresh, but the listing goes stale before the worker gets to it: it is not sent and says why.
      const job = await makeJob();
      const id = (await approved(user, job.id)).result.body.id;
      await prisma.job.update({ where: { id: job.id }, data: { lastSeenAt: new Date(Date.now() - 40 * 24 * 3600_000) } });
      expect(await sender.process(id)).toBe('failed');
      expect(await row(id)).toMatchObject({ deliveryState: 'FAILED', failureCode: 'LISTING_STALE' });
      expect(provider.messages).toHaveLength(0);
    });

    it('does not send when another listing of the same vacancy was sent in the meantime, nor when the address was never verified', async () => {
      const user = await makeUser();
      const a = await makeJob({ title: 'Recheck Duplicate' });
      const b = await prisma.job.create({ data: { externalId: `eatest:${stamp}-rcB${++counter}`, title: 'Recheck Duplicate', company: a.company, description: a.description, location: 'Bakı', url: 'https://other-board.example/9', postedAt: new Date('2026-09-21T00:00:00Z'), applicationMethod: 'EMAIL', applicationEmail: a.recipient, applicationEmailEvidence: a.applicationEmailEvidence as object } });
      jobIds.push(b.id);
      const ida = (await approved(user, a.id)).result.body.id;
      // A second application to the repeat listing exists only through a race the approval lock normally prevents; force it to prove the sender's own check.
      const second = await prisma.emailApplication.create({ data: { ...(await row(ida)), id: undefined as never, jobId: b.id, providerMessageId: null, replyToken: undefined as never, deliveryState: 'QUEUED' } as never });
      expect(await sender.process(ida)).toBe('provider_accepted');
      expect(await sender.process(second.id)).toBe('failed');
      expect((await row(second.id)).failureCode).toBe('DUPLICATE_APPLICATION');
      expect(provider.messages).toHaveLength(1);

      const unverified = await makeUser();
      const job = await makeJob();
      const idu = (await approved(unverified, job.id)).result.body.id;
      await prisma.user.update({ where: { id: unverified.id }, data: { emailVerified: null } });
      expect(await sender.process(idu)).toBe('failed');
      expect((await row(idu)).failureCode).toBe('EMAIL_NOT_VERIFIED');
    });

    it('removes the private letter copy when an application is cancelled or its retention ends, and with the account', async () => {
      const user = await makeUser();
      const job = await makeJob();
      const { letter } = await approvedLetter(user.id, job.id);
      const view = (await api(user.token).post('/email-applications/prepare', { jobId: job.id, letterId: letter.id }).expect(200)).body;
      const queued = (await api(user.token).post(`/email-applications/${view.id}/approve`, body(view)).expect(200)).body;
      const stored = await row(queued.id);
      expect(stored.letterSnapshotUrl).toBeTruthy();
      await storage.readPrivate(stored.letterSnapshotUrl!);
      await api(user.token).post(`/email-applications/${queued.id}/cancel`).expect(200);
      expect((await row(queued.id)).letterSnapshotUrl).toBeNull();
      await expect(storage.readPrivate(stored.letterSnapshotUrl!)).rejects.toBeTruthy();

      const job2 = await makeJob();
      const l2 = await approvedLetter(user.id, job2.id);
      const v2 = (await api(user.token).post('/email-applications/prepare', { jobId: job2.id, letterId: l2.letter.id }).expect(200)).body;
      const id2 = (await api(user.token).post(`/email-applications/${v2.id}/approve`, body(v2)).expect(200)).body.id;
      await sender.process(id2);
      const key = (await row(id2)).letterSnapshotUrl!;
      await prisma.emailApplication.update({ where: { id: id2 }, data: { updatedAt: new Date(Date.now() - 400 * 24 * 3600_000) } });
      // updatedAt is managed by Prisma; set it directly so the retention window has passed.
      await prisma.$executeRaw`UPDATE "EmailApplication" SET "updatedAt" = now() - interval '400 days' WHERE id = ${id2}`;
      expect(await maintenance.purgeExpiredSnapshots(new Date())).toBeGreaterThanOrEqual(1);
      expect(await row(id2)).toMatchObject({ cvSnapshotUrl: null, letterSnapshotUrl: null });
      await expect(storage.readPrivate(key)).rejects.toBeTruthy();
    });

    it('labels evidence honestly: provider acceptance, delivery and a candidate-reported outcome stay separate, and nothing is employer-confirmed by itself', async () => {
      const user = await makeUser();
      const job = await makeJob();
      const id = (await approved(user, job.id)).result.body.id;
      await sender.process(id);
      const view = (await api(user.token).get(`/email-applications/${id}`).expect(200)).body;
      expect(view.evidence).toMatchObject({ providerAcceptedAt: expect.any(String), deliveredAt: null });
      expect(view.recruitment).toMatchObject({ state: 'SENT', evidence: 'PROVIDER_ACCEPTED', employerConfirmed: false });
      await api(user.token).patch(`/email-applications/${id}/status`, { state: 'ACKNOWLEDGED' }).expect(200);
      const after = (await api(user.token).get(`/email-applications/${id}`).expect(200)).body;
      expect(after.recruitment).toMatchObject({ state: 'ACKNOWLEDGED', evidence: 'CANDIDATE_REPORTED', employerConfirmed: false });
      expect(after.evidence.deliveredAt).toBeNull(); // reporting an outcome does not fabricate delivery evidence
    });
  });
  describe('Premium sender aliases with a local capture provider', () => {
    const premium = async () => {
      const u = await makeUser();
      await prisma.subscription.create({ data: { userId: u.id, plan: 'PREMIUM', status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) } });
      return u;
    };
    beforeEach(() => { cfg.candidateAliasesEnabled = true; });
    afterAll(() => { cfg.candidateAliasesEnabled = false; });
    it('shows the approved alias, sends from it and keeps replies on the verified personal address', async () => {
      const u = await premium(); const job = await makeJob(); const { prepared, result } = await approved(u, job.id);
      expect(result.status).toBe(200);
      expect(prepared.senderAddress).toMatch(/^aysel\.memmedova\.[a-f0-9]+@aisehr\.com$/);
      expect(await sender.process(prepared.id)).toBe('provider_accepted');
      expect(provider.messages).toHaveLength(1);
      expect(provider.messages[0]).toMatchObject({ from: expect.stringContaining(prepared.senderAddress), replyTo: u.email });
    });
    it('refuses a sender address changed after approval without contacting the provider', async () => {
      const u = await premium(); const job = await makeJob(); const { prepared } = await approved(u, job.id);
      await prisma.emailApplication.update({ where: { id: prepared.id }, data: { senderEmail: 'forged@aisehr.com' } });
      expect(await sender.process(prepared.id)).toBe('failed');
      expect((await row(prepared.id)).failureCode).toBe('INTEGRITY_MISMATCH');
      expect(provider.messages).toHaveLength(0);
    });
    it('stops alias sending after a downgrade and leaves Free reviewed sends on the normal sender', async () => {
      const u = await premium(); const job = await makeJob(); const { prepared } = await approved(u, job.id);
      await prisma.subscription.update({ where: { userId: u.id }, data: { plan: 'FREE' } });
      expect(await sender.process(prepared.id)).toBe('cancelled'); expect(provider.messages).toHaveLength(0);
      const free = await makeUser(); const another = await makeJob(); const other = await approved(free, another.id);
      expect(other.prepared.senderAddress).toBeNull(); expect(await sender.process(other.prepared.id)).toBe('provider_accepted');
      expect(provider.messages[0].from).toContain('applications@aise.example');
    });
    it('blocks a Free candidate from enabling automatic sending even when the environment enables it', async () => {
      const u = await makeUser(); cfg.automationEnabled = true;
      try { await api(u.token).put('/email-applications/automation', { enabled: true, consent: true }).expect(403); }
      finally { cfg.automationEnabled = false; }
    });
  });

  describe('free tracker with real database and session ownership', () => {
    it('creates, edits, personalizes and exports on Free, isolates users and preserves concurrent cell changes', async () => {
      const free = await makeUser(); const other = await makeUser();
      await request(app.getHttpServer()).get('/application-tracker').expect(401);
      const created = (await api(free.token).post('/application-tracker', { title: 'Analyst', company: 'Acme' }).expect(201)).body;
      const endpoint = `/application-tracker/${encodeURIComponent(created.key)}`;
      await api(other.token).patch(endpoint, { notes: 'not mine' }).expect(404);
      await api(free.token).put('/application-tracker/columns', { columns: [{ id: 'c_contact', name: 'Əlaqə' }, { id: 'c_followup', name: 'İzləmə' }] }).expect(200);
      await Promise.all([
        api(free.token).patch(endpoint, { notes: 'Spoke to Leyla', custom: { c_contact: 'Leyla' } }).expect(200),
        api(free.token).patch(endpoint, { stage: 'INTERVIEW', custom: { c_followup: 'Friday' } }).expect(200),
      ]);
      const listing = (await api(free.token).get('/application-tracker').expect(200)).body;
      expect(listing.rows).toEqual([expect.objectContaining({ key: created.key, notes: 'Spoke to Leyla', stage: 'INTERVIEW', custom: { c_contact: 'Leyla', c_followup: 'Friday' }, evidence: 'CANDIDATE_REPORTED' })]);
      await api(free.token).patch(endpoint, { url: 'javascript:alert(1)' }).expect(400);
      await api(free.token).patch(endpoint, { title: '=HYPERLINK("bad")' }).expect(200);
      const csv = await api(free.token).get('/application-tracker/export.csv').expect(200);
      expect(csv.text).toContain("'=HYPERLINK"); expect(csv.text).toContain('Leyla');
      expect((await api(other.token).get('/application-tracker').expect(200)).body.rows).toEqual([]);
      await api(free.token).patch(endpoint, { hidden: true }).expect(200);
      expect((await api(free.token).get('/application-tracker').expect(200)).body.total).toBe(0);
      await api(free.token).patch(endpoint, { hidden: false }).expect(200);
      expect((await api(free.token).get('/application-tracker').expect(200)).body.total).toBe(1);
    });
    it('adds and updates an AISE application automatically while retaining personal notes', async () => {
      const user = await makeUser(); const job = await makeJob();
      const { prepared } = await approved(user, job.id);
      const key = `email:${prepared.id}`;
      await api(user.token).patch(`/application-tracker/${encodeURIComponent(key)}`, { notes: 'My note' }).expect(200);
      expect(await sender.process(prepared.id)).toBe('provider_accepted');
      const listed = (await api(user.token).get('/application-tracker').expect(200)).body.rows;
      expect(listed).toContainEqual(expect.objectContaining({ key, notes: 'My note', evidence: 'PROVIDER_ACCEPTED', stage: 'APPLIED' }));
    });
    it('shows candidate-reported applications without claiming portal evidence', async () => {
      const user = await makeUser(); const job = await makeJob();
      const match = await prisma.match.create({ data: { userId: user.id, jobId: job.id, status: 'APPLIED', score: 0.5 } });
      const listed = (await api(user.token).get('/application-tracker').expect(200)).body.rows;
      expect(listed).toEqual([expect.objectContaining({ key: `reported:${match.id}`, stage: 'APPLIED', evidence: 'CANDIDATE_REPORTED', date: '' })]);
    });
  });

});
