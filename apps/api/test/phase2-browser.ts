/** Run from apps/api with ts-node. Uses aise_phase2_test only; starts and
 * stops its own Next/Nest processes. No real source, scoring model or mail. */
import { startPhase2App, fixtureSummary, fixtureDetail } from './support/phase2-local-app';
import { chromium, type Browser } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { statfsSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

async function main() {
  const root = resolve(process.cwd(), '../..');
  const free = () => { const s = statfsSync(root); return Number(s.bavail) * Number(s.bsize); };
  if (free() < 5 * 1024 ** 3) throw new Error('Need at least 5 GiB before browser stack');
  const stamp = `phase2-browser-${Date.now()}`;
  const email = `${stamp}@example.com`, password = 'Local-Phase2-Browser!';
  const env = await startPhase2App();
  let web: ChildProcess | undefined, browser: Browser | undefined;
  const logPath = `/tmp/${stamp}-next.log`, screenshot = `/tmp/${stamp}-matches.png`;
  const log = openSync(logPath, 'w', 0o600);
  let resourceStop = false;
  const monitor = setInterval(() => {
    if (free() < 2 * 1024 ** 3) { resourceStop = true; web?.kill('SIGTERM'); void browser?.close(); }
  }, 5000);
  try {
    await env.app.listen(4010, '127.0.0.1');
    const records = [fixtureSummary(`${stamp}-baku`, 'TypeScript Bakı', 'Bakı'), fixtureSummary(`${stamp}-ganja`, 'TypeScript Gəncə', 'Gəncə'), fixtureSummary(`${stamp}-remote`, 'TypeScript Uzaqdan', 'Uzaqdan')];
    assert.equal((await env.importFixtures([records], Object.fromEntries(records.map((r) => [r.slug, fixtureDetail(r.title, 'TypeScript PostgreSQL — synthetic rehearsal posting', r.location)])))).status, 'SUCCEEDED');
    await env.settle();
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
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(25000);
    await page.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      return ['127.0.0.1','localhost'].includes(host) ? route.continue() : route.abort();
    });
    await page.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
    await page.goto('http://127.0.0.1:3450/register');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('#confirm-password').fill(password);
    await page.getByRole('button', { name: 'Hesab yarat' }).click();
    await page.getByText('ünvanı üçün hesab yaradıldı').waitFor();
    const mail = env.emails.getCapturedEmails().filter((m) => m.to === email).pop()!;
    const href = /href="([^"]+)"/.exec(mail.html)![1];
    await page.goto(href);
    await page.getByText(/təsdiqləndi/i).waitFor();
    await page.goto('http://127.0.0.1:3450/login');
    await page.locator('#email').fill(email); await page.locator('#password').fill(password);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await page.waitForFunction(async (expectedEmail) => {
      const current = await (await fetch('/api/auth/session')).json();
      return current.user?.email === expectedEmail && typeof current.sessionToken === 'string' && current.sessionToken.length > 0;
    }, email);
    await page.waitForURL((url) => url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/'));
    const session = await page.evaluate(async () => (await fetch('/api/auth/session')).json());
    const headers = { Authorization: `Bearer ${session.sessionToken}`, 'Content-Type': 'application/json' };
    // Initial profile setup uses authenticated API; correction below uses the UI.
    assert.equal((await fetch('http://127.0.0.1:4010/profile', { method: 'PATCH', headers, body: JSON.stringify({ name: 'Phase Two Fixture', headline: 'TypeScript engineer', skills: ['TypeScript'], location: 'Bakı' }) })).status, 200);
    assert.equal((await fetch('http://127.0.0.1:4010/profile/complete-onboarding', { method: 'POST', headers })).status, 201);
    await env.settle();
    await page.goto('http://127.0.0.1:3450/dashboard/matches');
    await page.getByRole('heading', { name: 'TypeScript Bakı', exact: true }).waitFor();
    assert.equal(await page.locator('h2').count(), 3);
    await page.getByRole('searchbox').fill('no-such-job');
    await page.getByText('Heç bir uyğun vakansiya tapılmadı.').waitFor();
    await page.getByRole('searchbox').fill('TypeScript');
    await page.getByLabel('Məkan', { exact: true }).selectOption('Gəncə');
    assert.equal(await page.locator('h2').count(), 1);
    await page.getByRole('heading', { name: 'TypeScript Gəncə' }).click();
    await page.getByText('TypeScript PostgreSQL — synthetic rehearsal posting', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Glorri-də bax' }).getAttribute('href'), `https://jobs.glorri.com/vacancies/aise-fixture/${stamp}-ganja?isLocal=true`);
    await page.getByText(/Mənbədə son görünmə/).waitFor();
    await page.locator('div.space-y-8.max-w-4xl').screenshot({ path: screenshot });
    console.log('PASS browser import → matching → search/location → source, freshness and details');
    await page.goto('http://127.0.0.1:3450/dashboard/profile');
    const headlineInput = page.getByPlaceholder('məs. Senior Software Engineer / React Expert');
    await headlineInput.fill('PostgreSQL engineer');
    await page.getByRole('button', { name: 'Profili Yadda Saxla', exact: true }).click();
    await page.getByText(/Profil uğurla yadda saxlanıldı/).waitFor();
    await env.settle();
    env.failNextProfileEnqueue();
    await headlineInput.fill('PostgreSQL queue retry');
    await page.getByRole('button', { name: 'Profili Yadda Saxla', exact: true }).click();
    await page.getByText(/Profil yadda saxlanıldı, lakin uyğun iş axtarışı başlaya bilmədi/).waitFor();
    await page.getByRole('button', { name: 'Profili Yadda Saxla', exact: true }).click();
    await page.getByText(/Uyğun iş axtarışı növbəyə əlavə edildi/).waitFor();
    await env.settle();
    console.log('PASS browser saved profile survives queue failure, reports it and allows retry');
    await page.goto('http://127.0.0.1:3450/dashboard/matches');
    await page.getByText('91% Uyğunluq').first().waitFor();
    console.log('PASS browser profile correction → queued re-match → refreshed scores (fixture scorer)');
    await page.getByRole('heading', { name: 'TypeScript Bakı', exact: true }).click();
    await page.getByRole('button', { name: 'Müraciət etdim', exact: true }).click();
    await env.prisma.job.update({ where: { externalId: `glorri:${stamp}-baku` }, data: { status: 'CLOSED', closedAt: new Date() } });
    await page.getByRole('button', { name: 'Yenilə', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'artıq aktiv deyil' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'CV-ni Fərdiləşdir', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('link', { name: 'Glorri-də bax' }).count(), 0);
    await page.reload();
    await page.getByRole('heading', { name: 'TypeScript Bakı', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'artıq aktiv deyil' }).waitFor();
    // Recovery from a browser-side API failure, followed by a real successful fetch.
    await page.route('http://127.0.0.1:4010/matches', (route) => route.abort(), { times: 1 });
    await page.getByRole('button', { name: 'Yenilə', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /\S/ }).waitFor();
    await page.getByRole('button', { name: 'Yenilə', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /\S/ }).waitFor({ state: 'hidden' });
    console.log('PASS browser closed application history, disabled actions, refresh persistence and fetch retry');
    console.log(`Evidence screenshot: ${screenshot}`);
    if (resourceStop) throw new Error('Disk threshold stopped browser work');
  } finally {
    clearInterval(monitor);
    await browser?.close();
    if (web && web.exitCode === null) { web.kill('SIGTERM'); await new Promise<void>((r) => web!.once('exit', () => r())); }
    closeSync(log);
    await env.settle();
    await env.prisma.user.deleteMany({ where: { email } });
    await env.prisma.job.deleteMany({ where: { externalId: { startsWith: `glorri:${stamp}` } } });
    await env.close();
    console.log(`Free disk after browser: ${(free() / 1024 ** 3).toFixed(2)} GiB. Next log: ${logPath}`);
  }
}
main().catch((error) => { console.error('PHASE2_BROWSER_FAILED', error.message); process.exitCode = 1; });
