import Link from 'next/link';
import { ArrowUpRight, BookOpen } from 'lucide-react';
import { getAllArticles } from '@/lib/blog/articles';

export function CareerGuides() {
  const all=getAllArticles();
  const selected=all.filter(a=>a.tool).slice(0,3);
  return <section aria-labelledby="career-guides-title" className="mx-auto w-[calc(100%-40px)] max-w-6xl py-12 sm:py-16">
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Oxu · sına · öz müraciətinə tətbiq et</p><h2 id="career-guides-title" className="mt-3 text-2xl sm:text-3xl font-semibold text-on-background">CV və karyera bələdçiləri</h2><p className="mt-2 text-sm text-on-surface-variant">Junior, mid və senior namizədlər üçün praktik nümunələr və interaktiv alətlər.</p></div>
      <Link href="/blog" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary underline">Bütün məqalələr <ArrowUpRight size={17} aria-hidden="true"/></Link>
    </div>
    <div className="grid gap-4 md:grid-cols-3">{selected.map(a=><article key={a.slug} className="rounded-2xl border border-outline-variant bg-surface p-5 sm:p-6">
      <p className="flex items-center gap-2 text-xs font-medium text-primary"><BookOpen size={16} aria-hidden="true"/>{a.tool?'İnteraktiv alət daxildir':'Praktik bələdçi'}</p>
      <h3 className="mt-4 text-lg font-semibold leading-snug"><Link className="text-on-background hover:underline" href={`/blog/${a.slug}`}>{a.title}</Link></h3>
      <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">{a.description}</p>
      <Link href={`/blog/${a.slug}${a.tool?'#praktik-alet':''}`} className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary">{a.tool?'Aləti sına':'Bələdçini oxu'}<ArrowUpRight size={16} aria-hidden="true"/></Link>
    </article>)}</div>
  </section>;
}
