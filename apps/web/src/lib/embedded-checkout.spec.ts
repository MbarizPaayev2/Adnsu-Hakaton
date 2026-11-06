import { describe, expect, it } from 'vitest';
import { classifyStatus, formatCharged, parseSessionUrl, readBreakdown, safeRedirectTarget } from './embedded-checkout';

describe('parseSessionUrl', () => {
  it('accepts only the provider checkout hosts over https and names the mode', () => {
    expect(parseSessionUrl('https://test.checkout.dodopayments.com/session/cks_1')?.mode).toBe('test');
    expect(parseSessionUrl('https://checkout.dodopayments.com/session/cks_1')?.mode).toBe('live');
  });
  it.each([
    'http://test.checkout.dodopayments.com/session/cks_1',
    'https://evil.example/session/cks_1',
    'https://test.checkout.dodopayments.com.evil.example/session/cks_1',
    'https://checkout.dodopayments.com/other',
    'javascript:alert(1)',
    '',
    null,
    undefined,
    42,
  ])('refuses %p', (v) => {
    expect(parseSessionUrl(v as unknown)).toBeNull();
  });
});

describe('safeRedirectTarget', () => {
  it('allows https and local development http only', () => {
    expect(safeRedirectTarget('https://bank.example/3ds?x=1')).toBe('https://bank.example/3ds?x=1');
    expect(safeRedirectTarget('http://127.0.0.1:4482/dashboard?checkout=success')).toContain('/dashboard');
    expect(safeRedirectTarget('http://bank.example/3ds')).toBeNull();
    expect(safeRedirectTarget('javascript:alert(1)')).toBeNull();
    expect(safeRedirectTarget('data:text/html,hi')).toBeNull();
    expect(safeRedirectTarget('x'.repeat(3000))).toBeNull();
  });
});

describe('amounts', () => {
  it('shows the amount actually charged, in its own currency, from the smallest unit', () => {
    const b = readBreakdown({ message: { subTotal: 800, total: 800, currency: 'AZN', finalTotal: 471, finalTotalCurrency: 'USD' } });
    expect(b).toEqual({ finalTotal: 471, currency: 'USD' });
    expect(formatCharged(b)).toBe('USD 4.71');
  });
  it('does not divide zero-decimal currencies and shows nothing without a total', () => {
    expect(formatCharged({ finalTotal: 500, currency: 'JPY' })).toBe('JPY 500');
    expect(formatCharged(readBreakdown({ message: {} }))).toBeNull();
    expect(formatCharged(readBreakdown(undefined))).toBeNull();
  });
});

describe('classifyStatus', () => {
  it('classifies outcomes and treats anything unknown as still processing', () => {
    expect(classifyStatus({ message: { status: 'succeeded' } })).toBe('succeeded');
    expect(classifyStatus({ message: { status: 'failed' } })).toBe('failed');
    expect(classifyStatus({ message: 'payment declined' })).toBe('failed');
    expect(classifyStatus({ message: { status: 'processing' } })).toBe('processing');
    expect(classifyStatus({})).toBe('processing');
    expect(classifyStatus(undefined)).toBe('processing');
  });
});
