/** Local-only: authenticated admin journeys (real health API, dialog focus, roles, expired session) and 320/390/768/1440 layout checks for the
 * admin, candidate and employer screens, over the real web app, API, Postgres and Redis. Synthetic data, isolated database, mock e-mail capture.
 * Run from apps/api: DATABASE_URL=<aise_phase2_test> npx ts-node --transpile-only test/admin-mobile-browser.ts */
import { startPhase2App } from './support/phase2-local-app';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { statfsSync, openSync, closeSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import * as bcrypt from 'bcrypt';

const CFT = `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const WEB = 'http://127.0.0.1:3450';
const API = 'http://127.0.0.1:4010';
const WIDTHS = [320, 390, 768, 1440] as const;

function docx(marker: string, person: string): Buffer {
  const name = Buffer.from('word/document.xml');
  const body = Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${person}</w:t></w:r></w:p><w:p><w:r><w:t>${marker}</w:t></w:r></w:p></w:body></w:document>`);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(name.length, 26); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + body.length, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}

/** Layout facts for the current page: horizontal overflow and visible controls under the 44px target. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const vw = window.innerWidth;
    const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const small: string[] = [];
    document.querySelectorAll('a[href], button, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, [role=button], [role=tab]').forEach((el) => {
      if (!visible(el)) return;
      const inText = el.tagName === 'A' && !!el.closest('p, li, dd, td, span.text, footer') && getComputedStyle(el).display === 'inline';
      if (inText) return;
      if (el.closest('[aria-hidden=true]') || el.classList.contains('sr-only') || el.closest('.sr-only')) return;
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.height < 43.5 || (r.width < 43.5 && !(el.textContent || '').trim())) small.push(`${el.tagName.toLowerCase()}:${((el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim()).slice(0, 30)}:${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    let widest = 0; let culprit = '';
    document.querySelectorAll('body *').forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width > 0 && r.right > widest && visible(el) && !el.closest('[data-scroll-x], .overflow-x-auto, table')) { widest = r.right; culprit = `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 40)}`; }
    });
    return { vw, scrollWidth: doc.scrollWidth, overflow: doc.scrollWidth - vw, widestRight: Math.round(widest), culprit, small };
  });
}

async function main() {
  const root = resolve(process.cwd(), '../..');
  const free = () => { const s = statfsSync(root); return Number(s.bavail) * Number(s.bsize); };
  if (free() < 4 * 1024 ** 3) throw new Error('Need 4 GiB before browser stack');
  process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/aise_phase2_test');
  process.env.ADMIN_MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.ADMIN_WEB_URL = WEB;

  const stamp = `mob-${Date.now()}`;
  const password = 'Mobile-Local-1!';
  const em = { super: `${stamp}-super@example.com`, admin: `${stamp}-admin@example.com`, empA: `${stamp}-emp@example.com`, empPending: `${stamp}-pending@example.com`, cand: `${stamp}-cand@example.com` };
  const cv = docx(`MOBILE-CV-${stamp}`, 'Aysel Karimova');
  const attachment = Buffer.from(`%PDF-1.4\nMOBILE-ATTACHMENT-${stamp}\n%%EOF\n`);

  const env = await startPhase2App({ native: true, retention: true });
  let web: ChildProcess | undefined, browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  const stubs: Server[] = [];
  const scratch = join(tmpdir(), `aise-${stamp}`);
  mkdirSync(scratch, { recursive: true });
  const logPath = `/tmp/${stamp}-next.log`;
  const log = openSync(logPath, 'w', 0o600);
  let diskStopped = false;
  const monitor = setInterval(() => { if (free() < 1.5 * 1024 ** 3) { diskStopped = true; web?.kill('SIGTERM'); void browser?.close(); } }, 5000);
  const passed: string[] = [];
  const pass = (m: string) => { passed.push(m); console.log(`PASS ${m}`); };
  const findings: string[] = [];
  const savedEnv = { m: process.env.MATCHING_SERVICE_URL, a: process.env.APPLY_WORKER_URL, b: process.env.BACKUP_STATUS_FILE };

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

    const post = (path: string, body: unknown) => fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const registered = async (kind: 'auth' | 'business/auth', email: string, companyName?: string) => {
      assert.equal((await post(`/${kind}/register`, { email, password, ...(companyName ? { companyName } : {}) })).status, 201);
      const captured = env.emails.getCapturedEmails().filter((m) => m.to === email).at(-1);
      assert.ok(captured);
      const token = new URL(/href="([^"]+)"/.exec(captured.html)![1]).searchParams.get('token');
      assert.ok((await post(`/${kind}/verify-email`, { token })).ok);
    };
    await registered('business/auth', em.empA, `Mob A ${stamp}`);
    await registered('business/auth', em.empPending, `Mob Pending ${stamp}`);
    await registered('auth', em.cand);
    const compA = await env.prisma.company.findFirstOrThrow({ where: { business: { email: em.empA } } });
    const compPending = await env.prisma.company.findFirstOrThrow({ where: { business: { email: em.empPending } } });
    await env.prisma.company.update({ where: { id: compA.id }, data: { status: 'APPROVED' } });
    const hashed = await bcrypt.hash(password, 10);
    const superUser = await env.prisma.adminUser.create({ data: { email: em.super, hashedPassword: hashed, role: 'SUPER_ADMIN' } });
    await env.prisma.adminUser.create({ data: { email: em.admin, hashedPassword: hashed, role: 'ADMIN' } });

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || CFT });
    const context = async (width = 1280, height = 900) => {
      const c = await browser!.newContext({ viewport: { width, height }, acceptDownloads: true });
      contexts.push(c);
      await c.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      await c.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
      return c;
    };
    const newPage = async (c: BrowserContext) => { const p = await c.newPage(); p.setDefaultTimeout(30000); return p; };

    // ── Admin sessions: ADMIN by real password login in the UI; SUPER_ADMIN with an MFA-verified session row (MFA login itself is proven by admin-browser.ts)
    const adminCtx = await context();
    const adminPage = await newPage(adminCtx);
    const consoleErrors: string[] = [];
    adminPage.on('pageerror', (e) => consoleErrors.push(String(e)));
    await adminPage.goto(`${WEB}/admin`);
    await adminPage.locator('input[type=email]').fill(em.admin);
    await adminPage.locator('input[type=password]').fill(password);
    await adminPage.getByRole('button', { name: 'Daxil ol' }).click();
    await adminPage.waitForURL((u) => u.pathname === '/admin/overview');
    pass('ADMIN operator signs in through the admin UI');

    const superToken = randomBytes(32).toString('hex');
    await env.prisma.adminSession.create({ data: { sessionToken: superToken, adminUserId: superUser.id, expires: new Date(Date.now() + 3_600_000), mfaVerified: true } });
    const superCtx = await context();
    await superCtx.addCookies([{ name: 'admin_session', value: superToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    const superPage = await newPage(superCtx);
    superPage.on('pageerror', (e) => consoleErrors.push(String(e)));

    // ── 1. Health: the real /admin/ops/health response drives the verdict; unknown, stale, failed and healthy stay distinct ─────────────
    const stub = (path: string, status: () => number) => new Promise<{ server: Server; url: string }>((ok) => {
      const server = createServer((req, res) => { if (req.url === path) { res.statusCode = status(); res.end('{}'); } else { res.statusCode = 404; res.end(); } });
      server.listen(0, '127.0.0.1', () => { stubs.push(server); ok({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` }); });
    });
    let matchingStatus = 200;
    const matching = await stub('/health', () => matchingStatus);
    const worker = await stub('/sessions', () => 200);
    process.env.MATCHING_SERVICE_URL = matching.url;
    process.env.APPLY_WORKER_URL = worker.url;
    const statusFile = join(scratch, 'backup-status.json');
    process.env.BACKUP_STATUS_FILE = statusFile;
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const writeStatus = (over: Record<string, unknown> = {}) => writeFileSync(statusFile, JSON.stringify({ lastBackupAt: hoursAgo(5), lastOffhostCopyAt: hoursAgo(5), lastOffhostResult: 'VERIFIED', lastRestoreTestAt: hoursAgo(48), lastRestoreTestResult: 'PASSED', ...over }));
    const apiHealth = await (async () => {
      writeStatus();
      const res = await fetch(`${API}/admin/ops/health`, { headers: { Authorization: `Bearer ${superToken}` } });
      assert.equal(res.status, 200);
      return res.json() as Promise<any>;
    })();
    assert.deepEqual(Object.keys(apiHealth.services).sort(), ['applyWorker', 'database', 'matching', 'redis']);
    assert.equal(typeof apiHealth.backup.lastBackupAgeHours, 'number');
    assert.equal(apiHealth.services.matching.ok, true);
    pass('the real health API returns the shape the pages read (four services with ok/ms, backup evidence with ages)');

    const verdictOnOverview = async (label: string) => { await superPage.goto(`${WEB}/admin/overview`); await superPage.getByText(label, { exact: true }).first().waitFor(); };
    writeStatus();
    await verdictOnOverview('Bütün servislər aktiv');
    pass('overview: all four services up with fresh backup, off-host copy and restore test → healthy');
    writeStatus({ lastBackupAt: hoursAgo(40) });
    await verdictOnOverview('Köhnəlmiş sübut');
    pass('overview: backup 40 h old → stale (not healthy, not failed)');
    writeStatus({ lastOffhostResult: 'FAILED' });
    await verdictOnOverview('Xarici nüsxə uğursuz');
    pass('overview: failed off-host copy → failed');
    process.env.BACKUP_STATUS_FILE = join(scratch, 'missing.json');
    await verdictOnOverview('Ehtiyat nüsxə məlum deyil');
    pass('overview: unreadable backup status → unknown even though every service is up');
    process.env.BACKUP_STATUS_FILE = statusFile; writeStatus(); matchingStatus = 503;
    await verdictOnOverview('1 servisdə xəta');
    await superPage.goto(`${WEB}/admin/system`);
    await superPage.getByText('Əlçatmaz').waitFor();
    pass('a failing service (matching 503) → failed on the overview and "Əlçatmaz" on the system page');
    matchingStatus = 200;
    await superPage.route('**/api/admin/ops/health', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"x"}' }));
    await superPage.goto(`${WEB}/admin/overview`);
    await superPage.getByText('Məlum deyil', { exact: true }).first().waitFor();
    await superPage.unroute('**/api/admin/ops/health');
    pass('a failed health request → unknown, never healthy');

    // Zero recorded failures is not health: with healthy counters and a failing service the overview still says failed.
    matchingStatus = 503;
    await superPage.goto(`${WEB}/admin/overview`);
    await superPage.getByText(/Bu sayğaclarda heç bir xəta qeydə alınmayıb/).waitFor();
    await superPage.getByText('1 servisdə xəta').first().waitFor();
    matchingStatus = 200;
    pass('zero recorded failures and a failing service coexist on screen: the counter note is scoped to the counters, the health card says failed');

    // An unreadable queue is unknown, not "0 failed".
    const ops: any = env.app.get(require('../src/admin/ops/admin-ops.service').AdminOpsService);
    const queue = ops.queueByName['job-ingested'];
    const realCounts = queue.getJobCounts.bind(queue);
    queue.getJobCounts = async () => { throw new Error('synthetic queue read failure'); };
    await superPage.goto(`${WEB}/admin/overview`);
    await superPage.getByText('Oxuna bilməyən növbələr').waitFor();
    assert.equal(await superPage.getByText('0 uğursuz tapşırıq').count(), 0);
    queue.getJobCounts = realCounts;
    pass('an unreadable queue is reported as unknown (never "0 failed", never the zero-failures reassurance)');

    // ── 2. Dialog focus containment, restoration and busy state (reject a pending company, reason required) ─────────────────────────
    await adminPage.goto(`${WEB}/admin/businesses`);
    const row = adminPage.locator('tr:visible').filter({ hasText: em.empPending });
    const trigger = row.getByRole('button', { name: /Rədd et/ });
    await trigger.focus();
    await trigger.click();
    const dialog = adminPage.getByRole('dialog');
    await dialog.waitFor();
    const reason = dialog.getByLabel(/Səbəb/);
    assert.equal(await reason.evaluate((el) => el === document.activeElement), true, 'initial focus is the required reason field');
    const insideDialog = () => adminPage.evaluate(() => !!document.activeElement && !!document.querySelector('[role=dialog]')?.contains(document.activeElement));
    await reason.fill('Sintetik rədd səbəbi');
    for (let i = 0; i < 7; i++) { await adminPage.keyboard.press('Tab'); assert.ok(await insideDialog(), `Tab ${i + 1} stays in the dialog`); }
    for (let i = 0; i < 7; i++) { await adminPage.keyboard.press('Shift+Tab'); assert.ok(await insideDialog(), `Shift+Tab ${i + 1} stays in the dialog`); }
    assert.equal(await adminPage.evaluate(() => document.body.style.overflow), 'hidden', 'body scroll is locked while open');
    await adminPage.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate((el) => el === document.activeElement), true, 'focus returns to the control that opened the dialog');
    assert.equal(await adminPage.evaluate(() => document.body.style.overflow), '', 'body scroll restored');
    assert.equal((await env.prisma.company.findUniqueOrThrow({ where: { id: compPending.id } })).status, 'PENDING', 'Escape changed nothing');
    pass('dialog: initial focus on the reason, Tab/Shift+Tab contained, Escape closes, focus restored, scroll lock released, nothing changed');

    let rejectCalls = 0;
    await adminPage.route('**/api/admin/companies/*/reject', async (r) => { rejectCalls += 1; await new Promise((x) => setTimeout(x, 1500)); await r.continue(); });
    await trigger.click();
    await dialog.waitFor();
    await dialog.getByLabel(/Səbəb/).fill('Sintetik rədd səbəbi');
    const confirm = dialog.getByRole('button', { name: 'Rədd et' });
    await confirm.dblclick();
    await dialog.getByRole('button', { name: 'Gözləyin...' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'İmtina' }).isDisabled(), true, 'cancel disabled while busy');
    assert.equal(await dialog.getByLabel(/Səbəb/).isDisabled(), true, 'reason disabled while busy');
    assert.ok(await insideDialog(), 'focus stays in the dialog while busy');
    await adminPage.keyboard.press('Escape');
    assert.equal(await dialog.count(), 1, 'Escape is ignored while a request is running');
    await dialog.waitFor({ state: 'detached' });
    await adminPage.unroute('**/api/admin/companies/*/reject');
    assert.equal(rejectCalls, 1, 'double click sends exactly one request');
    const rejected = await env.prisma.company.findUniqueOrThrow({ where: { id: compPending.id } });
    assert.equal(rejected.status, 'REJECTED');
    assert.ok(await env.prisma.adminAuditLog.count({ where: { targetType: 'Company', targetId: compPending.id } }) >= 1, 'the rejection is audited');
    const focusAfter = await adminPage.evaluate(() => document.activeElement?.tagName ?? 'none');
    assert.notEqual(focusAfter, 'BODY', 'focus is not lost to <body> after the action');
    pass('dialog busy state: controls disabled, focus kept, Escape ignored, double click → one request, company rejected with audit row, focus not lost');

    // ── 3. Roles ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const adminToken = (await adminCtx.cookies()).find((c) => c.name === 'admin_session')!.value;
    for (const path of ['/admin/operators']) {
      const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${adminToken}` } });
      assert.ok([403].includes(res.status), `ADMIN → ${path} must be 403, got ${res.status}`);
    }
    assert.equal(await adminPage.getByRole('link', { name: 'Operatorlar' }).count(), 0);
    await adminPage.goto(`${WEB}/admin/operators`);
    await adminPage.waitForLoadState('domcontentloaded');
    const opsText = await adminPage.locator('body').innerText();
    assert.ok(!opsText.includes(em.super), 'ADMIN never sees the operator list');
    await superPage.goto(`${WEB}/admin/operators`);
    await superPage.getByText(em.admin).first().waitFor();
    pass('roles: ADMIN has no Operatorlar link, the API refuses it (403) and the page shows no operator data; the MFA-verified SUPER_ADMIN sees it (SUPPORT read-only and MFA login are covered by admin-browser.ts)');

    // ── 4. Expired session mid-use ─────────────────────────────────────────────────────────────────────────────────────────────────
    await adminPage.goto(`${WEB}/admin/overview`);
    await adminPage.getByText('Ümumi baxış').first().waitFor();
    await env.prisma.adminSession.deleteMany({ where: { sessionToken: adminToken } });
    await adminPage.getByRole('button', { name: 'Yenilə' }).click();
    await Promise.race([
      adminPage.waitForURL((u) => u.pathname === '/admin', { timeout: 8000 }).then(() => 'redirected'),
      adminPage.getByText(/Sessiya|sessiya|Not authenticated|\(401\)/).first().waitFor({ timeout: 8000 }).then(() => 'message'),
    ]);
    const afterAction = adminPage.url();
    await adminPage.goto(`${WEB}/admin/users`);
    await adminPage.waitForURL((u) => u.pathname === '/admin');
    findings.push(`expired admin session: after an in-page action the page ${afterAction.endsWith('/admin') ? 'redirected to login' : 'stayed with an error message'}; a navigation redirects to /admin`);
    pass('expired admin session: the next navigation goes back to the login page');
    // Sign the ADMIN back in for the layout pass.
    await adminPage.locator('input[type=email]').fill(em.admin);
    await adminPage.locator('input[type=password]').fill(password);
    await adminPage.getByRole('button', { name: 'Daxil ol' }).click();
    await adminPage.waitForURL((u) => u.pathname === '/admin/overview');

    // ── 5. Admin layouts at 320 / 390 / 768 / 1440 (SUPER_ADMIN covers every page) ────────────────────────────────────────────────
    const adminPages = ['overview', 'businesses', 'users', 'listings', 'applications', 'operations', 'sources', 'email', 'audit', 'system', 'operators', 'account'];
    const layoutFailures: string[] = [];
    const smallTargets = new Map<string, number>();
    for (const w of WIDTHS) {
      await superPage.setViewportSize({ width: w, height: 900 });
      for (const p of adminPages) {
        await superPage.goto(`${WEB}/admin/${p}`);
        await superPage.waitForLoadState('domcontentloaded');
        await superPage.locator('h1').first().waitFor();
        await superPage.waitForTimeout(400);
        assert.equal(new URL(superPage.url()).pathname, `/admin/${p}`, `${p} stays reachable`);
        const l = await layout(superPage);
        if (l.overflow > 1) layoutFailures.push(`${w}px /admin/${p}: horizontal overflow ${l.overflow}px (widest ${l.widestRight}, ${l.culprit})`);
        for (const s of l.small) smallTargets.set(`/admin/${p} ${s}`, w);
      }
    }
    assert.deepEqual(layoutFailures, [], `admin overflow:\n${layoutFailures.join('\n')}`);
    pass(`admin: ${adminPages.length} pages × ${WIDTHS.length} widths (${WIDTHS.join('/')}) with no horizontal overflow and no page error`);
    if (smallTargets.size) findings.push(`admin controls under 44px: ${[...smallTargets.keys()].slice(0, 12).join(' | ')}${smallTargets.size > 12 ? ` … (+${smallTargets.size - 12})` : ''}`);
    assert.equal(consoleErrors.length, 0, `uncaught page errors on admin pages: ${consoleErrors.join(' | ')}`);

    // ── 6. Candidate and employer: key actions at 390px and layouts at 320/390/768 ───────────────────────────────────────────────
    const mobileCtx = await context(390, 844);
    const emp = await newPage(mobileCtx);
    emp.on('pageerror', (e) => consoleErrors.push(String(e)));
    await emp.goto(`${WEB}/business/login`);
    await emp.locator('input[type=email]').fill(em.empA);
    await emp.locator('input[type=password]').fill(password);
    await emp.getByRole('button', { name: 'Daxil ol' }).click();
    await emp.waitForURL((u) => u.pathname === '/business/dashboard');
    await emp.goto(`${WEB}/business/vacancies/new`);
    await emp.locator('#v-title').fill('Mobile Journey Role');
    await emp.locator('#v-desc').fill('Mobil təsvir');
    await emp.getByRole('button', { name: 'Sual əlavə et' }).click();
    await emp.getByRole('textbox', { name: '1-ci sualın mətni' }).fill('Motivasiya');
    await emp.locator('#req-0').check();
    await emp.getByRole('button', { name: 'Sual əlavə et' }).click();
    await emp.getByRole('textbox', { name: '2-ci sualın mətni' }).fill('Portfolio');
    await emp.getByRole('combobox', { name: '2-ci sualın növü' }).selectOption('FILE_UPLOAD');
    await emp.locator('#req-1').check();
    await emp.getByRole('button', { name: 'Yadda saxla' }).click();
    await emp.waitForURL((u) => u.pathname === '/business/vacancies');
    const vacancy = await env.prisma.vacancy.findFirstOrThrow({ where: { companyId: compA.id, title: 'Mobile Journey Role' } });
    pass('390px: employer creates a vacancy with a required text and file question');

    const cand = await newPage(await context(390, 844));
    cand.on('pageerror', (e) => consoleErrors.push(String(e)));
    await cand.goto(`${WEB}/login`);
    await cand.locator('#email').fill(em.cand);
    await cand.locator('#password').fill(password);
    await cand.getByRole('button', { name: 'Daxil ol' }).click();
    await cand.getByRole('heading', { name: 'CV-nizi yükləyin' }).waitFor();
    await cand.locator('input[type=file]').setInputFiles({ name: 'cv.docx', mimeType: DOCX, buffer: cv });
    await cand.getByRole('heading', { name: 'Məlumatlarınızı yoxlayın' }).waitFor();
    await cand.getByPlaceholder('məs. TypeScript').fill('TypeScript');
    await cand.getByPlaceholder('məs. TypeScript').press('Enter');
    await cand.getByRole('button', { name: 'Davam et' }).click();
    await cand.getByRole('button', { name: 'Tamamla' }).click();
    await cand.waitForURL((u) => u.pathname === '/dashboard');
    pass('390px: candidate uploads a DOCX CV and completes onboarding');

    await cand.goto(`${WEB}/jobs/native/${vacancy.id}`);
    await cand.getByRole('button', { name: /Yadda saxla: Mobile Journey Role/ }).click();
    await cand.getByRole('button', { name: /Yadda saxlanıb, silmək üçün basın: Mobile Journey Role/ }).waitFor();
    await cand.goto(`${WEB}/dashboard/companies`);
    await cand.getByRole('button', { name: `Mob A ${stamp} şirkətini izlə` }).click();
    await cand.getByRole('button', { name: new RegExp(`Mob A ${stamp} izlənilir`) }).waitFor();
    const user = await env.prisma.user.findUniqueOrThrow({ where: { email: em.cand } });
    for (let i = 0; i < 50 && (await env.prisma.companyFollow.count({ where: { userId: user.id } })) < 1; i++) await new Promise((r) => setTimeout(r, 200));
    assert.equal(await env.prisma.companyFollow.count({ where: { userId: user.id } }), 1);
    assert.equal(await env.prisma.savedJob.count({ where: { userId: user.id } }), 1);
    pass('390px: candidate saves the vacancy and follows the employer (rows verified)');

    await cand.goto(`${WEB}/dashboard/companies/${compA.id}/vacancies/${vacancy.id}/apply`);
    await cand.getByRole('textbox', { name: 'Motivasiya' }).fill('Mobil maraq');
    await cand.locator('input[type=file]').setInputFiles({ name: 'portfolio.pdf', mimeType: 'application/pdf', buffer: attachment });
    await cand.getByRole('button', { name: 'Müraciət et' }).click();
    await cand.getByRole('heading', { name: 'Müraciətiniz göndərildi!' }).waitFor();
    const application = await env.prisma.application.findFirstOrThrow({ where: { userId: user.id, vacancyId: vacancy.id } });
    pass('390px: candidate applies with an answer and an attachment');

    await emp.goto(`${WEB}/business/applications/${application.id}`);
    await emp.getByText('Motivasiya').waitFor();
    await emp.getByRole('combobox', { name: 'Müraciət statusu' }).selectOption('REVIEWING');
    await emp.waitForFunction(() => (document.querySelector('select[aria-label="Müraciət statusu"]') as HTMLSelectElement)?.value === 'REVIEWING');
    await emp.goto(`${WEB}/business/applications`);
    await emp.getByText('Aysel Karimova').first().waitFor();
    assert.equal((await env.prisma.application.findUniqueOrThrow({ where: { id: application.id } })).status, 'REVIEWING');
    pass('390px: employer reviews the application (card list), changes status; stored');

    const surfaces: [string, Page, string][] = [
      ['candidate', cand, '/dashboard'], ['candidate', cand, '/dashboard/saved'], ['candidate', cand, '/dashboard/companies'], ['candidate', cand, '/dashboard/matches'],
      ['candidate', cand, '/dashboard/applications'], ['candidate', cand, '/dashboard/notifications'], ['candidate', cand, '/dashboard/settings'], ['candidate', cand, '/dashboard/profile'],
      ['candidate', cand, '/jobs'], ['candidate', cand, `/jobs/native/${vacancy.id}`], ['candidate', cand, '/pricing'],
      ['candidate', cand, `/dashboard/companies/${compA.id}/vacancies/${vacancy.id}/apply`],
      ['employer', emp, '/business/dashboard'], ['employer', emp, '/business/vacancies'], ['employer', emp, '/business/vacancies/new'], ['employer', emp, `/business/vacancies/${vacancy.id}/edit`],
      ['employer', emp, '/business/applications'], ['employer', emp, `/business/applications/${application.id}`], ['employer', emp, '/business/company'],
    ];
    const surfaceFailures: string[] = [];
    const surfaceSmall = new Map<string, number>();
    for (const w of [320, 390, 768] as const) {
      for (const [who, page, path] of surfaces) {
        await page.setViewportSize({ width: w, height: 844 });
        await page.goto(`${WEB}${path}`);
        await page.waitForLoadState('domcontentloaded');
        await page.locator('h1, h2').first().waitFor();
        await page.waitForTimeout(500);
        const l = await layout(page);
        if (l.overflow > 1) surfaceFailures.push(`${w}px ${who} ${path}: horizontal overflow ${l.overflow}px (widest ${l.widestRight}, ${l.culprit})`);
        for (const s of l.small) surfaceSmall.set(`${who} ${path.replace(/[a-z0-9]{20,}/g, ':id')} ${s}`, w);
      }
    }
    if (surfaceFailures.length) findings.push(`OVERFLOW:\n  ${surfaceFailures.join('\n  ')}`);
    if (surfaceSmall.size) findings.push(`candidate/employer controls under 44px (${surfaceSmall.size}): ${[...surfaceSmall.keys()].slice(0, 15).join(' | ')}${surfaceSmall.size > 15 ? ' …' : ''}`);
    assert.deepEqual(surfaceFailures, [], `candidate/employer overflow:\n${surfaceFailures.join('\n')}`);
    pass(`candidate and employer: ${surfaces.length} screens × 320/390/768 with no horizontal overflow`);
    assert.equal(consoleErrors.length, 0, `uncaught page errors: ${consoleErrors.join(' | ')}`);

    if (diskStopped) throw new Error('Disk threshold stopped browser work');
    console.log(`ADMIN_MOBILE_BROWSER_OK ${passed.length} checks`);
  } finally {
    clearInterval(monitor);
    if (savedEnv.m === undefined) delete process.env.MATCHING_SERVICE_URL; else process.env.MATCHING_SERVICE_URL = savedEnv.m;
    if (savedEnv.a === undefined) delete process.env.APPLY_WORKER_URL; else process.env.APPLY_WORKER_URL = savedEnv.a;
    if (savedEnv.b === undefined) delete process.env.BACKUP_STATUS_FILE; else process.env.BACKUP_STATUS_FILE = savedEnv.b;
    for (const f of findings) console.log(`FINDING ${f}`);
    await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
    await browser?.close();
    for (const s of stubs) s.close();
    if (web && web.exitCode === null) { web.kill('SIGTERM'); await new Promise<void>((r) => web!.once('exit', () => r())); }
    closeSync(log);
    rmSync(scratch, { recursive: true, force: true });
    const users = await env.prisma.user.findMany({ where: { email: em.cand }, include: { resumes: true, applications: { include: { files: true, answers: true } } } });
    const fileUrls = users.flatMap((u) => [...u.resumes.map((r) => r.fileUrl), ...u.applications.flatMap((a) => [...a.files.map((f) => f.fileUrl), ...a.answers.map((x) => x.fileUrl)])]);
    const companies = await env.prisma.company.findMany({ where: { business: { email: { in: [em.empA, em.empPending] } } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await env.prisma.applicationOutcomeEvent.deleteMany({ where: { userId: { in: ids } } });
    await env.prisma.application.deleteMany({ where: { userId: { in: ids } } });
    await env.prisma.user.deleteMany({ where: { email: em.cand } });
    await env.prisma.business.deleteMany({ where: { email: { in: [em.empA, em.empPending] } } });
    await env.prisma.adminAuditLog.deleteMany({ where: { OR: [{ targetType: 'Company', targetId: { in: companies.map((c) => c.id) } }, { adminUserId: { in: (await env.prisma.adminUser.findMany({ where: { email: { in: [em.super, em.admin] } }, select: { id: true } })).map((a) => a.id) } }] } }).catch(() => undefined);
    await env.prisma.adminUser.deleteMany({ where: { email: { in: [em.super, em.admin] } } });
    const storage = env.app.get(require('../src/resumes/local-storage.service').LocalStorageService);
    for (const url of fileUrls) if (url) await storage.deleteFile(url);
    await env.close();
    console.log(`Browser free disk: ${(free() / 1024 ** 3).toFixed(2)} GiB; Next log: ${logPath}`);
  }
}

main().catch((error) => { console.error('ADMIN_MOBILE_BROWSER_FAILED', error.message); process.exitCode = 1; });
