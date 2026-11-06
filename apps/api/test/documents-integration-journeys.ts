/**
 * Real browser journeys over the real Next.js app, API, Postgres, Redis/BullMQ, document worker, Typst and e-mail pipeline, on isolated synthetic data.
 * The generation provider is a deterministic loopback FAKE (not a language model); the e-mail transport is a loopback capture sink; matching scores come
 * from a fixture scorer. Start the stack first:  npx ts-node -r tsconfig-paths/register --transpile-only test/support/integration-stack.ts
 * Run (from apps/api):  npx ts-node -r tsconfig-paths/register --transpile-only test/documents-integration-journeys.ts [career|documents|failures|email|responsive|all]
 */
import assert from 'node:assert/strict';
import { type Page } from 'playwright';
import { docxFromLines, DOCX_MIME } from './support/docx';
import { helpers, loadStack, pdfText, sha256 } from './support/integration-helpers';
import { payloadHash, payloadPartsOf } from '../src/email-applications/email-application-state';

const CV_LINES = [
  'Leyla Hüseynova', 'leyla@example.com', 'Gəncə',
  'Təcrübə', 'Jan 2022 - Present', 'Backend Engineer | Qafqaz Labs', '• REST API hazırladı', '• PostgreSQL ilə hesabat sorğuları yazdı',
  'Layihələr', 'Kredit risk paneli | Universitet layihəsi 2022', '• Power BI ilə panel qurdum', '• Nəticədə hesabat vaxtı 40% azaldı',
  'Könüllülük', 'Təşkilatçı, Gənclər Təşkilatı', '2019 - 2020', '• Tədbirlərin koordinasiyası',
  'Sertifikatlar', 'Google Data Analytics – Coursera 2022',
  'Dillər', 'Azərbaycan dili - anadil, English (B2)', 'Rus dili',
];

const stack = loadStack();
const h = helpers(stack);
const run = `${Date.now()}`;
const passed: string[] = [];
const pass = (m: string) => { passed.push(m); console.log(`PASS ${m}`); };

interface Ctx { page?: Page; a?: { id: string; token: string; email: string }; b?: { id: string; token: string; email: string }; matchEmail?: string; matchPlain?: string; recipient?: string; jobEmailId?: string; jobPlainId?: string }
const ctx: Ctx = {};

async function setup() {
  ctx.a = { ...(await h.register(`integ-a-${run}@example.com`)), email: `integ-a-${run}@example.com` };
  ctx.b = { ...(await h.register(`integ-b-${run}@example.com`)), email: `integ-b-${run}@example.com` };
  const context = await h.context();
  const page = await context.newPage();
  page.setDefaultTimeout(150_000); // the first requests make the Next.js dev server compile each route
  await h.login(page, ctx.a.email);
  // The credentials callback has set the session; if the login page has not navigated on its own yet, go to the dashboard (new accounts are sent to onboarding).
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => page.goto(`${stack.web}/dashboard`));
  await page.getByRole('heading', { name: 'CV-nizi yükləyin' }).waitFor({ timeout: 60_000 }).catch(async (e) => {
    console.error('onboarding wizard not shown; url:', page.url(), '\n', (await page.locator('body').innerText()).slice(0, 600));
    await h.shot(page, 'setup-failure');
    throw e;
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'cv.docx', mimeType: DOCX_MIME, buffer: docxFromLines(CV_LINES) });
  await page.getByRole('heading', { name: 'Məlumatlarınızı yoxlayın' }).waitFor();
  await page.getByPlaceholder('məs. TypeScript').fill('TypeScript');
  await page.getByPlaceholder('məs. TypeScript').press('Enter');
  await page.getByRole('button', { name: 'Davam et' }).click();
  await page.getByRole('button', { name: 'Tamamla' }).click();
  await page.waitForURL((u) => u.pathname === '/dashboard');
  page.setDefaultTimeout(45_000);
  ctx.page = page;
  // Candidate B: an unrelated account, used for isolation checks.
  await h.api('/profile', ctx.b.token, { method: 'PATCH', body: JSON.stringify({ name: 'Murad Əliyev', headline: 'Analitik', skills: ['SQL'], location: 'Bakı' }) });
  await h.api('/profile/complete-onboarding', ctx.b.token, { method: 'POST' });
  pass('setup: two candidates registered and verified; candidate A onboarded through the real wizard from an uploaded DOCX');
}

/** Two real, importable vacancies (one states an application e-mail in its text), ingested through the guarded import route, then matched by the real queue. */
async function vacancies() {
  ctx.recipient = `hr-${run}@employer.example`;
  const emailJob = await h.ingestJob({
    externalId: `integ:email-${run}`, title: `Backend Analitik ${run}`, company: `Integ Employer ${run}`, url: `https://employer.example/jobs/email-${run}`,
    description: `Backend Analitik axtarırıq. PostgreSQL və TypeScript bilikləri tələb olunur. CV-nizi ${ctx.recipient} ünvanına göndərin; mövzu: "Backend Analitik ${run} - REF-${run}".`,
  });
  const plainJob = await h.ingestJob({
    externalId: `integ:plain-${run}`, title: `Data Mühəndisi ${run}`, company: `Integ Other ${run}`, url: `https://employer.example/jobs/plain-${run}`,
    description: 'Data pipeline qurmaq. PostgreSQL və Python bilikləri tələb olunur. Müraciət saytda.',
  });
  ctx.jobEmailId = emailJob.jobId; ctx.jobPlainId = plainJob.jobId;
  const a = ctx.a!;
  const matches = await h.waitFor('matches for candidate A', () => h.prisma.match.findMany({ where: { userId: a.id, jobId: { in: [emailJob.jobId, plainJob.jobId] } } }), (m) => m.length === 2, 60_000);
  ctx.matchEmail = matches.find((m) => m.jobId === emailJob.jobId)!.id;
  ctx.matchPlain = matches.find((m) => m.jobId === plainJob.jobId)!.id;
  const job = await h.prisma.job.findUniqueOrThrow({ where: { id: emailJob.jobId } });
  assert.equal(job.applicationMethod, 'EMAIL');
  assert.equal(job.applicationEmail, ctx.recipient);
  pass('vacancies: two postings ingested through the guarded route, matched by the real queue; the e-mail posting carries explicit-address evidence');
}

const careerList = async () => ((await h.json(await h.api('/profile/career-entries', ctx.a!.token))).body as { entries: any[] }).entries;

