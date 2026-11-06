'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log client error in console for debugging
    console.error('AISE Application error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-gutter py-12 text-on-background font-body-md">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-error/10 text-error border border-error/20 shadow-xs mb-2">
          <AlertTriangle className="h-8 w-8" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-error font-mono">
            Sistem xətası
          </span>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-on-background">
            Gözlənilməz xəta baş verdi
          </h1>
          <p className="text-sm text-on-surface-variant max-w-sm mx-auto leading-relaxed">
            Sistemdə müvəqqəti nasazlıq yarandı. Zəhmət olmasa yenidən cəhd edin və ya əsas səhifəyə qayıdın.
          </p>
        </div>

        {error.digest && (
          <p className="text-[11px] font-mono text-on-surface-variant/70 bg-surface-container-low px-3 py-1.5 rounded-lg border border-outline-variant/40 inline-block">
            Xəta kodu: {error.digest}
          </p>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex min-h-11 w-full sm:w-auto items-center justify-center gap-2 product-action rounded-full bg-accent px-6 py-3 font-medium text-white hover:bg-accent-hover transition-colors shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>Yenidən cəhd et</span>
          </button>
          <Link
            href="/"
            className="inline-flex min-h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-xl border border-outline-variant bg-surface-container-low px-6 py-3 font-medium text-on-background hover:bg-surface-container transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            <span>Əsas səhifə</span>
          </Link>
        </div>

        <div className="pt-6 border-t border-outline-variant/30">
          <p className="text-xs text-on-surface-variant">
            Xəta təkrarlanarsa, zəhmət olmasa{' '}
            <Link href="/contact" className="text-accent font-semibold hover:underline">
              dəstək xidmətinə bildirin
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
