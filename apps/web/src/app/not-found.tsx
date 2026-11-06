import React from 'react';
import Link from 'next/link';
import { ArrowRight, FileQuestion, Home, Search } from 'lucide-react';
import { SiteNav } from '@/components/landing/site-nav';
import { SiteFooter } from '@/components/landing/site-footer';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-background font-body-md text-body-md text-on-background">
      <SiteNav />

      <main className="grow flex items-center justify-center pt-32 pb-20 px-gutter md:px-landing-xl">
        <div className="max-w-xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-surface-container-high text-accent border border-outline-variant/60 shadow-xs mb-2">
            <FileQuestion className="h-8 w-8" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-accent font-mono">
              Xəta 404
            </span>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-on-background">
              Səhifə tapılmadı
            </h1>
            <p className="text-sm md:text-base text-on-surface-variant max-w-md mx-auto leading-relaxed">
              Axtardığınız səhifə silinmiş, ünvanı dəyişdirilmiş və ya müvəqqəti əlçatmaz ola bilər.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <Link
              href="/"
              className="inline-flex min-h-11 w-full sm:w-auto items-center justify-center gap-2 product-action rounded-full bg-accent px-6 py-3 font-medium text-white hover:bg-accent-hover transition-colors shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
            >
              <Home className="h-4 w-4" aria-hidden="true" />
              <span>Əsas səhifəyə qayıt</span>
            </Link>
            <Link
              href="/jobs"
              className="inline-flex min-h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-xl border border-outline-variant bg-surface-container-low px-6 py-3 font-medium text-on-background hover:bg-surface-container transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              <span>Vakansiyalara bax</span>
            </Link>
          </div>

          <div className="pt-6 border-t border-outline-variant/40">
            <p className="text-xs text-on-surface-variant">
              Kömək lazımdır?{' '}
              <Link href="/contact" className="text-accent font-semibold hover:underline inline-flex items-center gap-1">
                <span>Dəstək xidmətinə yazın</span>
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </p>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
