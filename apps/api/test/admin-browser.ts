/** Local-only founder/operator browser journey through the admin UI. Run from
 * apps/api: `npx ts-node --transpile-only test/admin-browser.ts`.
 * Real Nest API (AdminModule), Postgres (isolated aise_phase2_test), Next dev
 * UI with its httpOnly-cookie proxy, headless Chromium. Synthetic operators;
 * email is the in-process mock capture. */
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { openSync, closeSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import * as bcrypt from 'bcrypt';
import IORedis from 'ioredis';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/database.service';
import { EmailModule } from '../src/common/email.module';
import { EmailService } from '../src/common/email.service';
import { AdminModule } from '../src/admin/admin.module';
import { base32Decode, currentStep, totpAt } from '../src/admin/mfa.util';

const WEB = 'http://127.0.0.1:3450';
const API = 'http://127.0.0.1:4010';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const root = resolve(process.cwd(), '../..');
  process.env.DATABASE_URL = 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
  Object.assign(process.env, { NODE_ENV: 'test', RESEND_API_KEY: 're_mock_key', ADMIN_WEB_URL: WEB, ADMIN_MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
  const evidenceDir = process.env.ADMIN_EVIDENCE_DIR;
  if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
  const stamp = `adminui-${Date.now()}`;
  const founderEmail = `${stamp}-founder@example.com`;
  const supportEmail = `${stamp}-support@example.com`;
  const password = 'Founder-Synthetic-Pass-1';
  const prefix = `aise-${stamp}`;
  const module = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 10000 }]),
    BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }),
    DatabaseModule, EmailModule, AdminModule,
  ] }).compile();
  const app = module.createNestApplication({ logger: ['error', 'warn'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  const prisma = app.get(PrismaService);
  const emails = app.get(EmailService);
  await prisma.adminUser.create({ data: { email: founderEmail, hashedPassword: await bcrypt.hash(password, 10), role: 'SUPER_ADMIN' } });

  let web: ChildProcess | undefined;
  let browser: Browser | undefined;
  const logPath = `/tmp/${stamp}-next.log`;
  const log = openSync(logPath, 'w', 0o600);
  const shot = async (page: Page, name: string) => { if (evidenceDir) await page.screenshot({ path: join(evidenceDir, `${name}.png`), fullPage: true }); };
  let lastStep = 0;
  const totp = async (secret: string) => {
    // A code is accepted once per 30 s step: wait for a fresh step if needed.
    while (currentStep() <= lastStep) await sleep(1000);
    lastStep = currentStep();
    return totpAt(base32Decode(secret), lastStep);
  };
  try {
    await app.listen(4010, '127.0.0.1');
    web = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3450'], {
      cwd: resolve(root, 'apps/web'), stdio: ['ignore', log, log],
      env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_API_URL: API, NEXTAUTH_URL: WEB, NEXTAUTH_SECRET: randomBytes(32).toString('hex'), NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_TELEMETRY_DISABLED: '1' },
    });
    for (let i = 0; i < 120; i++) {
      if (web.exitCode !== null) throw new Error(`Next exited; see ${logPath}`);
      try { if ((await fetch(`${WEB}/admin`)).ok) break; } catch {}
      if (i === 119) throw new Error('Next readiness timeout');
      await sleep(1000);
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` });
    const context = async () => {
      const c = await browser!.newContext({ viewport: { width: 1280, height: 900 } });
      await c.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
      await c.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      return c;
    };
    const founderCtx = await context();
    const page = await founderCtx.newPage();
    page.setDefaultTimeout(45_000);
    page.on('dialog', (d) => d.accept());

    // 1. Password-only session: operator management demands the second factor.
    await page.goto(`${WEB}/admin`);
    await page.getByLabel('E-poçt').fill(founderEmail);
    await page.getByLabel('Şifrə').fill(password);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await page.waitForURL((u) => u.pathname === '/admin/overview');
    const cookies = await founderCtx.cookies();
    assert.ok(cookies.find((c) => c.name === 'admin_session')?.httpOnly, 'session cookie must be httpOnly');
    await page.getByRole('link', { name: 'Operatorlar' }).click();
    await page.getByText('iki mərhələli təsdiq tələb olunur').waitFor();
    console.log('PASS founder password login; operator management refused until MFA');

    // 2. Enrol MFA on the account page; recovery codes shown once.
    await page.getByRole('link', { name: 'Hesabım' }).first().click();
    await page.getByRole('button', { name: 'Quraşdırmağa başla' }).click();
    const secret = (await page.getByLabel('Açar').innerText()).replace(/\s+/g, '');
    await page.getByLabel('Tətbiqdəki 6 rəqəmli kod').fill(await totp(secret));
    await page.getByRole('button', { name: 'Təsdiqlə və aktivləşdir' }).click();
    const codes = await page.getByRole('list', { name: 'Bərpa kodları' }).innerText();
    assert.equal(codes.trim().split('\n').length, 10);
    await shot(page, '1-mfa-enrolled');
    await page.getByRole('button', { name: 'Saxladım, gizlət' }).click();
    console.log('PASS MFA enrolled from the account page; 10 recovery codes shown once');

    // 3. Log out and back in: the password alone is not enough.
    await page.getByRole('button', { name: 'Çıxış' }).click();
    await page.waitForURL((u) => u.pathname === '/admin');
    await page.getByLabel('E-poçt').fill(founderEmail);
    await page.getByLabel('Şifrə').fill(password);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await page.getByLabel(/6 rəqəmli kod/).fill('000000');
    await page.getByRole('button', { name: 'Təsdiqlə' }).click();
    await page.getByText('Kod yanlışdır').waitFor();
    await page.getByLabel(/6 rəqəmli kod/).fill(await totp(secret));
    await page.getByRole('button', { name: 'Təsdiqlə' }).click();
    await page.waitForURL((u) => u.pathname === '/admin/overview');
    console.log('PASS login requires the second factor; a wrong code is refused');

    // 4. Invite a read-only support operator.
    await page.getByRole('link', { name: 'Operatorlar' }).click();
    await page.getByLabel('E-poçt').fill(supportEmail);
    await page.getByLabel('Rol', { exact: true }).selectOption('SUPPORT');
    emails.clearCapturedEmails();
    await page.getByRole('button', { name: 'Dəvət göndər' }).click();
    await page.getByRole('status').filter({ hasText: 'dəvət göndərildi' }).waitFor();
    await shot(page, '2-operators');
    const link = /href="([^"]+)"/.exec(emails.getCapturedEmails().find((m) => m.to === supportEmail)!.html)![1];
    console.log('PASS super-admin invites a SUPPORT operator; link delivered by (mock) email');

    // 5. The invitee sets a password through the link, which then stops working.
    const supportCtx = await context();
    const support = await supportCtx.newPage();
    support.setDefaultTimeout(45_000);
    await support.goto(link);
    await support.getByText(supportEmail).waitFor();
    await support.getByLabel('Şifrə (ən azı 12 simvol)').fill('Support-Synthetic-1');
    await support.getByLabel('Şifrəni təkrarlayın').fill('Support-Synthetic-1');
    await support.getByRole('button', { name: 'Saxla' }).click();
    await support.getByText('Hazırdır').waitFor();
    await support.goto(link);
    await support.getByText(/etibarsızdır, istifadə olunub/).waitFor();
    console.log('PASS invitation accepted once; the link is dead afterwards');

    // 6. The support operator sees read-only navigation, and the API refuses hidden actions.
    await support.goto(`${WEB}/admin`);
    await support.getByLabel('E-poçt').fill(supportEmail);
    await support.getByLabel('Şifrə').fill('Support-Synthetic-1');
    await support.getByRole('button', { name: 'Daxil ol' }).click();
    await support.waitForURL((u) => u.pathname === '/admin/overview');
    await support.getByText('Dəstək (yalnız baxış)').waitFor();
    assert.equal(await support.getByRole('link', { name: 'Operatorlar' }).count(), 0);
    assert.equal(await support.getByRole('link', { name: 'Deploy' }).count(), 0);
    const hidden = await support.evaluate(async () => (await fetch('/api/admin/operators')).status);
    assert.equal(hidden, 403);
    const planChange = await support.evaluate(async () => (await fetch('/api/admin/users/x/plan-overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"plan":"Limitsiz","reason":"x","days":1}' })).status);
    assert.equal(planChange, 403);
    await shot(support, '3-support-view');
    console.log('PASS support operator: read-only navigation, direct API calls to hidden actions → 403');

    // 7. Disabling the operator ends their session at once.
    await page.reload();
    await page.getByText(supportEmail, { exact: true }).waitFor();
    await page.getByRole('row').filter({ hasText: supportEmail }).getByRole('button', { name: 'Deaktiv et' }).click();
    await page.getByRole('status').filter({ hasText: 'deaktiv edildi' }).waitFor();
    await support.goto(`${WEB}/admin/users`);
    await support.waitForURL((u) => u.pathname === '/admin');
    console.log('PASS disabling an operator ends their session immediately');

    // 8. Operations: a pause needs a reason, shows at once and is audited; the system page does not claim to deploy.
    await page.getByRole('link', { name: 'Əməliyyatlar' }).click();
    const importRow = page.getByRole('listitem').filter({ hasText: 'Glorri vakansiya idxalı' });
    await importRow.getByRole('button', { name: 'Dayandır' }).click();
    const dialog = page.getByRole('dialog');
    assert.equal(await dialog.getByRole('button', { name: 'Dayandır' }).isDisabled(), true);
    await dialog.getByLabel(/Səbəb/).fill('Sintetik texniki baxış');
    await dialog.getByRole('button', { name: 'Dayandır' }).click();
    await importRow.getByText('Dayandırılıb', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'İndi idxal et' }).isDisabled(), true);
    await shot(page, '4-operations');
    await page.getByRole('link', { name: 'Audit' }).click();
    await page.getByRole('cell', { name: 'FEATURE_PAUSED' }).first().waitFor();
    await page.getByRole('link', { name: 'Sistem' }).click();
    await page.getByText(/kodu yerləşdirmir/).waitFor();
    await page.getByRole('link', { name: 'Ümumi baxış' }).click();
    await page.getByText('Müvəqqəti dayandırılmış funksiyalar var:').waitFor();
    await page.getByRole('status').filter({ hasText: 'Glorri vakansiya idxalı' }).filter({ hasText: 'Sintetik texniki baxış' }).waitFor();
    await shot(page, '5-overview');
    console.log('PASS operations: pause needs a reason, is enforced/visible at once and audited; system page makes no deploy claim');
  } finally {
    await browser?.close().catch(() => undefined);
    if (web && web.exitCode === null) { web.kill('SIGTERM'); await new Promise<void>((r) => web!.once('exit', () => r())); }
    closeSync(log);
    const ids = (await prisma.adminUser.findMany({ where: { email: { startsWith: stamp } }, select: { id: true } })).map((u) => u.id);
    await prisma.adminAuditLog.deleteMany({ where: { OR: [{ adminUserId: { in: ids } }, { targetId: { in: ids } }] } });
    await prisma.adminInvitation.deleteMany({ where: { email: { startsWith: stamp } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: ids } } });
    await prisma.featureFlag.deleteMany({ where: { key: 'import.glorri' } });
    await app.close();
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    console.log(`Cleanup done; Next log: ${logPath}`);
  }
}

main().catch((error) => { console.error('ADMIN_BROWSER_FAILED', error.message); process.exitCode = 1; });
