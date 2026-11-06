/** Local-only: measures real hit areas (Chromium elementFromPoint sweep) of every interactive control on representative public, candidate, employer and admin
 * screens at 320/390/768/1440. Writes the full findings to TOUCH_AUDIT_OUT (JSON) and prints counts grouped by shared cause.
 * Run from apps/api: DATABASE_URL=<aise_phase2_test> TOUCH_AUDIT_OUT=/path.json npx ts-node --transpile-only test/touch-audit-browser.ts
 * Exits non-zero when controls below 44px remain (TOUCH_AUDIT_ALLOW=<n> tolerates a documented number of exceptions). */
import { startPhase2App } from './support/phase2-local-app';
import { auditTargets, signature, type TargetFinding } from './support/target-audit';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { statfsSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
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

async function main() {
  const root = resolve(process.cwd(), '../..');
  const free = () => { const s = statfsSync(root); return Number(s.bavail) * Number(s.bsize); };
  if (free() < 4 * 1024 ** 3) throw new Error('Need 4 GiB before browser stack');
  process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/aise_phase2_test');
  process.env.ADMIN_MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const out = process.env.TOUCH_AUDIT_OUT;
  const allow = Number(process.env.TOUCH_AUDIT_ALLOW || 0);
  const stamp = `touch-${Date.now()}`;
  const password = 'Touch-Local-1!';
  const em = { super: `${stamp}-super@example.com`, emp: `${stamp}-emp@example.com`, cand: `${stamp}-cand@example.com` };
  const env = await startPhase2App({ native: true, retention: true });
  let web: ChildProcess | undefined, browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  const logPath = `/tmp/${stamp}-next.log`;
  const log = openSync(logPath, 'w', 0o600);
  const monitor = setInterval(() => { if (free() < 1.5 * 1024 ** 3) { web?.kill('SIGTERM'); void browser?.close(); } }, 5000);
  const all: (TargetFinding & { page: string; width: number })[] = [];
  const perPage: Record<string, { measured: number; inline: number }> = {};
  const overflow: string[] = [];
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
      const captured = env.emails.getCapturedEmails().filter((m) => m.to === email).at(-1)!;
      const token = new URL(/href="([^"]+)"/.exec(captured.html)![1]).searchParams.get('token');
      assert.ok((await post(`/${kind}/verify-email`, { token })).ok);
    };
    await registered('business/auth', em.emp, `Touch Employer ${stamp}`);
    await registered('auth', em.cand);
    const company = await env.prisma.company.findFirstOrThrow({ where: { business: { email: em.emp } } });
    await env.prisma.company.update({ where: { id: company.id }, data: { status: 'APPROVED' } });
    const vacancy = await env.prisma.vacancy.create({ data: { companyId: company.id, title: `Touch Role ${stamp}`, description: 'Synthetic', location: 'Bakı', status: 'ACTIVE', questions: { create: [{ label: 'Motivasiya', type: 'SHORT_TEXT', required: false, order: 0 }] } } });
    // States that only exist with data: a saved job/search, a notification, a pending company, a second operator with an invitation and a second session.
    await registered('business/auth', `${stamp}-pending@example.com`, `Touch Pending ${stamp}`);
    const superUser = await env.prisma.adminUser.create({ data: { email: em.super, hashedPassword: await bcrypt.hash(password, 10), role: 'SUPER_ADMIN' } });
    const superToken = randomBytes(32).toString('hex');
    await env.prisma.adminSession.create({ data: { sessionToken: superToken, adminUserId: superUser.id, expires: new Date(Date.now() + 3_600_000), mfaVerified: true } });

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || CFT });
    const context = async () => {
      const c = await browser!.newContext({ viewport: { width: 1280, height: 900 } });
      contexts.push(c);
      await c.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      await c.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
      return c;
    };
    const cand = await (await context()).newPage();
    cand.setDefaultTimeout(30000);
    await cand.goto(`${WEB}/login`);
    await cand.locator('#email').fill(em.cand);
    await cand.locator('#password').fill(password);
    await cand.getByRole('button', { name: 'Daxil ol' }).click();
    await cand.getByRole('heading', { name: 'CV-nizi yükləyin' }).waitFor();
    await cand.locator('input[type=file]').setInputFiles({ name: 'cv.docx', mimeType: DOCX, buffer: docx(`TOUCH-${stamp}`, 'Nigar Hasanova') });
    await cand.getByRole('heading', { name: 'Məlumatlarınızı yoxlayın' }).waitFor();
    await cand.getByPlaceholder('məs. TypeScript').fill('TypeScript');
    await cand.getByPlaceholder('məs. TypeScript').press('Enter');
    await cand.getByRole('button', { name: 'Davam et' }).click();
    await cand.getByRole('button', { name: 'Tamamla' }).click();
    await cand.waitForURL((u) => u.pathname === '/dashboard');
    const user = await env.prisma.user.findUniqueOrThrow({ where: { email: em.cand } });
    await env.prisma.savedJob.create({ data: { userId: user.id, vacancyId: vacancy.id } });
    await env.prisma.savedSearch.create({ data: { userId: user.id, name: 'Touch search', criteria: { q: 'Touch' }, fingerprint: `fp-${stamp}` } });
    await env.prisma.notification.create({ data: { userId: user.id, type: 'NEW_JOB', message: 'Yeni vakansiya: Touch', payload: { ref: `native:${vacancy.id}`, jobId: vacancy.id } } });
    const second = await env.prisma.adminUser.create({ data: { email: `${stamp}-second@example.com`, hashedPassword: await bcrypt.hash(password, 10), role: 'SUPPORT' } });
    await env.prisma.adminSession.create({ data: { sessionToken: randomBytes(32).toString('hex'), adminUserId: superUser.id, expires: new Date(Date.now() + 3_600_000), mfaVerified: true, userAgent: 'second browser' } });
    await env.prisma.adminInvitation.create({ data: { kind: 'INVITE', email: `${stamp}-invited@example.com`, role: 'SUPPORT', tokenHash: randomBytes(16).toString('hex'), invitedById: superUser.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    void second;
    const application = await env.prisma.application.create({ data: { vacancyId: vacancy.id, userId: user.id, files: { create: [{ fieldName: 'resume', fileUrl: '/uploads/none.docx', originalName: 'CV', mimeType: DOCX }] } } });

    const emp = await (await context()).newPage();
    emp.setDefaultTimeout(30000);
    await emp.goto(`${WEB}/business/login`);
    await emp.locator('input[type=email]').fill(em.emp);
    await emp.locator('input[type=password]').fill(password);
    await emp.getByRole('button', { name: 'Daxil ol' }).click();
    await emp.waitForURL((u) => u.pathname === '/business/dashboard');

    const adminCtx = await context();
    await adminCtx.addCookies([{ name: 'admin_session', value: superToken, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    const admin = await adminCtx.newPage();
    admin.setDefaultTimeout(30000);
    const anon = await (await context()).newPage();
    anon.setDefaultTimeout(30000);

    const surfaces: [string, Page, string][] = [
      ['public', anon, '/'], ['public', anon, '/jobs'], ['public', anon, '/pricing'], ['public', anon, '/login'], ['public', anon, '/register'], ['public', anon, '/business/login'], ['public', anon, '/contact'],
      ['public', anon, `/jobs/native/${vacancy.id}`],
      ['candidate', cand, '/dashboard'], ['candidate', cand, '/dashboard/saved'], ['candidate', cand, '/dashboard/companies'], ['candidate', cand, '/dashboard/matches'], ['candidate', cand, '/dashboard/applications'],
      ['candidate', cand, '/dashboard/notifications'], ['candidate', cand, '/dashboard/settings'], ['candidate', cand, '/dashboard/profile'], ['candidate', cand, '/dashboard/resumes'],
      ['candidate', cand, `/dashboard/companies/${company.id}/vacancies/${vacancy.id}/apply`],
      ['employer', emp, '/business/dashboard'], ['employer', emp, '/business/vacancies'], ['employer', emp, '/business/vacancies/new'], ['employer', emp, `/business/vacancies/${vacancy.id}/edit`],
      ['employer', emp, '/business/applications'], ['employer', emp, `/business/applications/${application.id}`], ['employer', emp, '/business/company'], ['employer', emp, '/business/settings'],
      ...['overview', 'businesses', 'users', 'listings', 'applications', 'operations', 'sources', 'email', 'audit', 'system', 'operators', 'account'].map((p) => ['admin', admin, `/admin/${p}`] as [string, Page, string]),
    ];
    for (const w of WIDTHS) {
      for (const [who, page, path] of surfaces) {
        await page.setViewportSize({ width: w, height: 844 });
        await page.goto(`${WEB}${path}`);
        await page.waitForLoadState('domcontentloaded');
        await page.locator('h1, h2').first().waitFor().catch(() => undefined);
        await page.waitForTimeout(450);
        if (new URL(page.url()).pathname !== path.split('?')[0]) { console.log(`NOTE ${who} ${path} redirected to ${new URL(page.url()).pathname}`); }
        const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (ov > 1) overflow.push(`${who} ${path} @${w}: ${ov}px horizontal overflow`);
        const a = await auditTargets(page);
        const key = `${who} ${path.replace(/c[a-z0-9]{20,}/g, ':id')} @${w}`;
        perPage[key] = { measured: a.measured, inline: a.inline };
        for (const f of a.offenders) all.push({ ...f, page: `${who} ${path.replace(/c[a-z0-9]{20,}/g, ':id')}`, width: w });
      }
    }
    const measured = Object.values(perPage).reduce((s, p) => s + p.measured, 0);
    const inline = Object.values(perPage).reduce((s, p) => s + p.inline, 0);
    const groups = new Map<string, { n: number; pages: Set<string>; sample: string; min: string }>();
    for (const f of all) {
      const k = signature(f);
      const g = groups.get(k) ?? { n: 0, pages: new Set(), sample: f.name, min: `${f.hitW}x${f.hitH}` };
      g.n += 1; g.pages.add(f.page); groups.set(k, g);
    }
    const uniqueControls = new Set(all.map((f) => `${f.page}|${f.tag}|${f.name}|${f.where}`)).size;
    console.log(`TOUCH_AUDIT measured=${measured} inlineExempt=${inline} offenderObservations=${all.length} uniqueOffenders=${uniqueControls} causeGroups=${groups.size}`);
    for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 60)) console.log(`  ${String(g.n).padStart(4)} × ${k}  e.g. "${g.sample}" ${g.min}; pages=${g.pages.size}`);
    if (out) writeFileSync(out, JSON.stringify({ measured, inline, offenders: all, overflow }, null, 1));
    for (const o of overflow) console.log(`OVERFLOW ${o}`);
    console.log(`LAYOUT pages×widths=${Object.keys(perPage).length} overflow=${overflow.length}`);
    if (uniqueControls > allow || overflow.length) process.exitCode = 2;
    console.log(uniqueControls > allow ? `TOUCH_AUDIT_FAIL ${uniqueControls} controls below 44px (allowed ${allow})` : `TOUCH_AUDIT_OK ${uniqueControls} below 44px (allowed ${allow})`);
  } finally {
    clearInterval(monitor);
    await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
    await browser?.close();
    if (web && web.exitCode === null) { web.kill('SIGTERM'); await new Promise<void>((r) => web!.once('exit', () => r())); }
    closeSync(log);
    const users = await env.prisma.user.findMany({ where: { email: em.cand }, include: { resumes: true } });
    const ids = users.map((u) => u.id);
    await env.prisma.application.deleteMany({ where: { userId: { in: ids } } });
    await env.prisma.user.deleteMany({ where: { email: em.cand } });
    await env.prisma.business.deleteMany({ where: { email: { in: [em.emp, `${stamp}-pending@example.com`] } } });
    await env.prisma.adminInvitation.deleteMany({ where: { email: `${stamp}-invited@example.com` } });
    await env.prisma.adminUser.deleteMany({ where: { email: { in: [em.super, `${stamp}-second@example.com`] } } });
    const storage = env.app.get(require('../src/resumes/local-storage.service').LocalStorageService);
    for (const u of users) for (const r of u.resumes) if (r.fileUrl) await storage.deleteFile(r.fileUrl);
    await env.close();
    console.log(`Browser free disk: ${(free() / 1024 ** 3).toFixed(2)} GiB; Next log: ${logPath}`);
  }
}
main().catch((e) => { console.error('TOUCH_AUDIT_FAILED', e.message); process.exitCode = 1; });
