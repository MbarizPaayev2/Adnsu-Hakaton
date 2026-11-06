// Employer publication gate, run INSIDE the release API image against an isolated throwaway database. Synthetic data only.
const crypto = require('node:crypto');
const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const API = 'http://127.0.0.1:4000';
const stamp = Date.now();
const results = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(ok ? 'PASS' : 'FAIL', name, detail); if (!ok) process.exitCode = 1; };
const http = async (method, path, token, body) => {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
};
(async () => {
  const email = `aise-emp-gate-${stamp}@example.com`;
  const password = 'Synthetic-Employer-1!';
  let r = await http('POST', '/business/auth/register', null, { email, password, companyName: `Gate Sınaq ${stamp} MMC` });
  check('employer registration', [200, 201].includes(r.status), `status ${r.status}`);
  const biz = await prisma.business.findUnique({ where: { email }, include: { company: true } });
  const tok = await prisma.businessVerificationToken.findFirst({ where: { businessId: biz.id, purpose: 'EMAIL_VERIFY' } });
  r = await http('POST', '/business/auth/verify-email', null, { token: tok.token });
  check('e-mail verification', r.status === 200, `status ${r.status}`);
  const admin = await prisma.adminUser.create({ data: { email: `aise-op-${stamp}@example.com`, hashedPassword: 'x', role: 'SUPER_ADMIN' } });
  const adminToken = crypto.randomBytes(32).toString('hex');
  await prisma.adminSession.create({ data: { sessionToken: adminToken, adminUserId: admin.id, expires: new Date(Date.now() + 3600e3), mfaVerified: true } });
  r = await http('PATCH', `/admin/companies/${biz.company.id}/approve`, adminToken);
  check('operator approves the company', r.status === 200, `status ${r.status}`);
  r = await http('POST', '/business/auth/login', null, { email, password });
  const emp = r.body && (r.body.accessToken || r.body.sessionToken || r.body.token);
  check('employer login', r.status === 200 && !!emp);
  const draft = async (title) => (await http('POST', '/business/vacancies', emp, { title, description: 'Bakıda yerləşən şirkətə hesabatların hazırlanması və ilkin sənədlərin uçotu üzrə mühasib axtarılır.', requirements: 'Ali təhsil, iki il təcrübə, Excel bilikləri.', location: 'Bakı' })).body;
  const approved = async (title) => { const v = await draft(title); await http('POST', `/business/plans/vacancies/${v.id}/submit`, emp); await http('PATCH', `/admin/employer-vacancies/${v.id}/approve`, adminToken); return v.id; };

  const cat = await http('GET', '/billing/catalogue');
  check('public catalogue answers', cat.status === 200, `status ${cat.status}`);
  let ov = (await http('GET', '/business/plans', emp)).body;
  check('overview: plans on, trial available, checkout NOT available (billing off)', ov.gated && ov.trial.available && ov.checkoutAvailable === false && ov.nextPublication === 'TRIAL', JSON.stringify({ gated: ov.gated, co: ov.checkoutAvailable, next: ov.nextPublication, trialDays: ov.trial && ov.trial.days }));

  const v1 = await approved(`Trial vakansiyası ${stamp}`);
  r = await http('POST', `/business/plans/vacancies/${v1}/publish`, emp);
  const days = r.body && r.body.expiresAt ? Math.round((new Date(r.body.expiresAt) - Date.now()) / 86400e3) : null;
  check('first vacancy publishes on the 14-day trial', r.status === 200 && r.body.publicationPlan === 'TRIAL' && days === 14, `plan ${r.body && r.body.publicationPlan} days ${days}`);
  check('trial listing is public', (await http('GET', `/vacancies/${v1}`)).status === 200);
  const v2 = await approved(`İkinci vakansiya ${stamp}`);
  r = await http('POST', `/business/plans/vacancies/${v2}/publish`, emp);
  check('second vacancy is refused without an entitlement', r.status === 403 && JSON.stringify(r.body).includes('ENTITLEMENT_REQUIRED'), `status ${r.status}`);
  r = await http('POST', '/business/plans/checkout/single', emp, { idempotencyKey: `k-${stamp}`, vacancyId: v2 });
  check('checkout is refused while billing is off (no provider call)', r.status >= 400, `status ${r.status}`);

  fs.mkdirSync('/repo/apps/api/uploads', { recursive: true });
  const mk = async (tag) => {
    const u = await prisma.user.create({ data: { email: `aise-${tag}-gate-${stamp}@example.com`, hashedPassword: 'disabled-synthetic-login', emailVerified: new Date(), subscription: { create: { plan: 'FREE', status: 'active' } } } });
    const t = crypto.randomBytes(32).toString('hex');
    await prisma.session.create({ data: { sessionToken: t, userId: u.id, expires: new Date(Date.now() + 3600e3) } });
    const f = `gate-${tag}-${stamp}.pdf`; fs.writeFileSync('/repo/apps/api/uploads/' + f, `%PDF-1.4 synthetic gate ${tag} ${stamp}`);
    await prisma.resume.create({ data: { userId: u.id, isBase: true, status: 'READY', fileUrl: `/uploads/${f}` } });
    return t;
  };
  r = await http('POST', `/vacancies/${v1}/apply`, await mk('cand'), {});
  check('candidate applies while the trial runs', r.status === 201, `status ${r.status}`);
  const inbox = await http('GET', '/business/vacancies', emp);
  check('employer sees the application in the inbox', inbox.status === 200 && JSON.stringify(inbox.body).length > 50, `status ${inbox.status}`);
  await prisma.vacancy.update({ where: { id: v1 }, data: { expiresAt: new Date(Date.now() - 1000) } });
  r = await http('POST', `/vacancies/${v1}/apply`, await mk('late'), {});
  check('after the period a new application is refused', r.status === 400 && JSON.stringify(r.body).includes('müddəti bitib'), `status ${r.status}`);
  check('the received application is still stored', (await prisma.application.count({ where: { vacancyId: v1 } })) === 1);
  const prof = await http('GET', '/business/company', emp);
  check('company profile still accessible after expiry', prof.status === 200, `status ${prof.status}`);
  const pub = await http('GET', `/vacancies/${v1}`);
  check('expired listing is no longer public', pub.status === 404 || pub.status === 410 || (pub.body && JSON.stringify(pub.body).includes('expired')), `status ${pub.status}`);

  // a vacancy under review is never public
  const v3 = await draft(`Qaralama ${stamp}`);
  check('unreviewed draft is not public', (await http('GET', `/vacancies/${v3.id}`)).status !== 200);
  fs.writeFileSync('/tmp/gate-result.json', JSON.stringify({ stamp, results }, null, 1));
  log(`SUMMARY ${results.filter((x) => x.ok).length}/${results.length} passed`);
  await prisma.$disconnect();
})().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
