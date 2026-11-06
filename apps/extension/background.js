// AISE Agent service worker. It asks AISE for work, opens the vacancy's own apply page in the candidate's browser, has the content script describe/fill the form,
// requests a single-use submit permit from AISE, and only then lets the page submit. Evidence is whatever the portal's own confirmation page shows.
import { api, pairWithCode, ApiError } from './lib/api.js';
import { sha256Hex, bytesToBase64, normalizeText, sleep, store, load, VERSION, WEB_ORIGIN } from './lib/util.js';

const POLL_ALARM = 'aise-poll';
const WATCH_MS = 150_000; // after the click: how long to wait for the portal's confirmation page (tests may shorten it through the `watchMs` storage key)
const HANDOFF_MS = 20 * 60_000; // how long a candidate has to complete a challenge in their own tab

chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 }));
chrome.runtime.onStartup.addListener(() => poll());
chrome.alarms.onAlarm.addListener((a) => { if (a.name === POLL_ALARM) { watchdog().finally(() => poll()); } });

async function setStatus(patch) {
  const { status = {} } = await load('status');
  await store({ status: { ...status, ...patch } });
}

async function acquire() {
  const { busy } = await chrome.storage.session.get('busy');
  if (busy && Date.now() - busy < 5 * 60_000) return false;
  await chrome.storage.session.set({ busy: Date.now() });
  return true;
}
const release = () => chrome.storage.session.remove('busy');

async function waitComplete(tabId, timeout = 30_000) {
  const start = Date.now();
  for (;;) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'complete') return t;
    if (Date.now() - start > timeout) throw new Error('page did not finish loading');
    await sleep(300);
  }
}
async function openTab(url, active = false) {
  const tab = await chrome.tabs.create({ url, active });
  await waitComplete(tab.id);
  await sleep(1200); // let the page's own scripts settle
  return tab.id;
}
async function toTab(tabId, msg, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await chrome.tabs.sendMessage(tabId, msg); if (r !== undefined) return r; } catch { /* content script not ready yet */ }
    await sleep(500);
  }
  throw new Error('the page did not respond');
}
const closeTab = (tabId) => chrome.tabs.remove(tabId).catch(() => undefined);

async function getRuns() { return (await load('runs')).runs || {}; }
async function putRun(id, run) { const runs = await getRuns(); if (run) runs[id] = run; else delete runs[id]; await store({ runs }); }

// ───────────────────────────────────────────────────────────── polling
export async function poll() {
  if (!(await acquire())) return;
  try {
    const { token } = await load('token');
    if (!token) return;
    await setStatus({ lastPollAt: Date.now(), lastError: null });
    const { work, reason } = await api('/next');
    await setStatus({ idle: work ? null : reason || 'NO_WORK' });
    if (!work) return;
    await setStatus({ current: { applicationId: work.applicationId, step: work.step, since: Date.now() } });
    if (work.step === 'describe') await describeStep(work); else await submitStep(work);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { await store({ token: null }); await setStatus({ lastError: 'This browser is no longer paired. Pair it again from your AISE dashboard.' }); }
    else await setStatus({ lastError: String(e && e.message || e).slice(0, 200) });
  } finally {
    await setStatus({ current: null });
    await release();
  }
}

// ───────────────────────────────────────────────────────────── step 1: describe the real form
async function describeStep(work) {
  const tabId = await openTab(work.applyUrl, false);
  let keep = false;
  try {
    const d = await toTab(tabId, { type: 'describe' });
    const res = await api(`/applications/${work.applicationId}/describe`, { method: 'POST', body: { pageState: d.pageState, fields: d.fields, declarationText: d.declarationText } });
    // A login or a challenge belongs to the candidate: leave the page open and bring it forward.
    if (d.pageState === 'captcha' || d.pageState === 'login') { keep = true; await chrome.tabs.update(tabId, { active: true }); }
    await setStatus({ lastResult: { applicationId: work.applicationId, step: 'describe', pageState: d.pageState, ...res } });
  } finally { if (!keep) await closeTab(tabId); }
}

