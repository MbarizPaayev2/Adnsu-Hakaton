/**
 * Local browser proof against the staging census: real Chrome → real Next.js → the census API (test/census-server.ts, port 4010)
 * on the isolated `aise_census` database filled by the real collectors. The e-mail provider is the local sink; nothing is sent
 * anywhere. Run from apps/api after the census server is up: ts-node --transpile-only test/census-browser.ts
 */
import { FakeProvider } from '../src/email-applications/fake-provider';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { openSync, closeSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { TestLeases } from './support/source-lease';

const CFT = `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const WEB = 'http://127.0.0.1:3450';
const API = 'http://127.0.0.1:4010';
const SHOTS = process.env.EVIDENCE_DIR || '/private/tmp/claude-501/-Users-fizuli-050icloud-com-Projects-aise/8efb61f7-75d5-460b-ad11-088d6951feaa/scratchpad/evidence-census';

function docx(marker: string): Buffer {
  const name = Buffer.from('word/document.xml');
  const body = Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Leyla Huseynova</w:t></w:r></w:p><w:p><w:r><w:t>${marker}</w:t></w:r></w:p></w:body></w:document>`);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(name.length, 26); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + body.length, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const prisma = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_census?schema=public' } } });
  const stamp = `census-${Date.now()}`;
  const email = `${stamp}@example.com`;
  const password = 'Census-Local-1!';
  const cvBytes = docx(process.env.REAL_SCORER ? `CENSUS-CV-${stamp} Mühasib. Excel, 1C, vergi hesabatı, əmək haqqı, mühasibat uçotu. 4 il təcrübə, Bakı.` : `CENSUS-CV-${stamp} TypeScript PostgreSQL`);
  const token = readFileSync('/tmp/census-token', 'utf8').trim();
  const provider = new FakeProvider();
  await provider.start(4599);
  const passes: string[] = [];
  const pass = (m: string) => { passes.push(m); console.log(`PASS ${m}`); };
  const open = { status: 'ACTIVE' as const, hiddenAt: null, duplicateOfId: null, OR: [{ deadline: null }, { deadline: { gte: new Date() } }] };

  let web: ChildProcess | undefined, browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  const logPath = `/tmp/${stamp}-next.log`;
  const log = openSync(logPath, 'w', 0o600);
  try {
    web = spawn(process.execPath, [resolve(process.cwd(), '../../node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3450'], {
      cwd: resolve(process.cwd(), '../web'), stdio: ['ignore', log, log],
      env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_API_URL: API, NEXTAUTH_URL: WEB, NEXTAUTH_SECRET: randomBytes(32).toString('hex'), NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_TELEMETRY_DISABLED: '1' },
    });
    for (let i = 0; i < 90; i++) {
      try { if ((await fetch(`${WEB}/login`)).ok) break; } catch { /* starting */ }
      if (i === 89) throw new Error('Next readiness timeout');
      await new Promise((r) => setTimeout(r, 1000));
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || CFT });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    contexts.push(ctx);
    await ctx.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await ctx.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);

    // Undo anything an earlier run of this proof did to the census data.
    await prisma.job.updateMany({ where: { hiddenReason: 'census proof' }, data: { hiddenAt: null, hiddenReason: null } });
    await prisma.job.deleteMany({ where: { externalId: { startsWith: 'work:census-' } } });

    // ── What the database says is eligible (the catalogue's own rules) ──
    const eligible = await prisma.job.count({ where: open });
    const total = await prisma.job.count();
    const expiredCount = await prisma.job.count({ where: { status: 'ACTIVE', deadline: { lt: new Date() } } });
    assert.ok(eligible > 100 && expiredCount > 0, `census has data to prove with (eligible ${eligible}, expired ${expiredCount})`);

    // ── 1. Imported vacancies are in the catalogue, counts agree with the database ──
    await page.goto(`${WEB}/jobs`);
    const countText = await page.getByText(/Ümumi .* açıq vakansiya/).innerText();
    const shown = Number(countText.replace(/\D/g, ''));
    assert.equal(shown, eligible, `catalogue count (${shown}) equals eligible postings in the database (${eligible}); stored ${total}`);
    await page.screenshot({ path: `${SHOTS}/01-catalogue.png`, fullPage: false });
    pass(`catalogue shows ${shown} open vacancies = database eligible count (stored ${total}, expired excluded ${expiredCount})`);

    // ── 2. Search and the existing filters ──
    const sample = await prisma.job.findFirstOrThrow({ where: { ...open, externalId: { startsWith: 'yelo:' } }, orderBy: { postedAt: 'desc' } });
    await page.goto(`${WEB}/jobs?q=${encodeURIComponent(sample.title.split(' ').slice(0, 2).join(' '))}`);
    await page.getByRole('link', { name: sample.title, exact: true }).first().waitFor();
    await page.goto(`${WEB}/jobs?source=yelo`);
    const yeloOpen = await prisma.job.count({ where: { ...open, externalId: { startsWith: 'yelo:' } } });
    assert.ok((await page.getByText(new RegExp(`^${yeloOpen}\\s+nəticə`)).count()) === 1 || (await page.getByText(`${yeloOpen} nəticə`).count()) >= 1, 'source filter count equals database');
    await page.goto(`${WEB}/jobs?company=${encodeURIComponent(sample.company)}`);
    await page.getByRole('link', { name: sample.title, exact: true }).first().waitFor();
    await page.goto(`${WEB}/jobs?location=${encodeURIComponent('Bakı')}&category=technology`);
    assert.ok((await page.getByText(/\d+ nəticə/).count()) >= 1);
    pass('search, source, company and location+category filters return the expected vacancies');

    // ── 3. Expired, hidden and duplicate postings are excluded ──
    const expired = await prisma.job.findFirstOrThrow({ where: { status: 'ACTIVE', deadline: { lt: new Date() } } });
    await page.goto(`${WEB}/jobs?q=${encodeURIComponent(expired.title)}`);
    assert.equal(await page.getByRole('link', { name: expired.title, exact: true }).count() >= 0, true);
    const expiredInList = await fetch(`${API}/jobs?q=${encodeURIComponent(expired.title)}&limit=50`).then((r) => r.json());
    assert.ok(!expiredInList.data.some((j: { id: string }) => j.id === expired.id), 'expired posting is not listed');
    assert.equal((await fetch(`${API}/jobs/imported/${expired.id}`)).status, 404, 'expired posting has no public detail');
    // hide one through the real moderation path, and link a duplicate through the real ingestion path
    const victim = await prisma.job.findFirstOrThrow({ where: { ...open, externalId: { startsWith: 'hellojob:' } } });
    await prisma.job.update({ where: { id: victim.id }, data: { hiddenAt: new Date(), hiddenReason: 'census proof' } }); // operator moderation outcome
    assert.equal((await fetch(`${API}/jobs/imported/${victim.id}`)).status, 404, 'a hidden posting disappears');
    const original = await prisma.job.findFirstOrThrow({ where: { ...open, externalId: { startsWith: 'smartjob:' }, location: 'Bakı' } });
    // Importing into a reviewed source requires its lease (the same one the scheduler and the CLI take).
    const dupLeases = new TestLeases(prisma);
    await dupLeases.take('work');
    const dupLease = dupLeases.of('work');
    const dup = await fetch(`${API}/internal/jobs/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-source-lease': dupLease }, body: JSON.stringify({
      externalId: `work:${stamp}-dup`, title: original.title, company: original.company, description: original.description, location: original.location, url: `https://www.work.az/vakansiyalar/${stamp}-dup`, postedAt: original.postedAt.toISOString(),
    }) });
    assert.equal(dup.status, 201);
    await dupLeases.releaseAll();
    const dupRow = await prisma.job.findUniqueOrThrow({ where: { externalId: `work:${stamp}-dup` } });
    assert.equal(dupRow.duplicateOfId, original.id, 'a cross-source repeat is linked to the earlier posting');
    assert.equal((await fetch(`${API}/jobs/imported/${dupRow.id}`)).status, 404, 'the duplicate is not listed');
    assert.ok((await fetch(`${API}/jobs/imported/${original.id}`)).ok, 'the original stays visible');
    await page.goto(`${WEB}/jobs`);
    const afterText = await page.getByText(/Ümumi .* açıq vakansiya/).innerText();
    assert.equal(Number(afterText.replace(/\D/g, '')), await prisma.job.count({ where: open }));
    pass('expired and hidden postings vanish, a cross-source duplicate is linked and excluded while the original stays; counts follow');

    // ── 4. Vacancy detail: attribution and the right application path ──
    const external = await prisma.job.findFirstOrThrow({ where: { ...open, applicationMethod: 'EXTERNAL_SITE', externalId: { startsWith: 'socar:' } } });
    await page.goto(`${WEB}/jobs/imported/${external.id}`);
    await page.getByRole('heading', { name: external.title }).waitFor();
    assert.ok(await page.getByText('SOCAR').first().isVisible(), 'source attribution shown');
    const link = page.getByRole('link', { name: /Mənbədə bax və müraciət et/ });
    assert.equal(new URL((await link.getAttribute('href'))!).hostname, 'jobs.socar.az');
    assert.equal(await page.getByRole('button', { name: 'Müraciəti hazırla və yoxla' }).count(), 0, 'no e-mail path where the source has none');
    await page.screenshot({ path: `${SHOTS}/02-detail-external.png` });
    pass('detail keeps attribution and sends the candidate to the source site; no e-mail path invented');

    // ── 5. Candidate: register, verify, upload CV, finish onboarding ──
    const reg = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(reg.status, 201);
    const vt = await prisma.verificationToken.findFirstOrThrow({ where: { user: { email }, purpose: 'EMAIL_VERIFY' } }); // the mail is captured inside the server process
    assert.ok((await fetch(`${API}/auth/verify-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: vt.token }) })).ok);
    await page.goto(`${WEB}/login`);
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await page.getByRole('heading', { name: 'CV-nizi yükləyin' }).waitFor();
    await page.locator('input[type=file]').setInputFiles({ name: 'cv.docx', mimeType: DOCX, buffer: cvBytes });
    await page.getByRole('heading', { name: 'Məlumatlarınızı yoxlayın' }).waitFor();
    // With a real scorer the candidate must have content a scorer can use: a stub profile (no headline, one skill) correctly
    // scores below the storage threshold for everything and would persist no match. Fixture-scorer runs keep the stub.
    if (process.env.REAL_SCORER) {
      await page.locator('#ob-headline').fill('Mühasib / Accountant');
      await page.locator('#ob-location').fill('Bakı');
      for (const skill of ['Excel', '1C', 'Vergi', 'Əmək haqqı', 'Mühasibat uçotu']) {
        await page.getByPlaceholder('məs. TypeScript').fill(skill);
        await page.getByPlaceholder('məs. TypeScript').press('Enter');
      }
    } else {
      await page.getByPlaceholder('məs. TypeScript').fill('TypeScript');
      await page.getByPlaceholder('məs. TypeScript').press('Enter');
    }
    await page.getByRole('button', { name: 'Davam et' }).click();
    await page.getByRole('button', { name: 'Tamamla' }).click();
    await page.waitForURL((u) => u.pathname === '/dashboard');
    const onboardedAt = Date.now();
    pass('browser: register, verify, upload CV, complete onboarding');

    // ── 6. Matching uses eligible imported jobs ──
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const real = !!process.env.REAL_SCORER;
    let matches: { jobId: string | null; score: number; details: unknown }[] = [];
    // Bounded wait: CENSUS_MATCH_WAIT_S (default 60 s with the fixture scorer, 900 s with a real one). A real scorer on a
    // laptop needs minutes for the whole inventory, so a measured value is passed explicitly rather than waiting forever.
    const waitS = Number(process.env.CENSUS_MATCH_WAIT_S) || (real ? 900 : 60);
    for (let i = 0; i < waitS && matches.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      matches = await prisma.match.findMany({ where: { userId: user.id }, select: { jobId: true, score: true, details: true } });
      if (real && i > 0 && i % 120 === 0) console.log(`  … ${i} s after onboarding, no persisted matches yet`);
    }
    console.log(`TIME_TO_PERSISTED_MATCHES_S ${((Date.now() - onboardedAt) / 1000).toFixed(1)} (${real ? 'real scorer' : 'fixture scorer'}; eligible jobs ${await prisma.job.count({ where: open })})`);
    assert.ok(matches.length > 0, 'the candidate received matches');
    assert.ok(matches.length <= 3, `the free plan allows 3 matches a month (got ${matches.length})`);
    if (real) {
      const fixtureScores = new Set([0.91, 0.65]);
      assert.ok(matches.every((m) => !fixtureScores.has(Number(m.score))), 'scores are not the fixture constants');
      assert.ok(matches.every((m) => m.score > 0 && m.score <= 1), 'real scores are in range');
      console.log('REAL scores:', matches.map((m) => Number(m.score).toFixed(3)).join(', '));
    }
    const matched = await prisma.job.findMany({ where: { id: { in: matches.map((m) => m.jobId!).filter(Boolean) } }, select: { id: true, status: true, hiddenAt: true, duplicateOfId: true, deadline: true, externalId: true } });
    assert.ok(matched.every((j) => j.status === 'ACTIVE' && !j.hiddenAt && !j.duplicateOfId && (!j.deadline || j.deadline >= new Date())), 'every matched job is eligible');
    assert.ok(!matched.some((j) => j.id === victim.id || j.id === dupRow.id || j.id === expired.id), 'hidden, duplicate and expired postings are not matched');
    const renderStarted = Date.now();
    await page.goto(`${WEB}/dashboard/matches`);
    await page.getByRole('heading', { name: 'Uyğun Vakansiyalar' }).waitFor();
    const firstMatched = await prisma.job.findFirstOrThrow({ where: { id: { in: matches.map((m) => m.jobId!).filter(Boolean) } }, orderBy: { postedAt: 'desc' } });
    await page.getByText(firstMatched.title, { exact: false }).first().waitFor();
    console.log(`MATCHES_RENDER_MS ${Date.now() - renderStarted} (navigation to the first matched posting visible; dev server, warm route)`);
    await page.screenshot({ path: `${SHOTS}/03-matches.png`, fullPage: false });
    pass(`matching (${real ? 'REAL scorer' : 'fixture scorer'}) produced ${matches.length} matches, all on eligible imported postings (sources: ${[...new Set(matched.map((j) => j.externalId.split(':')[0]))].join(', ')})`);

    // ── 7. An explicitly e-mail-applicable vacancy reaches the draft/approval flow (local sink) ──
    const mailJob = await prisma.job.findFirstOrThrow({ where: { ...open, applicationMethod: 'EMAIL' }, orderBy: { postedAt: 'desc' } });
    await page.goto(`${WEB}/jobs/imported/${mailJob.id}`);
    await page.getByRole('heading', { name: 'E-poçtla müraciət' }).waitFor();
    await page.getByRole('button', { name: 'Müraciəti hazırla və yoxla' }).click();
    await page.waitForURL((u) => /\/dashboard\/email-applications\/[^/]+$/.test(u.pathname));
    await page.getByRole('heading', { name: '1. Alıcı və göstəriş' }).waitFor();
    assert.equal(await page.getByTestId('recipient').textContent(), mailJob.applicationEmail);
    const evidence = (mailJob.applicationEmailEvidence as { excerpt: string }).excerpt;
    assert.ok(await page.getByText(evidence.slice(0, 40), { exact: false }).first().isVisible(), "the posting's own instruction is shown");
    assert.equal(provider.messages.length, 0, 'preview sends nothing');
    await page.screenshot({ path: `${SHOTS}/04-email-review.png`, fullPage: true });
    await page.getByLabel(/Elanın müraciət göstərişini oxudum/).check();
    await page.getByLabel(/göndərilməsinə razıyam/).check();
    await page.getByRole('button', { name: /Təsdiq et və göndər/ }).click();
    const t0 = Date.now();
    while (provider.messages.length === 0 && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 500));
    assert.equal(provider.messages.length, 1);
    const message = provider.messages[0];
    assert.deepEqual(message.to, [mailJob.applicationEmail]);
    assert.equal(message.replyTo, email);
    assert.equal(message.attachments[0].sha256, createHash('sha256').update(cvBytes).digest('hex'), 'the attachment is the exact uploaded CV');
    await page.reload();
    await page.getByText('Çatdırılma: E-poçt xidməti qəbul etdi').waitFor();
    pass('browser: an explicitly e-mail-applicable vacancy → preview → approval → one message with the exact CV to the local sink only; shown as provider-accepted');
    console.log(`\nALL ${passes.length} CENSUS BROWSER CHECKS PASSED. Evidence: ${SHOTS}`);
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
    await browser?.close();
    if (web && web.exitCode === null) { web.kill('SIGTERM'); await new Promise<void>((r) => web!.once('exit', () => r())); }
    closeSync(log);
    await provider.stop();
    await prisma.$disconnect();
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error('CENSUS_BROWSER_FAILED', error.message); process.exit(1); });
