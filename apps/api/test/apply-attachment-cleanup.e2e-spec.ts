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
import { PostHogService } from '../src/common/posthog.service';
import { LocalStorageService } from '../src/resumes/local-storage.service';

// Cleanup boundary of POST /vacancies/:id/apply: the controller stores question
// uploads, the service copies the base CV, and either removes them only when
// the application was not committed.

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

const syntheticPdf = (marker: string) => Buffer.from(`%PDF-1.4\n% synthetic portfolio ${marker}\n%%EOF\n`);
const filenameOf = (fileUrl: string) => fileUrl.split('/').pop() as string;

type AppliedFile = { fieldName: string; fileUrl: string };

describe('Apply attachment cleanup boundary', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let posthog: PostHogService;
  let storage: LocalStorageService;
  const uploadDir = path.join(process.cwd(), 'uploads');
  const stamp = `${Date.now()}`;
  const password = 'Cv-Access-1x';
  const createdEmails: string[] = [];
  const employerEmail = `aise-apply-clean-emp-${stamp}@example.com`;
  let companyId: string;
  let employerToken: string;
  let seq = 0;

  const uploadFiles = () => new Set(fs.readdirSync(uploadDir));

  async function candidateWithCv(label: string, cvBytes: Buffer) {
    const email = `aise-apply-clean-${label}-${stamp}@example.com`;
    createdEmails.push(email);
    await request(app.getHttpServer()).post('/auth/register').send({ email, password });
    const user = await prisma.user.update({ where: { email }, data: { emailVerified: new Date() } });
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    const token = login.body.sessionToken as string;
    const cv = await request(app.getHttpServer())
      .post('/resumes')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', cvBytes, { filename: 'cv.docx', contentType: DOCX });
    expect(cv.status).toBe(201);
    return { id: user.id, token };
  }

  /** An active vacancy with one required file question. */
  async function vacancyWithFileQuestion() {
    const vacancy = await prisma.vacancy.create({
      data: {
        companyId,
        title: `Backend mühəndis ${seq++}`,
        status: 'ACTIVE',
        questions: { create: { label: 'Portfolio', type: 'FILE_UPLOAD', required: true } },
      },
      include: { questions: true },
    });
    return { vacancyId: vacancy.id, questionId: vacancy.questions[0].id };
  }

  function apply(token: string, vacancyId: string, questionId: string, portfolio: Buffer) {
    return request(app.getHttpServer())
      .post(`/vacancies/${vacancyId}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .field('answers', '[]')
      .field('fileQuestionIds', JSON.stringify([questionId]))
      .attach('files', portfolio, { filename: 'portfolio.pdf', contentType: 'application/pdf' });
  }

  async function employerDownload(fileUrl: string): Promise<{ status: number; body: Buffer }> {
    const res = await request(app.getHttpServer())
      .get(`/uploads/${filenameOf(fileUrl)}`)
      .set('Authorization', `Bearer ${employerToken}`)
      .buffer(true)
      .parse((incoming, callback) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    return { status: res.status, body: Buffer.from(res.body) };
  }

  async function expectEmployerGets(fileUrl: string, bytes: Buffer) {
    const res = await employerDownload(fileUrl);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, bytes)).toBe(0);
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 're_mock_key';
    process.env.FRONTEND_URL = FRONTEND;
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public'; // isolated test database, never the local development one
    }

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
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    // Several modules register their own copies; take the ones apply uses.
    posthog = app.select(JobApplicationsModule).get(PostHogService, { strict: true });
    storage = app.select(ResumesModule).get(LocalStorageService, { strict: true });

    const employer = await prisma.business.create({
      data: {
        email: employerEmail,
        hashedPassword: await bcrypt.hash(password, 12),
        emailVerified: new Date(),
        company: { create: { name: 'Cleanup Hire', status: 'APPROVED' } },
      },
      include: { company: true },
    });
    companyId = employer.company!.id;
    employerToken = (
      await prisma.businessSession.create({
        data: {
          businessId: employer.id,
          sessionToken: randomBytes(32).toString('hex'),
          expires: new Date(Date.now() + 60 * 60 * 1000),
        },
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
      await prisma.business.deleteMany({ where: { email: employerEmail } }).catch(() => undefined);
      for (const url of fileUrls) {
        if (url) await storage.deleteFile(url);
      }
    }
    await app?.close();
  });

  it('keeps a committed application and all its files when analytics throws after the write', async () => {
    const cvBytes = syntheticDocx(`CLEAN1-CV-${stamp}`);
    const portfolio = syntheticPdf(`CLEAN1-P-${stamp}`);
    const applicant = await candidateWithCv('a', cvBytes);
    const { vacancyId, questionId } = await vacancyWithFileQuestion();
    const capture = jest.spyOn(posthog, 'capture').mockImplementation((_id, event) => {
      if (event === 'application_submitted') throw new Error('posthog down');
    });

    const before = uploadFiles();
    const applied = await apply(applicant.token, vacancyId, questionId, portfolio);

    expect(applied.status).toBe(201);
    expect(capture).toHaveBeenCalledWith(applicant.id, 'application_submitted', expect.anything());
    const files = applied.body.files as AppliedFile[];
    const cvCopy = files.find((f) => f.fieldName === 'resume')!.fileUrl;
    const questionFile = files.find((f) => f.fieldName === questionId)!.fileUrl;
    expect([...uploadFiles()].filter((f) => !before.has(f)).sort()).toEqual(
      [filenameOf(cvCopy), filenameOf(questionFile)].sort(),
    );

    const stored = await prisma.application.findUniqueOrThrow({
      where: { id: applied.body.id },
      include: { files: true, answers: true },
    });
    expect(stored.files.map((f) => f.fileUrl).sort()).toEqual([cvCopy, questionFile].sort());
    expect(stored.answers.map((a) => a.fileUrl)).toEqual([questionFile]);
    await expectEmployerGets(cvCopy, cvBytes);
    await expectEmployerGets(questionFile, portfolio);
  }, 60_000);

  it('removes this attempt\'s CV copy and question upload when the database write fails', async () => {
    const applicant = await candidateWithCv('b', syntheticDocx(`CLEAN2-CV-${stamp}`));
    const { vacancyId, questionId } = await vacancyWithFileQuestion();
    const capture = jest.spyOn(posthog, 'capture');
    const copy = jest.spyOn(storage, 'copyFile');
    jest.spyOn(prisma.application, 'create').mockRejectedValueOnce(new Error('connection lost'));

    const before = uploadFiles();
    const applied = await apply(applicant.token, vacancyId, questionId, syntheticPdf(`CLEAN2-P-${stamp}`));

    expect(applied.status).toBe(500);
    // Both files really were written before the failure, then removed.
    expect(copy).toHaveBeenCalledTimes(1);
    const copied = await (copy.mock.results[0].value as Promise<string>);
    expect(before.has(filenameOf(copied))).toBe(false);
    expect(uploadFiles()).toEqual(before);
    expect(await prisma.application.count({ where: { userId: applicant.id } })).toBe(0);
    expect(capture).not.toHaveBeenCalledWith(applicant.id, 'application_submitted', expect.anything());
  }, 60_000);

  it('leaves the existing application and its attachments untouched on a duplicate submission', async () => {
    const cvBytes = syntheticDocx(`CLEAN3-CV-${stamp}`);
    const portfolio = syntheticPdf(`CLEAN3-P1-${stamp}`);
    const applicant = await candidateWithCv('c', cvBytes);
    const { vacancyId, questionId } = await vacancyWithFileQuestion();

    const first = await apply(applicant.token, vacancyId, questionId, portfolio);
    expect(first.status).toBe(201);
    const original = await prisma.application.findUniqueOrThrow({
      where: { id: first.body.id },
      include: { files: true, answers: true },
    });

    const afterFirst = uploadFiles();
    const duplicate = await apply(applicant.token, vacancyId, questionId, syntheticPdf(`CLEAN3-P2-${stamp}`));
    expect(duplicate.status).toBe(409);

    // The second attempt's CV copy and upload are gone; nothing of the first was removed.
    expect(uploadFiles()).toEqual(afterFirst);
    const applications = await prisma.application.findMany({
      where: { userId: applicant.id },
      include: { files: true, answers: true },
    });
    expect(applications).toHaveLength(1);
    expect(applications[0]).toEqual(original);
    const files = original.files as AppliedFile[];
    await expectEmployerGets(files.find((f) => f.fieldName === 'resume')!.fileUrl, cvBytes);
    await expectEmployerGets(files.find((f) => f.fieldName === questionId)!.fileUrl, portfolio);
  }, 60_000);
});
