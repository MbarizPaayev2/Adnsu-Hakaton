import { describe, it, expect } from 'vitest';
import { safeNextPath } from './safe-next';

describe('post-login destination', () => {
  it('keeps a site-relative jobs or dashboard path', () => {
    expect(safeNextPath('/jobs/imported/abc123')).toBe('/jobs/imported/abc123');
    expect(safeNextPath('/dashboard/email-applications/xyz')).toBe('/dashboard/email-applications/xyz');
  });
  it.each([null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/admin', '/jobs/../admin', '/jobs/x?next=//evil', 'javascript:alert(1)'])('refuses %s', (value) => {
    expect(safeNextPath(value)).toBe('/dashboard');
  });
});
