import React from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import BusinessNav from '@/components/business-nav';
import type { Metadata } from 'next';

/** Signed-in employer area: never indexed. */
export const metadata: Metadata = {
  title: 'Şirkət paneli — AISE',
  robots: { index: false, follow: false },
};

export default async function BusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get('business_session')?.value;

  if (!token) {
    redirect('/business/login');
  }

  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/business/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  }).catch(() => null);

  // A cookie can outlive the session it points at (expired/revoked
  // server-side, e.g. after a password change signs out other sessions).
  // Falling back to a placeholder user and rendering the shell anyway meant
  // every page under here appeared to load normally with fake data instead
  // of sending an unauthenticated visitor back to the login page — data
  // itself stays gated by BusinessAuthGuard on the API, but the UI shouldn't
  // pretend a dead session is a live one.
  if (!res || !res.ok) {
    redirect('/business/login');
  }
  const user = await res.json();

  return (
    <div className="flex min-h-screen bg-background-warm">
      <BusinessNav user={user}>
        {children}
      </BusinessNav>
    </div>
  );
}
