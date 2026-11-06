'use client';

import React, { Suspense, useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Users,
  Search,
  Filter,
  ArrowRight,
  AlertTriangle,
  Briefcase,
  Calendar,
  CheckCircle,
  FileText,
} from 'lucide-react';
import { formatDate } from '@/lib/format';

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; border: string }
> = {
  APPLIED: {
    label: 'Müraciət etdi',
    bg: 'bg-blue-50',
    text: 'text-blue-800',
    border: 'border-blue-200',
  },
  REVIEWING: {
    label: 'Nəzərdən keçirilir',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
  },
  INTERVIEW: {
    label: 'Müsahibə',
    bg: 'bg-purple-50',
    text: 'text-purple-800',
    border: 'border-purple-200',
  },
  HIRED: {
    label: 'Qəbul edildi',
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-200',
  },
  REJECTED: {
    label: 'Rədd edildi',
    bg: 'bg-neutral-100',
    text: 'text-neutral-700',
    border: 'border-neutral-200',
  },
};

function ApplicationsContent() {
  const searchParams = useSearchParams();
  const initialVacancyId = searchParams.get('vacancyId') || 'ALL';

  const [applications, setApplications] = useState<any[]>([]);
  const [vacancies, setVacancies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedVacancy, setSelectedVacancy] = useState<string>(initialVacancyId);
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [appsRes, vacsRes] = await Promise.all([
        fetch('/api/business/applications'),
        fetch('/api/business/vacancies').catch(() => null),
      ]);

      if (!appsRes.ok) {
        throw new Error(`Müraciətlər yüklənmədi (${appsRes.status}).`);
      }

      setApplications(await appsRes.json());
      if (vacsRes && vacsRes.ok) {
        setVacancies(await vacsRes.json());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredApplications = useMemo(() => {
    return applications.filter((app) => {
      if (selectedStatus !== 'ALL' && app.status !== selectedStatus) {
        return false;
      }
      if (selectedVacancy !== 'ALL' && app.vacancyId !== selectedVacancy) {
        // Fallback check: if app.vacancyTitle matches the title of selected vacancy
        const matchingVac = vacancies.find((v) => v.id === selectedVacancy);
        if (matchingVac && app.vacancyTitle !== matchingVac.title) {
          return false;
        }
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = app.candidateName?.toLowerCase().includes(q);
        const titleMatch = app.vacancyTitle?.toLowerCase().includes(q);
        if (!nameMatch && !titleMatch) return false;
      }
      return true;
    });
  }, [applications, vacancies, selectedStatus, selectedVacancy, searchQuery]);

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-neutral-dark/70" role="status">
        Müraciətlər yüklənir...
      </div>
    );
  }

  if (error) {
    return (
      <div className="product-card rounded-2xl bg-background border border-red-200 p-8 text-center shadow-xs max-w-xl mx-auto my-12">
        <AlertTriangle className="mx-auto h-12 w-12 text-red-600 mb-3" />
        <h2 className="font-serif text-2xl font-bold text-neutral-dark mb-2">Müraciətlər yüklənmədi</h2>
        <p className="text-sm text-neutral-dark/70 mb-6">{error}</p>
        <button
          onClick={loadData}
          className="inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all"
        >
          Yenidən cəhd et
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold text-neutral-dark">Müraciətlər</h1>
          <p className="mt-1 text-sm text-neutral-dark/70">
            Vakansiyalarınıza daxil olmuş bütün namizəd müraciətlərini və onların CV-lərini nəzərdən keçirin.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-dark/70 bg-background px-3 py-1.5 rounded-full border border-neutral-dark/15 self-start sm:self-auto">
          <Users className="h-3.5 w-3.5 text-primary" />
          <span>Cəmi: {applications.length} müraciət</span>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-4 shadow-xs space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-neutral-dark/40" />
            <input
              type="text"
              placeholder="Namizəd və ya vəzifə axtar..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2 pl-9 pr-3 text-sm text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            />
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              aria-label="Statusa görə filter"
              className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-sm text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            >
              <option value="ALL">Bütün statuslar</option>
              <option value="APPLIED">Müraciət etdi</option>
              <option value="REVIEWING">Nəzərdən keçirilir</option>
              <option value="INTERVIEW">Müsahibə</option>
              <option value="HIRED">Qəbul edildi</option>
              <option value="REJECTED">Rədd edildi</option>
            </select>
          </div>

          {/* Vacancy Filter */}
          {vacancies.length > 0 && (
            <div>
              <select
                value={selectedVacancy}
                onChange={(e) => setSelectedVacancy(e.target.value)}
                aria-label="Vakansiyaya görə filter"
                className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-sm text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              >
                <option value="ALL">Bütün vakansiyalar ({vacancies.length})</option>
                {vacancies.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {(selectedStatus !== 'ALL' || selectedVacancy !== 'ALL' || searchQuery.trim()) && (
          <div className="flex items-center justify-between pt-2 border-t border-neutral-dark/10 text-xs">
            <span className="text-neutral-dark/70">
              Tapılan müraciət sayı: <strong>{filteredApplications.length}</strong>
            </span>
            <button
              onClick={() => {
                setSelectedStatus('ALL');
                setSelectedVacancy('ALL');
                setSearchQuery('');
              }}
              className="text-primary hover:underline font-semibold"
            >
              Filterləri sıfırla
            </button>
          </div>
        )}
      </div>

      {/* Applications Presentation */}
      {applications.length === 0 ? (
        <div className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-12 text-center shadow-xs">
          <FileText className="mx-auto h-12 w-12 text-neutral-dark/30 mb-4" />
          <h2 className="font-serif text-xl font-bold text-neutral-dark">Hələ heç bir müraciət yoxdur</h2>
          <p className="mt-2 text-sm text-neutral-dark/70 max-w-md mx-auto">
            Vakansiyalarınızı aktiv saxlayaraq və ya yeni vakansiya yerləşdirərək namizədlərdən müraciət qəbul edin.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/business/vacancies/new"
              className="inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all"
            >
              Vakansiya yerləşdir
            </Link>
          </div>
        </div>
      ) : filteredApplications.length === 0 ? (
        <div className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-8 text-center shadow-xs">
          <p className="text-sm text-neutral-dark/70">Seçilmiş meyarlara uyğun müraciət tapılmadı.</p>
          <button
            onClick={() => {
              setSelectedStatus('ALL');
              setSelectedVacancy('ALL');
              setSearchQuery('');
            }}
            className="mt-3 text-xs font-semibold text-primary hover:underline"
          >
            Bütün müraciətləri göstər
          </button>
        </div>
      ) : (
        <>
          {/* Mobile Card View (< md) */}
          <div className="block md:hidden space-y-3">
            {filteredApplications.map((app) => {
              const statusStyle = STATUS_CONFIG[app.status] || {
                label: app.status,
                bg: 'bg-neutral-100',
                text: 'text-neutral-700',
                border: 'border-neutral-200',
              };
              const initial = app.candidateName ? app.candidateName[0].toUpperCase() : 'N';

              return (
                <div
                  key={app.id}
                  className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-4 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent font-bold shrink-0">
                        {initial}
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/business/applications/${app.id}`}
                          className="tap font-serif font-bold text-base text-neutral-dark hover:text-primary transition-colors block truncate"
                        >
                          {app.candidateName}
                        </Link>
                        <p className="text-xs text-neutral-dark/65 truncate">{app.vacancyTitle}</p>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium border shrink-0 ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                    >
                      {statusStyle.label}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-neutral-dark/60 pt-2 border-t border-neutral-dark/5">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(app.createdAt)}
                    </span>
                    <Link
                      href={`/business/applications/${app.id}`}
                      className="tap font-semibold text-primary hover:underline inline-flex items-center gap-1"
                    >
                      Bax <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table View (>= md) */}
          <div className="hidden md:block product-card rounded-2xl bg-background border border-neutral-dark/10 shadow-xs overflow-hidden">
            <div className="relative overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-dark/10">
                <thead className="bg-background-warm/30">
                  <tr>
                    <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-neutral-dark uppercase tracking-wider">
                      Namizəd
                    </th>
                    <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-neutral-dark uppercase tracking-wider">
                      Vakansiya
                    </th>
                    <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-neutral-dark uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-neutral-dark uppercase tracking-wider">
                      Tarix
                    </th>
                    <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-neutral-dark uppercase tracking-wider">
                      Əməliyyat
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-dark/10 bg-background">
                  {filteredApplications.map((app) => {
                    const statusStyle = STATUS_CONFIG[app.status] || {
                      label: app.status,
                      bg: 'bg-neutral-100',
                      text: 'text-neutral-700',
                      border: 'border-neutral-200',
                    };
                    const initial = app.candidateName ? app.candidateName[0].toUpperCase() : 'N';

                    return (
                      <tr key={app.id} className="hover:bg-neutral-dark/2 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent font-bold text-sm shrink-0">
                              {initial}
                            </div>
                            <div>
                              <Link
                                href={`/business/applications/${app.id}`}
                                className="tap text-sm font-semibold text-neutral-dark hover:text-primary transition-colors block"
                              >
                                {app.candidateName}
                              </Link>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-dark/80">
                          {app.vacancyTitle}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span
                            className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-medium border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                          >
                            {statusStyle.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-dark/65">
                          {formatDate(app.createdAt)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <Link
                            href={`/business/applications/${app.id}`}
                            aria-label={`${app.candidateName} — müraciətə bax`}
                            className="tap inline-flex min-h-9 items-center rounded-lg px-3 py-1 font-semibold text-xs text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
                          >
                            Ətraflı bax
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function BusinessApplicationsPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-neutral-dark/70" role="status">Yüklənir...</div>}>
      <ApplicationsContent />
    </Suspense>
  );
}