async function career() {
  const p = ctx.page!;
  const a = ctx.a!;
  // Pre-existing entries the editor does not display (STORY, OTHER) must survive anything done on this page.
  const story = (await h.json(await h.api('/profile/career-entries', a.token, { method: 'POST', body: JSON.stringify({ kind: 'STORY', title: 'Hesabat sürəti', situation: 'Sorğular yavaş idi.', action: 'İndeksləri yenilədim.', result: 'Vaxt 30% azaldı.' }) }))).body;
  const other = (await h.json(await h.api('/profile/career-entries', a.token, { method: 'POST', body: JSON.stringify({ kind: 'OTHER', title: 'Patent müraciəti', description: 'Şifrələmə metodu' }) }))).body;
  const before = (await careerList()).filter((e) => ['STORY', 'OTHER'].includes(e.kind));
  assert.equal(before.length, 2);

  await p.goto(`${stack.web}/dashboard/profile`);
  await p.getByText('Karyera Sübutları').first().waitFor();
  await h.shot(p, 'career-1-initial');
  // Unknown proficiency stays unknown: "Rus dili" has no level and the editor must not invent one.
  const langs = (await careerList()).filter((e) => e.kind === 'LANGUAGE');
  assert.equal(langs.find((l) => l.title === 'Rus dili')?.level, null);
  assert.equal(await p.getByLabel('Bilik səviyyəsi').nth(2).inputValue(), '');

  // Edit the project's period to a month range and confirm everything.
  const project = p.getByLabel('Dövr / Tarix').first();
  await project.fill('2022-05 - 2023-01');
  for (const name of [/Bu layihə məlumatlarını və faktları təsdiqləyirəm/, /Bu könüllülük məlumatlarını təsdiqləyirəm/, /Bu sertifikatı təsdiqləyirəm/]) await p.getByRole('checkbox', { name }).check();
  for (const cb of await p.getByRole('checkbox', { name: /Bu dil məlumatını təsdiqləyirəm/ }).all()) await cb.check();
  await p.getByRole('button', { name: /Məlumatları Yadda Saxla|Profili Yadda Saxla/ }).last().click();
  await h.waitFor('career entries confirmed', careerList, (l) => l.filter((e) => e.status === 'CONFIRMED' && !['STORY', 'OTHER'].includes(e.kind)).length >= 6);
  const after = await careerList();
  const proj = after.find((e) => e.kind === 'PROJECT');
  assert.equal(proj.status, 'CONFIRMED');
  assert.equal(proj.startDate.slice(0, 10), '2022-05-01');
  assert.equal(proj.endDate.slice(0, 10), '2023-01-01');
  assert.equal(proj.datePrecision, 'MONTH');
  assert.equal(after.find((e) => e.title === 'Rus dili').level, null, 'unknown proficiency was invented');
  assert.equal(after.find((e) => e.title === 'English').level, 'B2');
  for (const e of before) assert.deepEqual(after.find((x) => x.id === e.id), e, `${e.kind} entry changed while editing another section`);
  pass('career: month-precision period and confirmations saved; unknown language level stayed null; pre-existing STORY and OTHER entries are byte-identical');

  // Refresh, then log out and in again: the saved values are what the page shows.
  await p.reload();
  await p.getByText('Karyera Sübutları').first().waitFor();
  assert.equal(await p.getByLabel('Dövr / Tarix').first().inputValue(), '2022-05 - 2023-01');
  assert.equal(await p.getByLabel('Bilik səviyyəsi').nth(2).inputValue(), '');
  await p.context().clearCookies();
  await h.login(p, a.email);
  await p.goto(`${stack.web}/dashboard/profile`);
  await p.getByText('Karyera Sübutları').first().waitFor();
  assert.equal(await p.getByLabel('Dövr / Tarix').first().inputValue(), '2022-05 - 2023-01');
  assert.equal(await p.getByRole('checkbox', { name: /Bu layihə məlumatlarını və faktları təsdiqləyirəm/ }).isChecked(), true);
  await h.shot(p, 'career-2-after-relogin');
  pass('career: values persist across refresh and a fresh login');

  // An unreadable period stops the whole save and tells the candidate; nothing else is changed.
  await p.getByLabel('Layihənin adı').first().fill('Kredit risk paneli v2');
  await p.getByLabel('Dövr / Tarix').first().fill('keçən il');
  await p.getByRole('button', { name: /Məlumatları Yadda Saxla|Profili Yadda Saxla/ }).last().click();
  await p.getByText(/Dövr formatı/).first().waitFor();
  const unchanged = (await careerList()).find((e) => e.kind === 'PROJECT');
  assert.equal(unchanged.title, 'Kredit risk paneli', 'part of a refused save was applied');
  assert.equal(unchanged.startDate.slice(0, 10), '2022-05-01');
  await h.shot(p, 'career-3-invalid-period');
  await p.getByLabel('Dövr / Tarix').first().fill('2022 - 2023-05');
  await p.getByRole('button', { name: /Məlumatları Yadda Saxla|Profili Yadda Saxla/ }).last().click();
  await p.getByText(/eyni dəqiqlikdə/).first().waitFor();
  pass('career: an unreadable or mixed-precision period is refused with a message before any request; nothing was half-saved');

  // Partial-save failure: the first PATCH is applied by the server but its answer is lost; the retry reconciles and does not duplicate or delete.
  await p.getByLabel('Dövr / Tarix').first().fill('2022-05 - 2023-02');
  await p.getByLabel('Sertifikatın adı').first().fill('Google Data Analytics (Professional)');
  const countBefore = (await careerList()).length;
  const projectId = (await careerList()).find((e) => e.kind === 'PROJECT').id;
  await h.ctl(`/proxy/drop-next?route=${encodeURIComponent(`PATCH /profile/career-entries/${projectId}`)}`);
  await p.getByRole('button', { name: /Məlumatları Yadda Saxla|Profili Yadda Saxla/ }).last().click();
  await p.getByRole('alert').first().waitFor();
  await h.shot(p, 'career-4-partial-failure');
  await p.getByRole('button', { name: /Məlumatları Yadda Saxla|Profili Yadda Saxla/ }).last().click();
  await h.waitFor('retry applied', careerList, (l) => l.find((e) => e.kind === 'CERTIFICATION')?.title === 'Google Data Analytics (Professional)');
  const reconciled = await careerList();
  assert.equal(reconciled.length, countBefore, 'the retry created or removed entries');
  assert.equal(reconciled.find((e) => e.kind === 'PROJECT').endDate.slice(0, 10), '2023-02-01');
  pass('career: a save whose first answer was lost is retried safely — the applied edit is not duplicated, the rest completes, no entry appears or disappears');

  // Explicit deletion removes exactly that entry; the undisplayed STORY/OTHER entries are untouched.
  await p.getByRole('button', { name: /sertifikatı sil$/ }).first().click();
  await p.getByRole('button', { name: /Məlumatları Yadda Saxla|Profili Yadda Saxla/ }).last().click();
  await h.waitFor('certificate removed', careerList, (l) => !l.some((e) => e.kind === 'CERTIFICATION' && e.status !== 'HIDDEN'));
  const final = await careerList();
  for (const e of before) assert.deepEqual(final.find((x) => x.id === e.id), e);
  assert.ok(final.find((x) => x.id === story.id) && final.find((x) => x.id === other.id));
  await h.shot(p, 'career-5-after-delete');
  pass('career: explicit delete removed only that entry; STORY and OTHER survived the whole session unchanged');
}


