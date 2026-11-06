import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

type Rule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<Rule[]> {
  return (await nextConfig.headers!()) as Rule[];
}
const header = (r: Rule, key: string) => r.headers.find((h) => h.key === key)?.value ?? '';

describe('security headers for the embedded checkout', () => {
  it('keeps the strict policy everywhere and denies payment and frames to others', async () => {
    const all = (await rules()).find((r) => r.source === '/:path*')!;
    expect(header(all, 'Permissions-Policy')).toContain('payment=()');
    expect(header(all, 'Content-Security-Policy')).not.toMatch(/dodopayments/);
    expect(header(all, 'Content-Security-Policy')).not.toMatch(/frame-src/);
    expect(header(all, 'Content-Security-Policy')).toContain("frame-ancestors 'self'");
  });

  it.each(['/checkout', '/business/billing'])('lets %s embed only the provider checkout and use the payment permission', async (source) => {
    const r = (await rules()).find((x) => x.source === source)!;
    expect(r).toBeDefined();
    const csp = header(r, 'Content-Security-Policy');
    expect(csp).toMatch(/frame-src 'self' https:\/\/checkout\.dodopayments\.com https:\/\/test\.checkout\.dodopayments\.com/);
    expect(csp).toContain('script-src');
    expect(csp).toContain('https://sdk-v2.hs.dodopayments.com');
    expect(csp).toContain('https://api.hs.dodopayments.com');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toMatch(/\*\s|https:\s|\bhttps:;/);
    const pp = header(r, 'Permissions-Policy');
    expect(pp).toContain('payment=(self "https://checkout.dodopayments.com" "https://test.checkout.dodopayments.com"');
    expect(pp).toContain('camera=()');
    expect(header(r, 'X-Frame-Options')).toBe('SAMEORIGIN');
  });

  it('only the two checkout routes are relaxed', async () => {
    const relaxed = (await rules()).filter((r) => /dodopayments/.test(header(r, 'Content-Security-Policy'))).map((r) => r.source);
    expect(relaxed.sort()).toEqual(['/business/billing', '/checkout']);
  });
});
