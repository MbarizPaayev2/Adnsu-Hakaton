import { describe, expect, it } from 'vitest';
import { refusalMessage } from './refusal';

describe('refusalMessage', () => {
  it('says the monthly allowance is used up, with the Baku reset time, and keeps free actions free', () => {
    const text = refusalMessage({ code: 'ALLOWANCE_EXHAUSTED', resetsAt: '2026-10-31T20:00:00.000Z' });
    expect(text).toContain('limit');
    expect(text).toMatch(/1 noyabr|noyabr/i);
    expect(text).toContain('ödənişsizdir');
  });
  it('describes the short protections as protections that clear by themselves, never as a used-up month or a reason to upgrade', () => {
    for (const refusal of [{ code: 'CONCURRENCY_LIMIT', concurrent: 3 }, { code: 'HOURLY_LIMIT', perHour: 30 }]) {
      const text = refusalMessage(refusal);
      expect(text).toContain('aylıq limit deyil');
      expect(text).not.toMatch(/plan|yüksəld/i);
    }
  });
  it('never invents a reason when the server gave none', () => {
    expect(refusalMessage(null)).toBe('Hazırda sənəd generasiyası başladıla bilmir.');
    expect(refusalMessage({ message: 'Server wording' })).toBe('Server wording');
  });
});
