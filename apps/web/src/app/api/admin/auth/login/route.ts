import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ADMIN_SESSION_MAX_AGE, rejectCrossSite } from '@/lib/admin-origin';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Same bridge pattern as api/business/auth/login/route.ts: tokens live in
// httpOnly cookies, never in JS-readable storage. With MFA enrolled the API
// returns a short-lived challenge instead of a session; that challenge is
// also kept in an httpOnly cookie, scoped to the MFA route.
export async function POST(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  try {
    const body = await request.json();
    const response = await fetch(`${API_URL}/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': request.headers.get('user-agent') || '' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const cookieStore = await cookies();
    if (data.mfaRequired && data.challengeToken) {
      cookieStore.set({
        name: 'admin_mfa_challenge',
        value: data.challengeToken,
        httpOnly: true,
        path: '/api/admin/auth/mfa',
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 5 * 60,
      });
      return NextResponse.json({ mfaRequired: true });
    }

    const { sessionToken, ...adminData } = data;
    if (sessionToken) {
      cookieStore.set({
        name: 'admin_session',
        value: sessionToken,
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: ADMIN_SESSION_MAX_AGE,
      });
    }
    return NextResponse.json({ success: true, user: adminData.adminUser ?? adminData });
  } catch {
    return NextResponse.json({ message: 'Gözlənilməz xəta baş verdi.' }, { status: 500 });
  }
}
