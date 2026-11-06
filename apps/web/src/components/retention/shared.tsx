'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, FlaskConical, Loader2 } from 'lucide-react';
import { loadRetentionApi, isUnavailable, type RetentionApi } from '@/lib/retention/api';
import { RetentionError } from '@/lib/retention/contract';
import { initialsOf } from '@/lib/retention/companies';

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T; mode: RetentionApi['mode'] }
  | { status: 'unavailable' }
  | { status: 'error'; message?: string };

/** Loads through the adapter; `reload` powers every Retry button. */
export function useRetention<T>(loader: (api: RetentionApi) => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const revision = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const reload = useCallback(async () => {
    const request = ++revision.current;
    setState({ status: 'loading' });
    try {
      const api = await loadRetentionApi();
      const data = await loaderRef.current(api);
      if (request === revision.current) setState({ status: 'ready', data, mode: api.mode });
    } catch (error) {
      if (request !== revision.current) return;
      if (isUnavailable(error)) setState({ status: 'unavailable' });
      else setState({ status: 'error', message: error instanceof RetentionError && (error.code === 'SIGNED_OUT' || error.code === 'RATE_LIMITED') ? error.message : undefined });
    }
  }, []);
  useEffect(() => { void reload(); return () => { revision.current++; }; }, [reload]);
  return { state, setState, reload };
}

export function FixtureNotice({ mode }: { mode: RetentionApi['mode'] }) {
  if (mode !== 'fixture') return null;
  return (
    <p role="note" className="flex items-start gap-2 rounded-xl border border-dashed border-outline bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
      <FlaskConical aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span><strong>Nümunə rejimi.</strong> Bu seçimlər yalnız bu brauzerdə saxlanır; hesabınıza yazılmır.</span>
    </p>
  );
}

export function LoadingBlock({ label = 'Yüklənir…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-2xl border border-outline-variant bg-surface p-6 text-sm text-on-surface-variant">
      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> {label}
    </div>
  );
}

export function ErrorBlock({ onRetry, text = 'Məlumat yüklənmədi.' }: { onRetry: () => void; text?: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <span className="flex items-center gap-2"><AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />{text}</span>
      <button type="button" onClick={onRetry} className="min-h-11 rounded-full border border-red-300 bg-white px-4 font-semibold focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden">Yenidən cəhd et</button>
    </div>
  );
}

/** Honest "not live yet" message that still leaves the user somewhere useful to go. */
export function UnavailableBlock({ title, alt }: { title: string; alt: { href: string; label: string } }) {
  const ActionLink = alt.href === '/business/billing' ? 'a' : Link;
  return (
    <div role="status" className="rounded-2xl border border-outline-variant bg-surface p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-on-surface-variant">Bu imkan hələ aktiv deyil. Heç nə yadda saxlanmır.</p>
      <ActionLink href={alt.href} className="mt-4 inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden">{alt.label}</ActionLink>
    </div>
  );
}

import { CompanyLogo } from '@/components/company-logo';

/**
 * Employer mark. Reuses CompanyLogo to preserve authenticated uploads flow,
 * with clean monogram initials fallback when the logo is missing or failed.
 */
export function CompanyMark({ name, src, size = 40 }: { name: string; src?: string; size?: number }) {
  const style = { width: size, height: size, minWidth: size };
  return (
    <div style={style} className="shrink-0 flex items-center justify-center">
      <CompanyLogo
        src={src}
        alt={name}
        name={name}
        className="h-full w-full rounded-xl border border-outline-variant bg-surface-container object-cover"
      />
    </div>
  );
}
