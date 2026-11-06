/**
 * Idempotent synthetic seed for the local preview (see preview-stack.ts). Talks to the RUNNING preview API over HTTP plus Prisma on the preview database
 * only. Re-running never duplicates users, vacancies or documents: accounts are looked up by e-mail, vacancies upsert on a stable external id, and every
 * generation carries a fixed requestId (the server replays it instead of charging again).
 *
 * Everything created here is SYNTHETIC. Documents are written by the deterministic fake generator (not a language model); match scores come from the
 * keyword-overlap fixture scorer. Accounts use @example.com addresses; nothing is ever sent anywhere.
 * Credentials are generated once into $AISE_PREVIEW_HOME/credentials.json (0600, outside git).
 */
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { docxFromLines, DOCX_MIME } from './docx';
import { PREVIEW_DB, PREVIEW_PORTS, previewHome } from './preview-config';

const API = `http://127.0.0.1:${PREVIEW_PORTS.api}`;
const PG = process.env.PREVIEW_PG_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433';
const prisma = new PrismaClient({ datasources: { db: { url: `${PG}/${PREVIEW_DB}?schema=public` } } });
const log = (m: string) => console.log(`[seed] ${m}`);

interface Credentials { password: string; candidate: string; plus: string; fresh: string; employer: string; admin: string }
function credentials(): Credentials {
  const file = join(previewHome, 'credentials.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const c: Credentials = {
    password: `Preview-${randomBytes(5).toString('hex')}-7!`,
    candidate: 'leyla.preview@example.com', plus: 'resad.preview@example.com', fresh: 'yeni.preview@example.com',
    employer: 'employer.preview@example.com', admin: 'admin.preview@example.com',
  };
  writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
  return c;
}
const cred = credentials();