// ───────────────────────────────────────────────────────────── step 2: fill, ask for the permit, submit
async function submitStep(work) {
  const id = work.applicationId;
  const hb = await api(`/applications/${id}/heartbeat`, { method: 'POST' });
  if (!hb.continue) { await setStatus({ lastResult: { applicationId: id, step: 'submit', stopped: hb.reason } }); return; }
  // The approved file, byte for byte: AISE's hash, then ours.
  const res = await api(`/applications/${id}/attachment`, { raw: true });
  const buf = await res.arrayBuffer();
  const got = await sha256Hex(new Uint8Array(buf));
  if (got !== work.attachment.sha256) { await api(`/applications/${id}/blocked`, { method: 'POST', body: { reason: 'attachment_hash', phase: 'before_submit' } }); return; }
  const tabId = await openTab(work.applyUrl, false);
  let keep = false;
  try {
    const filled = await toTab(tabId, { type: 'fill', plan: work.plan, file: { b64: bytesToBase64(buf), filename: work.attachment.filename, mimeType: 'application/pdf' } });
    if (!filled.ok) { await api(`/applications/${id}/blocked`, { method: 'POST', body: { reason: filled.reason || 'form_changed', phase: 'before_submit' } }); return; }
    const text = normalizeText(filled.declarationText);
    const declarationHash = text ? await sha256Hex(text) : null;
    const permit = await api(`/applications/${id}/permit`, { method: 'POST', body: { planHash: work.planHash, declarationHash, missingRequired: filled.missingRequired, mismatched: filled.mismatched } });
    if (!permit.allowed) { await setStatus({ lastResult: { applicationId: id, step: 'submit', refused: permit.reason } }); return; }
    // From here the page is in the browser's hands until the portal answers: persist enough to finish even if this worker is stopped.
    await putRun(id, { permitId: permit.permitId, tabId, thanksUrl: work.thanksUrl, startedAt: Date.now(), state: 'watching' });
    const click = await toTab(tabId, { type: 'submit', applicationId: id });
    if (!click.clicked) { await putRun(id, null); await api(`/applications/${id}/blocked`, { method: 'POST', body: { reason: click.reason || 'no_submit_control', phase: 'before_submit', permitId: permit.permitId } }); return; }
    keep = true;
    await setStatus({ lastResult: { applicationId: id, step: 'submit', submitted: 'waiting_for_portal' } });
  } finally { if (!keep) await closeTab(tabId); }
}

