import { createHmac, timingSafeEqual } from 'crypto';

export interface SvixHeaders { id?: string; timestamp?: string; signature?: string }

export class WebhookSignatureError extends Error {
  constructor(readonly reason: 'missing_headers' | 'bad_secret' | 'bad_timestamp' | 'timestamp_out_of_range' | 'no_valid_signature') {
    super(reason);
  }
}

/**
 * Verifies a Svix-signed webhook (the scheme Resend uses): HMAC-SHA256 over
 * `${id}.${timestamp}.${rawBody}` with the base64 key behind `whsec_`, compared
 * in constant time against every `v1,<signature>` in the header. The body must
 * be the exact bytes received.
 */
export function verifySvixSignature(secret: string, headers: SvixHeaders, rawBody: Buffer | string, nowMs = Date.now(), toleranceSeconds = 300): void {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) throw new WebhookSignatureError('missing_headers');
  if (!secret.startsWith('whsec_')) throw new WebhookSignatureError('bad_secret');
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  if (!key.length) throw new WebhookSignatureError('bad_secret');
  if (!/^\d{9,12}$/.test(timestamp)) throw new WebhookSignatureError('bad_timestamp');
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > toleranceSeconds) throw new WebhookSignatureError('timestamp_out_of_range');

  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(rawBody).digest();
  const valid = signature.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!valid) throw new WebhookSignatureError('no_valid_signature');
}

/** Test/fake-provider helper: the headers a correct sender would attach. */
export function signSvix(secret: string, id: string, rawBody: string, timestampSeconds = Math.floor(Date.now() / 1000)): Required<SvixHeaders> {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${timestampSeconds}.${rawBody}`).digest('base64');
  return { id, timestamp: String(timestampSeconds), signature: `v1,${sig}` };
}
