import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { startPhase2App, fixtureSummary, fixtureDetail } from './support/phase2-local-app';
import { startFakeNim, MODEL_MARKER } from './support/fake-nim';
import { ResumeTailorService, TailorError } from '../src/resumes/tailor/resume-tailor.service';
import { execFileSync } from 'child_process';

/** Runs the product's own extractCvText (pdf.js, ESM) in a plain Node process: Jest's VM cannot load it. */
function extractPdfTextOutOfBand(file: string): string {
  const script = `require('./src/resumes/cv-extract').extractCvText(require('fs').readFileSync(process.argv[1]), 'application/pdf').then((t) => process.stdout.write(JSON.stringify(t)))`;
  const out = execFileSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--transpile-only', '-e', script, file], {
    cwd: path.join(__dirname, '..'),
    timeout: 60_000,
  });
  return JSON.parse(out.toString());
}

// Corrected profile → tailored draft → review → approved PDF, through the
// real routes, BullMQ worker, fact checks, Typst and /uploads. The provider is
// the loopback fake in ./support/fake-nim (behaviour evidence only).

const CV_MARKER = 'SYNTHETIC-PROFILE-TEXT-4402';

describe('tailored CV: request → fact-checked draft → review → approved PDF', () => {
  let env: Awaited<ReturnType<typeof startPhase2App>>;
  let nim: Awaited<ReturnType<typeof startFakeNim>>;
  const stamp = `tailor-${Date.now()}`;
  const email = `${stamp}@example.com`;
  const otherEmail = `${stamp}-other@example.com`;
  const password = 'Local-Phase3-Test!';
  let token: string;
  let otherToken: string;
  let userId: string;
  const matchIds: Record<string, string> = {};
  const logs: string[] = [];
  const uploadDir = path.join(process.cwd(), 'uploads');
  const filesBefore = new Set<string>();

  const server = () => env.app.getHttpServer();
  const as = (t: string) => ({ type: 'bearer' as const, t });
  const get = (url: string, t = token) => request(server()).get(url).auth(t, { type: 'bearer' });
  const post = (url: string, body: object = {}, t = token) => request(server()).post(url).auth(t, { type: 'bearer' }).send(body);
  const patch = (url: string, body: object, t = token) => request(server()).patch(url).auth(t, { type: 'bearer' }).send(body);
  void as;

  async function waitFor(id: string, status: string) {
    for (let i = 0; i < 200; i++) {
      const res = await get(`/resumes/${id}`);
      if (res.body.status === status) return res.body;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`resume ${id} did not reach ${status}`);
  }

  function download(fileUrl: string, t = token) {
    return request(server())
      .get(`/uploads/${fileUrl.split('/').pop()}`)
      .auth(t, { type: 'bearer' })
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  }

  beforeAll(async () => {
    for (const f of fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : []) filesBefore.add(f);
    nim = await startFakeNim();
    process.env.NVIDIA_API_KEY = 'fake-local-key';
    process.env.NIM_API_URL = nim.url;
    process.env.TAILOR_AZ_FREE_WRITING = 'true';
    process.env.TAILOR_MAX_CALLS = '3';
    process.env.TAILOR_TIMEOUT_MS = '400';
    process.env.TAILOR_MAX_RETRY_WAIT_MS = '20';
    process.env.TAILOR_DAILY_LIMIT = '100';
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(function (this: unknown, ...args: unknown[]) {
        logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '));
      } as any);
    }
    env = await startPhase2App();

    for (const address of [email, otherEmail]) {
      await request(server()).post('/auth/register').send({ email: address, password }).expect(201);
      const mail = env.emails.getCapturedEmails().filter((m: any) => m.to === address).pop()!;
      const link = /href="([^"]+)"/.exec(mail.html)![1];
      await request(server()).post('/auth/verify-email').send({ token: new URL(link).searchParams.get('token') }).expect(201);
      const login = await request(server()).post('/auth/login').send({ email: address, password }).expect(201);
      if (address === email) token = login.body.sessionToken;
      else otherToken = login.body.sessionToken;
    }
    userId = (await env.prisma.user.findUniqueOrThrow({ where: { email } })).id;

    // First save, then a correction: only the corrected facts may be used.
    await patch('/profile', { name: 'Leyla Hüseynova', headline: 'Frontend developer', skills: ['React'], location: 'Gəncə' }).expect(200);
    await patch('/profile', {
      name: 'Leyla Hüseynova',
      headline: 'Backend mühəndisi',
      location: 'Gəncə',
      skills: ['NestJS', 'PostgreSQL', 'TypeScript', 'İngilis dili'],
      experiences: [
        {
          title: 'Backend Engineer',
          company: 'Qafqaz Labs',
          startDate: '2022-01-01',
          endDate: null,
          description: `Разработала REST API на NestJS и PostgreSQL.\nİş yükünü 30% azaltdı.\nTürkçe dokümantasyon hazırladı: ĞŞİıç.\n${CV_MARKER} daxili qeyd.`,
        },
      ],
      education: [{ institution: 'Azərbaycan Texniki Universiteti', degree: 'Bakalavr', fieldOfStudy: 'Kompüter elmləri', startDate: '2015-09-01', endDate: '2019-06-30' }],
    }).expect(200);
    await post('/profile/complete-onboarding').expect(201);
    await env.settle();

    const slugs = ['main', 'second', 'closing'].map((k) => `${stamp}-${k}`);
    const pages = [slugs.map((s) => fixtureSummary(s, `Backend Developer ${s.split('-').pop()}`))];
    const details = Object.fromEntries(slugs.map((s) => [s, fixtureDetail(`Backend Developer ${s.split('-').pop()}`, 'NestJS, PostgreSQL və Kubernetes ilə backend xidmətləri.')]));
    expect((await env.importFixtures(pages, details)).status).toBe('SUCCEEDED');
    await env.settle();
    for (const m of await env.prisma.match.findMany({ where: { userId }, include: { job: true } })) {
      matchIds[m.job!.externalId.split('-').pop()!] = m.id;
    }
    expect(Object.keys(matchIds).sort()).toEqual(['closing', 'main', 'second']);
  }, 120_000);

  afterAll(async () => {
    if (env) {
      await env.settle().catch(() => undefined);
      await env.prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
      await env.prisma.job.deleteMany({ where: { externalId: { startsWith: `glorri:${stamp}` } } });
      await env.close();
    }
    await nim?.close();
    // Only files this run created.
    for (const f of fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : []) {
      if (!filesBefore.has(f)) fs.unlinkSync(path.join(uploadDir, f));
    }
    jest.restoreAllMocks();
  }, 60_000);

  it('dedupes a double-click, survives reload while processing, and drafts only corrected facts', async () => {
    nim.setMode('hold');
    const [a, b] = await Promise.all([post('/resumes/tailor', { matchId: matchIds.main }), post('/resumes/tailor', { matchId: matchIds.main })]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await env.prisma.resume.count({ where: { userId, matchId: matchIds.main } })).toBe(1);

    // "Reload" while the provider is still working.
    for (let i = 0; i < 40 && nim.requests.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    const during = await get(`/resumes/${a.body.id}`).expect(200);
    expect(during.body).toMatchObject({ status: 'PENDING', fileUrl: null });
    expect((await get('/resumes').expect(200)).body.find((r: any) => r.id === a.body.id).status).toBe('PENDING');

    nim.release();
    const draft = await waitFor(a.body.id, 'NEEDS_REVIEW');
    expect(nim.requests).toHaveLength(1);
    expect(nim.requests[0].persona.basics.headline).toBe('Backend mühəndisi');
    expect(JSON.stringify(nim.requests[0].persona)).not.toContain('Frontend developer');
    expect(draft.fileUrl).toBeNull();
    expect(draft.content.basics).toMatchObject({ name: 'Leyla Hüseynova', headline: 'Backend mühəndisi' });
    expect(draft.content.experience[0]).toMatchObject({ company: 'Qafqaz Labs', position: 'Backend Engineer' });
    expect(draft.reviewNotes.issues.filter((i: any) => i.severity === 'error')).toEqual([]);
    expect(draft.generation).toMatchObject({ calls: 1 });
  }, 60_000);

  it('does not repeat provider work when the worker job is delivered again', async () => {
    const row = await env.prisma.resume.findFirstOrThrow({ where: { userId, matchId: matchIds.main } });
    const calls = nim.requests.length;
    await env.app.get<Queue>(getQueueToken('resume-tailor')).add('tailor-resume', { resumeId: row.id }, { jobId: `${row.id}-redelivered` });
    await env.settle();
    expect(nim.requests.length).toBe(calls);
    expect((await env.prisma.resume.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('NEEDS_REVIEW');
  }, 30_000);

  it('removes and reports invented employers, skills, metrics and education', async () => {
    nim.setMode('invented');
    const created = await post('/resumes/tailor', { matchId: matchIds.second }).expect(201);
    const draft = await waitFor(created.body.id, 'NEEDS_REVIEW');
    const text = JSON.stringify(draft.content);
    for (const invented of ['Google', 'Kubernetes', 'AWS', 'MIT', '45%']) expect(text).not.toContain(invented);
    expect(draft.content.skills[0].keywords.sort()).toEqual(['NestJS', 'PostgreSQL', 'TypeScript', 'İngilis dili'].sort());
    const codes = draft.reviewNotes.issues.map((i: any) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['invented_experience', 'invented_skill', 'unsupported_number', 'unsupported_term', 'invented_education']));
  }, 60_000);

  it.each([
    ['429 rate limiting', 'rate-limited', 'PROVIDER_RATE_LIMITED', 3],
    ['a timeout', 'hang', 'PROVIDER_TIMEOUT', 3],
    ['malformed JSON', 'malformed', 'INVALID_OUTPUT', 3],
  ] as const)('fails truthfully after bounded calls on %s, then recovers on a new request', async (_label, mode, code, calls) => {
    nim.setMode(mode);
    const before = nim.requests.length;
    const created = await post('/resumes/tailor', { matchId: matchIds.second }).expect(201);
    const failed = await waitFor(created.body.id, 'FAILED');
    expect(failed.statusError).toContain(`(${code})`);
    expect(failed.statusError).not.toContain(MODEL_MARKER);
    expect(failed.content).toBeNull();
    expect(nim.requests.length - before).toBe(calls);

    nim.setMode('faithful');
    const retried = await post('/resumes/tailor', { matchId: matchIds.second }).expect(201);
    expect(retried.body.id).not.toBe(created.body.id);
    await waitFor(retried.body.id, 'NEEDS_REVIEW');
  }, 60_000);

  it('keeps review, approval, content and file private to the owner', async () => {
    const row = await env.prisma.resume.findFirstOrThrow({ where: { userId, matchId: matchIds.main } });
    await get(`/resumes/${row.id}`, otherToken).expect(404);
    await patch(`/resumes/${row.id}/review`, { summary: 'x' }, otherToken).expect(404);
    await post(`/resumes/${row.id}/approve`, {}, otherToken).expect(404);
    await patch(`/resumes/${row.id}`, { parsedContent: { basics: { name: 'Mallory' } } }).expect(400);
    await request(server()).get(`/resumes/${row.id}`).expect(401);
  });

  it('applies review edits, refuses unsaved skills, survives a PDF failure and approves a readable PDF', async () => {
    const row = await env.prisma.resume.findFirstOrThrow({ where: { userId, matchId: matchIds.main } });
    await patch(`/resumes/${row.id}/review`, { skills: ['Kubernetes'] }).expect(400);
    const edited = await patch(`/resumes/${row.id}/review`, {
      summary: 'NestJS və PostgreSQL ilə backend xidmətləri quran mühəndis.',
      skills: ['PostgreSQL', 'NestJS', 'TypeScript', 'İngilis dili'],
      experience: [{ highlights: ['Разработала REST API на NestJS и PostgreSQL.', 'İş yükünü 30% azaltdı.', 'Türkçe dokümantasyon hazırladı: ĞŞİıç.'] }],
    }).expect(200);
    expect(edited.body.status).toBe('NEEDS_REVIEW');

    // A compile failure at approval leaves the draft in review and writes no file.
    const tailor = env.app.get(ResumeTailorService);
    const filesNow = fs.readdirSync(uploadDir).length;
    jest.spyOn(tailor, 'compilePdfBytes').mockImplementationOnce(() => { throw new TailorError('PDF_FAILED'); });
    const pdfFailure = await post(`/resumes/${row.id}/approve`).expect(400);
    expect(pdfFailure.body.message).toContain('PDF_FAILED');
    expect((await get(`/resumes/${row.id}`)).body.status).toBe('NEEDS_REVIEW');
    expect(fs.readdirSync(uploadDir).length).toBe(filesNow);

    const [approved, again] = await Promise.all([post(`/resumes/${row.id}/approve`), post(`/resumes/${row.id}/approve`)]);
    expect(approved.status).toBe(201);
    expect(again.status).toBe(201);
    expect(approved.body).toMatchObject({ status: 'READY', reviewedAt: expect.any(String) });
    expect(again.body.fileUrl).toBe(approved.body.fileUrl);
    expect(fs.readdirSync(uploadDir).length).toBe(filesNow + 1);

    const pdf = await download(approved.body.fileUrl).expect(200);
    const bytes = Buffer.from(pdf.body);
    expect(bytes.equals(fs.readFileSync(path.join(uploadDir, approved.body.fileUrl.split('/').pop())))).toBe(true);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const evidence = path.join(process.env.TAILOR_PDF_EVIDENCE_DIR || '/tmp', `${stamp}-approved.pdf`);
    fs.writeFileSync(evidence, bytes);
    const extracted = extractPdfTextOutOfBand(evidence).replace(/\s+/g, ' ');
    for (const expected of ['Leyla Hüseynova', 'Backend mühəndisi', 'Qafqaz Labs', 'Разработала REST API на NestJS и PostgreSQL', 'İş yükünü 30% azaltdı', 'ĞŞİıç', 'Azərbaycan Texniki Universiteti', 'İŞ TƏCRÜBƏSİ', 'TƏHSİL', 'BACARIQLAR']) {
      expect(extracted).toContain(expected);
    }
    const raw = bytes.toString('latin1');
    expect(raw).toMatch(/\/FontFile\d?/);
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+LibertinusSerif/);

    await download(approved.body.fileUrl, otherToken).expect(403);

    // Editing an approved CV withdraws its PDF until it is approved again.
    const reopened = await patch(`/resumes/${row.id}/review`, { summary: 'NestJS mühəndisi.' }).expect(200);
    expect(reopened.body).toMatchObject({ status: 'NEEDS_REVIEW', fileUrl: null, reviewedAt: null });
    expect(fs.existsSync(path.join(uploadDir, approved.body.fileUrl.split('/').pop()))).toBe(false);
  }, 60_000);

  it('refuses a closed job, marks a lost worker as failed, and enforces the daily limit', async () => {
    const [pages, details] = [
      [[`${stamp}-main`, `${stamp}-second`].map((s) => fixtureSummary(s, `Backend Developer ${s.split('-').pop()}`))],
      {
        [`${stamp}-main`]: fixtureDetail('Backend Developer main', 'NestJS, PostgreSQL və Kubernetes ilə backend xidmətləri.'),
        [`${stamp}-second`]: fixtureDetail('Backend Developer second', 'NestJS, PostgreSQL və Kubernetes ilə backend xidmətləri.'),
        [`${stamp}-closing`]: { status: 404 },
      },
    ];
    await env.importFixtures(pages as any, details);
    const closed = await post('/resumes/tailor', { matchId: matchIds.closing }).expect(400);
    expect(closed.body.message).toContain('aktiv deyil');

    const stale = await env.prisma.resume.create({
      data: { userId, matchId: matchIds.second, isBase: false, status: 'PENDING', createdAt: new Date(Date.now() - 20 * 60 * 1000) },
    });
    const listed = (await get('/resumes').expect(200)).body.find((r: any) => r.id === stale.id);
    expect(listed).toMatchObject({ status: 'FAILED', statusError: expect.stringContaining('(STALE)') });

    const today = await env.prisma.resume.count({ where: { userId, isBase: false } });
    process.env.TAILOR_DAILY_LIMIT = String(today);
    const limited = await post('/resumes/tailor', { matchId: matchIds.second }).expect(429);
    expect(limited.body.message).toContain('limiti');
    expect(await env.prisma.resume.count({ where: { userId, isBase: false } })).toBe(today);
    process.env.TAILOR_DAILY_LIMIT = '100';
  }, 60_000);

  it('never logged CV text, model output or credentials', () => {
    const joined = logs.join('\n');
    for (const secret of [CV_MARKER, MODEL_MARKER, 'fake-local-key', 'Разработала', 'Qafqaz Labs']) {
      expect(joined).not.toContain(secret);
    }
    expect(joined).toMatch(/resume-tailor \S+: FAILED PROVIDER_RATE_LIMITED/);
  });
});
