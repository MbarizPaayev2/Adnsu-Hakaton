import { describe, expect, it } from 'vitest';
import { formatBakuDateTime } from './baku-date';

describe('formatBakuDateTime', () => {
  it('renders Baku wall-clock time with Azerbaijani month names, independent of the browser locale data', () => {
    expect(formatBakuDateTime('2026-10-31T20:00:00.000Z')).toBe('1 noyabr 2026, 00:00');
    expect(formatBakuDateTime('2026-12-31T19:59:00.000Z')).toBe('31 dekabr 2026, 23:59');
    expect(formatBakuDateTime('2027-01-31T20:00:00.000Z', { time: false })).toBe('1 fevral 2027');
  });
  it('returns an empty string for nothing or nonsense rather than a wrong date', () => {
    expect(formatBakuDateTime(null)).toBe('');
    expect(formatBakuDateTime('not a date')).toBe('');
  });
});
