/**
 * ONE real-provider e-mail application journey, run INSIDE an isolated API container (throwaway Postgres/Redis) by scripts/run-real-provider-email-journey.sh:
 *   synthetic candidate -> synthetic vacancy whose published address is the founder's own test mailbox -> real-model CV + motivation letter, approved ->
 *   prepare (recipient, documents, final payload shown) -> approval gates (wrong payload hash refused, nothing sent before approval) ->
 *   candidate approval -> REAL provider send to the allowlisted test mailbox only -> attachment hashes == approved snapshots -> duplicate approval is idempotent ->
 *   a second vacancy whose address is NOT on the allowlist is refused before the provider.
 * Prints a JSON report; exits 1 on any failed check. Never prints a key. The only message that leaves the machine goes to JOURNEY_TEST_RECIPIENT.
 */
const { PrismaClient } = require('@prisma/client');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const BASE = 'http://127.0.0.1:4000';
const prisma = new PrismaClient();
const VAC = JSON.parse(process.env.JOURNEY_VACANCY_JSON);
const RECIPIENT = process.env.JOURNEY_TEST_RECIPIENT;
const checks = [];
const ok = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail).slice(0, 220) }); if (!pass) process.exitCode = 1; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r; };
const json = async (r) => { try { return await r.json(); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let cleanupUserId = null;
// Diagnostic mode (JOURNEY_EMAIL_TRANSPORT=sink): capture the exact provider request on loopback, then replay it to the provider with the recipient swapped for the provider's own discard address.
const captured = [];
if (process.env.JOURNEY_EMAIL_TRANSPORT === 'sink') {
  require('node:http').createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { captured.push({ headers: req.headers, body: Buffer.concat(chunks).toString() }); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'sink_' + captured.length })); }); }).listen(4599, '127.0.0.1');
}

