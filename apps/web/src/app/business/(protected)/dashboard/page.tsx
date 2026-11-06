import React from 'react';
import Link from 'next/link';
import {
  Clock,
  AlertTriangle,
  Briefcase,
  Play,
  Pause,
  FileText,
  Plus,
  ArrowRight,
  Building2,
  Calendar,
  Users,
} from 'lucide-react';
import { businessApiFetch } from '@/lib/business-api';
import { formatDate } from '@/lib/format';
import type { PlansOverview } from '@/lib/business-plans';
import { PlanSummary } from '@/components/business/plan-summary';

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  APPLIED: { label: 'Müraciət etdi', bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200' },
  REVIEWING: { label: 'Nəzərdən keçirilir', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
  INTERVIEW: { label: 'Müsahibə', bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-200' },
  HIRED: { label: 'Qəbul edildi', bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200' },
  REJECTED: { label: 'Rədd edildi', bg: 'bg-neutral-100', text: 'text-neutral-700', border: 'border-neutral-200' },
};

export default async function BusinessDashboardPage() {
  const [companyRes, appsRes, vacsRes, plansRes] = await Promise.all([
    businessApiFetch('/business/company').catch(() => null),
    businessApiFetch('/business/applications').catch(() => null),
    businessApiFetch('/business/vacancies').catch(() => null),
    businessApiFetch('/business/plans').catch(() => null),
  ]);

  const company = companyRes && companyRes.ok ? await companyRes.json() : null;
  const recentApps: any[] | null = appsRes && appsRes.ok ? await appsRes.json() : null;
  const vacancies: any[] | null = vacsRes && vacsRes.ok ? await vacsRes.json() : null;
  // Employer plans as the server states them; null when plans are off or unreadable (the card then simply does not appear).
  const plans: PlansOverview | null = plansRes && plansRes.ok ? await plansRes.json().catch(() => null) : null;

  if (!company) {
    return (
      <div className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-8 sm:p-12 text-center shadow-xs max-w-xl mx-auto my-12">
        <AlertTriangle className="mx-auto h-12 w-12 text-amber-600 mb-4" />
        <h2 className="font-serif text-2xl font-bold text-neutral-dark mb-2">Şirkət məlumatı əldə edilmədi</h2>
        <p className="text-sm text-neutral-dark/70 mb-6">
          Şirkət profilini yükləmək mümkün olmadı. Zəhmət olmasa internet bağlantısını yoxlayıb yenidən cəhd edin.
        </p>
        <Link
          href="/business/dashboard"
          className="inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all"
        >
          Yenidən yoxla
        </Link>
      </div>
    );
  }

  if (company.status === 'PENDING') {
    return (
      <div className="space-y-6 animate-in fade-in duration-500 max-w-3xl mx-auto">
        <header className="workspace-welcome">
          <p className="workspace-eyebrow">HESAB TƏSDİQİ GÖZLƏNİLİR</p>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-neutral-dark">
            Xoş gəldiniz, {company.name}
          </h1>
          <p className="mt-3 text-sm md:text-base text-on-dark/80">
            Hesabınız hazırda AISE komandası tərəfindən nəzərdən keçirilir.
          </p>
        </header>

        <div className="product-card rounded-2xl bg-amber-50/70 border border-amber-200/80 p-8 text-center shadow-xs">
          <Clock className="mx-auto h-12 w-12 text-amber-600 mb-4" />
          <h2 className="font-serif text-2xl font-bold text-amber-950 mb-2">Hesabınız yoxlanılır</h2>
          <p className="text-sm md:text-base text-amber-900/85 max-w-lg mx-auto mb-6">
            Keyfiyyət və təhlükəsizlik standartlarımıza uyğun olaraq, şirkət qeydiyyatları 24-48 saat ərzində təsdiqlənir.
            Təsdiqdən dərhal sonra vakansiya yerləşdirmək və namizəd müraciətlərini qəbul etmək aktiv olacaq.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/business/company"
              className="tap inline-flex items-center gap-2 rounded-xl bg-background border border-neutral-dark/20 py-2.5 px-4 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all"
            >
              Şirkət profilinə bax
            </Link>
            <Link
              href="/contact"
              className="tap inline-flex items-center gap-2 rounded-xl bg-background border border-neutral-dark/20 py-2.5 px-4 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all"
            >
              Dəstək ilə əlaqə
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (company.status === 'REJECTED') {
    return (
      <div className="space-y-6 animate-in fade-in duration-500 max-w-3xl mx-auto">
        <header className="workspace-welcome">
          <p className="workspace-eyebrow">QEYDİYYAT STATUSU</p>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-neutral-dark">
            {company.name}
          </h1>
          <p className="mt-3 text-sm md:text-base text-on-dark/80">
            Qeydiyyat müraciətiniz təsdiqlənmədi.
          </p>
        </header>

        <div className="product-card rounded-2xl bg-red-50/70 border border-red-200/80 p-8 text-center shadow-xs">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-600 mb-4" />
          <h2 className="font-serif text-2xl font-bold text-red-950 mb-2">Müraciət təsdiqlənmədi</h2>
          <p className="text-sm md:text-base text-red-900/85 max-w-lg mx-auto mb-6">
            {company.rejectionReason || 'Qeydiyyat standartlarımıza uyğun gəlmədiyi üçün müraciətiniz təsdiqlənmədi.'}
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all"
          >
            Dəstək xidmətinə müraciət edin
          </Link>
        </div>
      </div>
    );
  }

  // Approved dashboard (a suspended company keeps read access but cannot post, and its vacancies are not public)
  const suspended = company.status === 'SUSPENDED';
  const activeVacancies = Array.isArray(vacancies) ? vacancies.filter((v: any) => v.status === 'ACTIVE').length : null;
  const pausedVacancies = Array.isArray(vacancies) ? vacancies.filter((v: any) => v.status === 'PAUSED').length : null;
  const totalVacancies = Array.isArray(vacancies) ? vacancies.length : null;
  const totalApps = Array.isArray(recentApps) ? recentApps.length : null;

  const stats = [
    {
      name: 'Cəmi vakansiyalar',
      value: totalVacancies !== null ? totalVacancies : '—',
      icon: Briefcase,
      color: 'text-neutral-dark bg-neutral-dark/10',
      href: '/business/vacancies',
    },
    {
      name: 'Aktiv vakansiyalar',
      value: activeVacancies !== null ? activeVacancies : '—',
      icon: Play,
      color: 'text-primary bg-primary/10',
      href: '/business/vacancies',
    },
    {
      name: 'Dayandırılmış vakansiyalar',
      value: pausedVacancies !== null ? pausedVacancies : '—',
      icon: Pause,
      color: 'text-amber-800 bg-amber-100',
      href: '/business/vacancies',
    },
    {
      name: 'Daxil olan müraciətlər',
      value: totalApps !== null ? totalApps : '—',
      icon: FileText,
      color: 'text-accent bg-accent/15',
      href: '/business/applications',
    },
  ];

  const recentList = Array.isArray(recentApps) ? recentApps.slice(0, 5) : [];
  const activeList = Array.isArray(vacancies) ? vacancies.filter((v: any) => v.status === 'ACTIVE').slice(0, 4) : [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="workspace-welcome">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="workspace-eyebrow">İŞƏGÖTÜRƏN KABİNETİ</p>
            <h1 className="font-serif text-3xl md:text-4xl font-bold text-neutral-dark">
              Xoş gəldiniz, {company.name}
            </h1>
            <p className="mt-2 text-sm md:text-base text-on-dark/80">
              Vakansiyalarınızı və daxil olan müraciətləri birbaşa idarə edin.
            </p>
          </div>
          {!suspended && (
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/business/vacancies/new"
                className="inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-5 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all"
              >
                <Plus className="h-4 w-4" />
                Vakansiya yerləşdir
              </Link>
            </div>
          )}
        </div>
      </header>

      {suspended && (
        <div role="alert" className="rounded-2xl bg-red-50/80 border border-red-200 p-5 flex items-start gap-3 text-sm text-red-900">
          <AlertTriangle className="h-5 w-5 text-red-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Hesabınız müvəqqəti dayandırılıb</p>
            <p className="mt-1 text-red-900/85">
              Vakansiyalarınız ictimai siyahıda göstərilmir, yeni vakansiya yerləşdirmək və yeni müraciət qəbul etmək mümkün deyil.
              Mövcud müraciətlərə baxa bilərsiniz. Səbəb və bərpa üçün dəstək ilə əlaqə saxlayın.
            </p>
            <Link href="/contact" className="mt-2 inline-block font-semibold underline">Dəstək ilə əlaqə</Link>
          </div>
        </div>
      )}

      {!suspended && <PlanSummary overview={plans} />}

      {/* Authoritative Stats Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.name}
              href={stat.href}
              className="workspace-stat product-card overflow-hidden rounded-2xl bg-background border border-neutral-dark/10 p-5 sm:p-6 shadow-xs flex items-center justify-between transition-all hover:translate-y-[-2px] hover:shadow-md"
            >
              <div>
                <p className="text-xs sm:text-sm font-medium text-neutral-dark/65 truncate">{stat.name}</p>
                <p className="mt-1 text-2xl sm:text-3xl font-bold text-neutral-dark tracking-tight">
                  {stat.value}
                </p>
              </div>
              <div className={`rounded-xl p-3 shrink-0 ${stat.color}`}>
                <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
            </Link>
          );
        })}
      </div>

      {/* Main Content Sections */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Recent Applications Card */}
          <div className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4 border-b border-neutral-dark/10 pb-4">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <h2 className="font-serif text-xl font-bold text-neutral-dark">Son müraciətlər</h2>
              </div>
              <Link
                href="/business/applications"
                className="tap text-xs font-semibold text-accent hover:text-accent-hover transition-colors inline-flex items-center gap-1"
              >
                Hamısına bax <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {recentApps === null ? (
              <div className="text-center py-8 text-sm text-neutral-dark/65">
                Müraciət məlumatı əldə edilmədi.
              </div>
            ) : recentList.length === 0 ? (
              <div className="text-center py-10">
                <FileText className="mx-auto h-12 w-12 text-neutral-dark/30 mb-2" />
                <p className="text-sm font-medium text-neutral-dark">Hələ müraciət daxil olmayıb</p>
                <p className="text-xs text-neutral-dark/65 mt-1">
                  Vakansiyalarınızı aktiv saxlayaraq namizədləri cəlb edin.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-dark/10">
                {recentList.map((app: any) => {
                  const statusStyle = STATUS_CONFIG[app.status] || {
                    label: app.status,
                    bg: 'bg-neutral-100',
                    text: 'text-neutral-700',
                    border: 'border-neutral-200',
                  };
                  return (
                    <div
                      key={app.id}
                      className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/business/applications/${app.id}`}
                          className="tap font-semibold text-sm text-neutral-dark hover:text-primary transition-colors block truncate"
                        >
                          {app.candidateName}
                        </Link>
                        <p className="text-xs text-neutral-dark/65 truncate">{app.vacancyTitle}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                        >
                          {statusStyle.label}
                        </span>
                        <Link
                          href={`/business/applications/${app.id}`}
                          className="tap-inline text-xs font-semibold text-neutral-dark/60 hover:text-primary px-2 py-1 rounded-md transition-colors"
                        >
                          Bax
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active Vacancies Quick Overview */}
          <div className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4 border-b border-neutral-dark/10 pb-4">
              <div className="flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-primary" />
                <h2 className="font-serif text-xl font-bold text-neutral-dark">Aktiv vakansiyalar</h2>
              </div>
              <Link
                href="/business/vacancies"
                className="tap text-xs font-semibold text-accent hover:text-accent-hover transition-colors inline-flex items-center gap-1"
              >
                Hamısına bax <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {vacancies === null ? (
              <div className="text-center py-8 text-sm text-neutral-dark/65">
                Vakansiya məlumatı əldə edilmədi.
              </div>
            ) : activeList.length === 0 ? (
              <div className="text-center py-8">
                <Briefcase className="mx-auto h-10 w-10 text-neutral-dark/30 mb-2" />
                <p className="text-sm font-medium text-neutral-dark">Hazırda aktiv vakansiya yoxdur</p>
                <Link
                  href="/business/vacancies/new"
                  className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" /> Yeni vakansiya yerləşdir
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-neutral-dark/10">
                {activeList.map((vac: any) => (
                  <div
                    key={vac.id}
                    className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/business/vacancies/${vac.id}/edit`}
                        className="tap font-semibold text-sm text-neutral-dark hover:text-primary transition-colors block truncate"
                      >
                        {vac.title}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-neutral-dark/60">
                        {vac.deadline ? (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(vac.deadline)}
                          </span>
                        ) : (
                          <span>Müddətsiz</span>
                        )}
                        <span>·</span>
                        <Link
                          href={`/business/applications?vacancyId=${vac.id}`}
                          className="tap-inline hover:text-primary hover:underline"
                        >
                          {typeof vac._count?.applications === 'number' ? vac._count.applications : '—'} müraciət
                        </Link>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/business/vacancies/${vac.id}/edit`}
                        className="tap-inline text-xs font-semibold text-neutral-dark/70 hover:text-primary px-2.5 py-1 rounded-lg border border-neutral-dark/15 hover:bg-neutral-dark/5 transition-colors"
                      >
                        Redaktə
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Shortcuts & Support Column */}
        <div className="space-y-6">
          <div className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-6 shadow-xs space-y-4">
            <h2 className="font-serif text-lg font-bold text-neutral-dark border-b border-neutral-dark/10 pb-3">
              Sürətli keçidlər
            </h2>
            <div className="space-y-2.5">
              {!suspended && (
                <Link
                  href="/business/vacancies/new"
                  className="flex w-full items-center justify-between rounded-xl bg-primary text-white py-3 px-4 text-sm font-semibold shadow-xs hover:bg-primary-hover transition-all"
                >
                  <span className="flex items-center gap-2">
                    <Plus className="h-4 w-4" /> Vakansiya yerləşdir
                  </span>
                  <ArrowRight className="h-4 w-4 opacity-70" />
                </Link>
              )}
              <Link
                href="/business/vacancies"
                className="tap flex w-full items-center justify-between rounded-xl bg-background border border-neutral-dark/20 py-2.5 px-4 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all"
              >
                <span className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-primary" /> Bütün vakansiyalar
                </span>
                <span className="text-xs text-neutral-dark/60">{totalVacancies ?? '—'}</span>
              </Link>
              <Link
                href="/business/applications"
                className="tap flex w-full items-center justify-between rounded-xl bg-background border border-neutral-dark/20 py-2.5 px-4 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all"
              >
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-accent" /> Bütün müraciətlər
                </span>
                <span className="text-xs text-neutral-dark/60">{totalApps ?? '—'}</span>
              </Link>
              <Link
                href="/business/company"
                className="tap flex w-full items-center justify-between rounded-xl bg-background border border-neutral-dark/20 py-2.5 px-4 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all"
              >
                <span className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-neutral-dark/60" /> Şirkət profili
                </span>
                <ArrowRight className="h-4 w-4 text-neutral-dark/40" />
              </Link>
            </div>
          </div>

          <div className="product-card rounded-2xl bg-background-warm/30 border border-neutral-dark/10 p-5 shadow-xs">
            <h3 className="text-xs font-bold text-neutral-dark/80 uppercase tracking-wider mb-2">
              Tövsiyə
            </h3>
            <p className="text-xs text-neutral-dark/75 leading-relaxed">
              Vakansiyada tələb olunan bacarıqları vergüllə dəqiq ayırmaq uyğun namizədlərin süni intellekt ilə sıralanmasını yaxşılaşdırır.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
