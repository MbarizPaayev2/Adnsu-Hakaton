'use client';

import React, { useEffect, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import posthog from 'posthog-js';
import { readConsent } from './cookie-consent';

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

let initialized = false;

// Client-side pipeline/usage monitoring. No-ops entirely if no key is
// configured, same mock-first convention used server-side (see
// apps/api/src/common/posthog.service.ts) — never blocks local dev.
//
// Gated on consent. This used to init on mount unconditionally, so production
// set a `ph_phc_..._posthog` cookie on first paint before the visitor was
// asked anything — analytics is not necessary for the service to function, so
// it is the one thing on the site that has to wait for a decision.
function initPostHog() {
  if (initialized || !POSTHOG_KEY || typeof window === 'undefined') return;
  if (readConsent() !== 'granted') return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false, // captured manually below on App Router route change
    capture_pageleave: true,
    // Belt and braces: even once initialised, do not persist anything until
    // posthog itself has been told consent is in place.
    persistence: 'localStorage+cookie',
  });
  initialized = true;
}

/** True only when a key is configured AND the visitor opted in. */
function analyticsActive() {
  return Boolean(POSTHOG_KEY) && initialized && readConsent() === 'granted';
}

/**
 * Funnel events for e-mail applications. Only when a key is configured AND the visitor consented; the
 * names are a fixed list and the properties carry no personal data (a public posting id and a source).
 */
const FUNNEL_EVENTS = new Set(['email_apply_job_viewed', 'email_apply_prepared', 'email_apply_approved']);
export function captureFunnelEvent(name: string, properties: { jobId?: string; source?: string } = {}) {
  if (!FUNNEL_EVENTS.has(name) || !analyticsActive()) return;
  posthog.capture(name, { jobId: properties.jobId, source: properties.source });
}

// App Router navigates client-side without a full page load, so pageviews
// have to be captured manually on path/query change instead of relying on
// posthog-js's default page-load autocapture.
function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!analyticsActive()) return;
    const url = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

// Ties client-side events to the same user identity server-side events use
// (User.id / Business — see the NextAuth session shape in
// apps/web/src/app/api/auth/[...nextauth]/route.ts), so a signup->match->
// application funnel is traceable across both.
function PostHogIdentify() {
  const { data: session } = useSession();

  useEffect(() => {
    if (!analyticsActive()) return;
    const userId = (session?.user as any)?.id;
    if (userId) {
      // The account id only: the e-mail address is personal data the privacy notice does not list for analytics.
      posthog.identify(userId);
    }
  }, [session]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // Re-render on a consent decision so the pageview/identify hooks below
  // start (or stay) inert without needing a page reload.
  const [, setConsentTick] = React.useState(0);

  useEffect(() => {
    initPostHog();

    const onChange = () => {
      initPostHog();
      setConsentTick((n) => n + 1);
    };

    // Same-tab decision from the banner, and a decision made in another tab.
    window.addEventListener('aise-consent-change', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('aise-consent-change', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageview />
      </Suspense>
      <PostHogIdentify />
      {children}
    </>
  );
}