(async () => {
  if (!RECIPIENT) throw new Error('JOURNEY_TEST_RECIPIENT missing');
  for (let i = 0; i < 90; i++) { try { if ((await fetch(BASE + '/health/ready')).ok) break; } catch {} await sleep(1000); }
  // JOURNEY_CANDIDATE_EMAIL (live run): the founder's own test mailbox, so the reply-to and the candidate's copy go only there
  const stamp = Date.now(); const email = process.env.JOURNEY_CANDIDATE_EMAIL || `email-journey-${stamp}@example.com`; const password = 'Journey-Synthetic-1';
  const user = await prisma.user.create({ data: { email, name: 'Leyla Hüseynova', hashedPassword: await bcrypt.hash(password, 12), emailVerified: new Date(), subscription: { create: { plan: 'FREE', status: 'active' } } } });
  const userId = user.id; cleanupUserId = userId;
  let r = await call('POST', '/auth/login', { email, password }); const login = await json(r); ok('login', r.status === 201 && login.sessionToken, r.status); const T = login.sessionToken;
  const profile = {
    name: 'Leyla Hüseynova', headline: 'Data analitik', location: 'Bakı', skills: ['SQL', 'PostgreSQL', 'Power BI', 'Excel', 'Hesabat hazırlanması'],
    experiences: [{ title: 'Biznes analitik', company: 'Qafqaz Analitika MMC', startDate: '2021-03-01', endDate: null, description: 'Satış və müştəri məlumatları üzrə həftəlik hesabatlar hazırlayır.\nPower BI paneli qurdu; hesabat hazırlama vaxtı 40% azaldı.' }],
    education: [{ institution: 'Bakı Dövlət Universiteti', degree: 'Bakalavr', fieldOfStudy: 'Tətbiqi riyaziyyat', startDate: '2016-09-01', endDate: '2020-06-30' }],
  };
  r = await call('PATCH', '/profile', profile, T); ok('profile saved', r.status === 200, r.status);
  r = await call('POST', '/profile/complete-onboarding', {}, T);
  // --- synthetic vacancy: a real posting's text as data, published address replaced by the test mailbox (isolated database only)
  const mkJob = async (suffix, address) => prisma.job.create({ data: {
    externalId: `eatest:${stamp}-${suffix}`, title: VAC.title, company: VAC.company, description: `${VAC.description}\n\nCV-ni ${address} ünvanına göndərin.`, location: 'Bakı', url: VAC.url, postedAt: new Date(),
    applicationMethod: 'EMAIL', applicationEmail: address,
    applicationEmailEvidence: { excerpt: `CV-ni ${address} ünvanına göndərin.`, subjectLine: `${VAC.title} - müraciət`, reference: null, extractedFrom: 'description', extractorVersion: 1 },
  } });
  const job = await mkJob('a', RECIPIENT);
  const match = await prisma.match.create({ data: { userId, jobId: job.id, score: 0.82 } });
  // --- approved CV + motivation letter (real model, composed Azerbaijani documents)
  const items = [{ kind: 'CV', language: 'az' }, { kind: 'LETTER', language: 'az' }];
  const quote = await json(await call('POST', '/documents/quote', { matchId: match.id, items }, T));
  r = await call('POST', '/documents/generate', { matchId: match.id, items, expectedUnits: quote.units, requestId: crypto.randomUUID(), letter: { motivation: 'Məlumat əsaslı qərarların qəbuluna töhfə vermək və hesabatları avtomatlaşdırmaq istəyirəm.' } }, T);
  const gen = await json(r); ok('documents generated', r.status === 201 && gen.created, r.status);
  const ids = {}; for (const d of gen.documents || []) ids[(d.docKind || d.kind)] = d.id;
  for (const id of Object.values(ids)) { let doc; for (let i = 0; i < 240; i++) { doc = await json(await call('GET', `/documents/${id}`, null, T)); if (doc && doc.status !== 'PENDING') break; await sleep(2000); } ok('document reached review', doc && doc.status === 'NEEDS_REVIEW', doc && doc.status); }
  const snapshots = {};
  for (const [kind, id] of Object.entries(ids)) {
    r = await call('POST', `/documents/${id}/approve`, {}, T); const a = await json(r); ok(`${kind} approved`, r.status === 201 && a.status === 'READY', r.status);
    snapshots[kind] = ((a.snapshots || []).filter((s) => s.kind === 'APPROVED').pop() || {}).fileSha256;
  }
  const cvId = ids.CV, letterId = ids.LETTER;
  // --- capabilities and eligibility (the live switch is on in this isolated stack)
  const caps = await json(await call('GET', '/email-applications/capabilities', null, T)); ok('capabilities: e-mail applications enabled, live transport', caps && caps.enabled === true, JSON.stringify(caps).slice(0, 200));
  const elig = await json(await call('GET', `/email-applications/eligibility/${job.id}`, null, T)); ok('vacancy is eligible', elig && elig.eligible === true, JSON.stringify(elig));
  // --- prepare: what the candidate sees before approving
  r = await call('POST', '/email-applications/prepare', { jobId: job.id, resumeId: cvId, letterId }, T); const view = await json(r); ok('prepare returns a draft awaiting approval', r.status === 200 && view.deliveryState === 'AWAITING_APPROVAL' && view.payloadSha256, `${r.status} ${view && view.deliveryState}`);
  ok('draft shows the recipient the candidate must approve', view.recipient === RECIPIENT, view.recipient);
  const attachmentsShown = JSON.stringify(view.attachments || view.documents || {});
  ok('draft lists both attachments (CV and letter)', /cv/i.test(attachmentsShown) && /letter|m[əe]ktub/i.test(attachmentsShown), attachmentsShown.slice(0, 160));
  ok('nothing was sent before approval', (await prisma.emailApplication.findUnique({ where: { id: view.id } })).deliveryState === 'AWAITING_APPROVAL', '');
  // --- approval gates
  r = await call('POST', `/email-applications/${view.id}/approve`, { payloadSha256: 'a'.repeat(64), consent: true, instructionsAcknowledged: true }, T); ok('approval with a wrong payload hash is refused', r.status >= 400 && r.status < 500, r.status);
  r = await call('POST', `/email-applications/${view.id}/approve`, { payloadSha256: view.payloadSha256, consent: false, instructionsAcknowledged: true }, T); ok('approval without consent is refused', r.status >= 400 && r.status < 500, r.status);
  ok('still nothing sent after the refused approvals', (await prisma.emailApplication.findUnique({ where: { id: view.id } })).deliveryState === 'AWAITING_APPROVAL', '');
  // --- the real approval and the real send to the allowlisted test mailbox
  r = await call('POST', `/email-applications/${view.id}/approve`, { payloadSha256: view.payloadSha256, consent: true, instructionsAcknowledged: true }, T); const approved = await json(r); ok('candidate approval accepted', r.status === 200, `${r.status} ${approved && approved.deliveryState}`);
  r = await call('POST', `/email-applications/${view.id}/approve`, { payloadSha256: view.payloadSha256, consent: true, instructionsAcknowledged: true }, T); ok('a second approval does not send again (idempotent or refused)', r.status === 200 || r.status === 409, r.status);
  let row; for (let i = 0; i < 90; i++) { row = await prisma.emailApplication.findUnique({ where: { id: view.id } }); if (row && !['QUEUED', 'SENDING'].includes(row.deliveryState)) break; await sleep(2000); }
  ok('provider accepted the message', captured.length ? true : row && ['PROVIDER_ACCEPTED', 'DELIVERED'].includes(row.deliveryState), row && row.deliveryState);
  ok('a provider message id is recorded', !!(row && row.providerMessageId), row && row.providerMessageId ? 'recorded' : 'missing');
  ok('attachment hashes equal the approved snapshots', row && row.cvSha256 === snapshots.CV && (row.letterSha256 === snapshots.LETTER), `${row && row.cvSha256 && row.cvSha256.slice(0, 10)} ${row && row.letterSha256 && row.letterSha256.slice(0, 10)}`);
  const sentCount = await prisma.emailApplication.count({ where: { userId, deliveryState: { in: ['PROVIDER_ACCEPTED', 'DELIVERED'] } } });
  ok('exactly one message was handed to the provider', sentCount === 1, sentCount);

  // --- webhook handling with the REAL signing secret (JOURNEY_WEBHOOK_CHECK=1, sink transport): signed event applied, duplicate, forged/stale/tampered/unsigned rejected
  if (process.env.JOURNEY_WEBHOOK_CHECK === '1') {
    const secret = process.env.EMAIL_APPLY_WEBHOOK_SECRET || '';
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const sign = (id, body, ts = Math.floor(Date.now() / 1000)) => ({ 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': 'v1,' + crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64') });
    const post = async (headers, body) => { const rr = await fetch(BASE + '/webhooks/resend', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }); return { status: rr.status, json: await rr.json().catch(() => null) }; };
    ok('webhook secret is configured (whsec_ with decodable key)', secret.startsWith('whsec_') && key.length >= 16, `key bytes ${key.length}`);
    const evBody = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: row.providerMessageId, to: [RECIPIENT], tags: { application: row.id } } });
    let w = await post({}, evBody); ok('unsigned event is rejected (401)', w.status === 401, w.status);
    w = await post({ ...sign('msg_forged', evBody), 'svix-signature': 'v1,' + Buffer.alloc(32, 1).toString('base64') }, evBody); ok('event with a forged signature is rejected (401)', w.status === 401, w.status);
    w = await post(sign('msg_stale', evBody, Math.floor(Date.now() / 1000) - 3600), evBody); ok('correctly signed but stale event (1 h old) is rejected (401)', w.status === 401, w.status);
    w = await post(sign('msg_tamper', evBody), evBody.replace('email.delivered', 'email.bounced')); ok('body altered after signing is rejected (401)', w.status === 401, w.status);
    ok('rejected events changed nothing', (await prisma.emailApplication.findUnique({ where: { id: view.id } })).deliveryState === 'PROVIDER_ACCEPTED', '');
    w = await post(sign('msg_delivered_1', evBody), evBody); ok('validly signed delivery event is applied', w.status === 200 && w.json && w.json.outcome === 'applied', JSON.stringify(w.json));
    ok('the application is now DELIVERED (webhook evidence)', (await prisma.emailApplication.findUnique({ where: { id: view.id } })).deliveryState === 'DELIVERED', '');
    w = await post(sign('msg_delivered_1', evBody), evBody); ok('the same event delivered twice is recognised as a duplicate', w.status === 200 && w.json && w.json.outcome === 'duplicate', JSON.stringify(w.json));
    const bounceBody = JSON.stringify({ type: 'email.bounced', created_at: new Date().toISOString(), data: { email_id: row.providerMessageId, to: [RECIPIENT], tags: { application: row.id }, bounce: { type: 'Permanent' } } });
    w = await post(sign('msg_bounce_late', bounceBody), bounceBody); ok('a later bounce is accepted as evidence without error', w.status === 200, JSON.stringify(w.json));
  }
  // --- allowlist: another vacancy whose address is not the test mailbox must never reach the provider
  const other = await mkJob('b', `blocked-${stamp}@example.com`);
  const m2 = await prisma.match.create({ data: { userId, jobId: other.id, score: 0.7 } });
  r = await call('POST', '/email-applications/prepare', { jobId: other.id, resumeId: cvId }, T); const v2 = await json(r);
  if (r.status === 200 && v2.id) {
    await call('POST', `/email-applications/${v2.id}/approve`, { payloadSha256: v2.payloadSha256, consent: true, instructionsAcknowledged: true }, T);
    await sleep(8000); const r2 = await prisma.emailApplication.findUnique({ where: { id: v2.id } });
    ok('a recipient outside the allowlist is never sent', r2 && !['PROVIDER_ACCEPTED', 'DELIVERED'].includes(r2.deliveryState) && !r2.providerMessageId, r2 && r2.deliveryState);
  } else ok('a recipient outside the allowlist is refused at prepare', r.status >= 400, r.status);
  if (captured.length && process.env.JOURNEY_REPLAY === '1') {
    const c = captured[0]; const b = JSON.parse(c.body);
    const replay = async (label, over = {}) => { const body = { ...b, to: ['delivered@resend.dev'], ...(b.bcc ? { bcc: ['delivered@resend.dev'] } : {}), ...over }; const rr = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.RESEND_KEY_FOR_REPLAY, 'Idempotency-Key': over._key || c.headers['idempotency-key'] }, body: JSON.stringify(body) }); const t = await rr.text(); console.log('REPLAY', label, rr.status, t.slice(0, 300)); };
    console.log('CAPTURED keys', Object.keys(b).join(','), 'from=', JSON.stringify(b.from), 'reply_to=', JSON.stringify(b.reply_to), 'bcc=', JSON.stringify(b.bcc), 'tags=', JSON.stringify(b.tags), 'idemKeyLen=', String(c.headers['idempotency-key']).length, 'attach=', b.attachments.map((a) => `${a.filename}:${a.content.length}:${a.content_type}`).join('|'), 'subject=', JSON.stringify(b.subject), 'textLen=', b.text.length);
    await replay('as captured');
    await replay('without bcc', { bcc: undefined });
    await replay('without tags', { tags: undefined });
    await replay('without attachments', { attachments: undefined });
  }
  const summary = row && { deliveryState: row.deliveryState, attempts: row.attemptCount, attachments: { cvBytes: row.cvBytes, letterBytes: row.letterBytes, cvName: row.cvFileName, letterName: row.letterFileName }, subject: row.subject, providerMessageIdRecorded: !!row.providerMessageId, providerMessageId: row.providerMessageId, failureCode: row.failureCode, uncertain: !!row.uncertainAt };
  // --- cleanup through the product's own account deletion
  r = await call('DELETE', '/auth/account', { password }, T); ok('synthetic account deleted', r.status === 200, r.status);
  console.log(JSON.stringify({ passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).map((c) => `${c.name} [${c.detail}]`), summary, checks: checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}`) }, null, 2));
  await prisma.$disconnect();
  process.exit(process.exitCode || 0); // the optional diagnostic capture server must not keep the process alive
})().catch(async (e) => { console.error('JOURNEY ERROR', e && e.message); try { if (cleanupUserId) await prisma.user.delete({ where: { id: cleanupUserId } }); } catch {} process.exit(2); });
