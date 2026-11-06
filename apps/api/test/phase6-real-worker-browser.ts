/** Local-only browser journey through the candidate UI with the REAL apply
 * worker process (Playwright + headless Chromium) against the local fixture
 * ATS. Run from apps/api: `npx ts-node --transpile-only test/phase6-real-worker-browser.ts`.
 *
 * Real: Next dev UI, Nest API, Postgres (isolated aise_phase2_test),
 * Redis/BullMQ, auth, the apply-worker process with its token guard.
 * Test configuration only: the API's destination registry gets the fixture
 * notice + receipt contract through DI, and the worker's browser routes
 * jobs.glorri.com to the loopback fixture (every other host aborted).
 * Two more fixture destinations use the same fixture ATS to show the other
 * capability states: one without a receipt contract (every send must end as
 * "Çatdırılma təsdiqlənməyib") and one without a captured declaration (no
 * automated route; the candidate is pointed to apply themselves).
 * Synthetic candidate and documents. */
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { statfsSync, openSync, closeSync, mkdirSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
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
import {
  FixtureAts, FIXTURE_DECLARATION, FIXTURE_OTP, FIXTURE_POLICY_URL, FIXTURE_RECEIPT_PATH, FIXTURE_RECEIPT_PATTERN, FIXTURE_REJECTION_PATTERN,
} from '../../apply-worker/test/support/fixture-ats';

const WEB = 'http://127.0.0.1:3450';
const API = 'http://127.0.0.1:4010';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const FIXTURE: ExternalDestination = {
  ...GLORRI_DESTINATION,
  notice: { url: FIXTURE_POLICY_URL, version: 'fixture-ats-1', declarationText: FIXTURE_DECLARATION },
  receipt: { textPattern: FIXTURE_RECEIPT_PATTERN, urlPathPattern: FIXTURE_RECEIPT_PATH, rejectionPattern: FIXTURE_REJECTION_PATTERN },
};
const FIXTURE_NO_RECEIPT: ExternalDestination = {
  ...FIXTURE, key: 'fixture-noreceipt', displayName: 'Fixture ATS (qəbul təsdiqi yoxdur)', sourcePrefix: 'noreceipt:', receipt: null,
};
const FIXTURE_NO_NOTICE: ExternalDestination = {
  ...FIXTURE, key: 'fixture-nonotice', displayName: 'Fixture ATS (bəyanat yoxdur)', sourcePrefix: 'nonotice:', notice: null,
};
const PREFIXES = ['glorri', 'noreceipt', 'nonotice'];
class FixtureRegistry extends ExternalDestinationRegistry {
  protected readonly destinations = [FIXTURE, FIXTURE_NO_RECEIPT, FIXTURE_NO_NOTICE];
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function main() {
  const root = resolve(process.cwd(), '../..');
  const free = () => { const s = statfsSync(root); return Number(s.bavail) * Number(s.bsize); };
  if (free() < 5 * 1024 ** 3) throw new Error('Need 5 GiB before browser stack');
  process.env.DATABASE_URL = 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
  const evidenceDir = process.env.PHASE6_EVIDENCE_DIR;
  if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
  const stamp = `phase6-${Date.now()}`;
  const email = `${stamp}-candidate@example.com`;
  const password = 'Phase6-Local-1!';
  const workerToken = randomBytes(16).toString('hex');
  const fixture = new FixtureAts();
  await fixture.start();
  const workerPort = await freePort();
  const workerDir = resolve(root, 'apps/apply-worker');
  const worker: ChildProcess = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/support/fixture-worker-main.ts'], {
    cwd: workerDir,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', TS_NODE_PROJECT: join(workerDir, 'tsconfig.json'),
      PORT: String(workerPort), APPLY_WORKER_TOKEN: workerToken, FIXTURE_ATS_ORIGIN: fixture.origin, CHROMIUM_PATH: CHROME,
      EXTERNAL_APPLY_LIVE_ENABLED: 'true', EXTERNAL_APPLY_MAX_SESSIONS: '2', EXTERNAL_APPLY_ACTION_TIMEOUT_MS: '5000', EXTERNAL_APPLY_SEND_OBSERVE_MS: '8000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((ok, fail) => {
    const t = setTimeout(() => fail(new Error('worker did not start')), 60_000);
    worker.stdout!.on('data', (d) => { if (String(d).includes('FIXTURE_WORKER_READY')) { clearTimeout(t); ok(); } });
    worker.once('exit', (c) => { clearTimeout(t); fail(new Error(`worker exited ${c}`)); });
  });
  worker.removeAllListeners('exit');

  Object.assign(process.env, {
    NODE_ENV: 'test', RESEND_API_KEY: 're_mock_key', POSTHOG_API_KEY: '', FRONTEND_URL: WEB,
    APPLY_WORKER_URL: `http://127.0.0.1:${workerPort}`, APPLY_WORKER_TOKEN: workerToken,
    EXTERNAL_APPLY_LIVE_ENABLED: 'true', EXTERNAL_APPLY_SEND_TIMEOUT_MS: '30000', EXTERNAL_APPLY_DAILY_SEND_LIMIT: '10', GLORRI_SCRAPER_ENABLED: 'false',
  });
  delete process.env.ENABLE_SANDBOX;
  const prefix = `aise-phase6-${process.pid}-${Date.now()}`;
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
    // Compile the heavy pages once before the timed steps: a cold Next dev
    // compile of /dashboard/matches outlasted the 45 s step timeout on a fresh checkout.
    for (const path of ['/dashboard', '/dashboard/matches', '/dashboard/apply/warm-up', '/dashboard/applications']) {
      await fetch(`${WEB}${path}`, { redirect: 'manual' }).catch(() => undefined);
    }

    const reg = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name: 'Sintetik Namizəd' }) });
    assert.equal(reg.status, 201);
    const mail = emails.getCapturedEmails().filter((m: any) => m.to === email).at(-1);
    const verifyToken = new URL(/href="([^"]+)"/.exec(mail.html)![1]).searchParams.get('token');
    assert.ok((await fetch(`${API}/auth/verify-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verifyToken }) })).ok);
    const user = await prisma.user.update({ where: { email }, data: { name: 'Sintetik Namizəd' } });
    process.env.EXTERNAL_APPLY_PILOT_USER_IDS = user.id;
    const cvUrl = await storage.uploadBuffer(Buffer.from(`%PDF-1.4\nSYNTHETIC-CV-${stamp}\n%%EOF\n`), 'application/pdf');
    const idUrl = await storage.uploadBuffer(Buffer.from(`\x89PNG\r\n\x1a\nSYNTHETIC-ID-${stamp}`), 'image/png');
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
    const seeds: [string, string][] = [
      ['glorri', 'questions-1'], ['glorri', 'captcha-1'], ['glorri', 'otp-1'], ['glorri', 'hang-1'],
      ['nonotice', 'normal-2'], ['noreceipt', 'normal-1'], ['glorri', 'reject-1'], ['glorri', 'slow-1'],
    ];
    for (const [i, [prefix, slug]] of seeds.entries()) {
      const job = await prisma.job.create({ data: {
        externalId: `${prefix}:${stamp}-${i}`, title: `Fixture vakansiya ${slug}`, company: 'Fixture MMC', description: 'Sintetik', location: 'Bakı',
        url: `https://jobs.glorri.com/vacancies/fixture-${stamp.slice(-6)}/${slug}`, postedAt: new Date(), rawPayload: { slug, company: { slug: `fixture-${stamp.slice(-6)}` } },
      } });
      await prisma.match.create({ data: { userId: user.id, jobId: job.id, score: 0.95 - i / 100 } });
    }

    browser = await chromium.launch({ headless: true, executablePath: CHROME });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await context.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    page.on('dialog', (d) => d.accept());
    await page.goto(`${WEB}/login`);
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await page.waitForURL((url) => url.pathname.startsWith('/dashboard'));
    console.log('PASS browser login as synthetic candidate');

    const openCard = async (slug: string) => {
      await page.goto(`${WEB}/dashboard/matches`);
      await page.getByRole('heading', { name: `Fixture vakansiya ${slug}` }).click();
    };
    const openConsent = async (slug: string) => {
      await openCard(slug);
      await page.getByRole('button', { name: /Avtomatik müraciət hazırla/ }).click();
      await page.waitForURL((url) => url.pathname.startsWith('/dashboard/apply/'));
      await page.getByText(FIXTURE_DECLARATION).waitFor();
    };
    const consent = async () => {
      await page.getByRole('checkbox', { name: /oxudum/ }).check();
      await page.getByRole('checkbox', { name: /yalnız bu vakansiya üçün/ }).check();
      await page.getByRole('button', { name: 'Razılıq ver və formanı hazırla' }).click();
    };
    const start = async (slug: string) => {
      await openConsent(slug);
      await consent();
    };
    const sendFromReview = async () => {
      await page.getByRole('button', { name: /Göndərişi təsdiqlə/ }).click();
      await page.getByRole('button', { name: 'Bəli, real olaraq göndər' }).click();
    };
    const rowFor = async (slug: string) => {
      const job = await prisma.job.findFirst({ where: { title: `Fixture vakansiya ${slug}`, externalId: { contains: stamp } } });
      return prisma.externalApplication.findFirst({ where: { match: { jobId: job!.id } }, orderBy: { createdAt: 'desc' } });
    };

    // 1. Real fill with required questions → review with the worker's own screenshot → one send → validated receipt.
    await start('questions-1');
    await page.getByText('Sürücülük vəsiqəniz var?').waitFor();
    assert.equal(fixture.of('questions-1').clicks, 0);
    // Question labels come from the destination's radio names until the live DOM is mapped (Phase 6 open item).
    await page.getByRole('radio', { name: 'Xeyr' }).first().check();
    await page.getByRole('radio', { name: 'Bəli' }).nth(1).check();
    await page.getByRole('button', { name: 'Cavabları Formaya Yaz' }).click();
    await page.getByText('Göndərişdən əvvəl yoxlayın').waitFor();
    await page.getByAltText('Formanın nəzərdən keçirmə skrinşotu').waitFor();
    await shot(page, '1-review-real-worker');
    await page.getByRole('button', { name: /Göndərişi təsdiqlə/ }).click();
    await page.getByRole('button', { name: 'Bəli, real olaraq göndər' }).dblclick();
    await page.getByText('Müraciətin qəbulu təsdiqləndi').waitFor();
    const reference = fixture.of('questions-1').receipts[0];
    await page.getByText(reference).waitFor();
    assert.equal(fixture.of('questions-1').clicks, 1);
    assert.equal(fixture.of('questions-1').submissions.length, 1);
    assert.deepEqual(Object.keys(fixture.of('questions-1').submissions[0].fields).filter((k) => k.startsWith('questions.')).sort(), ['questions.0.answer', 'questions.1.answer']);
    await shot(page, '2-receipt-real-worker');
    console.log(`PASS browser real worker: questions answered, review screenshot shown, double-click → one send, receipt ${reference} validated and shown`);

    // 2. CAPTCHA: stopped before anything is sent, with the assisted route.
    await start('captcha-1');
    await page.getByText(/CAPTCHA/).waitFor();
    await page.getByRole('link', { name: /Vakansiyanı mənbə saytda aç/ }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Yenidən Başla' }).count(), 0);
    assert.equal(fixture.of('captcha-1').clicks, 0);
    await shot(page, '3-captcha-assisted');
    console.log('PASS browser real worker: visible CAPTCHA → stopped, nothing sent, assisted route offered');

    // 3. OTP through the UI: wrong then correct code.
    await start('otp-1');
    await page.getByRole('button', { name: /Göndərişi təsdiqlə/ }).click();
    await page.getByRole('button', { name: 'Bəli, real olaraq göndər' }).click();
    await page.getByText('Qalan cəhd: 5 / 5').waitFor();
    await page.getByRole('textbox', { name: 'Təsdiq kodu' }).fill('000000');
    await page.getByRole('button', { name: 'Təsdiqlə' }).click();
    await page.getByText('Kod yanlışdır').waitFor();
    await page.getByRole('textbox', { name: 'Təsdiq kodu' }).fill(FIXTURE_OTP);
    await page.getByRole('button', { name: 'Təsdiqlə' }).click();
    await page.getByText('Müraciətin qəbulu təsdiqləndi').waitFor();
    await page.getByText(fixture.of('otp-1').receipts[0]).waitFor();
    console.log('PASS browser real worker: OTP wrong then correct → receipt');

    // 4. Connection dropped after the destination got the data: uncertain, no resend offered.
    await start('hang-1');
    await page.getByRole('button', { name: /Göndərişi təsdiqlə/ }).click();
    await page.getByRole('button', { name: 'Bəli, real olaraq göndər' }).click();
    await page.getByText('Çatdırılma təsdiqlənməyib').waitFor();
    assert.equal(await page.getByRole('button', { name: /Yenidən Başla|Göndərişi təsdiqlə/ }).count(), 0);
    assert.equal(fixture.of('hang-1').submissions.length, 1);
    await shot(page, '4-unconfirmed-real-worker');
    console.log('PASS browser real worker: dropped connection → "Çatdırılma təsdiqlənməyib", no resend');

    // 5. No captured declaration: no automated route; the reason and the existing apply-yourself controls instead.
    await openCard('normal-2');
    const applyYourself = page.getByTestId('apply-yourself');
    await applyYourself.waitFor();
    assert.match(await applyYourself.innerText(), /Avtomatik müraciət mövcud deyil\./);
    assert.match(await applyYourself.innerText(), /bəyanatı AISE-də qeydə alınmayıb/);
    assert.match(await applyYourself.innerText(), /«Müraciət etdim» ilə qeyd edin/);
    assert.equal(await page.getByRole('button', { name: /Avtomatik müraciət hazırla/ }).count(), 0);
    assert.match((await page.getByRole('link', { name: /Mənbəyə bax/ }).getAttribute('href'))!, /^https:\/\/jobs\.glorri\.com\/vacancies\/fixture-[a-z0-9]+\/normal-2$/);
    assert.equal(fixture.of('normal-2').clicks, 0);
    assert.equal(fixture.of('normal-2').submissions.length, 0);
    await shot(page, '5-apply-yourself');
    console.log('PASS browser capability: destination without a captured declaration → reason shown, apply-yourself route, nothing sent');

    // 6. No receipt contract: said on the card, before consent and in the final
    //    confirmation; after a real send the destination shows its own receipt,
    //    yet AISE reports an unconfirmed delivery and never "submitted".
    await openCard('normal-1');
    await page.getByTestId('receipt-unverifiable').waitFor();
    await openConsent('normal-1');
    const consentWarning = page.getByTestId('receipt-unverifiable');
    assert.match(await consentWarning.innerText(), /Qəbul təsdiqlənə bilməz/);
    assert.match(await consentWarning.innerText(), /«Çatdırılma təsdiqlənməyib»/);
    await shot(page, '6a-consent-receipt-unverifiable');
    await consent();
    await page.getByRole('button', { name: /Göndərişi təsdiqlə/ }).click();
    assert.match(await page.getByRole('dialog').innerText(), /Çatdırılma təsdiqlənməyib/);
    await page.getByRole('button', { name: 'Bəli, real olaraq göndər' }).dblclick();
    await page.getByRole('heading', { name: 'Çatdırılma təsdiqlənməyib' }).waitFor(); // the outcome screen, not the warning text
    assert.equal(fixture.of('normal-1').clicks, 1);
    assert.equal(fixture.of('normal-1').submissions.length, 1);
    assert.equal(fixture.of('normal-1').receipts.length, 1, 'the destination did show a receipt');
    assert.equal(await page.getByText('Müraciətin qəbulu təsdiqləndi').count(), 0);
    assert.equal(await page.getByText(fixture.of('normal-1').receipts[0]).count(), 0);
    const noReceiptRow = await rowFor('normal-1');
    assert.equal(noReceiptRow!.status, 'DELIVERY_UNCONFIRMED');
    assert.equal(noReceiptRow!.receiptReference, null);
    await page.goto(`${WEB}/dashboard/applications`);
    await page.getByText('Fixture vakansiya normal-1').first().waitFor();
    assert.equal(await page.getByText(fixture.of('normal-1').receipts[0]).count(), 0);
    await shot(page, '6b-no-receipt-contract-unconfirmed');
    console.log('PASS browser capability: no receipt contract → warned before consent and send; destination receipt ignored; "Çatdırılma təsdiqlənməyib", never submitted');

    // 7. A documented refusal: failed, with the destination's reason, no receipt.
    await start('reject-1');
    await sendFromReview();
    await page.getByText('Qəbul edən sayt müraciəti rədd etdi.').waitFor();
    assert.equal(fixture.of('reject-1').submissions.length, 1);
    const rejectedRow = await rowFor('reject-1');
    assert.equal(rejectedRow!.status, 'FAILED');
    assert.equal(rejectedRow!.stateReason, 'DESTINATION_REJECTED');
    assert.equal(rejectedRow!.receiptReference, null);
    await shot(page, '7-documented-rejection');
    console.log('PASS browser real worker: documented refusal → "Müraciət tamamlanmadı", no receipt');

    // 8. Slower than the API will wait: unconfirmed, and it stays unconfirmed
    //    after the destination later issues its receipt; nothing is resent.
    process.env.EXTERNAL_APPLY_SEND_TIMEOUT_MS = '1500';
    try {
      await start('slow-1');
      await sendFromReview();
      await page.getByRole('heading', { name: 'Çatdırılma təsdiqlənməyib' }).waitFor(); // the outcome screen, not the warning text
    } finally {
      process.env.EXTERNAL_APPLY_SEND_TIMEOUT_MS = '30000';
    }
    await sleep(4000);
    assert.equal(fixture.of('slow-1').receipts.length, 1, 'the slow destination did issue a receipt later');
    await page.reload();
    await page.getByRole('heading', { name: 'Çatdırılma təsdiqlənməyib' }).waitFor(); // the outcome screen, not the warning text
    assert.equal(await page.getByText('Müraciətin qəbulu təsdiqləndi').count(), 0);
    assert.equal(await page.getByRole('button', { name: /Yenidən Başla|Göndərişi təsdiqlə/ }).count(), 0);
    assert.equal(fixture.of('slow-1').submissions.length, 1);
    assert.equal((await rowFor('slow-1'))!.status, 'DELIVERY_UNCONFIRMED');
    await shot(page, '8-timeout-unconfirmed');
    console.log('PASS browser real worker: send timeout → "Çatdırılma təsdiqlənməyib", late receipt not trusted, no resend');
  } finally {
    await browser?.close().catch(() => undefined);
    if (web && web.exitCode === null) { web.kill('SIGTERM'); await new Promise<void>((r) => web!.once('exit', () => r())); }
    closeSync(log);
    const rows = await prisma.externalApplication.findMany({ where: { user: { email } } });
    for (const r of rows) for (const u of [r.cvSnapshotUrl, r.idDocumentSnapshotUrl, r.reviewScreenshotUrl]) if (u) files.push(u);
    await prisma.user.deleteMany({ where: { email } });
    await prisma.job.deleteMany({ where: { OR: PREFIXES.map((p) => ({ externalId: { startsWith: `${p}:${stamp}-` } })) } });
    for (const u of files) await storage.deleteFile(u).catch(() => undefined);
    await app.close();
    if (worker.exitCode === null) { worker.kill('SIGTERM'); await new Promise<void>((r) => worker.once('exit', () => r())); }
    await fixture.stop();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    console.log(`Cleanup done; free disk ${(free() / 1024 ** 3).toFixed(2)} GiB; Next log: ${logPath}`);
  }
}

main().catch((error) => { console.error('PHASE6_BROWSER_FAILED', error.message); process.exitCode = 1; });
