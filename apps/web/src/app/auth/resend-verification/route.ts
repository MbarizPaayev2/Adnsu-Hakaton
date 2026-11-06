import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  return NextResponse.json({
    success: true,
    message: 'Təsdiq e-poçtu yenidən göndərildi.',
  });
}
