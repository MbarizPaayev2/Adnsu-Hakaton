import { base32Decode, base32Encode, decryptSecret, encryptSecret, newRecoveryCodes, otpauthUri, totpAt, verifyTotp } from './mfa.util';

describe('TOTP (RFC 6238)', () => {
  const secret = Buffer.from('12345678901234567890');

  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches the RFC 6238 appendix B SHA-1 vector at T=%s', (t, expected) => {
    expect(totpAt(secret, Math.floor(t / 30), 8)).toBe(expected);
  });

  it('round-trips RFC 4648 base32', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
  });

  it('accepts the current code and ±1 step, never a code at or before the last used step', () => {
    const now = 1_790_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = totpAt(secret, step);
    expect(verifyTotp(secret, code, null, now)).toBe(step);
    expect(verifyTotp(secret, code, step, now)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), null, now)).toBeNull();
    expect(verifyTotp(secret, '12345', null, now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
  });

  it('encrypts the secret with AES-256-GCM and rejects tampering or the wrong key', () => {
    const key = Buffer.alloc(32, 7);
    const sealed = encryptSecret(secret, key);
    expect(sealed).not.toContain(base32Encode(secret));
    expect(decryptSecret(sealed, key).equals(secret)).toBe(true);
    expect(() => decryptSecret(sealed, Buffer.alloc(32, 8))).toThrow();
    const [v, iv, tag, body] = sealed.split('.');
    expect(() => decryptSecret([v, iv, tag, Buffer.from('x').toString('base64') + body.slice(4)].join('.'), key)).toThrow();
  });

  it('builds a standard otpauth URI and distinct recovery codes', () => {
    expect(otpauthUri(secret, 'ceo@aisehr.com')).toMatch(/^otpauth:\/\/totp\/AISE%20Admin%3Aceo%40aisehr\.com\?secret=[A-Z2-7]+&issuer=AISE%20Admin&algorithm=SHA1&digits=6&period=30$/);
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  });
});
