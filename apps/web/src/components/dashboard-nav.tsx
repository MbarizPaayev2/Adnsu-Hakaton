'use client';

import React from 'react';
import { useNavigationDrawer } from '@/hooks/use-navigation-drawer';
import Link from 'next/link';
import { BrandWordmark } from '@/components/landing/brand-logo';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { LogOut, Menu, X, Bell, Briefcase, FileText, LayoutDashboard, Settings, Sparkles, User, Building2, Send, HeartHandshake, Bookmark, Bot, BookOpen } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface DashboardNavProps {
  unreadNotificationsCount: number;
  agentEnabled?: boolean;
  user: any;
  children: React.ReactNode;
}

export default function DashboardNav({ unreadNotificationsCount, agentEnabled = false, user: initialUser, children }: DashboardNavProps) {
  const pathname = usePathname();
  const { mobileMenuOpen, setMobileMenuOpen, triggerRef, drawerRef } = useNavigationDrawer();

  // dashboard/layout.tsx (a Server Component that doesn't remount on nested
  // navigation) only supplies `user` from the JWT at the time that layout
  // last rendered. Preferring the live client session here means an edited
  // display name (see ProfileEditor/OnboardingWizard's useSession().update()
  // call) shows up in this badge right away instead of needing a full
  // reload of the whole dashboard shell.
  const { data: session } = useSession();
  const user = session?.user ?? initialUser;

  const navigation = [
    { name: 'Ümumi baxış', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Bütün vakansiyalar', href: '/jobs', icon: Briefcase },
    { name: 'Uyğunluqlar', href: '/dashboard/matches', icon: Sparkles },
    { name: 'Saxlananlar', href: '/dashboard/saved', icon: Bookmark },
    { name: 'Şirkətlər', href: '/dashboard/companies', icon: Building2 },
    { name: 'Profilim', href: '/dashboard/profile', icon: User },
    { name: 'CV-lər', href: '/dashboard/resumes', icon: FileText },
    { name: 'Karyera bələdçisi', href: '/blog', icon: BookOpen },
    { name: 'Müraciətlərim', href: '/dashboard/applications', icon: Send },
    { name: 'E-poçt müraciətləri', href: '/dashboard/email-applications', icon: Bot },
    { name: 'Müraciət cədvəlim', href: '/dashboard/applications/tracker', icon: FileText },
    ...(agentEnabled ? [{ name: 'Brauzer köməkçisi', href: '/dashboard/agent', icon: Bot }] : []),
    { name: 'Könüllülük', href: '/dashboard/volunteering', icon: HeartHandshake },
    { 
      name: 'Bildirişlər', 
      href: '/dashboard/notifications', 
      icon: Bell,
      badge: unreadNotificationsCount > 0 ? unreadNotificationsCount : undefined 
    },
    { name: 'Parametrlər', href: '/dashboard/settings', icon: Settings },
  ];

  const handleSignOut = async () => {
    // Delete the API-side session row first — next-auth's signOut only clears the
    // local JWT cookie, it doesn't know about our separate Bearer-token session.
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    // Onboarding drafts are namespaced per user id (see OnboardingWizard),
    // which is what actually stops one account's draft PII from bleeding
    // into another account on a shared device — this is just hygiene on top
    // of that, so a finished session doesn't leave PII sitting in storage.
    try {
      const userId = (session?.user as any)?.id as string | undefined;
      if (userId) localStorage.removeItem(`aise-onboarding-draft-v2:${userId}`);
    } catch {
      // non-fatal
    }
    signOut({ callbackUrl: '/login' });
  };

  return (
    <div className="workspace-shell flex min-w-0 flex-1 flex-col md:flex-row min-h-screen">
      {/* Mobil Üst Başlıq */}
      <header className="flex h-16 items-center justify-between border-b border-neutral-dark/10 bg-background px-4 md:hidden">
        <Link href="/dashboard" className="tap flex items-center">
          <BrandWordmark className="text-2xl" />
        </Link>
        <button
          type="button"
          ref={triggerRef}
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Menyunu aç"
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-menu"
          className="rounded-lg p-2.5 text-neutral-dark hover:bg-neutral-dark/5"
        >
          <Menu aria-hidden="true" className="h-6 w-6" />
        </button>
      </header>

      {/* Mobil Menyu Drawer */}
      {mobileMenuOpen && (
        <div className="relative z-50 md:hidden">
          {/* Arxa Fon */}
          <div 
            className="fixed inset-0 bg-neutral-dark/30 backdrop-blur-xs transition-opacity" 
            onClick={() => setMobileMenuOpen(false)}
          />

          <div ref={drawerRef} id="mobile-menu" role="dialog" aria-modal="true" aria-label="Menyu" className="workspace-sidebar fixed inset-y-0 left-0 flex w-full max-w-xs flex-col bg-background border-r border-neutral-dark/10 p-6 shadow-xl animate-in slide-in-from-left duration-200 motion-reduce:animate-none">
            <div className="flex items-center justify-between">
              <BrandWordmark className="text-2xl" />
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Menyunu bağla"
                autoFocus
                className="rounded-lg p-2.5 text-neutral-dark hover:bg-neutral-dark/5"
              >
                <X aria-hidden="true" className="h-6 w-6" />
              </button>
            </div>

            <p className="workspace-label">Şəxsi kabinet</p>
            <nav aria-label="Şəxsi kabinet" className="mt-6 flex flex-1 flex-col space-y-1">
              {navigation.map((item, _i, all) => {
                const activeHref = mostSpecificHref(pathname, all.map((n) => n.href));
                const isActive = item.href === activeHref;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-highlight text-primary'
                        : 'text-neutral-dark hover:bg-primary/10'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 shrink-0" />
                      <span>{item.name}</span>
                    </div>
                    {item.badge !== undefined && (
                      <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${isActive ? 'bg-white text-primary' : 'bg-accent text-white'}`}>
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto border-t border-neutral-dark/10 pt-4">
              <div className="flex items-center gap-3 px-2 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent font-serif font-bold">
                  {user.name ? user.name[0].toUpperCase() : user.email[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutral-dark">{user.name || user.email.split('@')[0]}</p>
                  <p className="truncate text-xs text-neutral-dark/65">{user.email}</p>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="mt-2 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-5 w-5 shrink-0" />
                <span>Çıxış</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Masaüstü Yan Panel (Sidebar) */}
      <aside className="workspace-sidebar hidden md:flex md:w-64 md:flex-col bg-background border-r border-neutral-dark/10 p-6 min-h-screen">
        <div className="mb-2">
          <Link href="/dashboard" className="tap flex items-center">
            <BrandWordmark className="text-2xl" />
          </Link>
        </div>
        <p className="workspace-label mb-5">Şəxsi kabinet</p>
        <nav aria-label="Şəxsi kabinet" className="flex flex-1 flex-col space-y-1">
          {navigation.map((item, _i, all) => {
            const activeHref = mostSpecificHref(pathname, all.map((n) => n.href));
            const isActive = item.href === activeHref;
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-highlight text-primary'
                    : 'text-neutral-dark hover:bg-primary/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5 shrink-0" />
                  <span>{item.name}</span>
                </div>
                {item.badge !== undefined && (
                  <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${isActive ? 'bg-white text-primary' : 'bg-accent text-white'}`}>
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-neutral-dark/10 pt-4">
          <div className="flex items-center gap-3 px-2 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent font-serif font-bold">
              {user.name ? user.name[0].toUpperCase() : user.email[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-dark">{user.name || user.email.split('@')[0]}</p>
              <p className="truncate text-xs text-neutral-dark/65">{user.email}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="mt-2 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            <span>Çıxış</span>
          </button>
        </div>
      </aside>

      {/* Əsas Məzmun Sahəsi */}
      <main className="workspace-main min-w-0 flex-1 p-4 sm:p-6 md:p-10 overflow-y-auto max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}

/** The one nav item for this page: the longest href that matches, so a nested page (the tracker under applications) does not light up its parent too. */
export function mostSpecificHref(pathname: string, hrefs: string[]): string | null {
  const roots = new Set(['/dashboard', '/business/dashboard']);
  const matches = hrefs.filter((h) => pathname === h || (!roots.has(h) && pathname.startsWith(`${h}/`)));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}
