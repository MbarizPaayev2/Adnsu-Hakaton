/**
 * Founder handover rehearsal: the operator duties a founder performs, driven
 * through the real UI against the fully assembled API process (dist/main.js,
 * the same entry point the production image runs), including an API restart.
 *
 *   npx nest build && BACKUP_STATUS_FILE=… npx ts-node --transpile-only test/founder-handover-browser.ts
 *
 * Synthetic data only, in its own local database (aise_release_rehearsal).
 * The founder here is a synthetic operator — never ceo@aisehr.com. No mail
 * leaves the machine (mock provider), no employer or payment provider is
 * contacted, and the apply worker and matching service are deliberately
 * unreachable so a queue failure can be diagnosed and retried.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, openSync, closeSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { seedUxFixture, removeUxFixture, UX_EMAILS, UX_PASSWORD } from './support/ux-fixture';
import { base32Decode, currentStep, totpAt } from '../src/admin/mfa.util';

const root = resolve(__dirname, '../../..');
const API_PORT = 4030;
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = 'http://127.0.0.1:3450';
const DB_NAME = 'aise_release_rehearsal';
const DATABASE_URL = `postgresql://postgres:postgrespassword@127.0.0.1:5433/${DB_NAME}?schema=public`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url: string, label: string, child?: ChildProcess, seconds = 120) {
  for (let i = 0; i < seconds; i++) {
    if (child && child.exitCode !== null) throw new Error(`${label} exited early`);
    try { if ((await fetch(url)).ok) return; } catch { /* not yet */ }
    await sleep(1000);
  }
  throw new Error(`${label} readiness timeout`);
}

