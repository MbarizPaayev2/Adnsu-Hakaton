import { describe, expect, it } from 'vitest';
import { mostSpecificHref } from './dashboard-nav';

describe('dashboard navigation', () => {
  const hrefs = ['/dashboard', '/dashboard/applications', '/dashboard/applications/tracker', '/dashboard/profile'];
  it('marks only the nested page, not its parent too', () => {
    expect(mostSpecificHref('/dashboard/applications/tracker', hrefs)).toBe('/dashboard/applications/tracker');
    expect(mostSpecificHref('/dashboard/applications/abc', hrefs)).toBe('/dashboard/applications');
  });
  it('keeps the overview for the overview only', () => {
    expect(mostSpecificHref('/dashboard', hrefs)).toBe('/dashboard');
    expect(mostSpecificHref('/dashboard/settings', hrefs)).toBeNull();
  });
});
