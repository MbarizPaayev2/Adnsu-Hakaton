import { NextRequest, NextResponse } from 'next/server';
import { rejectCrossSite } from '@/lib/admin-origin';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Public (no session): single-use invitation / password-reset links.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') || '';
  const response = await fetch(`${API_URL}/admin/auth/setup?token=${encodeURIComponent(token)}`);
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}

export async function POST(request: NextRequest) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const response = await fetch(`${API_URL}/admin/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await request.text(),
  });
  return NextResponse.json(await response.json().catch(() => ({})), { status: response.status });
}
