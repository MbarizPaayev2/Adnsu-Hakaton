/**
 * Persistent LOCAL PREVIEW of the integrated product for founder inspection. Not a test and not a deployment.
 *
 * What is real: the Next.js app, the NestJS API modules, Postgres (its own persistent database), Redis/BullMQ (a private prefix), the document
 * worker, Typst PDFs, the e-mail application pipeline and storage (a preview-only uploads directory).
 *
 * What is a stand-in, and is labelled as such in the app and on the control page:
 *   - document generation: a deterministic loopback FAKE that restates the facts it is given. It is NOT a language model;
 *   - matching scores: a deterministic keyword-overlap fixture scorer. It is NOT the production scorer;
 *   - application e-mail: a loopback capture sink (nothing is delivered anywhere); app e-mails (verification links) are captured too.
 * Disabled: payments, Telegram, external browser applications, scheduled imports, live e-mail. Non-loopback fetch is refused.
 *
 * Shutdown keeps the database, the uploads and the Redis namespace. Startup is repeatable (migrations are idempotent; the seed upserts).
 * Run via scripts/preview/preview.sh (start | stop | status | seed). Runtime files live OUTSIDE git in $AISE_PREVIEW_HOME (default ~/aise-preview).
 */
import { Test } from '@nestjs/testing';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import * as express from 'express';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statfsSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PREVIEW_DB, PREVIEW_PORTS, PREVIEW_PREFIX, previewHome } from './preview-config';
import { startFakeNim } from './fake-nim';
import { FakeProvider } from '../../src/email-applications/fake-provider';
import { DatabaseModule } from '../../src/database/database.module';
import { HealthModule } from '../../src/health/health.module';
import { AuthModule } from '../../src/auth/auth.module';
import { ProfilesModule } from '../../src/profiles/profiles.module';
import { JobsModule } from '../../src/jobs/jobs.module';
import { MatchingModule } from '../../src/matching/matching.module';
import { NotificationsModule } from '../../src/notifications/notifications.module';
import { ResumesModule } from '../../src/resumes/resumes.module';
import { BillingModule } from '../../src/billing/billing.module';
import { SavedModule } from '../../src/saved/saved.module';
import { AlertsModule } from '../../src/alerts/alerts.module';
import { TelegramModule } from '../../src/telegram/telegram.module';
import { TimelineModule } from '../../src/application-timeline/timeline.module';
import { AccountsModule } from '../../src/accounts/accounts.module';
import { DashboardModule } from '../../src/dashboard/dashboard.module';
import { BusinessModule } from '../../src/business/business.module';
import { CompaniesModule } from '../../src/companies/companies.module';
import { ObservedCompaniesModule } from '../../src/observed-companies/observed-companies.module';
import { VacanciesModule } from '../../src/vacancies/vacancies.module';
import { JobApplicationsModule } from '../../src/job-applications/job-applications.module';
import { AdminModule } from '../../src/admin/admin.module';
import { ExternalApplyModule } from '../../src/external-apply/external-apply.module';
import { VolunteeringModule } from '../../src/volunteering/volunteering.module';
import { UploadsModule } from '../../src/uploads/uploads.module';
import { EmailApplicationsModule } from '../../src/email-applications/email-applications.module';
import { AgentModule } from '../../src/browser-agent/agent.module';
import { EmailService } from '../../src/common/email.service';

const FOUNDER_PORTS = [3450, 4010, 4598];
const FOUNDER_DB = 'aise_local_preview_20261003';
const MIN_FREE_GIB = 3.5;
const PG = process.env.PREVIEW_PG_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433';
const root = resolve(__dirname, '../../../..');

const freeGiB = () => { const s = statfsSync('/'); return (s.bavail * s.bsize) / 2 ** 30; };

