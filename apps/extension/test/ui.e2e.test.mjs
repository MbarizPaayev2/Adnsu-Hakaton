// The candidate's journey through the real dashboard (Next.js production build) with the real extension, API and a Lever-shaped fixture:
// pairing code → pair → campaign consent → vacancy found → form read → candidate answers → approval → portal confirmation → timeline → revoke.
// Also: keyboard operation, accessible names, mobile layout, and screenshots for review (SHOTS_DIR).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startHarness, waitFor, sleep, WEB_PORT } from './harness.mjs';

let H; const WEB = `http://127.0.0.1:${WEB_PORT}`;
const SHOTS = process.env.SHOTS_DIR || '/tmp/aise-agent-shots'; fs.mkdirSync(SHOTS, { recursive: true });
before(async () => { H = await startHarness({ scenarios: { 21: { extraQuestion: true } }, web: true }); });
after(async () => { await H?.close(); });

async function login(page, c) {
  await page.goto(`${WEB}/login`);
  const cookie = page.getByRole('button', { name: /Yalnız zəruri/ }); if (await cookie.isVisible().catch(() => false)) await cookie.click();
  await page.getByLabel(/E-poçt/).fill(c.email); await page.getByLabel(/Şifrə/).first().fill('Ui-Test-Password-1');
  await page.getByRole('button', { name: /Daxil ol/ }).click();
  await page.waitForURL(/dashboard/, { timeout: 30000 });
}
const noOverflow = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const unnamed = async (page) => page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), select, textarea, button')].filter((el) => el.checkVisibility()).filter((el) => { // controls inside a closed <details> are not rendered (and have no innerText) until it opens
  const name = el.getAttribute('aria-label') || (el.labels && [...el.labels].map((l) => l.innerText).join('')) || el.innerText || el.getAttribute('title') || el.getAttribute('aria-labelledby');
  return !String(name || '').trim();
}).map((el) => el.outerHTML.slice(0, 80)));
const small = async (page) => page.evaluate(() => [...document.querySelectorAll('button, a[href], input[type=submit]')].filter((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.height < 40 && !el.closest('nav') && el.tagName !== 'A'; }).map((el) => `${el.innerText.slice(0, 30)} ${Math.round(el.getBoundingClientRect().height)}px`));

