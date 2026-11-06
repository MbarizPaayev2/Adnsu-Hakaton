// One-click pairing from AISE's assistant page: the real extension's bridge content script on an aisehr.com page, the real API and its database.
// The page sees only the extension's version and pairing state; it can hand over a code, never take a token, and cannot re-pair a paired browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startHarness, waitFor } from './harness.mjs';

const MANIFEST = JSON.parse(fs.readFileSync(path.resolve(new URL('..', import.meta.url).pathname, 'manifest.json'), 'utf8'));
let H;
before(async () => { H = await startHarness(); });
after(async () => { await H?.close(); });

// What apps/web/src/lib/extension-bridge.ts does, run inside the page.
const ask = (page, msg, want, timeout = 5000) => page.evaluate(({ msg, want, timeout }) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(null), timeout);
  window.addEventListener('message', function on(e) {
    if (e.source !== window || !e.data || e.data.source !== 'aise-extension' || e.data.type !== want) return;
    if (msg.nonce && e.data.nonce !== msg.nonce) return;
    clearTimeout(t); window.removeEventListener('message', on); resolve(e.data);
  });
  window.postMessage({ source: 'aise-web', ...msg }, location.origin);
}), { msg, want, timeout });

test('the assistant page sees the installed version, pairs this browser in one click, and cannot re-pair it', { timeout: 120000 }, async () => {
  await waitFor(() => H.sw.evaluate(() => !!(globalThis.chrome && chrome.storage)), { what: 'extension worker ready' });
  await H.sw.evaluate(() => chrome.storage.local.clear());
  const page = await H.context.newPage();
  await page.goto('https://aisehr.com/dashboard/agent');
  const hello = await ask(page, { type: 'ping' }, 'hello');
  assert.deepEqual(hello, { source: 'aise-extension', type: 'hello', version: MANIFEST.version, paired: false });

  const c = await H.candidate('Bridge Namizəd');
  const code = (await c.web.post('/agent/pairing')).body.code;
  const result = await ask(page, { type: 'pair', code, nonce: 'n1' }, 'pair-result', 20000);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(JSON.stringify(result).includes('aat_'), false, 'the device token never reaches the page');
  const device = await waitFor(async () => (await H.prisma.agentDevice.findMany({ where: { userId: c.id } }))[0], { what: 'device row' });
  assert.equal(device.extensionVersion, MANIFEST.version);
  assert.match(device.name, /^(Chrome|Chromium|Microsoft Edge) · /);
  assert.equal((await ask(page, { type: 'ping' }, 'hello')).paired, true);
  const listed = (await c.web.get('/agent/devices')).body;
  assert.equal(listed[0].extensionVersion, MANIFEST.version);

  // Another account's code from a page does not take over a paired browser.
  const other = await H.candidate('Başqa Namizəd');
  const code2 = (await other.web.post('/agent/pairing')).body.code;
  const refused = await ask(page, { type: 'pair', code: code2, nonce: 'n2' }, 'pair-result', 20000);
  assert.equal(refused.ok, false); assert.match(refused.error, /ALREADY_PAIRED/);
  assert.equal(await H.prisma.agentDevice.count({ where: { userId: other.id } }), 0);
  await page.close();
});

test('only the page itself is heard, and only on the assistant page', { timeout: 60000 }, async () => {
  await H.sw.evaluate(() => chrome.storage.local.clear());
  const page = await H.context.newPage();
  await page.goto('https://aisehr.com/dashboard/agent');
  const c = await H.candidate('Frame Namizəd');
  const code = (await c.web.post('/agent/pairing')).body.code;
  // A frame inside the page (here same-origin, the most trusted kind) is not the page: its messages are ignored.
  await page.evaluate(() => new Promise((resolve) => { const f = document.createElement('iframe'); f.srcdoc = '<p>frame</p>'; f.onload = resolve; document.body.append(f); }));
  const framed = await page.frames()[1].evaluate((code) => new Promise((resolve) => {
    parent.postMessage({ source: 'aise-web', type: 'pair', code, nonce: 'g' }, '*');
    parent.addEventListener('message', (e) => { if (e.data && e.data.type === 'pair-result') resolve('answered'); });
    setTimeout(() => resolve('quiet'), 3000);
  }), code);
  assert.equal(framed, 'quiet');
  assert.equal(await H.prisma.agentDevice.count({ where: { userId: c.id } }), 0);
  await page.goto('https://aisehr.com/elsewhere');
  assert.equal(await ask(page, { type: 'ping' }, 'hello', 2000), null, 'no bridge outside the assistant page');
  await page.close();
});
