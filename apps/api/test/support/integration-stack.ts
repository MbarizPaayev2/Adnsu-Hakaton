/**
 * Local, isolated integration stack for real browser journeys: the real API modules, a disposable Postgres database, Redis under a unique
 * BullMQ prefix, the real document worker (queue processor), the real Next.js app, a deterministic loopback generation provider (fake-nim),
 * a loopback capture e-mail sink and a fixture scorer. Nothing leaves this machine: non-loopback fetch is refused.
 *
 * Honest labelling: the generation provider is a deterministic fake (it is NOT a language model); matching scores come from a fixture scorer.
 * Everything else — HTTP routes, guards, validation, Postgres, BullMQ, Typst PDFs, the e-mail pipeline, storage, the Next.js frontend — is the real code.
 *
 * Run from apps/api:  npx ts-node -r tsconfig-paths/register --transpile-only test/support/integration-stack.ts
 * Ports (never the founder's 3450/4010/4598): web 3461, API behind a fault-injecting proxy 4420 (real API 4421), control 4430, sink 4611.
 * Writes the stack's coordinates to INTEGRATION_STATE (default /tmp/aise-integration-state.json) and tears everything down on SIGINT/SIGTERM.
 */
import { Test } from '@nestjs/testing';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import * as express from 'express';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, unlinkSync, writeFileSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';
import IORedis from 'ioredis';
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
import { PrismaService } from '../../src/database/database.service';
import { EmailService } from '../../src/common/email.service';


const PORTS = { web: 3461, proxy: 4420, api: 4421, control: 4430, sink: 4611 };
const STATE = process.env.INTEGRATION_STATE || '/tmp/aise-integration-state.json';
const stamp = Date.now();
const DB_NAME = `aise_integration_${stamp}`;
const PG = 'postgresql://postgres:postgrespassword@127.0.0.1:5433';
const prefix = `aise-integ-${process.pid}-${stamp}`;
const root = resolve(__dirname, '../../../..');
const uploadDir = join(process.cwd(), 'uploads');

