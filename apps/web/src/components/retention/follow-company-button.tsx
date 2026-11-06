'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { UserCheck, UserPlus, Loader2, LogIn } from 'lucide-react';
import { loadRetentionApi, type RetentionApi } from '@/lib/retention/api';
import { RetentionError } from '@/lib/retention/contract';

export interface FollowCompanyButtonProps {
  /** Normalized-name key returned by the observed public company endpoint. */
  followKey?: string;
  companyId?: string;
  companyName: string;
  /** @deprecated use companyId */
  companyKey?: string;
}

export function FollowCompanyButton({ companyId, followKey, companyName, companyKey }: FollowCompanyButtonProps) {
  const rawId = companyId || companyKey || '';
  // Registered employers use stable ids; observed employers use their API-issued normalized-name key.
  const targetId = followKey || (!rawId ? '' : rawId.includes(':') ? rawId : `company:${rawId}`);
  const [api, setApi] = useState<RetentionApi | null>(null);
  const [isFollowed, setIsFollowed] = useState<boolean | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!targetId) return;
    loadRetentionApi()
      .then(async (a) => {
        if (a.mode === 'unavailable') return;
        let followedList: string[];
        try {
          followedList = await a.listFollowed();
        } catch (error) {
          if (error instanceof RetentionError && error.code === 'SIGNED_OUT' && alive) setSignedOut(true);
          return;
        }
        if (alive) {
          setApi(a);
          setIsFollowed(followedList.includes(targetId));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [targetId]);

  if (signedOut) {
    const returnTo = typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`;
    return <Link href={`/login?next=${encodeURIComponent(returnTo)}`} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-outline-variant bg-surface px-4 text-xs font-semibold text-on-background hover:bg-surface-container"><LogIn className="h-3.5 w-3.5" aria-hidden="true" /><span>İzləmək üçün daxil olun</span></Link>;
  }
  if (!api || isFollowed === null) return null;

  const handleToggle = async () => {
    const prev = isFollowed;
    const next = !prev;
    setIsFollowed(next);
    setBusy(true);
    setError(null);

    try {
      await api.setFollowed(targetId, next, companyName);
    } catch (error) {
      setIsFollowed(prev);
      if (error instanceof RetentionError && error.code === 'SIGNED_OUT') setSignedOut(true);
      else setError(error instanceof RetentionError ? error.message : 'İzləmə vəziyyətini dəyişmək mümkün olmadı.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={busy}
        aria-pressed={isFollowed}
        aria-label={isFollowed ? `${companyName} izlənilir, dayandırmaq üçün basın` : `${companyName} şirkətini izlə`}
        className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden ${
          isFollowed
            ? 'border border-primary bg-highlight text-primary hover:bg-highlight/80'
            : 'border border-outline-variant bg-surface text-on-background hover:bg-surface-container'
        }`}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : isFollowed ? (
          <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span>{isFollowed ? 'İzlənilir' : 'İzlə'}</span>
      </button>
      {error && (
        <span role="alert" className="text-[11px] text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}
