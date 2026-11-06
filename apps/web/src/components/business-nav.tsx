'use client';

import React from 'react';
import { useNavigationDrawer } from '@/hooks/use-navigation-drawer';
import Link from 'next/link';
import { BrandWordmark } from '@/components/landing/brand-logo';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Menu, X, LayoutDashboard, Briefcase, FileText, Building2, Settings, HeartHandshake, CreditCard } from 'lucide-react';
import { mostSpecificHref } from './dashboard-nav';

interface BusinessNavProps {
  user: any;
  children: React.ReactNode;
}

export default function BusinessNav({ user, children }: BusinessNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { mobileMenuOpen, setMobileMenuOpen, triggerRef, drawerRef } = useNavigationDrawer();


  const navigation = [
    { name: 'Ümumi Baxış', href: '/business/dashboard', icon: LayoutDashboard },
    { name: 'Vakansiyalar', href: '/business/vacancies', icon: Briefcase },
    { name: 'Müraciətlər', href: '/business/applications', icon: FileText },
    { name: 'Könüllülük', href: '/business/volunteering', icon: HeartHandshake },
    { name: 'Tariflər', href: '/business/billing', icon: CreditCard },
    { name: 'Şirkət profili', href: '/business/company', icon: Building2 },
    { name: 'Parametrlər', href: '/business/settings', icon: Settings },
  ];

  const handleSignOut = async () => {
    await fetch('/api/business/auth/logout', { method: 'POST' });
    router.push('/business/login');
  };

  return (
    <div className="workspace-shell flex min-w-0 flex-1 flex-col md:flex-row min-h-screen">
      {/* Mobil Üst Başlıq */}
      <header className="flex h-16 items-center justify-between border-b border-neutral-dark/10 bg-background px-4 md:hidden">
        <Link href="/business/dashboard" className="tap flex items-center">
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

            <p className="workspace-label">İşəgötürən kabineti</p>
            <nav aria-label="İşəgötürən kabineti" className="mt-6 flex flex-1 flex-col space-y-1">
              {navigation.map((item) => {
                const isActive = item.href === mostSpecificHref(pathname, navigation.map((n) => n.href));
                const Icon = item.icon;
            const NavLink = item.href === '/business/billing' || pathname === '/business/billing' ? 'a' : Link;
                return (
                  <NavLink
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
                  </NavLink>
                );
              })}
            </nav>

            <div className="mt-auto border-t border-neutral-dark/10 pt-4">
              <div className="flex items-center gap-3 px-2 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent font-serif font-bold">
                  {user.email ? user.email[0].toUpperCase() : 'B'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutral-dark">{user.email}</p>
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
          <Link href="/business/dashboard" className="tap flex items-center">
            <BrandWordmark className="text-2xl" />
          </Link>
        </div>
        <p className="workspace-label mb-5">İşəgötürən kabineti</p>
        <nav aria-label="İşəgötürən kabineti" className="flex flex-1 flex-col space-y-1">
          {navigation.map((item) => {
            const isActive = item.href === mostSpecificHref(pathname, navigation.map((n) => n.href));
            const Icon = item.icon;
            const NavLink = item.href === '/business/billing' || pathname === '/business/billing' ? 'a' : Link;
            return (
              <NavLink
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
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-neutral-dark/10 pt-4">
          <div className="flex items-center gap-3 px-2 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent font-serif font-bold">
              {user.email ? user.email[0].toUpperCase() : 'B'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-dark">{user.email}</p>
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
