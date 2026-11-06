/**
 * Pure rules for the embedded (inline) checkout. The provider's page runs inside an iframe on our page and reports what happens with events; nothing
 * here grants anything. A "paid" event only moves the customer to the screen that asks the API for the verified plan.
 */

export type CheckoutMode = 'test' | 'live';

const HOSTS: Record<string, CheckoutMode> = {
  'test.checkout.dodopayments.com': 'test',
  'checkout.dodopayments.com': 'live',
};

/** The only session URLs the page will embed or navigate to: https on the provider's own checkout hosts. Anything else is refused. */
export function parseSessionUrl(raw: unknown): { url: string; mode: CheckoutMode } | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    const mode = HOSTS[u.hostname];
    if (u.protocol !== 'https:' || !mode || !u.pathname.startsWith('/session/')) return null;
    return { url: u.toString(), mode };
  } catch {
    return null;
  }
}

/** A URL the provider asks the page to open (bank authentication, final return). https only; never a script or data URL. */
export function safeRedirectTarget(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) ? u.toString() : null;
  } catch {
    return null;
  }
}

export type Breakdown = { finalTotal: number | null; currency: string | null };

/** Amounts arrive in the currency's smallest unit; the charged total (`finalTotal`) is the source of truth, not the base-currency total. */
export function readBreakdown(data: unknown): Breakdown {
  const m = (data as { message?: Record<string, unknown> } | undefined)?.message ?? (data as Record<string, unknown> | undefined) ?? {};
  const total = typeof m.finalTotal === 'number' ? m.finalTotal : typeof m.total === 'number' ? m.total : null;
  const currency = typeof m.finalTotalCurrency === 'string' ? m.finalTotalCurrency : typeof m.currency === 'string' ? m.currency : null;
  return { finalTotal: total, currency };
}

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF']);

export function formatCharged(b: Breakdown): string | null {
  if (b.finalTotal == null || !b.currency) return null;
  const major = ZERO_DECIMAL.has(b.currency) ? b.finalTotal : b.finalTotal / 100;
  return `${b.currency} ${major.toFixed(ZERO_DECIMAL.has(b.currency) ? 0 : 2)}`;
}

export type StatusKind = 'succeeded' | 'failed' | 'processing';

/**
 * Classifies the provider's `checkout.status` payload. The wording is the provider's; unknown shapes are "processing", which only waits and never
 * claims either outcome.
 */
export function classifyStatus(data: unknown): StatusKind {
  const m = (data as { message?: unknown } | undefined)?.message ?? data;
  const raw = typeof m === 'string' ? m : (m as Record<string, unknown> | undefined)?.status ?? (m as Record<string, unknown> | undefined)?.payment_status;
  const s = String(raw ?? '').toLowerCase();
  if (/(succeed|success|paid|complete)/.test(s) && !/(fail|declin|cancel)/.test(s)) return 'succeeded';
  if (/(fail|declin|cancel|error|expired)/.test(s)) return 'failed';
  return 'processing';
}
