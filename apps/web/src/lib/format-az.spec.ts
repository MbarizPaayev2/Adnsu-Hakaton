import { describe, it, expect } from 'vitest';
import { formatInterview } from './format-az';

describe('Azerbaijani interview date', () => {
  it('names the day and month in Azerbaijani and keeps the stated zone and actual instant', () => {
    expect(formatInterview('2026-10-20T06:00:00.000Z', 'Asia/Baku')).toBe('20 oktyabr 2026, çərşənbə axşamı, 10:00 (Asia/Baku)');
    expect(formatInterview('2026-10-20T06:00:00.000Z', 'Europe/London')).toBe('20 oktyabr 2026, çərşənbə axşamı, 07:00 (Europe/London)');
    expect(formatInterview('2026-12-31T21:30:00.000Z', 'Asia/Baku')).toBe('1 yanvar 2027, cümə, 01:30 (Asia/Baku)');
  });
});
