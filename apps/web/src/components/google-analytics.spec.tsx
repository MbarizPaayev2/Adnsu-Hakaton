import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

const nav = vi.hoisted(() => ({ path: '/jobs/abc123' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }));
vi.mock('next/script', () => ({
  default: ({ src, id, children }: { src?: string; id?: string; children?: React.ReactNode }) => <script data-testid={id ?? 'gtag-src'} data-src={src}>{children}</script>,
}));

import { GoogleAnalytics, isMeasured, GA_MEASUREMENT_ID } from './google-analytics';

describe('Google Analytics', () => {
  beforeEach(() => { localStorage.clear(); delete (window as any).gtag; delete (window as any).dataLayer; window.history.replaceState({}, '', '/'); document.cookie = '_ga=GA1.1.1; path=/'; });
  afterEach(() => { cleanup(); delete (window as any)[`ga-disable-${GA_MEASUREMENT_ID}`]; });

  it('injects nothing before a decision or after a refusal', () => {
    const none = render(<GoogleAnalytics />);
    expect(none.queryByTestId('gtag-src')).toBeNull();
    localStorage.setItem('aise-cookie-consent', 'denied');
    const denied = render(<GoogleAnalytics />);
    expect(denied.queryByTestId('gtag-src')).toBeNull();
    expect(document.cookie).not.toContain('_ga=');
    expect((window as any)[`ga-disable-${GA_MEASUREMENT_ID}`]).toBe(true);
  });

  it('after consent loads the single tag, sends page views by hand with the path only, and sets no user data', () => {
    localStorage.setItem('aise-cookie-consent', 'granted');
    (window as any).dataLayer = [];
    window.history.replaceState({}, '', '/jobs/abc123?token=SECRET');
    const view = render(<GoogleAnalytics />);
    expect(view.getAllByTestId('gtag-src')).toHaveLength(1);
    expect(view.getByTestId('gtag-src').getAttribute('data-src')).toContain(`id=${GA_MEASUREMENT_ID}`);
    const entries = ((window as any).dataLayer as IArguments[] | unknown[][]).map((a) => Array.from(a as ArrayLike<unknown>));
    const config = entries.find((c) => c[0] === 'config') as unknown[];
    expect(config[2]).toMatchObject({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, page_location: `${location.origin}/jobs/abc123` });
    const pv = entries.find((c) => c[0] === 'event' && c[1] === 'page_view') as unknown[];
    expect(pv[2]).toMatchObject({ page_path: '/jobs/abc123', page_location: `${location.origin}/jobs/abc123` });
    // Commands must be Arguments objects (what gtag.js executes), never plain arrays.
    expect(((window as any).dataLayer as unknown[]).every((a) => Object.prototype.toString.call(a) === '[object Arguments]')).toBe(true);
    expect(JSON.stringify(entries)).not.toMatch(/SECRET|token|user_id|email|\?/);
  });

  it('switches collection off while the visitor is on a token or admin route, and never sends that URL', () => {
    localStorage.setItem('aise-cookie-consent', 'granted');
    nav.path = '/verify-email';
    window.history.replaceState({}, '', '/verify-email?token=SECRET-TOKEN');
    render(<GoogleAnalytics />);
    expect((window as any)[`ga-disable-${GA_MEASUREMENT_ID}`]).toBe(true);
    const entries = (((window as any).dataLayer ?? []) as unknown[]).map((a) => JSON.stringify(Array.from(a as ArrayLike<unknown>)));
    expect(entries.filter((e) => e.includes('"page_view"'))).toEqual([]);
    nav.path = '/jobs/abc123';
  });

  it('measures search pages normally, and the search term never appears in anything it sends', () => {
    localStorage.setItem('aise-cookie-consent', 'granted');
    nav.path = '/jobs';
    window.history.replaceState({}, '', '/jobs?q=sql+analitik&search=hr');
    render(<GoogleAnalytics />);
    expect((window as any)[`ga-disable-${GA_MEASUREMENT_ID}`]).toBe(false);
    const entries = (((window as any).dataLayer ?? []) as unknown[]).map((a) => JSON.stringify(Array.from(a as ArrayLike<unknown>)));
    expect(entries.filter((e) => e.includes('"page_view"'))).toHaveLength(1);
    expect(entries.join('')).not.toMatch(/sql|analitik|search=|q=|\?/);
  });

  it('switches off and clears its cookies when consent is withdrawn', () => {
    localStorage.setItem('aise-cookie-consent', 'granted');
    render(<GoogleAnalytics />);
    act(() => { window.dispatchEvent(new CustomEvent('aise-consent-change', { detail: 'denied' })); });
    expect((window as any)[`ga-disable-${GA_MEASUREMENT_ID}`]).toBe(true);
  });

  it('does not measure token, admin and employer areas', () => {
    for (const p of ['/admin', '/admin/setup', '/verify-email', '/reset-password', '/forgot-password', '/business/dashboard']) expect(isMeasured(p)).toBe(false);
    for (const p of ['/', '/jobs', '/jobs/abc', '/pricing', '/dashboard']) expect(isMeasured(p)).toBe(true);
  });
});
