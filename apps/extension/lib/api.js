import { API_BASE, VERSION, load } from './util.js';

export class ApiError extends Error {
  constructor(status, body) { super(`API ${status}`); this.status = status; this.body = body; }
}

/** Calls the AISE API with this browser's device token. The token only ever reaches aisehr.com (host permission). */
export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const { token } = await load('token');
  if (!token) throw new ApiError(401, { message: 'not paired' });
  const res = await fetch(`${API_BASE}/agent/ext${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'X-AISE-Extension-Version': VERSION, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    return res;
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

export async function pairWithCode(code, name) {
  const res = await fetch(`${API_BASE}/agent/ext/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name, version: VERSION }) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}