async function main() {
  const stamp = `handover-${Date.now()}`;
  const founderEmail = `${stamp}-founder@example.com`;
  const employerEmail = `${stamp}-employer@example.com`;
  const password = 'Founder-Rehearsal-Pass-1';
  const work = mkdtempSync(join(tmpdir(), 'aise-handover-'));
  const uploads = join(work, 'uploads');
  mkdirSync(uploads, { recursive: true });
  const evidenceDir = process.env.HANDOVER_EVIDENCE_DIR;
  const backupStatusFile = process.env.BACKUP_STATUS_FILE;
  const release = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  const mfaKey = randomBytes(32).toString('base64');

  // Own database: created and migrated here, never the shared e2e one.
  execFileSync('psql', ['-h', '127.0.0.1', '-p', '5433', '-U', 'postgres', '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`], { env: { ...process.env, PGPASSWORD: 'postgrespassword' } }).toString().trim() === '1'
    || execFileSync('psql', ['-h', '127.0.0.1', '-p', '5433', '-U', 'postgres', '-d', 'postgres', '-c', `CREATE DATABASE ${DB_NAME}`], { env: { ...process.env, PGPASSWORD: 'postgrespassword' } });
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL }, stdio: 'ignore' });

  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  process.env.UX_UPLOAD_DIR = uploads;
  await seedUxFixture(prisma);
  await prisma.featureFlag.deleteMany({});
  const founder = await prisma.adminUser.create({ data: { email: founderEmail, hashedPassword: await bcrypt.hash(password, 10), role: 'SUPER_ADMIN', name: 'Rehearsal founder' } });
  const pending = await prisma.business.create({
    data: { email: employerEmail, hashedPassword: await bcrypt.hash(password, 4), emailVerified: new Date(), company: { create: { name: `Gözləyən Sintetik MMC ${stamp}`, status: 'PENDING' } } } as any,
    include: { company: true },
  });
  const candidate = await prisma.user.findUniqueOrThrow({ where: { email: UX_EMAILS.candidate } });
  const [receiptMatch] = await prisma.match.findMany({ where: { userId: candidate.id, status: 'NEW' } });
  await prisma.externalApplication.create({
    data: { userId: candidate.id, matchId: receiptMatch.id, status: 'SUBMITTED', applyUrl: 'https://jobs.glorri.com/vacancies/ux-fixture/backend', submittedAt: new Date(), receiptReference: 'FX-HANDOVER-1', destinationKey: 'glorri' },
  });
  const listing = await prisma.job.findFirstOrThrow({ where: { externalId: 'glorri:ux-fullstack' } });

  const apiLog = openSync(join(work, 'api.log'), 'w', 0o600);
  const webLog = openSync(join(work, 'next.log'), 'w', 0o600);
  const apiEnv = {
    PATH: process.env.PATH!, HOME: process.env.HOME!, NODE_ENV: 'production', APP_ENV: 'rehearsal', PORT: String(API_PORT),
    DATABASE_URL, REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379', RELEASE_SHA: release,
    FRONTEND_URL: WEB, ADMIN_WEB_URL: WEB, ADMIN_MFA_ENCRYPTION_KEY: mfaKey,
    // Production mode, as deployed. No mail is sent in this journey; the mock
    // key would be refused by EmailService in production if anything tried.
    RESEND_API_KEY: 're_mock_key', GLORRI_SCRAPER_ENABLED: 'false', PAYMENTS_ENABLED: 'false',
    MATCHING_SERVICE_URL: 'http://127.0.0.1:9', APPLY_WORKER_URL: 'http://127.0.0.1:9',
    ...(backupStatusFile ? { BACKUP_STATUS_FILE: backupStatusFile } : {}),
  };
  const startApi = () => spawn(process.execPath, [resolve(__dirname, '../dist/main.js')], { cwd: work, env: apiEnv, stdio: ['ignore', apiLog, apiLog] });
  let api: ChildProcess | undefined = startApi();
  let web: ChildProcess | undefined;
  let browser: Browser | undefined;
  const queue = new Queue('job-ingested', { connection: { host: '127.0.0.1', port: 6379 } });
  const shot = async (page: Page, name: string) => { if (evidenceDir) await page.screenshot({ path: join(evidenceDir, `${name}.png`), fullPage: true }); };
  let lastStep = 0;
  const totp = async (secret: string) => {
    while (currentStep() <= lastStep) await sleep(1000);
    lastStep = currentStep();
    return totpAt(base32Decode(secret), lastStep);
  };

  try {
    await waitFor(`${API}/health/ready`, 'API', api);
    web = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3450'], {
      cwd: resolve(root, 'apps/web'), stdio: ['ignore', webLog, webLog],
      env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_API_URL: API, NEXTAUTH_URL: WEB, NEXTAUTH_SECRET: randomBytes(32).toString('hex'), NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_TELEMETRY_DISABLED: '1' },
    });
    await waitFor(`${WEB}/admin`, 'Next', web);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    // Decide the cookie banner first: fixed at the bottom, it covers buttons scrolled under it.
    await ctx.addInitScript(() => { try { localStorage.setItem('aise-cookie-consent', 'denied'); } catch { /* ignore */ } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45_000);
    page.on('dialog', (d) => d.accept());

    // 1. Login, MFA enrolment, and a second-factor login.
    await page.goto(`${WEB}/admin`);
    await page.getByLabel('E-poçt').fill(founderEmail);
    await page.getByLabel('Şifrə').fill(password);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await page.waitForURL((u) => u.pathname === '/admin/overview');
    await page.getByRole('link', { name: 'Hesabım' }).first().click();
    await page.getByRole('button', { name: 'Quraşdırmağa başla' }).click();
    const secret = (await page.getByLabel('Açar').innerText()).replace(/\s+/g, '');
    await page.getByLabel('Tətbiqdəki 6 rəqəmli kod').fill(await totp(secret));
    await page.getByRole('button', { name: 'Təsdiqlə və aktivləşdir' }).click();
    await page.getByRole('list', { name: 'Bərpa kodları' }).waitFor();
    await page.getByRole('button', { name: 'Saxladım, gizlət' }).click();
    await page.getByRole('button', { name: 'Çıxış' }).click();
    await page.waitForURL((u) => u.pathname === '/admin');
    await page.getByLabel('E-poçt').fill(founderEmail);
    await page.getByLabel('Şifrə').fill(password);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await page.getByLabel(/6 rəqəmli kod/).fill(await totp(secret));
    await page.getByRole('button', { name: 'Təsdiqlə' }).click();
    await page.waitForURL((u) => u.pathname === '/admin/overview');
    await page.getByRole('link', { name: 'Operatorlar' }).click();
    await page.getByRole('table').getByText(founderEmail).first().waitFor();
    await shot(page, '1-operators');
    console.log('PASS founder login with MFA; operator access');

    // 2. Employer approval.
    await page.getByRole('link', { name: 'Bizneslər' }).click();
    const row = page.getByRole('row').filter({ hasText: employerEmail });
    await row.getByRole('button', { name: 'Təsdiqlə' }).click();
    await row.getByText('Təsdiqləndi').waitFor();
    assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: pending.company!.id } })).status, 'APPROVED');
    console.log('PASS employer approval');

    // 3. Listing moderation: hide with a reason, then restore.
    await page.getByRole('link', { name: 'Elanlar' }).click();
    const listingRow = page.getByRole('row').filter({ hasText: listing.title });
    await listingRow.getByRole('button', { name: 'Gizlət' }).click();
    const hide = page.getByRole('dialog');
    await hide.getByLabel(/Səbəb/).fill('Sintetik moderasiya yoxlaması');
    await hide.getByRole('button', { name: 'Gizlət' }).click();
    await listingRow.getByRole('button', { name: 'Bərpa et' }).waitFor();
    assert.ok((await prisma.job.findUniqueOrThrow({ where: { id: listing.id } })).hiddenAt);
    await shot(page, '2-listing-hidden');
    await listingRow.getByRole('button', { name: 'Bərpa et' }).click();
    await listingRow.getByRole('button', { name: 'Gizlət' }).waitFor();
    console.log('PASS listing moderation: hidden with a reason, then restored');

    // 4. Application diagnosis: an unconfirmed external delivery is flagged, never retried.
    await page.getByRole('link', { name: 'Müraciətlər' }).click();
    await page.getByRole('tab', { name: 'Xarici sayt' }).click();
    await page.getByText(/heç vaxt avtomatik təkrar göndərilmir/).waitFor();
    await page.getByRole('table').getByText('DELIVERY_UNCONFIRMED', { exact: true }).waitFor();
    await page.getByRole('table').getByText('SUBMITTED', { exact: true }).waitFor();
    await shot(page, '3-applications');
    console.log('PASS application diagnosis: unconfirmed delivery flagged, no resend action');

    // 5. Queue diagnosis and a safe retry. The matching service is down, so the job fails.
    const failing = await queue.add('process-match', { jobId: listing.id }, { attempts: 1, jobId: `${stamp}-match` });
    for (let i = 0; i < 60 && !(await failing.isFailed()); i++) await sleep(1000);
    assert.ok(await failing.isFailed(), 'the matching job should fail while the scorer is unreachable');
    await page.getByRole('link', { name: 'Əməliyyatlar' }).click();
    const failedItem = page.getByRole('listitem').filter({ hasText: `#${stamp}-match` });
    await failedItem.waitFor();
    await shot(page, '4a-queue-failed');
    await failedItem.getByRole('button', { name: 'Təkrarla' }).click();
    await page.getByRole('status').filter({ hasText: 'təkrar növbəyə qoyuldu' }).waitFor();
    await shot(page, '4-queue-retry');
    console.log('PASS queue diagnosis: failed matching job shown with its reason; retried from the panel');

    // 6. Automation pause survives an API restart; sessions, roles and receipt state too.
    const extRow = page.getByRole('listitem').filter({ hasText: 'Avtomatik xarici müraciətlər' });
    await extRow.getByRole('button', { name: 'Dayandır' }).click();
    const pause = page.getByRole('dialog');
    await pause.getByLabel(/Səbəb/).fill('Buraxılış məşqi');
    await pause.getByRole('button', { name: 'Dayandır' }).click();
    await extRow.getByText('Dayandırılıb', { exact: true }).waitFor();
    api.kill('SIGTERM');
    await new Promise<void>((r) => api!.once('exit', () => r()));
    api = startApi();
    await waitFor(`${API}/health/ready`, 'API after restart', api);
    await page.reload();
    await extRow.getByText('Dayandırılıb', { exact: true }).waitFor();
    const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: UX_EMAILS.candidate, password: UX_PASSWORD }) }).then((r) => r.json());
    const mine = await fetch(`${API}/external-applications/mine`, { headers: { Authorization: `Bearer ${login.sessionToken}` } }).then((r) => r.json());
    assert.deepEqual(mine.map((a: any) => [a.status, a.receiptConfirmed, a.receiptReference]).sort(), [['DELIVERY_UNCONFIRMED', false, null], ['SUBMITTED', true, 'FX-HANDOVER-1']]);
    assert.equal((await prisma.adminUser.findUniqueOrThrow({ where: { id: founder.id } })).role, 'SUPER_ADMIN');
    console.log('PASS pause survives an API restart; founder session and role, receipt states unchanged');

    // 7. Audit history holds every action above.
    await page.getByRole('link', { name: 'Audit' }).click();
    for (const action of ['COMPANY_APPROVED', 'LISTING_HIDDEN', 'LISTING_RESTORED', 'QUEUE_JOB_RETRIED', 'FEATURE_PAUSED']) {
      await page.getByRole('cell', { name: action }).first().waitFor();
    }
    await shot(page, '5-audit');
    console.log('PASS audit history: approval, moderation, retry and pause recorded');

    // 8. Backup status and release identification.
    await page.getByRole('link', { name: 'Sistem' }).click();
    await page.getByText(release.slice(0, 12)).waitFor();
    if (backupStatusFile) {
      await page.getByText('Son ehtiyat nüsxə:').waitFor();
      await page.getByText('PASSED').waitFor();
    } else {
      await page.getByText(/Ehtiyat nüsxənin vəziyyəti bilinmədikdə/).waitFor();
    }
    await shot(page, '6-system');
    console.log(`PASS system page: release ${release.slice(0, 12)}; backup status ${backupStatusFile ? 'from the backup/restore scripts' : 'reported unknown, not "ok"'}`);
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of [web, api]) {
      if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise<void>((r) => child.once('exit', () => r())); }
    }
    closeSync(apiLog);
    closeSync(webLog);
    const failing = await queue.getJob(`${stamp}-match`);
    await failing?.remove().catch(() => undefined);
    await queue.close();
    const ids = (await prisma.adminUser.findMany({ where: { email: { startsWith: stamp } }, select: { id: true } })).map((u) => u.id);
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId: { in: ids } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: ids } } });
    await prisma.business.deleteMany({ where: { email: employerEmail } });
    await prisma.featureFlag.deleteMany({});
    await removeUxFixture(prisma);
    await prisma.$disconnect();
    console.log(`Cleanup done; logs in ${work}`);
  }
}

main().catch((error) => { console.error('HANDOVER_BROWSER_FAILED', error.message); process.exitCode = 1; });
