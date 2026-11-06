import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, waitFor, sha256, sleep } from './harness.mjs';
import { postingId } from './fixture-lever.mjs';

let H;
const SC = {
  1: { extraQuestion: true }, 2: { autofill: true }, 3: { captcha: true }, 4: { closed: true }, 5: { declarationChanges: true }, 6: { noConfirmation: true },
  7: {}, 8: { unsupportedControl: true }, 9: { eeoRequired: true }, 10: { rejectSubmit: true }, 11: {}, 12: {},
};
before(async () => { H = await startHarness({ scenarios: SC }); });
after(async () => { await H?.close(); });

const stateOf = async (c, job) => (await H.appFor(c.id, job.id))?.state;

test('assisted: describe → question → answer → approval → permit → submit → portal confirmation', { timeout: 240000 }, async () => {
  const c = await H.candidate(); const job = await H.posting(1, c.id); await H.campaign(c);
  const popup = await H.pair(c);
  await H.poll(popup);
  await waitFor(async () => (await stateOf(c, job)) === 'AWAITING_INPUT', { what: 'form described, question asked' });
  const app = await H.appFor(c.id, job.id);
  const view = (await c.web.get(`/agent/applications/${app.id}`)).body;
  assert.deepEqual(view.questions.map((q) => q.key), ['cards[a][field1]']);
  assert.equal(H.lever.received.length, 0);
  await c.web.post(`/agent/applications/${app.id}/answers`, { answers: [{ key: 'cards[a][field1]', value: 'Playwright, Cypress' }] });
  const ready = (await c.web.get(`/agent/applications/${app.id}`)).body;
  assert.equal(ready.state, 'READY');
  await H.poll(popup); await sleep(4000);
  assert.equal(H.lever.received.length, 0, 'nothing is submitted before the candidate approves');
  await c.web.post(`/agent/applications/${app.id}/approve`, { planHash: ready.planHash });
  await H.poll(popup);
  await waitFor(async () => (await stateOf(c, job)) === 'SUBMITTED', { timeout: 120000, what: 'portal confirmation' });
  const done = await H.app(app.id);
  assert.equal(done.confirmation, 'PORTAL');
  assert.equal(done.evidence.confirmationUrl, `${job.url}/thanks`);
  assert.equal(H.lever.received.length, 1);
  const got = H.lever.received[0];
  assert.deepEqual({ name: got.fields.name, email: got.fields.email, phone: got.fields.phone, li: got.fields['urls[LinkedIn]'], auth: got.fields['cards[a][field0]'], tools: got.fields['cards[a][field1]'], gender: got.fields['eeo[gender]'] },
    { name: 'Leyla Hüseynova', email: 'leyla@example.org', phone: '+994501234567', li: 'https://www.linkedin.com/in/leyla-huseynova', auth: 'Yes, I am', tools: 'Playwright, Cypress', gender: '' });
  assert.equal(got.file.sha256, c.cvSha, 'the portal received exactly the approved CV');
  assert.equal(got.fields['h-captcha-response'], '');
  const events = (await H.prisma.agentApplicationEvent.findMany({ where: { applicationId: app.id } })).map((e) => e.kind);
  for (const k of ['queued', 'claimed', 'awaiting_input', 'plan_ready', 'approved', 'permit_issued', 'submitted_with_evidence']) assert.ok(events.includes(k), `missing event ${k}`);
  await popup.close();
});

async function readyAssisted(c, num, form = {}) {
  const job = await H.posting(num, c.id); await H.campaign(c, form);
  const popup = await H.pair(c); await H.poll(popup);
  await waitFor(async () => ['READY', 'AWAITING_INPUT'].includes(await stateOf(c, job)), { what: 'form described' });
  return { job, popup, app: await H.appFor(c.id, job.id) };
}
const approve = async (c, appId) => { const v = (await c.web.get(`/agent/applications/${appId}`)).body; await c.web.post(`/agent/applications/${appId}/approve`, { planHash: v.planHash }); };

test('the candidate\'s confirmed answers replace what the portal\'s resume parser filled in', { timeout: 240000 }, async () => {
  const c = await H.candidate(); const { job, popup, app } = await readyAssisted(c, 2);
  assert.equal(app.state, 'READY');
  await approve(c, app.id); await H.poll(popup);
  await waitFor(async () => (await stateOf(c, job)) === 'SUBMITTED', { timeout: 120000, what: 'confirmation' });
  const got = H.lever.received.find((r) => r.posting === 2);
  assert.equal(got.fields.name, 'Leyla Hüseynova'); assert.equal(got.fields.email, 'leyla@example.org');
  await popup.close();
});

test('a challenge shown by the portal goes to the candidate; completing it in their own tab is captured as evidence', { timeout: 240000 }, async () => {
  const c = await H.candidate(); const { job, popup, app } = await readyAssisted(c, 3);
  await approve(c, app.id); await H.poll(popup);
  await waitFor(async () => (await stateOf(c, job)) === 'AWAITING_INPUT' && (await H.app(app.id)).stateReason === 'CAPTCHA_PENDING', { timeout: 90000, what: 'challenge reported' });
  assert.equal(H.lever.received.filter((r) => r.posting === 3).length, 0, 'nothing is submitted while the challenge is open');
  // The candidate solves it themselves in the tab the extension left open.
  const page = H.context.pages().find((p) => p.url().includes(postingId(3)));
  await page.frameLocator('iframe[title="hCaptcha challenge"]').locator('#human').click();
  await waitFor(async () => (await stateOf(c, job)) === 'SUBMITTED', { timeout: 60000, what: 'confirmation after the candidate completed the challenge' });
  assert.equal((await H.app(app.id)).confirmation, 'PORTAL');
  assert.equal(H.lever.received.filter((r) => r.posting === 3).length, 1);
  await popup.close();
});

