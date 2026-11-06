import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { AuthModule } from '../src/auth/auth.module';
import { ResumesModule } from '../src/resumes/resumes.module';
import { UploadsModule } from '../src/uploads/uploads.module';
import { JobApplicationsModule } from '../src/job-applications/job-applications.module';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { LocalStorageService } from '../src/resumes/local-storage.service';

// Apply, base-CV replacement and CV deletion overlap here through the real
// HTTP routes. Two independent Nest applications (separate DI containers,
// Prisma pools and storage providers) share only Postgres and the uploads
// directory, as two API processes would. Overlap is forced with barriers on
// jest spies of the real providers; there is no production test hook.

const FRONTEND = 'http://127.0.0.1:3450';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function zipStore(name: string, contents: Buffer): Buffer {
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt32LE(contents.length, 18);
  local.writeUInt32LE(contents.length, 22);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(contents.length, 20);
  central.writeUInt32LE(contents.length, 24);
  const localPart = Buffer.concat([local, nameBuf, contents]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, central, nameBuf, eocd]);
}

function syntheticDocx(marker: string): Buffer {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Leyla Huseynova</w:t></w:r></w:p><w:p><w:r><w:t>${marker}</w:t></w:r></w:p></w:body></w:document>`;
  return zipStore('word/document.xml', Buffer.from(xml));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Starts a supertest request now and returns its eventual response. */
function start(test: request.Test): Promise<request.Response> {
  return new Promise((resolve, reject) => test.end((err, res) => (err && !res ? reject(err) : resolve(res))));
}

const filenameOf = (fileUrl: string) => fileUrl.split('/').pop() as string;

describe('CV apply vs replacement/deletion concurrency', () => {
  let apiA: INestApplication;
  let apiB: INestApplication;
  let prisma: PrismaService;
  let storageA: LocalStorageService;
  let storageB: LocalStorageService;
  const uploadDir = path.join(process.cwd(), 'uploads');
  const stamp = `${Date.now()}`;
  const password = 'Cv-Access-1x';
  const createdEmails: string[] = [];
  const employerEmail = `aise-cv-race-emp-${stamp}@example.com`;
  const otherEmployerEmail = `aise-cv-race-emp2-${stamp}@example.com`;
  const otherEmail = `aise-cv-race-other-${stamp}@example.com`;
  let companyId: string;
  let employerToken: string;
  let otherEmployerToken: string;
  let otherToken: string;
  let seq = 0;

  async function createApi(): Promise<INestApplication> {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
        ConfigModule.forRoot({ isGlobal: true }),
        BullModule.forRoot({ connection: { host: '127.0.0.1', port: 6379 } }),
        DatabaseModule,
        AuthModule,
        ResumesModule,
        UploadsModule,
        JobApplicationsModule,
      ],
    }).compile();
    const app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    return app;
  }

  async function candidate(label: string): Promise<{ id: string; token: string }> {
    const email = `aise-cv-race-${label}-${stamp}-${seq++}@example.com`;
    createdEmails.push(email);
    await request(apiA.getHttpServer()).post('/auth/register').send({ email, password });
    const user = await prisma.user.update({ where: { email }, data: { emailVerified: new Date() } });
    const login = await request(apiA.getHttpServer()).post('/auth/login').send({ email, password });
    expect(login.status).toBeLessThan(300);
    return { id: user.id, token: login.body.sessionToken as string };
  }

  async function vacancy(): Promise<string> {
    const row = await prisma.vacancy.create({
      data: { companyId, title: `Backend mühəndis ${seq++}`, status: 'ACTIVE' },
    });
    return row.id;
  }

  function upload(api: INestApplication, token: string, bytes: Buffer) {
    return request(api.getHttpServer())
      .post('/resumes')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', bytes, { filename: 'cv.docx', contentType: DOCX });
  }

  function apply(api: INestApplication, token: string, vacancyId: string) {
    return request(api.getHttpServer())
      .post(`/vacancies/${vacancyId}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: [] });
  }

  function download(token: string, filename: string) {
    return request(apiA.getHttpServer())
      .get(`/uploads/${filename}`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((incoming, callback) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () => callback(null, Buffer.concat(chunks)));
      });
  }

  async function uploadedCv(api: INestApplication, token: string, bytes: Buffer) {
    const res = await upload(api, token, bytes);
    expect(res.status).toBe(201);
    return res.body as { id: string; fileUrl: string };
  }

  function resumeAttachment(application: { files: { fieldName: string; fileUrl: string }[] }) {
    const file = application.files.find((f) => f.fieldName === 'resume');
    expect(file).toBeDefined();
    return file!.fileUrl;
  }

  /** The employer and the applicant get exactly `bytes`; unrelated parties get 403. */
  async function expectSubmittedBytes(applicantToken: string, fileUrl: string, bytes: Buffer) {
    const filename = filenameOf(fileUrl);
    const employer = await download(employerToken, filename);
    expect(employer.status).toBe(200);
    expect(Buffer.compare(Buffer.from(employer.body), bytes)).toBe(0);
    const owner = await download(applicantToken, filename);
    expect(owner.status).toBe(200);
    expect(Buffer.compare(Buffer.from(owner.body), bytes)).toBe(0);
    expect((await download(otherToken, filename)).status).toBe(403);
    expect((await download(otherEmployerToken, filename)).status).toBe(403);
  }

  async function currentBase(userId: string) {
    return prisma.resume.findMany({ where: { userId, isBase: true } });
  }

  /**
   * Pauses the next call of `method` on `target`, either before or after the
   * real implementation runs. `reached` resolves once the call is paused;
   * in 'after' mode `result.value` then holds what the real call returned.
   */
  function pauseNext<T extends object>(target: T, method: keyof T & string, when: 'before' | 'after') {
    const reached = deferred();
    const release = deferred();
    const result: { value?: unknown } = {};
    const original = (target[method] as unknown as (...args: unknown[]) => Promise<unknown>).bind(target);
    const spy = jest.spyOn(target as any, method).mockImplementationOnce(async (...args: unknown[]) => {
      if (when === 'before') {
        reached.resolve();
        await release.promise;
        return original(...args);
      }
      result.value = await original(...args);
      reached.resolve();
      await release.promise;
      return result.value;
    });
    let timer: NodeJS.Timeout | undefined;
    const reachedOrTimeout = Promise.race([
      reached.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`barrier on ${method} was never reached`)), 10_000);
      }),
    ]).finally(() => clearTimeout(timer));
    return { reached: reachedOrTimeout, release: release.resolve, result };
  }

  const uploadFiles = () => new Set(fs.readdirSync(uploadDir));

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 're_mock_key';
    process.env.FRONTEND_URL = FRONTEND;
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public'; // isolated test database, never the local development one
    }

    apiA = await createApi();
    apiB = await createApi();
    prisma = apiA.get(PrismaService);
    // AuthModule/UploadsModule register their own LocalStorageService; the one
    // ResumesService and JobApplicationsService use comes from ResumesModule.
    storageA = apiA.select(ResumesModule).get(LocalStorageService, { strict: true });
    storageB = apiB.select(ResumesModule).get(LocalStorageService, { strict: true });
    // Nothing in-process is shared between the two instances.
    expect(apiB.get(PrismaService)).not.toBe(prisma);
    expect(storageB).not.toBe(storageA);

    createdEmails.push(otherEmail);
    await request(apiA.getHttpServer()).post('/auth/register').send({ email: otherEmail, password });
    await prisma.user.update({ where: { email: otherEmail }, data: { emailVerified: new Date() } });
    otherToken = (await request(apiA.getHttpServer()).post('/auth/login').send({ email: otherEmail, password })).body
      .sessionToken;

    const hashedPassword = await bcrypt.hash(password, 12);
    const employer = await prisma.business.create({
      data: {
        email: employerEmail,
        hashedPassword,
        emailVerified: new Date(),
        company: { create: { name: 'Race Hire', status: 'APPROVED' } },
      },
      include: { company: true },
    });
    companyId = employer.company!.id;
    const otherEmployer = await prisma.business.create({
      data: {
        email: otherEmployerEmail,
        hashedPassword,
        emailVerified: new Date(),
        company: { create: { name: 'Other Race Co', status: 'APPROVED' } },
      },
    });
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    employerToken = (
      await prisma.businessSession.create({
        data: { businessId: employer.id, sessionToken: randomBytes(32).toString('hex'), expires },
      })
    ).sessionToken;
    otherEmployerToken = (
      await prisma.businessSession.create({
        data: { businessId: otherEmployer.id, sessionToken: randomBytes(32).toString('hex'), expires },
      })
    ).sessionToken;
  }, 60_000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (prisma) {
      const users = await prisma.user.findMany({
        where: { email: { in: createdEmails } },
        include: { resumes: true, applications: { include: { files: true } } },
      });
      const fileUrls = users.flatMap((user) => [
        ...user.resumes.map((r) => r.fileUrl),
        ...user.applications.flatMap((a) => a.files.map((f) => f.fileUrl)),
      ]);
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } }).catch(() => undefined);
      await prisma.business
        .deleteMany({ where: { email: { in: [employerEmail, otherEmployerEmail] } } })
        .catch(() => undefined);
      for (const url of fileUrls) {
        if (url) await storageA.deleteFile(url);
      }
    }
    await apiA?.close();
    await apiB?.close();
  });

  it('apply copies A, replacement to B commits and deletes A, then apply persists: submission keeps A', async () => {
    const applicant = await candidate('a');
    const bytesA = syntheticDocx(`RACE1-A-${stamp}`);
    const bytesB = syntheticDocx(`RACE1-B-${stamp}`);
    const cvA = await uploadedCv(apiB, applicant.token, bytesA);
    const vacancyId = await vacancy();

    const pause = pauseNext(storageA, 'copyFile', 'after');
    const applying = start(apply(apiA, applicant.token, vacancyId));
    await pause.reached;

    // Replacement runs start to finish on the other instance while apply is
    // parked between copying the CV and inserting the application.
    const replaced = await upload(apiB, applicant.token, bytesB);
    expect(replaced.status).toBe(201);
    expect(replaced.body.fileUrl).not.toBe(cvA.fileUrl);
    expect(storageA.fileExists(cvA.fileUrl)).toBe(false);

    // Another candidate is not blocked by this candidate's in-flight apply.
    const bystander = await candidate('bystander');
    await uploadedCv(apiA, bystander.token, syntheticDocx(`RACE1-C-${stamp}`));
    expect((await apply(apiB, bystander.token, vacancyId)).status).toBe(201);

    pause.release();
    const applied = await applying;
    expect(applied.status).toBe(201);
    const attached = resumeAttachment(applied.body);
    expect(attached).not.toBe(cvA.fileUrl);
    expect(attached).not.toBe(replaced.body.fileUrl);
    await expectSubmittedBytes(applicant.token, attached, bytesA);

    const bases = await currentBase(applicant.id);
    expect(bases.map((b) => b.fileUrl)).toEqual([replaced.body.fileUrl]);
    const ownerB = await download(applicant.token, filenameOf(replaced.body.fileUrl));
    expect(Buffer.compare(Buffer.from(ownerB.body), bytesB)).toBe(0);
    // Replacement B is the candidate's own file, never the employer's.
    expect((await download(employerToken, filenameOf(replaced.body.fileUrl))).status).toBe(403);
  }, 60_000);

  it('apply reads A, replacement deletes A before the copy: apply fails with 409, nothing dangles, retry submits B', async () => {
    const applicant = await candidate('b');
    const bytesA = syntheticDocx(`RACE2-A-${stamp}`);
    const bytesB = syntheticDocx(`RACE2-B-${stamp}`);
    const cvA = await uploadedCv(apiB, applicant.token, bytesA);
    const vacancyId = await vacancy();

    const pause = pauseNext(storageA, 'copyFile', 'before');
    const applying = start(apply(apiA, applicant.token, vacancyId));
    await pause.reached;
    const replaced = await upload(apiB, applicant.token, bytesB);
    expect(replaced.status).toBe(201);
    expect(storageA.fileExists(cvA.fileUrl)).toBe(false);

    const filesBefore = uploadFiles();
    pause.release();
    const applied = await applying;
    expect(applied.status).toBe(409);
    expect(uploadFiles()).toEqual(filesBefore);
    expect(await prisma.application.count({ where: { userId: applicant.id, vacancyId } })).toBe(0);

    const retried = await apply(apiA, applicant.token, vacancyId);
    expect(retried.status).toBe(201);
    await expectSubmittedBytes(applicant.token, resumeAttachment(retried.body), bytesB);
  }, 60_000);

  it('replacement writes B but has not committed; apply completes first: submission keeps A, replacement still succeeds', async () => {
    const applicant = await candidate('c');
    const bytesA = syntheticDocx(`RACE3-A-${stamp}`);
    const bytesB = syntheticDocx(`RACE3-B-${stamp}`);
    const cvA = await uploadedCv(apiA, applicant.token, bytesA);
    const vacancyId = await vacancy();

    const pause = pauseNext(storageB, 'uploadFile', 'after');
    const replacing = start(upload(apiB, applicant.token, bytesB));
    await pause.reached;

    const applied = await apply(apiA, applicant.token, vacancyId);
    expect(applied.status).toBe(201);
    const attached = resumeAttachment(applied.body);

    pause.release();
    const replaced = await replacing;
    expect(replaced.status).toBe(201);
    expect(storageA.fileExists(cvA.fileUrl)).toBe(false);
    await expectSubmittedBytes(applicant.token, attached, bytesA);
    expect((await currentBase(applicant.id)).map((b) => b.fileUrl)).toEqual([replaced.body.fileUrl]);
  }, 60_000);

  it('deletion of the base CV while apply is between copy and insert does not break the submission', async () => {
    const applicant = await candidate('d');
    const bytesA = syntheticDocx(`RACE4-A-${stamp}`);
    const cvA = await uploadedCv(apiA, applicant.token, bytesA);
    const vacancyId = await vacancy();

    const pause = pauseNext(storageA, 'copyFile', 'after');
    const applying = start(apply(apiA, applicant.token, vacancyId));
    await pause.reached;
    const deleted = await request(apiB.getHttpServer())
      .delete(`/resumes/${cvA.id}`)
      .set('Authorization', `Bearer ${applicant.token}`);
    expect(deleted.status).toBe(200);
    expect(storageA.fileExists(cvA.fileUrl)).toBe(false);

    pause.release();
    const applied = await applying;
    expect(applied.status).toBe(201);
    await expectSubmittedBytes(applicant.token, resumeAttachment(applied.body), bytesA);
    expect(await currentBase(applicant.id)).toEqual([]);
  }, 60_000);

  it('deletion of the base CV before apply copies it: apply fails with 409 and creates nothing', async () => {
    const applicant = await candidate('e');
    const cvA = await uploadedCv(apiA, applicant.token, syntheticDocx(`RACE5-A-${stamp}`));
    const vacancyId = await vacancy();

    const pause = pauseNext(storageA, 'copyFile', 'before');
    const applying = start(apply(apiA, applicant.token, vacancyId));
    await pause.reached;
    const deleted = await request(apiB.getHttpServer())
      .delete(`/resumes/${cvA.id}`)
      .set('Authorization', `Bearer ${applicant.token}`);
    expect(deleted.status).toBe(200);

    const filesBefore = uploadFiles();
    pause.release();
    expect((await applying).status).toBe(409);
    expect(uploadFiles()).toEqual(filesBefore);
    expect(await prisma.application.count({ where: { userId: applicant.id } })).toBe(0);
  }, 60_000);

  it('a delete that read A before a replacement committed B fails with 409 and leaves B usable', async () => {
    const applicant = await candidate('f');
    const bytesB = syntheticDocx(`RACE6-B-${stamp}`);
    const cvA = await uploadedCv(apiA, applicant.token, syntheticDocx(`RACE6-A-${stamp}`));

    const prismaB = apiB.get(PrismaService);
    const pause = pauseNext(prismaB.resume, 'deleteMany', 'before');
    const deleting = start(
      request(apiB.getHttpServer()).delete(`/resumes/${cvA.id}`).set('Authorization', `Bearer ${applicant.token}`),
    );
    await pause.reached;
    const replaced = await upload(apiA, applicant.token, bytesB);
    expect(replaced.status).toBe(201);

    pause.release();
    expect((await deleting).status).toBe(409);
    expect((await currentBase(applicant.id)).map((b) => b.fileUrl)).toEqual([replaced.body.fileUrl]);
    const ownerB = await download(applicant.token, filenameOf(replaced.body.fileUrl));
    expect(ownerB.status).toBe(200);
    expect(Buffer.compare(Buffer.from(ownerB.body), bytesB)).toBe(0);
  }, 60_000);

  it('a replacement that loses to a concurrent delete fails with 409 and removes its own new file', async () => {
    const applicant = await candidate('g');
    const cvA = await uploadedCv(apiA, applicant.token, syntheticDocx(`RACE7-A-${stamp}`));

    const pause = pauseNext(storageB, 'uploadFile', 'after');
    const replacing = start(upload(apiB, applicant.token, syntheticDocx(`RACE7-B-${stamp}`)));
    await pause.reached;
    const newFile = pause.result.value as string;
    const deleted = await request(apiA.getHttpServer())
      .delete(`/resumes/${cvA.id}`)
      .set('Authorization', `Bearer ${applicant.token}`);
    expect(deleted.status).toBe(200);

    pause.release();
    expect((await replacing).status).toBe(409);
    expect(storageA.fileExists(newFile)).toBe(false);
    expect(await currentBase(applicant.id)).toEqual([]);
  }, 60_000);

  it('failed replacements keep the previous CV usable and do not touch submitted copies', async () => {
    const applicant = await candidate('h');
    const bytesA = syntheticDocx(`RACE8-A-${stamp}`);
    const cvA = await uploadedCv(apiA, applicant.token, bytesA);
    const vacancyId = await vacancy();
    const applied = await apply(apiA, applicant.token, vacancyId);
    expect(applied.status).toBe(201);
    const attached = resumeAttachment(applied.body);

    const corrupt = await request(apiA.getHttpServer())
      .post('/resumes')
      .set('Authorization', `Bearer ${applicant.token}`)
      .attach('file', Buffer.from('not-a-zip'), { filename: 'bad.docx', contentType: DOCX });
    expect(corrupt.status).toBe(400);

    jest.spyOn(storageA, 'uploadFile').mockRejectedValueOnce(new Error('disk full'));
    const storageFailure = await upload(apiA, applicant.token, syntheticDocx(`RACE8-B-${stamp}`));
    expect(storageFailure.status).toBe(500);

    expect((await currentBase(applicant.id)).map((b) => b.fileUrl)).toEqual([cvA.fileUrl]);
    const ownerA = await download(applicant.token, filenameOf(cvA.fileUrl));
    expect(Buffer.compare(Buffer.from(ownerA.body), bytesA)).toBe(0);
    await expectSubmittedBytes(applicant.token, attached, bytesA);
  }, 60_000);
});
