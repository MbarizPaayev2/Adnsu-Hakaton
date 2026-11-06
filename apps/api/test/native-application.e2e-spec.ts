import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { AuthModule } from '../src/auth/auth.module';
import { BusinessModule } from '../src/business/business.module';
import { AdminModule } from '../src/admin/admin.module';
import { VacanciesModule } from '../src/vacancies/vacancies.module';
import { JobApplicationsModule } from '../src/job-applications/job-applications.module';
import { ResumesModule } from '../src/resumes/resumes.module';
import { UploadsModule } from '../src/uploads/uploads.module';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { EmailService } from '../src/common/email.service';
import { extractAuthLink } from '../src/common/email-link.util';
import { LocalStorageService } from '../src/resumes/local-storage.service';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const stamp = `${Date.now()}`;
const password = 'Native-App-1x';
const queuePrefix = `aise-native-${stamp}`;

function docx(marker: string): Buffer {
  const name = Buffer.from('word/document.xml');
  const body = Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Leyla Huseynova</w:t></w:r></w:p><w:p><w:r><w:t>${marker}</w:t></w:r></w:p></w:body></w:document>`);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + body.length, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}

async function download(server: any, token: string, fileUrl: string) {
  return request(server).get(fileUrl).set('Authorization', `Bearer ${token}`)
    .buffer(true).parse((incoming, done) => {
      const parts: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => parts.push(chunk));
      incoming.on('end', () => done(null, Buffer.concat(parts)));
    });
}

describe('native candidate → employer application (isolated synthetic data)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: EmailService;
  let storage: LocalStorageService;
  const candidateEmail = `aise-native-c-${stamp}@example.com`;
  const otherEmail = `aise-native-other-${stamp}@example.com`;
  const employerEmail = `aise-native-e-${stamp}@example.com`;
  const otherEmployerEmail = `aise-native-e2-${stamp}@example.com`;
  const adminEmail = `aise-native-admin-${stamp}@example.com`;
  const destinationEmail = `aise-native-inbox-${stamp}@example.com`;
  const uploadDir = path.join(process.cwd(), 'uploads');
  let initialFiles: Set<string>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 're_mock_key';
    process.env.FRONTEND_URL = 'http://127.0.0.1:3450';
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || (db.pathname !== '/aise_phase2_test' && !/^\/aise_release_test_[0-9]+$/.test(db.pathname))) {
      throw new Error('Refusing native application test outside isolated local aise_phase2_test');
    }
    process.env.DATABASE_URL = db.toString();
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      // Own queue prefix: vacancy creation enqueues matching jobs no worker here consumes.
      BullModule.forRoot({ prefix: queuePrefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, AuthModule, BusinessModule, AdminModule,
      VacanciesModule, JobApplicationsModule, ResumesModule, UploadsModule,
    ] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    mail = app.get(EmailService);
    storage = app.get(LocalStorageService);
    initialFiles = new Set(fs.readdirSync(uploadDir));
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      const candidates = await prisma.user.findMany({ where: { email: { in: [candidateEmail, otherEmail] } }, include: { resumes: true, applications: { include: { files: true } } } });
      const urls = candidates.flatMap((u) => [
        ...u.resumes.map((r) => r.fileUrl),
        ...u.applications.flatMap((a) => a.files.map((f) => f.fileUrl)),
      ]);
      const companyIds = await prisma.company.findMany({ where: { business: { email: { in: [employerEmail, otherEmployerEmail] } } }, select: { id: true } }).then((rows) => rows.map((r) => r.id));
      await prisma.application.deleteMany({ where: { userId: { in: candidates.map((u) => u.id) } } });
      await prisma.user.deleteMany({ where: { email: { in: [candidateEmail, otherEmail] } } });
      await prisma.business.deleteMany({ where: { email: { in: [employerEmail, otherEmployerEmail] } } });
      await prisma.adminAuditLog.deleteMany({ where: { targetType: 'Company', targetId: { in: companyIds } } }).catch(() => undefined);
      await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
      for (const url of urls) if (url) await storage.deleteFile(url);
    }
    await app?.close();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${queuePrefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  }, 60_000);

  it('approves an employer through admin auth, publishes, submits one immutable CV, and shows status', async () => {
    const server = app.getHttpServer();
    const bearer = (token: string) => `Bearer ${token}`;
    const capturedToken = (email: string) => {
      const message = mail.getCapturedEmails().filter((m) => m.to === email).at(-1);
      if (!message) throw new Error('No captured synthetic mail');
      return extractAuthLink(message.html).token;
    };
    const registerEmployer = async (email: string) => {
      expect((await request(server).post('/business/auth/register').send({ email, password, companyName: `Native Employer ${email}` })).status).toBe(201);
      expect((await request(server).post('/business/auth/verify-email').send({ token: capturedToken(email) })).status).toBe(200);
      const login = await request(server).post('/business/auth/login').send({ email, password });
      expect(login.status).toBe(200);
      return login.body.sessionToken as string;
    };
    const employer = await registerEmployer(employerEmail);
    const otherEmployer = await registerEmployer(otherEmployerEmail);
    expect((await request(server).post('/business/vacancies').set('Authorization', bearer(employer)).send({ title: 'Native QA' })).status).toBe(403);

    // Admin creation is isolated test setup; the company approval itself goes
    // through the guarded login + PATCH routes, never a direct DB status edit.
    await prisma.adminUser.create({ data: { email: adminEmail, hashedPassword: await bcrypt.hash(password, 12), role: 'ADMIN' } });
    const adminLogin = await request(server).post('/admin/auth/login').send({ email: adminEmail, password });
    expect(adminLogin.status).toBe(200);
    const admin = bearer(adminLogin.body.sessionToken);
    expect((await request(server).get('/admin/companies?status=PENDING').set('Authorization', bearer(employer))).status).toBe(401);
    // The admin businesses table shows the owning login email per company.
    const pending = await request(server).get('/admin/companies?status=PENDING&limit=100').set('Authorization', admin);
    expect(pending.status).toBe(200);
    const pendingRow = pending.body.data.find((c: any) => c.email === employerEmail);
    expect(pendingRow).toBeDefined();
    expect(pendingRow).not.toHaveProperty('business');
    const company = await prisma.company.findFirstOrThrow({ where: { business: { email: employerEmail } } });
    expect(pendingRow.id).toBe(company.id);
    expect((await request(server).patch(`/admin/companies/${company.id}/approve`).set('Authorization', admin)).status).toBe(200);

    const vacancy = await request(server).post('/business/vacancies').set('Authorization', bearer(employer)).send({
      title: 'Backend QA', description: 'Synthetic role', location: 'Bakı', applicationEmail: destinationEmail,
      questions: [{ label: 'Draft', type: 'SHORT_TEXT', required: false, order: 0 }],
    });
    expect(vacancy.status).toBe(201);
    const vacancyId = vacancy.body.id as string;
    // Questions stay editable until the first application arrives.
    const edited = await request(server).patch(`/business/vacancies/${vacancyId}`).set('Authorization', bearer(employer)).send({
      questions: [
        { label: 'Motivasiya', type: 'SHORT_TEXT', required: true, order: 0 },
        { label: 'Portfolio', type: 'FILE_UPLOAD', required: true, order: 1 },
      ],
    });
    expect(edited.status).toBe(200);
    const textId = edited.body.questions.find((q: any) => q.type === 'SHORT_TEXT').id;
    const fileId = edited.body.questions.find((q: any) => q.type === 'FILE_UPLOAD').id;
    expect((await request(server).get(`/vacancies/${vacancyId}`)).status).toBe(200);

    // An expired vacancy is neither listed, shown, nor accepting applications.
    const expired = await request(server).post('/business/vacancies').set('Authorization', bearer(employer)).send({
      title: 'Expired QA', description: 'Synthetic role', deadline: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(expired.status).toBe(201);
    const openRole = await request(server).post('/business/vacancies').set('Authorization', bearer(employer)).send({
      title: 'Open QA', description: 'Synthetic role', deadline: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(openRole.status).toBe(201);
    const listed = await request(server).get('/vacancies?limit=100');
    expect(listed.status).toBe(200);
    const listedIds = listed.body.data.map((v: any) => v.id);
    expect(listedIds).toEqual(expect.arrayContaining([vacancyId, openRole.body.id]));
    expect(listedIds).not.toContain(expired.body.id);
    expect((await request(server).get(`/vacancies/${expired.body.id}`)).status).toBe(404);

    const cvBytes = docx(`NATIVE-CV-${stamp}`);
    const portfolioBytes = Buffer.from(`%PDF-1.4\nNATIVE-PORTFOLIO-${stamp}\n%%EOF\n`);
    expect((await request(server).post('/auth/register').send({ email: candidateEmail, password })).status).toBe(201);
    expect((await request(server).post('/auth/verify-email').send({ token: capturedToken(candidateEmail) })).status).toBe(201);
    const candidateLogin = await request(server).post('/auth/login').send({ email: candidateEmail, password });
    expect(candidateLogin.status).toBe(201);
    const candidate = candidateLogin.body.sessionToken as string;

    const applyAs = (token: string, target: string, chosen?: string) => {
      const req = request(server).post(`/vacancies/${target}/apply`).set('Authorization', bearer(token));
      if (chosen !== undefined) req.field('resumeId', chosen);
      return req
        .field('answers', JSON.stringify([{ questionId: textId, value: 'Synthetic interest' }]))
        .field('fileQuestionIds', JSON.stringify([fileId]))
        .attach('files', portfolioBytes, { filename: 'portfolio.pdf', contentType: 'application/pdf' });
    };
    const snapshotUploads = () => new Set(fs.readdirSync(uploadDir));
    const beforeRejections = snapshotUploads();

    // No usable CV: nothing is filed, and the question upload is removed.
    const noCv = await applyAs(candidate, vacancyId);
    expect(noCv.status).toBe(400);
    expect(await prisma.application.count({ where: { vacancyId } })).toBe(0);

    const cv = await request(server).post('/resumes').set('Authorization', bearer(candidate))
      .attach('file', cvBytes, { filename: 'cv.docx', contentType: DOCX });
    expect(cv.status).toBe(201);
    const resumeId = cv.body.id;
    const candidateId = cv.body.userId as string;

    expect((await applyAs(candidate, expired.body.id, resumeId)).status).toBe(400);

    // Selection is owner-scoped; drafts the candidate has not approved, and
    // legacy tailored PDFs that were never reviewed, cannot be sent.
    expect((await request(server).post('/auth/register').send({ email: otherEmail, password })).status).toBe(201);
    expect((await request(server).post('/auth/verify-email').send({ token: capturedToken(otherEmail) })).status).toBe(201);
    const otherLogin = await request(server).post('/auth/login').send({ email: otherEmail, password });
    const otherCandidate = otherLogin.body.sessionToken as string;
    const otherCv = await request(server).post('/resumes').set('Authorization', bearer(otherCandidate))
      .attach('file', docx(`OTHER-${stamp}`), { filename: 'other.docx', contentType: DOCX });
    expect(otherCv.status).toBe(201);
    // Tailored rows are fixtures: tailoring itself is covered by tailored-cv.e2e-spec.
    const legacyPdf = await storage.uploadBuffer(Buffer.from(`%PDF-1.4\nLEGACY-${stamp}\n%%EOF\n`), 'application/pdf');
    const tailored = (data: Record<string, unknown>) => prisma.resume.create({ data: { userId: candidateId, isBase: false, ...data } as any });
    const needsReview = await tailored({ status: 'NEEDS_REVIEW', fileUrl: null });
    const pendingTailored = await tailored({ status: 'PENDING', fileUrl: null });
    const legacyUnreviewed = await tailored({ status: 'READY', fileUrl: legacyPdf, reviewedAt: null });
    const afterFixtures = snapshotUploads();
    expect((await applyAs(candidate, vacancyId, otherCv.body.id)).status).toBe(404);
    for (const row of [needsReview, pendingTailored, legacyUnreviewed]) {
      expect((await applyAs(candidate, vacancyId, row.id)).status).toBe(400);
    }
    expect(await prisma.application.count({ where: { vacancyId } })).toBe(0);
    // Rejected attempts leave no CV copies or question uploads behind.
    const leftovers = [...snapshotUploads()].filter((f) => !afterFixtures.has(f));
    expect(leftovers).toEqual([]);
    expect([...afterFixtures].filter((f) => !beforeRejections.has(f))).toHaveLength(3); // base CVs ×2 + legacy fixture PDF

    expect((await request(server).post(`/vacancies/${vacancyId}/apply`).set('Authorization', bearer(candidate))
      .field('resumeId', resumeId).field('answers', '[]').field('fileQuestionIds', '[]')).status).toBe(400);
    const apply = () => applyAs(candidate, vacancyId, resumeId);
    const submitted = await apply();
    expect(submitted.status).toBe(201);
    expect((await apply()).status).toBe(409);
    // The employer's chosen address is told once (the duplicate attempt sent nothing), with a link and without the CV or any contact detail.
    const notices = mail.getCapturedEmails().filter((m) => m.to === destinationEmail);
    expect(notices).toHaveLength(1);
    expect(notices[0].subject).toContain('Backend QA');
    expect(notices[0].html).toContain('/business/applications');
    expect(notices[0].html).not.toContain(candidateEmail);
    expect(notices[0].html).not.toMatch(/NATIVE-CV|\.docx|attachment/i);
    // The address is the employer's: candidates never see it, the owner does.
    expect(JSON.stringify((await request(server).get(`/vacancies/${vacancyId}`)).body)).not.toContain(destinationEmail);
    expect(JSON.stringify((await request(server).get('/vacancies?limit=100')).body)).not.toContain(destinationEmail);
    expect((await request(server).get(`/business/vacancies/${vacancyId}`).set('Authorization', bearer(employer))).body.applicationDestination).toEqual({ email: destinationEmail });
    const applicationId = submitted.body.id as string;
    const files = submitted.body.files as { fieldName: string; fileUrl: string }[];
    const cvCopy = files.find((f) => f.fieldName === 'resume')!.fileUrl;
    const portfolio = files.find((f) => f.fieldName === fileId)!.fileUrl;
    expect(cvCopy).not.toBe(cv.body.fileUrl);

    const detail = await request(server).get(`/business/applications/${applicationId}`).set('Authorization', bearer(employer));
    expect(detail.status).toBe(200);
    expect(detail.body.resumeUrl).toBe(cvCopy);
    expect(detail.body.answers.find((a: any) => a.questionLabel === 'Portfolio').fileUrl).toBe(portfolio);
    for (const [url, bytes] of [[cvCopy, cvBytes], [portfolio, portfolioBytes]] as const) {
      const result = await download(server, employer, url);
      expect(result.status).toBe(200);
      expect(Buffer.compare(result.body, bytes)).toBe(0);
      expect((await download(server, otherEmployer, url)).status).toBe(403);
      expect((await download(server, otherCandidate, url)).status).toBe(403);
      expect((await download(server, 'invalid', url)).status).toBe(401);
    }
    expect((await request(server).get(`/business/applications/${applicationId}`).set('Authorization', bearer(otherEmployer))).status).toBe(404);
    expect((await request(server).patch(`/business/applications/${applicationId}/status`).set('Authorization', bearer(otherEmployer)).send({ status: 'REVIEWING' })).status).toBe(404);
    expect((await request(server).patch(`/business/applications/${applicationId}/status`).set('Authorization', bearer(employer)).send({ status: 'REVIEWING' })).status).toBe(200);
    const candidateApplications = await request(server).get('/dashboard/applications').set('Authorization', bearer(candidate));
    expect(candidateApplications.body.find((a: any) => a.id === applicationId).status).toBe('REVIEWING');
    expect((await request(server).get(`/dashboard/applications/${applicationId}`).set('Authorization', bearer(otherCandidate))).status).toBe(404);
    const lockedEdit = await request(server).patch(`/business/vacancies/${vacancyId}`).set('Authorization', bearer(employer)).send({
      questions: [{ label: 'Changed', type: 'SHORT_TEXT', required: true, order: 0 }],
    });
    expect(lockedEdit.status).toBe(409);
    const kept = await prisma.applicationQuestion.findMany({ where: { vacancyId }, select: { id: true } });
    expect(kept.map((q) => q.id).sort()).toEqual([textId, fileId].sort());
    // Non-question edits remain allowed after submissions.
    expect((await request(server).patch(`/business/vacancies/${vacancyId}`).set('Authorization', bearer(employer)).send({ location: 'Gəncə' })).status).toBe(200);

    // A tailored CV the candidate reviewed and approved can be sent instead.
    const tailoredBytes = Buffer.from(`%PDF-1.4\nREVIEWED-TAILORED-${stamp}\n%%EOF\n`);
    const reviewed = await tailored({ status: 'READY', fileUrl: await storage.uploadBuffer(tailoredBytes, 'application/pdf'), reviewedAt: new Date() });
    const openApply = await request(server).post(`/vacancies/${openRole.body.id}/apply`).set('Authorization', bearer(candidate))
      .field('resumeId', reviewed.id).field('answers', '[]').field('fileQuestionIds', '[]');
    expect(openApply.status).toBe(201);
    const tailoredCopy = openApply.body.files.find((f: any) => f.fieldName === 'resume');
    expect(tailoredCopy.fileUrl).not.toBe(reviewed.fileUrl);
    expect(tailoredCopy.mimeType).toBe('application/pdf');
    const tailoredDownload = await download(server, employer, tailoredCopy.fileUrl);
    expect(tailoredDownload.status).toBe(200);
    expect(Buffer.compare(tailoredDownload.body, tailoredBytes)).toBe(0);

    // Replacing the base CV cannot alter the employer's submitted copy.
    const replacement = await request(server).post('/resumes').set('Authorization', bearer(candidate))
      .attach('file', docx(`REPLACED-${stamp}`), { filename: 'new.docx', contentType: DOCX });
    expect(replacement.status).toBe(201);
    const retained = await download(server, employer, cvCopy);
    expect(retained.status).toBe(200);
    expect(Buffer.compare(retained.body, cvBytes)).toBe(0);
    expect((await request(server).patch(`/business/vacancies/${vacancyId}/pause`).set('Authorization', bearer(employer))).status).toBe(200);
    expect((await request(server).get(`/vacancies/${vacancyId}`)).status).toBe(404);
    expect((await applyAs(otherCandidate, vacancyId, otherCv.body.id)).status).toBe(400);
  }, 60_000);
});
