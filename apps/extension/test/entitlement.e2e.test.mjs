// The browser assistant is part of Premium and the server enforces it: when pairing, when consent is created, when work is handed out and when a
// submission is permitted. A downgrade ends open work without touching history; the monthly cap holds. Real extension, real API, Lever-shaped fixture.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, waitFor, sleep, API_PORT } from './harness.mjs';

let H;
before(async () => {
  H = await startHarness({
    scenarios: { 31: {}, 32: {}, 33: {} },
    // The cap is configuration over the specified 50: one application a month, so the second is refused without creating fifty rows.
    env: { PRODUCT_CONFIG_JSON: JSON.stringify({ limits: { 'candidate.premium.browser.applications': 1 } }) },
  });
});
after(async () => { await H?.close(); });
const stateOf = async (c, job) => (await H.appFor(c.id, job.id))?.state;

async function approveAndSubmit(c, job, popup) {
  await waitFor(async () => { await H.poll(popup); await sleep(1500); return ['AWAITING_INPUT', 'READY'].includes(await stateOf(c, job)); }, { timeout: 90000, what: 'described' });
  const app = await H.appFor(c.id, job.id);
  let view = (await c.web.get(`/agent/applications/${app.id}`)).body;
  if (view.state === 'AWAITING_INPUT') {
    await c.web.post(`/agent/applications/${app.id}/answers`, { answers: view.questions.map((q) => ({ key: q.key, value: 'Playwright' })) });
    view = (await c.web.get(`/agent/applications/${app.id}`)).body;
  }
  await c.web.post(`/agent/applications/${app.id}/approve`, { planHash: view.planHash });
  await H.poll(popup);
  return app;
}

test('a Free account cannot pair a browser or create consent: the server refuses with the plan reason', async () => {
  const c = await H.candidate('Free Namizəd', { plan: 'FREE' });
  const caps = (await c.web.get('/agent/capabilities')).body;
  assert.equal(caps.entitlement.included, false);
  const pairing = await c.web.post('/agent/pairing');
  assert.equal(pairing.status, 403);
  assert.match(JSON.stringify(pairing.body), /PLAN_REQUIRED/);
  const preview = await c.web.post('/agent/campaigns/preview', { name: 'x', mode: 'ASSISTED', portals: ['lever'] });
  assert.equal(preview.status, 403);
});

test('private ZIP and identity assistance enforce authentication, Premium and expiry', async () => {
  const url = `http://127.0.0.1:${API_PORT}`;
  assert.equal((await fetch(url + '/agent/extension')).status, 401);
  const free = await H.candidate('Free ZIP', { plan: 'FREE' });
  assert.equal((await free.web.get('/agent/extension')).status, 403);
  const c = await H.candidate('Identity Sample');
  const download = await fetch(url + '/agent/extension', { headers: { authorization: `Bearer ${c.token}` } });
  assert.equal(download.status, 200); assert.match(download.headers.get('cache-control'), /no-store/);
  assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  const code = (await c.web.post('/agent/pairing')).body.code;
  const pair = await c.web.post('/agent/ext/pair', { code, name: 'Identity test device' });
  assert.equal(pair.status, 200);
  const profile = () => fetch(url + '/agent/ext/assisted-profile', { headers: { authorization: `Bearer ${pair.body.token}` } });
  const allowed = await profile(); assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { name: 'Identity Sample', email: c.email, phone: '+994501234567' });
  await H.prisma.subscription.update({ where: { userId: c.id }, data: { status: 'expired' } });
  assert.equal((await c.web.get('/agent/extension')).status, 403);
  assert.equal((await profile()).status, 403);
});

test('Premium: the monthly cap holds at the moment of submission, and what was submitted is counted once', async () => {
  const c = await H.candidate('Premium Namizəd');
  const first = await H.posting(31, c.id, { title: 'QA Engineer A' });
  const second = await H.posting(32, c.id, { title: 'QA Engineer B' });
  await H.campaign(c);
  const popup = await H.pair(c);
  assert.equal((await c.web.get('/agent/capabilities')).body.entitlement.remainingThisMonth, 1);

  await approveAndSubmit(c, first, popup);
  await waitFor(async () => { await H.poll(popup); await sleep(1500); return (await stateOf(c, first)) === 'SUBMITTED'; }, { timeout: 120000, what: 'first application submitted' });
  assert.equal(H.lever.received.length >= 1, true);
  const sentBefore = H.lever.received.length;

  const caps = (await c.web.get('/agent/capabilities')).body.entitlement;
  assert.equal(caps.usedThisMonth, 1);
  assert.equal(caps.remainingThisMonth, 0);

  // The second application is prepared but never permitted: the cap is checked at submission, not only in the screen.
  await H.poll(popup); await sleep(3000);
  const row = await H.appFor(c.id, second.id);
  if (row) {
    assert.notEqual(row.state, 'SUBMITTED');
    assert.equal(row.permitId, null, 'no permit was issued over the cap');
  }
  assert.equal(H.lever.received.length, sentBefore, 'nothing further was sent');
});

