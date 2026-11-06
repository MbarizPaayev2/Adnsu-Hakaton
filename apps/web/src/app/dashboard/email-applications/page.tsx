import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Mail, Settings2 } from 'lucide-react';
import { catalogueDate, catalogueFilters, catalogueQuery, fetchCatalogue, type CatalogueResponse } from '@/lib/job-catalogue';
import { emailApplicationAvailability } from '@/lib/document-availability';

export const metadata: Metadata = { title: 'E-poçt müraciətləri — AISE' };
const PATH = '/dashboard/email-applications';
const CONTROL = 'min-h-11 w-full min-w-0 rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm';

export default async function EmailApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = catalogueFilters(await searchParams);
  const filters = { q: input.q, company: input.company, page: input.page, application: 'email' };
  const [response, enabled] = await Promise.all([fetchCatalogue(`/jobs?${catalogueQuery(filters)}`), emailApplicationAvailability()]);
  let catalogue: CatalogueResponse | null = null;
  if (response?.ok) { try { catalogue = await response.json(); } catch { /* Unavailable is distinct from zero results. */ } }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="product-page-title text-2xl font-semibold sm:text-3xl">E-poçt müraciətləri</h1>
          <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">Müraciət üçün e-poçt ünvanı göstərən elanları tapın. Elanı açın, CV və məktubu yoxlayın, sonra göndərişi təsdiqləyin.</p>
        </div>
        <Link href={`${PATH}/settings`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-outline-variant px-4 py-2 text-sm font-medium"><Settings2 className="h-4 w-4" aria-hidden="true" /> Agent və göndəriş qaydaları</Link>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <p>Qaralama hazırlanması göndəriş deyil. Hər müraciəti özünüz təsdiqləyirsiniz; planınızdakı e-poçt limiti tətbiq olunur.</p>
        <Link href="/dashboard/applications#review" className="inline-flex min-h-11 items-center gap-2 font-medium text-primary">Hazır müraciətlərim <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </div>
      {enabled !== true && <p role="alert" className="rounded-xl border border-outline-variant p-4 text-sm">{enabled === false ? 'E-poçt göndərişi hazırda aktiv deyil. Elanlara baxa və sənədlərinizi hazırlaya bilərsiniz.' : 'Göndəriş xidmətinin vəziyyəti yoxlanıla bilmədi. Elanı açanda mövcud imkanları yenidən yoxlayırıq.'}</p>}
      <section aria-labelledby="email-employers-title" className="space-y-4">
        <div><h2 id="email-employers-title" className="text-lg font-semibold">E-poçtla müraciət qəbul edən vakansiyalar</h2>
          <p className="mt-1 text-sm text-on-surface-variant">Ünvan konkret elanda göstərilməlidir. Şirkətin digər vakansiyaları fərqli müraciət üsulu tələb edə bilər.</p></div>
        <form action={PATH} method="get" className="grid gap-3 rounded-2xl border border-outline-variant bg-surface p-4 sm:grid-cols-[1fr_1fr_auto]">
          <label className="min-w-0 space-y-1 text-sm font-medium">Vəzifə və ya şirkət<input name="q" defaultValue={filters.q} maxLength={100} className={CONTROL} placeholder="Məsələn, məlumat analitiki" /></label>
          <label className="min-w-0 space-y-1 text-sm font-medium">İşəgötürən<select name="company" defaultValue={filters.company || ''} className={CONTROL}>
            <option value="">Bütün işəgötürənlər</option>
            {filters.company && !catalogue?.companies.some((c) => c.company === filters.company) && <option value={filters.company}>{filters.company}</option>}
            {catalogue?.companies.map((company) => <option key={company.company} value={company.company}>{company.company} ({company.count})</option>)}
          </select></label>
          <button type="submit" className="min-h-11 self-end rounded-full bg-primary px-5 py-2 text-sm font-medium text-white">Axtar</button>
        </form>
        {!catalogue ? <div role="alert" className="rounded-2xl border border-outline-variant p-5"><p>{response?.status === 400 ? 'Axtarış parametrləri düzgün deyil.' : 'Vakansiyalar yüklənə bilmədi.'}</p><Link href={PATH} className="mt-2 inline-block min-h-11 py-2 text-primary underline">Yenidən yoxla</Link></div> : <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p>{catalogue.meta.total} vakansiya</p>{(filters.q || filters.company) && <Link href={PATH} className="min-h-11 py-2 text-primary underline">Filtrləri sıfırla</Link>}</div>
          {!catalogue.data.length ? <div className="rounded-2xl border border-outline-variant p-6"><h3 className="font-semibold">Bu seçimlə açıq e-poçt vakansiyası tapılmadı</h3><p className="mt-2 text-sm text-on-surface-variant">Başqa vəzifə və ya işəgötürən seçin. Digər müraciət üsulları bütün vakansiyalar bölməsindədir.</p><Link href="/jobs" className="mt-3 inline-block min-h-11 py-2 text-primary underline">Bütün vakansiyalara bax</Link></div> :
            <ul className="grid gap-4 md:grid-cols-2">{catalogue.data.map((job) => <li key={job.id} className="min-w-0 rounded-2xl border border-outline-variant bg-surface p-5">
              <p className="inline-flex items-center gap-2 text-xs font-medium text-primary"><Mail className="h-4 w-4" aria-hidden="true" /> Elanda e-poçt ünvanı göstərilib</p>
              <h3 className="mt-3 break-words text-lg font-semibold"><Link href={`/jobs/imported/${encodeURIComponent(job.id)}`}>{job.title}</Link></h3>
              <p className="mt-1 break-words text-sm text-on-surface-variant">{job.company} · {job.location || 'Yer göstərilməyib'}</p>
              {job.deadline && <p className="mt-2 text-xs text-on-surface-variant">Son tarix: {catalogueDate(job.deadline)}</p>}
              <Link href={`/jobs/imported/${encodeURIComponent(job.id)}`} className="mt-3 inline-flex min-h-11 items-center gap-2 font-medium text-primary">Elanı aç və müraciətə başla <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </li>)}</ul>}
          {catalogue.meta.totalPages > 1 && <nav aria-label="E-poçt vakansiyalarının səhifələri" className="flex flex-wrap items-center justify-center gap-4 text-sm">
            {catalogue.meta.page > 1 && <Link href={`${PATH}?${catalogueQuery(filters, catalogue.meta.page - 1)}`} className="min-h-11 rounded-xl border border-outline-variant px-4 py-3">Əvvəlki</Link>}
            <span>{catalogue.meta.page} / {catalogue.meta.totalPages}</span>
            {catalogue.meta.page < catalogue.meta.totalPages && <Link href={`${PATH}?${catalogueQuery(filters, catalogue.meta.page + 1)}`} className="min-h-11 rounded-xl border border-outline-variant px-4 py-3">Növbəti</Link>}
          </nav>}
        </>}
      </section>
    </div>
  );
}
