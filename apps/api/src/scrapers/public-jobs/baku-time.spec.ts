import { azMonthNumber, bakuInstant, inferDeadlineFromDayMonth, inferPublishedFromDayMonth } from './baku-time';

describe('Baku calendar time (UTC+4, no DST)', () => {
  it('a date-only start is the start of that day in Baku, a date-only deadline the END of that day', () => {
    expect(bakuInstant('2026-10-30', 'start')).toBe('2026-10-29T20:00:00.000Z');
    expect(bakuInstant('2026-10-30', 'end')).toBe('2026-10-30T19:59:59.999Z');
  });
  it('a deadline date is still open late on its own last day in Baku', () => {
    const deadline = new Date(bakuInstant('2026-10-30', 'end')!);
    expect(deadline.getTime() > new Date('2026-10-30T18:00:00Z').getTime()).toBe(true); // 22:00 Baku
    expect(deadline.getTime() < new Date('2026-10-30T20:00:00Z').getTime()).toBe(true); // midnight Baku
  });
  it('a zone-less date-time is Baku local time regardless of the machine zone; explicit zones are respected', () => {
    expect(bakuInstant('2027-02-27T00:00')).toBe('2027-02-26T20:00:00.000Z');
    expect(bakuInstant('2026-10-03T12:00:00Z')).toBe('2026-10-03T12:00:00.000Z');
    expect(bakuInstant('2026-10-03T12:00:00+04:00')).toBe('2026-10-03T08:00:00.000Z');
  });
  it('unknown stays unknown: impossible or unreadable dates are undefined', () => {
    for (const bad of ['', null, undefined, '2026-02-30', '2026-13-01', '03-10-2026', '2026/10/03', 'tomorrow', '2026-10-03T25:00', '2019-01-01']) expect(bakuInstant(bad as string)).toBeUndefined();
  });
  it('reads Azerbaijani month names with or without diacritics', () => {
    expect([azMonthNumber('Oktyabr'), azMonthNumber('noyabr'), azMonthNumber('İyun'), azMonthNumber('Dekabr'), azMonthNumber('Foo')]).toEqual([10, 11, 6, 12, undefined]);
  });
  const now = new Date('2026-10-03T12:00:00Z');
  it('a publication day/month never lies in the future and is the most recent such date', () => {
    expect(inferPublishedFromDayMonth(3, 10, now)).toBe('2026-10-02T20:00:00.000Z');
    expect(inferPublishedFromDayMonth(28, 9, now)).toBe('2026-09-27T20:00:00.000Z');
    expect(inferPublishedFromDayMonth(20, 12, now)).toBe('2025-12-19T20:00:00.000Z'); // December cannot be in the future: last year
    expect(inferPublishedFromDayMonth(30, 2, now)).toBeUndefined();
  });
  it('a publication older than a year is not recent evidence', () => {
    expect(inferPublishedFromDayMonth(1, 10, new Date('2026-10-03T12:00:00Z'))).toBe('2026-09-30T20:00:00.000Z');
    expect(inferPublishedFromDayMonth(1, 9, new Date('2027-10-03T12:00:00Z'))).toBe('2027-08-31T20:00:00.000Z');
  });
  it('a deadline day/month is the first such day on or after publication, end of day in Baku (crossing the year)', () => {
    expect(inferDeadlineFromDayMonth(3, 11, '2026-10-02T20:00:00.000Z')).toBe('2026-11-03T19:59:59.999Z');
    expect(inferDeadlineFromDayMonth(15, 1, '2026-12-20T20:00:00.000Z')).toBe('2027-01-15T19:59:59.999Z');
  });
});
