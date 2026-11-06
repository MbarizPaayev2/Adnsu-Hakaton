'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Clock } from 'lucide-react';
import type { BlogArticle } from '@/lib/blog/articles';

type Summary = Pick<BlogArticle,'slug'|'title'|'description'|'tags'|'readTimeMinutes'|'updatedAt'|'tool'>;
const fold=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ə/g,'e').replace(/ı/g,'i');
export function ArticleBrowser({ articles }: {articles: Summary[]}) {
  const [query,setQuery]=useState('');
  const [topic,setTopic]=useState('Hamısı');
  const found=[...articles].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).filter(a=>{
    const hay=fold([a.title,a.description,...a.tags].join(' '));
    return (topic==='Hamısı'||hay.includes(fold(topic))) && fold(query).split(/\s+/).every(word=>hay.includes(word));
  });
  return <section aria-label="Məqalələr siyahısı" className="space-y-5">
    <div className="space-y-4"><label htmlFor="article-search" className="block text-sm font-semibold">Sizə nə lazımdır?<input id="article-search" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Məsələn: junior, SQL, CV, müsahibə" className="mt-2 w-full max-w-2xl rounded-2xl border border-outline-variant bg-surface px-4 py-3 font-normal"/></label>
      <div className="flex flex-wrap gap-2" aria-label="Mövzular">{['Hamısı','Junior+','Mid və senior','CV','Müsahibə'].map(t=><button type="button" key={t} aria-pressed={topic===t} onClick={()=>setTopic(t)} className={`min-h-10 rounded-full border px-4 text-sm ${topic===t?'border-primary bg-primary text-white':'border-outline-variant bg-surface text-on-background'}`}>{t}</button>)}</div>
      <p role="status" className="text-sm text-on-surface-variant">{found.length} məqalə</p>
    </div>
    {!found.length && <div className="rounded-2xl border border-outline-variant p-6"><p>Axtarışa uyğun məqalə tapılmadı.</p><button className="mt-3 min-h-10 text-primary underline" type="button" onClick={()=>{setQuery('');setTopic('Hamısı');}}>Bütün məqalələri göstər</button></div>}
    <div className="grid gap-5 md:grid-cols-2">{found.map(a=><article key={a.slug} className="flex flex-col justify-between rounded-3xl border border-outline-variant bg-surface p-6 sm:p-7">
      <div><div className="flex flex-wrap gap-2 text-xs text-on-surface-variant">{a.tags.slice(0,3).map(t=><span key={t} className="rounded-full bg-surface-container px-2.5 py-1">{t}</span>)}{a.tool && <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">İnteraktiv alət</span>}</div>
      <h2 className="mt-4 text-xl font-semibold leading-snug"><Link className="hover:underline" href={`/blog/${a.slug}`}>{a.title}</Link></h2><p className="mt-3 text-sm leading-relaxed text-on-surface-variant">{a.description}</p></div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/50 pt-4 text-sm"><span className="inline-flex items-center gap-1.5 text-on-surface-variant"><Clock size={15} aria-hidden="true"/>{a.readTimeMinutes} dəqiqə</span><Link aria-label={`${a.title} məqaləsini oxu`} className="inline-flex min-h-10 items-center gap-1 font-semibold text-primary" href={`/blog/${a.slug}`}>Oxu və tətbiq et<ArrowRight size={16} aria-hidden="true"/></Link></div>
    </article>)}</div>
  </section>;
}
