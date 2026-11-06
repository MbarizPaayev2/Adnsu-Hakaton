'use client';

import React, { useEffect, useState } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { loadRetentionApi, type RetentionApi } from '@/lib/retention/api';
import { RetentionError, type JobRef } from '@/lib/retention/contract';

/**
 * Save / unsave control. Optimistic with rollback: if the call fails the
 * previous state is restored and a retry is offered. Hidden entirely when the
 * feature is unavailable (no dead button on public cards).
 * Always a sibling of a card's link, never nested inside one.
 */
export function SaveJobButton({ job, compact = false }: { job: JobRef; compact?: boolean }) {
  const [api, setApi] = useState<RetentionApi | null>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<boolean>(false);
  const [announce, setAnnounce] = useState('');
  const [loginHref, setLoginHref] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadRetentionApi()
      .then(async (a) => {
        if (a.mode === 'unavailable') return;
        let value = false;
        try { value = await a.isJobSaved(job.key); } catch (error) {
          // Signed out: saving needs an account, so the button leads to sign-in and back instead of failing on press.
          if (error instanceof RetentionError && error.code === 'SIGNED_OUT') {
            if (alive) setLoginHref(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
            return;
          }
        }
        if (alive) { setApi(a); setSaved(value); }
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [job.key]);

  const look = (on: boolean) => `inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden ${on ? 'border-primary bg-highlight text-primary' : 'border-outline-variant bg-surface text-on-background hover:bg-surface-container'}`;

  if (loginHref) {
    return (
      <a href={loginHref} aria-label={`Yadda saxlamaq üçün daxil olun: ${job.title}`} className={look(false)}>
        <Bookmark aria-hidden="true" className="h-4 w-4" />
        {!compact && <span>Saxla</span>}
      </a>
    );
  }

  if (!api || saved === null) return null;

  const toggle = async () => {
    const previous = saved;
    const next = !previous;
    setSaved(next); setBusy(true); setFailed(false);
    try {
      if (next) await api.saveJob(job); else await api.unsaveJob(job.key);
      setAnnounce(next ? 'Elan yadda saxlanıb.' : 'Elan yadda saxlanılanlardan silindi.');
    } catch {
      setSaved(previous);
      setFailed(true);
      setAnnounce('Əməliyyat alınmadı. Yenidən cəhd edin.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved}
        aria-busy={busy}
        aria-label={saved ? `Yadda saxlanıb, silmək üçün basın: ${job.title}` : `Yadda saxla: ${job.title}`}
        className={look(saved)}
      >
        {saved ? <BookmarkCheck aria-hidden="true" className="h-4 w-4" /> : <Bookmark aria-hidden="true" className="h-4 w-4" />}
        {!compact && <span>{saved ? 'Saxlanıb' : 'Saxla'}</span>}
      </button>
      {failed && (
        <span role="alert" className="flex items-center gap-2 text-xs text-red-700">
          Alınmadı.
          <button type="button" onClick={toggle} className="min-h-11 px-1 font-semibold underline focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden">Yenidən cəhd et</button>
        </span>
      )}
      <span className="sr-only" aria-live="polite">{announce}</span>
    </div>
  );
}
