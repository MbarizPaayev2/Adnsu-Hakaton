#!/usr/bin/env node
/**
 * Browser account-access journeys against a live Next + Nest stack.
 * Links come from EMAIL_SINK_PATH (captured HTML), never from DB token lookup.
 */
import { createReadStream } from 'node:fs';
import { appendFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL || 'http://127.0.0.1:3450';
const SINK = process.env.EMAIL_SINK_PATH || '/tmp/aise-account-access-email.jsonl';
const STAMP = `${Date.now()}`;
const CANDIDATE = `aise-browser-c-${STAMP}@example.com`;
const BUSINESS = `aise-browser-b-${STAMP}@example.com`;
const UNKNOWN = `aise-browser-unknown-${STAMP}@example.com`;
const EXPIRED = `aise-browser-exp-${STAMP}@example.com`;
const PASSWORD = 'Access-Test-1';
const NEXT_PASSWORD = 'Access-Test-2';
const GENERIC_FORGOT =
  'Əgər bu e-poçt ünvanı ilə hesab mövcuddursa, şifrəni sıfırlamaq üçün link göndərildi.';
const RESULTS = [];

function record(name, ok, detail = '') {
  RESULTS.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function extractAuthLink(html) {
  const match = html.match(/href="(https?:[^"]+)"/i);
  if (!match) throw new Error('Email HTML did not contain a link');
  const url = new URL(match[1]);
  const token = url.searchParams.get('token') ?? '';
  if (!token) throw new Error('Auth link is missing a token');
  return { href: url.toString(), pathname: url.pathname, origin: url.origin };
}

async function lastCapturedHref(to, afterMs) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    let href = null;
    try {
      const stream = createReadStream(SINK, { encoding: 'utf8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        const at = Date.parse(row.at || 0);
        if (row.to === to && at >= afterMs) {
          href = extractAuthLink(row.html).href;
        }
      }
    } catch {
      // sink may not exist yet
    }
    if (href) return href;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No captured mail for synthetic address after ${afterMs}`);
}

async function loginCandidate(page, email, password) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();
}

async function loginBusiness(page, email, password) {
  await page.goto(`${WEB}/business/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();
}

function expireCandidateTokenFromHref(href) {
  const token = new URL(href).searchParams.get('token');
  const sql = `UPDATE "VerificationToken" SET expires = NOW() - interval '1 hour' WHERE token = $token`;
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'aise-postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'aise',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `UPDATE "VerificationToken" SET expires = NOW() - interval '1 hour' WHERE token = '${token.replace(/'/g, "''")}';`,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`expire update failed: ${result.stderr || result.stdout}`);
  }
  void sql;
}

async function runCandidate(page) {
  const mark = Date.now();
  await page.goto(`${WEB}/register`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(CANDIDATE);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirm-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Hesab yarat' }).click();
  await page.getByText('ünvanı üçün hesab yaradıldı').waitFor({ timeout: 15_000 });
  record('candidate register form', true);

  await loginCandidate(page, CANDIDATE, PASSWORD);
  await page.getByRole('alert').getByText(/e-poçtunuzu təsdiqləyin/i).waitFor({ timeout: 15_000 });
  record('candidate unverified login blocked', true);

  await page.route('**/auth/resend-verification', (route) => route.abort());
  await page.getByRole('button', { name: 'Təsdiq e-poçtunu yenidən göndər' }).click();
  await page.getByRole('button', { name: 'Göndərmək mümkün olmadı — yenidən cəhd edin' }).waitFor({
    timeout: 10_000,
  });
  await page.unroute('**/auth/resend-verification');
  record('candidate failed resend stays retryable', true);

  const retryAt = Date.now();
  await page.getByRole('button', { name: 'Göndərmək mümkün olmadı — yenidən cəhd edin' }).click();
  await page.getByRole('button', { name: 'Sorğu qəbul olundu — gəlməsə yenidən cəhd edin' }).waitFor({
    timeout: 10_000,
  });
  record('candidate resend retry accepted without claiming delivery', true);

  const verifyHref = await lastCapturedHref(CANDIDATE, mark);
  if (!verifyHref.includes('/verify-email?token=')) {
    throw new Error('candidate verify path mismatch');
  }
  await page.goto(verifyHref, { waitUntil: 'networkidle' });
  const verifyBody = await page.locator('body').innerText();
  if (!/təsdiqləndi/i.test(verifyBody)) {
    throw new Error(`candidate verify UI: ${verifyBody.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  record('candidate opened captured verify link', true);

  await page.goto(verifyHref, { waitUntil: 'domcontentloaded' });
  await page.locator('.bg-red-50').waitFor({ timeout: 15_000 });
  record('candidate reused verify link rejected', true);

  await loginCandidate(page, CANDIDATE, PASSWORD);
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
  const protectedUrl = page.url();
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (!page.url().includes('/dashboard')) {
    throw new Error('session did not survive refresh');
  }
  record('candidate session survives refresh', true, protectedUrl.includes('onboarding') ? 'onboarding gate' : '');

  await page.getByRole('button', { name: 'Çıxış' }).first().click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  record('candidate denied after logout', true);

  const forgotAt = Date.now();
  await page.goto(`${WEB}/forgot-password`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(UNKNOWN);
  await page.getByRole('button', { name: 'Sıfırlama linki göndər' }).click();
  await page.getByText(GENERIC_FORGOT).waitFor({ timeout: 10_000 });
  const unknownText = await page.getByText(GENERIC_FORGOT).innerText();
  await page.goto(`${WEB}/forgot-password`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(CANDIDATE);
  await page.getByRole('button', { name: 'Sıfırlama linki göndər' }).click();
  await page.getByText(GENERIC_FORGOT).waitFor({ timeout: 10_000 });
  const knownText = await page.getByText(GENERIC_FORGOT).innerText();
  if (unknownText !== knownText) throw new Error('forgot-password responses differed');
  record('candidate forgot-password generic for unknown and known', true);

  const resetHref = await lastCapturedHref(CANDIDATE, forgotAt);
  if (!resetHref.includes('/reset-password?token=')) {
    throw new Error('candidate reset path mismatch');
  }
  await page.goto(resetHref, { waitUntil: 'domcontentloaded' });
  await page.locator('#password').fill(NEXT_PASSWORD);
  await page.locator('#confirm-password').fill(NEXT_PASSWORD);
  await page.getByRole('button', { name: 'Şifrəni yenilə' }).click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  record('candidate reset via captured link', true);

  await loginCandidate(page, CANDIDATE, PASSWORD);
  await page.getByRole('alert').waitFor({ timeout: 15_000 });
  if (page.url().includes('/dashboard')) throw new Error('old password still worked');
  record('candidate old password rejected', true);

  await loginCandidate(page, CANDIDATE, NEXT_PASSWORD);
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
  record('candidate new password accepted', true);

  console.log('waiting 61s for auth/email throttle window');
  await new Promise((r) => setTimeout(r, 61_000));
  void retryAt;
}

async function runExpired(page) {
  const mark = Date.now();
  await page.goto(`${WEB}/register`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(EXPIRED);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirm-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Hesab yarat' }).click();
  await page.getByText('ünvanı üçün hesab yaradıldı').waitFor({ timeout: 15_000 });
  const href = await lastCapturedHref(EXPIRED, mark);
  expireCandidateTokenFromHref(href);
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await page.locator('.bg-red-50').waitFor({ timeout: 15_000 });
  record('candidate expired verify link rejected in browser', true);
}

async function runBusiness(page) {
  const mark = Date.now();
  await page.goto(`${WEB}/business/register`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').fill(BUSINESS);
  const passwords = page.locator('input[type="password"]');
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'Növbəti' }).click();
  await page.locator('form input[type="text"]').first().fill('Access Browser Co');
  await page.getByRole('button', { name: 'Qeydiyyatı Tamamla' }).click();
  await page.getByText('ünvanı üçün biznes hesabı yaradıldı').waitFor({ timeout: 15_000 });
  record('business register form', true);

  await loginBusiness(page, BUSINESS, PASSWORD);
  await page.getByRole('alert').getByText(/e-poçtunuzu təsdiqləyin/i).waitFor({ timeout: 15_000 });
  record('business unverified login blocked', true);

  const verifyHref = await lastCapturedHref(BUSINESS, mark);
  if (!verifyHref.includes('/business/verify-email?token=')) {
    throw new Error('business verify path mismatch');
  }
  await page.goto(verifyHref, { waitUntil: 'networkidle' });
  const businessVerifyBody = await page.locator('body').innerText();
  if (!/təsdiqləndi/i.test(businessVerifyBody)) {
    throw new Error(`business verify UI: ${businessVerifyBody.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  record('business opened captured verify link', true);

  await page.goto(verifyHref, { waitUntil: 'domcontentloaded' });
  await page.locator('.bg-red-50').waitFor({ timeout: 15_000 });
  record('business reused verify link rejected', true);

  await loginBusiness(page, BUSINESS, PASSWORD);
  await page.waitForURL(/\/business\/dashboard/, { timeout: 20_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (!page.url().includes('/business/dashboard')) {
    throw new Error('business session did not survive refresh');
  }
  record('business session survives refresh', true);

  await page.getByRole('button', { name: 'Çıxış' }).first().click();
  await page.waitForURL(/\/business\/login/, { timeout: 15_000 });
  await page.goto(`${WEB}/business/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/business\/login/, { timeout: 15_000 });
  record('business denied after logout', true);

  const businessForgotAt = Date.now();
  await page.goto(`${WEB}/business/forgot-password`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(UNKNOWN);
  await page.getByRole('button', { name: 'Sıfırlama linki göndər' }).click();
  await page.getByText(GENERIC_FORGOT).waitFor({ timeout: 10_000 });
  await page.goto(`${WEB}/business/forgot-password`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(BUSINESS);
  await page.getByRole('button', { name: 'Sıfırlama linki göndər' }).click();
  await page.getByText(GENERIC_FORGOT).waitFor({ timeout: 10_000 });
  record('business forgot-password generic for unknown and known', true);

  const resetHref = await lastCapturedHref(BUSINESS, businessForgotAt);
  if (!resetHref.includes('/business/reset-password?token=')) {
    throw new Error('business reset path mismatch');
  }
  await page.goto(resetHref, { waitUntil: 'domcontentloaded' });
  await page.locator('#password').fill(NEXT_PASSWORD);
  await page.locator('#confirm-password').fill(NEXT_PASSWORD);
  await page.getByRole('button', { name: 'Şifrəni yenilə' }).click();
  await page.waitForURL(/\/business\/login/, { timeout: 15_000 });
  record('business reset via captured link', true);

  await loginBusiness(page, BUSINESS, PASSWORD);
  await page.getByRole('alert').waitFor({ timeout: 15_000 });
  if (page.url().includes('/business/dashboard')) throw new Error('old business password still worked');
  record('business old password rejected', true);

  await loginBusiness(page, BUSINESS, NEXT_PASSWORD);
  await page.waitForURL(/\/business\/dashboard/, { timeout: 20_000 });
  record('business new password accepted', true);
}

async function main() {
  const disk = spawnSync('df', ['-h', '/System/Volumes/Data'], { encoding: 'utf8' });
  console.log(disk.stdout.split('\n').slice(-2).join('\n'));
  await stat(SINK).catch(() => appendFile(SINK, ''));

  const executablePath =
    process.env.CHROMIUM_PATH ||
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(20_000);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('aise-cookie-consent', 'denied');
    } catch {
      // ignore
    }
  });

  try {
    await runCandidate(page);
    await runExpired(page);
    await runBusiness(page);
  } finally {
    await browser.close();
  }

  const failed = RESULTS.filter((row) => !row.ok);
  console.log('\n--- browser account-access ---');
  for (const row of RESULTS) {
    console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}`);
  }
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('BROWSER_BLOCKER_OR_FAILURE', error.message);
  process.exit(1);
});
