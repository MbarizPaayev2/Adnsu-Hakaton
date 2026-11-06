import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../src/auth/auth.module';
import { ResumesModule } from '../src/resumes/resumes.module';
import { ProfilesModule } from '../src/profiles/profiles.module';
import { UploadsModule } from '../src/uploads/uploads.module';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { LocalStorageService } from '../src/resumes/local-storage.service';
import { parseCv } from '../src/resumes/cv-parser';
import { extractDocxText } from '../src/resumes/cv-extract';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const FRONTEND = 'http://127.0.0.1:3450';

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

const SYNTHETIC_LINES = [
  'Leyla Huseynova',
  'Gəncə, Azərbaycan',
  'leyla.cvtest@example.com',
  'Haqqımda',
  'NestJS backend mühəndisi.',
  'İş təcrübəsi',
  '2021 - hazırda',
  'Backend Engineer',
  'Qafqaz Labs',
  'API və PostgreSQL.',
  'Təhsil',
  '2016 - 2020',
  'Azərbaycan Texniki Universiteti',
  'Bakalavr',
  'İnformasiya texnologiyaları',
  'Bacarıqlar',
  'NestJS, PostgreSQL, TypeScript',
];

function syntheticDocx(extraLine?: string): Buffer {
  const lines = extraLine ? [...SYNTHETIC_LINES, extraLine] : SYNTHETIC_LINES;
  const paragraphs = lines.map(
    (line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`,
  ).join('');
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`;
  return zipStore('word/document.xml', Buffer.from(xml));
}

describe('CV-to-profile upload, persistence and authorization', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = `${Date.now()}`;
  const ownerEmail = `aise-cv-a-${stamp}@example.com`;
  const otherEmail = `aise-cv-b-${stamp}@example.com`;
  const applicantEmail = `aise-cv-c-${stamp}@example.com`;
  const employerEmail = `aise-cv-emp-${stamp}@example.com`;
  const otherEmployerEmail = `aise-cv-emp2-${stamp}@example.com`;
  const password = 'Cv-Access-1x';

  async function sessionFor(email: string): Promise<string> {
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    expect(login.status).toBeGreaterThanOrEqual(200);
    expect(login.status).toBeLessThan(300);
    return login.body.sessionToken as string;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 're_mock_key';
    process.env.FRONTEND_URL = FRONTEND;
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL =
        'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise?schema=public';
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10_000 }]),
        ConfigModule.forRoot({ isGlobal: true }),
        BullModule.forRoot({ connection: { host: '127.0.0.1', port: 6379 } }),
        DatabaseModule,
        AuthModule,
        ResumesModule,
        ProfilesModule,
        UploadsModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$connect();

    for (const email of [ownerEmail, otherEmail, applicantEmail]) {
      await request(app.getHttpServer()).post('/auth/register').send({ email, password });
      await prisma.user.update({ where: { email }, data: { emailVerified: new Date() } });
    }
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      const users = await prisma.user.findMany({
        where: { email: { in: [ownerEmail, otherEmail, applicantEmail] } },
        include: { resumes: true, applications: { include: { files: true } } },
      });
      const urls = new Set(users.flatMap((user) => [
        ...user.resumes.map((resume) => resume.fileUrl),
        ...user.applications.flatMap((application) => application.files.map((file) => file.fileUrl)),
      ]).filter((url): url is string => !!url));
      const deleted = await prisma.user.deleteMany({
        where: { email: { in: [ownerEmail, otherEmail, applicantEmail] } },
      }).then(() => true).catch(() => false);
      if (deleted) {
        const storage = app.get(LocalStorageService);
        for (const url of urls) await storage.deleteFile(url);
      }
      await prisma.business.deleteMany({
        where: { email: { in: [employerEmail, otherEmployerEmail] } },
      }).catch(() => undefined);
    }
    if (app) await app.close();
  });

  it('extracts the synthetic DOCX instead of inventing fields, persists corrections, and blocks the other user', async () => {
    const text = extractDocxText(syntheticDocx());
    const parsed = parseCv(text);
    expect(parsed.personalInfo.name).toBe('Leyla Huseynova');
    expect(parsed.personalInfo.email).toBe('leyla.cvtest@example.com');
    expect(parsed.location).toBe('Gəncə');
    expect(parsed.headline).toContain('NestJS');
    expect(parsed.skills).toEqual(expect.arrayContaining(['NestJS', 'PostgreSQL', 'TypeScript']));
    expect(parsed.workExperience[0]?.title).toBe('Backend Engineer');
    expect(parsed.workExperience[0]?.company).toBe('Qafqaz Labs');
    expect(parsed.education[0]?.institution).toContain('Texniki');
    expect(parsed.skills.join(' ')).not.toMatch(/Invented/i);

    const ownerToken = await sessionFor(ownerEmail);
    const otherToken = await sessionFor(otherEmail);
    const server = app.getHttpServer();

    const empty = await request(server)
      .post('/resumes')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', Buffer.alloc(0), { filename: 'empty.pdf', contentType: 'application/pdf' });
    expect(empty.status).toBeGreaterThanOrEqual(400);

    const unsupported = await request(server)
      .post('/resumes')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', Buffer.from('hello'), { filename: 'cv.txt', contentType: 'text/plain' });
    expect(unsupported.status).toBeGreaterThanOrEqual(400);

    const corrupt = await request(server)
      .post('/resumes')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', Buffer.from('not-a-zip'), {
        filename: 'bad.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    expect(corrupt.status).toBeGreaterThanOrEqual(400);

    const uploaded = await request(server)
      .post('/resumes')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', syntheticDocx(), {
        filename: 'leyla.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    expect(uploaded.status).toBeGreaterThanOrEqual(200);
    expect(uploaded.status).toBeLessThan(300);
    expect(uploaded.body.isBase).toBe(true);
    expect(uploaded.body.parsedContent.personalInfo.name).toBe('Leyla Huseynova');

    const second = await request(server)
      .post('/resumes')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', syntheticDocx(), {
        filename: 'leyla-2.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    // A 401 here means the session row vanished mid-test (the product never prunes sessions): show the server's message, not just the code,
    // so interference on a shared database is told apart from a real regression.
    if (second.status < 200 || second.status >= 300) throw new Error(`second upload answered ${second.status}: ${JSON.stringify(second.body?.message)}`);
    expect(second.body.id).toBe(uploaded.body.id);
    expect(second.body.parsedContent.personalInfo.name).toBe('Leyla Huseynova');

    const list = await request(server).get('/resumes').set('Authorization', `Bearer ${ownerToken}`);
    expect(list.body.filter((r: { isBase: boolean }) => r.isBase)).toHaveLength(1);

    const fileUrl = second.body.fileUrl as string;
    const filename = fileUrl.split('/').pop();

    const ownerFile = await request(server)
      .get(`/uploads/${filename}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerFile.status).toBe(200);

    const otherFile = await request(server)
      .get(`/uploads/${filename}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(otherFile.status).toBe(403);

    const otherList = await request(server).get('/resumes').set('Authorization', `Bearer ${otherToken}`);
    expect(otherList.body).toEqual([]);

    const otherPatch = await request(server)
      .patch(`/resumes/${uploaded.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ parsedContent: { skills: ['stolen'] } });
    expect(otherPatch.status).toBe(403);

    const otherProfile = await request(server)
      .get('/profile')
      .set('Authorization', `Bearer ${otherToken}`);
    expect(otherProfile.body.headline || '').not.toContain('NestJS backend');

    await request(server)
      .patch('/profile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Leyla Hüseynova',
        headline: 'Düzəldilmiş başlıq',
        location: 'Bakı',
        skills: ['NestJS', 'Düzəliş'],
      });
    await request(server)
      .patch(`/resumes/${uploaded.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        parsedContent: {
          ...uploaded.body.parsedContent,
          headline: 'Düzəldilmiş başlıq',
          location: 'Bakı',
          skills: ['NestJS', 'Düzəliş'],
        },
      });

    const savedProfile = await request(server).get('/profile').set('Authorization', `Bearer ${ownerToken}`);
    expect(savedProfile.body.headline).toBe('Düzəldilmiş başlıq');
    expect(savedProfile.body.skills).toEqual(['NestJS', 'Düzəliş']);

    const savedResume = await request(server).get('/resumes').set('Authorization', `Bearer ${ownerToken}`);
    expect(savedResume.body[0].parsedContent.headline).toBe('Düzəldilmiş başlıq');
    expect(savedResume.body[0].parsedContent.personalInfo.name).toBe('Leyla Huseynova');
  });

  // Applications created before per-application CV copies point straight at
  // the base file; replacement must keep that file for them.
  it('keeps a legacy application\'s CV bytes after a later base replacement', async () => {
    const applicantToken = await sessionFor(applicantEmail);
    const otherToken = await sessionFor(otherEmail);
    const server = app.getHttpServer();
    const markerA = `CV-A-${stamp}`;
    const markerB = `CV-B-${stamp}`;

    const uploadedA = await request(server)
      .post('/resumes')
      .set('Authorization', `Bearer ${applicantToken}`)
      .attach('file', syntheticDocx(markerA), {
        filename: 'cv-a.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    expect(uploadedA.status).toBeGreaterThanOrEqual(200);
    expect(uploadedA.status).toBeLessThan(300);
    const fileUrlA = uploadedA.body.fileUrl as string;
    const filenameA = fileUrlA.split('/').pop() as string;

    const hashedPassword = await bcrypt.hash(password, 12);
    const employer = await prisma.business.create({
      data: {
        email: employerEmail,
        hashedPassword,
        emailVerified: new Date(),
        company: { create: { name: 'Qafqaz Labs Hire', status: 'APPROVED' } },
      },
      include: { company: true },
    });
    const otherEmployer = await prisma.business.create({
      data: {
        email: otherEmployerEmail,
        hashedPassword,
        emailVerified: new Date(),
        company: { create: { name: 'Other Co', status: 'APPROVED' } },
      },
    });
    const vacancy = await prisma.vacancy.create({
      data: {
        companyId: employer.company!.id,
        title: 'Backend mühəndis',
        status: 'ACTIVE',
      },
    });
    const applicant = await prisma.user.findUniqueOrThrow({ where: { email: applicantEmail } });
    const application = await prisma.application.create({
      data: {
        vacancyId: vacancy.id,
        userId: applicant.id,
        files: {
          create: {
            fieldName: 'resume',
            fileUrl: fileUrlA,
            originalName: 'CV',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
        },
      },
    });
    expect(application.id).toBeTruthy();

    const employerSession = await prisma.businessSession.create({
      data: {
        businessId: employer.id,
        sessionToken: randomBytes(32).toString('hex'),
        expires: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const otherEmployerSession = await prisma.businessSession.create({
      data: {
        businessId: otherEmployer.id,
        sessionToken: randomBytes(32).toString('hex'),
        expires: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const replaced = await request(server)
      .post('/resumes')
      .set('Authorization', `Bearer ${applicantToken}`)
      .attach('file', syntheticDocx(markerB), {
        filename: 'cv-b.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    expect(replaced.status).toBeGreaterThanOrEqual(200);
    expect(replaced.status).toBeLessThan(300);
    expect(replaced.body.fileUrl).not.toBe(fileUrlA);
    const filenameB = (replaced.body.fileUrl as string).split('/').pop() as string;

    const download = async (token: string, filename: string) =>
      request(server)
        .get(`/uploads/${filename}`)
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((incoming, callback) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => callback(null, Buffer.concat(chunks)));
        });

    const employerGetsA = await download(employerSession.sessionToken, filenameA);
    expect(employerGetsA.status).toBe(200);
    expect(Buffer.from(employerGetsA.body).toString('utf8')).toContain(markerA);
    expect(Buffer.from(employerGetsA.body).toString('utf8')).not.toContain(markerB);

    const ownerGetsA = await download(applicantToken, filenameA);
    expect(ownerGetsA.status).toBe(200);

    const ownerGetsB = await download(applicantToken, filenameB);
    expect(ownerGetsB.status).toBe(200);
    expect(Buffer.from(ownerGetsB.body).toString('utf8')).toContain(markerB);

    const otherUserA = await request(server)
      .get(`/uploads/${filenameA}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(otherUserA.status).toBe(403);

    const otherBizA = await request(server)
      .get(`/uploads/${filenameA}`)
      .set('Authorization', `Bearer ${otherEmployerSession.sessionToken}`);
    expect(otherBizA.status).toBe(403);

    const failed = await request(server)
      .post('/resumes')
      .set('Authorization', `Bearer ${applicantToken}`)
      .attach('file', Buffer.from('not-a-zip'), {
        filename: 'bad.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    expect(failed.status).toBeGreaterThanOrEqual(400);

    const stillB = await download(applicantToken, filenameB);
    expect(stillB.status).toBe(200);
    expect(Buffer.from(stillB.body).toString('utf8')).toContain(markerB);

    const stillA = await download(employerSession.sessionToken, filenameA);
    expect(stillA.status).toBe(200);
    expect(Buffer.from(stillA.body).toString('utf8')).toContain(markerA);
  });
});
