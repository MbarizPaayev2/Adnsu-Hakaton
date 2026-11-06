import React, { Suspense } from 'react';
import Link from 'next/link';
import { Search, Building2, ExternalLink, ArrowRight, ShieldAlert, Sparkles, Filter } from 'lucide-react';
import { formatDate } from '@/lib/format';


interface CompanySource {
  key: string;
  name: string;
  count: number;
}

interface ObservedCompany {
  id: string;
  name: string;
  openCount: number;
  lastObservedAt: string;
  sources: CompanySource[];
  logo: { source: string; sourcePage: string; verifiedAt: string } | null;
  monogram: { text: string; color: string };
  registered: false;
}

interface CompaniesResponse {
  page: number;
  limit: number;
  total: number;
  totals: {
    companies: number;
    openPostings: number;
    postingsWithoutUsableCompanyName: number;
  };
  companies: ObservedCompany[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function fetchCompanies(searchParams: { q?: string; page?: string; sort?: string }): Promise<CompaniesResponse | null> {
  const params = new URLSearchParams();
  if (searchParams.q) params.set('q', searchParams.q);
  if (searchParams.page) params.set('page', searchParams.page);
  if (searchParams.sort) params.set('sort', searchParams.sort);
  params.set('limit', '24');

  try {
    const res = await fetch(`${API_URL}/public/companies?${params.toString()}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function ObservedCompanyDirectory({
  searchParams, basePath = "/companies",
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string }>; basePath?: string;
}) {
  const resolvedParams = await searchParams;
  const data = await fetchCompanies(resolvedParams);
  const q = resolvedParams.q || '';
  const sort = resolvedParams.sort || 'postings';
  const page = data?.page ?? 1;

  const companies = data?.companies || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / 24) || 1;

  return (
    <main className="min-h-screen bg-background-warm/30 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>İctimai vakansiya müşahidəsi</span>
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-neutral-dark">
            Şirkətlər və ictimai mənbələr
          </h1>
          <p className="max-w-2xl text-sm sm:text-base text-neutral-dark/75 leading-relaxed">
            Azərbaycan əmək bazarında toplanmış vakansiyalarda müşahidə olunan şirkətlər.
            Bu məlumatlar ictimai elanlardan toplanıb və işəgötürənin rəsmi qeydiyyatını bildirmir.
          </p>
        </div>

        {/* Totals Summary Banner */}
        {data?.totals && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 rounded-2xl border border-neutral-dark/10 bg-background p-4 sm:p-6 shadow-xs">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-dark/60">Müşahidə olunan şirkətlər</p>
              <p className="mt-1 font-serif text-2xl font-bold text-neutral-dark">{data.totals.companies.toLocaleString('az-AZ')}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-dark/60">Aktiv ictimai elanlar</p>
              <p className="mt-1 font-serif text-2xl font-bold text-primary">{data.totals.openPostings.toLocaleString('az-AZ')}</p>
            </div>
            <div className="col-span-2 sm:col-span-1 border-t sm:border-t-0 sm:border-l border-neutral-dark/10 pt-3 sm:pt-0 sm:pl-4">
              <p className="text-xs text-neutral-dark/65 leading-relaxed">
                Elanlar işəgötürənlərin karyera səhifələrindən və ictimai mənbələrdən dövri olaraq yoxlanılır.
              </p>
            </div>
          </div>
        )}

        {/* Search & Sort Controls */}
        <form method="GET" action={basePath} className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-dark/45" aria-hidden="true" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Şirkət adına görə axtarın..."
              aria-label="Şirkət axtarışı"
              className="w-full min-h-11 rounded-xl border border-neutral-dark/20 bg-background pl-10 pr-4 text-sm text-neutral-dark placeholder:text-neutral-dark/45 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="sort" className="text-xs font-semibold text-neutral-dark/70 shrink-0">Sırala:</label>
            <select
              id="sort"
              name="sort"
              defaultValue={sort}
              className="min-h-11 rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-xs font-semibold text-neutral-dark focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
            >
              <option value="postings">Vakansiya sayına görə</option>
              <option value="name">Ada görə (A-Z)</option>
            </select>
            <button
              type="submit"
              className="min-h-11 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover transition-colors"
            >
              Filterlə
            </button>
            {q && (
              <Link
                href={basePath}
                className="min-h-11 inline-flex items-center justify-center rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5"
              >
                Sıfırla
              </Link>
            )}
          </div>
        </form>

        {/* Companies Grid */}
        {!data ? (<p role="alert" className="rounded-xl border border-red-200 p-5 text-red-800">Şirkətlər yüklənmədi. Zəhmət olmasa, yenidən cəhd edin.</p>) : companies.length === 0 ? (
          <div className="product-card flex flex-col items-center justify-center py-16 text-center bg-background rounded-2xl border border-neutral-dark/10">
            <Building2 className="h-12 w-12 text-neutral-dark/30 mb-3" aria-hidden="true" />
            <p className="text-sm font-semibold text-neutral-dark">Heç bir şirkət tapılmadı.</p>
            <p className="text-xs text-neutral-dark/65 mt-1">Axtarış sözünü dəyişərək yenidən yoxlayın.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {companies.map((company) => (
              <Link
                key={company.id}
                href={`/companies/${company.id}`}
                className="product-card group relative flex flex-col justify-between rounded-2xl border border-neutral-dark/10 bg-background p-5 shadow-xs hover:border-primary/40 hover:shadow-sm transition-all outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div>
                  <div className="flex items-start gap-3.5 mb-3">
                    {/* Monogram or Logo */}
                    {company.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`${API_URL}/public/companies/${company.id}/logo`}
                        alt={company.name}
                        className="h-12 w-12 rounded-xl object-contain border border-neutral-dark/10 bg-white p-1 shrink-0"
                      />
                    ) : (
                      <div
                        style={{ backgroundColor: company.monogram.color }}
                        className="h-12 w-12 rounded-xl flex items-center justify-center font-bold text-white text-base select-none shrink-0 tracking-wide"
                        aria-hidden="true"
                      >
                        {company.monogram.text}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <h2 className="font-serif text-base font-bold text-neutral-dark group-hover:text-primary transition-colors truncate">
                        {company.name}
                      </h2>
                      <span className="inline-block mt-0.5 rounded-md border border-neutral-dark/15 bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-dark/70">
                        İctimai mənbə
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs text-neutral-dark/75">
                    <p className="flex items-center gap-1.5 font-semibold text-neutral-dark">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                      <span>{company.openCount} aktiv vakansiya</span>
                    </p>

                    {company.sources && company.sources.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {company.sources.slice(0, 3).map((src) => (
                          <span
                            key={src.key}
                            className="rounded-md bg-background-warm/50 border border-neutral-dark/10 px-1.5 py-0.5 text-[10px] text-neutral-dark/70"
                          >
                            {src.name} ({src.count})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-neutral-dark/5 flex items-center justify-between text-[11px] text-neutral-dark/60">
                  <span>Son görülmə: {formatDate(company.lastObservedAt)}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-primary opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-4">
            {page > 1 && (
              <Link
                href={`${basePath}?q=${encodeURIComponent(q)}&sort=${sort}&page=${page - 1}`}
                className="min-h-11 inline-flex items-center px-4 rounded-xl border border-neutral-dark/20 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5"
              >
                Əvvəlki
              </Link>
            )}
            <span className="text-xs text-neutral-dark/70 px-2">
              Səhifə {page} / {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={`${basePath}?q=${encodeURIComponent(q)}&sort=${sort}&page=${page + 1}`}
                className="min-h-11 inline-flex items-center px-4 rounded-xl border border-neutral-dark/20 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5"
              >
                Növbəti
              </Link>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
