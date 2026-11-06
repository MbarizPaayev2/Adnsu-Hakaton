import { describe, expect, it } from 'vitest';
import { unconfirmedDays } from './job-catalogue';

describe('unconfirmedDays', () => {
  const now = new Date('2026-10-12T08:00:00Z');
  it('is silent while the evidence is recent or unreadable', () => {
    expect(unconfirmedDays('2026-10-12T06:00:00Z', now)).toBe(0);
    expect(unconfirmedDays('2026-10-11T07:00:00Z', now)).toBe(0); // 25 h: a daily source
    expect(unconfirmedDays(null, now)).toBe(0);
    expect(unconfirmedDays('not a date', now)).toBe(0);
    expect(unconfirmedDays('2026-10-13T00:00:00Z', now)).toBe(0); // a future time is never "old"
  });
  it('counts whole days from two onwards', () => {
    expect(unconfirmedDays('2026-10-10T07:00:00Z', now)).toBe(2);
    expect(unconfirmedDays('2026-10-01T08:00:00Z', now)).toBe(11);
  });
});