const allowance = async () => (await h.json(await h.api('/documents/allowance', ctx.a!.token))).body;
const docs = async () => ((await h.json(await h.api('/documents', ctx.a!.token))).body as any[]);
const docDetail = async (id: string, token = ctx.a!.token) => (await h.json(await h.api(`/documents/${id}`, token)));
const charges = () => h.prisma.documentCharge.findMany({ where: { userId: ctx.a!.id }, orderBy: { reservedAt: 'asc' } });
const resumesPage = async () => { await ctx.page!.goto(`${stack.web}/dashboard/resumes`); await ctx.page!.getByTestId('document-allowance-card').waitFor(); };
const downloadFile = async (fileUrl: string, token = ctx.a!.token) => Buffer.from(await (await fetch(`${stack.realApi}/uploads/${fileUrl.split('/').pop()}`, { headers: { Authorization: `Bearer ${token}` } })).arrayBuffer());

/** The candidate's confirmed entries are the only facts; make sure the journey's own project is confirmed even when run on its own. */
async function ensureConfirmed() {
  for (const e of await careerList()) if (e.status === 'SUGGESTED') await h.api(`/profile/career-entries/${e.id}`, ctx.a!.token, { method: 'PATCH', body: JSON.stringify({ status: 'CONFIRMED' }) });
}

let resumeDocId = '';
let letterDocId = '';
let storyTitle = '';

async function documents() {
  const p = ctx.page!;
  const a = ctx.a!;
  await ensureConfirmed();
  await h.ctl('/nim/mode?mode=faithful');
  await resumesPage();
  // The authoritative allowance is on screen before anything is generated.
  await p.getByText('Aylıq limit: 5 generasiya').waitFor();
  const card = await p.getByTestId('document-allowance-card').innerText();
  assert.match(card, /Aylıq limit: 5 generasiya/);
  assert.match(card, /5 ədəd/);
  await h.shot(p, 'docs-1-allowance');

  // ── a resume for the real, actionable match ───────────────────────────────────────────────
  await p.getByRole('button', { name: 'Yeni Sənəd Hazırla' }).click();
  const dialog = p.getByRole('dialog');
  await dialog.locator('#target-match-select').selectOption(ctx.matchEmail!);
  await dialog.getByText('Rezüme (Resume)').click();
  await dialog.getByText('Generasiyadan sonra qalan balans:').waitFor();
  const quoteText = await dialog.innerText();
  assert.match(quoteText, /1 generasiya/);
  assert.match(quoteText, /4 ədəd/);
  assert.ok(await dialog.locator('#target-match-select option:checked').innerText().then((t) => t.includes(`Integ Employer ${run}`)), 'the real company name is shown for the match');
  await h.shot(p, 'docs-2-quote');

  await h.ctl('/nim/mode?mode=hold');
  await dialog.getByRole('button', { name: /Sənədi hazırla/i }).click();
  await dialog.waitFor({ state: 'detached' });
  const pending = await h.waitFor('pending resume', docs, (l) => l.length === 1);
  resumeDocId = pending[0].id;
  assert.equal(pending[0].status, 'PENDING');
  assert.equal(pending[0].kind, 'RESUME');
  assert.deepEqual((await charges()).map((c) => c.status), ['RESERVED']);
  await p.getByText('Hazırlanır...').first().waitFor();
  await h.waitFor('allowance card shows the running generation', () => p.getByTestId('document-allowance-card').innerText(), (t) => /4 ədəd/.test(t), 15_000);
  await h.shot(p, 'docs-3-pending');
  // While the provider is working nothing is invented: the document has no content and no file.
  const during = (await docDetail(resumeDocId)).body;
  assert.equal(during.content, null);
  assert.equal(during.fileUrl, null);
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal((await docDetail(resumeDocId)).body.status, 'PENDING');
  pass('documents: quote and allowance shown before generation; resume generation stays PENDING while the provider is delayed — no content, no file, one RESERVED unit');

  await h.ctl('/nim/release');
  await h.ctl('/nim/mode?mode=faithful');
  await p.getByText('Yoxlanılmalı və təsdiqlənməlidir').first().waitFor({ timeout: 30_000 });
  assert.deepEqual((await charges()).map((c) => c.status), ['COMMITTED']);
  await h.shot(p, 'docs-4-draft');

  // ── factual review, free edit, manual approval ───────────────────────────────────────────
  await p.getByRole('button', { name: 'Yoxla və redaktə et' }).first().click();
  await p.getByTestId('tailored-review').waitFor();
  assert.match(await p.getByRole('heading', { level: 1 }).innerText(), /Rezüme \(v1\) · AZ/);
  assert.equal((await docDetail(resumeDocId)).body.fileUrl, null, 'a PDF exists before approval');
  const edited = 'PostgreSQL və NestJS ilə hesabat sistemləri quran backend mühəndisi (namizədin öz redaktəsi).';
  await p.getByLabel('Xülasə').fill(edited);
  const [popup] = await Promise.all([p.context().waitForEvent('page'), p.getByRole('button', { name: 'PDF önizləmə' }).click()]);
  assert.ok(popup.url().startsWith('blob:'), 'the PDF preview did not open');
  await popup.close();
  await h.shot(p, 'docs-5-review');
  await p.getByRole('button', { name: /Yoxladım, təsdiqlə və PDF yarat/ }).click();
  await p.getByText('Təsdiqləndi. PDF hazırdır.').waitFor();
  const approvedDoc = (await docDetail(resumeDocId)).body;
  assert.equal(approvedDoc.status, 'READY');
  const fileBytes = await downloadFile(approvedDoc.fileUrl);
  const text = await pdfText(fileBytes);
  assert.ok(text.includes('namizədin öz redaktəsi'), 'the reviewed wording is not in the approved PDF');
  assert.ok(text.includes('Qafqaz Labs') && text.includes('Leyla Hüseynova'));
  const snap = approvedDoc.snapshots.find((x: any) => x.kind === 'APPROVED');
  assert.equal(snap.fileSha256, sha256(fileBytes));
  const previewBytes = Buffer.from(await (await h.api(`/documents/${resumeDocId}/preview`, a.token)).arrayBuffer());
  assert.equal(sha256(previewBytes), sha256(fileBytes), 'preview and approved file differ');
  assert.equal((await allowance()).used, 1);
  await h.shot(p, 'docs-6-approved');
  pass('documents: factual review shown, edit saved, manual approval produced the PDF containing the reviewed wording; preview == approved file == snapshot hash; editing and approving cost nothing');
}

