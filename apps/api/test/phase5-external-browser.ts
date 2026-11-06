/** Local-only external-application browser rehearsal. Run from apps/api with
 * `ts-node --transpile-only test/phase5-external-browser.ts`.
 *
 * Real: Nest API, Postgres (isolated aise_phase2_test), Redis/BullMQ, auth,
 * Next dev server, Chromium UI. Stand-ins: the apply worker is the loopback
 * FakeApplyWorker (no browser automation, no destination contact) and the
 * destination registry gets a fixture notice + receipt contract through DI.
 * The production registry (Glorri: no notice, no receipt) is not changed.
 * Synthetic accounts, documents and vacancies only. */
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { statfsSync, openSync, closeSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import IORedis from 'ioredis';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { AuthModule } from '../src/auth/auth.module';
import { ProfilesModule } from '../src/profiles/profiles.module';
import { ResumesModule } from '../src/resumes/resumes.module';
import { MatchingModule } from '../src/matching/matching.module';
import { DashboardModule } from '../src/dashboard/dashboard.module';
import { UploadsModule } from '../src/uploads/uploads.module';
import { ExternalApplyModule } from '../src/external-apply/external-apply.module';
import { ExternalDestinationRegistry, GLORRI_DESTINATION, type ExternalDestination } from '../src/external-apply/destinations';
import { LocalStorageService } from '../src/resumes/local-storage.service';
import { PostHogService } from '../src/common/posthog.service';
import { EmailService } from '../src/common/email.service';
import { FakeApplyWorker } from './support/fake-apply-worker';

const WEB = 'http://127.0.0.1:3450';
const API = 'http://127.0.0.1:4010';
const NOTICE = { url: 'https://jobs.glorri.com/privacy', version: 'fixture-2026-09', declarationText: 'Sintetik bəyanat: məlumatlarımın bu vakansiya üçün işlənməsinə razıyam.' };
const FIXTURE: ExternalDestination = { ...GLORRI_DESTINATION, notice: NOTICE, receipt: { textPattern: /Müraciət nömrəsi:\s*([A-Z0-9-]+)/ } };
class FixtureRegistry extends ExternalDestinationRegistry {
  protected readonly destinations = [FIXTURE];
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const root = resolve(process.cwd(), '../..');
  const free = () => { const s = statfsSync(root); return Number(s.bavail) * Number(s.bsize); };
  if (free() < 5 * 1024 ** 3) throw new Error('Need 5 GiB before browser stack');
  process.env.DATABASE_URL = 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
  const evidenceDir = process.env.PHASE5_EVIDENCE_DIR;
  if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
  const stamp = `phase5-${Date.now()}`;
  const email = `${stamp}-candidate@example.com`;
  const password = 'Phase5-Local-1!';
  const workerToken = randomBytes(16).toString('hex');
  const worker = new FakeApplyWorker(workerToken);

  Object.assign(process.env, {
    NODE_ENV: 'test', RESEND_API_KEY: 're_mock_key', POSTHOG_API_KEY: '', FRONTEND_URL: WEB,
    APPLY_WORKER_URL: await worker.start(), APPLY_WORKER_TOKEN: workerToken,
    EXTERNAL_APPLY_LIVE_ENABLED: 'true', EXTERNAL_APPLY_SEND_TIMEOUT_MS: '1500', EXTERNAL_APPLY_DAILY_SEND_LIMIT: '10',
    GLORRI_SCRAPER_ENABLED: 'false',
  });
  delete process.env.ENABLE_SANDBOX;
  const prefix = `aise-phase5-${process.pid}-${Date.now()}`;
  const module = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 10000 }]),
    BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }),
    DatabaseModule, AuthModule, ProfilesModule, ResumesModule, MatchingModule, DashboardModule, UploadsModule, ExternalApplyModule,
  ] }).overrideProvider(PostHogService).useValue({ capture() {} })
    .overrideProvider(ExternalDestinationRegistry).useValue(new FixtureRegistry()).compile();
  const app = module.createNestApplication({ logger: ['error', 'warn'] });
  app.enableCors({ origin: WEB, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  const prisma = app.get(PrismaService);
  const storage = app.get(LocalStorageService);
  const emails = app.get(EmailService) as any;

  let web: ChildProcess | undefined;
  let browser: Browser | undefined;
  const logPath = `/tmp/${stamp}-next.log`;
  const log = openSync(logPath, 'w', 0o600);
  const files: string[] = [];
  const shot = async (page: Page, name: string) => { if (evidenceDir) await page.screenshot({ path: join(evidenceDir, `${name}.png`), fullPage: true }); };
  try {
    await app.listen(4010, '127.0.0.1');
    web = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3450'], {
      cwd: resolve(root, 'apps/web'), stdio: ['ignore', log, log],
      env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_API_URL: API, NEXTAUTH_URL: WEB, NEXTAUTH_SECRET: randomBytes(32).toString('hex'), NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_TELEMETRY_DISABLED: '1' },
    });
    for (let i = 0; i < 120; i++) {
      if (web.exitCode !== null) throw new Error(`Next exited; see ${logPath}`);
      try { if ((await fetch(`${WEB}/login`)).ok) break; } catch {}
      if (i === 119) throw new Error('Next readiness timeout');
      await sleep(1000);
    }

    // Synthetic candidate: registered and verified through the real auth API.
    const reg = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name: 'Sintetik Namizəd' }) });
    assert.equal(reg.status, 201);
    const mail = emails.getCapturedEmails().filter((m: any) => m.to === email).at(-1);
    const token = new URL(/href="([^"]+)"/.exec(mail.html)![1]).searchParams.get('token');
    assert.ok((await fetch(`${API}/auth/verify-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })).ok);
    const user = await prisma.user.update({ where: { email }, data: { name: 'Sintetik Namizəd' } });
    process.env.EXTERNAL_APPLY_PILOT_USER_IDS = user.id;
    const cvUrl = await storage.uploadBuffer(Buffer.from(`%PDF-1.4\nSYNTHETIC-CV-${stamp}\n%%EOF\n`), 'application/pdf');
    const idUrl = await storage.uploadBuffer(Buffer.from(`SYNTHETIC-ID-${stamp}`), 'image/png');
    files.push(cvUrl, idUrl);
    await prisma.subscription.upsert({ where: { userId: user.id }, create: { userId: user.id, plan: 'Limitsiz', status: 'active' }, update: { plan: 'Limitsiz', status: 'active' } });
    await prisma.profile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id, headline: 'Backend developer', skills: ['TypeScript'], location: 'Bakı', jobPreferences: {}, onboardingCompletedAt: new Date(),
        phone: '+994500000000', address: 'Sintetik küçə 1', citizenship: 'Azərbaycan', dob: new Date('1995-05-05'), salaryExpectation: 2000,
        preferredNetGross: 'Net', preferredCurrency: 'AZN', idDocumentUrl: idUrl, defaultCoverLetter: 'Sintetik motivasiya məktubu: bu vəzifəyə müraciət edirəm.',
      },
      update: {},
    });
    await prisma.resume.create({ data: { userId: user.id, isBase: true, status: 'READY', fileUrl: cvUrl } });
    const jobs = [];
    for (const n of [1, 2]) {
      const slug = `${stamp}-${n}`;
      const job = await prisma.job.create({ data: {
        externalId: `glorri:${slug}`, title: `Sintetik vakansiya ${n}`, company: 'Sintetik MMC', description: 'Sintetik təsvir', location: 'Bakı',
        url: `https://jobs.glorri.com/vacancies/sintetik/${slug}`, postedAt: new Date(), rawPayload: { slug, company: { slug: 'sintetik' } },
      } });
      jobs.push(await prisma.match.create({ data: { userId: user.id, jobId: job.id, score: 0.9 - n / 100 } }));
    }

    // Scripted worker: a screening question, then OTP, then a receipt.
    worker.handlers.create = (req, res) => {
      worker.live.add(req.body.applicationId);
      FakeApplyWorker.json(res, 201, { status: 'NEEDS_INPUT', previewData: {}, missingFields: [{ fieldKey: 'questions.0.answer', label: 'Sürücülük vəsiqəniz var?', type: 'radio', options: ['Bəli', 'Xeyr'] }] });
    };
    worker.handlers.answers = (_req, res) => FakeApplyWorker.json(res, 200, { status: 'READY_FOR_REVIEW', previewData: { line_0: 'Formadakı icmal (sintetik)' }, missingFields: [] });
    worker.handlers.confirm = async (req, res) => {
      await sleep(700);
      FakeApplyWorker.json(res, 200, { attemptId: req.body.attemptId, outcome: 'AWAITING_OTP' });
    };
    worker.handlers.otp = (req, res) => {
      if (req.body.code !== '424242') return FakeApplyWorker.json(res, 200, { attemptId: req.body.attemptId, outcome: 'OTP_INVALID' });
      worker.live.delete(req.path.split('/')[2]);
      FakeApplyWorker.json(res, 200, { attemptId: req.body.attemptId, outcome: 'SENT_OBSERVED', observation: { url: 'https://jobs.glorri.com/applications/done', text: 'Təşəkkürlər! Müraciət nömrəsi: GL-UI-0001' } });
    };

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await context.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('dialog', (d) => d.accept());
    await page.goto(`${WEB}/login`);
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await page.waitForURL((url) => url.pathname.startsWith('/dashboard'));
    console.log('PASS browser login as synthetic candidate');

    // 1. Matches page: server capability drives the CTA; starting creates a draft only.
    await page.goto(`${WEB}/dashboard/matches`);
    await page.getByRole('heading', { name: 'Sintetik vakansiya 1' }).click();
    await page.getByRole('button', { name: /Avtomatik müraciət hazırla/ }).click();
    await page.waitForURL((url) => url.pathname.startsWith('/dashboard/apply/'));
    const appId = page.url().split('/').pop()!;
    await page.getByText(NOTICE.declarationText).waitFor();
    await page.getByText('+994500000000').waitFor();
    await page.getByText(/Niyə lazımdır: .*şəxsiyyət vəsiqəsinin/).waitFor();
    assert.equal(worker.count('create'), 0, 'nothing transmitted before consent');
    const grant = page.getByRole('button', { name: 'Razılıq ver və formanı hazırla' });
    assert.equal(await grant.isDisabled(), true);
    await shot(page, '1-consent');
    await page.getByRole('checkbox', { name: /oxudum/ }).check();
    await page.getByRole('checkbox', { name: /yalnız bu vakansiya üçün/ }).check();
    await grant.click();
    console.log('PASS browser destination + actual notice + exact fields/documents shown; explicit scoped consent; nothing sent before it');

    // 2. Unknown screening answer asked of the candidate.
    await page.getByText('Sürücülük vəsiqəniz var?').waitFor({ timeout: 30000 });
    assert.equal(worker.count('create'), 1);
    await page.getByRole('radio', { name: 'Xeyr' }).check();
    await page.getByRole('button', { name: 'Cavabları Formaya Yaz' }).click();
    await page.getByText('Göndərişdən əvvəl yoxlayın').waitFor();
    await page.getByRole('cell', { name: 'Xeyr' }).waitFor();
    await page.getByText(/CV \(razılıq verdiyiniz anda saxlanılan surət\)/).waitFor();
    await shot(page, '2-review');
    console.log('PASS browser missing screening answer asked; exact answers/documents shown before final send');

    // 3. Final send: a double-click on the send button makes one worker call.
    await page.getByRole('button', { name: /Göndərişi təsdiqlə/ }).click();
    await page.getByRole('button', { name: 'Bəli, real olaraq göndər' }).dblclick();
    await page.getByText('Qalan cəhd: 5 / 5').waitFor();
    assert.equal(worker.count('confirm-submit'), 1, 'double-click must not send twice');
    const attempts = await prisma.externalApplicationAttempt.findMany({ where: { externalApplicationId: appId } });
    assert.equal(attempts.length, 1);
    await page.getByRole('textbox', { name: 'Təsdiq kodu' }).fill('000000');
    await page.getByRole('button', { name: 'Təsdiqlə' }).click();
    await page.getByText('Kod yanlışdır').waitFor();
    await page.getByText('Qalan cəhd: 4 / 5').waitFor();
    await page.getByRole('textbox', { name: 'Təsdiq kodu' }).fill('424242');
    await page.getByRole('button', { name: 'Təsdiqlə' }).click();
    await page.getByText('Müraciətin qəbulu təsdiqləndi').waitFor();
    await page.getByText('GL-UI-0001').waitFor();
    await shot(page, '3-receipt');
    const row = await prisma.externalApplication.findUniqueOrThrow({ where: { id: appId } });
    assert.equal(row.status, 'SUBMITTED');
    assert.equal(row.receiptReference, 'GL-UI-0001');
    console.log('PASS browser double-click → one send; OTP invalid then valid; receipt shown only with validated reference');

    // 4. Timeout after a possible send: shown as unconfirmed, never resent.
    worker.handlers.create = (req, res) => {
      worker.live.add(req.body.applicationId);
      FakeApplyWorker.json(res, 201, { status: 'READY_FOR_REVIEW', previewData: {}, missingFields: [] });
    };
    worker.handlers.confirm = async () => { /* no reply: the send may have happened */ };
    await page.goto(`${WEB}/dashboard/matches`);
    await page.getByRole('heading', { name: 'Sintetik vakansiya 2' }).click();
    await page.getByRole('button', { name: /Avtomatik müraciət hazırla/ }).click();
    await page.waitForURL((url) => url.pathname.startsWith('/dashboard/apply/') && !url.pathname.endsWith(appId));
    const app2 = page.url().split('/').pop()!;
    await page.getByRole('checkbox', { name: /oxudum/ }).check();
    await page.getByRole('checkbox', { name: /yalnız bu vakansiya üçün/ }).check();
    await page.getByRole('button', { name: 'Razılıq ver və formanı hazırla' }).click();
    await page.getByRole('button', { name: /Göndərişi təsdiqlə/ }).click();
    const before = worker.count('confirm-submit');
    await page.getByRole('button', { name: 'Bəli, real olaraq göndər' }).click();
    await page.getByText('Çatdırılma təsdiqlənməyib').waitFor();
    await page.getByText(/avtomatik yenidən göndərmir/).waitFor();
    assert.equal(await page.getByRole('button', { name: /Yenidən Başla|Göndərişi təsdiqlə/ }).count(), 0);
    await shot(page, '4-unconfirmed');
    assert.equal(worker.count('confirm-submit'), before + 1);
    assert.equal((await prisma.externalApplication.findUniqueOrThrow({ where: { id: app2 } })).status, 'DELIVERY_UNCONFIRMED');
    await page.goto(`${WEB}/dashboard/matches`);
    await page.getByRole('heading', { name: 'Sintetik vakansiya 2' }).click();
    await page.getByRole('link', { name: /Avtomatik müraciətin vəziyyəti/ }).waitFor();
    console.log('PASS browser timeout after possible send → unconfirmed, no resend offered; matches page links status, not a new send');

    // 5. Gate off: only the assisted route remains, with no false label.
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'false';
    const job3 = await prisma.job.create({ data: {
      externalId: `glorri:${stamp}-3`, title: 'Sintetik vakansiya 3', company: 'Sintetik MMC', description: 'x', location: 'Bakı',
      url: `https://jobs.glorri.com/vacancies/sintetik/${stamp}-3`, postedAt: new Date(), rawPayload: { slug: `${stamp}-3`, company: { slug: 'sintetik' } },
    } });
    const match3 = await prisma.match.create({ data: { userId: user.id, jobId: job3.id, score: 0.95 } });
    await page.goto(`${WEB}/dashboard/matches`);
    await page.getByRole('heading', { name: 'Sintetik vakansiya 3' }).click();
    // Not offered → nothing about auto-apply is shown (since main's #3); the
    // source link and "Müraciət etdim" remain.
    await page.getByRole('link', { name: /Glorri-də bax/ }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Avtomatik müraciət hazırla/ }).count(), 0);
    assert.equal(await page.getByText(/Avtomatik müraciət/).count(), 0);
    await shot(page, '5-assisted');
    assert.equal(await prisma.externalApplication.count({ where: { matchId: match3.id } }), 0);
    console.log('PASS browser gate off → assisted route only, no automated action offered');
  } finally {
    await browser?.close().catch(() => undefined);
    if (web && web.exitCode === null) { web.kill('SIGTERM'); await new Promise<void>((r) => web!.once('exit', () => r())); }
    closeSync(log);
    const rows = await prisma.externalApplication.findMany({ where: { user: { email } } });
    for (const r of rows) for (const u of [r.cvSnapshotUrl, r.idDocumentSnapshotUrl, r.reviewScreenshotUrl]) if (u) files.push(u);
    await prisma.user.deleteMany({ where: { email } });
    await prisma.job.deleteMany({ where: { externalId: { startsWith: `glorri:${stamp}-` } } });
    for (const u of files) await storage.deleteFile(u).catch(() => undefined);
    await app.close();
    await worker.stop();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    console.log(`Cleanup done; free disk ${(free() / 1024 ** 3).toFixed(2)} GiB; Next log: ${logPath}`);
  }
}

main().catch((error) => { console.error('PHASE5_BROWSER_FAILED', error.message); process.exitCode = 1; });