test('a downgrade after approval ends the open work with a plain reason and keeps the history', async () => {
  const c = await H.candidate('Downgrade Namizəd');
  const job = await H.posting(33, c.id, { title: 'QA Engineer C' });
  await H.campaign(c);
  const popup = await H.pair(c);
  const sentBefore = H.lever.received.length;
  await H.poll(popup);
  await waitFor(async () => ['AWAITING_INPUT', 'READY'].includes(await stateOf(c, job)), { what: 'described' });
  const app = await H.appFor(c.id, job.id);
  let view = (await c.web.get(`/agent/applications/${app.id}`)).body;
  if (view.state === 'AWAITING_INPUT') {
    await c.web.post(`/agent/applications/${app.id}/answers`, { answers: view.questions.map((q) => ({ key: q.key, value: 'Playwright' })) });
    view = (await c.web.get(`/agent/applications/${app.id}`)).body;
  }
  await c.web.post(`/agent/applications/${app.id}/approve`, { planHash: view.planHash });

  // The plan ends before the browser submits.
  await H.prisma.subscription.update({ where: { userId: c.id }, data: { plan: 'FREE' } });
  await H.poll(popup);
  await waitFor(async () => (await stateOf(c, job)) === 'CANCELLED', { timeout: 60000, what: 'work ended' });
  const done = await H.app(app.id);
  assert.equal(done.stateReason, 'PLAN_REQUIRED');
  assert.equal(H.lever.received.length, sentBefore, 'nothing was sent after the downgrade');
  const events = await H.prisma.agentApplicationEvent.count({ where: { applicationId: app.id } });
  assert.ok(events >= 3, 'the history of what happened is kept');
  assert.equal((await c.web.post('/agent/pairing')).status, 403);
});

const pairRaw = (code) => fetch(`http://127.0.0.1:${API_PORT}/agent/ext/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: 'Test brauzeri' }) })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

test('an expired, a used and a wrong pairing code are refused with a plain message and no device appears', async () => {
  const c = await H.candidate('Kod Namizəd');
  const first = (await c.web.post('/agent/pairing')).body.code;
  await H.prisma.agentPairingCode.updateMany({ where: { userId: c.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const expired = await pairRaw(first);
  assert.equal(expired.status, 400);
  assert.match(JSON.stringify(expired.body), /PAIRING_CODE_EXPIRED/);
  assert.match(JSON.stringify(expired.body), /Yeni kod yaradın/);

  const second = (await c.web.post('/agent/pairing')).body.code;
  const ok = await pairRaw(second);
  assert.equal(ok.status, 200);
  const again = await pairRaw(second);
  assert.equal(again.status, 400, 'a code works once');
  assert.equal((await pairRaw('NOTACODE')).status, 400);
  assert.equal(await H.prisma.agentDevice.count({ where: { userId: c.id } }), 1);

  // Disconnecting from the candidate's side ends that browser's access; its token is dead.
  const device = (await c.web.get('/agent/devices')).body[0];
  const token = ok.body.deviceToken ?? ok.body.token;
  const del = await fetch(`http://127.0.0.1:${API_PORT}/agent/devices/${device.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${c.token}` } });
  assert.equal(del.status, 200);
  if (token) {
    const after = await fetch(`http://127.0.0.1:${API_PORT}/agent/ext/next`, { headers: { authorization: `Bearer ${token}` } });
    assert.ok([401, 403].includes(after.status), 'a revoked browser is refused');
  }
});

test('a plan that ends between making the code and typing it pairs nothing, and the code is not used up', async () => {
  const c = await H.candidate('Kod Namizəd');
  const code = (await c.web.post('/agent/pairing')).body.code;
  await H.prisma.subscription.update({ where: { userId: c.id }, data: { status: 'expired' } });
  const refused = await c.web.post('/agent/ext/pair', { code, name: 'Late', version: '0.3.3' });
  assert.equal(refused.status, 403); assert.match(JSON.stringify(refused.body), /PLAN_REQUIRED/);
  assert.equal(await H.prisma.agentDevice.count({ where: { userId: c.id } }), 0);
  assert.equal((await H.prisma.agentPairingCode.findFirst({ where: { userId: c.id } })).usedAt, null);
});
