import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authOptions } from './auth';

const signIn = authOptions.callbacks!.signIn!;
const call = (account: object | null, user: Record<string, unknown> = { id: 'g-1', email: 'x@example.com' }) => signIn({ user, account, profile: undefined, credentials: undefined } as never);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); process.env.NEXT_PUBLIC_API_URL = 'https://api.test'; });
afterEach(() => vi.unstubAllGlobals());

describe('Google sign-in callback (the API verifies the ID token; the web tier asserts nothing)', () => {
  it('ordinary credentials sign-in is untouched', async () => {
    expect(await call({ provider: 'credentials' })).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('hands the ID token to the API and carries the API session into the JWT on success', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ user: { id: 'u1', email: 'a@example.com', name: 'Ay' }, sessionToken: 'sess-1' }, 201));
    const user: Record<string, unknown> = { id: 'google-sub', email: 'ignored@example.com' };
    expect(await call({ provider: 'google', id_token: 'tok' }, user)).toBe(true);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.test/auth/google');
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)).toEqual({ idToken: 'tok', acceptTerms: true });
    expect(user).toMatchObject({ id: 'u1', email: 'a@example.com', sessionToken: 'sess-1' }); // the API's identity wins over whatever Google's profile said
    const jwt = await authOptions.callbacks!.jwt!({ token: {}, user: user as never } as never);
    expect(jwt).toMatchObject({ userId: 'u1', sessionToken: 'sess-1' });
  });

  it.each([[409, '/login?error=google_conflict'], [403, '/login?error=google_suspended'], [401, '/login?error=google_failed'], [500, '/login?error=google_failed']])('API answer %s sends the visitor back to /login with a code and creates no session', async (status, target) => {
    vi.mocked(fetch).mockResolvedValue(json({ message: 'x' }, status));
    const user: Record<string, unknown> = { id: 'google-sub' };
    expect(await call({ provider: 'google', id_token: 'tok' }, user)).toBe(target);
    expect(user.sessionToken).toBeUndefined();
  });

  it('a missing ID token, a network failure or a malformed answer is a failed sign-in, never a half-created session', async () => {
    expect(await call({ provider: 'google' })).toBe('/login?error=google_failed');
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    expect(await call({ provider: 'google', id_token: 'tok' })).toBe('/login?error=google_failed');
    vi.mocked(fetch).mockResolvedValue(json({ user: {} }, 201));
    expect(await call({ provider: 'google', id_token: 'tok' })).toBe('/login?error=google_failed');
  });
});
