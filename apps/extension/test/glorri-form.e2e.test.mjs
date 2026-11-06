// Real Chromium with saved, stripped Glorri form fixtures; no live employer traffic.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { fillIdentity } from '../lib/assisted-form.js';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
const profile = { name: 'AISE Synthetic Candidate', email: 'candidate@example.invalid', phone: '+994501234567', letter: 'Bu, yalnız yerli sınaq üçün təsdiqlənmiş məktubdur.' };
async function fixture(name) {
  const page = await browser.newPage();
  const requests = [];
  await page.route('**/*', async (route) => {
    if (route.request().method() !== 'GET') requests.push(route.request().method());
    await route.fulfill({ contentType: 'text/html', body: fs.readFileSync(new URL(`fixtures/glorri/${name}.html`, import.meta.url), 'utf8') });
  });
  await page.goto('https://fixture.glorri.invalid/apply');
  return { page, requests };
}
for (const name of ['step1-personal-yelo', 'step1-personal-unibank']) {
  test(`${name}: fills empty identity fields, preserves existing values and never uploads or submits`, async () => {
    const { page, requests } = await fixture(name);
    try {
      const result = await page.evaluate(fillIdentity, profile);
      assert.equal(result.ok, true);
      assert.equal(result.submitted, false);
      assert.ok(result.filled.length >= 3);
      const values = await page.locator('[data-aise-filled]').evaluateAll((nodes) => nodes.map((node) => node.value));
      assert.ok(values.includes(profile.email));
      assert.ok(values.some((v) => String(v).replace(/\D/g, '').includes('501234567')));
      const original = await page.locator('[data-aise-filled]').first().inputValue();
      await page.evaluate(fillIdentity, { ...profile, name: 'Replacement Name' });
      assert.equal(await page.locator('[data-aise-filled]').first().inputValue(), original);
      assert.equal(await page.locator('input[type=file]').evaluateAll((nodes) => nodes.some((node) => node.files.length > 0)), false);
      assert.deepEqual(requests, []);
    } finally { await page.close(); }
  });
}
test('Glorri letter: fills only an approved letter and does not replace candidate edits', async () => {
  const { page, requests } = await fixture('step-letter-yelo');
  try {
    const missing = await page.evaluate(fillIdentity, { ...profile, letter: undefined });
    assert.equal(missing.letterMissing, true);
    assert.equal(await page.locator('textarea').inputValue(), '');
    await page.evaluate(fillIdentity, profile);
    assert.equal(await page.locator('textarea').inputValue(), profile.letter);
    await page.locator('textarea').fill('Candidate revision');
    await page.evaluate(fillIdentity, profile);
    assert.equal(await page.locator('textarea').inputValue(), 'Candidate revision');
    assert.deepEqual(requests, []);
  } finally { await page.close(); }
});
for (const name of ['step-recommenders-yelo', 'step-experience-yelo']) {
  test(`${name}: never treats a referee or work-history field as candidate identity`, async () => {
    const { page, requests } = await fixture(name);
    try {
      const result = await page.evaluate(fillIdentity, profile);
      assert.deepEqual(result.filled, []);
      assert.equal(result.submitted, false);
      assert.deepEqual(requests, []);
    } finally { await page.close(); }
  });
}

test('an empty phone mask is filled while an actual partial number is preserved', async () => {
  const page = await browser.newPage();
  try {
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<form><label>Mobil nömrə<input name="phoneNumber" value="(__) ___-__-__"></label><span>+994</span></form>' }));
    await page.goto('https://fixture.glorri.invalid/apply');
    let result = await page.evaluate(fillIdentity, profile);
    assert.ok(result.filled.includes('Telefon'));
    assert.equal(await page.locator('input').inputValue(), '501234567');
    await page.locator('input').fill('(55) 123-__-__');
    result = await page.evaluate(fillIdentity, profile);
    assert.equal(await page.locator('input').inputValue(), '(55) 123-__-__');
    assert.deepEqual(result.filled, []);
    await page.locator('input').fill('+994 (__) ___-__-__');
    result = await page.evaluate(fillIdentity, profile);
    assert.ok(result.filled.includes('Telefon'));
  } finally { await page.close(); }
});