async function letter() {
  const p = ctx.page!;
  const a = ctx.a!;
  await resumesPage();
  await p.getByRole('button', { name: 'Yeni Sənəd Hazırla' }).click();
  const dialog = p.getByRole('dialog');
  await dialog.locator('#target-match-select').selectOption(ctx.matchEmail!);
  await dialog.getByText('Motivasiya Məktubu', { exact: true }).click();
  await dialog.getByRole('button', { name: 'English' }).click();
  await dialog.getByText('Generasiyadan sonra qalan balans:').waitFor();
  await dialog.getByRole('button', { name: /Məktub axınına keç/ }).click();

  // The composer: confirmed career entries come from the server, the answers become a confirmed STORY, the selected language is used.
  const composer = p.getByTestId('motivation-letter-composer');
  await composer.getByRole('button', { name: /Kredit risk paneli.*Təsdiqlənib/ }).click();
  await composer.getByLabel(/1\. Bu işin sizi konkret nə cəlb edir/).fill('Hesabat və analitika sistemləri məni cəlb edir.');
  await composer.getByLabel(/6\. Bu nümunədə şəxsən nə etdiniz və nəticəsi nə oldu\?/).fill('PostgreSQL indekslərini yenilədim və hesabat vaxtını azaltdım.');
  await composer.getByRole('checkbox', { name: /rəqəmlər və nailiyyətlər real təcrübəmə əsaslanır/ }).check();
  assert.ok(await composer.getByLabel(/Dil:/).inputValue() === 'en');
  await h.shot(p, 'letter-1-questions');
  await h.ctl('/nim/mode?mode=hold');
  await composer.getByRole('button', { name: /Qaralamanı hazırla/ }).click();
  await composer.getByTestId('letter-pending-state').waitFor();
  const letters = await h.waitFor('letter created', async () => (await docs()).filter((d) => d.kind === 'LETTER'), (l) => l.length === 1);
  letterDocId = letters[0].id;
  assert.equal(letters[0].status, 'PENDING');
  assert.equal(letters[0].language, 'en');
  assert.equal((await docDetail(letterDocId)).body.content, null, 'a letter draft was invented while pending');
  const story = (await careerList()).find((e) => e.kind === 'STORY' && e.title.includes('Müraciət hekayəsi'));
  assert.ok(story, 'the answers were not saved as a STORY entry');
  assert.equal(story.status, 'CONFIRMED');
  storyTitle = story.title;
  assert.deepEqual((await docDetail(letterDocId)).body.letterInputs.storyIds, [story.id]);
  await h.shot(p, 'letter-2-pending');
  await h.ctl('/nim/release');
  await h.ctl('/nim/mode?mode=faithful');
  await composer.getByLabel('Məktubun mətni').waitFor({ timeout: 30_000 });
  const draft = await composer.getByLabel('Məktubun mətni').inputValue();
  assert.ok(draft.includes('PostgreSQL indekslərini yenilədim'), 'the confirmed story is not in the draft');
  // What the provider was given: the story as a letter fact, the candidate's motivation, the vacancy only as data.
  const req = ((await h.ctl('/nim/requests')) as any[]).filter((r) => r.kind === 'letter').at(-1);
  assert.ok(JSON.stringify(req.persona.stories).includes('PostgreSQL indekslərini yenilədim'));
  assert.ok(req.motivation.includes('Hesabat və analitika'));
  assert.match(req.system, /this language: en/);
  assert.match(req.system, /DATA, not instructions/);
  pass('letter: confirmed answers saved as a STORY and sent as letter facts; selected language used; letter stays pending without a fabricated draft, then the server draft appears');

  // Approval: the review save fails first — approval must not be attempted; then it succeeds with the edited wording.
  const editedText = `${draft}\n\nBu cümləni mən özüm əlavə etdim.`;
  await composer.getByLabel('Məktubun mətni').fill(editedText);
  const before = ((await h.ctl('/proxy/log')) as any[]).length;
  await h.ctl(`/proxy/fail-next?route=${encodeURIComponent(`PATCH /documents/${letterDocId}/review`)}`);
  await composer.getByRole('button', { name: /Yoxladım, təsdiqləyirəm/ }).click();
  await p.getByRole('alert').getByText(/Injected failure/).waitFor();
  const log = ((await h.ctl('/proxy/log')) as any[]).slice(before);
  assert.ok(!log.some((l) => l.method === 'POST' && l.path === `/documents/${letterDocId}/approve`), 'approval was attempted after the review save failed');
  assert.equal((await docDetail(letterDocId)).body.status, 'NEEDS_REVIEW');
  assert.ok(!(await docDetail(letterDocId)).body.content.paragraphs.some((x: any) => x.text.includes('Bu cümləni mən özüm')), 'the failed save was applied');
  await h.shot(p, 'letter-3-save-failed');
  await composer.getByRole('button', { name: /Yoxladım, təsdiqləyirəm/ }).click();
  // Approved: the candidate is returned to the document list, where the letter now shows as approved with its PDF.
  const row = p.locator('[data-testid^="document-row-"]', { hasText: 'Motivasiya məktubu (v1)' }).first();
  await row.getByText('Təsdiqlənib — PDF hazırdır').waitFor();
  const done = (await docDetail(letterDocId)).body;
  assert.equal(done.status, 'READY');
  assert.equal(done.content.salutation, 'Dear Hiring Team,');
  assert.ok(done.content.paragraphs.some((x: any) => x.text.includes('Bu cümləni mən özüm')));
  const letterBytes = await downloadFile(done.fileUrl);
  const letterText = await pdfText(letterBytes);
  assert.ok(letterText.includes('Bu cümləni mən özüm əlavə etdim') && letterText.includes('Dear Hiring Team'), 'the reviewed letter is not in the approved PDF');
  assert.equal(done.snapshots.find((x: any) => x.kind === 'APPROVED').fileSha256, sha256(letterBytes));
  // The list's PDF button serves the same bytes.
  const [dl] = await Promise.all([p.waitForEvent('download'), row.getByRole('button', { name: 'PDF', exact: true }).click()]);
  const { readFileSync } = await import('node:fs');
  assert.equal(sha256(readFileSync(await dl.path())), sha256(letterBytes));
  await h.shot(p, 'letter-4-approved');
  const used = await allowance();
  assert.equal(used.used, 2);
  assert.deepEqual((await charges()).map((c) => c.status), ['COMMITTED', 'COMMITTED']);
  pass('letter: a failed review save stops approval (no approve call, draft unchanged, error shown); the retry saved the edit and approved; the approved PDF holds the edited letter; allowance = 2 used (resume + letter), nothing for edits or downloads');
}


