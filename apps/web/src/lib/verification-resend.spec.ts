import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  VERIFICATION_RESEND_ACCEPTED_LABEL,
  VERIFICATION_RESEND_FAILED_LABEL,
  performVerificationResend,
  verificationResendLabel,
} from './verification-resend';

describe('performVerificationResend', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('treats HTTP success as an accepted request, not proven mailbox delivery', async () => {
    fetchMock.mockResolvedValue(new Response('{"success":true}', { status: 200 }));

    await expect(
      performVerificationResend({
        apiUrl: 'http://localhost:4000',
        path: '/auth/resend-verification',
        email: 'user@example.com',
      }),
    ).resolves.toBe('accepted');

    expect(verificationResendLabel('accepted')).toBe(VERIFICATION_RESEND_ACCEPTED_LABEL);
    expect(verificationResendLabel('accepted')).not.toContain('göndərildi');
  });

  it('does not report success when the HTTP response is not ok', async () => {
    fetchMock.mockResolvedValue(new Response('error', { status: 500 }));

    await expect(
      performVerificationResend({
        apiUrl: 'http://localhost:4000',
        path: '/auth/resend-verification',
        email: 'user@example.com',
      }),
    ).resolves.toBe('failed');

    expect(verificationResendLabel('failed')).toBe(VERIFICATION_RESEND_FAILED_LABEL);
  });

  it('does not report success when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('network'));

    await expect(
      performVerificationResend({
        apiUrl: 'http://localhost:4000',
        path: '/auth/resend-verification',
        email: 'user@example.com',
      }),
    ).resolves.toBe('failed');
  });
});