async function main() {
  if ([3450, 4010, 4598].some((p) => Object.values(PORTS).includes(p))) throw new Error('Refusing to use the founder preview ports');
  const filesBefore = new Set(existsSync(uploadDir) ? readdirSync(uploadDir) : []);

  // ── disposable database ───────────────────────────────────────────────────────────────────────
  execFileSync('docker', ['exec', 'aise-postgres', 'psql', '-U', 'postgres', '-c', `CREATE DATABASE ${DB_NAME}`], { stdio: 'ignore' });
  const databaseUrl = `${PG}/${DB_NAME}?schema=public`;
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'ignore' });
  process.env.DATABASE_URL = databaseUrl;
  // Importing into a reviewed collector's source (work, hellojob, ...) requires that source's lease, which only a real importer holds; the journeys' synthetic
  // postings come from their own registered, clearly synthetic source instead.
  execFileSync('docker', ['exec', 'aise-postgres', 'psql', '-U', 'postgres', '-d', DB_NAME, '-c', `INSERT INTO "JobSource" ("key","name","homepageUrl","collectionMethod","scope","accessReview","applicationMethods","enabled","scheduled","updatedAt") VALUES ('integ','Integration journeys (synthetic)','https://integ.example','synthetic-seed','Synthetic postings for browser journeys','UNREVIEWED',ARRAY['EXTERNAL_SITE']::"ApplicationMethod"[],true,false,CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING`], { stdio: 'ignore' });

  // ── loopback services ─────────────────────────────────────────────────────────────────────────
  const nim = await startFakeNim();
  const sink = new FakeProvider();
  const sinkUrl = await sink.start(PORTS.sink);
  const scorer = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') return void res.end('{}');
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const score = (persona: any) => ({ score: String(persona.summary).includes('PostgreSQL') || JSON.stringify(persona).includes('PostgreSQL') ? 0.91 : 0.65, matchedKeywords: ['TypeScript'], breakdown: {}, gaps: [] });
    const results = req.url === '/score-profile' ? body.jobs.map((j: any) => ({ jobId: j.clientId, source: 'job', ...score(body.persona) })) : body.profiles.map((p: any) => ({ profileId: p.profileId, ...score(p.persona) }));
    res.end(JSON.stringify({ results }));
  });
  await new Promise<void>((r) => scorer.listen(0, '127.0.0.1', r));
  const scorerUrl = `http://127.0.0.1:${(scorer.address() as AddressInfo).port}`;

  const serviceToken = randomBytes(16).toString('hex');
  Object.assign(process.env, {
    NODE_ENV: 'test', APP_ENV: 'integration', RESEND_API_KEY: 're_mock_key', POSTHOG_API_KEY: '', FRONTEND_URL: `http://127.0.0.1:${PORTS.web}`,
    GLORRI_SCRAPER_ENABLED: 'false', EXTERNAL_APPLY_LIVE_ENABLED: 'false', PAYMENTS_ENABLED: 'false', DODO_PAYMENTS_API_KEY: 'mock_dodo_api_key',
    MATCHING_SERVICE_URL: scorerUrl, MATCHING_SERVICE_TOKEN: 'integration-token', SCRAPER_SERVICE_TOKEN: serviceToken,
    NVIDIA_API_KEY: 'fake-local-key', NIM_API_URL: nim.url, TAILOR_AZ_FREE_WRITING: 'true', TAILOR_MAX_CALLS: '3', TAILOR_TIMEOUT_MS: '5000', TAILOR_MAX_RETRY_WAIT_MS: '20',
    EMAIL_APPLY_ENABLED: 'true', EMAIL_APPLY_TRANSPORT: 'sink', EMAIL_APPLY_SINK_URL: sinkUrl, EMAIL_APPLY_FROM: 'AISE <applications@aise.example>',
    EMAIL_APPLY_WEBHOOK_SECRET: `whsec_${Buffer.from('integration-secret').toString('base64')}`,
    EMAIL_APPLY_USER_DAILY_LIMIT: '50', EMAIL_APPLY_GLOBAL_DAILY_LIMIT: '5000', EMAIL_APPLY_RECIPIENT_DAILY_LIMIT: '50',
  });
  delete process.env.TAILOR_DAILY_LIMIT;

  // Nothing leaves this machine.
  const nativeFetch = global.fetch;
  global.fetch = (async (input: any, init?: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`Integration stack refuses external traffic: ${url.hostname}`);
    return nativeFetch(input, init);
  }) as typeof fetch;

  // ── API: the real modules (everything AppModule loads except the Glorri cron), under a private queue prefix ──
  const modules = [ DatabaseModule, HealthModule, AuthModule, ProfilesModule, JobsModule, MatchingModule, NotificationsModule, ResumesModule, BillingModule, SavedModule, AlertsModule, TelegramModule, TimelineModule, AccountsModule, DashboardModule, BusinessModule, CompaniesModule, ObservedCompaniesModule, VacanciesModule, JobApplicationsModule, AdminModule, ExternalApplyModule, VolunteeringModule, UploadsModule, EmailApplicationsModule ];
  const testing = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    BullModule.forRoot({ prefix, connection: { host: '127.0.0.1', port: 6379 } }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100_000 }]),
    ...modules,
  ] }).compile();
  const app = testing.createNestApplication({ bodyParser: false, logger: ['error', 'warn'] });
  app.use('/webhooks/resend', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '512kb' }));
  app.use(express.urlencoded({ extended: true }));
  app.enableCors({ origin: `http://127.0.0.1:${PORTS.web}`, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  await app.listen(PORTS.api, '127.0.0.1');
  const prisma = app.get(PrismaService);
  const emails = app.get(EmailService);

  // ── fault-injecting proxy in front of the API (the browser talks to this) ─────────────────────────
  const failBeforeForward: string[] = []; // path patterns answered 500 WITHOUT reaching the API (an outage in front of it)
  const truncateAfterForward: string[] = []; // forward, then send the status line and part of the body and cut the connection
  const dropAfterForward: string[] = []; // path patterns: forward the request, discard the answer, cut the connection
  const delays: { match: string; ms: number }[] = [];
  const proxyLog: { method: string; path: string; status: number | 'dropped' }[] = [];
  const proxy = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (v && !['host', 'connection', 'content-length', 'transfer-encoding'].includes(k)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
    const path = req.url || '/';
    const failAt = failBeforeForward.findIndex((p) => `${req.method} ${path.split('?')[0]}` === p);
    if (failAt >= 0) {
      failBeforeForward.splice(failAt, 1);
      proxyLog.push({ method: req.method || '', path, status: 500 });
      res.writeHead(500, { 'content-type': 'application/json', 'access-control-allow-origin': req.headers.origin || '*', 'access-control-allow-credentials': 'true' });
      return void res.end(JSON.stringify({ statusCode: 500, message: 'Injected failure: the request never reached the API' }));
    }
    const delay = delays.find((d) => path.startsWith(d.match));
    if (delay) await new Promise((r) => setTimeout(r, delay.ms));
    const upstream = await nativeFetch(`http://127.0.0.1:${PORTS.api}${path}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : body, redirect: 'manual' });
    const answer = Buffer.from(await upstream.arrayBuffer());
    const cutAt = truncateAfterForward.findIndex((p) => `${req.method} ${path.split('?')[0]}` === p);
    if (cutAt >= 0) {
      truncateAfterForward.splice(cutAt, 1);
      proxyLog.push({ method: req.method || '', path, status: 'dropped' });
      res.writeHead(upstream.status, { 'content-type': 'application/json', 'content-length': String(answer.length), 'access-control-allow-origin': req.headers.origin || '*', 'access-control-allow-credentials': 'true' });
      res.write(answer.subarray(0, Math.max(1, Math.floor(answer.length / 3))));
      setTimeout(() => req.socket.destroy(), 20);
      return;
    }
    const dropAt = dropAfterForward.findIndex((p) => `${req.method} ${path.split('?')[0]}` === p);
    if (dropAt >= 0) {
      dropAfterForward.splice(dropAt, 1);
      proxyLog.push({ method: req.method || '', path, status: 'dropped' });
      req.socket.destroy();
      return;
    }
    proxyLog.push({ method: req.method || '', path, status: upstream.status });
    const out: Record<string, string> = {};
    upstream.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) out[k] = v; });
    res.writeHead(upstream.status, out);
    res.end(answer);
  });
  await new Promise<void>((r) => proxy.listen(PORTS.proxy, '127.0.0.1', r));

  // ── control surface for the scenario scripts ─────────────────────────────────────────────────────
  const control = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    const reply = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (url.pathname === '/nim/mode') { nim.setMode(url.searchParams.get('mode') as any); return reply(200, { ok: true }); }
      if (url.pathname === '/nim/release') { nim.release(); return reply(200, { ok: true }); }
      if (url.pathname === '/nim/requests') return reply(200, nim.requests.map((r) => ({ kind: r.kind, system: r.system, motivation: r.motivation, fixed: r.fixed, persona: r.persona, job: r.job })));
      if (url.pathname === '/proxy/drop-next') { dropAfterForward.push(url.searchParams.get('route')!); return reply(200, { pending: dropAfterForward.length }); }
      if (url.pathname === '/proxy/truncate-next') { truncateAfterForward.push(url.searchParams.get('route')!); return reply(200, { pending: truncateAfterForward.length }); }
      if (url.pathname === '/proxy/fail-next') { failBeforeForward.push(url.searchParams.get('route')!); return reply(200, { pending: failBeforeForward.length }); }
      if (url.pathname === '/proxy/delay') { delays.push({ match: url.searchParams.get('match')!, ms: Number(url.searchParams.get('ms')) }); return reply(200, { ok: true }); }
      if (url.pathname === '/proxy/clear') { delays.length = 0; dropAfterForward.length = 0; failBeforeForward.length = 0; truncateAfterForward.length = 0; return reply(200, { ok: true }); }
      if (url.pathname === '/proxy/log') return reply(200, proxyLog);
      if (url.pathname === '/mail') return reply(200, emails.getCapturedEmails().map((e: any) => ({ to: e.to, subject: e.subject, html: e.html })));
      if (url.pathname === '/sink/messages') return reply(200, sink.messages.map((x) => ({ id: x.id, to: x.to, bcc: x.bcc, replyTo: x.replyTo, subject: x.subject, text: x.text, tags: x.tags, attachments: x.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, bytes: a.bytes, sha256: a.sha256 })) })));
      if (url.pathname === '/sink/attachment') { const f = sink.messages.find((x) => x.id === url.searchParams.get('id'))?.attachments[Number(url.searchParams.get('i'))]; if (!f) return reply(404, {}); res.writeHead(200, { 'content-type': 'application/octet-stream' }); return void res.end(f.content); }
      if (url.pathname === '/sink/emit') {
        const secret = process.env.EMAIL_APPLY_WEBHOOK_SECRET!;
        const out = await sink.emit(`http://127.0.0.1:${PORTS.api}/webhooks/resend`, secret, { type: url.searchParams.get('type')!, messageId: url.searchParams.get('id')!, applicationTag: url.searchParams.get('tag')!, to: [url.searchParams.get('to')!] } as any);
        return reply(200, out);
      }
      if (url.pathname === '/prisma-ping') { await prisma.$queryRaw`SELECT 1`; return reply(200, { ok: true }); }
      return reply(404, { error: 'unknown' });
    } catch (error) { return reply(500, { error: (error as Error).message }); }
  });
  await new Promise<void>((r) => control.listen(PORTS.control, '127.0.0.1', r));

  // ── the real Next.js app ───────────────────────────────────────────────────────────────────────
  const logPath = `/tmp/aise-integration-next-${stamp}.log`;
  const log = openSync(logPath, 'w', 0o600);
  // The founder's own `next dev` for apps/web may already be running (it holds that directory's dev lock), so this stack serves a throw-away copy of the
  // same sources from a sibling directory; it is removed again at teardown and is never committed.
  const webCopy = resolve(root, 'apps/web-integration-tmp');
  rmSync(webCopy, { recursive: true, force: true });
  // The copy gets its OWN node_modules (the workspace's few web-only packages, copied, not symlinked): Next resolves packages from the copy and from the
  // workspace root above it, and Turbopack rejects a symlinked node_modules ("points out of the filesystem root"). Webpack is used for the dev server because
  // it resolves this layout reliably; the production build (`next build`) is verified separately.
  execFileSync('rsync', ['-a', '--exclude', '.next', '--exclude', '*.tsbuildinfo', `${resolve(root, 'apps/web')}/`, `${webCopy}/`]);
  const web: ChildProcess = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(PORTS.web)], {
    cwd: webCopy, stdio: ['ignore', log, log],
    env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_API_URL: `http://127.0.0.1:${PORTS.proxy}`, NEXTAUTH_URL: `http://127.0.0.1:${PORTS.web}`, NEXTAUTH_SECRET: randomBytes(32).toString('hex'), NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_DOCUMENTS_MODE: '', NEXT_PUBLIC_RETENTION_MODE: '' },
  });
  for (let i = 0; i < 180; i++) {
    if (web.exitCode !== null) throw new Error(`Next exited early; see ${logPath}`);
    try { if ((await nativeFetch(`http://127.0.0.1:${PORTS.web}/login`)).ok) break; } catch { /* starting */ }
    if (i === 179) throw new Error('Next did not become ready');
    await new Promise((r) => setTimeout(r, 1000));
  }

  writeFileSync(STATE, JSON.stringify({ stamp, db: DB_NAME, databaseUrl, prefix, web: `http://127.0.0.1:${PORTS.web}`, api: `http://127.0.0.1:${PORTS.proxy}`, realApi: `http://127.0.0.1:${PORTS.api}`, control: `http://127.0.0.1:${PORTS.control}`, sink: sinkUrl, serviceToken, nextLog: logPath, ready: true }, null, 2));
  Logger.log(`INTEGRATION STACK READY (state: ${STATE})`, 'integration');
  console.log(`INTEGRATION STACK READY web=${PORTS.web} api(proxy)=${PORTS.proxy} db=${DB_NAME} prefix=${prefix}`);

  const stop = async () => {
    console.log('tearing down');
    web.kill('SIGTERM');
    rmSync(webCopy, { recursive: true, force: true });
    await Promise.allSettled([app.close(), nim.close(), sink.stop(), new Promise((r) => proxy.close(r)), new Promise((r) => control.close(r)), new Promise((r) => scorer.close(r))]);
    global.fetch = nativeFetch;
    const redis = new IORedis({ host: '127.0.0.1', port: 6379 });
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    for (const f of existsSync(uploadDir) ? readdirSync(uploadDir) : []) if (!filesBefore.has(f)) { try { unlinkSync(join(uploadDir, f)); } catch { /* ignore */ } }
    try { execFileSync('docker', ['exec', 'aise-postgres', 'psql', '-U', 'postgres', '-c', `DROP DATABASE ${DB_NAME} WITH (FORCE)`], { stdio: 'ignore' }); } catch { /* ignore */ }
    try { writeFileSync(STATE, JSON.stringify({ ready: false })); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
main().catch((e) => { console.error(e); process.exit(1); });
