import { describe, it, expect } from 'vitest';
import { browserSupport, olderThan } from './extension-bridge';

describe('browserSupport', () => {
  it('accepts Chrome and Edge 116+ on a computer', () => {
    expect(browserSupport('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', false)).toEqual({ kind: 'supported', name: 'Chrome' });
    expect(browserSupport('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', false)).toEqual({ kind: 'supported', name: 'Microsoft Edge' });
  });
  it('flags old Chromium, Safari, Firefox and phones', () => {
    expect(browserSupport('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36', false)).toEqual({ kind: 'old', name: 'Chrome', version: 110 });
    expect(browserSupport('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', false)).toEqual({ kind: 'unsupported', name: 'Safari' });
    expect(browserSupport('Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0', false)).toEqual({ kind: 'unsupported', name: 'Firefox' });
    expect(browserSupport('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36', false)).toEqual({ kind: 'phone' });
    // An iPad asking for the desktop site reports a Mac user agent; only touch tells it apart.
    expect(browserSupport('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', true)).toEqual({ kind: 'phone' });
  });
});

describe('olderThan', () => {
  it('compares x.y.z numerically', () => {
    expect(olderThan('0.3.2', '0.3.3')).toBe(true);
    expect(olderThan('0.3.10', '0.3.3')).toBe(false);
    expect(olderThan('0.3.3', '0.3.3')).toBe(false);
  });
});
