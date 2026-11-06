/**
 * Cloud-host measurement of the real worker against the local fixture ATS:
 * concurrent fill latency, confirm latency and memory (PSS, which does not
 * double-count Chromium's shared pages) with N live sessions. Synthetic data;
 * only the fixture host is reachable. Run from apps/apply-worker:
 *   npx ts-node --transpile-only test/measure-sessions.ts
 * These numbers describe this test container, not production capacity.
 */
import { execSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { cpus, totalmem, tmpdir } from 'os';
import { join } from 'path';
import { chromium } from 'playwright';
import { BrowserSessionManagerService } from '../src/sessions/browser-session-manager.service';
import { SessionsService } from '../src/sessions/sessions.service';
import { noticeFingerprint } from '../src/sessions/adapters/glorri-apply.adapter';
import { FixtureAts, FIXTURE_DECLARATION, FIXTURE_POLICY_URL, routeDestinationToFixture } from './support/fixture-ats';

const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

function pssKiB(pid: number): number {
  try {
    const m = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

function chromePids(): number[] {
  const out = execSync("pgrep -f 'chrome-linux/chrome' || true").toString().trim();
  // Only real Chromium processes (pgrep's own shell also matches the pattern).
  return (out ? out.split('\n').map(Number) : []).filter((pid) => {
    try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')[0].includes('chrome-linux/chrome'); } catch { return false; }
  });
}

const mib = (kib: number) => (kib / 1024).toFixed(0);
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

async function main() {
  const fixture = new FixtureAts();
  await fixture.start();
  const dir = mkdtempSync(join(tmpdir(), 'aise-measure-'));
  writeFileSync(join(dir, 'cv.pdf'), Buffer.alloc(200 * 1024, 1));
  writeFileSync(join(dir, 'id.png'), Buffer.alloc(300 * 1024, 2));
  const data = {
    firstName: 'Sintetik', lastName: 'Namizəd', email: 'synthetic@example.com', phone: '+994500000000', address: 'Sintetik küçə 1',
    citizenship: 'Azərbaycan', dob: '05/05/1995', salary: '2000', netGross: 'Net', currency: 'AZN',
    resumeFilePath: join(dir, 'cv.pdf'), idPhotoFilePath: join(dir, 'id.png'), motivationLetter: 'Sintetik motivasiya məktubu.',
  };
  const authority = { noticeHash: noticeFingerprint(FIXTURE_DECLARATION, FIXTURE_POLICY_URL), noticeVersion: 'fixture-1' };
  process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'true';
  process.env.EXTERNAL_APPLY_SEND_OBSERVE_MS = '8000';
  const baselineChrome = chromePids().length;
  console.log(`Host: ${cpus().length} vCPU, ${(totalmem() / 1024 ** 3).toFixed(1)} GiB RAM, Chromium ${CHROME}; baseline node PSS ${mib(pssKiB(process.pid))} MiB, Chromium processes already running ${baselineChrome}`);
  console.log('| live sessions | fill p50 / max (s) | confirm p50 / max (s) | worker node PSS (MiB) | Chromium PSS total (MiB) | per session (MiB) |');
  console.log('|---|---|---|---|---|---|');
  let seq = 0;
  for (const n of [1, 2, 4, 6]) {
    process.env.EXTERNAL_APPLY_MAX_SESSIONS = String(n);
    const manager = new BrowserSessionManagerService();
    const service = new SessionsService(manager);
    service.launchBrowser = () => chromium.launch({ headless: true, executablePath: CHROME });
    service.prepareContext = routeDestinationToFixture(fixture.origin);
    const ids = Array.from({ length: n }, () => `normal-${++seq}`);
    const fills: number[] = [];
    await Promise.all(ids.map(async (id) => {
      const t = Date.now();
      const r = await service.launchAndFill(id, `https://jobs.glorri.com/vacancies/fixture/${id}/apply`, data, authority);
      if (r.status !== 'READY_FOR_REVIEW') throw new Error(`fill ${id}: ${r.status} ${r.code}`);
      fills.push((Date.now() - t) / 1000);
    }));
    const chrome = chromePids().reduce((sum, pid) => sum + pssKiB(pid), 0);
    const node = pssKiB(process.pid);
    const confirms: number[] = [];
    await Promise.all(ids.map(async (id, i) => {
      const t = Date.now();
      const r = await service.confirmSubmit(id, `${String(seq * 10 + i).padStart(8, '0')}-2222-4222-8222-222222222222`, false);
      if (r.outcome !== 'SENT_OBSERVED') throw new Error(`confirm ${id}: ${r.outcome}`);
      confirms.push((Date.now() - t) / 1000);
    }));
    await manager.onModuleDestroy();
    console.log(`| ${n} | ${pct(fills, 50).toFixed(1)} / ${Math.max(...fills).toFixed(1)} | ${pct(confirms, 50).toFixed(1)} / ${Math.max(...confirms).toFixed(1)} | ${mib(node)} | ${mib(chrome)} | ${mib(chrome / n)} |`);
  }
  await new Promise((r) => setTimeout(r, 500));
  console.log(`Chromium processes after cleanup: ${chromePids().length - baselineChrome} (expected 0)`);
  await fixture.stop();
  rmSync(dir, { recursive: true, force: true });
}

main().catch((error) => { console.error('MEASURE_FAILED', error.message); process.exitCode = 1; });