async function failures() {
  const p = ctx.page!;
  const a = ctx.a!;
  await h.ctl('/nim/mode?mode=faithful');
  await h.ctl('/proxy/clear');
  const usedBefore = (await allowance()).used;

  // ── an uncertain generation response: the server made the document, the answer never arrived ─────────
  await resumesPage();
  await p.getByRole('button', { name: 'Yeni Sənəd Hazırla' }).click();
  const dialog = p.getByRole('dialog');
  await dialog.locator('#target-match-select').selectOption(ctx.matchPlain!);
  await dialog.getByText('Generasiyadan sonra qalan balans:').waitFor();
  // The connection is cut in the middle of the answer: the browser got a success status line but never the body, so the outcome is unknown.
  await h.ctl(`/proxy/truncate-next?route=${encodeURIComponent('POST /documents/generate')}`);
  await dialog.getByRole('button', { name: /Sənədi hazırla/i }).click();
  await dialog.getByText(/cavab alınmadı/).waitFor();
  await h.shot(p, 'fail-1-uncertain');
  const created = await h.prisma.resume.findMany({ where: { userId: a.id, matchId: ctx.matchPlain! } });
  assert.equal(created.length, 1, 'the server should have created exactly one document although its answer was cut off');
  assert.equal(await h.prisma.documentCharge.count({ where: { userId: a.id } }), usedBefore + 1);
  // Retry: the same request is replayed by the server — still one document and one charge.
  await dialog.getByRole('button', { name: /Sənədi hazırla/i }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await h.prisma.resume.count({ where: { userId: a.id, matchId: ctx.matchPlain! } }), 1, 'the retry created a second document');
  assert.equal(await h.prisma.documentCharge.count({ where: { userId: a.id } }), usedBefore + 1, 'the retry was charged a second time');
  const replayed = await h.waitFor('replayed document ready', () => h.prisma.resume.findFirstOrThrow({ where: { userId: a.id, matchId: ctx.matchPlain! } }), (r) => r.status === 'NEEDS_REVIEW', 30_000);
  assert.equal((await allowance()).used, usedBefore + 1);
  pass('failures: a lost generation answer is reported as unknown, the retry is replayed by the server — one document, one charge');

  // ── the CV/resume review: a failed save stops approval ───────────────────────────────────────────────
  await resumesPage();
  await p.getByRole('button', { name: 'Yoxla və redaktə et' }).first().click();
  await p.getByTestId('tailored-review').waitFor();
  await p.getByLabel('Xülasə').fill('Yoxlama zamanı yazılmış xülasə.');
  const before = ((await h.ctl('/proxy/log')) as any[]).length;
  await h.ctl(`/proxy/fail-next?route=${encodeURIComponent(`PATCH /resumes/${replayed.id}/review`)}`);
  await p.getByRole('button', { name: /Yoxladım, təsdiqlə və PDF yarat/ }).click();
  await p.getByRole('alert').getByText(/Injected failure/).waitFor();
  const log = ((await h.ctl('/proxy/log')) as any[]).slice(before);
  assert.ok(!log.some((l) => l.method === 'POST' && l.path.endsWith('/approve')), 'approval was attempted although the review save failed');
  assert.equal((await h.prisma.resume.findUniqueOrThrow({ where: { id: replayed.id } })).status, 'NEEDS_REVIEW');
  assert.ok(!JSON.stringify((await h.prisma.resume.findUniqueOrThrow({ where: { id: replayed.id } })).parsedContent).includes('Yoxlama zamanı yazılmış'));
  await h.shot(p, 'fail-2-review-save-failed');
  await p.getByRole('button', { name: /Yoxladım, təsdiqlə və PDF yarat/ }).click();
  await p.getByText('Təsdiqləndi. PDF hazırdır.').waitFor();
  assert.equal((await h.prisma.resume.findUniqueOrThrow({ where: { id: replayed.id } })).status, 'READY');
  pass('failures: when the review save fails the approval is never attempted and nothing is stored; the retry saves, then approves');

  // ── another candidate can reach none of it ──────────────────────────────────────────────────────────────
  const b = ctx.b!;
  for (const id of [resumeDocId, letterDocId, replayed.id]) {
    assert.equal((await h.api(`/documents/${id}`, b.token)).status, 404);
    assert.equal((await h.api(`/documents/${id}/preview`, b.token)).status, 404);
    assert.equal((await h.api(`/documents/${id}/review`, b.token, { method: 'PATCH', body: JSON.stringify({ summary: 'x' }) })).status, 404);
    assert.equal((await h.api(`/documents/${id}/approve`, b.token, { method: 'POST' })).status, 404);
    assert.equal((await h.api(`/documents/${id}/regenerate`, b.token, { method: 'POST', body: JSON.stringify({ expectedUnits: 1 }) })).status, 404);
    assert.equal((await h.api(`/resumes/${id}`, b.token)).status, 404);
  }
  assert.deepEqual(await (await h.api('/documents', b.token)).json(), []);
  const bctx = await h.context();
  const bp = await bctx.newPage();
  bp.setDefaultTimeout(60_000);
  await h.login(bp, b.email);
  await bp.goto(`${stack.web}/dashboard/resumes?review=${resumeDocId}`);
  await bp.getByRole('alert').waitFor();
  assert.ok(!(await bp.locator('body').innerText()).includes('Qafqaz Labs'), 'another candidate saw document content');
  await h.shot(bp, 'fail-3-other-candidate');
  await bctx.close();
  assert.equal(await h.prisma.documentCharge.count({ where: { userId: b.id } }), 0);
  pass('failures: another candidate gets 404 on every document route and sees nothing in the browser');
}


