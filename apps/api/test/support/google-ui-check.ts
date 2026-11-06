/** Real-browser check of the Google button on /login and /register (phone and desktop) against the integration stack started with a TEST client id. Nothing contacts Google. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { CFT } from './integration-helpers';

(async () => {
  const stack = JSON.parse(readFileSync(process.env.INTEGRATION_STATE!, 'utf8'));
  const out = process.env.SHOTS || '/tmp/google-ui'; mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: CFT });
  const results: string[] = [];
  for (const [label, viewport] of [['phone', { width: 375, height: 812 }], ['desktop', { width: 1440, height: 900 }]] as const) {
    const ctx = await browser.newContext({ viewport, hasTouch: label === 'phone' });
    await ctx.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
    let googleUrl = '';
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === 'accounts.google.com') { googleUrl = u.toString(); return route.abort(); }
      return ['127.0.0.1', 'localhost'].includes(u.hostname) ? route.continue() : route.abort();
    });
    const page = await ctx.newPage();
    for (const path of ['/login', '/register']) {
      await page.goto(`${stack.web}${path}`);
      const button = page.getByRole('button', { name: 'Google ilə davam et' });
      await button.waitFor({ timeout: 30_000 });
      const box = (await button.boundingBox())!;
      assert.ok(box.height >= 44, `${label} ${path}: touch target ${box.height}px`);
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, `${label} ${path}: the button fits the viewport`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label} ${path}: no horizontal scroll`);
      await page.screenshot({ path: `${out}/${label}${path.replace('/', '-')}.png`, fullPage: true });
      results.push(`${label} ${path}: button ${Math.round(box.width)}x${Math.round(box.height)}px, no horizontal scroll`);
    }
    // the OAuth start: NextAuth builds the Google authorization request (client id, PKCE, state, scopes); the request itself is aborted here
    await page.goto(`${stack.web}/login`);
    await page.getByRole('button', { name: 'Google ilə davam et' }).click();
    await page.waitForFunction(() => true);
    for (let i = 0; i < 40 && !googleUrl; i++) await new Promise((r) => setTimeout(r, 250));
    assert.ok(googleUrl, `${label}: the flow started the Google authorization request`);
    const q = new URL(googleUrl).searchParams;
    assert.equal(q.get('client_id'), 'aise-test-client.apps.googleusercontent.com');
    assert.equal(q.get('response_type'), 'code');
    assert.match(q.get('scope') || '', /openid/);
    assert.ok(q.get('state') && q.get('code_challenge') && q.get('code_challenge_method') === 'S256', 'state and PKCE present');
    assert.match(q.get('redirect_uri') || '', /\/api\/auth\/callback\/google$/);
    assert.equal(q.get('prompt'), 'select_account');
    results.push(`${label}: authorization request carries client_id, openid scope, state, PKCE S256, select_account, callback ${new URL(q.get('redirect_uri')!).pathname}`);
    // a failed/revoked sign-in lands on /login with a plain message and the password form still works
    await page.goto(`${stack.web}/login?error=google_conflict`);
    await page.getByRole('alert').filter({ hasText: 'birmənalı' }).waitFor();
    await page.goto(`${stack.web}/login?error=AccessDenied`);
    await page.getByRole('alert').filter({ hasText: 'Google ilə daxil olmaq mümkün olmadı' }).waitFor();
    assert.ok(await page.getByLabel(/E-poçt/).isVisible());
    results.push(`${label}: revoked/denied/conflicting sign-in shows a plain message and the e-mail form stays usable`);
    await ctx.close();
  }
  await browser.close();
  console.log(results.join('\n'));
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
