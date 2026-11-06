#!/usr/bin/env node
/**
 * Browser CV-to-profile against live Next + Nest.
 * Account creation follows the passing account-access script: UI register,
 * verification link from EMAIL_SINK_PATH, then login. Do not SQL-verify and
 * do not treat /login?callbackUrl=/dashboard as a signed-in dashboard.
 */
import { writeFileSync, createReadStream } from 'node:fs';
import { appendFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL || 'http://127.0.0.1:3450';
const SINK = process.env.EMAIL_SINK_PATH || '/tmp/aise-account-access-email.jsonl';
const STAMP = `${Date.now()}`;
const EMAIL = `aise-cv-browser-${STAMP}@example.com`;
const PASSWORD = 'Cv-Browser-1x';
const CORRECTED_HEADLINE = 'Düzəldilmiş NestJS mühəndisi';
const DOCX_PATH = `/tmp/aise-cv-browser-${STAMP}.docx`;
const EMPTY_PDF_PATH = `/tmp/aise-cv-empty-${STAMP}.pdf`;

function zipStore(name, contents) {
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

function syntheticDocx() {
  const lines = [
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
  const paragraphs = lines.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('');
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`;
  return zipStore('word/document.xml', Buffer.from(xml));
}

function extractAuthLink(html) {
  const match = html.match(/href="(https?:[^"]+)"/i);
  if (!match) throw new Error('Email HTML did not contain a link');
  const url = new URL(match[1]);
  if (!url.searchParams.get('token')) throw new Error('Auth link is missing a token');
  return url.toString();
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
        if (row.to === to && at >= afterMs) href = extractAuthLink(row.html);
      }
    } catch {
      // sink may not exist yet
    }
    if (href) return href;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('No captured mail for the synthetic address');
}

function dashboardArea(url) {
  try {
    const path = new URL(url).pathname;
    return path === '/dashboard' || path.startsWith('/dashboard/');
  } catch {
    return false;
  }
}

async function waitForSessionUser(page) {
  await page.waitForFunction(async () => {
    const res = await fetch('/api/auth/session');
    const data = await res.json().catch(() => null);
    return Boolean(data?.user);
  }, { timeout: 20_000 });
}

async function waitForDashboardArea(page) {
  await page.waitForURL((url) => dashboardArea(url), { timeout: 20_000 });
  await waitForSessionUser(page);
}

async function waitForHomeDashboard(page) {
  await page.waitForURL((url) => {
    try {
      return new URL(url).pathname === '/dashboard';
    } catch {
      return false;
    }
  }, { timeout: 25_000 });
  await waitForSessionUser(page);
}

async function registerAndVerify(page, email, password) {
  const mark = Date.now();
  await page.goto(`${WEB}/register`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#confirm-password').fill(password);
  await page.getByRole('button', { name: 'Hesab yarat' }).click();
  await page.getByText('ünvanı üçün hesab yaradıldı').waitFor({ timeout: 15_000 });
  const href = await lastCapturedHref(email, mark);
  await page.goto(href, { waitUntil: 'networkidle' });
  const body = await page.locator('body').innerText();
  if (!/təsdiqləndi/i.test(body)) {
    throw new Error(`verify UI: ${body.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
}

async function login(page, email, password) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();
  await waitForDashboardArea(page);
}

async function main() {
  const disk = spawnSync('df', ['-h', '/System/Volumes/Data'], { encoding: 'utf8' });
  console.log(disk.stdout.split('\n').slice(-2).join('\n'));
  await stat(SINK).catch(() => appendFile(SINK, ''));
  writeFileSync(DOCX_PATH, syntheticDocx());
  const pdfHeader = '%PDF-1.4\n';
  const pdfObjects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>\nendobj\n',
  ];
  let pdfBody = pdfHeader;
  const pdfOffsets = [0];
  for (const obj of pdfObjects) {
    pdfOffsets.push(Buffer.byteLength(pdfBody));
    pdfBody += obj;
  }
  const startxref = Buffer.byteLength(pdfBody);
  let xref = 'xref\n0 4\n0000000000 65535 f \n';
  for (let i = 1; i <= 3; i += 1) {
    xref += `${String(pdfOffsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  writeFileSync(
    EMPTY_PDF_PATH,
    Buffer.from(
      `${pdfBody}${xref}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`,
    ),
  );

  const executablePath =
    process.env.CHROMIUM_PATH ||
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('aise-cookie-consent', 'denied');
    } catch {
      // ignore
    }
  });

  try {
    await registerAndVerify(page, EMAIL, PASSWORD);
    await login(page, EMAIL, PASSWORD);

    await page.goto(`${WEB}/dashboard/profile?onboarding=true`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'CV-nizi yükləyin' }).waitFor({ timeout: 20_000 });
    await page.getByText('PDF və ya DOCX · maksimum 10MB').waitFor();

    await page.locator('input[type="file"]').setInputFiles(EMPTY_PDF_PATH);
    await page
      .getByText('CV-dən mətn oxunmadı — sənəd skan edilmiş ola bilər. Məlumatları aşağıda özünüz doldura bilərsiniz.')
      .waitFor({ timeout: 25_000 });
    await page.getByRole('button', { name: 'Geri' }).click();

    await page.locator('input[type="file"]').setInputFiles(DOCX_PATH);
    await page.getByRole('heading', { name: 'Məlumatlarınızı yoxlayın' }).waitFor({ timeout: 25_000 });
    const extractedName = await page.locator('#ob-name').inputValue();
    if (extractedName !== 'Leyla Huseynova') {
      throw new Error('extracted name did not match the synthetic CV');
    }
    await page.locator('#ob-headline').fill(CORRECTED_HEADLINE);
    await page.getByRole('button', { name: 'Davam et' }).click();
    await page.getByRole('button', { name: 'Tamamla' }).click();
    try {
      await waitForHomeDashboard(page);
    } catch (error) {
      const alert = await page.locator('[role="alert"]').innerText().catch(() => '');
      throw new Error(`after Tamamla: ${alert || error.message}`);
    }

    await page.goto(`${WEB}/dashboard/profile`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      (headline) => [...document.querySelectorAll('input')].some((el) => el.value === headline),
      CORRECTED_HEADLINE,
      { timeout: 20_000 },
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      (headline) => [...document.querySelectorAll('input')].some((el) => el.value === headline),
      CORRECTED_HEADLINE,
      { timeout: 20_000 },
    );

    await page.getByRole('button', { name: 'Çıxış' }).first().click();
    await page.waitForURL((url) => new URL(url).pathname.startsWith('/login'), { timeout: 15_000 });
    await login(page, EMAIL, PASSWORD);
    await page.goto(`${WEB}/dashboard/profile`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      (headline) => [...document.querySelectorAll('input')].some((el) => el.value === headline),
      CORRECTED_HEADLINE,
      { timeout: 20_000 },
    );

    console.log('PASS browser CV register/verify/login, extract, correct, save, refresh, relogin');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('BROWSER_CV_FAILURE', error.message);
  process.exit(1);
});
