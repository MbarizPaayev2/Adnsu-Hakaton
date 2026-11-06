'use client';

import React, { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { readConsent, type ConsentValue } from './cookie-consent';

/**
 * Google Analytics 4, loaded ONLY after the visitor chose "Qəbul edirəm" in the cookie banner (the same decision that gates PostHog).
 *
 * - Nothing is requested from Google and no `_ga` cookie exists before consent; a later "denied" switches collection off and removes the cookies.
 * - Page views are sent by hand with `page_location` = origin + path only: query strings and fragments are never sent (they carry one-time tokens on
 *   /verify-email, /reset-password and the admin setup page, and search terms elsewhere).
 * - No user id, e-mail or other property is ever set; Google signals and ad personalisation are off. Sensitive areas are not measured at all.
 */
export const GA_MEASUREMENT_ID = 'G-VKKBWTCEE4';
// GA4's "Enhanced measurement → Site search" would read search parameters from the real URL regardless of page_location. It is switched OFF in the GA property
// (turned off and verified in browser traffic on 10 Oct 2026); if that setting is ever turned back on, search terms in the address would be collected again.
const NOT_MEASURED = ['/admin', '/api', '/verify-email', '/reset-password', '/forgot-password', '/business'];

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

export function isMeasured(pathname: string): boolean {
  return !NOT_MEASURED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function clearGoogleCookies() {
  for (const name of document.cookie.split(';').map((c) => c.split('=')[0].trim())) {
    if (name === '_ga' || name.startsWith('_ga_')) {
      document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax; Secure`;
      document.cookie = `${name}=; Max-Age=0; path=/; domain=${location.hostname}; SameSite=Lax; Secure`;
    }
  }
}

/** origin + path: never a query string or fragment (they carry one-time tokens and search terms). */
export function cleanUrl(href: string): string {
  try {
    const u = new URL(href, location.origin);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

// gtag.js only treats an `arguments` object as a command (a plain array is just data), so this must be a classic function.
function gtagPush(..._args: unknown[]) {
  // eslint-disable-next-line prefer-rest-params
  (window.dataLayer = window.dataLayer || []).push(arguments);
}

export function GoogleAnalytics() {
  const [consent, setConsent] = useState<ConsentValue | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    setConsent(readConsent());
    const onChange = (e: Event) => setConsent((e as CustomEvent<ConsentValue>).detail ?? readConsent());
    window.addEventListener('aise-consent-change', onChange);
    return () => window.removeEventListener('aise-consent-change', onChange);
  }, []);

  // Consent decides everything: refused = switched off and cookies removed; granted = the queue below is created once, before gtag.js loads.
  useEffect(() => {
    if (consent === 'denied') {
      window[`ga-disable-${GA_MEASUREMENT_ID}`] = true;
      clearGoogleCookies();
      return;
    }
    if (consent !== 'granted' || typeof window.gtag === 'function') return;
    window.gtag = gtagPush;
    gtagPush('js', new Date());
    gtagPush('config', GA_MEASUREMENT_ID, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_flags: 'SameSite=Lax;Secure',
      page_location: cleanUrl(location.href),
      page_referrer: cleanUrl(document.referrer),
    });
  }, [consent]);

  // Every route change: measured routes get a clean location (also applied to Google's automatic "enhanced measurement" events such as scroll and
  // outbound clicks, which would otherwise carry the full URL); unmeasured routes switch collection off while the visitor is there.
  useEffect(() => {
    if (consent !== 'granted' || !pathname || typeof window.gtag !== 'function') return;
    if (!isMeasured(pathname)) {
      window[`ga-disable-${GA_MEASUREMENT_ID}`] = true;
      return;
    }
    window[`ga-disable-${GA_MEASUREMENT_ID}`] = false;
    const here = cleanUrl(location.href);
    gtagPush('set', { page_location: here, page_referrer: cleanUrl(document.referrer), page_title: '' });
    gtagPush('event', 'page_view', { page_location: here, page_path: pathname, page_title: '' });
  }, [consent, pathname]);

  if (consent !== 'granted') return null;
  return <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />;
}
