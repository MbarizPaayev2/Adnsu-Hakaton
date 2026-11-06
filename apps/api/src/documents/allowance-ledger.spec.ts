import { periodFor } from './allowance-ledger';

describe('periodFor — the account period is the calendar month in Baku (UTC+4, no DST)', () => {
  it('names the month and gives its start and reset moments in UTC', () => {
    const p = periodFor(new Date('2026-10-15T12:00:00Z'));
    expect(p.key).toBe('2026-10');
    expect(p.startsAt.toISOString()).toBe('2026-09-30T20:00:00.000Z');
    expect(p.resetsAt.toISOString()).toBe('2026-10-31T20:00:00.000Z');
  });

  it('rolls over at midnight Baku, not midnight UTC', () => {
    expect(periodFor(new Date('2026-10-31T19:59:59.999Z')).key).toBe('2026-10');
    expect(periodFor(new Date('2026-10-31T20:00:00.000Z')).key).toBe('2026-11');
    // 2026-10-01T00:00 UTC is already 04:00 on 1 October in Baku; 2026-09-30T20:00Z is the first instant of October.
    expect(periodFor(new Date('2026-09-30T19:59:59.999Z')).key).toBe('2026-09');
    expect(periodFor(new Date('2026-09-30T20:00:00.000Z')).key).toBe('2026-10');
  });

  it('rolls the year over and has a continuous, non-overlapping chain of periods', () => {
    const dec = periodFor(new Date('2026-12-31T19:00:00Z'));
    expect(dec.key).toBe('2026-12');
    const jan = periodFor(dec.resetsAt);
    expect(jan.key).toBe('2027-01');
    expect(jan.startsAt.getTime()).toBe(dec.resetsAt.getTime());
    expect(periodFor(new Date(dec.resetsAt.getTime() - 1)).key).toBe('2026-12');
  });

  it('handles February in a leap and a common year', () => {
    expect(periodFor(new Date('2028-02-29T12:00:00Z')).key).toBe('2028-02');
    expect(periodFor(new Date('2028-02-29T12:00:00Z')).resetsAt.toISOString()).toBe('2028-02-29T20:00:00.000Z');
    expect(periodFor(new Date('2027-02-28T19:59:00Z')).key).toBe('2027-02');
    expect(periodFor(new Date('2027-02-28T20:00:00Z')).key).toBe('2027-03');
  });
});
