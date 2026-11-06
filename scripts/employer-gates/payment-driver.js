// Payment gate: LIVE provider checkout sessions created by the release image from an isolated database. Nothing is paid; synthetic company.
const crypto = require('node:crypto');
const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const API = 'http://127.0.0.1:4000';
const stamp = Date.now();
const results = [];
const out = { stamp };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); if (!ok) process.exitCode = 1; };
const http = async (method, path, token, body) => {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
};
(async () => {
  const email = `employer-gate-${stamp}@aisehr.com`;
  const password = 'Synthetic-Employer-1!';
  let r = await http('POST', '/business/auth/register', null, { email, password, companyName: `Gate Ödəniş ${stamp} MMC` });
  check('employer registration', [200, 201].includes(r.status), `status ${r.status}`);
  const biz = await prisma.business.findUnique({ where: { email }, include: { company: true } });
  const tok = await prisma.businessVerificationToken.findFirst({ where: { businessId: biz.id, purpose: 'EMAIL_VERIFY' } });
  r = await http('POST', '/business/auth/verify-email', null, { token: tok.token });
  check('e-mail verification', r.status === 200);
  const admin = await prisma.adminUser.create({ data: { email: `aise-op-${stamp}@example.com`, hashedPassword: 'x', role: 'SUPER_ADMIN' } });
  const adminToken = crypto.randomBytes(32).toString('hex');
  await prisma.adminSession.create({ data: { sessionToken: adminToken, adminUserId: admin.id, expires: new Date(Date.now() + 3600e3), mfaVerified: true } });
  r = await http('PATCH', `/admin/companies/${biz.company.id}/approve`, adminToken);
  check('operator approves the company', r.status === 200);
  r = await http('POST', '/business/auth/login', null, { email, password });
  const emp = r.body && (r.body.accessToken || r.body.sessionToken || r.body.token);
  const ov = (await http('GET', '/business/plans', emp)).body;
  out.overview = { gated: ov.gated, checkoutAvailable: ov.checkoutAvailable, trialDays: ov.trial && ov.trial.days, offers: ov.offers };
  check('overview: checkout available (billing on, provider configured)', ov.gated && ov.checkoutAvailable === true, JSON.stringify({ co: ov.checkoutAvailable }));
  const v = (await http('POST', '/business/vacancies', emp, { title: `Ödəniş yoxlaması ${stamp}`, description: 'Bakıda yerləşən şirkətə hesabatların hazırlanması və ilkin sənədlərin uçotu üzrə mühasib axtarılır.', requirements: 'Ali təhsil, iki il təcrübə.', location: 'Bakı' })).body;
  await http('POST', `/business/plans/vacancies/${v.id}/submit`, emp);
  await http('PATCH', `/admin/employer-vacancies/${v.id}/approve`, adminToken);
  r = await http('POST', '/business/plans/checkout/single', emp, { idempotencyKey: `gate-${stamp}`, vacancyId: v.id });
  check('single-vacancy checkout session created (live provider)', r.status === 200 && /^https:\/\//.test(r.body && r.body.url || ''), `status ${r.status} host ${(r.body && r.body.url || '').split('/')[2]}`);
  out.singleUrl = r.body && r.body.url;
  const p = await prisma.employerPurchase.findFirst({ where: { companyId: biz.company.id } });
  check('purchase recorded PENDING at 2000 qəpik (20.00 AZN), nothing granted', p && p.status === 'PENDING' && p.amountMinor === 2000 && p.currency === 'AZN' && (await prisma.employerCredit.count({ where: { companyId: biz.company.id } })) === 0, JSON.stringify({ s: p && p.status, a: p && p.amountMinor, c: p && p.currency }));
  r = await http('POST', '/business/plans/checkout/business', emp);
  check('Biznes checkout session created (live provider)', r.status === 200 && /^https:\/\//.test(r.body && r.body.url || ''), `status ${r.status} host ${(r.body && r.body.url || '').split('/')[2]}`);
  out.businessUrl = r.body && r.body.url;
  // The vacancy is not published by a created session
  const vv = await prisma.vacancy.findUnique({ where: { id: v.id } });
  check('creating a session publishes nothing', vv.status !== 'ACTIVE', vv.status);
  out.results = results;
  fs.writeFileSync('/tmp/gate-pay-result.json', JSON.stringify(out, null, 1));
  log(`SUMMARY ${results.filter((x) => x.ok).length}/${results.length} passed`);
  await prisma.$disconnect();
})().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
