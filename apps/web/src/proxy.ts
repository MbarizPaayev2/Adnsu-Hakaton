import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getArticleBySlug } from './lib/blog/articles';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Gate the dashboard behind a completed onboarding wizard. A brand-new user has
// no Profile row (or one that hasn't finished the wizard), so every dashboard
// route except the profile editor itself redirects there until they finish it.
/** The host the visitor asked for: the forwarded host when a proxy sets one, else the Host header, else the URL. Lower case, no port. */
function requestedHost(request: NextRequest): string {
  const raw = request.headers.get('x-forwarded-host')?.split(',')[0] || request.headers.get('host') || request.nextUrl.host;
  return raw.trim().toLowerCase().replace(/:\d+$/, '');
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // One login/callback origin, while leaving Apple's domain verification file available on both registered hosts.
  // The host comes from the request headers: behind the reverse proxy the standalone server builds nextUrl on its own listen address
  // (localhost:3000), so nextUrl.hostname is never "www.aisehr.com" in production.
  if (requestedHost(request) === 'www.aisehr.com' && !pathname.startsWith('/.well-known/')) {
    return NextResponse.redirect(`https://aisehr.com${pathname}${request.nextUrl.search}`, 308);
  }

  // Canonicalize blog aliases and uppercase slugs before SSR to ensure clean, consistent single 308 redirects
  if (pathname.startsWith('/blog/')) {
    const slug = pathname.slice('/blog/'.length);
    if (slug && !slug.includes('/')) {
      const article = getArticleBySlug(slug);
      if (article && slug !== article.slug) {
        const url = request.nextUrl.clone();
        url.pathname = `/blog/${article.slug}`;
        return NextResponse.redirect(url, 308);
      }
    }
  }

  if (!pathname.startsWith('/dashboard')) return NextResponse.next();

  // The wizard itself, plus pages that need no profile: account settings (password, export, deletion), notifications and the free tracker.
  if (ONBOARDING_FREE.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const sessionToken = (token as any)?.sessionToken;

  // No session — let the server-side check in dashboard/layout.tsx redirect to /login.
  if (!sessionToken) {
    return NextResponse.next();
  }

  try {
    const res = await fetch(`${API_URL}/profile`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });

    if (res.ok) {
      const profile = await res.json();
      const isComplete = !!profile?.onboardingCompletedAt;

      if (!isComplete) {
        const url = request.nextUrl.clone();
        url.pathname = '/dashboard/profile';
        // A candidate who paid before finishing onboarding still gets the (verified) plan confirmation on the onboarding screen.
        const returned = request.nextUrl.searchParams.get('checkout') === 'success';
        url.search = `onboarding=true${returned ? '&checkout=success' : ''}${returned && request.nextUrl.searchParams.get('mock') === '1' ? '&mock=1' : ''}`;
        // Says on the wizard which page the candidate was trying to open, instead of a silent bounce.
        if (pathname !== '/dashboard') url.searchParams.set('from', pathname);
        return NextResponse.redirect(url);
      }
    }
  } catch {
    // If the API is unreachable, don't block navigation on this check —
    // fail open rather than lock users out of the whole dashboard.
  }

  return NextResponse.next();
}

const ONBOARDING_FREE = ['/dashboard/profile', '/dashboard/settings', '/dashboard/notifications', '/dashboard/applications/tracker'];

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|\\.well-known/).*)'],
};
