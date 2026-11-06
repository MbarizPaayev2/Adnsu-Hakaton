// Small helpers shared by the service worker. No page content is ever executed or interpreted as an instruction here.
export const WEB_ORIGIN = 'https://aisehr.com';
export const API_BASE = `${WEB_ORIGIN}/backend`;
/** Sent with every call, so AISE can say which paired browsers need an update and refuse versions it no longer supports. */
export const VERSION = chrome.runtime.getManifest().version;

export async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Must match the server: whitespace collapsed, trimmed, then SHA-256. */
export const normalizeText = (t) => String(t || '').replace(/\s+/g, ' ').trim();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function store(patch) { await chrome.storage.local.set(patch); }
export async function load(keys) { return chrome.storage.local.get(keys); }
