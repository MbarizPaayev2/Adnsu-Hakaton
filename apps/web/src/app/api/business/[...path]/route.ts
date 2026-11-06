import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// The business session token lives in an httpOnly cookie (set by
// /api/business/auth/login) so client components can't read it themselves to
// attach an Authorization header — and the NestJS BusinessAuthGuard only ever
// reads that header, never cookies. This route is the bridge: client
// components call `/api/business/<path>` instead of hitting the NestJS API
// directly, and this forwards the request there with the cookie's token
// attached as a Bearer header.
async function forward(request: NextRequest, path: string[]) {
  const cookieStore = await cookies();
  const token = cookieStore.get('business_session')?.value;

  if (!token) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
  }

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  if (hasBody) {
    headers.set('Content-Type', request.headers.get('content-type') || 'application/json');
  }

  // fetch() resolves "."/".." segments, which would carry the employer's
  // token to an API route outside /business or /uploads.
  if (path.some((segment) => segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))) {
    return NextResponse.json({ message: 'Invalid path' }, { status: 400 });
  }

  // Employer attachment links live under this same cookie-backed bridge, but
  // the authorized Nest route is /uploads/:filename (not /business/uploads).
  const isUpload = path[0] === 'uploads';
  if (isUpload && (request.method !== 'GET' || path.length !== 2 || !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(path[1]))) {
    return NextResponse.json({ message: 'Invalid attachment path' }, { status: 400 });
  }
  const apiPath = isUpload ? `uploads/${path[1]}` : `business/${path.join('/')}`;
  const response = await fetch(`${API_URL}/${apiPath}${isUpload ? '' : request.nextUrl.search}`, {
    method: request.method,
    headers,
    body: hasBody ? await request.text() : undefined,
  });

  const body = await response.arrayBuffer();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
      ...(response.headers.get('content-disposition') ? { 'Content-Disposition': response.headers.get('content-disposition')! } : {}),
      'Cache-Control': 'no-store',
    },
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
