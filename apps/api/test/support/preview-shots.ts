/** Screenshots of the running local preview for founder inspection (written outside git). Read-only. */
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { CFT } from './integration-helpers';
import { previewHome } from './preview-config';

const state = JSON.parse(readFileSync(join(previewHome, 'state.json'), 'utf8'));
const cred = JSON.parse(readFileSync(join(previewHome, 'credentials.json'), 'utf8'));
const dir = join(previewHome, 'screenshots');
mkdirSync(dir, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || CFT });
  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
    const p = await ctx.newPage();
    p.setDefaultTimeout(120_000);
    await p.goto(`${state.web}/login`);
    await p.locator('#email').fill(cred.candidate);
    await p.locator('#password').fill(cred.password);
    await p.getByRole('button', { name: 'Daxil ol' }).click();
    await p.waitForFunction(async (e) => (await (await fetch('/api/auth/session')).json()).user?.email === e, cred.candidate);
    await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => undefined);
    await p.goto(`${state.web}/dashboard/resumes`);
    await p.getByTestId('document-allowance-card').waitFor({ timeout: 60_000 }).catch(async (e) => { console.error('url', p.url(), (await p.locator('body').innerText()).slice(0, 400)); throw e; });
    await p.waitForTimeout(800);
    await p.screenshot({ path: join(dir, `documents-${name}.png`), fullPage: true });
    await p.goto(`${state.web}/dashboard`);
    await p.waitForTimeout(2500);
    await p.screenshot({ path: join(dir, `dashboard-${name}.png`), fullPage: false });
    await ctx.close();
  }
  await browser.close();
  console.log(`screenshots in ${dir}`);
})().catch((e) => { console.error(e); process.exit(1); });
