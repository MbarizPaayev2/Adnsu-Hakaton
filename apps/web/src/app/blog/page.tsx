import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { SiteNav } from '@/components/landing/site-nav';
import { SiteFooter } from '@/components/landing/site-footer';
import { getAllArticles } from '@/lib/blog/articles';
import { ArticleBrowser } from '@/components/blog/article-browser';

export const metadata: Metadata = {
  title: 'Karyera bələdçisi və məqalələr — AISE',
  description:
    'Vakansiyaya uyğun CV, motivasiya məktubu, ATS sistemləri və müsahibəyə hazırlıq üzrə praktik bələdçilər və məqalələr.',
  alternates: {
    canonical: 'https://aisehr.com/blog',
  },
  openGraph: {
    title: 'Karyera bələdçisi və məqalələr — AISE',
    description:
      'Vakansiyaya uyğun CV, motivasiya məktubu, ATS sistemləri və müsahibəyə hazırlıq üzrə praktik bələdçilər və məqalələr.',
    url: 'https://aisehr.com/blog',
    siteName: 'AISE',
    locale: 'az_AZ',
    type: 'website',
    images: [{ url: 'https://aisehr.com/blog/opengraph-image', width:1200, height:630, alt:'AISE karyera bələdçiləri' }],
  },
};

export default function BlogIndexPage() {
  const articles = getAllArticles();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Ana səhifə',
        item: 'https://aisehr.com',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Karyera bələdçisi',
        item: 'https://aisehr.com/blog',
      },
    ],
  };

  return (
    <div className="grow bg-background font-body-md text-body-md text-on-background flex flex-col min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteNav />

      <main className="grow pt-32 pb-20 md:pt-40 md:pb-28 px-gutter md:px-landing-xl">
        <div className="max-w-5xl mx-auto space-y-8">
          {/* Header section */}
          <header className="space-y-4 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
              <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Bələdçilər və məqalələr</span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-bold text-on-background tracking-tight">
              CV və karyera bələdçiləri
            </h1>
            <p className="text-base sm:text-lg text-on-surface-variant leading-relaxed">
              Junior, mid və senior üçün CV, layihə və müsahibə bələdçiləri. Oxuyun, interaktiv alətləri sınayın, öz müraciətinizə tətbiq edin.
            </p>
          </header>

          <ArticleBrowser articles={articles.map(a=>({slug:a.slug,title:a.title,description:a.description,tags:a.tags,readTimeMinutes:a.readTimeMinutes,updatedAt:a.updatedAt,tool:a.tool}))}/>

          <aside aria-label="Şərti nümunələr haqqında qeyd" className="text-xs leading-relaxed text-on-surface-variant">
            Nümunələr şərtidir. Sənədlərinizdə yalnız öz faktlarınızı yazın; işə qəbul zəmanəti verilmir.
          </aside>

          {/* Quick links to active tools */}
          <footer className="rounded-3xl border border-outline-variant/60 bg-surface-container-low/40 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="font-semibold text-on-background">Növbəti müraciətiniz üçün vakansiya tapın</h3>
              <p className="text-sm text-on-surface-variant">
                Azərbaycan əmək bazarında toplanan aktiv elanları araşdırın, ödənişsiz və ödənişli planlarla tanış olun.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Link
                href="/jobs"
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-colors"
              >
                Vakansiyalar
              </Link>
              <Link
                href="/pricing"
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-outline-variant hover:bg-surface-container transition-colors"
              >
                Planlar
              </Link>
            </div>
          </footer>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
