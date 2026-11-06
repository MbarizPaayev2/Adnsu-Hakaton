'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';

/** What the sign-in/registration pages say for each error code NextAuth or our sign-in callback sends back to /login. */
export function authErrorMessage(code: string | null): string | null {
  switch (code) {
    case null: case '': return null;
    case 'google_conflict': return 'Bu e-poçt ünvanı ilə Google girişi birmənalı şəkildə bağlana bilmədi. E-poçt və şifrə ilə daxil olun və ya dəstək ilə əlaqə saxlayın.';
    case 'google_suspended': return 'Hesabınız müvəqqəti dayandırılıb. Dəstək ilə əlaqə saxlayın.';
    case 'google_failed': case 'OAuthSignin': case 'OAuthCallback': case 'OAuthAccountNotLinked': case 'AccessDenied': return 'Google ilə daxil olmaq mümkün olmadı. Yenidən cəhd edin və ya e-poçt və şifrə ilə daxil olun.';
    default: return null;
  }
}

/** "Google ilə davam et", shown only when this deployment has Google sign-in configured (the API says so); otherwise nothing is rendered, never a dead button. */
export function GoogleSignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [offered, setOffered] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/auth/providers`)
      .then((res) => (res.ok ? res.json() : { google: false }))
      .then((data) => alive && setOffered(data?.google === true))
      .catch(() => alive && setOffered(false));
    return () => { alive = false; };
  }, []);
  if (!offered) return null;
  return (
    <div className="mt-6" data-testid="google-sign-in">
      <div className="relative" aria-hidden="true">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-neutral-dark/10" /></div>
        <div className="relative flex justify-center text-xs"><span className="bg-background px-3 text-neutral-dark/60">və ya</span></div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => { setBusy(true); void signIn('google', { callbackUrl }); }}
        className="mt-4 flex min-h-11 w-full items-center justify-center gap-3 rounded-full border border-neutral-dark/20 bg-background px-4 py-2.5 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.6-5.9c-2.1 1.4-4.8 2.3-8 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
        <span>{busy ? 'Google-a yönləndirilir…' : 'Google ilə davam et'}</span>
      </button>
      <p className="mt-3 text-center text-xs text-neutral-dark/60">
        Google ilə davam etməklə <Link href="/terms" className="underline">İstifadə şərtləri</Link> və <Link href="/privacy" className="underline">Məxfilik siyasəti</Link> ilə razılaşırsınız.
      </p>
    </div>
  );
}
