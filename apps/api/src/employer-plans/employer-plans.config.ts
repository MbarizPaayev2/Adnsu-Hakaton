/**
 * Employer plans (docs/employer-plans-2026-10-11.md). Prices and durations are fixed product decisions; only availability and provider ids come from the
 * environment, so the offer stays unpurchasable until the checkout, webhook and publication behaviour have been verified.
 */
export const EMPLOYER_PLANS = {
  trial: { id: 'sinaq', labelAz: 'Sınaq', days: 14 },
  single: { id: 'tek_vakansiya', labelAz: 'Tək vakansiya', priceAzn: 20, days: 30 },
  business: { id: 'biznes', labelAz: 'Biznes', priceAznPerMonth: 100, reconfirmDays: 60 },
} as const;

/** The provider may report a renewal late; the same grace as candidate subscriptions applies before listings lapse. */
export const EMPLOYER_RENEWAL_GRACE_MS = 3 * 86_400_000;

export interface EmployerPlansConfig {
  /** Publication is gated by plans: new vacancies start as drafts and need moderation and an entitlement. Off = the previous behaviour, unchanged. */
  gated: boolean;
  /** Checkout may be opened (also needs PAYMENTS_ENABLED and a provider product id). */
  checkoutEnabled: boolean;
  singleProductId: string | undefined;
  businessProductId: string | undefined;
  /** Admin moderation can be replaced by automatic approval for an approved company when every automatic check passes (default off). */
  autoApprove: boolean;
}

const flag = (v: string | undefined) => (v ?? '').trim().toLowerCase() === 'true';

export function loadEmployerPlansConfig(env: Record<string, string | undefined> = process.env): EmployerPlansConfig {
  return {
    gated: flag(env.EMPLOYER_PLANS_ENABLED),
    checkoutEnabled: flag(env.EMPLOYER_BILLING_ENABLED),
    singleProductId: env.DODO_PRODUCT_ID_EMPLOYER_SINGLE?.trim() || undefined,
    businessProductId: env.DODO_PRODUCT_ID_EMPLOYER_BUSINESS?.trim() || undefined,
    autoApprove: flag(env.EMPLOYER_VACANCY_AUTO_APPROVE),
  };
}

/** Normalised identity of a company for "one trial per company": legal-form words, punctuation, case and diacritics are ignored. */
export function companyNameKey(name: string): string {
  return String(name ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[əƏ]/g, 'e').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ç/g, 'c')
    .replace(/\b(mmc|asc|qsc|llc|ltd|inc|ojsc|cjsc|ie|ip|ib|company|group|holding|grup|qrup|sirketi)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

const SHARED_DOMAINS = new Set(['gmail.com', 'mail.ru', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'wa.me', 'vk.com', 't.me', 'google.com', 'sites.google.com', 'wixsite.com', 'blogspot.com', 'wordpress.com', 'tilda.ws', 'linktr.ee']);

/** Registrable-looking host of the company website, or null when absent or a shared platform. */
export function companyDomainKey(website: string | null | undefined): string | null {
  const raw = String(website ?? '').trim();
  if (!raw) return null;
  try {
    const host = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.') || SHARED_DOMAINS.has(host) || [...SHARED_DOMAINS].some((d) => host.endsWith(`.${d}`))) return null;
    return host;
  } catch {
    return null;
  }
}