const call = async (path: string, token: string | null, init: RequestInit = {}) => {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  const text = await res.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
};
const must = async (what: string, p: Promise<{ status: number; body: any }>, ok: number[] = [200, 201]) => {
  const r = await p;
  if (!ok.includes(r.status)) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body)?.slice(0, 300)}`);
  return r.body;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, read: () => Promise<T>, ok: (v: T) => boolean, ms = 60_000): Promise<T> {
  const end = Date.now() + ms; let last: T | undefined;
  while (Date.now() < end) { last = await read(); if (ok(last)) return last; await wait(400); }
  throw new Error(`${what}: not reached (last ${JSON.stringify(last)?.slice(0, 300)})`);
}

/** Candidate: registered through the real route, verified directly in the preview database (the e-mail is captured, not delivered), then logged in. */
async function candidate(email: string): Promise<{ id: string; token: string }> {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await must(`register ${email}`, call('/auth/register', null, { method: 'POST', body: JSON.stringify({ email, password: cred.password }) }));
    user = await prisma.user.findUniqueOrThrow({ where: { email } });
    log(`created candidate ${email}`);
  }
  if (!user.emailVerified) await prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
  const login = await must(`login ${email}`, call('/auth/login', null, { method: 'POST', body: JSON.stringify({ email, password: cred.password }) }));
  return { id: user.id, token: login.sessionToken };
}

const SKILLS = ['TypeScript', 'Node.js', 'PostgreSQL', 'REST API', 'SQL', 'Power BI', 'Python'];
const CV_LINES = (name: string, email: string) => [
  name, email, 'Bakı',
  'Təcrübə', 'Jan 2022 - Present', 'Backend Engineer | Qafqaz Labs (sintetik)', '• REST API hazırladı', '• PostgreSQL ilə hesabat sorğuları yazdı',
  'Layihələr', 'Kredit risk paneli | Universitet layihəsi 2022', '• Power BI ilə panel qurdum', '• Nəticədə hesabat vaxtı 40% azaldı',
  'Könüllülük', 'Təşkilatçı, Gənclər Təşkilatı', '2019 - 2020', '• Tədbirlərin koordinasiyası',
  'Sertifikatlar', 'Google Data Analytics – Coursera 2022',
  'Dillər', 'Azərbaycan dili - anadil, English (B2)', 'Rus dili',
];

/** Onboards a candidate once (CV upload through the real route, profile, confirmed career evidence). A completed onboarding is never touched again. */
async function onboard(who: { id: string; token: string }, name: string, email: string, headline: string) {
  const profile = await call('/profile', who.token);
  if (profile.body?.onboardingCompleted || profile.body?.onboardingCompletedAt) return false;
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(docxFromLines(CV_LINES(name, email)))], { type: DOCX_MIME }), 'cv.docx');
  await must('upload CV', call('/resumes', who.token, { method: 'POST', body: form }));
  await must('profile', call('/profile', who.token, { method: 'PATCH', body: JSON.stringify({
    name, headline, skills: SKILLS, location: 'Bakı',
    experiences: [{ title: 'Backend Engineer', company: 'Qafqaz Labs (sintetik)', startDate: '2022-01-01', description: 'REST API hazırladı. PostgreSQL ilə hesabat sorğuları yazdı.' }],
  }) }));
  const entries = (await must('career entries', call('/profile/career-entries', who.token))).entries as any[];
  const suggested = entries.filter((e) => e.status === 'SUGGESTED').map((e) => e.id);
  if (suggested.length) await must('confirm suggestions', call('/profile/career-entries/review', who.token, { method: 'POST', body: JSON.stringify({ confirm: suggested }) }));
  await must('complete onboarding', call('/profile/complete-onboarding', who.token, { method: 'POST' }));
  log(`onboarded ${email}`);
  return true;
}

const VACANCIES = [
  { slug: 'backend-nodejs', title: 'Backend Developer (Node.js, PostgreSQL)', company: 'Qafqaz Labs (sintetik)', description: 'Node.js, TypeScript və PostgreSQL ilə REST API hazırlayacaq backend developer axtarırıq. SQL və REST API təcrübəsi tələb olunur. CV-nizi hr@qafqazlabs.example ünvanına göndərin; mövzu: "Backend Developer - REF-QL-07".', email: true },
  { slug: 'data-analyst', title: 'Data Analitik', company: 'Xəzər Analitika (sintetik)', description: 'SQL, Power BI və Python ilə hesabatlar hazırlayacaq analitik. PostgreSQL biliyi üstünlükdür. Müraciət saytda.' },
  { slug: 'data-engineer', title: 'Data Mühəndisi', company: 'Bakı Data Mərkəzi (sintetik)', description: 'Data pipeline qurmaq: PostgreSQL, Python, SQL. Airflow bilikləri üstünlükdür. Müraciət üçün data@bakidata.example ünvanına CV göndərin; mövzu: "Data Mühəndisi - REF-BD-12".', email: true },
  { slug: 'frontend', title: 'Frontend Developer (React, TypeScript)', company: 'Bakı Dijital (sintetik)', description: 'React və TypeScript ilə veb tətbiqlər. CSS və REST API ilə inteqrasiya təcrübəsi. Müraciət saytda.' },
  { slug: 'qa', title: 'QA Mühəndisi (TypeScript)', company: 'Xəzər Analitika (sintetik)', description: 'Playwright və TypeScript ilə avtomatlaşdırılmış testlər, REST API testləri, SQL ilə məlumat yoxlaması. Müraciət saytda.' },
  { slug: 'devops', title: 'DevOps Mühəndisi', company: 'Şimal Texnologiya (sintetik)', description: 'Docker, Linux, PostgreSQL administrasiyası və CI/CD. Python skriptləri üstünlükdür. Müraciət saytda.' },
  { slug: 'project-manager', title: 'Layihə meneceri', company: 'Kaspi Media (sintetik)', description: 'Agile komandalara rəhbərlik, Jira, müştəri ünsiyyəti. Texniki fon üstünlükdür. Müraciət saytda.' },
  { slug: 'marketing', title: 'Marketinq meneceri', company: 'Kaspi Media (sintetik)', description: 'Rəqəmsal marketinq kampaniyaları, sosial media, büdcə idarəetməsi. Müraciət saytda.' },
  { slug: 'accountant', title: 'Mühasib', company: 'Orta Yol MMC (sintetik)', description: '1C proqramı, vergi hesabatları, debitor və kreditor borcların uçotu. Müraciət saytda.' },
  { slug: 'support', title: 'Müştəri xidməti operatoru', company: 'Orta Yol MMC (sintetik)', description: 'Rus və Azərbaycan dillərində zəng və yazışma. Mehriban ünsiyyət. Müraciət saytda.' },
];

async function vacancies(serviceToken: string) {
  // The import route only accepts a registered source: a clearly synthetic one, so no real employer or job board is named as the origin.
  await prisma.jobSource.upsert({
    where: { key: 'preview' },
    update: { enabled: true },
    create: { key: 'preview', name: 'Preview (sintetik nümunə)', homepageUrl: 'https://preview.example', collectionMethod: 'synthetic-seed', scope: 'Local preview sample vacancies; not real postings', accessReview: 'UNREVIEWED', accessNote: 'Synthetic data created by the local preview seed.', enabled: true },
  });
  const ids: Record<string, string> = {};
  for (const v of VACANCIES) {
    const res = await fetch(`${API}/internal/jobs/ingest`, {
      method: 'POST', headers: { Authorization: `Bearer ${serviceToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalId: `preview:${v.slug}`, title: v.title, company: v.company, description: v.description, location: 'Bakı', url: `https://preview.example/jobs/${v.slug}`, postedAt: new Date(Date.now() - (VACANCIES.indexOf(v) + 1) * 86_400_000).toISOString() }),
    });
    if (!res.ok) throw new Error(`ingest ${v.slug}: ${res.status} ${await res.text()}`);
    ids[v.slug] = (await res.json()).jobId;
  }
  log(`vacancies upserted (${VACANCIES.length})`);
  return ids;
}

