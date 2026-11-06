import React from 'react';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import DashboardNav from '@/components/dashboard-nav';
import { apiFetch } from '@/lib/api';
import type { Metadata } from 'next';

/**
 * Signed-in area: never indexed. The live robots.txt was Cloudflare's managed
 * default (Allow: /), so the dashboard and /admin were both crawlable.
 */
export const metadata: Metadata = {
  title: 'Panel — AISE',
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  // Fetch unread notifications count
  const notificationsRes = await apiFetch('/notifications');
  const notifications = notificationsRes.ok ? await notificationsRes.json() : [];
  const unreadNotificationsCount = notifications.filter((n: { read: boolean }) => !n.read).length;

  // The Agent entry appears only where the browser agent is actually switched on.
  const agentRes = await apiFetch('/agent/capabilities').catch(() => null);
  const agentEnabled = !!agentRes && agentRes.ok && (await agentRes.json().catch(() => null))?.enabled === true;

  return (
    <div className="flex min-h-screen bg-background-warm">
      {/* Pass unread count directly, navigation config will live in the client component */}
      <DashboardNav unreadNotificationsCount={unreadNotificationsCount} agentEnabled={agentEnabled} user={session.user}>
        {children}
      </DashboardNav>
    </div>
  );
}
