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
import { AuthModule } from '../src/auth/auth.module';
import { TimelineModule } from '../src/application-timeline/timeline.module';
import { JobApplicationsModule } from '../src/job-applications/job-applications.module';
import { JobApplicationsService } from '../src/job-applications/job-applications.service';
import { OutcomeStatsService } from '../src/application-timeline/outcome-stats.service';

// Application timeline, evidence separation and candidate-entered outcomes over the real routes and the isolated aise_phase2_test database.
const stamp = `${Date.now()}`;
const prefix = `aise-timeline-${stamp}`;
const mail = (who: string) => `aise-timeline-${who}-${stamp}@example.com`;
const DAY = 86_400_000;

describe('application timeline and outcome evidence (isolated synthetic data)', () => {
  let app: INestApplication; let server: any; let prisma: PrismaService;
  const env = { ...process.env };

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Refusing to run outside the isolated local aise_phase2_test');
    process.env.DATABASE_URL = db.toString();
    Object.assign(process.env, { NODE_ENV: 'test', RESEND_API_KEY: 're_mock_key', MATCHING_SERVICE_URL: 'http://127.0.0.1:9', APPLY_WORKER_URL: 'http://127.0.0.1:9', DODO_PAYMENTS_API_KEY: '' });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, EmailModule, AuthModule, TimelineModule, JobApplicationsModule,
    ] }).compile();
    app = module.createNestApplication({ logger: ['error'], bodyParser: false });
    app.use(express.json()); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init(); server = app.getHttpServer(); prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
      await prisma.business.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
      await prisma.job.deleteMany({ where: { externalId: { startsWith: `tl-${stamp}` } } });
    }
    await app?.close();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 }); const keys = await redis.keys(`${prefix}:*`); if (keys.length) await redis.del(...keys); await redis.quit();
    process.env = { ...env };
  }, 60_000);

  async function user(who: string) {
    const u = await prisma.user.create({ data: { email: mail(who), hashedPassword: await bcrypt.hash('Synthetic-Candidate-1', 4), emailVerified: new Date(), subscription: { create: { plan: 'FREE', status: 'active' } } } });
    const token = randomBytes(32).toString('hex'); await prisma.session.create({ data: { sessionToken: token, userId: u.id, expires: new Date(Date.now() + 3_600_000) } });
    return { u, auth: { Authorization: `Bearer ${token}` } };
  }
  let n = 0;
  async function job() { const i = ++n; return prisma.job.create({ data: { externalId: `tl-${stamp}-${i}`, title: `Vakansiya ${i}`, company: 'Tl MMC', description: 'x', location: 'Bakı', url: `https://example.invalid/${stamp}/${i}`, postedAt: new Date(), companyKey: 'tl' } as any }); }
  const emailApp = (userId: string, extra: Record<string, unknown> = {}) => prisma.emailApplication.create({ data: { userId, jobTitle: 'Mühasib', jobCompany: 'Tl MMC', jobUrl: 'https://example.invalid/x', recipient: 'hr@example.invalid', recipientEvidence: {}, subject: 's', subjectSource: 'generated', body: 'b', bodySha256: 'x', replyTo: 'c@example.invalid', senderName: 'Candidate', cvKind: 'base', cvFileName: 'cv.pdf', cvMimeType: 'application/pdf', cvPreviewSha256: 'x', ...extra } as any });
  const timeline = async (auth: any) => (await request(server).get('/applications/timeline').set(auth).expect(200)).body as any[];
  const find = (tl: any[], id: string) => tl.find((e) => e.applicationId === id)!;
  const keys = (e: any) => e.stages.map((s: any) => s.key);
  async function nativeApp(userId: string) {
    const biz = await prisma.business.create({ data: { email: mail(`biz${++n}`), hashedPassword: 'x', emailVerified: new Date() } });
    const company = await prisma.company.create({ data: { businessId: biz.id, name: `Native Co ${n}`, status: 'APPROVED' } });
    const vac = await prisma.vacancy.create({ data: { companyId: company.id, title: 'Native vakansiya', status: 'ACTIVE' } });
    const application = await prisma.application.create({ data: { vacancyId: vac.id, userId, status: 'APPLIED' } });
    return { application, company };
  }
  async function externalApp(userId: string, status: string, extra: Record<string, unknown> = {}) {
    const j = await job();
    const match = await prisma.match.create({ data: { userId, jobId: j.id, score: 0.9, details: {} as any } });
    return prisma.externalApplication.create({ data: { matchId: match.id, userId, status: status as any, applyUrl: 'https://example.invalid/apply', submittedAt: ['SUBMITTED', 'DELIVERY_UNCONFIRMED', 'SUBMITTED_DRY_RUN'].includes(status) ? new Date(Date.now() - 10 * DAY) : null, ...extra } });
  }

  it('requires a session and shows each owner only their own applications', async () => {
    await request(server).get('/applications/timeline').expect(401);
    await request(server).post('/applications/native/x/outcome').send({ outcome: 'INTERVIEW' }).expect(401);
    const a = await user('own-a'); const b = await user('own-b');
    const e = await emailApp(a.u.id);
    expect(await timeline(b.auth)).toEqual([]);
    expect(find(await timeline(a.auth), e.id)).toBeTruthy();
    await request(server).post(`/applications/native/${e.id}/outcome`).set(b.auth).send({ outcome: 'INTERVIEW' }).expect(404); // not B's, not even a native id
  });

  it('keeps draft, approved, provider accepted, delivered, reply, interview and offer distinct for e-mail, and infers nothing', async () => {
    const a = await user('email');
    const t0 = new Date(Date.now() - 10 * DAY);
    const draft = await emailApp(a.u.id, { deliveryState: 'AWAITING_APPROVAL' });
    const accepted = await emailApp(a.u.id, { deliveryState: 'PROVIDER_ACCEPTED', recruitmentState: 'SENT', approvedAt: t0, providerAcceptedAt: t0 });
    const delivered = await emailApp(a.u.id, { deliveryState: 'DELIVERED', recruitmentState: 'SENT', approvedAt: t0, providerAcceptedAt: t0, deliveredAt: t0 });
    const bounced = await emailApp(a.u.id, { deliveryState: 'BOUNCED', approvedAt: t0, providerAcceptedAt: t0, bouncedAt: t0 });
    const uncertain = await emailApp(a.u.id, { deliveryState: 'UNCERTAIN', approvedAt: t0, uncertainAt: t0 });
    const tl = await timeline(a.auth);
    expect(keys(find(tl, draft.id))).toEqual(['DRAFT']);
    expect(find(tl, draft.id).nextActions[0]).toMatchObject({ key: 'review_and_approve' });
    expect(keys(find(tl, accepted.id))).toEqual(['DRAFT', 'APPROVED', 'PROVIDER_ACCEPTED']);
    const pa = find(tl, accepted.id).stages.find((s: any) => s.key === 'PROVIDER_ACCEPTED');
    expect(pa).toMatchObject({ evidence: 'PROVIDER' });
    expect(pa.note).toContain('not proof of delivery');
    expect(keys(find(tl, delivered.id))).toEqual(['DRAFT', 'APPROVED', 'PROVIDER_ACCEPTED', 'DELIVERED']);
    for (const e of [accepted, delivered]) {
      expect(keys(find(tl, e.id))).not.toContain('INTERVIEW'); // delivery, even years of silence, never implies an interview
      expect(keys(find(tl, e.id))).not.toContain('REPLY_RECEIVED');
      expect(find(tl, e.id).nextActions.map((x: any) => x.key)).toContain('report_outcome'); // a useful next step; nothing is sent for the candidate
    }
    expect(find(tl, bounced.id).problem).toMatchObject({ key: 'BOUNCED', evidence: 'PROVIDER' });
    expect(find(tl, uncertain.id).nextActions[0].key).toBe('check_before_deciding');
    expect(find(tl, uncertain.id).nextActions[0].note).toContain('never re-sends');
    // A candidate-reported interview appears as exactly that.
    await prisma.applicationStatusEvent.create({ data: { emailApplicationId: delivered.id, fromState: 'SENT', toState: 'INTERVIEW_INVITED', evidence: 'CANDIDATE_REPORTED' } });
    await prisma.applicationStatusEvent.create({ data: { emailApplicationId: delivered.id, fromState: 'INTERVIEW_INVITED', toState: 'OFFER', evidence: 'REPLY_CONFIRMED_BY_CANDIDATE' } });
    await prisma.emailApplication.update({ where: { id: delivered.id }, data: { recruitmentState: 'OFFER' } });
    const after = find(await timeline(a.auth), delivered.id);
    expect(after.stages.filter((s: any) => ['INTERVIEW', 'OFFER'].includes(s.key)).map((s: any) => s.evidence)).toEqual(['CANDIDATE_REPORTED', 'CANDIDATE_REPORTED']);
    expect(after.current).toBe('OFFER');
    expect(after.nextActions.map((x: any) => x.key)).not.toContain('report_outcome');
    expect(await prisma.emailSendAttempt.count({ where: { emailApplication: { userId: a.u.id } } })).toBe(0); // reading the timeline sends nothing
  });

  it('separates the employer\'s own status change from what the candidate reports (native)', async () => {
    const a = await user('native');
    const { application, company } = await nativeApp(a.u.id);
    let e = find(await timeline(a.auth), application.id);
    expect(keys(e)).toEqual(['DELIVERED']);
    expect(e.stages[0]).toMatchObject({ evidence: 'SYSTEM' });
    const svc = app.get(JobApplicationsService);
    await svc.updateStatus(application.id, company.id, 'REVIEWING');
    e = find(await timeline(a.auth), application.id);
    expect(e.stages.find((s: any) => s.key === 'IN_REVIEW')).toMatchObject({ evidence: 'EMPLOYER_CONFIRMED' });
    expect(keys(e)).not.toContain('INTERVIEW');
    await svc.updateStatus(application.id, company.id, 'INTERVIEW'); // the employer's own action in AISE
    e = find(await timeline(a.auth), application.id);
    expect(e.stages.filter((s: any) => s.key === 'INTERVIEW').map((s: any) => s.evidence)).toEqual(['EMPLOYER_CONFIRMED']);
    expect(await prisma.applicationOutcomeEvent.count({ where: { applicationId: application.id, evidence: 'EMPLOYER_CONFIRMED', outcome: 'INTERVIEW' } })).toBe(1);
    await svc.updateStatus(application.id, company.id, 'INTERVIEW'); // repeating it does not duplicate the evidence
    expect(await prisma.applicationOutcomeEvent.count({ where: { applicationId: application.id, evidence: 'EMPLOYER_CONFIRMED', outcome: 'INTERVIEW' } })).toBe(1);
    // The candidate adds their own report: a separate stage with its own evidence label, never merged.
    const rep = (await request(server).post(`/applications/native/${application.id}/outcome`).set(a.auth).send({ outcome: 'INTERVIEW', note: 'Telefonla zəng etdilər' }).expect(201)).body;
    expect(rep.created).toBe(true);
    e = find(await timeline(a.auth), application.id);
    expect(e.stages.filter((s: any) => s.key === 'INTERVIEW').map((s: any) => s.evidence).sort()).toEqual(['CANDIDATE_REPORTED', 'EMPLOYER_CONFIRMED']);
    expect((await request(server).post(`/applications/native/${application.id}/outcome`).set(a.auth).send({ outcome: 'INTERVIEW' }).expect(201)).body).toMatchObject({ id: rep.id, created: false });
    // A rejection by the employer shows as a closing state with employer evidence.
    await svc.updateStatus(application.id, company.id, 'REJECTED');
    expect(find(await timeline(a.auth), application.id).problem).toMatchObject({ key: 'REJECTED', evidence: 'EMPLOYER_CONFIRMED' });
  });

  it('handles external applications honestly: dry runs and drafts have no outcome, unconfirmed receipts say so', async () => {
    const a = await user('external');
    const draft = await externalApp(a.u.id, 'READY_FOR_REVIEW');
    const dry = await externalApp(a.u.id, 'SUBMITTED_DRY_RUN');
    const unconfirmed = await externalApp(a.u.id, 'DELIVERY_UNCONFIRMED');
    const done = await externalApp(a.u.id, 'SUBMITTED');
    const tl = await timeline(a.auth);
    expect(keys(find(tl, draft.id))).toEqual(['DRAFT']);
    expect(find(tl, dry.id).dryRun).toBe(true);
    expect(keys(find(tl, dry.id))).not.toContain('DELIVERED');
    expect(find(tl, unconfirmed.id).problem).toMatchObject({ key: 'UNCONFIRMED' });
    expect(find(tl, unconfirmed.id).nextActions[0].key).toBe('check_source_site');
    expect(keys(find(tl, unconfirmed.id))).not.toContain('DELIVERED');
    expect(find(tl, done.id).stages.find((s: any) => s.key === 'DELIVERED')).toMatchObject({ evidence: 'PROVIDER' });
    expect(find(tl, done.id).nextActions.map((x: any) => x.key)).toContain('report_outcome');
    await request(server).post(`/applications/external/${draft.id}/outcome`).set(a.auth).send({ outcome: 'INTERVIEW' }).expect(400);
    await request(server).post(`/applications/external/${dry.id}/outcome`).set(a.auth).send({ outcome: 'INTERVIEW' }).expect(400);
    await request(server).post(`/applications/external/${done.id}/outcome`).set(a.auth).send({ outcome: 'INTERVIEW' }).expect(201);
    const e = find(await timeline(a.auth), done.id);
    expect(e.stages.find((s: any) => s.key === 'INTERVIEW')).toMatchObject({ evidence: 'CANDIDATE_REPORTED', note: 'entered by the candidate' });
    expect(e.nextActions).toEqual([]);
  });

  it('validates candidate-entered outcomes', async () => {
    const a = await user('validate'); const x = await externalApp(a.u.id, 'SUBMITTED');
    const post = (body: any, channel = 'external', id = x.id) => request(server).post(`/applications/${channel}/${id}/outcome`).set(a.auth).send(body);
    await post({ outcome: 'MAGIC' }).expect(400);
    await post({ outcome: 'interview' }).expect(400);
    await post({}).expect(400);
    await post({ outcome: 'INTERVIEW', occurredAt: new Date(Date.now() + 10 * DAY).toISOString() }).expect(400);
    await post({ outcome: 'INTERVIEW', occurredAt: 'yesterday' }).expect(400);
    await post({ outcome: 'INTERVIEW', note: 'x'.repeat(501) }).expect(400);
    await post({ outcome: 'INTERVIEW' }, 'email').expect(400);
    await post({ outcome: 'INTERVIEW' }, 'external', 'does-not-exist').expect(404);
    await post({ outcome: 'OFFER', occurredAt: new Date(Date.now() - DAY).toISOString(), note: 'təklif aldım' }).expect(201);
  });

  it('counts interview evidence by who supplied it, never summed and never as rates', async () => {
    const stats = app.get(OutcomeStatsService);
    const before = await stats.summary();
    const a = await user('stats');
    const e1 = await emailApp(a.u.id, { deliveryState: 'DELIVERED', cvKind: 'tailored' });
    await prisma.applicationStatusEvent.create({ data: { emailApplicationId: e1.id, toState: 'INTERVIEW_SCHEDULED', evidence: 'CANDIDATE_REPORTED' } });
    const { application, company } = await nativeApp(a.u.id);
    await app.get(JobApplicationsService).updateStatus(application.id, company.id, 'INTERVIEW');
    const x = await externalApp(a.u.id, 'SUBMITTED');
    await request(server).post(`/applications/external/${x.id}/outcome`).set(a.auth).send({ outcome: 'INTERVIEW' }).expect(201);
    await request(server).post(`/applications/native/${application.id}/outcome`).set(a.auth).send({ outcome: 'INTERVIEW' }).expect(201);
    const after = await stats.summary();
    expect(after.email.interviewCandidateConfirmed - before.email.interviewCandidateConfirmed).toBe(1);
    expect(after.email.interviewCandidateConfirmedTailoredCv - before.email.interviewCandidateConfirmedTailoredCv).toBe(1);
    expect(after.native.interviewEmployerConfirmed - before.native.interviewEmployerConfirmed).toBe(1);
    expect(after.native.interviewCandidateReportedOnly - before.native.interviewCandidateReportedOnly).toBe(0); // that application also has employer evidence
    expect(after.external.interviewCandidateConfirmed - before.external.interviewCandidateConfirmed).toBe(1);
    expect(after.external.interviewEmployerConfirmed).toBe(0);
    expect(after.note).toContain('not additive');
    expect(Object.values(after.email).concat(Object.values(after.native), Object.values(after.external)).every((v) => Number.isInteger(v))).toBe(true);
    const allKeys = JSON.stringify(after, (k, v) => (k ? (k.match(/rate|percent|ratio/i) ? 'RATE_KEY' : v) : v));
    expect(allKeys).not.toContain('RATE_KEY'); // counts only: no key named like a rate, percentage or ratio
  });

  it('removes outcome events with the account', async () => {
    const a = await user('gone'); const x = await externalApp(a.u.id, 'SUBMITTED');
    await request(server).post(`/applications/external/${x.id}/outcome`).set(a.auth).send({ outcome: 'REJECTED' }).expect(201);
    expect(await prisma.applicationOutcomeEvent.count({ where: { userId: a.u.id } })).toBe(1);
    await prisma.user.delete({ where: { id: a.u.id } });
    expect(await prisma.applicationOutcomeEvent.count({ where: { userId: a.u.id } })).toBe(0);
  });
});