// ───────────────────────────────────────────────────────────── the portal's answer
const samePage = (url, target) => { try { const a = new URL(url), b = new URL(target); return a.origin === b.origin && a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, ''); } catch { return false; } };

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url) return;
  const runs = await getRuns();
  for (const [id, run] of Object.entries(runs)) {
    if (run.tabId !== tabId || !samePage(tab.url, run.thanksUrl)) continue;
    try {
      const page = await toTab(tabId, { type: 'page-text' }, 10).catch(() => ({ text: '' }));
      await api(`/applications/${id}/evidence`, { method: 'POST', body: { permitId: run.permitId, confirmationUrl: tab.url, textSha256: await sha256Hex(normalizeText(page.text)) } });
      await setStatus({ lastResult: { applicationId: id, step: 'submit', submitted: 'confirmed_by_portal' } });
    } catch (e) { await setStatus({ lastError: `Confirmation could not be recorded: ${String(e && e.message || e).slice(0, 120)}` }); }
    await putRun(id, null);
    setTimeout(() => closeTab(tabId), 4000);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    try {
      if (msg.type === 'page-event') {
        const runs = await getRuns(); const run = runs[msg.applicationId];
        if (!run) return sendResponse({ ok: false });
        if (msg.event === 'captcha') {
          await api(`/applications/${msg.applicationId}/blocked`, { method: 'POST', body: { reason: 'captcha', phase: 'after_click', permitId: run.permitId } });
          await putRun(msg.applicationId, { ...run, state: 'handoff', startedAt: Date.now() });
          const t = await chrome.tabs.update(run.tabId, { active: true }).catch(() => null);
          if (t) await chrome.windows.update(t.windowId, { focused: true }).catch(() => undefined);
        } else if (msg.event === 'validation_error') {
          await api(`/applications/${msg.applicationId}/blocked`, { method: 'POST', body: { reason: 'validation_error', phase: 'before_submit', permitId: run.permitId } });
          await putRun(msg.applicationId, null);
        }
        return sendResponse({ ok: true });
      }
      if (msg.type === 'page-loaded') {
        // A page the portal answered with AFTER we clicked submit: if it is the form again with errors, the portal did not accept the application.
        const tabId = sender.tab && sender.tab.id; const runs = await getRuns();
        const entry = Object.entries(runs).find(([, r]) => r.tabId === tabId && r.state === 'watching');
        if (entry && !samePage(msg.url, entry[1].thanksUrl) && msg.errors > 0) {
          await api(`/applications/${entry[0]}/blocked`, { method: 'POST', body: { reason: 'validation_error', phase: 'before_submit', permitId: entry[1].permitId } });
          await putRun(entry[0], null);
        }
        return sendResponse({ ok: true });
      }
      if (msg.type === 'pair') {
        // From AISE's own assistant page (the bridge): only on aisehr.com, and never over an existing pairing, which the candidate ends in the popup first.
        if (msg.fromPage) {
          let origin = ''; try { origin = new URL(sender.url || '').origin; } catch { /* not a page */ }
          if (origin !== WEB_ORIGIN && origin !== WEB_ORIGIN.replace('://', '://www.')) return sendResponse({ ok: false, error: 'NOT_AISE_PAGE' });
          if ((await load('token')).token) return sendResponse({ ok: false, error: 'This browser is already paired. (ALREADY_PAIRED)' });
        }
        const out = await pairWithCode(String(msg.code || ''), browserName());
        await store({ token: out.token, deviceId: out.deviceId });
        await setStatus({ lastError: null });
        poll();
        return sendResponse({ ok: true });
      }
      if (msg.type === 'disconnect') { await store({ token: null, deviceId: null }); return sendResponse({ ok: true }); }
      if (msg.type === 'poll') { poll(); return sendResponse({ ok: true }); }
      if (msg.type === 'watchdog') { await watchdog(); return sendResponse({ ok: true }); }
      if (msg.type === 'status') { const s = await load(['token', 'status', 'runs']); return sendResponse({ paired: !!s.token, version: VERSION, status: s.status || {}, runs: s.runs || {} }); }
      sendResponse({ ok: false });
    } catch (e) { sendResponse({ ok: false, error: e instanceof ApiError ? (e.body && e.body.message) || `error ${e.status}` : String(e && e.message || e) }); }
  })();
  return true;
});

/** How this browser appears in the candidate's list on AISE, e.g. "Microsoft Edge · Windows". */
function browserName() {
  const d = navigator.userAgentData;
  const brand = d && d.brands && (d.brands.find((b) => /Edge|Opera|Brave/.test(b.brand)) || d.brands.find((b) => /Chrome/.test(b.brand)));
  return `${brand ? brand.brand.replace('Google ', '') : 'Chrome'} · ${(d && d.platform) || 'kompüter'}`;
}

/** Runs that never saw the portal's confirmation page: reported as an unclear outcome, never retried here. */
async function watchdog() {
  const runs = await getRuns();
  for (const [id, run] of Object.entries(runs)) {
    const age = Date.now() - run.startedAt;
    const { watchMs } = await load('watchMs');
    if (run.state === 'watching' && age > (watchMs || WATCH_MS)) {
      try { await api(`/applications/${id}/blocked`, { method: 'POST', body: { reason: 'no_confirmation', phase: 'after_click', permitId: run.permitId } }); } catch { /* the server's lease expiry will mark it uncertain */ }
      await putRun(id, null);
    } else if (run.state === 'handoff' && age > HANDOFF_MS) await putRun(id, null);
  }
}