test('dashboard journey with the real extension, plus keyboard, accessibility and mobile checks', { timeout: 600000 }, async () => {
  const c = await H.candidate('Leyla Hüseynova', { password: 'Ui-Test-Password-1' });
  const job = await H.posting(21, c.id);
  const page = await H.context.newPage(); await page.setViewportSize({ width: 1100, height: 900 });
  await login(page, c);

  // hub, before any campaign (the extension is installed in this browser but not paired yet)
  await H.sw.evaluate(() => chrome.storage.local.clear());
  await page.goto(`${WEB}/dashboard/agent`);
  try { await page.getByRole('heading', { name: 'Brauzer köməkçisi' }).waitFor({ timeout: 15000 }); } catch (e) { console.log('URL', page.url(), '\nTEXT', (await page.innerText('body')).slice(0, 600), '\nAPI', H.apiLog().slice(-800)); throw e; }
  assert.ok(await page.getByText('Real göndəriş hələ təsdiqlənməyib').isVisible(), 'the portal is shown as unverified for live submission');
  assert.ok(await page.getByText(/Glorri və digər işəgötürən formalarında yalnız boş ad/).isVisible(), 'on Glorri the assistant only fills empty identity fields');
  // The extension's one-click bridge runs only on aisehr.com (covered by bridge.e2e.test.mjs); this page is served from 127.0.0.1, so it shows the install steps.
  await page.getByRole('button', { name: /AISE Agent faylını yüklə/ }).waitFor({ timeout: 15000 });
  assert.equal(await page.getByText(/Pack extension/).count(), 0, 'no packing instructions');
  await page.screenshot({ path: path.join(SHOTS, '01-hub-empty.png'), fullPage: true });
  assert.deepEqual(await unnamed(page), []);

  // pairing with the manual code (the fallback), completed in the extension's own popup
  await page.getByText(/Kodu əl ilə yazmaq/).click();
  await page.getByRole('button', { name: 'Cütləmə kodu yarat' }).click();
  const code = (await page.locator('strong.font-mono').textContent()).trim();
  assert.match(code, /^[A-Z0-9]{8}$/);
  const popup = await H.context.newPage(); await popup.goto(H.popupUrl());
  await popup.fill('#code', code); await popup.click('#pair');
  await waitFor(async () => popup.locator('#paired').isVisible(), { what: 'extension paired' });
  await page.getByText(/(Chrome|Chromium) · /).first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(SHOTS, '01b-hub-paired.png'), fullPage: true });

  // campaign: form → consent review → acknowledgement → create, operated from the keyboard where it matters
  await page.getByRole('link', { name: /Yeni müraciət icazəsi/ }).click();
  await page.getByRole('heading', { name: 'Yeni müraciət icazəsi' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#cv option').length > 1);
  await page.getByLabel('İcazənin adı').fill('QA at Xsolla');
  await page.getByLabel(/İcazə verilən işəgötürənlər/).fill('xsolla');
  await page.getByLabel('Hədəf vəzifələr').fill('qa engineer');
  await page.getByLabel(/Göndəriləcək təsdiqlənmiş CV/).selectOption({ index: 1 });
  await page.getByLabel('LinkedIn ünvanı').fill('https://www.linkedin.com/in/leyla-huseynova');
  await page.getByLabel(/Vakansiyanın yerləşdiyi ölkədə/).selectOption('yes');
  await page.waitForFunction(() => !!document.querySelector('#ph')?.value, null, { timeout: 15000 }); // the profile arrives after the form
  assert.equal(await page.getByLabel('Telefon', { exact: true }).inputValue(), '+994501234567', 'the phone comes from the profile');
  await page.screenshot({ path: path.join(SHOTS, '02-campaign-form.png'), fullPage: true });
  assert.deepEqual(await unnamed(page), [], 'every control has an accessible name');
  await page.getByRole('button', { name: 'Nəzərdən keçir' }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Razılığınızı yoxlayın' }).waitFor();
  const create = page.getByRole('button', { name: /Razıyam, icazəni başlat/ });
  assert.equal(await create.isDisabled(), true, 'consent cannot be created before it is acknowledged');
  await page.screenshot({ path: path.join(SHOTS, '03-consent-review.png'), fullPage: true });
  await page.getByRole('checkbox').focus(); await page.keyboard.press('Space');
  await create.focus(); await page.keyboard.press('Enter');
  await page.waitForURL(/\/dashboard\/agent$/);
  await page.getByText('QA at Xsolla').first().waitFor();

  // the browser extension finds the vacancy and reads the real form; the candidate is asked the one question it could not answer
  await popup.click('#poll');
  const app = await waitFor(async () => { const a = await H.appFor(c.id, job.id); return a && a.state === 'AWAITING_INPUT' ? a : null; }, { timeout: 90000, what: 'form read, question asked' });
  await page.goto(`${WEB}/dashboard/agent/applications/${app.id}`);
  await page.getByRole('heading', { name: 'Forma bunları soruşur' }).waitFor();
  await page.getByLabel(/Which test automation tools/).fill('Playwright, Cypress');
  await page.screenshot({ path: path.join(SHOTS, '04-application-question.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cavabları saxla' }).click();
  await page.getByRole('heading', { name: 'Göndərməzdən əvvəl təsdiq' }).waitFor();
  assert.equal(H.lever.received.length, 0, 'nothing is submitted before approval');
  await page.screenshot({ path: path.join(SHOTS, '05-application-approval.png'), fullPage: true });
  await page.getByRole('button', { name: 'Planı təsdiqləyirəm' }).click();
  await popup.click('#poll');
  await page.getByText(/portalın təsdiq səhifəsi saxlanıldı/).first().waitFor({ timeout: 120000 });
  await page.screenshot({ path: path.join(SHOTS, '06-application-submitted.png'), fullPage: true });
  assert.equal(H.lever.received.length, 1);

  // the timeline page shows the browser application with portal-confirmed wording
  await page.goto(`${WEB}/dashboard/applications`);
  await page.getByRole('heading', { name: 'Brauzer köməkçisi ilə' }).waitFor();
  assert.ok(await page.getByText(/portalın təsdiq səhifəsi saxlanıldı/).first().isVisible());
  await page.screenshot({ path: path.join(SHOTS, '07-timeline.png'), fullPage: true });

  // mobile layout and touch targets on every agent page
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [name, url] of [['hub', '/dashboard/agent'], ['detail', `/dashboard/agent/applications/${app.id}`], ['new', '/dashboard/agent/campaigns/new'], ['timeline', '/dashboard/applications']]) {
    await page.goto(`${WEB}${url}`); await page.waitForLoadState('networkidle');
    assert.equal(await noOverflow(page), true, `${name}: no horizontal scrolling at 375px`);
    assert.deepEqual(await small(page), [], `${name}: buttons are at least 40px tall`);
    await page.screenshot({ path: path.join(SHOTS, `08-mobile-${name}.png`), fullPage: true });
  }

  // revoking consent from the hub
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(`${WEB}/dashboard/agent`);
  await page.getByRole('button', { name: 'Razılığı geri götür' }).click();
  await page.getByRole('alertdialog').waitFor();
  await page.screenshot({ path: path.join(SHOTS, '09-revoke-confirm.png'), fullPage: true });
  await page.getByRole('button', { name: 'Bəli, dayandır' }).click();
  await page.getByText(/Razılıq geri götürüldü/).waitFor();
  const camp = (await c.web.get('/agent/campaigns')).body[0]; assert.equal(camp.status, 'REVOKED');
  await popup.close(); await page.close();
});
