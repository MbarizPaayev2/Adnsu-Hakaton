import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ADMIN_SESSION_MAX_AGE, rejectCrossSite } from '@/lib/admin-origin';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/** Second login step: exchanges the challenge cookie + a code for the session cookie. */
export async function POST(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const cookieStore = await cookies();
  const challengeToken = cookieStore.get('admin_mfa_challenge')?.value;
  if (!challengeToken) {
    return NextResponse.json({ message: 'Təsdiq müddəti bitib. Yenidən daxil olun.' }, { status: 401 });
  }
  try {
    const { code } = await request.json();
    const response = await fetch(`${API_URL}/admin/auth/mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': request.headers.get('user-agent') || '' },
      body: JSON.stringify({ challengeToken, code: String(code ?? '') }),
    });
    const data = await response.json();
    if (!response.ok) return NextResponse.json(data, { status: response.status });
    cookieStore.delete({ name: 'admin_mfa_challenge', path: '/api/admin/auth/mfa' });
    cookieStore.set({
      name: 'admin_session',
      value: data.sessionToken,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ADMIN_SESSION_MAX_AGE,
    });
    return NextResponse.json({ success: true, user: data.adminUser });
  } catch {
    return NextResponse.json({ message: 'Gözlənilməz xəta baş verdi.' }, { status: 500 });
  }
}