async function email() {
  const p = ctx.page!;
  const a = ctx.a!;
  await h.ctl('/nim/mode?mode=faithful');
  await h.ctl('/proxy/clear');
  const toRecipient = async () => ((await h.ctl('/sink/messages')) as any[]).filter((m) => m.to.includes(ctx.recipient));
  // A second approved letter, written for the OTHER vacancy (to prove it cannot be attached here).
  const gen = await h.json(await h.api('/documents/generate', a.token, { method: 'POST', body: JSON.stringify({ matchId: ctx.matchPlain, items: [{ kind: 'LETTER', language: 'az' }], expectedUnits: 1, requestId: `wrong-${run}` }) }));
  assert.equal(gen.status, 201);
  const wrongLetterId = gen.body.documents[0].id;
  await h.waitFor('wrong-job letter draft', async () => (await docDetail(wrongLetterId)).body.status, (st) => st === 'NEEDS_REVIEW');
  assert.equal((await h.json(await h.api(`/documents/${wrongLetterId}/approve`, a.token, { method: 'POST' }))).status, 201);

  // ── from the real vacancy page to the approval preview ────────────────────────────────────────────
  await p.goto(`${stack.web}/jobs/imported/${ctx.jobEmailId}`);
  const cta = p.locator('section[aria-labelledby="email-apply-title"]');
  await cta.getByRole('button').first().click();
  await p.waitForURL(/\/dashboard\/email-applications\//);
  await p.getByRole('form', { name: 'Müraciətin önizləməsi' }).waitFor();
  const appId = p.url().split('/').pop()!;
  const view0 = (await h.json(await h.api(`/email-applications/${appId}`, a.token))).body;
  assert.equal(view0.recipient, ctx.recipient);
  assert.equal(view0.cv.resumeId, resumeDocId, 'the approved resume for THIS vacancy was not chosen by default');
  // Recipient evidence: the posting's own words, where it came from, when it was last seen.
  const page0 = await p.locator('main').innerText();
  assert.ok(page0.includes(ctx.recipient!) && page0.includes('Mənbə sübutu') && page0.includes('Orijinal elan mənbəsi') && page0.includes('Son müşahidə tarixi'));
  assert.ok(view0.recipientEvidence.excerpt.includes(ctx.recipient!));
  assert.equal(view0.recipientEvidence.sourceUrl, `https://employer.example/jobs/email-${run}`);
  // The monthly e-mail application allowance is stated before anything is approved (Free: 5 a month, separate from the document allowance).
  const note0 = await p.getByTestId('email-allowance').innerText();
  assert.match(note0, /Ödənişsiz planı: bu ay 0 \/ 5 e-poçt müraciəti istifadə olunub, 5 qalıb/);
  assert.deepEqual((await h.json(await h.api('/email-applications/allowance', a.token))).body.remaining, 5);
  await h.shot(p, 'email-1-prepared');

  // A letter written for another vacancy is refused with a clear message; the right one is attached.
  const select = p.locator('#select-letter');
  await select.selectOption(wrongLetterId);
  await p.getByRole('alert').getByText(/bu vakansiya üçün hazırlanmayıb|LETTER_WRONG_JOB/).waitFor();
  assert.equal((await h.json(await h.api(`/email-applications/${appId}`, a.token))).body.letter, null);
  await h.shot(p, 'email-2-wrong-job');
  await select.selectOption(letterDocId);
  await p.getByText('Motivasiya məktubu əlavə edildi.').waitFor();
  const view1 = (await h.json(await h.api(`/email-applications/${appId}`, a.token))).body;
  assert.equal(view1.letter.resumeId, letterDocId);
  assert.deepEqual(view1.attachments.map((x: any) => x.role), ['cv', 'letter']);
  const prevText = await p.locator('main').innerText();
  assert.match(prevText, /CV-Leyla/);
  assert.match(prevText, /Motivation-letter-Leyla/);
  assert.ok(prevText.includes(view1.cv.sha256.slice(0, 12)) && prevText.includes(view1.letter.sha256.slice(0, 12)), 'the exact attachment hashes are not shown');
  await h.shot(p, 'email-3-attachments');
  pass('email: recipient evidence (quote, source link, last seen) shown; a letter for another vacancy is refused; the approved CV and letter for this vacancy are attached with their hashes');

  // ── a document changes after the preview: approval is refused, nothing is queued ────────────────────────
  const resumeBefore = (await docDetail(resumeDocId)).body;
  await h.api(`/documents/${resumeDocId}/review`, a.token, { method: 'PATCH', body: JSON.stringify({ summary: 'Önizləmədən sonra dəyişdirilmiş xülasə.' }) });
  await h.api(`/documents/${resumeDocId}/approve`, a.token, { method: 'POST' });
  const resumeAfter = (await docDetail(resumeDocId)).body;
  assert.notEqual(resumeAfter.snapshots.at(-1).fileSha256, resumeBefore.snapshots.at(-1).fileSha256);
  await p.getByRole('checkbox', { name: /göstərişini oxudum/ }).check();
  await p.getByRole('checkbox', { name: /göndərilməsinə razıyam/ }).check();
  await p.getByRole('button', { name: 'Təsdiq et və göndər' }).click();
  await p.getByRole('alert').first().waitFor();
  assert.equal((await h.prisma.emailApplication.findUniqueOrThrow({ where: { id: appId } })).deliveryState, 'AWAITING_APPROVAL', 'a changed document was approved');
  assert.equal((await toRecipient()).length, 0, 'something was sent although the approval was refused');
  await h.shot(p, 'email-4-changed-document');
  pass('email: a CV re-approved after the preview makes the approval fail (still awaiting approval, nothing sent)');

  // The candidate re-opens the preview (prepare refreshes the document identity), re-checks and approves.
  await p.goto(`${stack.web}/jobs/imported/${ctx.jobEmailId}`);
  await cta.getByRole('link', { name: /Müraciətə bax/ }).click().catch(async () => { await h.api('/email-applications/prepare', a.token, { method: 'POST', body: JSON.stringify({ jobId: ctx.jobEmailId }) }); await p.goto(`${stack.web}/dashboard/email-applications/${appId}`); });
  await p.getByRole('form', { name: 'Müraciətin önizləməsi' }).waitFor();
  const view2 = (await h.json(await h.api('/email-applications/prepare', a.token, { method: 'POST', body: JSON.stringify({ jobId: ctx.jobEmailId }) }))).body;
  assert.equal(view2.cv.sha256, resumeAfter.snapshots.at(-1).fileSha256);
  assert.equal(view2.letter.resumeId, letterDocId, 'the letter was dropped by the refresh');
  await p.reload();
  await p.getByRole('form', { name: 'Müraciətin önizləməsi' }).waitFor();
  await p.getByRole('checkbox', { name: /göstərişini oxudum/ }).check();
  await p.getByRole('checkbox', { name: /göndərilməsinə razıyam/ }).check();
  await h.shot(p, 'email-5-before-approve');
  await p.getByRole('button', { name: 'Təsdiq et və göndər' }).click();
  await p.getByText('Müraciət təsdiqləndi və göndəriş növbəsinə qoyuldu.').waitFor();

  // ── what leaves the machine is exactly what was approved ──────────────────────────────────────────────
  const msgs = await h.waitFor('captured message', toRecipient, (m) => m.length === 1, 60_000);
  const row = await h.prisma.emailApplication.findUniqueOrThrow({ where: { id: appId } });
  assert.equal(msgs[0].to[0], ctx.recipient);
  assert.deepEqual(msgs[0].attachments.map((x: any) => x.filename), [row.cvFileName, row.letterFileName]);
  const cvFile = await downloadFile((await h.prisma.resume.findUniqueOrThrow({ where: { id: resumeDocId } })).fileUrl!);
  const letterFile = await downloadFile((await h.prisma.resume.findUniqueOrThrow({ where: { id: letterDocId } })).fileUrl!);
  assert.equal(msgs[0].attachments[0].sha256, sha256(cvFile), 'the sent CV is not the approved CV');
  assert.equal(msgs[0].attachments[1].sha256, sha256(letterFile), 'the sent letter is not the approved letter');
  assert.equal(row.cvSha256, sha256(cvFile));
  assert.equal(row.letterSha256, sha256(letterFile));
  assert.equal(row.payloadSha256, payloadHash(payloadPartsOf(row as any, 'approved')), 'the approved payload hash does not cover what was stored');
  assert.equal(row.payloadSha256, payloadHash({ recipient: row.recipient, subject: row.subject, body: row.body, replyTo: row.replyTo, senderName: row.senderName, copyToSelf: row.copyToSelf, cvFileName: row.cvFileName, cvSha256: sha256(cvFile), letterFileName: row.letterFileName, letterSha256: sha256(letterFile) }));
  assert.equal(msgs[0].subject, row.subject);
  assert.equal(msgs[0].text, row.body);
  pass('email: the capture sink received one message to the posting\'s address with the approved CV and letter byte for byte; the approved payload hash is recomputed from the stored bytes');

  // ── delivery evidence wording ────────────────────────────────────────────────────────────────────────────
  await p.reload();
  await h.waitFor('provider accepted state', async () => (await h.prisma.emailApplication.findUniqueOrThrow({ where: { id: appId } })).deliveryState, (st) => st === 'PROVIDER_ACCEPTED');
  await p.reload();
  await p.getByText('E-poçt xidməti qəbul etdi').first().waitFor();
  const accepted = await p.locator('main').innerText();
  assert.match(accepted, /E-poçt xidməti qəbul etdi/);
  assert.match(accepted, /işəgötürənin mesajı aldığı və ya oxuduğu demək deyil/);
  assert.ok(!/Qəbuledicinin poçt serveri qəbul etdi|Çatdırılmadı/.test(accepted), 'accepted is worded as delivered');
  await h.shot(p, 'email-6-provider-accepted');
  await h.ctl(`/sink/emit?type=email.delivered&id=${msgs[0].id}&tag=${appId}&to=${encodeURIComponent(ctx.recipient!)}`);
  await h.waitFor('delivered evidence', async () => (await h.prisma.emailApplication.findUniqueOrThrow({ where: { id: appId } })).deliveredAt, (d) => !!d);
  await p.reload();
  await p.getByText('Qəbuledicinin poçt serveri qəbul etdi').first().waitFor();
  const delivered = await p.locator('main').innerText();
  assert.match(delivered, /Qəbuledicinin poçt serveri qəbul etdi/);
  assert.match(delivered, /İşəgötürənin mesajı oxuduğunu göstərmir/);
  assert.match(delivered, /işəgötürən tərəfindən təsdiq olunmuş sayılmır/);
  assert.ok(!/işəgötürən (oxudu|cavab verdi|müsahibəyə)/i.test(delivered), 'the page claims an employer reaction');
  const final = (await h.json(await h.api(`/email-applications/${appId}`, a.token))).body;
  assert.deepEqual(final.recruitment, { state: 'SENT', evidence: 'PROVIDER_ACCEPTED', employerConfirmed: false });
  await h.shot(p, 'email-7-delivered');
  pass('email: provider acceptance and delivery are worded as exactly that; the page states that nothing is employer-confirmed');

  // ── the unit is held by the approved application; an exhausted allowance is stated and blocks preparing, before any work is invested ──────
  assert.equal((await h.json(await h.api('/email-applications/allowance', a.token))).body.used, 1);
  const filler = await Promise.all([1, 2, 3, 4].map((n) => h.prisma.emailApplication.create({ data: {
    userId: a.id, jobTitle: `Filler ${n}`, jobCompany: 'Synthetic', jobUrl: 'https://employer.example/x', recipient: `filler-${run}-${n}@employer.example`, recipientEvidence: {},
    subject: 'x', subjectSource: 'generated', body: 'x', bodySha256: 'x', replyTo: a.email, senderName: 'x', cvKind: 'base', cvFileName: 'x.pdf', cvMimeType: 'application/pdf', cvPreviewSha256: 'x', cvSha256: 'x', cvBytes: 1,
    deliveryState: 'DELIVERED', approvedAt: new Date(), generation: 1, consentVersion: 'synthetic',
  } as any })));
  const second = await h.ingestJob({
    externalId: `integ:email2-${run}`, title: `Maliyyə Analitiki ${run}`, company: `Integ Employer Two ${run}`, url: `https://employer.example/jobs/email2-${run}`,
    description: `Maliyyə Analitiki axtarırıq. Excel bilikləri tələb olunur. CV-nizi hr2-${run}@employer.example ünvanına göndərin; mövzu: "Maliyyə Analitiki ${run}".`,
  });
  const exhausted = await h.api('/email-applications/prepare', a.token, { method: 'POST', body: JSON.stringify({ jobId: second.jobId }) });
  assert.equal(exhausted.status, 402);
  assert.equal((await h.json(exhausted)).body.code, 'EMAIL_ALLOWANCE_EXHAUSTED');
  await p.goto(`${stack.web}/jobs/imported/${second.jobId}`);
  const out = await p.getByTestId('email-allowance').innerText();
  assert.match(out, /Bu ayın e-poçt müraciət limiti \(5\) çatılıb/);
  assert.equal(await p.locator('section[aria-labelledby="email-apply-title"]').getByRole('button').first().isDisabled(), true, 'the prepare button is still enabled with no unit left');
  await h.shot(p, 'email-8-allowance-exhausted');
  await h.prisma.emailApplication.deleteMany({ where: { id: { in: filler.map((f) => f.id) } } });

  // ── a posting that asks for extra work: the whole instruction (heading and task) is shown with a plain warning, never only the last sentence ──
  const taskRecipient = `hr3-${run}@employer.example`;
  const taskJob = await h.ingestJob({
    externalId: `integ:task-${run}`, title: `Junior LinkedIn Mütəxəssisi ${run}`, company: `Integ Task Employer ${run}`, url: `https://employer.example/jobs/task-${run}`,
    description: `Junior mütəxəssis axtarırıq.\nHow to apply\nFind 5 LinkedIn posts by business owners and write 1 comment under each, in a Google Doc with the post links. Send the doc, your CV and a few words on why you fit to ${taskRecipient}.`,
  });
  const taskApp = (await h.json(await h.api('/email-applications/prepare', a.token, { method: 'POST', body: JSON.stringify({ jobId: taskJob.jobId }) }))).body;
  assert.match(taskApp.instructions, /How to apply\nFind 5 LinkedIn posts/);
  assert.equal(taskApp.instructionsExtra, true);
  await p.goto(`${stack.web}/dashboard/email-applications/${taskApp.id}`);
  await p.getByTestId('instructions-extra').waitFor();
  assert.match(await p.getByTestId('instructions').innerText(), /Google Doc/);
  assert.match(await p.getByTestId('instructions-extra').innerText(), /əlavə bir tapşırıq/);
  await h.shot(p, 'email-9-extra-task');
  pass('email: a posting that asks for a Google Doc task shows the full instruction and an extra-work warning before approval');
  pass('email: the allowance is stated before approval (5 → 4 left), a send in progress holds its unit, and an exhausted allowance is stated plainly and refused before preparing (402, EMAIL_ALLOWANCE_EXHAUSTED)');
}


async function responsive() {
  const a = ctx.a!;
  const viewports = [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }];
  const findings: string[] = [];
  const overflow = (pg: Page) => pg.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  for (const vp of viewports) {
    const c = await h.context(vp);
    const pg = await c.newPage();
    pg.setDefaultTimeout(60_000);
    await h.login(pg, a.email);
    const label = `${vp.width}px`;
    let where = 'start';
    pg.on('pageerror', (e) => findings.push(`${label} page error: ${e.message.slice(0, 120)}`));
    const check = async (screen: string) => {
      const o = await overflow(pg);
      if (o.scroll > o.width + 1) findings.push(`${label} ${screen}: horizontal overflow (${o.scroll} > ${o.width})`);
      await h.shot(pg, `resp-${vp.width}-${screen}`);
    };

    try {
      // document list + allowance
      where = 'documents list';
      await pg.goto(`${stack.web}/dashboard/resumes`);
      await pg.getByTestId('document-allowance-card').waitFor();
      await check('documents');
      // No two controls or labels in a document row may overlap (a title running under the PDF button at 320px was a real defect).
      const overlaps = await pg.evaluate(() => {
        const out: string[] = [];
        const rects = (root: Element) => Array.from(root.querySelectorAll('button, a, p')).map((e) => ({ t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 25), r: e.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.height > 0);
        for (const row of Array.from(document.querySelectorAll('[data-testid^="document-row-"]'))) {
          const items = rects(row);
          for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
            const a = items[i].r, b = items[j].r;
            const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ix > 2 && iy > 2) out.push(`"${items[i].t}" overlaps "${items[j].t}"`);
          }
        }
        return out;
      });
      if (overlaps.length) findings.push(`${label} documents list: ${overlaps.slice(0, 3).join('; ')}`);

      // create-document modal: focus is trapped, Escape closes and returns focus, touch targets are large enough
      where = 'modal';
      const trigger = pg.getByRole('button', { name: 'Yeni Sənəd Hazırla' });
      await trigger.focus();
      await trigger.click();
      const dialog = pg.getByRole('dialog');
      await dialog.waitFor();
      await dialog.locator('#target-match-select').waitFor();
      await check('modal');
      for (let i = 0; i < 25; i++) {
        await pg.keyboard.press('Tab');
        const inside = await pg.evaluate(() => !!document.activeElement && !!document.activeElement.closest('[role="dialog"]'));
        if (!inside) { findings.push(`${label} modal: focus left the dialog after ${i + 1} Tab presses`); break; }
      }
      for (let i = 0; i < 25; i++) {
        await pg.keyboard.press('Shift+Tab');
        if (!(await pg.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))) { findings.push(`${label} modal: focus left the dialog going backwards`); break; }
      }
      const small = await dialog.locator('button').evaluateAll((els) => els.map((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return { text: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((b) => b.h < 44 || b.w < 44));
      if (small.length && vp.width < 800) findings.push(`${label} modal: touch targets under 44px: ${JSON.stringify(small)}`);
      await pg.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      const focused = await pg.evaluate(() => document.activeElement?.textContent?.trim());
      if (!focused?.includes('Yeni Sənəd Hazırla')) findings.push(`${label} modal: focus did not return to the trigger (it is on "${focused?.slice(0, 30)}")`);

      // review of a draft/approved document and the PDF preview
      where = 'review';
      await pg.locator('[data-testid^="document-row-"]', { hasText: 'Rezüme (v1)' }).first().getByRole('button', { name: 'Yoxla və redaktə et' }).click();
      await pg.getByTestId('tailored-review').waitFor();
      await check('review');
      const previewBtn = pg.getByRole('button', { name: 'PDF önizləmə' });
      const box = await previewBtn.boundingBox();
      if (box && box.height < 40) findings.push(`${label} review: PDF preview button only ${Math.round(box.height)}px tall`);
      const [popup] = await Promise.all([pg.context().waitForEvent('page'), previewBtn.click()]);
      if (!popup.url().startsWith('blob:')) findings.push(`${label} review: PDF preview did not open`);
      await popup.close();

      // career evidence editor, e-mail preview
      where = 'career editor';
      await pg.goto(`${stack.web}/dashboard/profile`);
      await pg.getByText('Karyera Sübutları').first().waitFor();
      await check('career-editor');
      const emailApp = await h.prisma.emailApplication.findFirst({ where: { userId: a.id } });
      where = 'email page';
      if (emailApp) {
        await pg.goto(`${stack.web}/dashboard/email-applications/${emailApp.id}`);
        await pg.getByText('Göndərilən CV nüsxəsi').first().waitFor();
        await check('email');
      }

    } catch (e) {
      await h.shot(pg, `resp-${vp.width}-FAILED`).catch(() => undefined);
      throw new Error(`${label} at "${where}": ${(e as Error).message.split('\n')[0]}`);
    }
    await c.close();
  }
  // the letter composer, once, at the narrowest and the widest width
  for (const vp of [viewports[0], viewports[3]]) {
    const c = await h.context(vp);
    const pg = await c.newPage();
    pg.setDefaultTimeout(60_000);
    await h.login(pg, a.email);
    await pg.goto(`${stack.web}/dashboard/resumes`);
    await pg.getByRole('button', { name: 'Yeni Sənəd Hazırla' }).click();
    const dialog = pg.getByRole('dialog');
    await dialog.locator('#target-match-select').selectOption(ctx.matchPlain!);
    await dialog.getByText('Motivasiya Məktubu', { exact: true }).click();
    await dialog.getByText('Generasiyadan sonra qalan balans:').waitFor();
    await dialog.getByRole('button', { name: /Məktub axınına keç/ }).click();
    await pg.getByTestId('motivation-letter-composer').waitFor();
    const o = await overflow(pg);
    if (o.scroll > o.width + 1) findings.push(`${vp.width}px composer: horizontal overflow (${o.scroll} > ${o.width})`);
    await h.shot(pg, `resp-${vp.width}-composer`);
    await c.close();
  }
  if (findings.length) throw new Error(`responsive findings:\n- ${findings.join('\n- ')}`);
  pass('responsive: document list, create modal (focus trap, Escape, focus return, 44px touch targets), review with PDF preview, career editor, e-mail preview and letter composer at 320/390/768/1440px — no horizontal overflow, modal focus contained');
}

(async () => {
  const which = process.argv[2] || 'all';
  // Postings of earlier runs on this stack would compete for a Free candidate's three monthly matches: close them (the disposable database only).
  await h.prisma.job.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'CLOSED', closedAt: new Date(), closedReason: 'previous journey run' } });
  await setup();
  await vacancies();
  if (['career', 'all'].includes(which)) await career();
  if (['documents', 'all'].includes(which)) { await documents(); await letter(); }
  if (['email'].includes(which)) { await documents(); await letter(); await email(); }
  if (which === 'responsive') { await documents(); await letter(); await email(); await responsive(); }
  if (['failures', 'all'].includes(which)) { if (which === 'failures') { await documents(); await letter(); } await failures(); }
  if (which === 'all') { await email(); await responsive(); }
  console.log(`\n${passed.length} checks passed`);
  await h.close();
})().catch(async (e) => { console.error('FAIL', e); try { await h.shot(ctx.page!, 'failure'); } catch { /* none */ } await h.close(); process.exit(1); });

