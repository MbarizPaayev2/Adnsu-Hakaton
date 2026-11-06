import { describe, expect, it } from 'vitest';
import { formatAzDate } from './format-date';

describe('formatAzDate', () => {
  it('uses readable day.month.year dates in the Baku timezone', () => {
    expect(formatAzDate('2026-01-01T00:00:00.000Z')).toBe('01.01.2026');
    expect(formatAzDate('2026-12-31T22:30:00.000Z')).toBe('01.01.2027');
  });

  it('handles invalid date input', () => {
    expect(formatAzDate('invalid')).toBe('—');
  });
});
