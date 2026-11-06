'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export interface SubscriptionView {
  plan: 'FREE' | 'BASIC' | 'STANDARD' | 'Limitsiz' | 'PLUS' | 'PREMIUM';
  subscriptionPlan: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  matchesUsedThisPeriod: number;
  matchesUsedThisWeek?: number;
  matchesPerDay?: number | null;
  matchesUsedToday?: number;
  matchQuotaResetsAt?: string | null;
  providerManaged: boolean;
  override: { plan: string; expiresAt: string } | null;
  sponsoredAccess?: { academyName: string; plan: string; expiresAt: string; matchesPerDay: number | null; matchesRemainingToday: number | null } | null;
}

// The provider's status in plain Azerbaijani.
export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: 'Aktiv',
  pending: 'Ödəniş gözlənilir',
  on_hold: 'Ödəniş alınmadı — dayandırılıb',
  past_due: 'Ödəniş gecikir',
  paused: 'Dayandırılıb',
  failed: 'Ödəniş uğursuz oldu',
  expired: 'Müddəti bitib',
  cancelled: 'Ləğv edilib',
  canceled: 'Ləğv edilib',
};

/** null while loading; false when the server says purchasing is switched off. */
export function usePaymentsEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    apiFetch('/billing/status')
      .then((res) => (res.ok ? res.json() : { paymentsEnabled: false }))
      .then((data) => alive && setEnabled(!!data.paymentsEnabled))
      .catch(() => alive && setEnabled(false));
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}

/** What this deployment has switched on, from the public status endpoint. null = not loaded; false = switched off or unreadable (never promised). */
export type PublicFeatures = { documents: boolean | null; emailApplications: boolean | null; emailAutomation: boolean | null };
export function usePublicFeatures(): PublicFeatures {
  const [features, setFeatures] = useState<PublicFeatures>({ documents: null, emailApplications: null, emailAutomation: null });
  useEffect(() => {
    let alive = true;
    apiFetch('/billing/status')
      .then((res): Promise<{ documentGenerationEnabled?: boolean; emailApplicationsEnabled?: boolean; emailAutomationEnabled?: boolean }> => (res.ok ? res.json() : Promise.resolve({})))
      .then((data) => alive && setFeatures({ documents: data.documentGenerationEnabled === true, emailApplications: data.emailApplicationsEnabled === true, emailAutomation: data.emailAutomationEnabled === true }))
      .catch(() => alive && setFeatures({ documents: false, emailApplications: false, emailAutomation: false }));
    return () => {
      alive = false;
    };
  }, []);
  return features;
}
