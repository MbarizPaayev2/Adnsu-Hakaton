/* AISE Agent: Lever apply-form adapter. Runs inside the candidate's own tab on jobs.lever.co. It does NOTHING until the extension's service worker sends it a message
 * (page scripts cannot reach it), reads the form as DATA, fills only the values the service worker hands it, and never answers a question on its own. */
(() => {
  if (window.__aiseLeverAdapter) return;
  window.__aiseLeverAdapter = true;

  const clean = (t) => String(t || '').replace(/[✱*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return (r.width > 0 || r.height > 0) && s.visibility !== 'hidden' && s.display !== 'none'; };
  const hash32 = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

  function formRoot() {
    return document.querySelector('form#application-form, form.application-form') || [...document.forms].find((f) => f.querySelector('[name="email"], [name="name"]')) || null;
  }

  function labelOf(el) {
    const q = el.closest('li.application-question, .application-question, .field, fieldset');
    const lab = q && q.querySelector('.application-label, legend, label');
    const text = lab ? lab.innerText.split('\n')[0] : (el.labels && el.labels[0] ? el.labels[0].innerText : '') || el.getAttribute('aria-label') || el.placeholder || el.name;
    return clean(text);
  }
  function isRequired(el) {
    if (el.required || el.getAttribute('aria-required') === 'true') return true;
    const q = el.closest('li.application-question, .application-question, .field');
    return !!(q && (q.querySelector('.required') || /✱/.test(q.querySelector('.application-label, label')?.innerText || '')));
  }
  function optionLabel(input) {
    const l = input.closest('label');
    return clean(l ? l.innerText : input.getAttribute('aria-label') || input.value);
  }

  /** The controls a person would fill in, grouped as a person sees them. Hidden plumbing inputs are not reported. */
  function collect(form) {
    const out = []; const byKey = new Map(); const done = new Set();
    for (const el of form.querySelectorAll('input, select, textarea')) {
      const type = (el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type) || el.disabled) continue;
      if (type !== 'file' && !visible(el)) continue;
      const label = labelOf(el);
      const key = el.name || `q:${hash32(label)}`;
      if (done.has(key) && type !== 'radio' && type !== 'checkbox') continue;
      if (type === 'radio' || type === 'checkbox') {
        const group = [...form.querySelectorAll(`input[type="${type}"]`)].filter((x) => (x.name || '') === (el.name || ''));
        if (done.has(key)) continue; done.add(key);
        const single = type === 'checkbox' && group.length === 1;
        const f = { key, label: single ? optionLabel(el) || label : label, type: single ? 'checkbox' : type, required: group.some(isRequired), options: single ? undefined : group.map((x) => ({ value: x.value, label: optionLabel(x) })), multiple: type === 'checkbox' && group.length > 1 };
        out.push(f); byKey.set(key, group); continue;
      }
      done.add(key);
      let t = type === 'file' ? 'file' : el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : ['email', 'tel', 'url', 'number', 'date'].includes(type) ? type : type === 'text' || type === '' ? 'text' : 'other';
      const f = { key, label, type: t, required: isRequired(el), multiple: !!el.multiple };
      if (el.tagName === 'SELECT') f.options = [...el.options].map((o) => ({ value: o.value, label: clean(o.textContent) }));
      out.push(f); byKey.set(key, [el]);
    }
    return { fields: out, byKey };
  }

  function declarationText() {
    const parts = new Set();
    for (const el of document.querySelectorAll('[class*="disclaimer" i], [class*="legal" i], [class*="privacy" i], [class*="consent" i], [data-qa*="disclaimer" i]')) { const t = clean(el.innerText); if (t.length > 30) parts.add(t); }
    if (!parts.size) {
      for (const el of document.querySelectorAll('form ~ *, .posting-footer, footer, [class*="footer" i]')) {
        const t = clean(el.innerText);
        if (t.length > 60 && /artificial intelligence|\bAI\b|personal data|privacy|consent/i.test(t)) parts.add(t.slice(0, 1500));
      }
    }
    return [...parts].join(' ').slice(0, 3000);
  }

  function captchaChallengeVisible() {
    return [...document.querySelectorAll('iframe')].some((f) => /hcaptcha\.com|recaptcha/i.test(f.src) && /challenge/i.test(`${f.title} ${f.src}`) && (() => { const r = f.getBoundingClientRect(); return r.width > 100 && r.height > 100 && getComputedStyle(f).visibility !== 'hidden'; })());
  }

  function pageState() {
    if (captchaChallengeVisible()) return 'captcha';
    const form = formRoot();
    if (!form) {
      const text = `${document.title} ${document.body ? document.body.innerText.slice(0, 600) : ''}`;
      if (/no longer (accepting|available)|not found|404|has been (closed|filled)|expired|isn't available|could not be found/i.test(text) || !/\/apply\/?$/.test(location.pathname)) return 'closed';
      return 'error';
    }
    if (form.querySelector('input[type="password"]')) return 'login';
    return 'form';
  }

  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    for (const t of ['input', 'change', 'blur']) el.dispatchEvent(new Event(t, { bubbles: true }));
  }
  const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

  function readValue(group, type) {
    if (type === 'radio') { const c = group.find((x) => x.checked); return c ? c.value : ''; }
    if (type === 'checkbox') return group.length === 1 ? group[0].checked : group.filter((x) => x.checked).map((x) => x.value);
    const el = group[0];
    if (el.type === 'file') return el.files && el.files.length ? el.files[0].name : '';
    return el.value;
  }

  async function attachResume(form, file) {
    const input = form.querySelector('input[type="file"][name="resume"], input[type="file"]');
    if (!input) return false;
    const bytes = Uint8Array.from(atob(file.b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file.filename, { type: file.mimeType || 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    // Lever uploads and parses the file, which can auto-fill other fields: wait for it so the candidate's confirmed answers are what remains.
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const stored = form.querySelector('input[name="resumeStorageId"]');
      const working = document.querySelector('.resume-upload-working, [class*="upload-working" i]');
      if ((stored && stored.value) || (!working && i > 3)) break;
    }
    return input.files && input.files.length === 1;
  }

  async function fill(msg) {
    const form = formRoot();
    if (!form) return { ok: false, reason: 'no_form' };
    let before = collect(form);
    for (const item of msg.plan.filter((p) => p.action === 'file')) { if (!(await attachResume(form, msg.file))) return { ok: false, reason: 'file_not_attached' }; }
    before = collect(form);
    for (const item of msg.plan) {
      if (item.action === 'file') continue;
      const group = before.byKey.get(item.key);
      if (!group) continue; // the form no longer has this control: caught by the verification below
      const el = group[0];
      if (item.type === 'select') {
        const opt = [...el.options].find((o) => o.value === item.value);
        if (opt) setValue(el, opt.value);
      } else if (item.type === 'radio') {
        const r = group.find((x) => x.value === item.value); if (r) { r.checked = true; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }
      } else if (item.type === 'checkbox') {
        const want = item.value === true || item.value === 'true'; if (group.length === 1) { if (group[0].checked !== want) group[0].click(); }
      } else setValue(el, String(item.value));
    }
    await new Promise((r) => setTimeout(r, 400));
    // Verify against what the form now holds: every planned value must be there, and every required control must be filled.
    const after = collect(form);
    const mismatched = [];
    for (const item of msg.plan) {
      const group = after.byKey.get(item.key);
      if (!group) { mismatched.push(item.key); continue; }
      if (item.action === 'file') { const el = group[0]; if (!(el.files && el.files.length === 1)) mismatched.push(item.key); continue; }
      const got = readValue(group, item.type);
      const want = item.value;
      if (item.type === 'checkbox') { if (!!got !== (want === true || want === 'true')) mismatched.push(item.key); }
      else if (norm(got) !== norm(want)) mismatched.push(item.key);
    }
    const missingRequired = after.fields.filter((f) => f.required && (() => {
      const g = after.byKey.get(f.key); if (!g) return false;
      const v = readValue(g, f.type);
      return Array.isArray(v) ? v.length === 0 : f.type === 'checkbox' ? !v : norm(v) === '';
    })()).map((f) => f.key);
    return { ok: true, mismatched, missingRequired, declarationText: declarationText(), filled: msg.plan.length };
  }

  function findSubmit(form) {
    return form.querySelector('#btn-submit, button[type="submit"]:not([disabled])') || [...form.querySelectorAll('button, input[type="submit"]')].find((b) => /submit application|müraciət et|submit/i.test(b.innerText || b.value || ''));
  }

  let watching = false;
  function watchAfterClick(reportBack) {
    if (watching) return; watching = true;
    const started = Date.now(); let challengeReported = false; let errorReported = false;
    const timer = setInterval(() => {
      if (Date.now() - started > 120000) { clearInterval(timer); return; }
      if (!challengeReported && captchaChallengeVisible()) { challengeReported = true; reportBack({ event: 'captcha' }); }
      if (!errorReported) {
        const errs = [...document.querySelectorAll('.error-message, .application-error, [class*="error" i][role="alert"], [aria-invalid="true"]')].filter(visible);
        if (errs.length) { errorReported = true; reportBack({ event: 'validation_error', count: errs.length }); }
      }
    }, 700);
  }

  // Tell the service worker what this page shows. After a submit that the portal answered with the form again (errors shown), this is how the worker learns that nothing was accepted.
  try {
    const errs = [...document.querySelectorAll('.error-message, .application-error, [class*="error" i][role="alert"], [aria-invalid="true"]')].filter(visible).length;
    chrome.runtime.sendMessage({ type: 'page-loaded', url: location.href, errors: errs, challenge: captchaChallengeVisible() });
  } catch { /* the worker may be asleep; it will be woken by the next message */ }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return; // only this extension's own service worker
    (async () => {
      try {
        if (msg.type === 'describe') {
          const state = pageState();
          if (state !== 'form') return sendResponse({ pageState: state });
          const { fields } = collect(formRoot());
          return sendResponse({ pageState: 'form', fields, declarationText: declarationText() });
        }
        if (msg.type === 'fill') return sendResponse(await fill(msg));
        if (msg.type === 'submit') {
          const form = formRoot(); const btn = form && findSubmit(form);
          if (!btn) return sendResponse({ clicked: false, reason: 'no_submit_control' });
          watchAfterClick((m) => chrome.runtime.sendMessage({ type: 'page-event', applicationId: msg.applicationId, ...m }));
          btn.click();
          return sendResponse({ clicked: true });
        }
        if (msg.type === 'page-text') return sendResponse({ url: location.href, text: document.body ? document.body.innerText.slice(0, 4000) : '' });
        sendResponse({ error: 'unknown_message' });
      } catch (e) { sendResponse({ error: String(e && e.message || e).slice(0, 200) }); }
    })();
    return true;
  });
})();
