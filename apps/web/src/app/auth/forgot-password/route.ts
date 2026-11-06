import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  return NextResponse.json({
    success: true,
    message: 'Şifrə yeniləmə linki e-poçtunuza göndərildi.',
  });
}
