import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ message: 'E-poçt və şifrə tələb olunur' }, { status: 400 });
    }

    const externalApi = process.env.API_URL || process.env.BACKEND_API_URL;
    if (externalApi && !externalApi.includes('localhost')) {
      try {
        const res = await fetch(`${externalApi}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        return NextResponse.json(data, { status: res.status });
      } catch (e) {
        // Fallback below
      }
    }

    const name = email.split('@')[0];
    const formattedName = name.charAt(0).toUpperCase() + name.slice(1);

    return NextResponse.json({
      user: {
        id: 'usr_' + Buffer.from(email).toString('hex').slice(0, 12),
        email,
        name: formattedName,
      },
      sessionToken: 'demo_session_' + Date.now(),
    });
  } catch (err: any) {
    return NextResponse.json({ message: err?.message || 'Xəta baş verdi' }, { status: 500 });
  }
}
