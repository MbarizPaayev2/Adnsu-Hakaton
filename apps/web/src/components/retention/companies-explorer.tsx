'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, MapPin, Briefcase, Building2, CheckCircle2 } from 'lucide-react';
import { CompanyMark } from '@/components/retention/shared';
import { FollowCompanyButton } from '@/components/retention/follow-company-button';

export interface CompanyItem {
  id: string;
  name: string;
  industry?: string | null;
  location?: string | null;
  logo?: string | null;
  _count?: { vacancies: number };
  status?: string;
  isPartner?: boolean;
  isRegistered?: boolean;
}

export interface CompaniesExplorerProps {
  initialCompanies: CompanyItem[];
}

export function CompaniesExplorer({ initialCompanies }: CompaniesExplorerProps) {
  const [query, setQuery] = useState('');

  // Deduplicate aliases and filter by search
  const filteredCompanies = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('az');
    if (!q) return initialCompanies;

    return initialCompanies.filter((c) => {
      const matchName = c.name.toLocaleLowerCase('az').includes(q);
      const matchIndustry = c.industry?.toLocaleLowerCase('az').includes(q) ?? false;
      const matchLocation = c.location?.toLocaleLowerCase('az').includes(q) ?? false;
      return matchName || matchIndustry || matchLocation;
    });
  }, [initialCompanies, query]);

  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Şirkət adı və ya fəaliyyət sahəsi üzrə axtar..."
          aria-label="Şirkət axtarışı"
          className="w-full min-h-11 rounded-xl border border-outline-variant bg-surface pl-10 pr-4 text-sm text-on-background placeholder:text-on-surface-variant focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
        />
      </div>

      {filteredCompanies.length === 0 ? (
        <div className="product-card flex flex-col items-center justify-center py-16 text-center bg-surface rounded-2xl border border-outline-variant">
          <Building2 className="h-12 w-12 text-on-surface-variant/40 mb-3" aria-hidden="true" />
          <p className="text-sm font-semibold text-on-background">Axtarışa uyğun şirkət tapılmadı.</p>
          <p className="text-xs text-on-surface-variant mt-1">Daha geniş və ya başqa açar sözlə yoxlayın.</p>
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="mt-4 inline-flex min-h-11 items-center px-4 rounded-full border border-outline-variant text-xs font-semibold text-accent hover:bg-surface-container"
            >
              Axtarışı sıfırla
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCompanies.map((company) => {
            const vacanciesCount = company._count?.vacancies || 0;
            const isVerifiedRegistered = company.status === 'APPROVED' || company.isRegistered === true;
            const isVerifiedPartner = company.isPartner === true;

            return (
              <div
                key={company.id}
                className="product-card rounded-2xl bg-surface border border-outline-variant p-6 flex flex-col shadow-xs hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <CompanyMark name={company.name} src={company.logo || undefined} size={48} />
                    <div className="min-w-0">
                      <h2 className="font-bold text-base text-on-background truncate">
                        {company.name}
                      </h2>
                      {company.industry && (
                        <p className="text-xs text-on-surface-variant truncate mt-0.5">
                          {company.industry}
                        </p>
                      )}
                    </div>
                  </div>

                  <FollowCompanyButton companyId={company.id} companyName={company.name} />
                </div>

                {/* Trust & Source Badges (only from verified data) */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {isVerifiedPartner ? (
                    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <CheckCircle2 className="h-3 w-3 text-emerald-700" aria-hidden="true" />
                      Rəsmi tərəfdaş
                    </span>
                  ) : isVerifiedRegistered ? (
                    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium bg-surface-container text-on-surface-variant border border-outline-variant">
                      AISE-də qeydiyyatdan keçmiş
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium bg-surface-container-low text-on-surface-variant border border-outline-variant/60">
                      Kataloq elanları
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 mt-auto pt-4 border-t border-outline-variant/50 text-xs text-on-surface-variant">
                  {company.location && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{company.location}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{vacanciesCount} açıq vakansiya</span>
                  </div>
                </div>

                <Link
                  href={`/dashboard/companies/${company.id}`}
                  className="mt-4 flex w-full min-h-11 justify-center items-center rounded-xl bg-background border border-outline-variant py-2.5 px-4 text-xs font-semibold text-on-background hover:bg-surface-container transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                >
                  Şirkət səhifəsinə bax
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
