// Talks to the AISE Agent extension from the assistant page, through the extension's bridge content script (apps/extension/content/aise-bridge.js),
// which runs only on AISE's own assistant page. The page learns whether the extension is installed, its version and whether it is paired, and can
// hand it a pairing code it just created. The device token never reaches the page.

export interface ExtensionPresence { version: string; paired: boolean }

type Inbound = { source: 'aise-extension'; type: 'hello'; version: string; paired: boolean } | { source: 'aise-extension'; type: 'pair-result'; nonce: string; ok: boolean; error?: string };

function listen(match: (m: Inbound) => boolean, timeoutMs: number): Promise<Inbound | null> {
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const m = e.data as Inbound | null;
      if (!m || m.source !== 'aise-extension' || !match(m)) return;
      cleanup(); resolve(m);
    };
    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', onMessage); };
    window.addEventListener('message', onMessage);
  });
}

const post = (msg: Record<string, unknown>) => window.postMessage({ source: 'aise-web', ...msg }, window.location.origin);

/** The installed extension's version and pairing state, or null when no extension (0.3.3 or newer) answers in time. */
export async function detectExtension(timeoutMs = 1500): Promise<ExtensionPresence | null> {
  if (typeof window === 'undefined') return null;
  const answer = listen((m) => m.type === 'hello', timeoutMs);
  post({ type: 'ping' });
  const m = await answer;
  return m && m.type === 'hello' && typeof m.version === 'string' ? { version: m.version, paired: !!m.paired } : null;
}

/** Hands a fresh pairing code to the extension in this browser. Resolves with the extension's own answer, or a timeout. */
export async function pairViaExtension(code: string, timeoutMs = 20_000): Promise<{ ok: true } | { ok: false; error: string }> {
  const nonce = Math.random().toString(36).slice(2);
  const answer = listen((m) => m.type === 'pair-result' && m.nonce === nonce, timeoutMs);
  post({ type: 'pair', code, nonce });
  const m = await answer;
  if (!m || m.type !== 'pair-result') return { ok: false, error: 'TIMEOUT' };
  return m.ok ? { ok: true } : { ok: false, error: String(m.error || '') };
}

/** Plain-language reason for a failed one-click pairing; the manual code stays on screen as the fallback. */
export function pairErrorText(error: string): string {
  if (/ALREADY_PAIRED/.test(error)) return 'Bu brauzer artıq başqa AISE hesabı ilə cütlənib. Genişlənmənin pəncərəsində “Ayır” düyməsinə basın və yenidən cəhd edin.';
  if (/EXTENSION_OUTDATED/.test(error)) return 'Genişlənmənin bu versiyası köhnədir. Yeni faylı yükləyin, köhnəsini chrome://extensions səhifəsində silin və yenisini quraşdırın.';
  if (/PLAN_REQUIRED/.test(error)) return 'Brauzer köməkçisi Premium planına daxildir.';
  if (/PAIRING_CODE/.test(error)) return 'Kodun vaxtı bitib və ya istifadə olunub. Yenidən cəhd edin.';
  if (error === 'TIMEOUT') return 'Genişlənmə cavab vermədi. Chrome-da AISE Agent-in aktiv olduğunu yoxlayın və ya aşağıdakı kodu genişlənmədə əl ilə yazın.';
  return 'Brauzer qoşulmadı. Aşağıdakı kodu genişlənmənin pəncərəsində əl ilə yazın.';
}

export type BrowserSupport =
  | { kind: 'supported'; name: string }
  | { kind: 'old'; name: string; version: number }
  | { kind: 'phone' }
  | { kind: 'unsupported'; name: string };

/**
 * Whether this browser can run the extension: Chrome, Edge or another Chromium browser (116 or newer) on a computer. Safari, Firefox and every
 * phone or tablet browser cannot. Read from the user agent, so it is a guide for what to show, never a security check.
 */
export function browserSupport(ua: string, touchOnly: boolean): BrowserSupport {
  if (touchOnly || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return { kind: 'phone' };
  const edge = /Edg\/(\d+)/.exec(ua);
  const chrome = /(?:Chrome|Chromium)\/(\d+)/.exec(ua);
  if (/Firefox\//.test(ua)) return { kind: 'unsupported', name: 'Firefox' };
  if (!chrome && /Safari\//.test(ua)) return { kind: 'unsupported', name: 'Safari' };
  if (!chrome) return { kind: 'unsupported', name: 'Bu brauzer' };
  const name = edge ? 'Microsoft Edge' : /OPR\//.test(ua) ? 'Opera' : 'Chrome';
  const version = Number((edge || chrome)[1]);
  return version >= 116 ? { kind: 'supported', name } : { kind: 'old', name, version };
}

/** True when `a` is an older x.y.z than `b`. */
export function olderThan(a: string, b: string): boolean {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
}
