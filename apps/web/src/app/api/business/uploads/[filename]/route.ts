import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Same bridge as api/business/[...path]/route.ts, for /uploads/:filename
// specifically: that route only ever forwards to {API_URL}/business/*, and
// /uploads isn't under that prefix. GET /uploads/:filename now requires a
// session (see apps/api's AnySessionGuard), which a plain <img src>/<a
// href> pointed at the API can't carry — this attaches the business
// session's bearer token server-side and streams the bytes back.
export async function GET(request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('business_session')?.value;

  if (!token) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
  }

  const { filename } = await params;
  const response = await fetch(`${API_URL}/uploads/${encodeURIComponent(filename)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const body = await response.arrayBuffer();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
      'Content-Disposition': response.headers.get('content-disposition') || 'attachment',
    },
  });
}
