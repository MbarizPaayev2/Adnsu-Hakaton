import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { rejectCrossSite } from '@/lib/admin-origin';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Same bridge as api/business/[...path]/route.ts: the admin session token
// lives in an httpOnly cookie (set by api/admin/auth/login/route.ts) so
// client components can't read it to attach an Authorization header
// themselves, and NestJS's AdminSessionGuard only ever reads that header,
// never cookies. Admin pages call `/api/admin/<path>` instead of hitting the
// NestJS API directly; this forwards the request with the cookie's token
// attached as a Bearer header. auth/login and auth/logout have their own
// dedicated routes (they need to set/clear the cookie itself) and are never
// reached through this catch-all.
async function forward(request: NextRequest, path: string[]) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_session')?.value;

  if (!token) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
  }

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  if (hasBody) {
    headers.set('Content-Type', request.headers.get('content-type') || 'application/json');
  }

  const response = await fetch(`${API_URL}/admin/${path.join('/')}${request.nextUrl.search}`, {
    method: request.method,
    headers,
    body: hasBody ? await request.text() : undefined,
  });

  // Streamed straight through (not buffered via arrayBuffer()) so a chunked
  // response — e.g. the deploy/restart endpoint's live progress lines —
  // reaches the browser as it's written, instead of only after the whole
  // thing finishes. Behaves identically to before for an ordinary JSON body.
  return new NextResponse(response.body, {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  return forward(request, (await params).path);
}
export async function POST(request: NextRequest, { params }: RouteContext) {
  return forward(request, (await params).path);
}
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  return forward(request, (await params).path);
}
export async function PUT(request: NextRequest, { params }: RouteContext) {
  return forward(request, (await params).path);
}
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  return forward(request, (await params).path);
}
