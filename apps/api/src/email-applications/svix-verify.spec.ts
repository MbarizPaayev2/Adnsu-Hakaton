import { signSvix, verifySvixSignature, WebhookSignatureError } from './svix-verify';

const secret = `whsec_${Buffer.from('synthetic-signing-key-0123456789').toString('base64')}`;
const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_1' } });
const now = 1_790_000_000_000;
const reason = (fn: () => void) => { try { fn(); } catch (e) { return (e as WebhookSignatureError).reason; } return 'accepted'; };

describe('Svix webhook signature', () => {
  const headers = signSvix(secret, 'msg_1', body, now / 1000);
  it('accepts the exact signed bytes', () => expect(reason(() => verifySvixSignature(secret, headers, body, now))).toBe('accepted'));
  it('accepts when any of several space-separated signatures matches', () => {
    expect(reason(() => verifySvixSignature(secret, { ...headers, signature: `v1,${Buffer.from('wrong').toString('base64')} ${headers.signature}` }, Buffer.from(body), now))).toBe('accepted');
  });
  it('rejects a changed body, id, timestamp or secret', () => {
    expect(reason(() => verifySvixSignature(secret, headers, body.replace('delivered', 'bounced'), now))).toBe('no_valid_signature');
    expect(reason(() => verifySvixSignature(secret, { ...headers, id: 'msg_2' }, body, now))).toBe('no_valid_signature');
    expect(reason(() => verifySvixSignature(secret, { ...headers, timestamp: String(now / 1000 + 1) }, body, now))).toBe('no_valid_signature');
    expect(reason(() => verifySvixSignature(`whsec_${Buffer.from('another-key').toString('base64')}`, headers, body, now))).toBe('no_valid_signature');
  });
  it('rejects missing headers, a malformed secret and non-v1 schemes', () => {
    expect(reason(() => verifySvixSignature(secret, { ...headers, id: undefined }, body, now))).toBe('missing_headers');
    expect(reason(() => verifySvixSignature('not-a-secret', headers, body, now))).toBe('bad_secret');
    expect(reason(() => verifySvixSignature(secret, { ...headers, signature: headers.signature.replace('v1,', 'v2,') }, body, now))).toBe('no_valid_signature');
  });
  it('rejects replays outside the tolerance window, in either direction', () => {
    expect(reason(() => verifySvixSignature(secret, headers, body, now + 301_000))).toBe('timestamp_out_of_range');
    expect(reason(() => verifySvixSignature(secret, headers, body, now - 301_000))).toBe('timestamp_out_of_range');
    expect(reason(() => verifySvixSignature(secret, { ...headers, timestamp: 'abc' }, body, now))).toBe('bad_timestamp');
  });
});
