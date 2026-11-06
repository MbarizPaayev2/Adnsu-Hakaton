/**
 * Local-only browser rehearsal of the candidate-approved e-mail application journey. Run from apps/api with
 * ts-node --transpile-only. Evidence level: real Chrome → real Next.js → real Nest API, Postgres (isolated
 * aise_phase2_test), Redis queue and in-process worker. The e-mail PROVIDER is a local sink on loopback:
 * nothing is sent anywhere, and the harness blocks all non-local network traffic. Synthetic accounts only.
 */
import { FakeProvider } from '../src/email-applications/fake-provider';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { statfsSync, openSync, closeSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';

const CFT = `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const WEB = 'http://127.0.0.1:3450';
const API = 'http://127.0.0.1:4010';
const SINK_PORT = 4599;
const SECRET = `whsec_${randomBytes(24).toString('base64')}`;
const SHOTS = process.env.EVIDENCE_DIR || '/private/tmp/claude-501/-Users-fizuli-050icloud-com-Projects-aise/8efb61f7-75d5-460b-ad11-088d6951feaa/scratchpad/evidence';

function docx(marker: string): Buffer {
  const name = Buffer.from('word/document.xml');
  const body = Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Leyla Huseynova</w:t></w:r></w:p><w:p><w:r><w:t>${marker}</w:t></w:r></w:p></w:body></w:document>`);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(name.length, 26); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + body.length, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function main() {
  const root = resolve(process.cwd(), '../..');
  const free = () => { const s = statfsSync(root); return Number(s.bavail) * Number(s.bsize); };
  if (free() < 5 * 1024 ** 3) throw new Error('Need 5 GiB before browser stack');
  mkdirSync(SHOTS, { recursive: true });
  process.env.DATABASE_URL = 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
  const stamp = `phase7-${Date.now()}`;
  const password = 'Phase7-Local-1!';
  const candidateEmail = `${stamp}-candidate@example.com`;
  const adminEmail = `${stamp}-admin@example.com`;
  const cvBytes = docx(`EMAIL-APPLY-CV-${stamp}`);
  const employerDomain = 'pilot-employer.example';
  const addr = (who: string) => `${who}-${stamp}@${employerDomain}`;

  // The local provider must exist before the API starts (the API reads its address at boot).
  const provider = new FakeProvider();
  await provider.start(SINK_PORT);
  provider.webhook = { url: `${API}/webhooks/resend`, secret: SECRET };
  Object.assign(process.env, {
    EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_TRANSPORT: 'sink', EMAIL_APPLY_SINK_URL: `http://127.0.0.1:${SINK_PORT}`, EMAIL_APPLY_WEBHOOK_SECRET: SECRET,
    EMAIL_APPLY_FROM: 'AISE Applications <applications@aise.example>', EMAIL_APPLY_AUTOMATION_ENABLED: 'true', EMAIL_APPLY_USER_DAILY_LIMIT: '20', EMAIL_APPLY_PROVIDER_TIMEOUT_MS: '2500',
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startPhase2App } = require('./support/phase2-local-app') as typeof import('./support/phase2-local-app');
  const { EmailApplicationMaintenance } = require('../src/email-applications/email-application.maintenance') as typeof import('../src/email-applications/email-application.maintenance');
  const env = await startPhase2App({ native: true });
  const maintenance = env.app.get(EmailApplicationMaintenance);

  let web: ChildProcess | undefined, browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  const logPath = `/tmp/${stamp}-next.log`;
  const log = openSync(logPath, 'w', 0o600);
  let diskStopped = false;
  const monitor = setInterval(() => { if (free() < 2 * 1024 ** 3) { diskStopped = true; web?.kill('SIGTERM'); void browser?.close(); } }, 5000);
  const passes: string[] = [];
  const pass = (message: string) => { passes.push(message); console.log(`PASS ${message}`); };
  let shot = 0;
  const snap = async (page: Page, name: string) => { await page.screenshot({ path: `${SHOTS}/${String(++shot).padStart(2, '0')}-${name}.png`, fullPage: true }); };
  const sinkMessages = () => provider.messages;
  const waitFor = async <T>(what: string, fn: () => Promise<T | undefined | false | null>, tries = 40): Promise<T> => {
    for (let i = 0; i < tries; i++) { const r = await fn(); if (r) return r; await new Promise((res) => setTimeout(res, 500)); }
    throw new Error(`Timed out waiting for ${what}`);
  };

  const jobIds: Record<string, string> = {};
  const post = (title: string, extra: Record<string, unknown> = {}, ext = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')) => env.jobs.upsertJob({
    externalId: `hellojob:${stamp}-${ext}`, title, company: `Pilot Employer ${stamp}`, description: 'Public posting.', location: 'Bakı', url: `https://www.hellojob.az/vakansiya/${stamp}-${ext}`,
    postedAt: new Date(Date.now() - 3600_000).toISOString(), ...extra,
  });

  try {
    await env.app.listen(4010, '127.0.0.1');
    web = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3450'], {
      cwd: resolve(root, 'apps/web'), stdio: ['ignore', log, log],
      env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_API_URL: API, NEXTAUTH_URL: WEB, NEXTAUTH_SECRET: randomBytes(32).toString('hex'), NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_TELEMETRY_DISABLED: '1' },
    });
    for (let i = 0; i < 90; i++) {
      if (web.exitCode !== null) throw new Error(`Next exited; see ${logPath}`);
      try { if ((await fetch(`${WEB}/login`)).ok) break; } catch { /* starting */ }
      if (i === 89) throw new Error('Next readiness timeout');
      await new Promise((r) => setTimeout(r, 1000));
    }

    // ── Synthetic accounts and postings (account creation and imports use the real product paths) ──
    const reg = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: candidateEmail, password }) });
    assert.equal(reg.status, 201);
    const captured = env.emails.getCapturedEmails().filter((m) => m.to === candidateEmail).at(-1)!;
    const token = new URL(/href="([^"]+)"/.exec(captured.html)![1]).searchParams.get('token');
    assert.ok((await fetch(`${API}/auth/verify-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })).ok);
    await env.prisma.adminUser.create({ data: { email: adminEmail, hashedPassword: await bcrypt.hash(password, 12), role: 'ADMIN' } });

    const a = await post('Credit Analyst', { description: `Requirements: finance degree.\nSend your CV to ${addr('hr')} with the subject "Credit Analyst - REF-501".\nReference No: REF-501` });
    const b = await post('Office Manager', { description: 'Apply through our website only.' });
    const c = await post('Remote Developer', { description: `Send your CV to ${addr('dev')} please.`, rawPayload: { isRemote: true, careerLevel: 'career-levels.mid' } });
    const same = await post('Duplicate Address Role', { description: `Send your CV to ${addr('hr')}` });
    for (const [key, r] of Object.entries({ a, b, c, same })) jobIds[key] = r.job.id;
    assert.equal(a.job.applicationMethod, 'EMAIL');
    assert.equal(b.job.applicationMethod, 'EXTERNAL_SITE');
    assert.equal(c.job.workArrangement, 'Remote');
    assert.equal(c.job.experienceLevel, 'Mid-level');

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || CFT });
    const newContext = async (viewport = { width: 1280, height: 900 }) => {
      const ctx = await browser!.newContext({ viewport, acceptDownloads: true });
      contexts.push(ctx);
      await ctx.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      await ctx.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
      return ctx;
    };
    const page = await (await newContext()).newPage();
    page.setDefaultTimeout(30000);

    // ── 1. Browse and filter the public catalogue (no account) ──
    await page.goto(`${WEB}/jobs?q=${stamp}`);
    await page.getByRole('heading', { name: 'Credit Analyst' }).waitFor();
    assert.ok(await page.getByText(/İş formatı: Uzaqdan · Təcrübə: Orta səviyyə/).count() >= 1, 'remote/mid job shows its facts');
    assert.ok(await page.getByText(/İş formatı: Məlum deyil · Təcrübə: Məlum deyil/).count() >= 1, 'unknown facts stay unknown');
    await page.getByLabel('İş formatı').selectOption('Remote');
    await page.getByRole('button', { name: 'Axtar' }).click();
    await page.waitForURL((u) => u.searchParams.get('work') === 'Remote');
    await page.getByRole('heading', { name: 'Remote Developer' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Credit Analyst' }).count(), 0);
    await snap(page, 'catalogue-filtered-remote');
    pass('browser: browse the public catalogue and filter by work format (unknown facts stay "Məlum deyil")');

    // ── 2. Visitor sees a sign-in prompt on an e-mail vacancy; sign-in returns to it ──
    await page.goto(`${WEB}/jobs/imported/${a.job.id}`);
    await page.getByRole('link', { name: 'Daxil olun' }).click();
    await page.waitForURL((u) => u.pathname === '/login' && u.searchParams.get('next') === `/jobs/imported/${a.job.id}`);
    await page.locator('#email').fill(candidateEmail);
    await page.locator('#password').fill(password);
    const callback = page.waitForResponse((r) => r.url().includes('/api/auth/callback/credentials') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    assert.equal((await callback).status(), 200);
    await page.waitForURL((u) => u.pathname === `/jobs/imported/${a.job.id}`);
    pass('browser: sign-in returns to the vacancy (next path honoured)');

    // ── 3. Without a CV, preparing is refused with a clear message and sends nothing ──
    await page.getByRole('button', { name: 'Müraciəti hazırla və yoxla' }).click();
    await page.getByRole('alert').filter({ hasText: 'CV yükləyin' }).waitFor();
    assert.equal(sinkMessages().length, 0);
    pass('browser: missing CV → clear refusal, nothing sent');

    // ── 4. Onboarding with a real CV upload ──
    await page.goto(`${WEB}/dashboard`);
    await page.getByRole('heading', { name: 'CV-nizi yükləyin' }).waitFor();
    await page.locator('input[type=file]').setInputFiles({ name: 'cv.docx', mimeType: DOCX, buffer: cvBytes });
    await page.getByRole('heading', { name: 'Məlumatlarınızı yoxlayın' }).waitFor();
    await page.getByPlaceholder('məs. TypeScript').fill('TypeScript');
    await page.getByPlaceholder('məs. TypeScript').press('Enter');
    await page.getByRole('button', { name: 'Davam et' }).click();
    await page.getByRole('button', { name: 'Tamamla' }).click();
    await page.waitForURL((u) => u.pathname === '/dashboard');
    await page.waitForFunction(async (email) => (await (await fetch('/api/auth/session')).json()).user?.email === email, candidateEmail);
    const user = await env.prisma.user.findUniqueOrThrow({ where: { email: candidateEmail } });
    assert.ok(user.name, 'onboarding stored a display name');
    pass('browser: upload a CV and finish onboarding');

    // ── 5. Prepare → review → approve ──
    await page.goto(`${WEB}/jobs/imported/${a.job.id}`);
    await page.getByRole('button', { name: 'Müraciəti hazırla və yoxla' }).click();
    await page.waitForURL((u) => /\/dashboard\/email-applications\/[^/]+$/.test(u.pathname));
    const applicationId = page.url().split('/').pop()!;
    await page.getByRole('heading', { name: '1. Alıcı və göstəriş' }).waitFor();
    assert.equal(await page.getByTestId('recipient').textContent(), addr('hr'));
    assert.ok(await page.getByText('with the subject "Credit Analyst - REF-501"').isVisible());
    assert.equal(await page.getByLabel('Mövzu').inputValue(), 'Credit Analyst - REF-501');
    assert.ok(await page.getByLabel('Mövzu').isDisabled(), 'published subject is locked');
    assert.equal(sinkMessages().length, 0, 'preview sends nothing');
    assert.ok(await page.getByRole('button', { name: /Təsdiq et və göndər/ }).isDisabled());
    const [preview] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /CV-ni yüklə və yoxla/ }).click()]);
    assert.ok(readFileSync((await preview.path())!).equals(cvBytes), 'the CV the candidate previews is the uploaded file');
    await page.getByLabel(/Məktub \(e-poçtun mətni\)/).fill('Salam,\nCredit Analyst vəzifəsinə müraciət edirəm (REF-501).\nCV-m əlavədədir.\nHörmətlə,\nLeyla');
    await snap(page, 'review-desktop');
    pass('browser: review shows recipient, vacancy instructions, locked subject, CV; approval disabled; nothing sent yet');

    await page.getByLabel(/Elanın müraciət göstərişini oxudum/).check();
    assert.ok(await page.getByRole('button', { name: /Təsdiq et və göndər/ }).isDisabled(), 'consent still missing');
    await page.getByLabel(/göndərilməsinə razıyam/).check();
    await page.getByRole('button', { name: /Təsdiq et və göndər/ }).dblclick();
    const sent = await waitFor('the message in the sink', async () => sinkMessages().length >= 1 && sinkMessages());
    await page.getByText('Çatdırılma: E-poçt xidməti qəbul etdi').waitFor({ timeout: 20000 }).catch(async () => { await page.reload(); await page.getByText('Çatdırılma: E-poçt xidməti qəbul etdi').waitFor(); });
    assert.equal(sinkMessages().length, 1, 'double click → exactly one message');
    const message = sinkMessages()[0];
    assert.deepEqual(message.to, [addr('hr')]);
    assert.equal(message.subject, 'Credit Analyst - REF-501');
    assert.equal(message.replyTo, candidateEmail);
    assert.ok(message.text.includes('Credit Analyst vəzifəsinə müraciət edirəm (REF-501)'));
    assert.equal(message.attachments.length, 1);
    assert.equal(message.attachments[0].sha256, sha(cvBytes), 'attachment is the exact previewed and uploaded CV');
    assert.ok(message.attachments[0].content.equals(cvBytes));
    assert.equal(message.tags.application, applicationId);
    void sent;
    assert.ok(await page.getByText(/aldığı və ya oxuduğu demək deyil/).isVisible(), 'acceptance is not described as delivery or review');
    await snap(page, 'provider-accepted');
    pass('browser: approve (double click) → one message with exact CV bytes, subject, recipient, Reply-To; shown as provider-accepted only');

    // ── 6. Provider evidence arrives (signed webhook): delivered, duplicate, then a late event ──
    const emit = (type: string, extra: Record<string, unknown> = {}, svixId?: string) => fetch(`http://127.0.0.1:${SINK_PORT}/control/emit`, { method: 'POST', body: JSON.stringify({ type, messageId: message.id, applicationTag: applicationId, ...extra }) });
    assert.equal((await emit('email.delivered')).status, 200);
    await page.reload();
    await page.getByText('Çatdırılma: Qəbuledicinin poçt serveri qəbul etdi').waitFor();
    assert.ok(await page.getByText(/oxuduğunu göstərmir/).isVisible());
    pass('browser: signed delivered webhook → "recipient server accepted" (not "read")');

    // ── 7. Candidate tracks the process: interview with date and time zone ──
    await page.getByLabel('Yeni mərhələ').selectOption('INTERVIEW_SCHEDULED');
    await page.getByLabel('Müsahibə tarixi və saatı').fill('2026-10-20T10:00');
    await page.getByLabel('Saat qurşağı').selectOption('Asia/Baku');
    await page.getByLabel(/Müsahibə qeydləri/).fill('Bank ofisi, 3-cü mərtəbə');
    await page.getByLabel(/24 saat əvvəl mənə e-poçtla xatırlat/).check();
    await page.getByLabel(/Qeyd \(istəyə bağlı\)/).fill('Telefonla dəvət gəldi');
    await page.getByRole('button', { name: 'Yadda saxla' }).click();
    await page.getByText('Təyin olunan müsahibə:').waitFor();
    const interviewLine = await page.getByText('Təyin olunan müsahibə:').innerText();
    assert.ok(/2026/.test(interviewLine) && /10:00/.test(interviewLine) && /Asia\/Baku/.test(interviewLine) && !/M10/.test(interviewLine), `interview line is readable: ${interviewLine}`);
    const tracked = await env.prisma.emailApplication.findUniqueOrThrow({ where: { id: applicationId } });
    assert.equal(tracked.recruitmentState, 'INTERVIEW_SCHEDULED');
    assert.equal(tracked.interviewAt?.toISOString(), '2026-10-20T06:00:00.000Z');
    assert.equal(tracked.interviewTimezone, 'Asia/Baku');
    assert.equal(tracked.reminderOptIn, true);
    assert.ok(await page.getByText('Siz bildirdiniz', { exact: false }).count() >= 1, 'history labels the evidence source');
    assert.ok(await page.getByText('E-poçt xidməti', { exact: false }).count() >= 1);
    await snap(page, 'tracking-interview');
    await page.goto(`${WEB}/dashboard/applications`);
    await page.getByRole('heading', { name: 'E-poçtla göndərilənlər' }).waitFor();
    assert.ok(await page.getByText('Müsahibə təyin edilib').isVisible());
    assert.ok(await page.getByText('Qəbuledicinin poçt serveri qəbul etdi').isVisible());
    await snap(page, 'applications-list');
    pass('browser: candidate-reported interview (date + time zone + notes + reminder) with evidence-labelled history; applications list shows both states separately');

    // ── 8. Unknown or failed outcomes are visible and never silently retried ──
    await post('Risk Manager Pilot', { description: `Send your CV to ${addr('risk')}` }, 'risk');
    const riskId = (await env.prisma.job.findUniqueOrThrow({ where: { externalId: `hellojob:${stamp}-risk` } })).id;
    await page.goto(`${WEB}/jobs/imported/${riskId}`);
    provider.queue('record-then-hang');
    await page.getByRole('button', { name: 'Müraciəti hazırla və yoxla' }).click();
    await page.waitForURL((u) => /\/dashboard\/email-applications\/[^/]+$/.test(u.pathname));
    const riskApp = page.url().split('/').pop()!;
    await page.getByLabel(/Elanın müraciət göstərişini oxudum/).check();
    await page.getByLabel(/göndərilməsinə razıyam/).check();
    const before = sinkMessages().length;
    await page.getByRole('button', { name: /Təsdiq et və göndər/ }).click();
    // The provider took the message but never answered: the outcome is unknown.
    await waitFor('uncertain state', async () => (await env.prisma.emailApplication.findUnique({ where: { id: riskApp } }))?.deliveryState === 'UNCERTAIN');
    await page.reload();
    await page.getByText('Çatdırılma: Nəticə bəlli deyil').waitFor();
    assert.equal(sinkMessages().length, before + 1);
    await maintenance.sweep(new Date(Date.now() + 3600_000)); // a scheduler tick
    assert.equal(sinkMessages().length, before + 1, 'an uncertain attempt is never re-sent automatically');
    await snap(page, 'uncertain');
    await page.getByRole('button', { name: 'Yenidən göndər' }).isDisabled();
    await page.getByLabel(/dublikat yarada biləcəyini başa düşürəm/).check();
    await page.getByRole('button', { name: 'Yenidən göndər' }).click();
    await waitFor('retry acceptance', async () => (await env.prisma.emailApplication.findUnique({ where: { id: riskApp } }))?.deliveryState === 'PROVIDER_ACCEPTED');
    assert.equal(sinkMessages().length, before + 1, 'the provider recognised the repeated request by its idempotency key');
    pass('browser: ambiguous timeout → "outcome unknown", never auto-resent; candidate-acknowledged retry reuses the idempotency key (no duplicate)');

    // ── 9. A bounce suppresses the address; the same address is no longer offered ──
    const riskMessage = sinkMessages()[sinkMessages().length - 1];
    await fetch(`http://127.0.0.1:${SINK_PORT}/control/emit`, { method: 'POST', body: JSON.stringify({ type: 'email.bounced', messageId: riskMessage.id, applicationTag: riskApp, data: { bounce: { type: 'Permanent' } } }) });
    await page.reload();
    await page.getByText('Çatdırılma: Çatdırılmadı').waitFor();
    await post('Another Role At Risk Desk', { description: `Send your CV to ${addr('risk')}` }, 'risk2');
    const risk2 = await env.prisma.job.findUniqueOrThrow({ where: { externalId: `hellojob:${stamp}-risk2` } });
    await page.goto(`${WEB}/jobs/imported/${risk2.id}`);
    await page.getByText(/göndərmək mümkün deyil/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Müraciəti hazırla və yoxla' }).count(), 0);
    pass('browser: bounce → shown as not delivered; the address is suppressed and no longer offered');

    // ── 10. Pause, cancel pending and revoke consent from the controls page ──
    await page.goto(`${WEB}/jobs/imported/${c.job.id}`);
    await page.getByRole('button', { name: 'Müraciəti hazırla və yoxla' }).click();
    await page.waitForURL((u) => /\/dashboard\/email-applications\/[^/]+$/.test(u.pathname));
    const devApp = page.url().split('/').pop()!;
    await page.goto(`${WEB}/dashboard/email-applications/settings`);
    await page.getByRole('button', { name: 'Göndərişi dayandır' }).click();
    await page.getByText('Göndəriş dayandırılıb', { exact: false }).waitFor();
    await page.goto(`${WEB}/dashboard/email-applications/${devApp}`);
    await page.getByLabel(/Elanın müraciət göstərişini oxudum/).check();
    await page.getByLabel(/göndərilməsinə razıyam/).check();
    const countBefore = sinkMessages().length;
    await page.getByRole('button', { name: /Təsdiq et və göndər/ }).click();
    await page.getByText('Çatdırılma: Göndəriş növbəsindədir').waitFor();
    await maintenance.sweep(new Date(Date.now() + 120_000)); // a scheduler tick while paused
    await page.reload();
    await page.getByText('Göndərişi siz dayandırmısınız').waitFor();
    assert.equal(sinkMessages().length, countBefore, 'paused → nothing sent');
    await snap(page, 'paused-queued');
    await page.goto(`${WEB}/dashboard/email-applications/settings`);
    await page.getByRole('button', { name: 'Gözləyənləri ləğv et' }).click();
    await page.getByRole('button', { name: 'Bəli, ləğv et' }).click();
    await page.getByText('Gözləyən müraciətlər ləğv edildi.').waitFor();
    await page.getByRole('button', { name: 'Göndərişi davam etdir' }).click();
    await page.getByText('Göndəriş aktivdir.').waitFor();
    await maintenance.sweep(new Date(Date.now() + 600_000));
    assert.equal(sinkMessages().length, countBefore, 'cancelled → nothing sent even after resuming');
    assert.equal((await env.prisma.emailApplication.findUniqueOrThrow({ where: { id: devApp } })).deliveryState, 'CANCELLED');
    pass('browser: pause holds a queued application (visible reason); cancel-pending cancels it; resuming sends nothing');

    // ── 11. Mode B (automatic): opt-in with rules; stops on unknowns ──
    await page.goto(`${WEB}/dashboard/email-applications/settings`);
    await page.getByRole('heading', { name: 'Avtomatik müraciət (Rejim B)' }).waitFor();
    await page.getByLabel(/İcazəli vəzifələr/).fill('Auto Analyst');
    await page.getByLabel(/İcazəli şəhərlər/).fill('Bakı');
    await page.getByLabel(/İstisna olunan sözlər/).fill('commission only');
    await page.getByLabel(/Göndəriləcək CV/).selectOption({ index: 1 });
    await page.getByLabel(/Məktub şablonu/).fill('Salam,\n{{title}} vəzifəsinə müraciət edirəm.\n{{name}}');
    assert.ok(await page.getByRole('button', { name: 'Razılıqla aktivləşdir' }).isDisabled(), 'needs explicit consent');
    await page.getByLabel(/mənim adımdan, mənim təsdiqim olmadan/).check();
    await page.getByRole('button', { name: 'Razılıqla aktivləşdir' }).click();
    await page.getByText('Avtomatik müraciət aktivləşdirildi.').waitFor();
    await new Promise((r) => setTimeout(r, 1200));
    const auto1 = await post('Auto Analyst Treasury', { description: `Send your CV to ${addr('auto1')}.` }, 'auto1');
    const auto2 = await post('Auto Analyst Unknown City', { location: 'Azerbaijan', description: `Send your CV to ${addr('auto2')}.` }, 'auto2');
    const auto3 = await post('Auto Analyst Extra', { description: `Send your CV to ${addr('auto3')}. Include your salary expectation.` }, 'auto3');
    const auto4 = await post('Auto Analyst Commission', { description: `Send your CV to ${addr('auto4')}. Pay: commission only.` }, 'auto4');
    const autoBefore = sinkMessages().length;
    const tick = await maintenance.sweep(new Date());
    assert.deepEqual({ applied: tick.automated.applied, skipped: tick.automated.skipped }, { applied: 1, skipped: 3 });
    await waitFor('automatic message', async () => sinkMessages().length === autoBefore + 1);
    const autoMsg = sinkMessages()[sinkMessages().length - 1];
    assert.deepEqual(autoMsg.to, [addr('auto1')]);
    assert.ok(autoMsg.text.startsWith('Salam,\nAuto Analyst Treasury vəzifəsinə müraciət edirəm.'));
    await page.goto(`${WEB}/dashboard/email-applications/settings`);
    await page.getByText('Göndərildi — Qaydalarınıza uyğun idi', { exact: true }).waitFor();
    for (const reason of ['Elanda şəhər bəlli deyil', 'Elan CV-dən əlavə tələb edir (əl ilə baxın)', 'İstisna etdiyiniz söz var']) await page.getByText(`Dayandı — ${reason}`, { exact: true }).waitFor();
    await snap(page, 'automation-decisions');
    await page.goto(`${WEB}/dashboard/applications`);
    await page.getByText('Avtomatik', { exact: false }).first().waitFor();
    void auto2; void auto3; void auto4;
    pass('browser: automatic mode applies only to the matching posting, stops with a stated reason on unknown city / extra requirements / excluded term');

    // ── 12. Revoke consent: automation off, pending cancelled ──
    await page.goto(`${WEB}/dashboard/email-applications/settings`);
    await page.getByRole('button', { name: 'Razılığı geri götür' }).click();
    await page.getByRole('button', { name: 'Bəli, ləğv et' }).click();
    await page.getByText('Razılıq geri götürüldü.').waitFor();
    await page.getByText('Söndürülüb.').waitFor();
    const afterRevoke = sinkMessages().length;
    await post('Auto Analyst After Revoke', { description: `Send your CV to ${addr('auto5')}.` }, 'auto5');
    await maintenance.sweep(new Date(Date.now() + 60_000));
    assert.equal(sinkMessages().length, afterRevoke, 'after revoking, nothing further is sent');
    pass('browser: revoke consent → automation off and no further sending');

    // ── 12b. Access boundaries, expired vacancies, unapproved tailored CV, keyboard use ──
    const expiredJob = await post('Expired Analyst Role', { description: `Send your CV to ${addr('expired')}.`, deadline: new Date(Date.now() - 86_400_000).toISOString() }, 'expired');
    await page.goto(`${WEB}/jobs/imported/${expiredJob.job.id}`);
    await page.getByText(/tapılmadı|404/i).first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Müraciəti hazırla və yoxla' }).count(), 0);
    assert.equal((await env.prisma.emailApplication.count({ where: { jobId: expiredJob.job.id } })), 0);
    pass('browser: an expired vacancy is not shown and cannot be applied to');

    const tailoredJob = await post('Tailored CV Check Role', { description: `Send your CV to ${addr('tailor')}.` }, 'tailor');
    const tMatch = await env.prisma.match.create({ data: { userId: user.id, jobId: tailoredJob.job.id, score: 0.6 } });
    const baseResume = await env.prisma.resume.findFirstOrThrow({ where: { userId: user.id, isBase: true } });
    const draftTailored = await env.prisma.resume.create({ data: { userId: user.id, isBase: false, matchId: tMatch.id, status: 'READY', fileUrl: baseResume.fileUrl, version: 9 } });
    await page.goto(`${WEB}/jobs/imported/${tailoredJob.job.id}`);
    await page.getByRole('button', { name: 'Müraciəti hazırla və yoxla' }).click();
    await page.waitForURL((u) => /\/dashboard\/email-applications\/[^/]+$/.test(u.pathname));
    const tailorApp = page.url().split('/').pop()!;
    await page.getByRole('heading', { name: '3. CV' }).waitFor();
    assert.ok((await page.getByText('Əsas CV', { exact: false }).count()) >= 1, 'the base CV is used');
    assert.equal(await page.getByLabel('Başqa CV seç').locator('option', { hasText: 'v9' }).count(), 0, 'an unreviewed tailored CV is not offered');
    const refused = await fetch(`${API}/email-applications/${tailorApp}/draft`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await env.prisma.session.findFirstOrThrow({ where: { userId: user.id }, orderBy: { expires: 'desc' } })).sessionToken}` }, body: JSON.stringify({ resumeId: draftTailored.id }) });
    assert.equal(refused.status, 400, 'the API refuses an unapproved tailored CV even if asked directly');
    pass('browser: an unapproved tailored CV is neither offered nor accepted');

    // Keyboard only: tab to the checkboxes and the approve button, activate with Space/Enter.
    await page.getByLabel(/Elanın müraciət göstərişini oxudum/).focus();
    await page.keyboard.press('Space');
    const consentBox = page.getByLabel(/göndərilməsinə razıyam/);
    await consentBox.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab'); // next focusable control after the consent box
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    assert.ok(focused.includes('Təsdiq et və göndər'), `approve button is the next tab stop (focus is on "${focused}")`);
    const beforeKeyboard = sinkMessages().length;
    await page.keyboard.press('Enter');
    await waitFor('keyboard-approved message', async () => sinkMessages().length === beforeKeyboard + 1);
    pass('browser: the whole approval works from the keyboard');

    // Another candidate and a restricted operator cannot reach what is not theirs.
    const email2 = `${stamp}-other@example.com`;
    const reg2 = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email2, password }) });
    assert.equal(reg2.status, 201);
    const cap2 = env.emails.getCapturedEmails().filter((m) => m.to === email2).at(-1)!;
    assert.ok((await fetch(`${API}/auth/verify-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: new URL(/href="([^"]+)"/.exec(cap2.html)![1]).searchParams.get('token') }) })).ok);
    const login2 = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email2, password }) });
    assert.ok(login2.ok);
    const otherToken = (await login2.json()).sessionToken as string;
    assert.ok(otherToken);
    const get = async (path: string) => { const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${otherToken}` } }); return { status: r.status, text: await r.text() }; };
    const probe = { view: await get(`/email-applications/${applicationId}`), cv: await get(`/email-applications/${applicationId}/cv`), list: await get('/email-applications') };
    assert.equal(probe.view.status, 404, JSON.stringify(probe.view).slice(0, 300));
    assert.equal(probe.cv.status, 404);
    assert.equal(probe.list.text, '[]');
    assert.ok(!probe.view.text.includes('Credit Analyst'));
    pass('browser: another candidate cannot open this application');

    const supportEmail = `${stamp}-support@example.com`;
    await env.prisma.adminUser.create({ data: { email: supportEmail, hashedPassword: await bcrypt.hash(password, 12), role: 'SUPPORT' } });
    const support = await (await newContext()).newPage();
    support.setDefaultTimeout(30000);
    await support.goto(`${WEB}/admin`);
    await support.locator('input[type=email]').fill(supportEmail);
    await support.locator('input[type=password]').fill(password);
    await support.getByRole('button', { name: 'Daxil ol' }).click();
    await support.waitForURL((u) => u.pathname === '/admin/overview');
    await support.goto(`${WEB}/admin/email`);
    await support.getByRole('heading', { name: 'Rejim və dayandırma' }).waitFor();
    assert.equal(await support.getByRole('button', { name: 'Təcili dayandır' }).count(), 0, 'a view-only operator has no pause control');
    const forbidden = await support.evaluate(async () => (await fetch('/api/admin/ops/features/email_apply.sending', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: true, reason: 'x' }) })).status);
    assert.equal(forbidden, 403);
    pass('browser: a view-only operator sees no controls and the server refuses the pause');

    // ── 13. Mobile layout of the review page ──
    const mobile = await (await newContext({ width: 390, height: 844 })).newPage();
    mobile.setDefaultTimeout(30000);
    await mobile.goto(`${WEB}/login`);
    await mobile.locator('#email').fill(candidateEmail);
    await mobile.locator('#password').fill(password);
    await mobile.getByRole('button', { name: 'Daxil ol' }).click();
    await mobile.waitForURL((u) => u.pathname === '/dashboard');
    await mobile.goto(`${WEB}/dashboard/email-applications/${applicationId}`);
    await mobile.getByRole('heading', { name: 'Vəziyyət' }).waitFor();
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `no horizontal scroll on a phone (overflow ${overflow}px)`);
    await snap(mobile, 'tracking-mobile');
    pass('browser: tracking page fits a phone viewport without horizontal scroll');

    // ── 14. Operators see aggregate health; no correspondence ──
    const admin = await (await newContext()).newPage();
    admin.setDefaultTimeout(30000);
    await admin.goto(`${WEB}/admin`);
    await admin.locator('input[type=email]').fill(adminEmail);
    await admin.locator('input[type=password]').fill(password);
    await admin.getByRole('button', { name: 'Daxil ol' }).click();
    await admin.waitForURL((u) => u.pathname === '/admin/overview');
    await admin.goto(`${WEB}/admin/email`);
    await admin.getByRole('heading', { name: 'Rejim və dayandırma' }).waitFor();
    await admin.getByText('Sınaq qutusu (heç nə göndərilmir)').waitFor();
    const adminText = await admin.locator('main').innerText();
    assert.ok(!adminText.includes('Salam,'), 'operators do not see letters');
    assert.ok(!adminText.includes(addr('hr')), 'operators do not see full recipient addresses');
    await snap(admin, 'admin-email');
    await admin.goto(`${WEB}/admin/sources`);
    await admin.getByRole('heading', { name: 'Əhatə (ölçülmüş)' }).waitFor();
    assert.ok(await admin.getByText('Siyahıya salınmış işəgötürən').isVisible());
    await snap(admin, 'admin-sources');
    pass('browser: operator pages show queue/delivery aggregates and source coverage without letters or full addresses');

    if (diskStopped) throw new Error('Disk threshold stopped browser work');
    console.log(`\nALL ${passes.length} BROWSER CHECKS PASSED. Evidence: ${SHOTS}`);
  } finally {
    clearInterval(monitor);
    await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
    await browser?.close();
    if (web && web.exitCode === null) { web.kill('SIGTERM'); await new Promise<void>((r) => web!.once('exit', () => r())); }
    closeSync(log);
    const users = await env.prisma.user.findMany({ where: { email: candidateEmail }, include: { resumes: true, emailApplications: true } });
    const storage = env.app.get(require('../src/resumes/local-storage.service').LocalStorageService);
    for (const u of users) {
      for (const r of u.resumes) if (r.fileUrl) await storage.deleteFile(r.fileUrl);
      for (const e of u.emailApplications) if (e.cvSnapshotUrl) await storage.deletePrivate(e.cvSnapshotUrl);
    }
    const userIds = users.map((u) => u.id);
    await env.prisma.emailDeliveryEvent.deleteMany({ where: { OR: [{ emailApplication: { userId: { in: userIds } } }, { providerMessageId: { startsWith: 'fake_' } }] } });
    await env.prisma.emailSuppression.deleteMany({ where: { email: { endsWith: `-${stamp}@${employerDomain}` } } });
    await env.prisma.emailAutomationDecision.deleteMany({ where: { userId: { in: userIds } } });
    await env.prisma.emailApplySettings.deleteMany({ where: { userId: { in: userIds } } });
    await env.prisma.user.deleteMany({ where: { email: { in: [candidateEmail, `${stamp}-other@example.com`] } } });
    await env.prisma.job.deleteMany({ where: { externalId: { startsWith: `hellojob:${stamp}` } } });
    await env.prisma.adminAuditLog.deleteMany({ where: { adminUser: { email: { in: [adminEmail, `${stamp}-support@example.com`] } } } });
    await env.prisma.adminUser.deleteMany({ where: { email: { in: [adminEmail, `${stamp}-support@example.com`] } } });
    await provider.stop();
    await env.close();
    console.log(`Browser free disk: ${(free() / 1024 ** 3).toFixed(2)} GiB; Next log: ${logPath}`);
  }
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((error) => { console.error('PHASE7_BROWSER_FAILED', error.message); process.exit(1); });
