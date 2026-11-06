import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import IORedis from 'ioredis';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { EmailModule } from '../src/common/email.module';
import { AdminModule } from '../src/admin/admin.module';
import { ADDED_VERIFIED_EMPLOYERS, EMPLOYER_TARGETS } from '../src/scrapers/public-jobs/employer-registry';
import { AuthModule } from '../src/auth/auth.module';
import { JobsModule } from '../src/jobs/jobs.module';
import { ExternalApplyModule } from '../src/external-apply/external-apply.module';

// Operator views over sources and e-mail applications, over the real admin routes.
// Synthetic rows only, in the isolated aise_phase2_test. Evidence level: local database, no provider.

const stamp = `${Date.now()}`;
const prefix = `aise-emailops-${stamp}`;
const password = 'Synthetic-Ops-Pass-1';
const mail = (who: string) => `aise-emailops-${who}-${stamp}@example.com`;
const SECRET_BODY = `private-letter-text-${stamp}`;
const SECRET_SUBJECT = `private-subject-${stamp}`;

describe('admin source and e-mail application operations (isolated synthetic data)', () => {
  let app: INestApplication, server: any, prisma: PrismaService;
  const env = { ...process.env };
  const tokens: Record<string, string> = {};
  let userId: string, jobId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Refusing ops test outside isolated local aise_phase2_test');
    process.env.DATABASE_URL = db.toString();
    Object.assign(process.env, { NODE_ENV: 'test', RESEND_API_KEY: 're_mock_key', EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_TRANSPORT: 'sink', MATCHING_SERVICE_URL: 'http://127.0.0.1:9', APPLY_WORKER_URL: 'http://127.0.0.1:9' });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, EmailModule, AdminModule, AuthModule, JobsModule, ExternalApplyModule,
    ] }).compile();
    app = module.createNestApplication({ logger: ['error'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'] as const) {
      await prisma.adminUser.create({ data: { email: mail(role.toLowerCase()), hashedPassword: await bcrypt.hash(password, 4), role } });
      tokens[role] = (await request(server).post('/admin/auth/login').send({ email: mail(role.toLowerCase()), password }).expect(200)).body.sessionToken;
    }
    userId = (await prisma.user.create({ data: { email: `aisecand-${stamp}@example.com`, hashedPassword: 'x', name: 'Candidate' } })).id;
    jobId = (await prisma.job.create({ data: { externalId: `emailops:${stamp}`, title: 'Ops role', company: 'Ops Co', description: 'd', location: 'Bakı', url: 'https://example.org/x', postedAt: new Date() } })).id;
    const base = { userId, jobTitle: 'Ops role', jobCompany: 'Ops Co', jobUrl: 'https://example.org/x', recipientEvidence: {}, subject: SECRET_SUBJECT, subjectSource: 'generated', body: SECRET_BODY, bodySha256: 'a', replyTo: `aisecand-${stamp}@example.com`, senderName: 'Candidate', cvKind: 'base', cvFileName: 'cv.pdf', cvMimeType: 'application/pdf', cvPreviewSha256: 'b' };
    const make = async (name: string, data: Record<string, unknown>) => {
      ids[name] = (await prisma.emailApplication.create({ data: { ...base, recipient: `hr-${name}-${stamp}@employer.example`, jobId: name === 'uncertain' ? jobId : undefined, ...data } as any })).id;
    };
    const now = new Date();
    await make('uncertain', { deliveryState: 'UNCERTAIN', approvedAt: new Date(now.getTime() - 3600_000), uncertainAt: new Date(now.getTime() - 3600_000), failureCode: 'timeout', attemptCount: 1 });
    await make('delivered', { deliveryState: 'DELIVERED', recruitmentState: 'INTERVIEW_SCHEDULED', approvedAt: now, providerAcceptedAt: now, deliveredAt: now });
    await make('bounced', { deliveryState: 'BOUNCED', approvedAt: now, providerAcceptedAt: now, bouncedAt: now });
    await make('queued', { deliveryState: 'QUEUED', approvedAt: now, queuedAt: new Date(now.getTime() - 120_000), holdReason: 'DAILY_LIMIT' });
    for (const [name, to] of [['delivered', 'SENT'], ['delivered', 'INTERVIEW_SCHEDULED']] as const) await prisma.applicationStatusEvent.create({ data: { emailApplicationId: ids[name], fromState: 'NOT_SENT', toState: to, evidence: 'CANDIDATE_REPORTED' } });
    await prisma.emailDeliveryEvent.create({ data: { svixId: `svix-${stamp}`, emailApplicationId: ids.bounced, providerMessageId: `m-${stamp}`, type: 'email.bounced', occurredAt: now, applied: true, detail: 'Permanent' } });
    await prisma.emailSendAttempt.create({ data: { emailApplicationId: ids.uncertain, generation: 1, number: 1, idempotencyKey: `k-${stamp}`, outcome: 'AMBIGUOUS', errorCode: 'timeout' } });
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      const admins = (await prisma.adminUser.findMany({ where: { email: { contains: `-${stamp}@` } }, select: { id: true } })).map((u) => u.id);
      await prisma.adminAuditLog.deleteMany({ where: { adminUserId: { in: admins } } });
      await prisma.adminUser.deleteMany({ where: { id: { in: admins } } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.job.deleteMany({ where: { id: jobId } });
      await prisma.featureFlag.deleteMany({});
    }
    await app?.close();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    process.env = { ...env };
  }, 60_000);

  const as = (role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT') => ({ Authorization: `Bearer ${tokens[role]}` });

  it('requires an operator session', async () => {
    for (const url of ['/admin/ops/sources', '/admin/ops/email', '/admin/ops/email/funnel', `/admin/email-applications/${ids.uncertain}`]) await request(server).get(url).expect(401);
  });

  it('reports source coverage with registered targets kept apart from integrated sources', async () => {
    const res = await request(server).get('/admin/ops/sources').set(as('SUPPORT')).expect(200);
    // The original requested list (100 employers, 9 with an adapter) is frozen; verified additions are declared in the registry and each has an adapter.
    const added = EMPLOYER_TARGETS.filter((t) => ADDED_VERIFIED_EMPLOYERS.includes(t.id));
    expect(added).toHaveLength(ADDED_VERIFIED_EMPLOYERS.length);
    expect(added.every((t) => t.adapter)).toBe(true);
    expect(res.body).toMatchObject({ registeredEmployerTargets: 100 + added.length, employerTargetsWithAdapter: 9 + added.length });
    expect(res.body.sources.map((s: any) => s.key)).toEqual(expect.arrayContaining(['glorri', 'hellojob', 'smartjob', 'boss', 'work', 'abb', 'pwc', 'socar', 'azercell', 'ey', 'halliburton', 'pasha-holding', 'yelo']));
    expect(res.body.sources[0]).toHaveProperty('counts.open');
    expect(res.body.caveats.join(' ')).toMatch(/not a complete inventory/);
  });

  it('shows queue health, uncertain attempts and aggregate delivery counts without any correspondence', async () => {
    const res = await request(server).get('/admin/ops/email').set(as('SUPPORT')).expect(200);
    expect(res.body.config).toMatchObject({ enabled: true, transport: 'sink', realRecipientsAuthorized: false, automationAvailable: false });
    expect(res.body.queue).toMatchObject({ queued: expect.any(Number), held: expect.objectContaining({ DAILY_LIMIT: expect.any(Number) }) });
    expect(res.body.states.total).toMatchObject({ UNCERTAIN: expect.any(Number), DELIVERED: expect.any(Number), BOUNCED: expect.any(Number) });
    expect(res.body.delivery7d).toMatchObject({ providerAccepted: expect.any(Number), bounced: expect.any(Number) });
    expect(res.body.delivery7d.note).toMatch(/not delivery/);
    expect(res.body.attemptFailures24h).toMatchObject({ timeout: expect.any(Number) });
    const uncertain = res.body.uncertain.find((u: any) => u.reason === 'timeout');
    expect(uncertain).toMatchObject({ recipientDomain: 'employer.example', candidate: 'a***@example.com', jobTitle: 'Ops role', attempts: 1 });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(SECRET_BODY);
    expect(text).not.toContain(SECRET_SUBJECT);
    expect(text).not.toContain(`hr-uncertain-${stamp}`);
    expect(res.body.flags.map((f: any) => f.key)).toEqual(expect.arrayContaining(['email_apply.sending', 'email_apply.automation']));
  });

  it('computes a funnel from events without personal data', async () => {
    const res = await request(server).get('/admin/ops/email/funnel?days=7').set(as('ADMIN')).expect(200);
    const stage = (name: string) => res.body.stages.find((s: any) => s.stage === name);
    expect(stage('viewed')).toMatchObject({ count: null });
    expect(stage('prepared').count).toBeGreaterThanOrEqual(4);
    expect(stage('delivered').count).toBeGreaterThanOrEqual(1);
    expect(stage('interview').count).toBeGreaterThanOrEqual(1);
    expect(stage('hired').count).toBe(0);
    expect(JSON.stringify(res.body)).not.toMatch(/@|example\.com/);
  });

  it('shows one application as metadata only, and audits the lookup', async () => {
    const res = await request(server).get(`/admin/email-applications/${ids.bounced}`).set(as('SUPPORT')).expect(200);
    expect(res.body).toMatchObject({ deliveryState: 'BOUNCED', recipientDomain: 'employer.example', contentAvailableToOperators: false });
    expect(res.body.events).toEqual([expect.objectContaining({ type: 'email.bounced', detail: 'Permanent', applied: true })]);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(SECRET_BODY);
    expect(text).not.toContain(SECRET_SUBJECT);
    expect(text).not.toMatch(/cvSnapshot|replyTo|hr-bounced/);
    const audit = await prisma.adminAuditLog.findFirst({ where: { action: 'EMAIL_APPLICATION_VIEWED', targetId: ids.bounced } });
    expect(audit).toBeTruthy();
    await request(server).get('/admin/email-applications/does-not-exist').set(as('SUPPORT')).expect(404);
  });

  it('lets only an operator with control rights use the global e-mail emergency pause, with a reason, audited', async () => {
    await request(server).put('/admin/ops/features/email_apply.sending').set(as('SUPPORT')).send({ paused: true, reason: 'x' }).expect(403);
    await request(server).put('/admin/ops/features/email_apply.sending').set(as('ADMIN')).send({ paused: true }).expect(400);
    const res = await request(server).put('/admin/ops/features/email_apply.sending').set(as('ADMIN')).send({ paused: true, reason: 'Provider incident' }).expect(200);
    expect(res.body.find((f: any) => f.key === 'email_apply.sending')).toMatchObject({ paused: true, reason: 'Provider incident' });
    expect(await prisma.adminAuditLog.count({ where: { action: 'FEATURE_PAUSED', targetId: 'email_apply.sending' } })).toBe(1);
    await request(server).put('/admin/ops/features/email_apply.sending').set(as('ADMIN')).send({ paused: false }).expect(200);
  });

  it('controls a source schedule only for reviewed collectors, never Glorri or a restricted source, with bounds and audit', async () => {
    const put = (key: string, body: object, role: 'ADMIN' | 'SUPPORT' = 'ADMIN') => request(server).put(`/admin/ops/sources/${key}/schedule`).set(as(role)).send(body);
    await put('hellojob', { scheduled: true }, 'SUPPORT').expect(403);
    await put('glorri', { scheduled: true }).expect(400);
    await put('nosuch', { scheduled: true }).expect(404);
    await put('hellojob', { intervalMinutes: 30 }).expect(400); // never more often than every six hours
    await put('hellojob', { scheduled: true, intervalMinutes: 720 }).expect(200);
    await prisma.jobSource.update({ where: { key: 'pwc' }, data: { accessReview: 'RESTRICTED' } });
    await put('pwc', { scheduled: true }).expect(400);
    await prisma.jobSource.update({ where: { key: 'pwc' }, data: { accessReview: 'ROBOTS_ALLOWED_TERMS_PENDING' } });
    const listed = (await request(server).get('/admin/ops/sources').set(as('SUPPORT')).expect(200)).body.sources.find((s: any) => s.key === 'hellojob');
    expect(listed.schedule).toMatchObject({ mode: 'scheduled', intervalMinutes: 720, staleness: 'never_completed' });
    await put('hellojob', { paused: true }).expect(200);
    expect((await request(server).get('/admin/ops/sources').set(as('SUPPORT'))).body.sources.find((s: any) => s.key === 'hellojob').schedule.mode).toBe('paused');
    await put('hellojob', { scheduled: false, paused: false, intervalMinutes: 1440 }).expect(200);
    expect(await prisma.adminAuditLog.count({ where: { action: 'SOURCE_SCHEDULE_CHANGED', targetId: 'hellojob' } })).toBe(3);
  });
});