test('a closed posting is cancelled and nothing is sent', { timeout: 120000 }, async () => {
  const c = await H.candidate(); const job = await H.posting(4, c.id); await H.campaign(c);
  const popup = await H.pair(c); await H.poll(popup);
  await waitFor(async () => (await stateOf(c, job)) === 'CANCELLED', { what: 'closed posting detected' });
  assert.equal((await H.appFor(c.id, job.id)).stateReason, 'JOB_CLOSED');
  assert.equal(H.lever.received.length > 0 && H.lever.received.some((r) => r.posting === 4), false);
  await popup.close();
});

test('legal text that changed after approval stops the submission and withdraws the approval', { timeout: 240000 }, async () => {
  const c = await H.candidate(); const { job, popup, app } = await readyAssisted(c, 5);
  await approve(c, app.id); await H.poll(popup);
  await waitFor(async () => (await H.appFor(c.id, job.id)).stateReason === 'DECLARATION_CHANGED', { timeout: 90000, what: 'changed declaration detected' });
  assert.equal((await H.appFor(c.id, job.id)).state, 'AWAITING_INPUT');
  assert.equal(H.lever.received.some((r) => r.posting === 5), false);
  await popup.close();
});

test('a click without any confirmation is UNCERTAIN, is not retried, and the candidate reconciles', { timeout: 300000 }, async () => {
  const c = await H.candidate(); const { job, popup, app } = await readyAssisted(c, 6);
  await H.sw.evaluate(() => chrome.storage.local.set({ watchMs: 4000 }));
  await approve(c, app.id); await H.poll(popup);
  await waitFor(async () => H.lever.received.some((r) => r.posting === 6), { timeout: 90000, what: 'the portal received the form' });
  await sleep(5000); await H.sw.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'watchdog' }, r)));
  await waitFor(async () => (await stateOf(c, job)) === 'UNCERTAIN', { what: 'uncertain outcome recorded' });
  await H.poll(popup); await sleep(4000);
  assert.equal(H.lever.received.filter((r) => r.posting === 6).length, 1, 'never retried');
  const v = (await c.web.post(`/agent/applications/${app.id}/reconcile`, { outcome: 'submitted' })).body;
  assert.equal(v.confirmation, 'CANDIDATE'); assert.equal(v.evidence, null);
  await H.sw.evaluate(() => chrome.storage.local.remove('watchMs'));
  await popup.close();
});

test('revoking consent while an application waits ends it; the browser submits nothing', { timeout: 200000 }, async () => {
  const c = await H.candidate(); const { job, popup, app } = await readyAssisted(c, 7);
  await approve(c, app.id);
  const camp = (await c.web.get('/agent/campaigns')).body[0];
  await c.web.post(`/agent/campaigns/${camp.id}/revoke`);
  await H.poll(popup); await sleep(5000);
  assert.equal(await stateOf(c, job), 'CANCELLED');
  assert.equal(H.lever.received.some((r) => r.posting === 7), false);
  await popup.close();
});

test('an unsupported required control stops the application for the candidate; nothing is sent', { timeout: 120000 }, async () => {
  const c = await H.candidate(); const { app, popup } = await readyAssisted(c, 8);
  assert.equal(app.state, 'AWAITING_INPUT');
  assert.ok(app.questions.some((q) => q.askReason === 'unsupported_control'));
  assert.equal(H.lever.received.some((r) => r.posting === 8), false);
  await popup.close();
});

test('a required sensitive disclosure is put to the candidate; their answer is used and never remembered', { timeout: 240000 }, async () => {
  const c = await H.candidate(); const { job, popup, app } = await readyAssisted(c, 9);
  assert.deepEqual(app.questions.map((q) => [q.key, q.askReason]), [['eeo[gender]', 'sensitive']]);
  await c.web.post(`/agent/applications/${app.id}/answers`, { answers: [{ key: 'eeo[gender]', value: 'Decline' }], remember: true });
  await approve(c, app.id); await H.poll(popup);
  await waitFor(async () => (await stateOf(c, job)) === 'SUBMITTED', { timeout: 120000, what: 'confirmation' });
  assert.equal(H.lever.received.find((r) => r.posting === 9).fields['eeo[gender]'], 'Decline');
  assert.equal(await H.prisma.agentKnownAnswer.count({ where: { userId: c.id } }), 0);
  await popup.close();
});

test('a portal that rejects the form returns the application to the candidate without claiming a submission', { timeout: 240000 }, async () => {
  const c = await H.candidate(); const { job, popup, app } = await readyAssisted(c, 10);
  await approve(c, app.id); await H.poll(popup);
  await waitFor(async () => (await H.appFor(c.id, job.id)).stateReason === 'VALIDATION_ERROR', { timeout: 90000, what: 'portal validation error reported' });
  assert.equal((await H.appFor(c.id, job.id)).state, 'AWAITING_INPUT');
  assert.equal(H.lever.received.some((r) => r.posting === 10), false);
  await popup.close();
});

test('revoking the paired browser ends its session; the extension asks to be paired again', { timeout: 120000 }, async () => {
  const c = await H.candidate(); await H.posting(11, c.id); await H.campaign(c);
  const popup = await H.pair(c);
  const dev = (await c.web.get('/agent/devices')).body[0];
  await fetch(`http://127.0.0.1:4800/agent/devices/${dev.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${c.token}` } });
  await H.poll(popup);
  await waitFor(async () => !(await H.sw.evaluate(() => chrome.storage.local.get('token'))).token, { what: 'token cleared after 401' });
  await popup.reload();
  assert.equal(await popup.locator('#unpaired').isVisible(), true);
  await popup.close();
});
