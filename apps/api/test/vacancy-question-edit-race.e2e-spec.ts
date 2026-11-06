import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { AuthModule } from '../src/auth/auth.module';
import { BusinessModule } from '../src/business/business.module';
import { VacanciesModule } from '../src/vacancies/vacancies.module';
import { JobApplicationsModule } from '../src/job-applications/job-applications.module';
import { ResumesModule } from '../src/resumes/resumes.module';
import { UploadsModule } from '../src/uploads/uploads.module';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { EmailService } from '../src/common/email.service';
import { extractAuthLink } from '../src/common/email-link.util';
import { LocalStorageService } from '../src/resumes/local-storage.service';

/**
 * Deterministic apply-versus-question-edit races against the REAL database, with separate connections and a controlled barrier.
 *
 * The barrier is a table lock held by an independent Prisma client (its own pool, so its own database session):
 *  - `ApplicationQuestion` in SHARE mode blocks the edit's DELETE (ROW EXCLUSIVE) but not reads, inserts of answers or their FK checks;
 *  - `Application` in SHARE mode blocks the apply's INSERT but not the edit's `count` or the questions' delete/create.
 * The test waits until `pg_stat_activity` shows the victim statement waiting on that lock, performs the competing request to completion over
 * HTTP, then releases the lock. Nothing is sleep-timed.
 */
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const stamp = `${Date.now()}`;
const password = 'Race-Test-1x';
const queuePrefix = `aise-race-${stamp}`;

