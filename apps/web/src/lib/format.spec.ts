import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime, formatNumber } from './format';

describe('formatDate', () => {
  it('renders DD.MM.YYYY with zero padding', () => {
    expect(formatDate(new Date(2026, 8, 3))).toBe('03.09.2026');
    expect(formatDate(new Date(2026, 11, 25))).toBe('25.12.2026');
  });

  it('accepts ISO strings and epoch millis', () => {
    expect(formatDate('2026-09-03T14:05:00')).toBe('03.09.2026');
    expect(formatDate(new Date(2026, 0, 1).getTime())).toBe('01.01.2026');
  });

  it('returns an empty string rather than "Invalid Date" for bad input', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('not a date')).toBe('');
  });

  it('does not follow the ambient locale', () => {
    // The whole point of the helper: an en-US runtime must still produce the
    // Azerbaijani order, never "9/3/2026".
    expect(formatDate(new Date(2026, 8, 3))).not.toContain('/');
  });
});

describe('formatDateTime', () => {
  it('appends zero-padded 24-hour time', () => {
    expect(formatDateTime(new Date(2026, 8, 3, 9, 5))).toBe('03.09.2026 09:05');
    expect(formatDateTime(new Date(2026, 8, 3, 20, 2))).toBe('03.09.2026 20:02');
  });

  it('returns an empty string for bad input', () => {
    expect(formatDateTime(null)).toBe('');
  });
});

describe('formatNumber', () => {
  it('groups thousands with a period, not a comma', () => {
    expect(formatNumber(1000)).toBe('1.000');
    expect(formatNumber(1234567)).toBe('1.234.567');
  });

  it('leaves values under a thousand untouched', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
  });
});
