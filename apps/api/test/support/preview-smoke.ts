/**
 * Short smoke check of the RUNNING local preview (scripts/preview/preview.sh start + seed): startup, authentication (candidate, employer, admin),
 * document review and downloads in a real browser. Read-only except for logging in; it creates and changes nothing.
 * Not a regression suite and not evidence about live-provider quality: the preview's generator is a deterministic fake.
 * Run (from apps/api): npx ts-node -r tsconfig-paths/register --transpile-only test/support/preview-smoke.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { CFT, pdfText } from './integration-helpers';
import { previewHome } from './preview-config';

const state = JSON.parse(readFileSync(join(previewHome, 'state.json'), 'utf8'));
const cred = JSON.parse(readFileSync(join(previewHome, 'credentials.json'), 'utf8'));
const ok = (m: string) => console.log(`PASS ${m}`);

async function main() {
  assert.equal(state.ready, true, 'preview is not running');
  const health = await (await fetch(`${state.control}/health`)).json();
  assert.equal(health.database, 'aise_preview_20261004');
  assert.equal((await fetch(`${state.api}/health/ready`)).status, 200, 'API readiness (database, queue)');
  ok(`startup: web, API and control page answer; database ${health.database}; ${health.freeGiB} GiB free`);

  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || CFT });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await ctx.route('**/*', (r) => (['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()));
    await ctx.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
    const p = await ctx.newPage();
    p.setDefaultTimeout(150_000);

    // ── candidate ─────────────────────────────────────────────────────────────────────────────────────────────
    await p.goto(`${state.web}/login`);
    await p.locator('#email').fill(cred.candidate);
    await p.locator('#password').fill(cred.password);
    const cb = p.waitForResponse((r) => r.url().includes('/api/auth/callback/credentials') && r.request().method() === 'POST');
    await p.getByRole('button', { name: 'Daxil ol' }).click();
    assert.equal((await cb).status(), 200);
    await p.waitForFunction(async (e) => (await (await fetch('/api/auth/session')).json()).user?.email === e, cred.candidate);
    // The login form navigates on its own after the session is set; let it finish so it cannot cancel the next navigation.
    await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => undefined);
    ok('authentication: candidate signs in through the real login form');

    await p.goto(`${state.web}/dashboard/resumes`);
    await p.getByTestId('document-allowance-card').waitFor();
    assert.match(await p.getByTestId('preview-banner').innerText(), /dil modeli deyil/);
    ok('the synthetic-preview notice is shown');
    const list = await p.locator('main').innerText();
    for (const needle of [/Hazırlanmış sənədlər/, /Motivasiya məktubu|Məktub/i]) assert.match(list, needle);
    const rows = await p.locator('[data-testid^="document-row-"]').count();
    assert.ok(rows >= 3, `expected the 3 seeded documents, saw ${rows}`);
    ok(`documents: ${rows} seeded documents listed (approved CV, approved letter, draft resume)`);

    // Download the approved CV: a real PDF containing the fact-checked content.
    const cvRow = p.locator('[data-testid^="document-row-"]', { hasText: /CV/ }).filter({ has: p.getByRole('button', { name: 'PDF', exact: true }) }).first();
    const [dl] = await Promise.all([p.waitForEvent('download'), cvRow.getByRole('button', { name: 'PDF', exact: true }).click()]);
    const path = await dl.path();
    const bytes = readFileSync(path!);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const text = await pdfText(bytes);
    assert.match(text, /Leyla/);
    assert.match(text, /PostgreSQL/);
    ok(`downloads: approved CV is a ${bytes.length}-byte PDF with the candidate's reviewed content (${dl.suggestedFilename()})`);

    // Review: open the draft (needs-review) document; the review screen and the free PDF preview must appear.
    const draftRow = p.locator('[data-testid^="document-row-"]', { hasText: /Yoxlanılmalı və təsdiqlənməlidir/ }).first();
    await draftRow.getByRole('button', { name: 'Yoxla və redaktə et' }).click();
    await p.getByTestId('tailored-review').waitFor();
    await p.getByRole('button', { name: 'PDF önizləmə' }).waitFor();
    await p.getByRole('button', { name: /Yoxladım, təsdiqlə və PDF yarat/ }).waitFor();
    ok('document review: the draft opens with factual-review notes, free PDF preview and a manual approve button (nothing was approved by this check)');
    await ctx.clearCookies();

    // ── employer ───────────────────────────────────────────────────────────────────────────────────────────────
    await p.goto(`${state.web}/business/login`);
    await p.locator('#email').fill(cred.employer);
    await p.locator('#password').fill(cred.password);
    await p.getByRole('button', { name: 'Daxil ol' }).click();
    await p.waitForURL((u) => u.pathname.startsWith('/business') && !u.pathname.includes('/login'), { timeout: 60_000 });
    ok('authentication: employer signs in');
    await ctx.clearCookies();
    await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

    // ── admin ──────────────────────────────────────────────────────────────────────────────────────────────────
    await p.goto(`${state.web}/admin`);
    await p.locator('#admin-email').fill(cred.admin);
    await p.locator('#admin-password').fill(cred.password);
    await p.getByRole('button', { name: 'Daxil ol' }).click();
    await p.waitForURL((u) => u.pathname.startsWith('/admin') && u.pathname !== '/admin', { timeout: 60_000 }).catch(() => undefined);
    const adminText = await p.locator('body').innerText();
    assert.doesNotMatch(adminText, /Daxil olarkən xəta|Etibarsız/);
    ok(`authentication: admin signs in (landed on ${new URL(p.url()).pathname})`);
  } finally {
    await browser.close();
  }
  console.log('PREVIEW SMOKE PASSED');
}
main().catch((e) => { console.error(e); process.exit(1); });
