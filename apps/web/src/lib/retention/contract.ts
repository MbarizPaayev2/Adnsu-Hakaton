/**
 * Frontend-side shape of the commercial / retention journeys, mapped to the real backend contract in ./live/adapter.ts
 * (docs/frontend-contract-2026-10-03.md). Screens only know these types; the adapter hides how the API spells them.
 */

export type RetentionMode = 'live' | 'fixture' | 'unavailable';

/** Hosts where synthetic fixture data may ever be served: this machine, and nothing else. Fail closed: any other host (including aisehr.com) never gets fixtures. */
export function isLocalQaHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost') || h.endsWith('.test');
}

/**
 * `live` (default) talks to the real API with the signed-in session; what the API cannot do is reported by `capabilities`, never faked.
 * `fixture` is an explicit local-QA switch (NEXT_PUBLIC_RETENTION_MODE=fixture at build time) that stores synthetic data in the browser
 * only, and only on an allowlisted local host. A public host such as aisehr.com can never enter fixture mode, whatever the build says.
 */
export function retentionMode(): RetentionMode {
  const wanted = process.env.NEXT_PUBLIC_RETENTION_MODE === 'fixture';
  if (!wanted) return 'live';
  if (typeof window === 'undefined') return 'live'; // fixtures are browser-only
  if (!isLocalQaHost(window.location.hostname)) return 'live';
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_ALLOW_TEST_FIXTURES !== 'true') return 'live';
  return 'fixture';
}

export type ApplyMethod = 'EMAIL' | 'EXTERNAL' | 'UNKNOWN';

export interface JobRef {
  /** `${kind}:${id}` as used by /jobs/[kind]/[id]. */
  key: string;
  title: string;
  company: string;
  location: string | null;
  deadline: string | null;
}

export interface SavedJob extends JobRef {
  savedAt: string;
  open: boolean;
  applyMethod: ApplyMethod;
}

export interface SearchCriteria {
  q?: string;
  company?: string;
  category?: string;
  location?: string;
  source?: string;
  work?: string;
  experience?: string;
}

export type AlertFrequency = 'instant' | 'daily' | 'weekly';

export interface SavedSearch {
  id: string;
  name: string;
  criteria: SearchCriteria;
  frequency: AlertFrequency;
  paused: boolean;
  updatedAt: string;
  /** null when the backend cannot say (never a made-up count). */
  newSinceLastVisit: number | null;
}

export interface CompanyRef {
  /** Stable backend ID. */
  id?: string;
  /** Canonical, alias-free key. */
  key: string;
  name: string;
  /** Where this employer name comes from, e.g. catalogue source. */
  sourceLabel: string;
  /** null = unknown, never invented. */
  openVacancies: number | null;
  location?: string | null;
  status?: string;
  isPartner?: boolean;
  isRegistered?: boolean;
}

export interface NotificationPreferences {
  planOffersEmail?: boolean;
  channels: { inApp: boolean; email: boolean; telegram: boolean };
  frequency: AlertFrequency;
  quietHours: { enabled: boolean; from: string; to: string };
  paused: boolean;
  unsubscribedAll: boolean;
  telegram: 'unlinked' | 'linked' | 'unavailable';
  /** Until when alerts are paused (ISO), when a pause is active. */
  pausedUntil?: string | null;
  /** Whether instant alerts exist for this account's plan (from the entitlements). */
  instant?: { available: boolean; dailyLimit: number | null };
}

export interface PlanView {
  /** Purchasable right now: server says so AND payments are enabled. Everything else shows no buy button. */
  purchasable?: boolean;
  /** Plan id the checkout endpoint accepts for this offer. */
  checkoutId?: string;
  /** Supported server plan IDs: 'free' | 'basic' | 'standard' | 'unlimited' */
  id: string;
  name: string;
  /** null = price not set; the UI must say so rather than guess. */
  priceAzn: number | null;
  period: string;
  /** Concrete behaviours, never invented quotas. */
  includes: string[];
  /** Numeric allowances come from the entitlement contract; null = not published. */
  allowances: { label: string; value: string | null }[];
  /** The server's grants by feature key, for the plan comparison (same rows and units for every plan). Absent in fixtures. */
  grants?: Record<string, { enabled: boolean; limit?: number | null; period?: string; availability?: string }>;
}

export interface EmployerPackage {
  id: 'trial' | 'single' | 'recurring' | 'enterprise' | 'promoted';
  name: string;
  summary: string;
  priceAzn: number | null;
  optional?: boolean;
  /** Whether the package can be purchased now. */
  available: boolean;
  cta: { label: string; href: string };
}

export interface CommercialCatalogue {
  candidate: { free: PlanView; plus?: PlanView; premium: PlanView };
  employer: EmployerPackage[];
  source: 'fixture' | 'live';
  paymentsEnabled?: boolean;
  /** Approved short value copy served by the backend (never an interview promise or a figure). */
  positioning?: { cvPreview?: string; applicationReview?: string; premiumComparison?: string; finePrint?: string };
}

export interface HomeSummary {
  reviewJobs: { key: string; title: string; company: string }[] | null;
  actionApplication: { id: string; title: string; company: string; action: string; href: string } | null;
  reply: { id: string; title: string; company: string; href: string } | null;
  searchUpdates: { searchId: string; name: string; count: number }[] | null;
}

/** What the connected backend can actually do; the UI hides controls it cannot honour instead of faking them. */
export interface RetentionCapabilities {
  weeklyDigest: boolean;
  perSearchFrequency: boolean;
}

export interface EntitlementFeature { enabled: boolean; limit?: number | null; period?: string; availability?: 'available' | 'planned' | 'disabled'; used?: number; remaining?: number | null; note?: string }
export interface EntitlementsView { plan: string; offer: string; legacy: boolean; features: Record<string, EntitlementFeature> }

export class RetentionError extends Error {
  /** SIGNED_OUT and RATE_LIMITED carry a message the page should show as is: retrying at once cannot help. */
  constructor(public code: 'UNAVAILABLE' | 'FAILED' | 'NOT_FOUND' | 'SIGNED_OUT' | 'RATE_LIMITED', message: string) {
    super(message);
  }
}
