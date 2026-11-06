import { getSession } from 'next-auth/react';
import { isTouchDevice, notify } from './notify';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

let browserSessionRequest: ReturnType<typeof getSession> | null = null;
async function browserSession() {
  if (!browserSessionRequest) {
    browserSessionRequest = getSession().finally(() => { browserSessionRequest = null; });
  }
  return browserSessionRequest;
}

/** The request did not reach AISE (offline, DNS, a blocked connection). Its message is what a page can show. */
export class ApiNetworkError extends Error {
  constructor() {
    super('AISE ilə əlaqə qurulmadı. İnternet bağlantınızı yoxlayıb yenidən cəhd edin.');
    this.name = 'ApiNetworkError';
  }
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  let sessionToken: string | null = null;

  // Check if we are running in browser or server context
  if (typeof window !== 'undefined') {
    const session = await browserSession();
    sessionToken = (session as any)?.sessionToken || null;
  } else {
    const session = await getServerSession(authOptions);
    sessionToken = (session as any)?.sessionToken || null;
  }

  const headers = new Headers(options.headers || {});
  
  if (sessionToken) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }
  
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    return await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    // An abort is the caller's own decision; anything else is the network ("Failed to fetch", "Load failed"), which pages used to show as is.
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiNetworkError();
  }
}

/**
 * Normalizes an /uploads/... reference into the relative path apiFetch
 * expects, whether it arrived as a bare path ("/uploads/x.png") or as an
 * absolute URL (any origin — including a stale one, e.g. company logos were
 * historically stored/rendered without the API origin prefixed at all,
 * which resolved against the wrong host).
 */
function toApiPath(urlOrPath: string): string {
  try {
    const parsed = new URL(urlOrPath, API_URL);
    return parsed.pathname + parsed.search;
  } catch {
    return urlOrPath;
  }
}

/**
 * /uploads/:filename now requires a session (see apps/api's
 * AnySessionGuard) — a plain `<a href>`/`<img src>` pointed straight at the
 * API can no longer carry the bearer token, so this fetches the bytes with
 * apiFetch and hands back an object URL the browser can use in its place.
 * Caller owns revoking it (via useAuthedFileUrl, or manually once done).
 */
export async function fetchAuthedFileUrl(urlOrPath: string): Promise<string | null> {
  const res = await apiFetch(toApiPath(urlOrPath));
  if (!res.ok) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Fetches a file with the current session and saves it. Never silent: a failure is announced, and on a phone (where the browser may not start a
 * download from a script) a tap-to-open link is offered. The object URL is kept alive long enough for the browser to read it (revoking it at once
 * cancelled the download on mobile browsers).
 */
export async function downloadAuthedFile(urlOrPath: string, suggestedName?: string): Promise<boolean> {
  try {
    const res = await apiFetch(toApiPath(urlOrPath));
    if (!res.ok) {
      notify({
        tone: 'error',
        text: res.status === 404 ? 'Fayl tapılmadı. Səhifəni yeniləyib yenidən cəhd edin.' : res.status === 401 || res.status === 403 ? 'Fayla giriş üçün yenidən daxil olun.' : 'Fayl yüklənə bilmədi. Bir az sonra yenidən cəhd edin.',
      });
      return false;
    }
    const objectUrl = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    if (suggestedName) link.download = suggestedName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (isTouchDevice()) {
      notify({ tone: 'info', text: 'Fayl hazırdır. Yükləmə başlamayıbsa, aşağıdakı düyməyə toxunun.', href: objectUrl, hrefLabel: 'Faylı aç', download: suggestedName });
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
    return true;
  } catch {
    notify({ tone: 'error', text: 'Şəbəkə xətası: fayl yüklənmədi. Bağlantınızı yoxlayıb yenidən cəhd edin.' });
    return false;
  }
}
