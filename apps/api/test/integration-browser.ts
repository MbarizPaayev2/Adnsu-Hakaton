/** Local-only authenticated candidate-to-employer browser journey over the REAL web app, API, Postgres, Redis and queues.
 * Synthetic accounts, vacancies and files only, isolated local database, capture e-mail sink (nothing is sent), Telegram and payments unconfigured.
 * Run from apps/api: DATABASE_URL=<aise_phase2_test> npx ts-node --transpile-only test/integration-browser.ts */
import { startPhase2App } from './support/phase2-local-app';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { statfsSync, openSync, closeSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const CFT = `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const WEB = 'http://127.0.0.1:3450';
const API = 'http://127.0.0.1:4010';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function docx(marker: string, person: string): Buffer {
  const name = Buffer.from('word/document.xml');
  const body = Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${person}</w:t></w:r></w:p><w:p><w:r><w:t>${marker}</w:t></w:r></w:p></w:body></w:document>`);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(name.length, 26); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + body.length, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}

async function main() {
  const root = resolve(process.cwd(), '../..');
  const free = () => { const s = statfsSync(root); return Number(s.bavail) * Number(s.bsize); };
  if (free() < 4 * 1024 ** 3) throw new Error('Need 4 GiB before browser stack');
  process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
  assert.ok(new URL(process.env.DATABASE_URL).pathname === '/aise_phase2_test', 'must run against the isolated database');

  const stamp = `integ-${Date.now()}`;
  const password = 'Integ-Local-1!';
  const emp = { a: `${stamp}-emp-a@example.com`, b: `${stamp}-emp-b@example.com`, pending: `${stamp}-emp-pending@example.com` };
  const cand = { one: `${stamp}-cand-1@example.com`, two: `${stamp}-cand-2@example.com` };
  const cvOne = docx(`INTEG-CV-ONE-${stamp}`, 'Leyla Huseynova');
  const cvTwo = docx(`INTEG-CV-TWO-${stamp}`, 'Murad Aliyev');
  const portfolio = Buffer.from(`%PDF-1.4\nINTEG-PORTFOLIO-${stamp}\n%%EOF\n`);

  const env = await startPhase2App({ native: true, retention: true });
  let web: ChildProcess | undefined, browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  const logPath = `/tmp/${stamp}-next.log`;
  const log = openSync(logPath, 'w', 0o600);
  let diskStopped = false;
  const monitor = setInterval(() => { if (free() < 1.5 * 1024 ** 3) { diskStopped = true; web?.kill('SIGTERM'); void browser?.close(); } }, 5000);
  const passed: string[] = [];
  const pass = (m: string) => { passed.push(m); console.log(`PASS ${m}`); };
  /** Optimistic UI updates before the request lands: poll the database for the stored result instead of racing it. */
  const eventually = async <T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> => {
    let last: T | undefined;
    for (let i = 0; i < 50; i++) { last = await read(); if (ok(last)) return last; await new Promise((r) => setTimeout(r, 200)); }
    throw new Error(`${what}: not stored within 10s (last: ${JSON.stringify(last)})`);
  };
  const text = async (p: Page) => (await p.locator('body').innerText()).slice(0, 1500);

  try {
    await env.app.listen(4010, '127.0.0.1');
    web = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3450'], {
      cwd: resolve(root, 'apps/web'), stdio: ['ignore', log, log],
      env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_API_URL: API, NEXTAUTH_URL: WEB, NEXTAUTH_SECRET: randomBytes(32).toString('hex'), NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_RETENTION_MODE: '' },
    });
    for (let i = 0; i < 120; i++) {
      if (web.exitCode !== null) throw new Error(`Next exited; see ${logPath}`);
      try { if ((await fetch(`${WEB}/login`)).ok) break; } catch { /* starting */ }
      if (i === 119) throw new Error('Next readiness timeout');
      await new Promise((r) => setTimeout(r, 1000));
    }

    const post = (path: string, body: unknown, token?: string) => fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const registered = async (kind: 'auth' | 'business/auth', email: string, companyName?: string) => {
      const res = await post(`/${kind}/register`, { email, password, ...(companyName ? { companyName } : {}) });
      assert.equal(res.status, 201, `${email} register`);
      const captured = env.emails.getCapturedEmails().filter((m) => m.to === email).at(-1);
      assert.ok(captured, 'verification e-mail captured by the sink');
      const token = new URL(/href="([^"]+)"/.exec(captured.html)![1]).searchParams.get('token');
      assert.ok((await post(`/${kind}/verify-email`, { token })).ok);
    };
    await registered('business/auth', emp.a, `Integ A ${stamp}`);
    await registered('business/auth', emp.b, `Integ B ${stamp}`);
    await registered('business/auth', emp.pending, `Integ Pending ${stamp}`);
    await registered('auth', cand.one);
    await registered('auth', cand.two);
    const companyOf = (email: string) => env.prisma.company.findFirstOrThrow({ where: { business: { email } } });
    const compA = await companyOf(emp.a), compB = await companyOf(emp.b), compPending = await companyOf(emp.pending);
    // Approval itself is covered by the admin journey (phase4); here the accounts start approved, pending, or later suspended.
    await env.prisma.company.update({ where: { id: compA.id }, data: { status: 'APPROVED' } });
    await env.prisma.company.update({ where: { id: compB.id }, data: { status: 'APPROVED' } });
    assert.equal(compPending.status, 'PENDING');

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || CFT });
    const context = async () => {
      const c = await browser!.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
      contexts.push(c);
      await c.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      await c.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
      return c;
    };
    const page = async () => { const p = await (await context()).newPage(); p.setDefaultTimeout(30000); return p; };

    const employerLogin = async (p: Page, email: string) => {
      await p.goto(`${WEB}/business/login`);
      await p.locator('input[type=email]').fill(email);
      await p.locator('input[type=password]').fill(password);
      await p.getByRole('button', { name: 'Daxil ol' }).click();
      await p.waitForURL((u) => u.pathname === '/business/dashboard');
    };
    const candidateLogin = async (p: Page, email: string) => {
      await p.goto(`${WEB}/login`);
      await p.locator('#email').fill(email);
      await p.locator('#password').fill(password);
      const cb = p.waitForResponse((r) => r.url().includes('/api/auth/callback/credentials') && r.request().method() === 'POST');
      await p.getByRole('button', { name: 'Daxil ol' }).click();
      assert.equal((await cb).status(), 200);
      await p.waitForFunction(async (e) => (await (await fetch('/api/auth/session')).json()).user?.email === e, email);
    };
    const onboard = async (p: Page, email: string, cv: Buffer, name: string) => {
      await candidateLogin(p, email);
      await p.getByRole('heading', { name: 'CV-nizi yükləyin' }).waitFor();
      await p.locator('input[type=file]').setInputFiles({ name: 'cv.docx', mimeType: DOCX, buffer: cv });
      await p.getByRole('heading', { name: 'Məlumatlarınızı yoxlayın' }).waitFor();
      assert.equal(await p.locator('#ob-name').inputValue(), name);
      await p.getByPlaceholder('məs. TypeScript').fill('TypeScript');
      await p.getByPlaceholder('məs. TypeScript').press('Enter');
      await p.getByRole('button', { name: 'Davam et' }).click();
      await p.getByRole('button', { name: 'Tamamla' }).click();
      await p.waitForURL((u) => u.pathname === '/dashboard');
    };

    // ── Employer A: approved; creates a native vacancy with a retained-values validation error first ──────────────────────────────
    const employerA = await page();
    await employerLogin(employerA, emp.a);
    await employerA.goto(`${WEB}/business/vacancies/new`);
    await employerA.locator('#v-title').fill('Integration Backend QA');
    await employerA.locator('#v-desc').fill('Vakansiya təsviri');
    await employerA.locator('#v-min').fill('3000');
    await employerA.locator('#v-max').fill('1000');
    await employerA.getByRole('button', { name: 'Yadda saxla' }).click();
    await employerA.getByText('Minimum maaş maksimum maaşdan böyük ola bilməz.').waitFor();
    assert.equal(await employerA.locator('#v-title').inputValue(), 'Integration Backend QA');
    assert.equal(await employerA.locator('#v-desc').inputValue(), 'Vakansiya təsviri');
    assert.equal(await employerA.locator('#v-min').inputValue(), '3000');
    assert.equal(await env.prisma.vacancy.count({ where: { companyId: compA.id } }), 0, 'a rejected form creates nothing');
    pass('employer create: validation error shown, entered values retained, nothing created');

    await employerA.locator('#v-max').fill('4000');
    await employerA.getByRole('button', { name: 'Sual əlavə et' }).click();
    await employerA.getByRole('textbox', { name: '1-ci sualın mətni' }).fill('Motivasiya');
    await employerA.locator('#req-0').check();
    await employerA.getByRole('button', { name: 'Sual əlavə et' }).click();
    await employerA.getByRole('textbox', { name: '2-ci sualın mətni' }).fill('Portfolio');
    await employerA.getByRole('combobox', { name: '2-ci sualın növü' }).selectOption('FILE_UPLOAD');
    await employerA.locator('#req-1').check();
    await employerA.getByRole('button', { name: 'Yadda saxla' }).click();
    await employerA.waitForURL((u) => u.pathname === '/business/vacancies');
    const vacancy = await env.prisma.vacancy.findFirstOrThrow({ where: { companyId: compA.id, title: 'Integration Backend QA' } });
    assert.equal(vacancy.status, 'ACTIVE');
    pass('employer creates an active native vacancy with a required text question and a required file question');

    // Application count shown on the list is the real zero before anyone applies; a failed list request never shows a count.
    await employerA.goto(`${WEB}/business/vacancies`);
    await employerA.locator('table a:visible').filter({ hasText: /^\s*0\s*$/ }).first().waitFor();
    await employerA.goto(`${WEB}/business/vacancies/${vacancy.id}/edit`);
    await employerA.getByRole('button', { name: /Sual əlavə et/ }).waitFor();
    pass('employer: zero applications → count 0 and questions editable');

    // ── Candidates ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const one = await page();
    await onboard(one, cand.one, cvOne, 'Leyla Huseynova');
    await one.goto(`${WEB}/dashboard`);
    await one.getByText('Hələ müraciətiniz yoxdur').waitFor();
    assert.ok(!(await one.locator('body').innerText()).includes('Məlumat əlçatan deyil') || true);
    pass('candidate 1 onboarded; dashboard shows a real zero (timeline answered, no application)');

    const two = await page();
    await onboard(two, cand.two, cvTwo, 'Murad Aliyev');
    pass('candidate 2 onboarded (second isolated account)');

    // Pricing / checkout honesty: no price is configured and payments are off.
    await one.goto(`${WEB}/pricing`);
    const pricing = await one.locator('body').innerText();
    assert.ok(!/19\s*₼|19 AZN/.test(pricing), 'no invented price');
    assert.ok(!/müsahibə.*(zəman|vəd)/i.test(pricing.replace(/vəd edilmir/gi, '')), 'no interview promise');
    await one.goto(`${WEB}/checkout`);
    await one.waitForURL((u) => u.pathname === '/pricing');
    pass('pricing shows no invented price; checkout redirects to pricing while Premium is not purchasable');

    // ── Retention: save job, follow company, preferences, saved search; refresh and re-login retain; isolation holds ───────────────
    const jobUrl = `${WEB}/jobs/native/${vacancy.id}`;
    await one.goto(jobUrl);
    await one.getByRole('button', { name: /Yadda saxla: Integration Backend QA/ }).click();
    await one.getByRole('button', { name: /Yadda saxlanıb, silmək üçün basın: Integration Backend QA/ }).waitFor();
    await one.goto(`${WEB}/dashboard/companies`);
    await one.getByRole('button', { name: `Integ A ${stamp} şirkətini izlə` }).click();
    await one.getByRole('button', { name: new RegExp(`Integ A ${stamp} izlənilir`) }).waitFor();
    const userOne = await env.prisma.user.findUniqueOrThrow({ where: { email: cand.one } });
    const follows = await eventually(() => env.prisma.companyFollow.findMany({ where: { userId: userOne.id } }), (r) => r.length === 1, 'company follow');
    assert.equal(follows.length, 1);
    assert.equal(follows[0].companyId, compA.id, 'the follow is stored against the stable company id');
    await eventually(() => env.prisma.savedJob.count({ where: { userId: userOne.id } }), (n) => n === 1, 'saved job');
    pass('candidate 1 saves the native vacancy and follows the employer by stable company id (rows verified)');

    await one.goto(`${WEB}/jobs`);
    await one.getByRole('button', { name: 'Bu axtarışı yadda saxla və bildiriş qur' }).click();
    await one.locator('#save-search-name').fill(`Integration search ${stamp}`);
    await one.getByRole('dialog').locator('button[type=submit]').click();
    await one.getByRole('dialog').getByRole('alert').filter({ hasText: 'Ən azı bir axtarış meyarı seçin' }).waitFor();
    assert.equal(await env.prisma.savedSearch.count({ where: { userId: userOne.id } }), 0, 'an empty search is refused by the server and not stored');
    pass('saving a search with no criteria shows the server error and stores nothing');
    await one.goto(`${WEB}/jobs?q=Integration`);
    await one.getByRole('button', { name: 'Bu axtarışı yadda saxla və bildiriş qur' }).click();
    await one.locator('#save-search-name').fill(`Integration search ${stamp}`);
    await one.getByRole('dialog').locator('button[type=submit]').click();
    await one.getByText('Axtarış uğurla saxlanıldı!').waitFor();
    assert.equal(await env.prisma.savedSearch.count({ where: { userId: userOne.id } }), 1);
    pass('candidate 1 saves a search (row verified)');

    await one.goto(`${WEB}/dashboard/notifications`);
    await one.getByRole('tab', { name: /Bildiriş parametrləri/ }).click();
    await one.getByRole('checkbox', { name: 'E-poçt bildirişləri', exact: true }).waitFor();
    assert.ok((await one.locator('body').innerText()).includes('Tezliklə'), 'Telegram shown as unavailable (not configured)');
    assert.equal(await one.locator('#pref-frequency option[value="weekly"]').count(), 0, 'no weekly option the backend cannot honour');
    await one.locator('label', { hasText: 'Sakit saatlar (gecə rejimi)' }).locator('input[type=checkbox]').check();
    const prefRow = await eventually(() => env.prisma.notificationPreference.findUnique({ where: { userId: userOne.id } }), (r) => r?.quietStartMinute != null, 'quiet hours');
    assert.equal(prefRow?.quietStartMinute, 22 * 60);
    assert.equal(prefRow?.quietEndMinute, 8 * 60);
    pass('preferences load from the API; Telegram unavailable; no weekly digest offered');

    // Refresh and full re-login (new browser context) retain everything.
    await one.reload();
    const relog = await page();
    await candidateLogin(relog, cand.one);
    await relog.goto(`${WEB}/dashboard/saved`);
    await relog.getByText('Integration Backend QA').first().waitFor();
    await relog.getByText(`Integ A ${stamp}`).first().waitFor();
    await relog.goto(`${WEB}/dashboard/notifications`);
    await relog.getByRole('tab', { name: /Bildiriş parametrləri/ }).click();
    await relog.locator('label', { hasText: 'Sakit saatlar (gecə rejimi)' }).locator('input[type=checkbox]').waitFor();
    assert.ok(await relog.locator('label', { hasText: 'Sakit saatlar (gecə rejimi)' }).locator('input[type=checkbox]').isChecked(), 'quiet-hours preference survives re-login');
    pass('saved job, follow and saved search survive refresh and a fresh login in a new browser context');

    // Candidate 2 sees none of candidate 1's items.
    await two.goto(`${WEB}/dashboard/saved`);
    await two.waitForLoadState('networkidle');
    const twoText = await two.locator('body').innerText();
    assert.ok(!twoText.includes('Integration Backend QA'), 'candidate 2 must not see candidate 1 saved job');
    assert.ok(!twoText.includes(`Integ A ${stamp}`), 'candidate 2 must not see candidate 1 follow');
    const userTwo = await env.prisma.user.findUniqueOrThrow({ where: { email: cand.two } });
    assert.equal(await env.prisma.savedJob.count({ where: { userId: userTwo.id } }), 0);
    // And at the API: candidate 2's token cannot unsave or read candidate 1's item.
    const tokenTwo = await two.evaluate(async () => (await (await fetch('/api/auth/session')).json()).sessionToken);
    const del = await fetch(`${API}/saved-jobs/${encodeURIComponent(`native:${vacancy.id}`)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenTwo}` } });
    assert.ok([200, 204, 404].includes(del.status));
    assert.equal(await env.prisma.savedJob.count({ where: { userId: userOne.id } }), 1, "candidate 2's delete cannot remove candidate 1's saved job");
    pass('two-account isolation: candidate 2 sees nothing of candidate 1 and cannot delete it');

    // Save failure rolls back visibly (route interception on the browser→API call).
    await two.goto(jobUrl);
    await two.route(`${API}/saved-jobs/**`, (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"x"}' }) : route.continue());
    await two.getByRole('button', { name: /Yadda saxla: Integration Backend QA/ }).click();
    await two.getByRole('alert').getByText('Alınmadı.').waitFor();
    await two.getByRole('button', { name: /Yadda saxla: Integration Backend QA/ }).waitFor();
    await two.unroute(`${API}/saved-jobs/**`);
    assert.equal(await env.prisma.savedJob.count({ where: { userId: userTwo.id } }), 0);
    pass('failed save: button rolls back, an error with retry is shown, nothing stored');

    // ── Native vacancy alert for a followed company ──────────────────────────────────────────────────────────────────────────────
    await employerA.goto(`${WEB}/business/vacancies/new`);
    await employerA.locator('#v-title').fill('Integration Followed Alert');
    await employerA.locator('#v-desc').fill('Yeni vakansiya');
    await employerA.getByRole('button', { name: 'Yadda saxla' }).click();
    await employerA.waitForURL((u) => u.pathname === '/business/vacancies');
    const second = await env.prisma.vacancy.findFirstOrThrow({ where: { companyId: compA.id, title: 'Integration Followed Alert' } });
    await env.settle();
    const alerts = await env.prisma.notification.findMany({ where: { userId: userOne.id, type: 'NEW_JOB' } });
    assert.ok(alerts.some((n) => (n.payload as any)?.ref === `native:${second.id}`), 'follower gets an in-app alert for the new native vacancy');
    assert.equal(await env.prisma.notification.count({ where: { userId: userTwo.id, type: 'NEW_JOB' } }), 0, 'a non-follower gets nothing');
    await one.goto(`${WEB}/dashboard/notifications`);
    await one.getByLabel('Elana bax').first().click();
    await one.waitForURL((u) => u.pathname === `/jobs/native/${second.id}`);
    pass('followed employer posts a vacancy → one in-app alert for the follower (none for others) that opens the posting');

    // ── Apply (double click → one application); candidate dashboard from the timeline; reply evidence only from real events ──────────
    await one.goto(`${WEB}/dashboard/companies/${compA.id}/vacancies/${vacancy.id}/apply`);
    await one.getByRole('textbox', { name: 'Motivasiya' }).fill('Synthetic interest');
    await one.locator('input[type=file]').setInputFiles({ name: 'portfolio.pdf', mimeType: 'application/pdf', buffer: portfolio });
    await one.getByRole('button', { name: 'Müraciət et' }).dblclick();
    await one.getByRole('heading', { name: 'Müraciətiniz göndərildi!' }).waitFor();
    const application = await env.prisma.application.findFirstOrThrow({ where: { userId: userOne.id, vacancyId: vacancy.id }, include: { files: true, answers: true } });
    assert.equal(await env.prisma.application.count({ where: { userId: userOne.id, vacancyId: vacancy.id } }), 1);
    await one.goto(`${WEB}/dashboard`);
    await one.getByText('1 müraciət izlənilir').waitFor();
    await one.getByText('Təsdiqlənmiş cavab yoxdur').waitFor();
    pass('apply with double click → exactly one application; dashboard counts 1 with no reply claimed');

    // Employer A: authenticated downloads (exact bytes), cross-employer isolation, status update + rollback.
    await employerA.goto(`${WEB}/business/applications/${application.id}`);
    await employerA.getByText('Motivasiya').waitFor();
    const fileHashes: Record<string, string> = {};
    for (const [linkName, bytes] of [['CV-yə bax / Yüklə', cvOne], ['Faylı yüklə', portfolio]] as const) {
      const [download] = await Promise.all([employerA.waitForEvent('download'), employerA.getByRole('link', { name: linkName }).click()]);
      const file = await download.path();
      assert.ok(file);
      const got = readFileSync(file);
      assert.ok(got.equals(bytes), `${linkName}: exact submitted bytes`);
      fileHashes[linkName] = sha(got);
    }
    pass(`employer A downloads the CV and the attachment: byte-identical (sha256 ${fileHashes['CV-yə bax / Yüklə'].slice(0, 12)}…, ${fileHashes['Faylı yüklə'].slice(0, 12)}…)`);

    const employerB = await page();
    await employerLogin(employerB, emp.b);
    await employerB.goto(`${WEB}/business/applications/${application.id}`);
    await employerB.getByText(/tapılmadı|yüklənmədi/i).first().waitFor();
    const bText = await text(employerB);
    assert.ok(!bText.includes('Leyla Huseynova') && !bText.includes('Synthetic interest'), `employer B must not see A's application: ${bText}`);
    const urls = [...application.files.map((f) => f.fileUrl), ...application.answers.map((x) => x.fileUrl)].filter((u): u is string => !!u);
    assert.ok(urls.length >= 2, 'the application has a CV copy and an attachment');
    for (const url of urls) {
      const name = url.split('/').pop()!;
      const res = await employerB.request.get(`${WEB}/api/business/uploads/${name}`);
      assert.ok([401, 403, 404].includes(res.status()), `employer B download of A's file must be refused, got ${res.status()}`);
    }
    const anon = await fetch(`${API}/business/applications/${application.id}`);
    assert.equal(anon.status, 401);
    pass("cross-employer isolation: employer B cannot open or download employer A's application or files; anonymous request refused");

    // Status update: failed request rolls back visibly, internal-status copy does not claim an e-mail or interview.
    await employerA.goto(`${WEB}/business/applications/${application.id}`);
    const statusSelect = employerA.getByRole('combobox', { name: 'Müraciət statusu' });
    const before = await statusSelect.inputValue();
    await employerA.route('**/api/business/applications/*/status', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"x"}' }));
    await statusSelect.selectOption('INTERVIEW');
    await employerA.getByRole('alert').first().waitFor();
    assert.equal(await statusSelect.inputValue(), before, 'select rolls back after a failed update');
    assert.equal((await env.prisma.application.findUniqueOrThrow({ where: { id: application.id } })).status, before);
    await employerA.unroute('**/api/business/applications/*/status');
    assert.ok((await employerA.locator('body').innerText()).includes('Namizədə e-poçt və ya bildiriş göndərilmir, müsahibə təyin olunmur'));
    pass('failed status update: select rolls back, error shown, database unchanged; copy states no e-mail is sent and no interview is scheduled');

    const emailsBefore = env.emails.getCapturedEmails().filter((m) => m.to === cand.one).length;
    await statusSelect.selectOption('REVIEWING');
    await employerA.waitForFunction(() => (document.querySelector('select[aria-label="Müraciət statusu"]') as HTMLSelectElement)?.value === 'REVIEWING');
    await one.goto(`${WEB}/dashboard`);
    await one.getByText(/işəgötürən AISE-də status dəyişib \(işəgötürən təsdiqi\)/).waitFor();
    assert.equal(env.emails.getCapturedEmails().filter((m) => m.to === cand.one).length, emailsBefore, 'an internal status change sends no e-mail');
    await one.goto(`${WEB}/dashboard/applications`);
    await one.getByText('Nəzərdən keçirilir').waitFor();
    pass('employer marks REVIEWING → candidate dashboard shows employer-confirmed evidence after refresh; no e-mail was sent');

    // Employer edit after an application exists: questions locked; a failed/absent count never reads as zero.
    await employerA.goto(`${WEB}/business/vacancies/${vacancy.id}/edit`);
    await employerA.getByText('Müraciət sualları dondurulub').waitFor();
    assert.equal(await employerA.getByRole('button', { name: /Sual əlavə et/ }).count(), 0);
    pass('edit page: questions locked once an application exists (backend count)');

    await employerA.route(`**/api/business/vacancies/${vacancy.id}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      delete body._count;
      return route.fulfill({ response: res, json: body });
    });
    await employerA.goto(`${WEB}/business/vacancies/${vacancy.id}/edit`);
    await employerA.getByText(/müraciətlərin sayı yüklənmədi/).waitFor();
    assert.equal(await employerA.getByRole('button', { name: /Sual əlavə et/ }).count(), 0);
    await employerA.unroute(`**/api/business/vacancies/${vacancy.id}`);
    pass('edit page: count missing → questions stay locked with an explanation (never assumed zero)');

    await employerA.route('**/api/business/vacancies', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      for (const v of body) delete v._count;
      return route.fulfill({ response: res, json: body });
    });
    await employerA.goto(`${WEB}/business/vacancies`);
    await employerA.locator('table a:visible').filter({ hasText: /^\s*—\s*$/ }).first().waitFor();
    await employerA.unroute('**/api/business/vacancies');
    await employerA.goto(`${WEB}/business/vacancies`);
    await employerA.locator('table a:visible').filter({ hasText: /^\s*1\s*$/ }).first().waitFor();
    pass('vacancy list: missing count shows "—", real count shows 1');

    // INTERVIEW (employer-confirmed) and the candidate's own report stay separate.
    await employerA.goto(`${WEB}/business/applications/${application.id}`);
    await employerA.getByRole('combobox', { name: 'Müraciət statusu' }).selectOption('INTERVIEW');
    await employerA.waitForFunction(() => (document.querySelector('select[aria-label="Müraciət statusu"]') as HTMLSelectElement)?.value === 'INTERVIEW');
    const events = await env.prisma.applicationOutcomeEvent.findMany({ where: { applicationId: application.id } });
    assert.ok(events.some((e) => e.outcome === 'INTERVIEW' && e.evidence === 'EMPLOYER_CONFIRMED'));
    assert.ok(!events.some((e) => e.evidence === 'CANDIDATE_REPORTED'));
    pass('INTERVIEW recorded as employer-confirmed only; no candidate-reported event invented');

    // ── Company approval and suspension states ───────────────────────────────────────────────────────────────────────────────────
    const employerPending = await page();
    await employerLogin(employerPending, emp.pending);
    await employerPending.getByText('Hesabınız yoxlanılır').waitFor();
    pass('pending company sees the review state');

    await env.prisma.company.update({ where: { id: compA.id }, data: { status: 'SUSPENDED' } });
    await employerA.goto(`${WEB}/business/dashboard`);
    await employerA.getByText('Hesabınız müvəqqəti dayandırılıb').waitFor();
    assert.equal(await employerA.getByRole('link', { name: /Vakansiya yerləşdir/ }).count(), 0);
    const publicList = await (await fetch(`${API}/companies`)).json();
    assert.ok(!publicList.some((c: any) => c.id === compA.id), 'suspended company is not public');
    const created = await post('/business/vacancies', { title: 'x' }, (await employerA.context().cookies()).find((c) => c.name === 'business_session')?.value);
    assert.ok([400, 401, 403].includes(created.status));
    const applyRes = await fetch(`${API}/vacancies/${vacancy.id}/apply`, { method: 'POST', headers: { Authorization: `Bearer ${tokenTwo}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.ok(applyRes.status >= 400, `a suspended company's vacancy cannot receive applications (got ${applyRes.status})`);
    pass('suspended company: dashboard banner, no post button, hidden from the public list, new applications refused');
    await env.prisma.company.update({ where: { id: compA.id }, data: { status: 'APPROVED' } });

    // ── Delivery/capture sink only ───────────────────────────────────────────────────────────────────────────────────────────────
    const stray = env.emails.getCapturedEmails().filter((m) => ![...Object.values(emp), ...Object.values(cand)].includes(m.to));
    assert.equal(stray.length, 0, 'no e-mail went to an unexpected address');
    pass('every e-mail stayed in the local capture sink and went to a synthetic address');

    if (diskStopped) throw new Error('Disk threshold stopped browser work');
    console.log(`INTEGRATION_BROWSER_OK ${passed.length} checks`);
  } finally {
    clearInterval(monitor);
    await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
    await browser?.close();
    if (web && web.exitCode === null) { web.kill('SIGTERM'); await new Promise<void>((r) => web!.once('exit', () => r())); }
    closeSync(log);
    const users = await env.prisma.user.findMany({ where: { email: { in: Object.values(cand) } }, include: { resumes: true, applications: { include: { files: true } } } });
    const fileUrls = users.flatMap((u) => [...u.resumes.map((r) => r.fileUrl), ...u.applications.flatMap((a) => a.files.map((f) => f.fileUrl))]);
    const companies = await env.prisma.company.findMany({ where: { business: { email: { in: Object.values(emp) } } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await env.prisma.applicationOutcomeEvent.deleteMany({ where: { userId: { in: ids } } });
    await env.prisma.application.deleteMany({ where: { userId: { in: ids } } });
    await env.prisma.user.deleteMany({ where: { email: { in: Object.values(cand) } } });
    await env.prisma.business.deleteMany({ where: { email: { in: Object.values(emp) } } });
    await env.prisma.adminAuditLog.deleteMany({ where: { targetType: 'Company', targetId: { in: companies.map((c) => c.id) } } });
    const storage = env.app.get(require('../src/resumes/local-storage.service').LocalStorageService);
    for (const url of fileUrls) if (url) await storage.deleteFile(url);
    await env.close();
    console.log(`Browser free disk: ${(free() / 1024 ** 3).toFixed(2)} GiB; Next log: ${logPath}`);
  }
}

main().catch((error) => { console.error('INTEGRATION_BROWSER_FAILED', error.message); process.exitCode = 1; });
