import { describe, it, expect } from 'vitest';
import { DELIVERY, failureText, fromLocalInput, toLocalInput } from './email-application';

describe('e-mail application wording', () => {
  it('never presents provider acceptance as delivery, nor delivery as review', () => {
    expect(DELIVERY.PROVIDER_ACCEPTED.explain).toMatch(/aldığı və ya oxuduğu demək deyil/);
    expect(DELIVERY.PROVIDER_ACCEPTED.label).not.toMatch(/çatdırıldı/i);
    expect(DELIVERY.DELIVERED.explain).toMatch(/oxuduğunu göstərmir/);
    expect(DELIVERY.UNCERTAIN.explain).toMatch(/avtomatik təkrarlamırıq/);
  });
  it('words failures without leaking provider detail', () => {
    expect(failureText('JOB_CLOSED')).toMatch(/bağlandı/);
    expect(failureText('PROVIDER_VALIDATION_ERROR')).toBe('E-poçt xidməti mesajı qəbul etmədi');
    expect(failureText(null)).toBe('');
  });
  it('round-trips a wall-clock time through an IANA zone without guessing offsets', () => {
    expect(fromLocalInput('2026-10-20T10:00', 'Asia/Baku')).toBe('2026-10-20T06:00:00.000Z');
    expect(fromLocalInput('2026-10-20T10:00', 'Europe/London')).toBe('2026-10-20T09:00:00.000Z'); // BST
    expect(fromLocalInput('2026-11-20T10:00', 'Europe/London')).toBe('2026-11-20T10:00:00.000Z');
    expect(toLocalInput('2026-10-20T06:00:00.000Z', 'Asia/Baku')).toBe('2026-10-20T10:00');
    expect(fromLocalInput('not a date', 'Asia/Baku')).toBeNull();
  });
});
