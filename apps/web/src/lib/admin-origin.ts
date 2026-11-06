import { NextResponse } from 'next/server';

/**
 * Defence in depth on top of the SameSite=Lax admin cookie: a state-changing
 * admin request must come from this site. Browsers send Origin on
 * cross-site POST/PATCH/DELETE; a mismatch is refused.
 */
export function rejectCrossSite(request: Request): NextResponse | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  try {
    if (host && new URL(origin).host === host) return null;
  } catch {
    // fall through
  }
  return NextResponse.json({ message: 'Sorğu başqa saytdan gəldiyi üçün rədd edildi.' }, { status: 403 });
}

export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 24 * 7; // matches AdminSession's server-side expiry
