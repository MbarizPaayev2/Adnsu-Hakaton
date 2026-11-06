/** Local-only native application browser rehearsal. Run from apps/api with
 * ts-node --transpile-only. Uses synthetic accounts and isolated local DB. */
import { startPhase2App } from './support/phase2-local-app';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { statfsSync, openSync, closeSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';

const CFT = `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const WEB = 'http://127.0.0.1:3450';
const API = 'http://127.0.0.1:4010';

function docx(marker: string): Buffer {
  const name = Buffer.from('word/document.xml');
  const body = Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Leyla Huseynova</w:t></w:r></w:p><w:p><w:r><w:t>${marker}</w:t></w:r></w:p></w:body></w:document>`);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(name.length, 26); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + body.length, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}

async function main() {
  const root = resolve(process.cwd(), '../..');
  const free = () => { const s = statfsSync(root); return Number(s.bavail) * Number(s.bsize); };
  if (free() < 5 * 1024 ** 3) throw new Error('Need 5 GiB before browser stack');
  process.env.DATABASE_URL = 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
  const stamp = `phase4-${Date.now()}`;
  const adminEmail = `${stamp}-admin@example.com`, employerEmail = `${stamp}-employer@example.com`, candidateEmail = `${stamp}-candidate@example.com`;
  const password = 'Phase4-Local-1!';
  const marker = `NATIVE-UI-CV-${stamp}`;
  const cvBytes = docx(marker);
  const portfolioBytes = Buffer.from(`%PDF-1.4\nNATIVE-UI-PORTFOLIO-${stamp}\n%%EOF\n`);
  const env = await startPhase2App({ native: true });
  let web: ChildProcess | undefined, browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  const logPath = `/tmp/${stamp}-next.log`;
  const log = openSync(logPath, 'w', 0o600);
  let diskStopped = false;
  const monitor = setInterval(() => {
    if (free() < 2 * 1024 ** 3) { diskStopped = true; web?.kill('SIGTERM'); void browser?.close(); }
  }, 5000);
  try {
    await env.app.listen(4010, '127.0.0.1');
    web = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3450'], {
      cwd: resolve(root, 'apps/web'), stdio: ['ignore', log, log],
      env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_API_URL: API, NEXTAUTH_URL: WEB, NEXTAUTH_SECRET: randomBytes(32).toString('hex'), NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_TELEMETRY_DISABLED: '1' },
    });
    for (let i = 0; i < 90; i++) {
      if (web.exitCode !== null) throw new Error(`Next exited; see ${logPath}`);
      try { if ((await fetch(`${WEB}/login`)).ok) break; } catch {}
      if (i === 89) throw new Error('Next readiness timeout');
      await new Promise((r) => setTimeout(r, 1000));
    }

    const registered = async (kind: 'auth' | 'business/auth', email: string) => {
      const res = await fetch(`${API}/${kind}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, ...(kind === 'business/auth' ? { companyName: `Native UI ${stamp}` } : {}) }) });
      assert.equal(res.status, 201);
      const captured = env.emails.getCapturedEmails().filter((m) => m.to === email).at(-1);
      assert.ok(captured);
      const token = new URL(/href="([^"]+)"/.exec(captured.html)![1]).searchParams.get('token');
      const verified = await fetch(`${API}/${kind}/verify-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      assert.ok(verified.ok);
    };
    await registered('business/auth', employerEmail);
    await registered('auth', candidateEmail);
    // Approving employers needs the ADMIN role (roles and MFA since Prompt 2).
    await env.prisma.adminUser.create({ data: { email: adminEmail, hashedPassword: await bcrypt.hash(password, 12), role: 'ADMIN' } });

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || CFT });
    const context = async () => {
      const c = await browser!.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
      contexts.push(c);
      await c.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      await c.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
      return c;
    };
    const admin = await (await context()).newPage();
    admin.setDefaultTimeout(30000);
    await admin.goto(`${WEB}/admin`);
    await admin.locator('input[type=email]').fill(adminEmail);
    await admin.locator('input[type=password]').fill(password);
    await admin.getByRole('button', { name: 'Daxil ol' }).click();
    // Operators land on the overview; businesses are one navigation away.
    await admin.waitForURL((url) => url.pathname === '/admin/overview');
    await admin.goto(`${WEB}/admin/businesses`);
    const row = admin.getByRole('row').filter({ hasText: employerEmail });
    await row.getByRole('button', { name: 'Təsdiqlə' }).click();
    await row.getByText('Təsdiqləndi').waitFor();
    console.log('PASS browser admin login → approve synthetic employer');

    const employer = await (await context()).newPage();
    employer.setDefaultTimeout(30000);
    await employer.goto(`${WEB}/business/login`);
    await employer.locator('input[type=email]').fill(employerEmail);
    await employer.locator('input[type=password]').fill(password);
    await employer.getByRole('button', { name: 'Daxil ol' }).click();
    await employer.waitForURL((url) => url.pathname === '/business/dashboard');
    assert.ok((await employer.context().cookies()).some((cookie) => cookie.name === 'business_session'));
    await employer.goto(`${WEB}/business/vacancies/new`);
    await employer.locator('#v-title').fill('Native UI Backend QA');
    await employer.getByRole('button', { name: 'Sual əlavə et' }).click();
    await employer.getByRole('textbox', { name: '1-ci sualın mətni' }).fill('Motivasiya');
    await employer.locator('#req-0').check();
    await employer.getByRole('button', { name: 'Sual əlavə et' }).click();
    await employer.getByRole('textbox', { name: '2-ci sualın mətni' }).fill('Portfolio');
    await employer.getByRole('combobox', { name: '2-ci sualın növü' }).selectOption('FILE_UPLOAD');
    await employer.locator('#req-1').check();
    await employer.getByRole('button', { name: 'Yadda saxla' }).click();
    await employer.waitForURL((url) => url.pathname === '/business/vacancies');
    const company = await env.prisma.company.findFirstOrThrow({ where: { business: { email: employerEmail } } });
    const vacancy = await env.prisma.vacancy.findFirstOrThrow({ where: { companyId: company.id, title: 'Native UI Backend QA' } });
    console.log('PASS browser employer creates native vacancy with required text and file questions');

    const candidate = await (await context()).newPage();
    candidate.setDefaultTimeout(30000);
    await candidate.goto(`${WEB}/login`);
    await candidate.locator('#email').fill(candidateEmail);
    await candidate.locator('#password').fill(password);
    const candidateCallback = candidate.waitForResponse((response) =>
      response.url().includes('/api/auth/callback/credentials') && response.request().method() === 'POST');
    await candidate.getByRole('button', { name: 'Daxil ol' }).click();
    assert.equal((await candidateCallback).status(), 200);
    try {
      await candidate.getByRole('heading', { name: 'CV-nizi yükləyin' }).waitFor();
    } catch (error) {
      throw new Error(`Candidate onboarding: url=${candidate.url()}, page=${(await candidate.locator('body').innerText()).slice(0, 500)}; ${error}`);
    }
    await candidate.waitForFunction(async (email) => (await (await fetch('/api/auth/session')).json()).user?.email === email, candidateEmail);
    await candidate.locator('input[type=file]').setInputFiles({ name: 'cv.docx', mimeType: DOCX, buffer: cvBytes });
    await candidate.getByRole('heading', { name: 'Məlumatlarınızı yoxlayın' }).waitFor();
    assert.equal(await candidate.locator('#ob-name').inputValue(), 'Leyla Huseynova');
    await candidate.getByPlaceholder('məs. TypeScript').fill('TypeScript');
    await candidate.getByPlaceholder('məs. TypeScript').press('Enter');
    await candidate.getByRole('button', { name: 'Davam et' }).click();
    await candidate.getByRole('button', { name: 'Tamamla' }).click();
    try {
      await candidate.waitForURL((url) => url.pathname === '/dashboard');
    } catch (error) {
      throw new Error(`Candidate finish: url=${candidate.url()}, page=${(await candidate.locator('body').innerText()).slice(0, 500)}; ${error}`);
    }
    await candidate.waitForFunction(async (email) => (await (await fetch('/api/auth/session')).json()).user?.email === email, candidateEmail);
    console.log('PASS browser candidate uploads synthetic DOCX and completes onboarding');
    await candidate.goto(`${WEB}/dashboard/companies/${company.id}/vacancies/${vacancy.id}/apply`);
    const chosenCv = candidate.getByLabel('Göndəriləcək CV');
    assert.ok((await chosenCv.locator('option:checked').textContent())?.includes('Əsas CV'));
    await candidate.getByRole('textbox', { name: 'Motivasiya' }).fill('Synthetic interest');
    await candidate.locator('input[type=file]').setInputFiles({ name: 'portfolio.pdf', mimeType: 'application/pdf', buffer: portfolioBytes });
    await candidate.getByRole('button', { name: 'Müraciət et' }).dblclick();
    await candidate.getByRole('heading', { name: 'Müraciətiniz göndərildi!' }).waitFor();
    const user = await env.prisma.user.findUniqueOrThrow({ where: { email: candidateEmail } });
    const application = await env.prisma.application.findFirstOrThrow({ where: { userId: user.id, vacancyId: vacancy.id }, include: { files: true } });
    assert.equal(await env.prisma.application.count({ where: { userId: user.id, vacancyId: vacancy.id } }), 1);
    console.log('PASS browser candidate selects CV, answers, attaches file, double-click → one application');

    await employer.goto(`${WEB}/business/applications/${application.id}`);
    await employer.getByText('Motivasiya').waitFor();
    for (const [linkName, bytes] of [['CV-yə bax / Yüklə', cvBytes], ['Faylı yüklə', portfolioBytes]] as const) {
      const [download] = await Promise.all([employer.waitForEvent('download'), employer.getByRole('link', { name: linkName }).click()]);
      const file = await download.path();
      assert.ok(file);
      assert.ok(readFileSync(file).equals(bytes), `${linkName}: exact submitted bytes`);
    }
    await employer.getByRole('combobox', { name: 'Müraciət statusu' }).selectOption('REVIEWING');
    await employer.waitForFunction(() => (document.querySelector('select[aria-label="Müraciət statusu"]') as HTMLSelectElement)?.value === 'REVIEWING');
    await candidate.goto(`${WEB}/dashboard/applications`);
    await candidate.getByText('Nəzərdən keçirilir').waitFor();
    console.log('PASS browser employer downloads exact files and updates status; candidate sees it after refresh');

    // A stale business cookie must not keep showing the protected employer UI.
    const businessCookie = (await employer.context().cookies()).find((cookie) => cookie.name === 'business_session');
    assert.ok(businessCookie);
    await env.prisma.businessSession.deleteMany({ where: { sessionToken: businessCookie.value } });
    await employer.reload();
    await employer.waitForURL((url) => url.pathname === '/business/login');
    console.log('PASS browser expired employer session redirects to login');
    if (diskStopped) throw new Error('Disk threshold stopped browser work');
  } finally {
    clearInterval(monitor);
    await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
    await browser?.close();
    if (web && web.exitCode === null) { web.kill('SIGTERM'); await new Promise<void>((r) => web!.once('exit', () => r())); }
    closeSync(log);
    const users = await env.prisma.user.findMany({ where: { email: candidateEmail }, include: { resumes: true, applications: { include: { files: true } } } });
    const fileUrls = users.flatMap((u) => [...u.resumes.map((r) => r.fileUrl), ...u.applications.flatMap((a) => a.files.map((f) => f.fileUrl))]);
    const companies = await env.prisma.company.findMany({ where: { business: { email: employerEmail } }, select: { id: true } });
    await env.prisma.application.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await env.prisma.user.deleteMany({ where: { email: candidateEmail } });
    await env.prisma.business.deleteMany({ where: { email: employerEmail } });
    await env.prisma.adminAuditLog.deleteMany({ where: { targetType: 'Company', targetId: { in: companies.map((c) => c.id) } } });
    await env.prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    const storage = env.app.get(require('../src/resumes/local-storage.service').LocalStorageService);
    for (const url of fileUrls) if (url) await storage.deleteFile(url);
    await env.close();
    console.log(`Browser free disk: ${(free() / 1024 ** 3).toFixed(2)} GiB; Next log: ${logPath}`);
  }
}

main().catch((error) => { console.error('PHASE4_BROWSER_FAILED', error.message); process.exitCode = 1; });