/** Secrets persist between starts (so sessions survive a restart) in a 0600 file outside git. */
function runtimeSecrets() {
  const file = join(previewHome, 'secrets.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as { nextauthSecret: string; serviceToken: string };
  const fresh = { nextauthSecret: randomBytes(32).toString('hex'), serviceToken: randomBytes(16).toString('hex') };
  writeFileSync(file, JSON.stringify(fresh), { mode: 0o600 });
  return fresh;
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function main() {
  if (Object.values(PREVIEW_PORTS).some((p) => FOUNDER_PORTS.includes(p))) throw new Error('Refusing to use the founder preview ports');
  if ((PREVIEW_DB as string) === FOUNDER_DB) throw new Error('Refusing to use the founder preview database');
  if (freeGiB() < MIN_FREE_GIB) throw new Error(`Only ${freeGiB().toFixed(1)} GiB free; the preview needs at least ${MIN_FREE_GIB} GiB. Nothing was started.`);
  for (const dir of ['logs', 'uploads']) mkdirSync(join(previewHome, dir), { recursive: true });
  chmodSync(previewHome, 0o700);
  const secrets = runtimeSecrets();

  // ── persistent database: created once, migrated on every start (migrate deploy is idempotent) ─────────────
  const exists = execFileSync('docker', ['exec', 'aise-postgres', 'psql', '-U', 'postgres', '-Atc', `SELECT 1 FROM pg_database WHERE datname='${PREVIEW_DB}'`]).toString().trim() === '1';
  if (!exists) execFileSync('docker', ['exec', 'aise-postgres', 'psql', '-U', 'postgres', '-c', `CREATE DATABASE ${PREVIEW_DB}`], { stdio: 'ignore' });
  const databaseUrl = `${PG}/${PREVIEW_DB}?schema=public`;
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'ignore' });
  process.env.DATABASE_URL = databaseUrl;
  // Preview-only storage: the API resolves its upload directory from the working directory.
  process.chdir(previewHome);

  // ── loopback stand-ins ────────────────────────────────────────────────────────────────────────────────────
  const nim = await startFakeNim();
  const sink = new FakeProvider();
  const sinkUrl = await sink.start(PREVIEW_PORTS.sink);
  const scorer = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') return void res.end('{}');
    const body = JSON.parse(Buffer.concat(chunks).toString());
    // Deterministic keyword-overlap fixture. NOT the production scorer.
    const keywords = (persona: any): string[] => [...new Set(((persona?.skills ?? []) as any[]).flatMap((s) => (Array.isArray(s?.keywords) ? s.keywords : [s?.name ?? s])).map((k) => String(k).toLowerCase()).filter(Boolean))];
    const score = (persona: any, job: any) => {
      const kws = keywords(persona);
      const text = JSON.stringify(job ?? {}).toLowerCase();
      const hit = kws.filter((k) => text.includes(k));
      return { score: Math.min(0.95, 0.4 + (0.55 * hit.length) / Math.max(4, kws.length)), matchedKeywords: hit, breakdown: {}, gaps: kws.filter((k) => !hit.includes(k)).slice(0, 3) };
    };
    const results = req.url === '/score-profile'
      ? body.jobs.map((j: any) => ({ jobId: j.clientId, source: 'job', ...score(body.persona, j) }))
      : body.profiles.map((p: any) => ({ profileId: p.profileId, ...score(p.persona, body.job) }));
    res.end(JSON.stringify({ results }));
  });
  await new Promise<void>((r) => scorer.listen(0, '127.0.0.1', r));
  const scorerUrl = `http://127.0.0.1:${(scorer.address() as AddressInfo).port}`;

  Object.assign(process.env, {
    NODE_ENV: 'development', APP_ENV: 'preview', RESEND_API_KEY: 're_mock_key', POSTHOG_API_KEY: '', FRONTEND_URL: `http://127.0.0.1:${PREVIEW_PORTS.web}`,
    GLORRI_SCRAPER_ENABLED: 'false', EXTERNAL_APPLY_LIVE_ENABLED: 'false', PAYMENTS_ENABLED: 'false', DODO_PAYMENTS_API_KEY: 'mock_dodo_api_key',
    TELEGRAM_BOT_TOKEN: '', TELEGRAM_WEBHOOK_SECRET: '',
    MATCHING_SERVICE_URL: scorerUrl, MATCHING_SERVICE_TOKEN: 'preview-token', SCRAPER_SERVICE_TOKEN: secrets.serviceToken,
    NVIDIA_API_KEY: 'fake-local-key', NIM_API_URL: nim.url, TAILOR_MAX_CALLS: '3', TAILOR_TIMEOUT_MS: '8000', TAILOR_MAX_RETRY_WAIT_MS: '20',
    EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_TRANSPORT: 'sink', EMAIL_APPLY_SINK_URL: sinkUrl, EMAIL_APPLY_FROM: 'AISE Preview <applications@aise.example>',
    EMAIL_APPLY_WEBHOOK_SECRET: `whsec_${Buffer.from('preview-secret').toString('base64')}`,
    EMAIL_APPLY_USER_DAILY_LIMIT: '50', EMAIL_APPLY_GLOBAL_DAILY_LIMIT: '5000', EMAIL_APPLY_RECIPIENT_DAILY_LIMIT: '50',
  });
  delete process.env.TAILOR_DAILY_LIMIT;

  const nativeFetch = global.fetch;
  global.fetch = (async (input: any, init?: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`The preview refuses external traffic: ${url.hostname}`);
    return nativeFetch(input, init);
  }) as typeof fetch;

  // ── API: the real modules (everything AppModule loads except scheduled imports) under a private queue prefix ─────────
  const modules = [DatabaseModule, HealthModule, AuthModule, ProfilesModule, JobsModule, MatchingModule, NotificationsModule, ResumesModule, BillingModule, SavedModule, AlertsModule, TelegramModule, TimelineModule, AccountsModule, DashboardModule, BusinessModule, CompaniesModule, ObservedCompaniesModule, VacanciesModule, JobApplicationsModule, AdminModule, ExternalApplyModule, VolunteeringModule, UploadsModule, EmailApplicationsModule, AgentModule];
  const testing = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    BullModule.forRoot({ prefix: PREVIEW_PREFIX, connection: { host: '127.0.0.1', port: 6379 } }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100_000 }]),
    ...modules,
  ] }).compile();
  const app = testing.createNestApplication({ bodyParser: false, logger: ['error', 'warn'] });
  app.use('/webhooks/resend', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '512kb' }));
  app.use(express.urlencoded({ extended: true }));
  app.enableCors({ origin: [`http://127.0.0.1:${PREVIEW_PORTS.web}`, `http://localhost:${PREVIEW_PORTS.web}`], credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  await app.listen(PREVIEW_PORTS.api, '127.0.0.1');
  const emails = app.get(EmailService);

  // ── control page (read-only, loopback): captured e-mails and the stand-ins, so verification links can be followed ───────────
  const control = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', 'http://x');
    const json = (body: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/health') return json({ ok: true, freeGiB: Number(freeGiB().toFixed(1)), database: PREVIEW_DB });
    if (url.pathname === '/sink/attachment') {
      const f = sink.messages.find((x) => x.id === url.searchParams.get('id'))?.attachments[Number(url.searchParams.get('i'))];
      if (!f) { res.writeHead(404); return void res.end(); }
      res.writeHead(200, { 'content-type': f.contentType || 'application/octet-stream', 'content-disposition': `attachment; filename="${String(f.filename).replace(/[^\w.\-]/g, '_')}"` });
      return void res.end(f.content);
    }
    const mails = emails.getCapturedEmails().slice(-30).reverse();
    const sent = [...sink.messages].reverse();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>AISE preview control</title>
<style>body{font:15px/1.5 system-ui;max-width:880px;margin:24px auto;padding:0 16px;color:#1b2430}code{background:#eef1f5;padding:1px 5px;border-radius:4px}.warn{background:#fff4d6;border:1px solid #e5c76b;padding:12px 14px;border-radius:8px}table{border-collapse:collapse;width:100%}td,th{border-top:1px solid #dde2e8;padding:6px 8px;text-align:left;vertical-align:top;word-break:break-word}</style>
<h1>AISE local preview — control</h1>
<div class=warn><b>Synthetic preview.</b> Document generation is a deterministic fake (not a language model). Matching scores come from a keyword-overlap fixture, not the production scorer.
Application e-mail goes to a local capture sink: <b>nothing is delivered anywhere</b>. Payments, Telegram, external applications, scheduled imports and live e-mail are disabled.
Results here say nothing about live-provider quality.</div>
<p>App: <a href="http://127.0.0.1:${PREVIEW_PORTS.web}">http://127.0.0.1:${PREVIEW_PORTS.web}</a> · API: <code>http://127.0.0.1:${PREVIEW_PORTS.api}</code> · database <code>${PREVIEW_DB}</code> · free disk ${freeGiB().toFixed(1)} GiB</p>
<h2>Application e-mails captured by the sink (${sent.length} since this start)</h2>
${sent.length ? `<table><tr><th>To</th><th>Subject</th><th>Attachments</th></tr>${sent.map((m) => `<tr><td>${esc(m.to)}</td><td>${esc(m.subject)}</td><td>${m.attachments.map((a, i) => `<a href="/sink/attachment?id=${encodeURIComponent(m.id)}&i=${i}">${esc(a.filename)}</a> (${a.bytes} B)`).join('<br>')}</td></tr>`).join('')}</table>` : '<p>None yet. Approve an e-mail application in the app and it appears here.</p>'}
<h2>Account e-mails captured (verification and password-reset links)</h2>
${mails.length ? `<table><tr><th>To</th><th>Subject</th><th>Links</th></tr>${mails.map((m: any) => `<tr><td>${esc(m.to)}</td><td>${esc(m.subject)}</td><td>${[...String(m.html || '').matchAll(/href="([^"]+)"/g)].map((l) => `<a href="${esc(l[1])}">${esc(l[1]).slice(0, 90)}</a>`).join('<br>')}</td></tr>`).join('')}</table>` : '<p>None yet.</p>'}`);
  });
  await new Promise<void>((r) => control.listen(PREVIEW_PORTS.control, '127.0.0.1', r));

  // ── the real Next.js app, from a git-excluded copy so the founder's own apps/web dev lock is never contended ───────────────
  const webLog = openSync(join(previewHome, 'logs', 'web.log'), 'a', 0o600);
  const webCopy = resolve(root, 'apps/web-preview');
  mkdirSync(webCopy, { recursive: true });
  execFileSync('rsync', ['-a', '--delete', '--exclude', '.next', '--exclude', 'node_modules', '--exclude', '.env*', '--exclude', '*.tsbuildinfo', `${resolve(root, 'apps/web')}/`, `${webCopy}/`]);
  if (!existsSync(join(webCopy, 'node_modules'))) symlinkSync(resolve(root, 'apps/web/node_modules'), join(webCopy, 'node_modules'));
  const web: ChildProcess = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(PREVIEW_PORTS.web)], {
    cwd: webCopy, stdio: ['ignore', webLog, webLog],
    env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_API_URL: `http://127.0.0.1:${PREVIEW_PORTS.api}`, NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PREVIEW_PORTS.web}`, NEXTAUTH_URL: `http://127.0.0.1:${PREVIEW_PORTS.web}`, NEXTAUTH_SECRET: secrets.nextauthSecret, NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_DOCUMENTS_MODE: '', NEXT_PUBLIC_RETENTION_MODE: '', NEXT_PUBLIC_PREVIEW_BANNER: 'synthetic', NEXT_PUBLIC_PREVIEW_CONTROL_URL: `http://127.0.0.1:${PREVIEW_PORTS.control}` },
  });
  for (let i = 0; i < 240; i++) {
    if (web.exitCode !== null) throw new Error(`Next exited early; see ${join(previewHome, 'logs', 'web.log')}`);
    try { if ((await nativeFetch(`http://127.0.0.1:${PREVIEW_PORTS.web}/login`)).ok) break; } catch { /* starting */ }
    if (i === 239) throw new Error('Next did not become ready');
    await new Promise((r) => setTimeout(r, 1000));
  }

  const state = { pid: process.pid, startedAt: new Date().toISOString(), web: `http://127.0.0.1:${PREVIEW_PORTS.web}`, api: `http://127.0.0.1:${PREVIEW_PORTS.api}`, control: `http://127.0.0.1:${PREVIEW_PORTS.control}`, database: PREVIEW_DB, redisPrefix: PREVIEW_PREFIX, serviceToken: secrets.serviceToken, ready: true };
  writeFileSync(join(previewHome, 'state.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
  Logger.log('PREVIEW READY', 'preview');
  console.log(`PREVIEW READY web=${PREVIEW_PORTS.web} api=${PREVIEW_PORTS.api} control=${PREVIEW_PORTS.control} db=${PREVIEW_DB}`);

  // A low-disk warning is logged, never a silent stop (a silent self-stop is how the earlier preview vanished).
  setInterval(() => { const g = freeGiB(); if (g < 4) console.warn(`[preview] LOW DISK: ${g.toFixed(1)} GiB free`); }, 60_000).unref();

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('stopping (database, uploads and queue namespace are kept)');
    web.kill('SIGTERM');
    await Promise.allSettled([app.close(), nim.close(), sink.stop(), new Promise((r) => control.close(r)), new Promise((r) => scorer.close(r))]);
    global.fetch = nativeFetch;
    try { writeFileSync(join(previewHome, 'state.json'), JSON.stringify({ ready: false, stoppedAt: new Date().toISOString() })); } catch { /* ignore */ }
    rmSync(join(previewHome, 'preview.pid'), { force: true });
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
