/** Local public browsing rehearsal. No full API workers, scoring, email, or source requests. */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../apps/api/src/database/database.service';
import { JobCatalogueController } from '../apps/api/src/jobs/job-catalogue.controller';
import { JobCatalogueService } from '../apps/api/src/jobs/job-catalogue.service';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

async function main() {
  process.env.DATABASE_URL ||= 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_phase2_test?schema=public';
  const db = new URL(process.env.DATABASE_URL);
  if (db.hostname !== '127.0.0.1' || db.port !== '5433' || db.pathname !== '/aise_phase2_test') throw new Error('Requires isolated local aise_phase2_test');
  const stamp = `cataloguebrowser-${Date.now()}`;
  const module = await Test.createTestingModule({ controllers: [JobCatalogueController], providers: [PrismaService, JobCatalogueService] }).compile();
  const app = module.createNestApplication();
  const prisma = app.get(PrismaService);
  let web: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const log = createWriteStream(`/tmp/${stamp}-next.log`);
  try {
    await app.listen(4020, '127.0.0.1');
    const imports = [];
    for (let i = 0; i < 25; i++) imports.push(await prisma.job.create({ data: {
      externalId: `cataloguebrowser:${stamp}-${i}`, title: i % 2 ? 'Backend developer' : 'Mühasib',
      company: `${stamp} Labs`, location: i % 2 ? 'Bakı' : 'Gəncə', description: 'Public synthetic vacancy only.',
      url: 'https://www.hellojob.az/vakansiya/synthetic', postedAt: new Date(Date.now() - i * 60_000), rawPayload: {},
    } }));
    const business = await prisma.business.create({ data: { email: `${stamp}@example.com`, hashedPassword: 'synthetic-not-loginable' } });
    const company = await prisma.company.create({ data: { businessId: business.id, name: `${stamp} employer`, status: 'APPROVED' } });
    const native = await prisma.vacancy.create({ data: { companyId: company.id, title: 'HR mütəxəssisi', description: 'Synthetic native job.', skills: [], status: 'ACTIVE' } });
    web = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3460'], {
      cwd: resolve('apps/web'), env: { ...process.env, NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4020', NEXTAUTH_URL: 'http://127.0.0.1:3460', NEXTAUTH_SECRET: 'local-catalogue-rehearsal-only' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    web.stdout!.pipe(log, { end: false }); web.stderr!.pipe(log, { end: false });
    const base = 'http://127.0.0.1:3460';
    let ready = false;
    for (let i = 0; i < 90; i++) {
      if (web.exitCode !== null) throw new Error(`Next exited ${web.exitCode}; see /tmp/${stamp}-next.log`);
      try { ready = (await fetch(`${base}/jobs?q=${stamp}`, { signal: AbortSignal.timeout(5000) })).ok; } catch { /* Starting. */ }
      if (ready) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert(ready, 'Next ready');
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(`${base}/jobs?q=${stamp}`);
    const consent = page.getByRole('button', { name: 'Yalnız zəruri', exact: true });
    if (await consent.isVisible()) await consent.click();
    assert.equal(await page.locator('main li').count(), 20);
    await page.getByRole('link', { name: 'Növbəti səhifə' }).click();
    await page.waitForURL(/page=2/);
    assert.equal(await page.locator('main li').count(), 6);
    assert(new URL(page.url()).searchParams.get('q') === stamp);
    console.log('PASS unauthenticated global pagination and filter preservation');
    await page.getByLabel('Kateqoriya', { exact: true }).selectOption('technology');
    await page.getByLabel('Şəhər', { exact: true }).fill('Baku');
    await page.getByRole('button', { name: 'Axtar', exact: true }).click();
    await page.waitForURL(/category=technology/);
    assert.equal(await page.locator('main li').count(), 12);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}`);
      await page.screenshot({ path: `/tmp/${stamp}-${width}.png`, fullPage: true });
    }
    console.log('PASS category/city browsing and 390/768/1440 layouts');
    await page.goto(`${base}/jobs/imported/${imports[1].id}`);
    assert.equal(await page.getByRole('link', { name: 'Mənbədə bax və müraciət et ↗', exact: true }).getAttribute('href'), 'https://www.hellojob.az/vakansiya/synthetic');
    await page.goto(`${base}/jobs/native/${native.id}`);
    assert.equal(await page.getByRole('link', { name: 'AISE-də müraciət et', exact: true }).getAttribute('href'), `/dashboard/companies/${company.id}/vacancies/${native.id}/apply`);
    console.log('PASS original-source link and existing native-apply link (no submission)');
    console.log(`Screenshots and Next log: /tmp/${stamp}-*`);
  } finally {
    await browser?.close();
    if (web && web.exitCode === null) {
      web.kill('SIGTERM');
      await Promise.race([new Promise((r) => web!.once('exit', r)), new Promise((r) => setTimeout(r, 5000))]);
      if (web.exitCode === null) web.kill('SIGKILL');
    }
    log.end();
    await prisma.job.deleteMany({ where: { externalId: { startsWith: `cataloguebrowser:${stamp}` } } });
    await prisma.business.deleteMany({ where: { email: `${stamp}@example.com` } });
    await app.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
