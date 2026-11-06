import { extractAuthLink } from './email-link.util';

describe('extractAuthLink', () => {
  it('reads pathname and token from generated HTML without requiring a database', () => {
    const html =
      '<p><a href="http://127.0.0.1:3450/verify-email?token=abc123def">E-poçtumu təsdiqlə</a></p>';
    const link = extractAuthLink(html);
    expect(link.origin).toBe('http://127.0.0.1:3450');
    expect(link.pathname).toBe('/verify-email');
    expect(link.token).toHaveLength(9);
  });

  it('distinguishes the business verification path', () => {
    const html =
      '<p><a href="http://127.0.0.1:3450/business/verify-email?token=zzzzzzzz">E-poçtumu təsdiqlə</a></p>';
    expect(extractAuthLink(html).pathname).toBe('/business/verify-email');
  });
});
