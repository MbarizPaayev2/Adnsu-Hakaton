/** Local landing QA. Requires an already-running preview; never starts a backend.
 * HOME_PREVIEW_URL=http://127.0.0.1:3470 HOME_EVIDENCE_DIR=/tmp/aise-home node scripts/verify-home.mjs
 * CHROMIUM_PATH optionally supplies an installed browser. No browser downloads.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const base = process.env.HOME_PREVIEW_URL || 'http://127.0.0.1:3470';
const out = process.env.HOME_EVIDENCE_DIR || '/tmp/aise-home-evidence';
const cachedMac = `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const executablePath = process.env.CHROMIUM_PATH || (process.platform === 'darwin' ? cachedMac : undefined);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath });
const evidence = { base, kind: 'real-browser frontend verification; no backend or sending proof', measurements: [], checks: [] };
const errors = [];
try {
  for (const width of [320, 390, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 960 }, reducedMotion: 'reduce' });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
    await page.goto(base, { waitUntil: 'networkidle' });
    const measurements = await page.evaluate(() => {
      const clippedControls = [...document.querySelectorAll('main a, main button, main input, header a, header button')].filter((element) => {
        const r = element.getBoundingClientRect();
        return r.width && r.height && (r.left < -1 || r.right > innerWidth + 1);
      }).map((element) => element.textContent.trim());
      const cta = [...document.querySelectorAll('main a')].find((a) => a.textContent.includes('Vakansiyalara bax')).getBoundingClientRect();
      const preview = document.querySelector('[aria-live="polite"][aria-atomic="true"]').getBoundingClientRect();
      const choices = document.querySelector('[aria-label="Nümunə iş sahəsini seç"]').getBoundingClientRect();
      return {
        width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight, clippedControls,
        primaryAboveFold: cta.bottom < innerHeight, primaryHeight: cta.height,
        previewOverlapsChoices: preview.bottom > choices.top,
        animations: document.getAnimations().filter((a) => a.playState === 'running').length,
      };
    });
    assert.equal(measurements.scrollWidth, width, `overflow at ${width}`);
    assert.deepEqual(measurements.clippedControls, [], `clipped controls at ${width}`);
    assert.ok(measurements.primaryAboveFold, `primary action below fold at ${width}`);
    assert.ok(measurements.primaryHeight >= 44);
    assert.equal(measurements.previewOverlapsChoices, false, `preview overlaps selector at ${width}`);
    assert.equal(measurements.animations, 0, 'reduced motion');
    evidence.measurements.push(measurements);
    await page.getByRole('group', { name: 'Nümunə iş sahəsini seç' }).getByRole('button', { name: 'Maliyyə' }).click();
    await page.getByRole('heading', { name: 'Maliyyə analitiki' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Bu sahədə işlər' }).getAttribute('href'), '/jobs?category=finance');
    await page.getByRole('group', { name: 'Nümunə iş sahəsini seç' }).getByRole('button', { name: 'Texnologiya' }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: join(out, `landing-${width}.png`), fullPage: true });
    if (width === 390 || width === 1440) await page.screenshot({ path: join(out, `hero-${width}.png`) });
    if (width < 900) {
      const toggle = page.getByRole('button', { name: 'Menyunu aç' });
      await toggle.click();
      await page.getByRole('navigation', { name: 'Mobil menyu' }).getByRole('link', { name: 'Daxil ol' }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await toggle.evaluate((e) => e === document.activeElement), true);
    }
    await page.close();
  }
  evidence.checks.push('five widths: public CTA visible, no clipping/overflow, example switches, reduced motion, mobile Escape/focus');
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('dialog', { name: 'Kuki razılığı' }).waitFor();
  await page.getByRole('button', { name: 'Yalnız zəruri' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('aise-cookie-consent')), 'denied');
  await page.keyboard.press('Tab');
  // Navigation target only: intercept the catalogue document to avoid depending on another agent's API.
  await page.route('**/jobs?**', (route) => route.fulfill({ contentType: 'text/html', body: '<main>Search navigation verified</main>' }));
  await page.getByRole('searchbox', { name: 'Vəzifə və ya şirkət axtar' }).fill('mühasib');
  await Promise.all([page.waitForURL((url) => url.pathname === '/jobs'), page.getByRole('button', { name: 'Vakansiya axtar' }).click()]);
  assert.equal(new URL(page.url()).searchParams.get('q'), 'mühasib');
  evidence.checks.push('existing cookie refusal preserved; search submits encoded GET query (destination intercepted)');
  await page.close();
  assert.deepEqual(errors, [], 'browser runtime errors');
  await writeFile(join(out, 'verification.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}
