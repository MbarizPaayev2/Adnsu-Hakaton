// Real browser integration harness: Playwright's Chromium with the UNMODIFIED extension, the real API (compiled dist) on a real Postgres, and a Lever-shaped HTTPS fixture.
// Hostnames are mapped at the browser (jobs.lever.co and aisehr.com → local servers) so the extension's production URLs and manifest are exercised as shipped.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { DIR, postingId, startLever } from './fixture-lever.mjs';
import { startProxy } from './proxy-aise.mjs';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(DIR, '../../..');
export const API_DIR = path.join(ROOT, 'apps/api');
const { PrismaClient } = require('@prisma/client');
export const DB_URL = process.env.AGENT_TEST_DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_agent_test?schema=public';
export const API_PORT = 4800, LEVER_PORT = 8443, PROXY_PORT = 8444;
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, { timeout = 60000, every = 400, what = 'condition' } = {}) {
  const start = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`); await sleep(every); }
}

export const WEB_PORT = 4872;
export async function startHarness({ scenarios = {}, headless = true, web = false, env: extraEnv = {} } = {}) {
  if (!/\/aise_agent_test/.test(DB_URL)) throw new Error('refusing to run against a database that is not aise_agent_test');
  fs.mkdirSync(DIR + 'certs', { recursive: true });
  if (!fs.existsSync(DIR + 'certs/cert.pem')) execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', DIR + 'certs/key.pem', '-out', DIR + 'certs/cert.pem', '-days', '30', '-subj', '/CN=jobs.lever.co', '-addext', 'subjectAltName=DNS:jobs.lever.co,DNS:aisehr.com'], { stdio: 'ignore' });
  const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  // The API under test: compiled build, own port, isolated database, agent switches on.
  const api = spawn('node', ['dist/main.js'], {
    cwd: API_DIR, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv, PORT: String(API_PORT), DATABASE_URL: DB_URL, NODE_ENV: 'development', APP_ENV: 'agent-e2e', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379', FRONTEND_URL: web ? `http://127.0.0.1:${WEB_PORT}` : 'http://127.0.0.1:3000', RESEND_API_KEY: 're_mock_key', POSTHOG_API_KEY: '', MATCHING_SERVICE_URL: 'http://127.0.0.1:9', APPLY_WORKER_URL: 'http://127.0.0.1:9', SOURCE_SCHEDULE_ENABLED: 'false', EMAIL_APPLY_ENABLED: 'false', GLORRI_SCRAPER_ENABLED: 'false', EXTERNAL_APPLY_LIVE_ENABLED: 'false', PAYMENTS_ENABLED: 'false', DOCUMENT_GENERATION_ENABLED: 'false', BROWSER_AGENT_ENABLED: 'true', BROWSER_AGENT_AUTONOMOUS_ENABLED: 'true', BROWSER_AGENT_AUTONOMOUS_PORTALS: 'lever', BROWSER_AGENT_MIN_GAP_MS: '1', BROWSER_AGENT_USER_DAILY_LIMIT: '10' },
  });
  let apiLog = ''; api.stdout.on('data', (d) => { apiLog += d; }); api.stderr.on('data', (d) => { apiLog += d; });
  await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${API_PORT}/health/ready`)).ok; } catch { return false; } }, { timeout: 90000, what: `API ready\n${apiLog.slice(-1500)}` });
  let webProc = null;
  if (web) {
    webProc = spawn('npx', ['next', 'start', '-p', String(WEB_PORT), '-H', '127.0.0.1'], { cwd: path.join(ROOT, 'apps/web'), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NEXTAUTH_URL: `http://127.0.0.1:${WEB_PORT}`, NEXTAUTH_SECRET: 'ui-test-secret-0123456789abcdef', NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`, PORT: String(WEB_PORT) } });
    await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${WEB_PORT}/login`)).ok; } catch { return false; } }, { timeout: 90000, what: 'web ready' });
  }
  const lever = await startLever({ port: LEVER_PORT, scenarios });
  const proxy = await startProxy({ port: PROXY_PORT, apiPort: API_PORT });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aise-ext-'));
  const extDir = path.resolve(DIR, '..');
  const context = await chromium.launchPersistentContext(profile, {
    headless: false, ignoreHTTPSErrors: true, executablePath: process.env.AISE_CHROMIUM || undefined, // a preinstalled Chromium when Playwright's own build is not downloaded
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, ...(headless ? ['--headless=new'] : []), `--host-resolver-rules=MAP jobs.lever.co 127.0.0.1:${LEVER_PORT}, MAP aisehr.com 127.0.0.1:${PROXY_PORT}`, '--ignore-certificate-errors', '--no-first-run', '--no-proxy-server'],
  });
  const sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  const base = `http://127.0.0.1:${API_PORT}`;
  const H = {
    prisma, lever, context, sw, extId, apiLog: () => apiLog, stamp: `x${Date.now()}`, n: 0,
    async close() { webProc?.kill('SIGTERM'); await context.close().catch(() => undefined); await proxy.close(); await lever.close(); api.kill('SIGTERM'); await sleep(500); await prisma.$disconnect(); fs.rmSync(profile, { recursive: true, force: true }); },
    web(token) {
      const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } return { status: r.status, body: json }; };
      return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b) };
    },
    /** A candidate with a session and an approved base CV on disk (written through the API's own storage service). */
    async candidate(name = 'Leyla Hüseynova', { password = null, plan = 'PREMIUM' } = {}) {
      const n = ++H.n; const cwd = process.cwd(); process.chdir(API_DIR);
      const { LocalStorageService } = require(path.join(API_DIR, 'dist/resumes/local-storage.service.js'));
      const storage = new LocalStorageService(); process.chdir(cwd);
      const user = await prisma.user.create({ data: { email: `${H.stamp}-${n}@example.com`, hashedPassword: password ? await require('bcrypt').hash(password, 4) : 'x', name, emailVerified: new Date(), subscription: { create: { plan, status: 'active' } } } });
      await prisma.profile.create({ data: { userId: user.id, headline: 'QA mühəndisi', skills: ['QA', 'Playwright'], location: 'Bakı', phone: '+994501234567', jobPreferences: { roles: ['qa engineer'], locations: ['Bakı'], types: [] }, onboardingCompletedAt: new Date() } });
      const token = `tok-${H.stamp}-${n}`; await prisma.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 86_400_000) } });
      const bytes = Buffer.from(`%PDF-1.4\n% synthetic CV ${H.stamp}-${n}\n${'x'.repeat(4000)}\n%%EOF`);
      const fileUrl = await storage.uploadBuffer(bytes, 'application/pdf');
      const resume = await prisma.resume.create({ data: { userId: user.id, isBase: true, status: 'READY', fileUrl, parsedContent: {} } });
      return { id: user.id, email: user.email, token, resumeId: resume.id, cvSha: sha256(bytes), web: H.web(token) };
    },
    async posting(num, userId, { title = 'Middle QA Engineer', score = 0.9, over = {} } = {}) {
      const id = postingId(num);
      const job = await prisma.job.create({ data: { externalId: `xsolla:${H.stamp}-${num}`, title, company: 'Xsolla', description: 'Test automation with Playwright', location: 'Baku', url: `https://jobs.lever.co/xsolla/${id}`, postedAt: new Date(), ...over } });
      await prisma.match.create({ data: { userId, jobId: job.id, score, details: { matchedKeywords: ['qa'] } } });
      return job;
    },
    async campaign(c, over = {}) {
      const scope = { name: 'QA at Xsolla', mode: 'ASSISTED', portals: ['lever'], employerAllow: ['xsolla'], employerDeny: [], targetRoles: ['qa engineer'], locations: [], criteria: { minScore: 0.5, mustInclude: [], mustExclude: [] }, resumeId: c.resumeId, coverNote: null, alwaysAsk: [], dailyLimit: 5, expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), answers: { fullName: 'Leyla Hüseynova', email: 'leyla@example.org', phone: '+994501234567', location: 'Baku', links: { linkedin: 'https://www.linkedin.com/in/leyla-huseynova' }, workAuthorization: 'yes', noticePeriod: '30 days' }, ...over };
      const p = await c.web.post('/agent/campaigns/preview', scope); if (p.status !== 200) throw new Error(`preview ${p.status} ${JSON.stringify(p.body)}`);
      const r = await c.web.post('/agent/campaigns', { scope, consentHash: p.body.consentHash, acknowledged: true }); if (r.status !== 201) throw new Error(`create ${r.status} ${JSON.stringify(r.body)}`);
      return r.body;
    },
    popupUrl: () => `chrome-extension://${extId}/popup/popup.html`,
    /** Pairs the extension with this candidate through the real popup (a fresh code each time). */
    async pair(c) {
      const code = (await c.web.post('/agent/pairing')).body.code;
      await sw.evaluate(() => chrome.storage.local.clear()); // a different candidate: forget the previous pairing
      const popup = await context.newPage(); await popup.goto(H.popupUrl());
      await popup.fill('#code', code); await popup.click('#pair');
      await waitFor(async () => (await popup.locator('#paired').isVisible()) || /fail|invalid|expired|error|vaxtı|yanlış|alınmadı|xəta/i.test(await popup.textContent('#msg')), { what: 'pairing' });
      return popup;
    },
    async poll(popup) { await popup.click('#poll'); },
    async app(id) { return prisma.agentApplication.findUniqueOrThrow({ where: { id } }); },
    async appFor(userId, jobId) { return prisma.agentApplication.findUnique({ where: { userId_jobId: { userId, jobId } } }); },
    async cleanup() { /* rows are scoped by stamp and removed by the test database owner */ },
  };
  return H;
}
