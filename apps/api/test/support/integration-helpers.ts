/** Shared helpers for the browser journeys that run against test/support/integration-stack.ts. Synthetic data only. */
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

export const CFT = `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
export const PASSWORD = 'Integ-Docs-1!';
export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export interface Stack { stamp: number; db: string; databaseUrl: string; prefix: string; web: string; api: string; realApi: string; control: string; sink: string; serviceToken: string; ready: boolean }

export function loadStack(): Stack {
  const stack = JSON.parse(readFileSync(process.env.INTEGRATION_STATE || '/tmp/aise-integration-state.json', 'utf8'));
  if (!stack.ready) throw new Error('Integration stack is not running');
  return stack;
}

export function helpers(stack: Stack) {
  const prisma = new PrismaClient({ datasources: { db: { url: stack.databaseUrl } } });
  const ctl = async (path: string) => (await fetch(`${stack.control}${path}`)).json() as Promise<any>;
  /** Direct to the real API (not through the fault-injecting proxy): seeding and server-side checks. */
  const api = (path: string, token: string, init: RequestInit = {}) =>
    fetch(`${stack.realApi}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  const json = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => null) });

  async function register(email: string): Promise<{ id: string; token: string }> {
    const reg = await fetch(`${stack.realApi}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    if (reg.status !== 201) throw new Error(`register ${reg.status}`);
    const mail = ((await ctl('/mail')) as any[]).filter((m) => m.to === email).pop();
    const token = new URL(/href="([^"]+)"/.exec(mail.html)![1]).searchParams.get('token');
    const ver = await fetch(`${stack.realApi}/auth/verify-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    if (ver.status !== 201) throw new Error(`verify ${ver.status}`);
    const login = await (await fetch(`${stack.realApi}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { id: user.id, token: login.sessionToken };
  }

  async function ingestJob(job: { externalId: string; title: string; company: string; description: string; location?: string; url: string }) {
    const res = await fetch(`${stack.realApi}/internal/jobs/ingest`, {
      method: 'POST', headers: { Authorization: `Bearer ${stack.serviceToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: 'Bakı', postedAt: new Date(Date.now() - 86_400_000).toISOString(), ...job }),
    });
    if (!res.ok) throw new Error(`ingest ${res.status} ${await res.text()}`);
    return res.json();
  }

  async function waitFor<T>(what: string, read: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> {
    const end = Date.now() + ms;
    let last: T | undefined;
    while (Date.now() < end) { last = await read(); if (ok(last)) return last; await new Promise((r) => setTimeout(r, 250)); }
    throw new Error(`${what}: not reached in ${ms} ms (last: ${JSON.stringify(last)?.slice(0, 400)})`);
  }

  let browser: Browser | undefined;
  async function launch() { browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || CFT }); return browser; }
  async function context(viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
    if (!browser) await launch();
    const c = await browser!.newContext({ viewport, acceptDownloads: true, hasTouch: viewport.width < 800 });
    // Nothing leaves the machine; analytics consent stays denied.
    await c.route('**/*', (route) => (['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    await c.addInitScript(() => localStorage.setItem('aise-cookie-consent', 'denied'));
    return c;
  }
  async function login(p: Page, email: string) {
    await p.goto(`${stack.web}/login`);
    await p.locator('#email').fill(email);
    await p.locator('#password').fill(PASSWORD);
    const cb = p.waitForResponse((r) => r.url().includes('/api/auth/callback/credentials') && r.request().method() === 'POST');
    await p.getByRole('button', { name: 'Daxil ol' }).click();
    if ((await cb).status() !== 200) throw new Error('login failed');
    await p.waitForFunction(async (e) => (await (await fetch('/api/auth/session')).json()).user?.email === e, email);
  }
  const shotDir = process.env.INTEGRATION_SHOTS || '/tmp/aise-integration-shots';
  mkdirSync(shotDir, { recursive: true });
  const shot = async (p: Page, name: string) => { await p.screenshot({ path: `${shotDir}/${name}.png`, fullPage: true }); };
  const close = async () => { await browser?.close(); await prisma.$disconnect(); };
  return { prisma, ctl, api, json, register, ingestJob, waitFor, context, login, shot, close, launch };
}

/** Text of a stored/served PDF, extracted by the product's own extractor in a plain Node process (pdf.js is ESM and cannot load in ts-node CJS). */
export async function pdfText(bytes: Buffer): Promise<string> {
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'aise-pdf-'));
  const file = join(dir, 'doc.pdf');
  writeFileSync(file, bytes);
  const script = `require('./src/resumes/cv-extract').extractCvText(require('fs').readFileSync(process.argv[1]), 'application/pdf').then((t) => process.stdout.write(JSON.stringify(t)))`;
  const out = execFileSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--transpile-only', '-e', script, file], { cwd: process.cwd(), timeout: 60_000 });
  return JSON.parse(out.toString()).replace(/\s+/g, ' ');
}
