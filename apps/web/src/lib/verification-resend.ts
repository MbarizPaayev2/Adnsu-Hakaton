export type VerificationResendState = 'idle' | 'sending' | 'accepted' | 'failed';

export const VERIFICATION_RESEND_IDLE_LABEL = 'Təsdiq e-poçtunu yenidən göndər';
export const VERIFICATION_RESEND_SENDING_LABEL = 'Göndərilir...';
export const VERIFICATION_RESEND_ACCEPTED_LABEL = 'Sorğu qəbul olundu — gəlməsə yenidən cəhd edin';
export const VERIFICATION_RESEND_FAILED_LABEL = 'Göndərmək mümkün olmadı — yenidən cəhd edin';

export function verificationResendLabel(state: VerificationResendState): string {
  switch (state) {
    case 'sending':
      return VERIFICATION_RESEND_SENDING_LABEL;
    case 'accepted':
      return VERIFICATION_RESEND_ACCEPTED_LABEL;
    case 'failed':
      return VERIFICATION_RESEND_FAILED_LABEL;
    default:
      return VERIFICATION_RESEND_IDLE_LABEL;
  }
}

export async function requestVerificationResend(params: {
  apiUrl: string;
  path: string;
  email: string;
}): Promise<{ ok: boolean }> {
  const res = await fetch(`${params.apiUrl}${params.path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: params.email }),
  });
  return { ok: res.ok };
}

export async function performVerificationResend(params: {
  apiUrl: string;
  path: string;
  email: string;
}): Promise<Exclude<VerificationResendState, 'idle' | 'sending'>> {
  try {
    const { ok } = await requestVerificationResend(params);
    return ok ? 'accepted' : 'failed';
  } catch {
    return 'failed';
  }
}
