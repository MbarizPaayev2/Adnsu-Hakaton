import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { 
  Building2, MapPin, ExternalLink, Mail, 
  Calendar, Users, Briefcase, ChevronLeft,
  Linkedin, Twitter, Facebook, Instagram,
  CheckCircle2
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { CompanyLogo } from '@/components/company-logo';
import { workFormatLabel, employmentTypeLabel } from "@/lib/vacancy-labels";
import { formatDate } from "@/lib/format";
import { FollowCompanyButton } from '@/components/retention/follow-company-button';

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiFetch(`/companies/${id}`, { cache: 'no-store' });
  
  if (!res.ok) {
    if (res.status === 404) {
      notFound();
    }
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h2 className="text-xl font-bold text-neutral-dark mb-2">Xəta baş verdi</h2>
      </div>
    );
  }

  const company = await res.json();
  const vacancies = company.vacancies || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Link href="/dashboard/companies" className="inline-flex items-center text-sm font-medium text-neutral-dark/65 hover:text-neutral-dark transition-colors mb-2">
        <ChevronLeft className="h-4 w-4 mr-1" />
        Şirkətlərə qayıt
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Company Info Left Column */}
        <div className="lg:col-span-1 space-y-6">
          <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 shadow-xs p-6">
            <div className="flex flex-col items-center text-center pb-6 border-b border-neutral-dark/10">
              <CompanyLogo src={company.logo} alt={company.name} name={company.name} className="h-20 w-20 rounded-2xl object-cover mb-4 shadow-sm" />
              <h1 className="font-serif text-2xl font-bold text-neutral-dark">{company.name}</h1>
              {company.industry && (
                <span className="mt-2 inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-medium border bg-neutral-50 text-neutral-800 border-neutral-200">
                  {company.industry}
                </span>
              )}
              {/* Trust & Source Badges (only from verified data, no fake partner badges) */}
              <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                {company.isPartner ? (
                  <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                    <CheckCircle2 className="h-3 w-3 text-emerald-700" aria-hidden="true" />
                    Rəsmi tərəfdaş
                  </span>
                ) : (company.status === 'APPROVED' || company.isRegistered) ? (
                  <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-neutral-100 text-neutral-800 border border-neutral-200">
                    AISE-də qeydiyyatdan keçmiş
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-neutral-50 text-neutral-600 border border-neutral-200">
                    Kataloq elanları
                  </span>
                )}
              </div>
              <div className="mt-4">
                <FollowCompanyButton companyId={company.id} companyName={company.name} />
              </div>
            </div>

            <div className="pt-6 space-y-4">
              {company.location && (
                <div className="flex items-start gap-3 text-sm">
                  <MapPin className="h-5 w-5 text-neutral-dark/50 shrink-0" />
                  <span className="text-neutral-dark">{company.location}</span>
                </div>
              )}
              
              {company.foundedYear && (
                <div className="flex items-center gap-3 text-sm">
                  <Calendar className="h-5 w-5 text-neutral-dark/50 shrink-0" />
                  <span className="text-neutral-dark">Yaranma ili: {company.foundedYear}</span>
                </div>
              )}
              
              {company.size && (
                <div className="flex items-center gap-3 text-sm">
                  <Users className="h-5 w-5 text-neutral-dark/50 shrink-0" />
                  <span className="text-neutral-dark">{company.size} işçi</span>
                </div>
              )}
              
              {company.website && (
                <div className="flex items-center gap-3 text-sm">
                  <ExternalLink className="h-5 w-5 text-neutral-dark/50 shrink-0" />
                  <a href={company.website.startsWith('http') ? company.website : `https://${company.website}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    Veb-sayta keçid
                  </a>
                </div>
              )}
              
              {company.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="h-5 w-5 text-neutral-dark/50 shrink-0" />
                  <a href={`mailto:${company.email}`} className="text-accent hover:underline">
                    {company.email}
                  </a>
                </div>
              )}
            </div>

            {(company.linkedin || company.twitter || company.facebook || company.instagram) && (
              <div className="pt-6 mt-6 border-t border-neutral-dark/10 flex gap-4 justify-center">
                {company.linkedin && <a href={company.linkedin} target="_blank" rel="noopener noreferrer" className="text-neutral-dark/50 hover:text-neutral-dark"><Linkedin className="h-5 w-5" /></a>}
                {company.twitter && <a href={company.twitter} target="_blank" rel="noopener noreferrer" className="text-neutral-dark/50 hover:text-neutral-dark"><Twitter className="h-5 w-5" /></a>}
                {company.facebook && <a href={company.facebook} target="_blank" rel="noopener noreferrer" className="text-neutral-dark/50 hover:text-neutral-dark"><Facebook className="h-5 w-5" /></a>}
                {company.instagram && <a href={company.instagram} target="_blank" rel="noopener noreferrer" className="text-neutral-dark/50 hover:text-neutral-dark"><Instagram className="h-5 w-5" /></a>}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Description & Vacancies */}
        <div className="lg:col-span-2 space-y-6">
          {company.description && (
            <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 shadow-xs p-6">
              <h2 className="font-serif text-xl font-bold text-neutral-dark mb-4">Şirkət haqqında</h2>
              <div className="prose prose-sm max-w-none text-neutral-dark/80 whitespace-pre-line">
                {company.description}
              </div>
            </div>
          )}

          <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 shadow-xs p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-serif text-xl font-bold text-neutral-dark">Açıq Vakansiyalar ({vacancies.length})</h2>
            </div>

            {vacancies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center border-t border-neutral-dark/5">
                <Briefcase className="h-12 w-12 text-neutral-dark/30 mb-3" />
                <p className="text-neutral-dark/65 font-medium">Bu şirkətin hazırda açıq vakansiyası yoxdur.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {vacancies.map((vacancy: any) => (
                  <div key={vacancy.id} className="block group border border-neutral-dark/10 rounded-xl p-5 hover:border-primary/30 transition-colors">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div>
                        <h3 className="font-bold text-neutral-dark text-lg group-hover:text-primary transition-colors">{vacancy.title}</h3>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {vacancy.workArrangement && (
                            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium border bg-neutral-50 text-neutral-800 border-neutral-200">
                              {workFormatLabel(vacancy.workArrangement)}
                            </span>
                          )}
                          {vacancy.employmentType && (
                            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium border bg-neutral-50 text-neutral-800 border-neutral-200">
                              {employmentTypeLabel(vacancy.employmentType)}
                            </span>
                          )}
                          {vacancy.source && (
                            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium border bg-neutral-50 text-neutral-600 border-neutral-200">
                              Mənbə: {vacancy.source}
                            </span>
                          )}
                        </div>
                        <div className="mt-3 flex items-center text-xs text-neutral-dark/65 gap-4">
                          {vacancy.location && (
                            <div className="flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              <span>{vacancy.location}</span>
                            </div>
                          )}
                          {(vacancy.salaryMin || vacancy.salaryMax) && (
                            <div className="font-medium text-neutral-dark">
                              {vacancy.salaryMin && vacancy.salaryMax 
                                ? `${vacancy.salaryMin} - ${vacancy.salaryMax} AZN`
                                : `${vacancy.salaryMin || vacancy.salaryMax} AZN`}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-2">
                        <Link
                          href={`/dashboard/companies/${company.id}/vacancies/${vacancy.id}`}
                          className="product-action rounded-full bg-primary py-2 px-4 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all w-full text-center md:w-auto"
                        >
                          Müraciət et
                        </Link>
                        {vacancy.deadline && (
                          <span className="text-[10px] text-neutral-dark/65">
                            Son müraciət: {formatDate(vacancy.deadline)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
