import * as http from 'http';
import { createHash } from 'crypto';
import type { AddressInfo } from 'net';
import type { BrowserContext } from 'playwright';

/**
 * A controllable, local stand-in for an applicant-tracking form, shaped like
 * the Glorri form the adapter targets (step 1 personal data + two uploads,
 * step 2 motivation, step 3 questions + the recipient's declaration, review
 * dialog, then OTP / receipt / refusal). It is served only through
 * `routeDestinationToFixture`, which a test installs on the worker's browser
 * context: the worker still opens the allowlisted https://jobs.glorri.com URL
 * and its allowlist is unchanged; every other host is aborted.
 *
 * The scenario comes from the vacancy slug: /vacancies/<company>/<scenario>-<n>/apply.
 * The server records clicks on the final control and submissions (field
 * names, file sizes and hashes — never file contents).
 */

export const FIXTURE_HOST = 'jobs.glorri.com';
export const FIXTURE_POLICY_URL = 'https://jobs.glorri.com/privacy';
/** Exactly what the fixture's declaration label renders as innerText. */
export const FIXTURE_DECLARATION = 'Şəxsi məlumatlarımın işlənməsi ilə bağlı məxfilik siyasətini oxudum və razıyam.';
export const FIXTURE_CHANGED_DECLARATION = 'Şəxsi məlumatlarımın üçüncü tərəflərə ötürülməsinə və məxfilik siyasətinə razıyam.';
export const FIXTURE_OTP = '424242';
export const FIXTURE_RECEIPT_PATTERN = /Müraciət nömrəsi:\s*(FX-[0-9]{4})/;
export const FIXTURE_RECEIPT_PATH = /^\/vacancies\/[a-z0-9-]+\/[a-z0-9-]+\/apply\/done$/;
export const FIXTURE_REJECTION_PATTERN = /Müraciətiniz qəbul edilmədi/;

export type Scenario =
  | 'normal' | 'questions' | 'notice-changed' | 'upload-error' | 'otp' | 'otp-expired' | 'reject'
  | 'slow' | 'stall' | 'changed-dom' | 'changed-confirm' | 'navigate' | 'captcha' | 'invisible-captcha' | 'captcha-after'
  | 'standing-alert' | 'hang';

export interface Submission {
  slug: string;
  fields: Record<string, string>;
  files: { field: string; size: number; sha256: string }[];
}

export interface SlugState {
  clicks: number;
  submissions: Submission[];
  otpAttempts: number;
  receipts: string[];
}

function scenarioOf(slug: string): Scenario {
  return slug.replace(/-[0-9]+$/, '') as Scenario;
}

