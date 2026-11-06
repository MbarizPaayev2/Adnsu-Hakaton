import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { ObservedCompanyDirectory } from '@/components/retention/observed-company-directory';

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; sort?: string }> }) {
  const params = await searchParams;
  const response = await apiFetch('/companies', { cache: 'no-store' }).catch(() => null);
  const registered: { id: string; name: string; _count?: { vacancies: number } }[] = response?.ok ? await response.json() : [];
  const matches = registered.filter(c => !params.q || c.name.toLocaleLowerCase('az').includes(params.q.toLocaleLowerCase('az')));
  return <div className="space-y-6">
    <ObservedCompanyDirectory searchParams={Promise.resolve(params)} basePath="/dashboard/companies" />
    <section className="px-4 space-y-3" aria-label="AISE-də qeydiyyatdan keçmiş şirkətlər">
      <h2 className="text-xl font-semibold">AISE-də qeydiyyatdan keçmiş şirkətlər</h2>
      {!response?.ok ? <p role="alert">Qeydiyyatdan keçmiş şirkətlər yüklənmədi.</p> : matches.length === 0 ? <p className="text-sm text-neutral-dark/70">Bu axtarışa uyğun qeydiyyatdan keçmiş şirkət yoxdur. Toplanmış elanların şirkətləri yuxarıda göstərilir.</p> :
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{matches.map(c => <Link className="product-card rounded-xl border p-4" href={`/dashboard/companies/${c.id}`} key={c.id}><h3 className="font-semibold">{c.name}</h3><p className="text-sm">{c._count?.vacancies ?? 0} aktiv vakansiya · AISE-də qeydiyyatdan keçib</p></Link>)}</div>}
    </section>
  </div>;
}
