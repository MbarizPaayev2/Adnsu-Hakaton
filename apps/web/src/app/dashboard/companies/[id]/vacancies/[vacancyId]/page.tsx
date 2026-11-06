import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, MapPin, Building2, Briefcase, Calendar, AlertCircle, CheckCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { CompanyLogo } from '@/components/company-logo';
import { workFormatLabel, employmentTypeLabel, experienceLevelLabel } from "@/lib/vacancy-labels";
import { formatDate } from "@/lib/format";

export default async function VacancyDetailPage({ params }: { params: Promise<{ id: string, vacancyId: string }> }) {
  const { id, vacancyId } = await params;
  const [res, applicationsRes] = await Promise.all([
    apiFetch(`/vacancies/${vacancyId}`, { cache: 'no-store' }),
    apiFetch(`/dashboard/applications`, { cache: 'no-store' }),
  ]);

  if (!res.ok) {
    if (res.status === 404) notFound();
    return <div>Xəta baş verdi</div>;
  }

  const vacancy = await res.json();
  const company = vacancy.company;
  const applications = applicationsRes.ok ? await applicationsRes.json() : [];
  const existingApp = Array.isArray(applications) ? applications.find((a: any) => a.vacancyId === vacancyId) : null;
  const isRejected = existingApp?.status === 'REJECTED';
  const hasActiveApplied = !!existingApp && !isRejected;

  const isInactive = vacancy.status === 'PAUSED' || vacancy.status === 'DELETED';
  const isExpired = vacancy.deadline && new Date(vacancy.deadline) < new Date();

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <Link href={`/dashboard/companies/${id}`} className="inline-flex items-center text-sm font-medium text-neutral-dark/65 hover:text-neutral-dark transition-colors mb-2">
        <ChevronLeft className="h-4 w-4 mr-1" />
        {company.name} şirkətinə qayıt
      </Link>

      {isRejected && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3 text-amber-900">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-amber-700" />
          <div>
            <h3 className="font-bold">Əvvəlki müraciətiniz rədd edilib</h3>
            <p className="text-sm mt-1">
              CV və ya məlumatlarınızı yeniləyərək bu vakansiyaya yenidən müraciət göndərə bilərsiniz.
            </p>
          </div>
        </div>
      )}

      {hasActiveApplied && (
        <div className="rounded-xl bg-green-50 border border-green-200 p-4 flex items-start gap-3 text-green-800">
          <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold">Artıq müraciət etmisiniz</h3>
            <p className="text-sm mt-1">
              Bu vakansiyaya müraciətinizi{' '}
              <Link href="/dashboard/applications" className="underline font-medium">Müraciətlərim</Link>
              {' '}bölməsindən izləyə bilərsiniz.
            </p>
          </div>
        </div>
      )}

      {!hasActiveApplied && !isRejected && (isInactive || isExpired) && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3 text-amber-800">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold">Müraciət mümkün deyil</h3>
            <p className="text-sm mt-1">
              {isInactive ? 'Bu vakansiya artıq aktiv deyil.' : 'Bu vakansiyanın müraciət müddəti bitmişdir.'}
            </p>
          </div>
        </div>
      )}

      <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 shadow-xs p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8 pb-8 border-b border-neutral-dark/10">
          <div>
            <h1 className="font-serif text-3xl font-bold text-neutral-dark mb-4">{vacancy.title}</h1>
            
            <div className="flex flex-wrap gap-2 mb-4">
              {vacancy.workArrangement && (
                <span className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium border bg-neutral-50 text-neutral-800 border-neutral-200">
                  {workFormatLabel(vacancy.workArrangement)}
                </span>
              )}
              {vacancy.employmentType && (
                <span className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium border bg-neutral-50 text-neutral-800 border-neutral-200">
                  {employmentTypeLabel(vacancy.employmentType)}
                </span>
              )}
              {vacancy.experienceLevel && (
                <span className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium border bg-neutral-50 text-neutral-800 border-neutral-200">
                  {experienceLevelLabel(vacancy.experienceLevel)}
                </span>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 text-sm text-neutral-dark/75">
              {vacancy.location && (
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span>{vacancy.location}</span>
                </div>
              )}
              {(vacancy.salaryMin || vacancy.salaryMax) && (
                <div className="flex items-center gap-1.5 font-medium text-neutral-dark">
                  <Briefcase className="h-4 w-4 shrink-0" />
                  <span>
                    {vacancy.salaryMin && vacancy.salaryMax 
                      ? `${vacancy.salaryMin} - ${vacancy.salaryMax} AZN`
                      : `${vacancy.salaryMin || vacancy.salaryMax} AZN`}
                  </span>
                </div>
              )}
              {vacancy.deadline && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 shrink-0" />
                  <span>Son müraciət: {formatDate(vacancy.deadline)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 flex flex-col items-center sm:items-end gap-4 w-full md:w-auto">
            {company.logo ? (
              <CompanyLogo src={company.logo} alt={company.name} className="h-16 w-16 rounded-xl object-cover border border-neutral-dark/10 hidden md:block" />
            ) : (
              <div className="h-16 w-16 items-center justify-center product-action rounded-full bg-accent/15 text-accent font-serif font-bold text-2xl hidden md:flex shrink-0 border border-neutral-dark/10">
                {company.name[0].toUpperCase()}
              </div>
            )}
            
            <Link
              href={hasActiveApplied ? '/dashboard/applications' : `/dashboard/companies/${id}/vacancies/${vacancyId}/apply`}
              className={`rounded-xl py-3 px-8 text-sm font-semibold shadow-xs transition-all w-full text-center ${
                hasActiveApplied
                  ? 'bg-green-50 text-green-800 border border-green-200 hover:bg-green-100'
                  : isInactive || isExpired
                    ? 'bg-neutral-dark/20 text-white cursor-not-allowed pointer-events-none'
                    : 'bg-primary text-white hover:bg-primary-hover'
              }`}
            >
              {hasActiveApplied ? 'Artıq müraciət etmisiniz' : isRejected ? 'Yenidən müraciət et' : 'Müraciət et'}
            </Link>
          </div>
        </div>

        <div className="space-y-8">
          {vacancy.description && (
            <div>
              <h2 className="font-serif text-xl font-bold text-neutral-dark mb-3">Vakansiya haqqında</h2>
              <div className="prose prose-sm max-w-none text-neutral-dark/80 whitespace-pre-line">
                {vacancy.description}
              </div>
            </div>
          )}

          {vacancy.responsibilities && (
            <div>
              <h2 className="font-serif text-xl font-bold text-neutral-dark mb-3">Vəzifə öhdəlikləri</h2>
              <div className="prose prose-sm max-w-none text-neutral-dark/80 whitespace-pre-line">
                {vacancy.responsibilities}
              </div>
            </div>
          )}

          {vacancy.requirements && (
            <div>
              <h2 className="font-serif text-xl font-bold text-neutral-dark mb-3">Tələblər</h2>
              <div className="prose prose-sm max-w-none text-neutral-dark/80 whitespace-pre-line">
                {vacancy.requirements}
              </div>
            </div>
          )}

          {vacancy.skills && vacancy.skills.length > 0 && (
            <div>
              <h2 className="font-serif text-xl font-bold text-neutral-dark mb-3">Tələb olunan bacarıqlar</h2>
              <div className="flex flex-wrap gap-2">
                {vacancy.skills.map((skill: string, index: number) => (
                  <span key={index} className="inline-flex items-center rounded-md bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {vacancy.questions && vacancy.questions.length > 0 && (
            <div className="pt-6 mt-6 border-t border-neutral-dark/10">
              <h2 className="font-serif text-xl font-bold text-neutral-dark mb-3">Müraciət üçün əlavə suallar</h2>
              <p className="text-sm text-neutral-dark/65 mb-4">Şirkət bu vakansiya üçün aşağıdakı məlumatları tələb edir:</p>
              <ul className="list-disc pl-5 space-y-2 text-sm text-neutral-dark/80">
                {vacancy.questions.map((q: any) => (
                  <li key={q.id}>{q.label} {q.required && <span className="text-red-500">*</span>}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        
        <div className="mt-8 pt-8 border-t border-neutral-dark/10 flex justify-center">
          <Link
            href={
              hasActiveApplied
                ? '/dashboard/applications'
                : `/dashboard/companies/${id}/vacancies/${vacancyId}/apply`
            }
            className={`rounded-xl py-3 px-8 text-sm font-semibold shadow-xs transition-all w-full md:w-auto text-center ${
              hasActiveApplied
                ? 'bg-green-50 text-green-800 border border-green-200 hover:bg-green-100'
                : isInactive || isExpired
                  ? 'bg-neutral-dark/20 text-white cursor-not-allowed pointer-events-none'
                  : 'bg-primary text-white hover:bg-primary-hover'
            }`}
          >
            {isRejected ? 'Yenidən müraciət et' : hasActiveApplied ? 'Artıq müraciət etmisiniz' : 'İndi müraciət et'}
          </Link>
        </div>
      </div>
    </div>
  );
}