function page(slug: string): string {
  const scenario = scenarioOf(slug);
  const changed = scenario === 'changed-dom';
  const label = (text: string) => (changed ? text.replace(' *', 'nız *') : text);
  const declaration = scenario === 'notice-changed' ? FIXTURE_CHANGED_DECLARATION : FIXTURE_DECLARATION;
  const declarationHtml = declaration.replace('məxfilik siyasəti', `<a href="${FIXTURE_POLICY_URL}">məxfilik siyasəti</a>`);
  const questions = scenario === 'questions'
    ? `<fieldset><legend>Sürücülük vəsiqəniz var?</legend>
         <label><input type="radio" name="questions.0.answer" value="Bəli"> Bəli</label>
         <label><input type="radio" name="questions.0.answer" value="Xeyr"> Xeyr</label></fieldset>
       <fieldset><legend>Növbəli işə hazırsınız?</legend>
         <label><input type="radio" name="questions.1.answer" value="Bəli"> Bəli</label>
         <label><input type="radio" name="questions.1.answer" value="Xeyr"> Xeyr</label></fieldset>`
    : '';
  const captcha = scenario === 'captcha'
    ? '<iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=fixture&size=normal" width="304" height="78"></iframe>'
    : scenario === 'invisible-captcha'
      ? '<iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=fixture&size=invisible" width="256" height="60"></iframe>'
      : '';
  const confirmText = scenario === 'changed-confirm' ? 'Göndər' : 'Təsdiq et və göndər';
  const select = (id: string, text: string, options: string[]) =>
    `<div><label for="${id}">${label(text)}</label><input id="${id}" name="${id}" readonly data-options="${options.join('|')}"></div>`;
  const input = (id: string, text: string) => `<div><label for="${id}">${label(text)}</label><input id="${id}" name="${id}"></div>`;
  return `<!doctype html><html lang="az"><head><meta charset="utf-8"><title>Müraciət (fixture)</title></head><body>
${scenario === 'standing-alert' ? '<p role="alert">Sayt texniki xidmət səbəbindən yavaş işləyə bilər.</p>' : ''}
<form id="apply" onsubmit="return false">
  <section id="s1">
    <div><label for="cv">CV</label><input type="file" id="cv" name="cv"></div>
    ${input('firstName', 'Ad *')}${input('lastName', 'Soyad *')}${input('email', 'Email *')}${input('phone', 'Mobil nömrə *')}${input('address', 'Faktiki ünvan *')}
    ${select('citizenship', 'Vətəndaşlıq *', ['Azərbaycan', 'Türkiyə', 'Digər'])}
    ${input('dob', 'Təvəllüd (gün/ay/il) *')}${input('salary', 'Min. maaş tələbi *')}
    ${select('netGross', 'Net/gross *', ['Net', 'Gross'])}${select('currency', 'Valyuta *', ['AZN', 'USD', 'EUR'])}
    <div><label for="idPhoto">Şəxsiyyət vəsiqəsinin şəkli</label><input type="file" id="idPhoto" name="idPhoto"></div>
    <p id="s1err"></p>
    <button type="button" id="next1">Davam et</button>
  </section>
  <section id="s2" hidden>
    <label for="motivation">Motivasiya məktubu</label><textarea id="motivation" name="motivation"></textarea>
    <textarea name="g-recaptcha-response" style="display:none"></textarea>
    <button type="button" id="next2">Davam et</button>
  </section>
  <section id="s3" hidden>
    ${questions}
    <label><input type="checkbox" name="isDataPrivacyAccepted"> ${declarationHtml}</label>
    <p id="s3err"></p>
    <button type="button" id="next3">Davam et</button>
  </section>
  <div role="dialog" id="review" hidden>
    <h2>Müraciətinizi yoxlayın</h2><div id="summary"></div>${captcha}
    <button type="button" id="send">${confirmText}</button>
  </div>
</form>
<div id="result"></div>
<script>
const slug = ${JSON.stringify(slug)};
const base = location.pathname;
const $ = (id) => document.getElementById(id);
const show = (id) => { for (const s of ['s1','s2','s3']) $(s).hidden = s !== id; };
document.querySelectorAll('[data-options]').forEach((input) => input.addEventListener('click', () => {
  document.querySelectorAll('[role=listbox]').forEach((l) => l.remove());
  const list = document.createElement('div');
  list.setAttribute('role', 'listbox');
  for (const text of input.dataset.options.split('|')) {
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    option.textContent = text;
    option.addEventListener('click', () => { input.value = text; list.remove(); });
    list.appendChild(option);
  }
  input.after(list);
}));
$('cv').addEventListener('change', async () => {
  if (${JSON.stringify(scenario)} !== 'upload-error') return;
  const res = await fetch(base + '/upload', { method: 'POST' });
  if (!res.ok) { $('s1err').setAttribute('role', 'alert'); $('s1err').textContent = 'Fayl yüklənmədi. Yenidən cəhd edin.'; $('next1').disabled = true; }
});
$('next1').addEventListener('click', () => {
  const required = ['firstName','lastName','email','phone','address','citizenship','dob','salary','netGross','currency'];
  if (required.some((id) => !$(id).value) || !$('cv').files.length) { $('s1err').setAttribute('role', 'alert'); $('s1err').textContent = 'Bütün sahələri doldurun'; return; }
  show('s2');
});
$('next2').addEventListener('click', () => show('s3'));
$('next3').addEventListener('click', () => {
  const groups = new Set([...document.querySelectorAll('input[type=radio]')].map((r) => r.name));
  const unanswered = [...groups].some((g) => !document.querySelector('input[name="' + g + '"]:checked'));
  if (unanswered || !document.querySelector('[name=isDataPrivacyAccepted]').checked) { $('s3err').textContent = 'Sualları cavablandırın'; return; }
  $('s3').hidden = true;
  $('summary').innerHTML = '<p>Ad: ' + $('firstName').value + ' ' + $('lastName').value + '</p><p>E-poçt: ' + $('email').value + '</p>';
  $('review').hidden = false;
});
function receipt(reference) {
  history.pushState({}, '', base + '/done');
  document.body.innerHTML = '<h1>Təşəkkür edirik!</h1><p>Müraciətiniz qeydə alındı. Müraciət nömrəsi: ' + reference + '</p>';
}
function refused(message) {
  $('review').innerHTML = '<p role="alert">' + message + '</p>';
}
function askOtp() {
  $('review').innerHTML = '<label for="otp">Təsdiq kodu</label><input id="otp" name="otp" autocomplete="one-time-code" placeholder="Kod"><button type="button" id="verify">Təsdiqlə</button><p id="otpmsg"></p>';
  $('verify').addEventListener('click', async () => {
    const res = await fetch(base + '/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('otp').value }) });
    const data = await res.json();
    if (res.ok) return receipt(data.reference);
    $('otpmsg').textContent = data.message;
  });
}
$('send').addEventListener('click', async () => {
  $('send').disabled = true;
  await fetch(base + '/click', { method: 'POST' });
  if (${JSON.stringify(scenario)} === 'navigate') { location.href = '/login?next=' + encodeURIComponent(base); return; }
  if (${JSON.stringify(scenario)} === 'captcha-after') {
    $('review').insertAdjacentHTML('beforeend', '<iframe title="recaptcha challenge" src="https://www.google.com/recaptcha/api2/bframe?k=fixture" width="400" height="580"></iframe>');
    return;
  }
  // Files travel as base64 JSON: Chromium does not expose file bytes of an
  // intercepted multipart body to the test router.
  const fields = {}, files = [];
  for (const [name, value] of new FormData($('apply')).entries()) {
    if (value instanceof File) {
      if (!value.size) continue;
      const bytes = new Uint8Array(await value.arrayBuffer());
      let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
      files.push({ field: name, base64: btoa(bin) });
    } else fields[name] = value;
  }
  let res;
  try { res = await fetch(base + '/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields, files }) }); } catch { return; }
  const data = await res.json();
  if (res.status === 202) return askOtp();
  if (!res.ok) return refused(data.message);
  receipt(data.reference);
});
</script></body></html>`;
}

