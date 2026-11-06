import type { Metadata } from 'next';
import Link from 'next/link';
import { Briefcase, MapPin, ArrowRight, X } from 'lucide-react';
import { SiteNav } from '@/components/landing/site-nav';
import { SiteFooter } from '@/components/landing/site-footer';
import { catalogueFilters, catalogueQuery, catalogueDate, factLabel, fetchCatalogue, sourceLabel, UNKNOWN_LABEL, type CatalogueResponse } from '@/lib/job-catalogue';
import { formatNumber } from '@/lib/format';
import { experienceLevelLabel, workFormatLabel } from '@/lib/vacancy-labels';
import { JobsFilterForm } from '@/components/jobs-filter-form';
import { SaveJobButton } from '@/components/retention/save-job-button';
import { SaveSearchButton } from '@/components/retention/save-search-button';

export const metadata: Metadata = {
  title: 'Bütün vakansiyalar — AISE', description: 'AISE-də açıq vakansiyaları kateqoriya, şəhər, şirkət və mənbə üzrə araşdırın.',
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = catalogueFilters(await searchParams);
  const response = await fetchCatalogue(`/jobs?${catalogueQuery(filters)}`);
  let catalogue: CatalogueResponse | null = null;
  if (response?.ok) { try { catalogue = await response.json(); } catch { /* Show unavailable, never a false zero. */ } }

  // Build active-filter summary pills for display above results.
  // Only text/select filters the user can actually set are included.
  const activeFilters: { label: string; clearHref: string }[] = [];
  if (catalogue) {
    if (filters.application === 'email') activeFilters.push({ label: 'E-poçtla müraciət', clearHref: `/jobs?${catalogueQuery({ ...filters, application: 'all' })}` });
    if (filters.q) activeFilters.push({ label: `"${filters.q}"`, clearHref: `/jobs?${catalogueQuery({ ...filters, q: '' })}` });
    if (filters.location) activeFilters.push({ label: `📍 ${filters.location}`, clearHref: `/jobs?${catalogueQuery({ ...filters, location: '' })}` });
    if (filters.category && filters.category !== 'all') {
      const cat = catalogue.categories.find((c) => c.key === filters.category);
      activeFilters.push({ label: cat ? cat.label : filters.category, clearHref: `/jobs?${catalogueQuery({ ...filters, category: 'all' })}` });
    }
    if (filters.source && filters.source !== 'all') {
      activeFilters.push({ label: sourceLabel(filters.source), clearHref: `/jobs?${catalogueQuery({ ...filters, source: 'all' })}` });
    }
    if (filters.company) {
      activeFilters.push({ label: filters.company, clearHref: `/jobs?${catalogueQuery({ ...filters, company: '' })}` });
    }
    if (filters.work && filters.work !== 'all') {
      activeFilters.push({ label: filters.work === 'unknown' ? UNKNOWN_LABEL : workFormatLabel(filters.work), clearHref: `/jobs?${catalogueQuery({ ...filters, work: 'all' })}` });
    }
    if (filters.experience && filters.experience !== 'all') {
      activeFilters.push({ label: filters.experience === 'unknown' ? UNKNOWN_LABEL : experienceLevelLabel(filters.experience), clearHref: `/jobs?${catalogueQuery({ ...filters, experience: 'all' })}` });
    }
  }

  return (
    <div className="grow bg-background text-on-background">
      <SiteNav />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-32 sm:px-6">
        <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between min-w-0">
          <div className="min-w-0"><h1 className="product-page-title break-words text-3xl font-medium sm:text-4xl">Bütün vakansiyalar</h1>
            <p className="mt-3 max-w-2xl text-on-surface-variant">AISE-də toplanmış açıq elanları sərbəst araşdırın. Sizə uyğun tövsiyələr Uyğunluqlar bölməsindədir.</p>
            {catalogue && <p className="mt-3 font-semibold">Ümumi {formatNumber(catalogue.meta.totalOpen)} açıq vakansiya</p>}
          </div>
          <Link href="/dashboard/matches" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 product-action rounded-full bg-accent px-5 py-3 font-medium text-white">Uyğunluqlarımı gör <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
        </header>
        {!catalogue ? <div role="alert" className="rounded-2xl border border-outline-variant p-6">
          <p>{response?.status === 400 ? 'Axtarış parametrləri düzgün deyil. Filtrləri sıfırlayıb yenidən yoxlayın.' : 'Vakansiyalar hazırda yüklənə bilmir. Bir az sonra yenidən yoxlayın.'}</p>
          <Link href="/jobs" className="mt-3 inline-block min-h-11 py-3 font-medium text-accent underline">Yenidən yoxla</Link>
        </div> : <>
          <JobsFilterForm
            filters={filters}
            categories={catalogue.categories}
            sources={catalogue.sources}
            companies={catalogue.companies}
            workArrangements={catalogue.workArrangements}
            experienceLevels={catalogue.experienceLevels}
            activeCount={activeFilters.length}
          />

          {/* Active filter pills — visible only when at least one filter is set */}
          {activeFilters.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-2 min-w-0" aria-label="Aktiv filtrlər">
              <span className="text-xs font-semibold text-on-surface-variant shrink-0">Aktiv filtrlər:</span>
              {activeFilters.map((f) => (
                <Link
                  key={f.clearHref}
                  href={f.clearHref}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
                  aria-label={`${f.label} filtrini sil`}
                >
                  <span className="truncate max-w-[200px] sm:max-w-xs">{f.label}</span>
                  <X aria-hidden="true" className="h-3 w-3 shrink-0" />
                </Link>
              ))}
              <Link href="/jobs" className="text-xs font-semibold text-accent underline hover:no-underline shrink-0">Hamısını sıfırla</Link>
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-on-surface-variant">{formatNumber(catalogue.meta.total)} nəticə</p>
            {filters.application !== 'email' && <SaveSearchButton criteria={{ q: filters.q, company: filters.company, category: filters.category, location: filters.location, source: filters.source, work: filters.work, experience: filters.experience }} />}
          </div>

          {!catalogue.data.length ? <div className="rounded-2xl border border-outline-variant p-8 text-center"><h2 className="text-xl font-semibold">Bu filtrlərlə vakansiya tapılmadı</h2><p className="mt-2 text-on-surface-variant">Başqa kateqoriya, şəhər və ya axtarış sözü seçin.</p><Link href="/jobs" className="mt-3 inline-block min-h-11 py-3 text-accent underline">Bütün vakansiyalara bax</Link></div> :
            <ul className="grid gap-4 md:grid-cols-2">{catalogue.data.map((job) => <li key={`${job.kind}:${job.id}`} className="min-w-0 rounded-2xl border border-outline-variant bg-surface p-6">
              <div className="mb-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-surface-container px-3 py-1">{job.categoryLabel}</span><span className="rounded-full bg-surface-container px-3 py-1">{sourceLabel(job.source)}</span></div>
              <h2 className="break-words text-lg font-semibold"><Link href={`/jobs/${job.kind}/${encodeURIComponent(job.id)}`} className="tap-inline hover:text-accent">{job.title}</Link></h2>
              <p className="mt-2 flex items-start gap-2 break-words text-sm text-on-surface-variant"><Briefcase aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{job.company}</p>
              <p className="mt-2 flex items-start gap-2 break-words text-sm text-on-surface-variant"><MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{job.location || 'Yer göstərilməyib'}</p>
              <p className="mt-2 text-xs text-on-surface-variant">İş formatı: {factLabel(job.workArrangement, workFormatLabel)} · Təcrübə: {factLabel(job.experienceLevel, experienceLevelLabel)}</p>
              <p className="mt-3 text-xs text-on-surface-variant">Elan tarixi: {catalogueDate(job.postedAt)}{job.deadline ? ` · Son tarix: ${catalogueDate(job.deadline)}` : ''}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Link href={`/jobs/${job.kind}/${encodeURIComponent(job.id)}`} className="inline-flex min-h-11 items-center gap-2 font-medium text-accent">Ətraflı bax <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
                <SaveJobButton compact job={{ key: `${job.kind}:${job.id}`, title: job.title, company: job.company, location: job.location || null, deadline: job.deadline || null }} />
              </div>
            </li>)}</ul>}
          {catalogue.meta.totalPages > 1 && <nav aria-label="Vakansiya səhifələri" className="mt-8 flex flex-wrap items-center justify-center gap-4">
            {catalogue.meta.page > 1 && <Link href={`/jobs?${catalogueQuery(filters, catalogue.meta.page - 1)}`} className="min-h-11 rounded-xl border border-outline-variant px-4 py-3">Əvvəlki səhifə</Link>}
            <span className="text-sm">{catalogue.meta.page} / {catalogue.meta.totalPages}</span>
            {catalogue.meta.page < catalogue.meta.totalPages && <Link href={`/jobs?${catalogueQuery(filters, catalogue.meta.page + 1)}`} className="min-h-11 rounded-xl border border-outline-variant px-4 py-3">Növbəti səhifə</Link>}
          </nav>}
        </>}
      </main>
      <SiteFooter />
    </div>
  );
}
