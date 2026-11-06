/**
 * Real-browser journeys for the vacancy-source side of the integrated product, over the integration stack (real Next.js app, real API, Postgres, Redis/BullMQ),
 * on isolated synthetic data. Nothing leaves the machine: the stack refuses non-loopback traffic, so no source is ever contacted, and no schedule is on.
 *   Start the stack:  npx ts-node -r tsconfig-paths/register --transpile-only test/support/integration-stack.ts
 *   Run (apps/api):   npx ts-node -r tsconfig-paths/register --transpile-only test/integration-sources-journeys.ts
 * Covers: source leases on ingestion; admin source controls and permissions; the catalogue's counts; and that an unavailable source never looks healthy.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { type Page } from 'playwright';
import { helpers, loadStack } from './support/integration-helpers';

const stack = loadStack();
const h = helpers(stack);
const prisma = h.prisma;
const S = `${Date.now()}`;
const PASSWORD = 'Sources-Synthetic-Pass-1';
const passed: string[] = [];
const ok = (m: string) => { passed.push(m); console.log(`PASS ${m}`); };
const ago = (ms: number) => new Date(Date.now() - ms);
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const svc = (path: string, init: RequestInit = {}) => fetch(`${stack.realApi}${path}`, { ...init, headers: { Authorization: `Bearer ${stack.serviceToken}`, 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) } });
const job = (externalId: string, over: Record<string, unknown> = {}) => ({ externalId, title: `Synthetic ${externalId}`, company: `Katalog ${S} MMC`, description: 'Synthetic public vacancy for the integration journey.', location: 'Bakı', url: `https://example.org/${externalId}`, postedAt: ago(DAY).toISOString(), ...over });
const adminApi = (token: string, path: string, init: RequestInit = {}) => fetch(`${stack.realApi}/admin/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });

async function admin(role: 'ADMIN' | 'SUPPORT') {
  const email = `sources-${role.toLowerCase()}-${S}@example.com`;
  const user = await prisma.adminUser.create({ data: { email, name: `${role} (sintetik)`, hashedPassword: await bcrypt.hash(PASSWORD, 10), role, passwordChangedAt: new Date() } });
  const sessionToken = randomBytes(24).toString('hex');
  await prisma.adminSession.create({ data: { sessionToken, adminUserId: user.id, expires: new Date(Date.now() + HOUR), mfaVerified: false } });
  return { email, id: user.id, token: sessionToken };
}
async function signIn(page: Page, email: string) {
  await page.goto(`${stack.web}/admin`);
  await page.getByLabel('E-poçt').fill(email);
  await page.getByLabel('Şifrə').fill(PASSWORD);
  await page.getByRole('button', { name: 'Daxil ol' }).click();
  await page.waitForURL((u) => u.pathname === '/admin/overview');
}
const opsCell = (page: Page, key: string) => page.getByTestId(`source-ops-${key}`);

(async () => {
  const adminUser = await admin('ADMIN');
  const support = await admin('SUPPORT');

  // ── 1. Source leases on ingestion (API level, the same routes every importer uses) ────────────────────────────────────────────
  {
    const id = `work:lease${S}`;
    const refused = await svc('/internal/jobs/ingest', { method: 'POST', body: JSON.stringify(job(id)) });
    assert.equal(refused.status, 409, 'a collector source refuses an ingest that carries no lease');
    assert.equal(await prisma.job.count({ where: { externalId: id } }), 0, 'and stores nothing');
    const refusedConfirm = await svc('/internal/jobs/confirm-listed', { method: 'POST', body: JSON.stringify({ externalIds: [id] }) });
    assert.equal(refusedConfirm.status, 409, 'confirm-listed needs the lease too');
    const refusedRun = await svc('/internal/jobs/import-runs', { method: 'POST', body: JSON.stringify({ source: 'work', startedAt: new Date().toISOString(), complete: true, pages: 1, discovered: 0, fetched: 0, accepted: 0, created: 0, updated: 0, unchanged: 0, reopened: 0, expired: 0, skipped: 0, failed: 0 }) });
    assert.equal(refusedRun.status, 409, 'recording a run needs the lease too');

    const got = await svc('/internal/jobs/source-lease', { method: 'POST', body: JSON.stringify({ source: 'work', action: 'acquire' }) });
    assert.equal(got.status, 201);
    const token = (await got.json()).token as string;
    const second = await svc('/internal/jobs/source-lease', { method: 'POST', body: JSON.stringify({ source: 'work', action: 'acquire' }) });
    assert.equal(second.status, 409, 'a second importer cannot take a held source');
    assert.equal((await second.json()).code, 'SOURCE_LEASE_HELD');
    const wrong = await svc('/internal/jobs/ingest', { method: 'POST', headers: { 'x-source-lease': 'cli:not-the-token' }, body: JSON.stringify(job(id)) });
    assert.equal(wrong.status, 409, 'a wrong token is no lease');
    const written = await svc('/internal/jobs/ingest', { method: 'POST', headers: { 'x-source-lease': token }, body: JSON.stringify(job(id)) });
    assert.equal(written.status, 201, 'the holder can ingest');
    assert.equal(await prisma.job.count({ where: { externalId: id } }), 1);
    // The operator's run-now cannot overlap the holder either.
    const op = await adminApi(adminUser.token, 'ops/sources/work/run-now', { method: 'POST' });
    assert.equal(op.status, 409, 'run-now is refused while another process holds the source');
    assert.match(JSON.stringify(await op.json()), /başqa proses \(cli\)/);
    const rel = await svc('/internal/jobs/source-lease', { method: 'POST', body: JSON.stringify({ source: 'work', action: 'release', token }) });
    assert.equal((await rel.json()).ok, true);
    const after = await svc('/internal/jobs/ingest', { method: 'POST', body: JSON.stringify(job(id)) });
    assert.equal(after.status, 409, 'after release the source is closed to unleased writes again');
    // A source without a reviewed collector (the synthetic one the document journeys use) is not gated.
    const free = await svc('/internal/jobs/ingest', { method: 'POST', body: JSON.stringify(job(`integ:lease${S}`)) });
    assert.equal(free.status, 201, 'a non-collector source is unaffected');
    await prisma.job.deleteMany({ where: { externalId: { in: [id, `integ:lease${S}`] } } });
    ok('leases: unleased ingest, confirm-listed and run recording are refused for a collector source; a second holder, a wrong token and the operator run-now are refused; the holder writes; release closes it again; a non-collector source is not gated');
  }

  // ── 2. Catalogue counts exclude expired, hidden, duplicate and closed postings ─────────────────────────────────────────────────
  {
    const q = `Katalog ${S}`;
    const open = ['o1', 'o2', 'o3'].map((n) => `integ:cat${S}-${n}`);
    for (const id of open) assert.equal((await svc('/internal/jobs/ingest', { method: 'POST', body: JSON.stringify(job(id)) })).status, 201);
    const bad = { expired: `integ:cat${S}-expired`, hidden: `integ:cat${S}-hidden`, dup: `integ:cat${S}-dup`, closed: `integ:cat${S}-closed` };
    for (const id of Object.values(bad)) assert.equal((await svc('/internal/jobs/ingest', { method: 'POST', body: JSON.stringify(job(id)) })).status, 201);
    const first = await prisma.job.findUniqueOrThrow({ where: { externalId: open[0] } });
    await prisma.job.update({ where: { externalId: bad.expired }, data: { deadline: ago(2 * DAY) } });
    await prisma.job.update({ where: { externalId: bad.hidden }, data: { hiddenAt: new Date() } });
    await prisma.job.update({ where: { externalId: bad.dup }, data: { duplicateOfId: first.id } });
    await prisma.job.update({ where: { externalId: bad.closed }, data: { status: 'CLOSED' } });
    const list = await (await fetch(`${stack.realApi}/jobs?q=${encodeURIComponent(q)}&limit=50`)).json();
    assert.equal(list.meta.total, 3, 'the public catalogue lists exactly the three open, visible, unique postings');
    assert.deepEqual(list.data.map((j: { title: string }) => j.title).sort(), open.map((id) => `Synthetic ${id}`).sort());
    // The browser shows the same.
    const ctx = await h.context();
    const page = await ctx.newPage();
    await page.goto(`${stack.web}/jobs?q=${encodeURIComponent(q)}`);
    await page.getByText(`Synthetic ${open[0]}`).first().waitFor();
    const text = await page.locator('main').innerText();
    for (const id of open) assert.ok(text.includes(`Synthetic ${id}`), `${id} is shown`);
    for (const id of Object.values(bad)) assert.ok(!text.includes(`Synthetic ${id}`), `${id} is not shown`);
    assert.equal(await page.locator('main h2 a[href^="/jobs/imported/"]').count(), 3);
    // The admin coverage counts the same way: the synthetic source's open count rose by exactly the three, its excluded ones are counted apart.
    const cov = await (await adminApi(adminUser.token, 'ops/sources')).json();
    const integ = cov.sources.find((s: { key: string }) => s.key === 'integ');
    const ours = await prisma.job.count({ where: { externalId: { startsWith: `integ:cat${S}-` } } });
    assert.equal(ours, 7);
    const openIntegAll = await prisma.job.count({ where: { externalId: { startsWith: 'integ:' }, status: 'ACTIVE', hiddenAt: null, duplicateOfId: null, OR: [{ deadline: null }, { deadline: { gte: new Date() } }] } });
    assert.equal(integ.counts.open, openIntegAll, 'the admin open count uses the same predicate as the catalogue');
    assert.ok(integ.counts.hidden >= 1 && integ.counts.duplicates >= 1 && integ.counts.expiredByDeadline >= 1 && integ.counts.closed >= 1, 'excluded postings are reported apart, not dropped silently');
    assert.equal(cov.openPostings >= 3, true);
    await ctx.close();
    ok('catalogue: 7 stored synthetic postings, 3 open and visible; expired, hidden, duplicate and closed ones are absent from the public API and the browser, and the admin open count follows the same predicate while reporting the excluded ones apart');
  }

  // ── 3. An unavailable source never looks healthy (browser, admin sources page) ─────────────────────────────────────────────────
  const M: Record<string, { name: string; data: Record<string, unknown>; runs?: Record<string, unknown>[]; expect: RegExp; not?: RegExp }> = {};
  const seed = (suffix: string, name: string, data: Record<string, unknown>, runs: Record<string, unknown>[], expect: RegExp, not = /Sağlam/) => { M[`h${S}${suffix}`] = { name, data, runs, expect, not }; };
  const run = (status: string, over: Record<string, unknown> = {}) => ({ status, startedAt: ago(5 * MIN), finishedAt: ago(4 * MIN), listed: 5, created: 1, ...over });
  seed('a', `Sağlam nəzarət ${S}`, { enabled: true, scheduled: true, intervalMinutes: 60, nextRunAt: new Date(Date.now() + HOUR) }, [run('SUCCEEDED', { listingComplete: true })], /Sağlam/, /^NEVER$/);
  seed('b', `Söndürülmüş ${S}`, { enabled: false, scheduled: true }, [run('SUCCEEDED')], /Söndürülüb/);
  seed('c', `Dayandırılmış ${S}`, { enabled: true, scheduled: true, schedulePausedAt: new Date() }, [run('SUCCEEDED')], /Dayandırılıb/);
  seed('d', `Soyutmada ${S}`, { enabled: true, scheduled: true, cooldownUntil: new Date(Date.now() + 6 * HOUR), cooldownReason: 'repeated failure', cooldownCount: 1, consecutiveFailures: 5 }, [run('FAILED', { error: 'timeout' })], /Soyutma rejimində/);
  seed('e', `Ardıcıl xəta ${S}`, { enabled: true, scheduled: true, consecutiveFailures: 6 }, [run('FAILED', { error: 'Collection failed' })], /Dayanıb \(5\+ xəta\)/);
  seed('f', `Bir xəta ${S}`, { enabled: true, scheduled: true, consecutiveFailures: 1 }, [run('FAILED', { error: 'Collection failed' })], /Xəta var/);
  seed('g', `Bloklanmış ${S}`, { enabled: true, scheduled: true, consecutiveFailures: 1 }, [run('FAILED', { error: 'HTTP 403 forbidden' })], /Bloklanıb/);
  seed('h', `Limitə düşmüş ${S}`, { enabled: true, scheduled: true, consecutiveFailures: 1 }, [run('FAILED', { error: 'HTTP 429 rate limit' })], /Limitə düşüb/);
  seed('i', `Məhdudiyyətli ${S}`, { enabled: true, scheduled: false, accessReview: 'RESTRICTED' }, [run('SUCCEEDED', { listingComplete: true })], /Məhdudiyyət/);
  seed('j', `Gecikmiş ${S}`, { enabled: true, scheduled: true, intervalMinutes: 60, nextRunAt: ago(20 * DAY) }, [run('SUCCEEDED', { listingComplete: true, startedAt: ago(30 * DAY), finishedAt: ago(30 * DAY) })], /Gecikib/);
  seed('k', `Yalnız əl ilə, köhnə ${S}`, { enabled: true, scheduled: false }, [run('SUCCEEDED', { listingComplete: true, startedAt: ago(30 * DAY), finishedAt: ago(30 * DAY) })], /Hazırdır[\s\S]*yalnız əl ilə yenilənir/);
  seed('l', `Heç işləməyib ${S}`, { enabled: true, scheduled: true }, [], /Hazırdır[\s\S]*hələ icra olmayıb/);
  seed('m', `Sonuncu icra uğursuz, sayğac sıfır ${S}`, { enabled: true, scheduled: true, consecutiveFailures: 0 }, [run('FAILED', { error: 'Collection failed' })], /Xəta var/);
  for (const [key, m] of Object.entries(M)) {
    await prisma.jobSource.create({ data: { key, name: m.name, homepageUrl: 'https://example.org', collectionMethod: 'synthetic', scope: 'integration journey', applicationMethods: ['EXTERNAL_SITE'], ...m.data } as never });
    for (const r of m.runs ?? []) await prisma.jobImportRun.create({ data: { source: key, ...r } as never });
  }

  const ctx = await h.context({ width: 1440, height: 1000 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  await signIn(page, adminUser.email);
  await page.goto(`${stack.web}/admin/sources`);
  await page.getByText(`Sağlam nəzarət ${S}`).waitFor();
  const seen: Record<string, string> = {};
  const wrong: string[] = [];
  for (const [key, m] of Object.entries(M)) {
    const text = (await opsCell(page, key).innerText()).replace(/\s+/g, ' ');
    seen[key.slice(-1)] = text.slice(0, 70);
    if (!m.expect.test(text)) wrong.push(`${m.name}: expected ${m.expect} but the page says "${text.slice(0, 90)}"`);
    if (m.not && m.not.test(text.slice(0, 12))) wrong.push(`${m.name}: looks healthy ("${text.slice(0, 60)}")`);
  }
  await h.shot(page, 'sources-health-matrix');
  assert.deepEqual(wrong, [], `unavailable sources must not look healthy:\n${wrong.join('\n')}`);
  ok('health: of 13 synthetic source states only the genuinely healthy control reads "Sağlam"; disabled, paused, cooling down, circuit-broken, failing, blocked, rate-limited, restricted, overdue, manual-old, never-run and recovered-after-failure sources each show their own status');

  // ── 4. Admin controls and permissions ─────────────────────────────────────────────────────────────────────────────────────────
  {
    // restricted / disabled sources offer no controls; a healthy scheduled one does
    assert.equal(await opsCell(page, `h${S}i`).getByRole('button').count(), 0, 'a restricted source offers no run button');
    assert.equal(await opsCell(page, `h${S}b`).getByRole('button').count(), 0, 'a disabled source offers no run button');
    assert.ok(await opsCell(page, `h${S}a`).getByRole('button', { name: 'İndi işlət' }).isVisible());
    // pause / resume from the page
    await opsCell(page, `h${S}a`).getByRole('button', { name: 'Cədvəli dayandır' }).click();
    await page.getByText('cədvəl dayandırıldı').waitFor();
    await opsCell(page, `h${S}a`).getByText('Dayandırılıb').first().waitFor();
    await opsCell(page, `h${S}a`).getByRole('button', { name: 'Cədvəli davam etdir' }).click();
    await page.getByText('cədvəl davam etdirildi').waitFor();
    // a cooling-down source: run is disabled, recovery clears the cooldown and is audited
    assert.ok(await opsCell(page, `h${S}d`).getByTestId(`cooldown-h${S}d`).isVisible());
    assert.ok(await opsCell(page, `h${S}d`).getByRole('button', { name: 'İndi işlət' }).isDisabled(), 'run-now is disabled while cooling down');
    await opsCell(page, `h${S}d`).getByRole('button', { name: 'Bərpa et', exact: true }).click();
    await page.getByText('soyutma və xəta sayğacı sıfırlandı').waitFor();
    const d = await prisma.jobSource.findUniqueOrThrow({ where: { key: `h${S}d` } });
    assert.equal(d.cooldownUntil, null); assert.equal(d.consecutiveFailures, 0);
    assert.ok(await prisma.adminAuditLog.count({ where: { action: 'SOURCE_COOLDOWN_RESET', targetId: `h${S}d` } }) === 1, 'recovery is audited');
    // run-now against a collector source another process holds: the server's refusal is shown as is
    await prisma.jobSource.update({ where: { key: 'ejob' }, data: { enabled: true, accessReview: 'ROBOTS_ALLOWED_TERMS_PENDING' } });
    await page.reload();
    await page.getByText(`Sağlam nəzarət ${S}`).waitFor();
    const lease = await (await svc('/internal/jobs/source-lease', { method: 'POST', body: JSON.stringify({ source: 'ejob', action: 'acquire' }) })).json();
    await page.getByTestId('source-ops-ejob').getByRole('button', { name: 'İndi işlət' }).click();
    await page.getByText(/başqa proses \(cli\)/).waitFor();
    await svc('/internal/jobs/source-lease', { method: 'POST', body: JSON.stringify({ source: 'ejob', action: 'release', token: lease.token }) });
    ok('admin: restricted and disabled sources offer no controls; pause and resume work from the page; a cooling-down source cannot be run and its recovery is audited; run-now against a source another process holds shows the server\'s refusal');
    await ctx.close();

    // SUPPORT (read-only): sees the state, has no controls, and the API refuses the actions
    const sctx = await h.context({ width: 1440, height: 1000 });
    const sp = await sctx.newPage();
    sp.setDefaultTimeout(30_000);
    await signIn(sp, support.email);
    await sp.goto(`${stack.web}/admin/sources`);
    await sp.getByText(`Sağlam nəzarət ${S}`).waitFor();
    assert.match(await opsCell(sp, `h${S}a`).innerText(), /Sağlam/);
    assert.equal(await sp.getByRole('button', { name: 'İndi işlət' }).count(), 0, 'SUPPORT sees no run button');
    assert.equal(await sp.getByRole('button', { name: /Cədvəli|Bərpa/ }).count(), 0, 'SUPPORT sees no pause or recovery buttons');
    for (const [method, path, body] of [['POST', 'ops/sources/ejob/run-now', undefined], ['POST', `ops/sources/h${S}f/recover`, '{}'], ['PUT', `ops/sources/h${S}a/schedule`, '{"paused":true}'], ['PUT', 'ops/scheduler/pause', '{"paused":true}']] as const) {
      const res = await adminApi(support.token, path, { method, ...(body ? { body } : {}) });
      assert.equal(res.status, 403, `${method} ${path} is refused for SUPPORT`);
    }
    assert.equal((await adminApi(support.token, 'ops/sources')).status, 200, 'but SUPPORT can read');
    assert.equal((await prisma.jobSource.findUniqueOrThrow({ where: { key: `h${S}f` } })).consecutiveFailures, 1, 'and nothing changed');
    await sctx.close();
    ok('permissions: SUPPORT can read the sources page but has no controls, and run-now, recover, pause and the global pause all answer 403 with nothing changed');
  }

  // cleanup of what this journey created (disposable stack database)
  await prisma.jobImportRun.deleteMany({ where: { source: { startsWith: `h${S}` } } });
  await prisma.jobSource.deleteMany({ where: { key: { startsWith: `h${S}` } } });
  await prisma.job.deleteMany({ where: { externalId: { startsWith: `integ:cat${S}-` } } });
  await prisma.jobSource.update({ where: { key: 'ejob' }, data: { leaseUntil: null, leaseOwner: null } });
  console.log(`\n${passed.length} checks passed`);
  await h.close();
})().catch(async (e) => { console.error('FAIL', e); await h.close(); process.exit(1); });