export class FixtureAts {
  readonly state = new Map<string, SlugState>();
  private server?: http.Server;
  private sockets = new Set<import('net').Socket>();
  private receiptSeq = 0;
  origin = '';
  /** How long the 'stall' scenario holds the submission before answering. */
  stallMs = 10_000;

  of(slug: string): SlugState {
    if (!this.state.has(slug)) this.state.set(slug, { clicks: 0, submissions: [], otpAttempts: 0, receipts: [] });
    return this.state.get(slug)!;
  }

  private nextReceipt(slug: string) {
    this.receiptSeq += 1;
    const reference = `FX-${String(this.receiptSeq).padStart(4, '0')}`;
    this.of(slug).receipts.push(reference);
    return reference;
  }

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        const url = new URL(req.url || '/', 'http://fixture');
        const json = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
        if (url.pathname === '/login') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end('<!doctype html><h1>Daxil olun</h1><p>Davam etmək üçün hesabınıza daxil olun.</p>');
        }
        const m = /^\/vacancies\/([a-z0-9-]+)\/([a-z0-9-]+)\/apply(\/[a-z]+)?$/.exec(url.pathname);
        if (!m) { res.writeHead(404); return res.end(); }
        const slug = m[2];
        const scenario = scenarioOf(slug);
        const action = m[3];
        const state = this.of(slug);
        if (!action && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(page(slug));
        }
        if (action === '/upload') return json(500, { message: 'upload failed' });
        if (action === '/click') { state.clicks += 1; return json(200, {}); }
        if (action === '/submit') {
          const sent = JSON.parse(body.toString() || '{}') as { fields?: Record<string, string>; files?: { field: string; base64: string }[] };
          state.submissions.push({
            slug,
            fields: sent.fields ?? {},
            files: (sent.files ?? []).map((f) => {
              const bytes = Buffer.from(f.base64, 'base64');
              return { field: f.field, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
            }),
          });
          if (scenario === 'hang') { setTimeout(() => req.socket.destroy(), 300); return; }
          if (scenario === 'slow') await new Promise((r) => setTimeout(r, 3000));
          if (scenario === 'stall') await new Promise((r) => setTimeout(r, this.stallMs));
          if (scenario === 'otp' || scenario === 'otp-expired') return json(202, { otp: true });
          if (scenario === 'reject') return json(422, { message: 'Müraciətiniz qəbul edilmədi: vakansiya artıq bağlanıb.' });
          return json(200, { reference: this.nextReceipt(slug) });
        }
        if (action === '/otp') {
          state.otpAttempts += 1;
          const { code } = JSON.parse(body.toString() || '{}');
          if (scenario === 'otp-expired') return json(400, { message: 'Kodun vaxtı bitib. Yeni kod istəyin.' });
          if (code !== FIXTURE_OTP) return json(400, { message: 'Yanlış kod' });
          return json(200, { reference: this.nextReceipt(slug) });
        }
        res.writeHead(404);
        res.end();
      });
    });
    this.server.on('connection', (s) => { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)); });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.origin;
  }

  async stop() {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

/**
 * Test-only routing for the worker's browser context: requests to the
 * allowlisted destination host are answered by the local fixture; every other
 * request (CAPTCHA providers, analytics, anything) is aborted, so a run
 * cannot reach the internet.
 */
export function routeDestinationToFixture(origin: string) {
  return async (context: BrowserContext) => {
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol !== 'https:' || url.hostname !== FIXTURE_HOST) return route.abort();
      try {
        const response = await route.fetch({ url: `${origin}${url.pathname}${url.search}`, timeout: 120_000 });
        await route.fulfill({ response });
      } catch {
        await route.abort('connectionreset').catch(() => undefined);
      }
    });
  };
}
