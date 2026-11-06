import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    const response = await fetch(`${API_URL}/business/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const { sessionToken, ...businessData } = data;

    if (sessionToken) {
      const cookieStore = await cookies();
      cookieStore.set({
        name: 'business_session',
        value: sessionToken,
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24 * 7, // 1 week
      });
    }

    return NextResponse.json({ success: true, user: businessData });
  } catch (error) {
    return NextResponse.json(
      { message: 'Gözlənilməz xəta baş verdi.' },
      { status: 500 }
    );
  }
}
