import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, ArrowLeft, ExternalLink, Calendar, MapPin, CheckCircle, ShieldAlert, Sparkles, Globe, Clock } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { FollowCompanyButton } from '@/components/retention/follow-company-button';
import type { Metadata } from 'next';

interface CompanyJob {
  id: string;
  kind: 'imported';
  title: string;
  location: string;
  postedAt: string;
  deadline: string | null;
  applicationMethod: string;
  checkedAt: string;
  source: string;
}

interface CompanySourceAttribution {
  key: string;
  name: string;
  homepageUrl: string;
  count: number;
}

interface CompanyDetailResponse {
  id: string;
  name: string;
  openCount: number;
  lastObservedAt: string;
  sources: Array<{ key: string; name: string; count: number }>;
  logo: { source: string; sourcePage: string; verifiedAt: string } | null;
  monogram: { text: string; color: string };
  registered: false;
  aliases: string[];
  website: string | null;
  followKey: string;
  attribution: {
    statement: string;
    sources: CompanySourceAttribution[];
  };
  total: number;
  jobs: CompanyJob[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function fetchCompanyDetail(id: string, page = '1'): Promise<CompanyDetailResponse | null> {
  try {
    const res = await fetch(`${API_URL}/public/companies/${encodeURIComponent(id)}?page=${page}&limit=20`, {
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const company = await fetchCompanyDetail(id);
  if (!company) return { title: 'Şirkət tapılmadı — AISE' };
  return {
    title: `${company.name} — Vakansiyalar və İctimai Məlumat — AISE`,
    description: `${company.name} şirkətinin Azərbaycan əmək bazarında müşahidə edilən aktiv vakansiyaları və mənbə məlumatları.`,
  };
}

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page: pageStr } = await searchParams;
  const page = parseInt(pageStr || '1', 10);
  const company = await fetchCompanyDetail(id, String(page));

  if (!company) {
    notFound();
  }

  const jobs = company.jobs || [];
  const total = company.total || 0;
  const totalPages = Math.ceil(total / 20) || 1;

  return (
    <main className="min-h-screen bg-background-warm/30 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Navigation */}
        <Link
          href="/companies"
          className="inline-flex min-h-11 items-center gap-1.5 text-xs sm:text-sm font-semibold text-neutral-dark/70 hover:text-neutral-dark transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Bütün şirkətlər</span>
        </Link>

        {/* Company Header Card */}
        <div className="product-card rounded-2xl border border-neutral-dark/10 bg-background p-6 sm:p-8 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
            <div className="flex items-start gap-4">
              {/* Monogram or Verified Logo */}
              {company.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${API_URL}/public/companies/${company.id}/logo`}
                  alt={company.name}
                  className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl object-contain border border-neutral-dark/10 bg-white p-1.5 shrink-0"
                />
              ) : (
                <div
                  style={{ backgroundColor: company.monogram.color }}
                  className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl flex items-center justify-center font-bold text-white text-xl sm:text-2xl select-none shrink-0 tracking-wide shadow-xs"
                  aria-hidden="true"
                >
                  {company.monogram.text}
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-serif text-2xl sm:text-3xl font-bold text-neutral-dark">
                    {company.name}
                  </h1>
                  <span className="rounded-md border border-neutral-dark/15 bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-dark/75">
                    İctimai mənbə
                  </span>
                </div>

                {company.website && (
                  <p className="text-xs sm:text-sm">
                    <a
                      href={company.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline font-medium"
                    >
                      <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{company.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</span>
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </p>
                )}

                <p className="text-xs text-neutral-dark/65 pt-1">
                  Son müşahidə: {formatDate(company.lastObservedAt)}
                </p>
              </div>
            </div>

            {/* Follow action */}
            <div className="shrink-0 self-start">
              <FollowCompanyButton
                followKey={company.followKey}
                companyName={company.name}
              />
            </div>
          </div>

          {/* Alternate Observed Spellings / Aliases */}
          {company.aliases && company.aliases.length > 1 && (
            <div className="border-t border-neutral-dark/10 pt-4 text-xs text-neutral-dark/70">
              <span className="font-semibold text-neutral-dark">Elanlarda digər yazılış formaları: </span>
              <span>{company.aliases.filter((a) => a !== company.name).join(', ')}</span>
            </div>
          )}

          {/* Mandatory Attribution Statement & Source Badges */}
          <div className="rounded-xl border border-neutral-dark/10 bg-background-warm/30 p-4 space-y-2 text-xs text-neutral-dark/80">
            <div className="flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-semibold text-neutral-dark mb-0.5">Mənbə və məlumat mənşəyi</p>
                <p className="leading-relaxed text-neutral-dark/75">
                  {company.attribution?.statement ||
                    'Bu səhifədəki vakansiyalar ictimai mənbələrdən toplanıb və işəgötürənin AISE-də rəsmi qeydiyyatını bildirmir.'}
                </p>
              </div>
            </div>

            {company.attribution?.sources && company.attribution.sources.length > 0 && (
              <div className="pt-2 border-t border-neutral-dark/5 flex flex-wrap items-center gap-2">
                <span className="font-semibold text-neutral-dark/75">Toplanan mənbələr:</span>
                {company.attribution.sources.map((s) => (
                  <a
                    key={s.key}
                    href={s.homepageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-neutral-dark/15 bg-background px-2 py-0.5 text-[11px] font-medium text-neutral-dark/80 hover:text-accent transition-colors"
                  >
                    <span>{s.name} ({s.count})</span>
                    <ExternalLink className="h-2.5 w-2.5 opacity-60" aria-hidden="true" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Vacancies Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-xl sm:text-2xl font-bold text-neutral-dark">
              Aktiv Vakansiyalar ({company.openCount})
            </h2>
          </div>

          {jobs.length === 0 ? (
            <div className="product-card rounded-2xl border border-neutral-dark/10 bg-background p-10 text-center text-neutral-dark/65 space-y-2">
              <Building2 className="h-10 w-10 text-neutral-dark/30 mx-auto" aria-hidden="true" />
              <p className="font-semibold text-neutral-dark">Hal-hazırda aktiv ictimai elan aşkar edilməyib.</p>
              <p className="text-xs">Şirkəti izləyərək yeni elanlar əlavə olunduqda xəbərdar ola bilərsiniz.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/jobs/imported/${job.id}`}
                  className="product-card group block rounded-2xl border border-neutral-dark/10 bg-background p-5 shadow-xs hover:border-primary/40 hover:shadow-sm transition-all outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="font-serif text-base sm:text-lg font-bold text-neutral-dark group-hover:text-primary transition-colors">
                        {job.title}
                      </h3>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-dark/70">
                        {job.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 text-neutral-dark/50" aria-hidden="true" />
                            {job.location}
                          </span>
                        )}
                        {job.postedAt && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5 text-neutral-dark/50" aria-hidden="true" />
                            Elan tarixi: {formatDate(job.postedAt)}
                          </span>
                        )}
                        {job.deadline && (
                          <span className="flex items-center gap-1 text-amber-900 font-medium">
                            <Clock className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
                            Son müraciət: {formatDate(job.deadline)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-neutral-dark/5">
                      <span className="rounded-md border border-neutral-dark/15 bg-background-warm/40 px-2 py-0.5 text-[11px] font-medium text-neutral-dark/70">
                        Mənbə: {job.source}
                      </span>
                      <span className="text-[11px] text-neutral-dark/50">
                        Yoxlanılıb: {formatDate(job.checkedAt)}
                      </span>
                    </div>
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
                  href={`/companies/${company.id}?page=${page - 1}`}
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
                  href={`/companies/${company.id}?page=${page + 1}`}
                  className="min-h-11 inline-flex items-center px-4 rounded-xl border border-neutral-dark/20 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5"
                >
                  Növbəti
                </Link>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
