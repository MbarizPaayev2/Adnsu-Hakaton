import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

// RFC 6238 TOTP (HMAC-SHA1, 30 s steps, 6 digits) over RFC 4648 base32 —
// the profile every mainstream authenticator app supports. Verified against
// the RFC 6238 appendix B test vectors in mfa.util.spec.ts.

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpAt(secret: Buffer, step: number, digits = 6, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac(algorithm, secret).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

/**
 * Returns the matching time step (current ±1 for clock drift) or null.
 * Steps at or before `lastUsedStep` are refused so a code works only once.
 */
export function verifyTotp(secret: Buffer, code: string, lastUsedStep: number | null, now = Date.now()): number | null {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (const candidate of [step - 1, step, step + 1]) {
    if (lastUsedStep !== null && candidate <= lastUsedStep) continue;
    const expected = Buffer.from(totpAt(secret, candidate));
    if (timingSafeEqual(expected, Buffer.from(code))) return candidate;
  }
  return null;
}

export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

export function otpauthUri(secret: Buffer, account: string, issuer = 'AISE Admin'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}

/** 32-byte key from ADMIN_MFA_ENCRYPTION_KEY (base64). Null when not configured. */
export function mfaKey(): Buffer | null {
  const raw = process.env.ADMIN_MFA_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function encryptSecret(secret: Buffer, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

export function decryptSecret(sealed: string, key: Buffer): Buffer {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('unsupported secret format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Ten single-use recovery codes like "k7q2-9xfm-t3ha" (≈60 bits each). */
export function newRecoveryCodes(count = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(12);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, '');
}
