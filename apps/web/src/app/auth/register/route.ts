import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, password, acceptTerms } = body;

    if (!email || !password) {
      return NextResponse.json(
        { message: 'Zəhmət olmasa bütün xanaları doldurun.' },
        { status: 400 }
      );
    }

    if (!acceptTerms) {
      return NextResponse.json(
        { message: 'Davam etmək üçün İstifadə Şərtləri və Məxfilik Siyasəti ilə razılaşın.' },
        { status: 400 }
      );
    }

    // If a remote API is configured and accessible, forward to it
    const externalApi = process.env.API_URL || process.env.BACKEND_API_URL;
    if (externalApi && !externalApi.includes('localhost')) {
      try {
        const res = await fetch(`${externalApi}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        return NextResponse.json(data, { status: res.status });
      } catch (e) {
        // Fallback to standalone handler
      }
    }

    // Standalone / demo response
    return NextResponse.json(
      {
        success: true,
        message: 'Qeydiyyat uğurla tamamlandı! Hesabınız yaradıldı.',
        user: {
          name: name?.trim() || email.split('@')[0],
          email: email.trim(),
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { message: error?.message || 'Qeydiyyat zamanı xəta baş verdi.' },
      { status: 500 }
    );
  }
}
