'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Cookie consent for the non-essential analytics cookie.
 *
 * Production was setting a PostHog tracking cookie
 * (`ph_phc_..._posthog`, plus a matching localStorage entry) on first paint,
 * with no consent prompt anywhere on the site — verified on
 * https://aisehr.com. Analytics is not strictly necessary for the service to
 * work, so it is the one thing here that genuinely needs asking about first.
 *
 * The decision is kept in localStorage rather than a cookie of its own, so
 * declining does not itself require setting the thing being declined.
 */

const STORAGE_KEY = 'aise-cookie-consent';

export type ConsentValue = 'granted' | 'denied';

/** Reads the stored decision. `null` means the user has not chosen yet. */
export function readConsent(): ConsentValue | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    // Private mode / storage disabled. Treat as "no consent given", which is
    // the safe default: analytics stays off.
    return null;
  }
}

function writeConsent(value: ConsentValue) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Non-fatal: the banner reappears next visit, analytics stays off.
  }
  // Same-tab listeners need an explicit event; `storage` only fires on others.
  window.dispatchEvent(new CustomEvent('aise-consent-change', { detail: value }));
}

export function CookieConsent() {
  // `null` also covers the server render and the first client paint, so the
  // banner never flashes for someone who already decided.
  const [consent, setConsent] = useState<ConsentValue | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConsent(readConsent());
    setReady(true);
  }, []);

  const decide = (value: ConsentValue) => {
    writeConsent(value);
    setConsent(value);
  };

  if (!ready || consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Kuki razılığı"
      className="fixed bottom-0 left-0 right-0 z-[100] p-3 sm:p-6"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-neutral-dark/15 bg-background shadow-2xl shadow-neutral-dark/10 p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <p className="flex-1 text-[13px] sm:text-sm text-neutral-dark/85 leading-relaxed">
          Giriş üçün zəruri kukilərdən istifadə edirik. Anonim istifadə
          statistikası isə yalnız sizin razılığınızla toplanır.{' '}
          <Link href="/cookies" className="underline underline-offset-2 hover:text-accent">
            Ətraflı
          </Link>
        </p>

        <div className="grid grid-cols-2 gap-2 shrink-0 sm:flex">
          <button
            type="button"
            onClick={() => decide('denied')}
            className="min-h-11 rounded-full border border-neutral-dark/25 px-4 py-2.5 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-colors"
          >
            Yalnız zəruri
          </button>
          <button
            type="button"
            onClick={() => decide('granted')}
            className="product-action min-h-11 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover transition-colors"
          >
            Qəbul edirəm
          </button>
        </div>
      </div>
    </div>
  );
}
