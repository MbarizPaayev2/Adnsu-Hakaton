import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface GoogleProfile { sub: string; email: string; name: string | null }

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * Verifies a Google ID token ON THE API (signature against Google's published keys, issuer, audience = our client id, expiry), so the identity never rests on
 * what the web tier says. Only a verified e-mail counts. The client id is public; no secret is needed to verify. Disabled (503) unless GOOGLE_CLIENT_ID is set.
 */
@Injectable()
export class GoogleIdentityService {
  private keys: JWTVerifyGetKey | undefined;

  clientId(): string | undefined { return process.env.GOOGLE_CLIENT_ID?.trim() || undefined; }
  enabled(): boolean { return !!this.clientId(); }

  /** Tests inject their own key set; production uses Google's remote JWKS (cached by jose). */
  useKeys(keys: JWTVerifyGetKey): void { this.keys = keys; }

  async verify(idToken: string): Promise<GoogleProfile> {
    const audience = this.clientId();
    if (!audience) throw new ServiceUnavailableException('Google ilə daxil olma hazırda aktiv deyil');
    this.keys ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(idToken, this.keys, { issuer: GOOGLE_ISSUERS, audience, algorithms: ['RS256'], clockTolerance: 30 }));
    } catch {
      throw new UnauthorizedException('Google ilə daxil olmaq mümkün olmadı');
    }
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    // An unverified Google e-mail proves nothing about who owns the address: never accepted.
    if (!sub || !email || payload.email_verified !== true) throw new UnauthorizedException('Google e-poçt ünvanınız təsdiqlənməyib');
    return { sub, email, name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 120) : null };
  }
}
