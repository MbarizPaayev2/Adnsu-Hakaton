/** Run from apps/api with ts-node. Uses aise_phase2_test only; starts and
 * stops its own Next/Nest processes. Fixture source + scorer, loopback fake
 * NVIDIA provider (behaviour evidence only), captured mock mail. Nothing is
 * sent to an employer: the approved CV is only downloaded. */
import { startPhase2App, fixtureSummary, fixtureDetail } from './support/phase2-local-app';
import { startFakeNim } from './support/fake-nim';
import { chromium, type Browser } from 'playwright';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { statfsSync, openSync, closeSync, readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const CFT = `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

function extractPdfText(file: string): string {
  const script = `require('./src/resumes/cv-extract').extractCvText(require('fs').readFileSync(process.argv[1]), 'application/pdf').then((t) => process.stdout.write(JSON.stringify(t)))`;
  return JSON.parse(execFileSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--transpile-only', '-e', script, file], { timeout: 60_000 }).toString());
}

async function main() {
  const root = resolve(process.cwd(), '../..');
  const free = () => { const s = statfsSync(root); return Number(s.bavail) * Number(s.bsize); };
  if (free() < 5 * 1024 ** 3) throw new Error('Need at least 5 GiB before browser stack');
  const stamp = `phase3-browser-${Date.now()}`;
  const email = `${stamp}@example.com`, password = 'Local-Phase3-Browser!';
  const evidence = process.env.TAILOR_PDF_EVIDENCE_DIR || '/tmp';
  const uploadDir = join(process.cwd(), 'uploads');
  const filesBefore = new Set(existsSync(uploadDir) ? readdirSync(uploadDir) : []);
  const nim = await startFakeNim();
  process.env.NVIDIA_API_KEY = 'fake-local-key';
  process.env.NIM_API_URL = nim.url;
  const env = await startPhase2App();
  let web: ChildProcess | undefined, browser: Browser | undefined;
  const logPath = `/tmp/${stamp}-next.log`;
  const log = openSync(logPath, 'w', 0o600);
  let resourceStop = false;
  const monitor = setInterval(() => {
    if (free() < 2 * 1024 ** 3) { resourceStop = true; web?.kill('SIGTERM'); void browser?.close(); }
  }, 5000);
  try {
    await env.app.listen(4010, '127.0.0.1');
    web = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3450'], {
      cwd: resolve(root, 'apps/web'), stdio: ['ignore', log, log],
      env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4010', NEXTAUTH_URL: 'http://127.0.0.1:3450', NEXTAUTH_SECRET: randomBytes(32).toString('hex'), NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_TELEMETRY_DISABLED: '1' },
    });
    for (let i = 0; i < 90; i++) {
      if (web.exitCode !== null) throw new Error(`Next exited; see ${logPath}`);
      try { if ((await fetch('http://127.0.0.1:3450/login')).ok) break; } catch {}
      if (i === 89) throw new Error('Next readiness timeout');
      await new Promise((r) => setTimeout(r, 1000));
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || CFT });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    await page.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    await page.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));

    await page.goto('http://127.0.0.1:3450/register');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('#confirm-password').fill(password);
    await page.getByRole('button', { name: 'Hesab yarat' }).click();
    await page.getByText('ünvanı üçün hesab yaradıldı').waitFor();
    const mail = env.emails.getCapturedEmails().filter((m) => m.to === email).pop()!;
    await page.goto(/href="([^"]+)"/.exec(mail.html)![1]);
    await page.getByText(/təsdiqləndi/i).waitFor();
    await page.goto('http://127.0.0.1:3450/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await page.waitForFunction(async (expected) => (await (await fetch('/api/auth/session')).json()).user?.email === expected, email);
    await page.waitForURL((url) => url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/'));
    const session = await page.evaluate(async () => (await fetch('/api/auth/session')).json());
    const headers = { Authorization: `Bearer ${session.sessionToken}`, 'Content-Type': 'application/json' };
    // Profile facts via the authenticated API (profile UI correction is covered by the Phase 2 browser run).
    assert.equal((await fetch('http://127.0.0.1:4010/profile', { method: 'PATCH', headers, body: JSON.stringify({
      name: 'Leyla Hüseynova', headline: 'Backend mühəndisi', location: 'Gəncə', skills: ['NestJS', 'PostgreSQL', 'TypeScript', 'İngilis dili'],
      experiences: [{ title: 'Backend Engineer', company: 'Qafqaz Labs', startDate: '2022-01-01', endDate: null, description: 'Разработала REST API на NestJS и PostgreSQL.\nİş yükünü 30% azaltdı.' }],
      education: [{ institution: 'Azərbaycan Texniki Universiteti', degree: 'Bakalavr', fieldOfStudy: 'Kompüter elmləri', startDate: '2015-09-01', endDate: '2019-06-30' }],
    }) })).status, 200);
    assert.equal((await fetch('http://127.0.0.1:4010/profile/complete-onboarding', { method: 'POST', headers })).status, 201);
    await env.settle();
    const records = [fixtureSummary(`${stamp}-active`, 'Backend Developer Aktiv'), fixtureSummary(`${stamp}-closing`, 'Backend Developer Bağlanan')];
    const details = Object.fromEntries(records.map((r) => [r.slug, fixtureDetail(r.title, 'NestJS, PostgreSQL və Kubernetes ilə backend xidmətləri.')]));
    assert.equal((await env.importFixtures([records], details)).status, 'SUCCEEDED');
    await env.settle();

    // 1. Request from the matches screen with a double click; provider held → processing survives reload.
    nim.setMode('hold', 'invented');
    await page.goto('http://127.0.0.1:3450/dashboard/matches');
    await page.getByRole('heading', { name: 'Backend Developer Aktiv', exact: true }).click();
    await page.getByRole('button', { name: 'CV-ni Fərdiləşdir' }).dblclick();
    await page.getByRole('button', { name: 'Hazırlanır...' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Backend Developer Aktiv', exact: true }).click();
    await page.getByRole('button', { name: 'Hazırlanır...' }).waitFor();
    const userId = (await env.prisma.user.findUniqueOrThrow({ where: { email } })).id;
    assert.equal(await env.prisma.resume.count({ where: { userId, isBase: false } }), 1);
    console.log('PASS browser double-click → one request; processing state survives reload');

    // 2. Draft is ready for review (not downloadable), with the fact check visible.
    nim.release();
    await page.getByRole('link', { name: /Qaralamanı yoxla və təsdiqlə/ }).waitFor({ timeout: 30000 });
    assert.equal(await page.getByRole('button', { name: /PDF-i Aç/ }).count(), 0);
    await page.getByRole('link', { name: /Qaralamanı yoxla və təsdiqlə/ }).click();
    await page.getByText('Faktların yoxlanışı').waitFor();
    for (const removed of ['Google', 'Kubernetes', '45%', 'MIT']) assert.ok(await page.getByTestId('tailored-review').getByText(removed, { exact: false }).count(), `fact check lists ${removed}`);
    await page.getByRole('status').filter({ hasText: 'Təsdiqlənməmiş CV yüklənə bilməz' }).waitFor();
    await page.screenshot({ path: `${evidence}/${stamp}-review.png`, fullPage: true });
    console.log('PASS browser draft shows fact-check removals and blocks download before approval');

    // 3. Review edits → approve → authenticated download of the exact reviewed bytes.
    await page.getByLabel(/Bəndlər/).fill('Разработала REST API на NestJS и PostgreSQL.\nİş yükünü 30% azaltdı.\nTürkçe dokümantasyon: ĞŞİıç.');
    await page.getByRole('checkbox', { name: 'TypeScript' }).uncheck();
    await page.getByRole('button', { name: /Yoxladım, təsdiqlə və PDF yarat/ }).click();
    await page.getByRole('status').filter({ hasText: 'Təsdiqlənib' }).waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /PDF-i yüklə/ }).click()]);
    const saved = `${evidence}/${stamp}-downloaded.pdf`;
    await download.saveAs(saved);
    const row = await env.prisma.resume.findFirstOrThrow({ where: { userId, isBase: false } });
    assert.equal(row.status, 'READY');
    assert.ok(row.reviewedAt);
    const onDisk = readFileSync(join(uploadDir, row.fileUrl!.split('/').pop()!));
    assert.ok(readFileSync(saved).equals(onDisk), 'downloaded bytes equal the stored approved PDF');
    const text = extractPdfText(saved).replace(/\s+/g, ' ');
    for (const expected of ['Leyla Hüseynova', 'Türkçe dokümantasyon: ĞŞİıç', 'İŞ TƏCRÜBƏSİ', 'Qafqaz Labs']) assert.ok(text.includes(expected), `PDF contains ${expected}`);
    for (const absent of ['Google', 'Kubernetes', '45%']) assert.ok(!text.includes(absent), `PDF omits ${absent}`);
    // The unchecked skill leaves the skills section (the summary may still mention a saved skill).
    const skillsLine = text.split('BACARIQLAR')[1] ?? '';
    assert.ok(skillsLine.includes('NestJS') && !skillsLine.includes('TypeScript'), 'unchecked skill removed from the skills section');
    await page.screenshot({ path: `${evidence}/${stamp}-approved.png`, fullPage: true });
    console.log('PASS browser review edits → approval → downloaded PDF equals stored bytes, reviewed text only');

    // 4. A closed job keeps its history but cannot start tailoring.
    const closingMatch = await env.prisma.match.findFirstOrThrow({ where: { userId, job: { externalId: `glorri:${stamp}-closing` } } });
    assert.equal((await fetch(`http://127.0.0.1:4010/matches/${closingMatch.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'APPLIED' }) })).status, 200);
    await env.importFixtures([[records[0]]], { ...details, [`${stamp}-closing`]: { status: 404 } });
    await page.goto('http://127.0.0.1:3450/dashboard/matches');
    await page.getByRole('heading', { name: 'Backend Developer Bağlanan', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'artıq aktiv deyil' }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'CV-ni Fərdiləşdir' }).isDisabled());
    const refused = await fetch('http://127.0.0.1:4010/resumes/tailor', { method: 'POST', headers, body: JSON.stringify({ matchId: closingMatch.id }) });
    assert.equal(refused.status, 400);
    console.log('PASS browser closed job: tailoring disabled in UI and refused by the API');
    if (resourceStop) throw new Error('Disk threshold stopped browser work');
  } finally {
    clearInterval(monitor);
    await browser?.close();
    if (web && web.exitCode === null) { web.kill('SIGTERM'); await new Promise<void>((r) => web!.once('exit', () => r())); }
    closeSync(log);
    await env.settle().catch(() => undefined);
    await env.prisma.user.deleteMany({ where: { email } });
    await env.prisma.job.deleteMany({ where: { externalId: { startsWith: `glorri:${stamp}` } } });
    await env.close();
    await nim.close();
    for (const f of existsSync(uploadDir) ? readdirSync(uploadDir) : []) if (!filesBefore.has(f)) unlinkSync(join(uploadDir, f));
    console.log(`Free disk after browser: ${(free() / 1024 ** 3).toFixed(2)} GiB. Next log: ${logPath}`);
  }
}
main().catch((error) => { console.error('PHASE3_BROWSER_FAILED', error.message); process.exitCode = 1; });