async function matchFor(userId: string, jobId: string) {
  const m = await until(`match for ${jobId}`, () => prisma.match.findFirst({ where: { userId, jobId } }), (x) => !!x, 90_000);
  return m!.id;
}

/** One generated document: requestId is fixed, so a second run replays instead of charging. Returns the document id once it has left PENDING. */
async function generate(token: string, matchId: string, kind: 'CV' | 'RESUME' | 'LETTER', language: string, key: string, letter?: { motivation: string; storyIds: string[] }) {
  const quote = await must('quote', call('/documents/quote', token, { method: 'POST', body: JSON.stringify({ matchId, items: [{ kind, language }] }) }));
  const out = await must(`generate ${key}`, call('/documents/generate', token, { method: 'POST', body: JSON.stringify({ matchId, items: [{ kind, language }], expectedUnits: quote.units, requestId: `preview-seed-${key}`, ...(letter ? { letter } : {}) }) }));
  const id = out.documents[0].id as string;
  const doc = await until(`document ${key}`, async () => (await call(`/documents/${id}`, token)).body, (d: any) => d && d.status !== 'PENDING', 90_000);
  if (doc.status === 'FAILED') throw new Error(`document ${key} FAILED: ${doc.statusError}`);
  return doc as { id: string; status: string };
}
const approve = async (token: string, id: string) => must('approve', call(`/documents/${id}/approve`, token, { method: 'POST' }));

