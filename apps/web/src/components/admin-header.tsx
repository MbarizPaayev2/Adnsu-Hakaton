'use client';

import Link from 'next/link';
import { BrandLogo } from '@/components/landing/brand-logo';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Activity, Briefcase, Building2, ClipboardCheck, CreditCard, FileText, Globe, Mail, KeyRound, LayoutDashboard, LogOut, ScrollText, Server, UserCog, Users } from 'lucide-react';

export interface AdminMe {
  id: string;
  email: string;
  name: string | null;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT';
  mfaEnabled: boolean;
  permissions: string[];
  environment?: string;
}

export const ROLE_LABELS: Record<AdminMe['role'], string> = {
  SUPER_ADMIN: 'Super-admin',
  ADMIN: 'Admin',
  SUPPORT: 'Dəstək (yalnız baxış)',
};

/** Loads the signed-in operator; an expired session goes back to the login page. */
export function useAdminMe() {
  const router = useRouter();
  const [me, setMe] = useState<AdminMe | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/auth/me')
      .then(async (res) => {
        if (res.status === 401) return router.push('/admin');
        if (res.ok && !cancelled) setMe(await res.json());
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [router]);
  return me;
}

const LINKS = [
  { href: '/admin/overview', label: 'Ümumi baxış', icon: LayoutDashboard, permission: 'ops.read' },
  { href: '/admin/businesses', label: 'Bizneslər', icon: Building2, permission: 'companies.read' },
  { href: '/admin/users', label: 'İstifadəçilər', icon: Users, permission: 'users.read' },
  { href: '/admin/listings', label: 'Elanlar', icon: Briefcase, permission: 'listings.read' },
  { href: '/admin/employer-vacancies', label: 'Vakansiya yoxlaması', icon: ClipboardCheck, permission: 'listings.read' },
  { href: '/admin/employer-purchases', label: 'İşəgötürən ödənişləri', icon: CreditCard, permission: 'companies.read' },
  { href: '/admin/applications', label: 'Müraciətlər', icon: FileText, permission: 'applications.read' },
  { href: '/admin/operations', label: 'Əməliyyatlar', icon: Activity, permission: 'ops.read' },
  { href: '/admin/sources', label: 'Mənbələr', icon: Globe, permission: 'ops.read' },
  { href: '/admin/email', label: 'E-poçt müraciətləri', icon: Mail, permission: 'ops.read' },
  { href: '/admin/audit', label: 'Audit', icon: ScrollText, permission: 'audit.read' },
  { href: '/admin/system', label: 'Sistem', icon: Server, permission: 'ops.read' },
  { href: '/admin/operators', label: 'Operatorlar', icon: UserCog, permission: 'operators.manage' },
  { href: '/admin/account', label: 'Hesabım', icon: KeyRound, permission: 'self' },
];

export function AdminHeader({ me }: { me: AdminMe | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const logout = async () => {
    await fetch('/api/admin/auth/logout', { method: 'POST' }).catch(() => {});
    router.push('/admin');
  };
  return (
    <header className="admin-toolbar bg-background border-b border-neutral-dark/10 py-4 px-6 md:px-10 flex flex-wrap gap-3 items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <div>
          <BrandLogo href="/admin/overview" label="AISE — admin paneli" />
          <p className="text-[10px] uppercase font-bold text-neutral-dark/50 tracking-wider">
            Admin Paneli{me ? ` · ${ROLE_LABELS[me.role]}` : ''}
          </p>
          {me?.environment && (
            <p className={`mt-0.5 inline-block rounded px-1.5 text-[10px] font-bold uppercase ${me.environment === 'production' ? 'bg-red-600 text-white' : 'bg-amber-200 text-amber-900'}`}>
              {me.environment === 'production' ? 'Canlı (production)' : me.environment}
            </p>
          )}
        </div>
      </div>
      <nav aria-label="Admin" className="flex w-full max-w-full items-center gap-1 overflow-x-auto pb-1">
        {LINKS.filter((l) => me?.permissions.includes(l.permission)).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? 'page' : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium px-3.5 py-2.5 rounded-xl transition-colors ${pathname === href ? 'bg-highlight text-primary font-semibold' : 'text-neutral-dark/70 hover:bg-neutral-dark/5'}`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
        <button onClick={logout} className="flex min-h-11 shrink-0 items-center gap-2 text-sm font-medium text-red-600 hover:bg-red-50 px-3.5 py-2.5 rounded-xl transition-colors">
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Çıxış</span>
        </button>
      </nav>
    </header>
  );
}