function docx(marker: string): Buffer {
  const name = Buffer.from('word/document.xml');
  const body = Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Leyla Huseynova</w:t></w:r></w:p><w:p><w:r><w:t>${marker}</w:t></w:r></w:p></w:body></w:document>`);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(name.length, 26); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + body.length, 16);
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

describe('apply versus question edit: deterministic real-database races (isolated synthetic data)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: EmailService;
  let storage: LocalStorageService;
  let barrier: PrismaClient; // independent pool: a different database session from the app's
  const employerEmail = `aise-race-e-${stamp}@example.com`;
  const candidateEmail = `aise-race-c-${stamp}@example.com`;
  const uploadDir = path.join(process.cwd(), 'uploads');
  let employer = '';
  let candidate = '';
  let vacancyId = '';
  let server: any;
  const cvBytes = docx(`RACE-CV-${stamp}`);
  const portfolioBytes = Buffer.from(`%PDF-1.4\nRACE-PORTFOLIO-${stamp}\n%%EOF\n`);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 're_mock_key';
    process.env.FRONTEND_URL = 'http://127.0.0.1:3450';
    const db = new URL(process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public');
    if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Refusing race test outside isolated local aise_phase2_test');
    process.env.DATABASE_URL = db.toString();
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
      BullModule.forRoot({ prefix: queuePrefix, connection: { host: '127.0.0.1', port: 6379 } }),
      DatabaseModule, AuthModule, BusinessModule, VacanciesModule, JobApplicationsModule, ResumesModule, UploadsModule,
    ] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    mail = app.get(EmailService);
    storage = app.get(LocalStorageService);
    barrier = new PrismaClient({ datasources: { db: { url: db.toString() } } });
    server = app.getHttpServer();

    const token = (email: string) => extractAuthLink(mail.getCapturedEmails().filter((m) => m.to === email).at(-1)!.html).token;
    expect((await request(server).post('/business/auth/register').send({ email: employerEmail, password, companyName: `Race Employer ${stamp}` })).status).toBe(201);
    expect((await request(server).post('/business/auth/verify-email').send({ token: token(employerEmail) })).status).toBe(200);
    employer = (await request(server).post('/business/auth/login').send({ email: employerEmail, password })).body.sessionToken;
    // Approval itself is covered by native-application; this suite is about the race.
    await prisma.company.updateMany({ where: { business: { email: employerEmail } }, data: { status: 'APPROVED' } });
    expect((await request(server).post('/auth/register').send({ email: candidateEmail, password })).status).toBe(201);
    expect((await request(server).post('/auth/verify-email').send({ token: token(candidateEmail) })).status).toBe(201);
    candidate = (await request(server).post('/auth/login').send({ email: candidateEmail, password })).body.sessionToken;
    expect((await request(server).post('/resumes').set('Authorization', `Bearer ${candidate}`).attach('file', cvBytes, { filename: 'cv.docx', contentType: DOCX })).status).toBe(201);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      const users = await prisma.user.findMany({ where: { email: candidateEmail }, include: { resumes: true, applications: { include: { files: true } } } });
      const urls = users.flatMap((u) => [...u.resumes.map((r) => r.fileUrl), ...u.applications.flatMap((a) => a.files.map((f) => f.fileUrl))]);
      await prisma.application.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
      await prisma.user.deleteMany({ where: { email: candidateEmail } });
      await prisma.business.deleteMany({ where: { email: employerEmail } });
      for (const url of urls) if (url) await storage.deleteFile(url);
    }
    await barrier?.$disconnect();
    await app?.close();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${queuePrefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  }, 60_000);

  const bearer = (t: string) => `Bearer ${t}`;
  const createVacancy = async (title: string) => {
    const res = await request(server).post('/business/vacancies').set('Authorization', bearer(employer)).send({
      title, description: 'Synthetic race role', location: 'Bakı',
      questions: [
        { label: 'Motivasiya', type: 'SHORT_TEXT', required: true, order: 0 },
        { label: 'Portfolio', type: 'FILE_UPLOAD', required: true, order: 1 },
      ],
    });
    expect(res.status).toBe(201);
    return res.body as { id: string; questions: { id: string; type: string }[] };
  };
  const questionsOf = async (id: string) => (await prisma.applicationQuestion.findMany({ where: { vacancyId: id }, orderBy: { order: 'asc' } })).map((q) => q.id);

  /** Holds `LOCK TABLE <table> IN SHARE MODE` in an independent session until `release()` is called. */
  async function holdLock(table: 'ApplicationQuestion' | 'Application') {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => { locked = r; });
    const tx = barrier.$transaction(async (t) => {
      await t.$executeRawUnsafe(`LOCK TABLE "${table}" IN SHARE MODE`);
      locked();
      await held;
    }, { timeout: 60_000, maxWait: 10_000 });
    await lockTaken;
    return { release, done: tx };
  }

  /** Resolves once a statement matching `like` is waiting on a lock (proof the victim has reached the barrier); fails after 15 s. */
  async function waitUntilBlocked(like: string) {
    for (let i = 0; i < 150; i++) {
      const rows = await barrier.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE $1`, like);
      if (Number(rows[0].n) > 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no statement like ${like} reached the barrier`);
  }

  const apply = (target: string, questions: { id: string; type: string }[]) => {
    const text = questions.find((q) => q.type === 'SHORT_TEXT')!.id;
    const file = questions.find((q) => q.type === 'FILE_UPLOAD')!.id;
    return request(server).post(`/vacancies/${target}/apply`).set('Authorization', bearer(candidate))
      .field('answers', JSON.stringify([{ questionId: text, value: 'Race answer' }]))
      .field('fileQuestionIds', JSON.stringify([file]))
      .attach('files', portfolioBytes, { filename: 'portfolio.pdf', contentType: 'application/pdf' });
  };
  const editQuestions = (target: string, labels: string[]) => request(server).patch(`/business/vacancies/${target}`).set('Authorization', bearer(employer)).send({
    questions: labels.map((label, order) => ({ label, type: 'SHORT_TEXT', required: false, order })),
  });
  const uploads = () => new Set(fs.readdirSync(uploadDir));

  it('an application that lands after the edit counted zero but before it deleted keeps its answers and attachments; the edit gets the same 409', async () => {
    const v = await createVacancy(`Race A ${stamp}`);
    vacancyId = v.id;
    const before = await questionsOf(vacancyId);
    const lock = await holdLock('ApplicationQuestion');

    // Edit reaches its DELETE (after counting zero applications) and waits on the barrier.
    const edit = editQuestions(vacancyId, ['Yeni sual']).then((r) => r);
    await waitUntilBlocked('%DELETE FROM "public"."ApplicationQuestion"%');
    expect(await prisma.application.count({ where: { vacancyId } })).toBe(0);

    // The application commits in full while the edit is parked.
    const applied = await apply(vacancyId, v.questions);
    expect(applied.status).toBe(201);

    lock.release();
    const edited = await edit;
    await lock.done;

    expect(edited.status).toBe(409);
    expect(await questionsOf(vacancyId)).toEqual(before); // the edit rolled back completely: same question rows, no new ones
    const app = await prisma.application.findFirstOrThrow({ where: { vacancyId }, include: { answers: true, files: true } });
    expect(app.answers).toHaveLength(2);
    expect(app.answers.every((a) => before.includes(a.questionId))).toBe(true);
    expect(app.answers.find((a) => a.value === 'Race answer')).toBeDefined();
    const files = app.files;
    const cvCopy = files.find((f) => f.fieldName === 'resume')!.fileUrl;
    const portfolio = files.find((f) => f.fieldName === v.questions.find((q) => q.type === 'FILE_UPLOAD')!.id)!.fileUrl;
    for (const [url, bytes] of [[cvCopy, cvBytes], [portfolio, portfolioBytes]] as const) {
      const got = await download(server, employer, url);
      expect(got.status).toBe(200);
      expect(Buffer.compare(got.body, bytes)).toBe(0);
    }
  }, 60_000);

  it('an edit that commits after the application validated its answers but before it inserted them leaves NO application, no stray files and the edited questions; the candidate gets a clear 409', async () => {
    const v = await createVacancy(`Race B ${stamp}`);
    const filesBefore = uploads();
    const lock = await holdLock('Application');

    // The apply has validated against the OLD questions and waits at its INSERT.
    const submitting = apply(v.id, v.questions).then((r) => r);
    await waitUntilBlocked('%INSERT INTO "public"."Application" %');

    // The edit sees no application yet and commits fully.
    const edited = await editQuestions(v.id, ['Yeni sual 1', 'Yeni sual 2']);
    expect(edited.status).toBe(200);
    const after = await questionsOf(v.id);
    expect(after).toHaveLength(2);

    lock.release();
    const submitted = await submitting;
    await lock.done;

    expect(submitted.status).toBe(409);
    expect(JSON.stringify(submitted.body)).toMatch(/sual|dəyiş/i);
    expect(await prisma.application.count({ where: { vacancyId: v.id } })).toBe(0);
    expect(await questionsOf(v.id)).toEqual(after);
    // This attempt's CV snapshot and question upload are gone; only files that existed before remain.
    expect([...uploads()].filter((f) => !filesBefore.has(f))).toEqual([]);
    // The candidate's own base CV is untouched and a retry against the edited questions succeeds.
    const retry = await request(server).post(`/vacancies/${v.id}/apply`).set('Authorization', bearer(candidate))
      .field('answers', JSON.stringify([])).field('fileQuestionIds', JSON.stringify([]));
    expect(retry.status).toBe(201);
  }, 60_000);
});