async function candidateDocuments(who: { id: string; token: string }, jobs: Record<string, string>) {
  const backend = await matchFor(who.id, jobs['backend-nodejs']);
  const engineer = await matchFor(who.id, jobs['data-engineer']);
  const analyst = await matchFor(who.id, jobs['data-analyst']);

  let cv = (await call(`/documents?matchId=${backend}&kind=CV`, who.token)).body?.[0];
  if (!cv) { cv = await generate(who.token, backend, 'CV', 'az', 'a-cv-backend'); log('generated CV (az) for the backend vacancy'); }
  if (cv.status !== 'READY') { await approve(who.token, cv.id); log('approved the CV'); }

  let letterDoc = (await call(`/documents?matchId=${backend}&kind=LETTER`, who.token)).body?.[0];
  if (!letterDoc) {
    const stories = (await must('stories', call('/profile/career-entries?kind=STORY', who.token))).entries as any[];
    let story = stories.find((s) => s.title === 'Hesabat sürəti');
    if (!story) story = await must('story', call('/profile/career-entries', who.token, { method: 'POST', body: JSON.stringify({ kind: 'STORY', title: 'Hesabat sürəti', situation: 'Hesabat sorğuları çox yavaş idi.', action: 'PostgreSQL indekslərini yenilədim.', result: 'Hesabat vaxtı 40% azaldı.' }) }));
    if (story.status !== 'CONFIRMED') await must('confirm story', call(`/profile/career-entries/${story.id}/confirm`, who.token, { method: 'POST' }));
    letterDoc = await generate(who.token, backend, 'LETTER', 'en', 'a-letter-backend', { motivation: 'I enjoy turning slow reports into fast ones and would like to build reliable APIs at your company.', storyIds: [story.id] });
    log('generated motivation letter (en) for the backend vacancy');
  }
  if (letterDoc.status !== 'READY') { await approve(who.token, letterDoc.id); log('approved the letter'); }

  let draft = (await call(`/documents?matchId=${engineer}&kind=RESUME`, who.token)).body?.[0];
  if (!draft) { await generate(who.token, engineer, 'RESUME', 'ru', 'a-resume-engineer'); log('generated a concise resume (ru), left as a draft for review'); }
  void analyst;

  // An e-mail application prepared with the approved CV and letter, deliberately NOT approved: the founder presses approve and watches the capture sink.
  const existing = await call(`/email-applications/eligibility/${jobs['backend-nodejs']}`, who.token);
  if (!existing.body?.existing) {
    const r = await call('/email-applications/prepare', who.token, { method: 'POST', body: JSON.stringify({ jobId: jobs['backend-nodejs'], resumeId: cv.id, letterId: letterDoc.id }) });
    if (![200, 201].includes(r.status)) log(`e-mail application not prepared: HTTP ${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`); else log('prepared an e-mail application (awaiting approval)');
  }
}

async function employer() {
  const email = cred.employer;
  let biz = await prisma.business.findUnique({ where: { email } });
  if (!biz) {
    await must('business register', call('/business/auth/register', null, { method: 'POST', body: JSON.stringify({ email, password: cred.password, companyName: 'Qafqaz Labs (sintetik)' }) }), [200, 201]);
    biz = await prisma.business.findUniqueOrThrow({ where: { email } });
    log(`created employer ${email}`);
  }
  if (!biz.emailVerified) await prisma.business.update({ where: { id: biz.id }, data: { emailVerified: new Date() } });
}

async function admin() {
  if (await prisma.adminUser.findUnique({ where: { email: cred.admin } })) return;
  const created = await prisma.adminUser.create({ data: { email: cred.admin, name: 'Preview Admin (sintetik)', hashedPassword: await bcrypt.hash(cred.password, 10), role: 'SUPER_ADMIN', passwordChangedAt: new Date() } });
  await prisma.adminAuditLog.create({ data: { adminUserId: null, action: 'ADMIN_CREATED_FOR_LOCAL_PREVIEW', targetType: 'AdminUser', targetId: created.id, metadata: { email: cred.admin } } });
  log(`created admin ${cred.admin}`);
}

async function main() {
  const state = JSON.parse(readFileSync(join(previewHome, 'state.json'), 'utf8'));
  if (!state.ready) throw new Error('The preview is not running');
  const a = await candidate(cred.candidate);
  const plus = await candidate(cred.plus);
  await candidate(cred.fresh); // left at the onboarding wizard on purpose
  const existingOverride = await prisma.planOverride.findFirst({ where: { userId: plus.id, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (!existingOverride) await prisma.planOverride.create({ data: { userId: plus.id, plan: 'PLUS', reason: 'Local preview: operator-granted Plus, no payment involved', expiresAt: new Date(Date.now() + 365 * 86_400_000) } });
  await onboard(a, 'Leyla Hüseynova', cred.candidate, 'Backend Engineer');
  await onboard(plus, 'Rəşad Məmmədov', cred.plus, 'Data Analitik');
  const jobs = await vacancies(state.serviceToken);
  await candidateDocuments(a, jobs);
  await employer();
  await admin();
  log('done');
}
main().then(() => prisma.$disconnect(), async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
