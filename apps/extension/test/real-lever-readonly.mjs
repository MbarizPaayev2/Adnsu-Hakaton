// GENUINE integration evidence, read-only: the unmodified extension in real Chromium on a REAL Lever apply page (jobs.lever.co/xsolla/...), no host mapping, no AISE API.
// It reads the form, fills text fields with obvious test values and verifies them. It attaches NO file and presses NO submit control; the run asserts that the page made no POST.
// usage: node test/real-lever-readonly.mjs <https://jobs.lever.co/<employer>/<posting-uuid>/apply>
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.argv[2];
if (!/^https:\/\/jobs\.lever\.co\/[a-z0-9-]+\/[0-9a-f-]{36}\/apply$/.test(url || '')) { console.error('give a https://jobs.lever.co/<employer>/<uuid>/apply URL'); process.exit(2); }
const extDir = path.resolve(new URL('..', import.meta.url).pathname);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aise-real-'));
const ctx = await chromium.launchPersistentContext(profile, { headless: false, args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--headless=new', '--no-first-run'] });
const posts = [];
const infra = []; // the page's own bot-protection telemetry (Cloudflare, hCaptcha) is not an application
ctx.on('request', (r) => {
  if (r.method() === 'GET' || r.method() === 'OPTIONS') return;
  const u = new URL(r.url());
  if (u.hostname === 'jobs.lever.co' && !u.pathname.startsWith('/cdn-cgi/')) posts.push(`${r.method()} ${u.pathname}`); else infra.push(`${r.method()} ${u.hostname}`);
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
const page = await ctx.newPage(); await page.goto(url, { waitUntil: 'load' }); await new Promise((r) => setTimeout(r, 3000));
const send = (msg) => sw.evaluate(async ({ url, msg }) => { const [t] = await chrome.tabs.query({ url: url + '*' }); return chrome.tabs.sendMessage(t.id, msg); }, { url, msg });
const d = await send({ type: 'describe' });
const report = { url, pageState: d.pageState, fieldCount: (d.fields || []).length, fields: (d.fields || []).map((f) => `${f.required ? '*' : ' '} ${f.type.padEnd(8)} ${f.key.slice(0, 40).padEnd(40)} ${f.label.slice(0, 70)}`), declarationChars: (d.declarationText || '').length };
const byKey = Object.fromEntries((d.fields || []).map((f) => [f.key, f]));
const plan = [];
const text = { name: 'AISE Agent Test', email: 'agent-test@example.invalid', phone: '+000000000', 'urls[LinkedIn]': 'https://www.linkedin.com/in/aise-agent-test' };
for (const [k, v] of Object.entries(text)) if (byKey[k]) plan.push({ key: k, type: byKey[k].type, action: 'fill', value: v });
const sel = (d.fields || []).find((f) => f.type === 'select' && /authorized to work/i.test(f.label) && f.options?.length);
if (sel) { const yes = sel.options.find((o) => /^yes/i.test(o.label)); if (yes) plan.push({ key: sel.key, type: 'select', action: 'fill', value: yes.value }); }
const filled = await send({ type: 'fill', plan, file: null });
report.fill = { ok: filled.ok, planned: plan.length, mismatched: filled.mismatched, requiredStillEmpty: filled.missingRequired?.map((k) => (byKey[k]?.label || k).slice(0, 50)) };
await page.screenshot({ path: process.env.SHOT || '/tmp/real-lever-readonly.png', fullPage: false });
report.postsToLever = posts; report.botProtectionTelemetry = [...new Set(infra)];
console.log(JSON.stringify(report, null, 2));
await ctx.close(); fs.rmSync(profile, { recursive: true, force: true });
if (posts.length) { console.error('A POST was made: this check must be read-only'); process.exit(1); }
