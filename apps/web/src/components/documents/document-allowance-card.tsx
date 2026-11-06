'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, Clock, AlertCircle, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatBakuDateTime } from '@/lib/documents/baku-date';

export interface AllowanceView {
  plan: string;
  limit: number | null;
  used: number;
  reserved: number;
  remaining: number | null;
  period: string;
  resetsAt: string;
  protections: { concurrent?: number; perHour?: number } | null;
  costs: { perDocument: 1; cvAndLetter: 2 };
  generationAvailable?: boolean;
}

function formatBakuDate(isoString?: string | null): string {
  return isoString ? formatBakuDateTime(isoString) || isoString : '—';
}

function formatPlanLabel(plan: string): string {
  const p = (plan || '').toUpperCase();
  if (p === 'PREMIUM') return 'Premium Plan';
  if (p === 'PLUS') return 'Plus Plan';
  if (p === 'LIMITSIZ') return 'Limitsiz Plan';
  if (p === 'STANDARD') return 'Standart Plan';
  if (p === 'BASIC') return 'Baza Plan';
  if (p === 'FREE') return 'Ödənişsiz Plan';
  return `${plan} Planı`;
}

/** `refreshKey` changes whenever something that may change the balance happened (a generation started, finished or failed); the card then re-reads the server. */
export function DocumentAllowanceCard({ refreshKey = 0 }: { refreshKey?: number } = {}) {
  const [allowance, setAllowance] = useState<AllowanceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const fetchAllowance = async () => {
    // The skeleton shows only before the first answer; a re-read keeps the last known numbers on screen until the new ones arrive.
    setLoading((current) => current && allowance === null);
    setFailed(false);
    try {
      const res = await apiFetch('/documents/allowance');
      if (!res.ok) {
        throw new Error('Balans məlumatı alına bilmədi');
      }
      const data: AllowanceView = await res.json();
      setAllowance(data);
    } catch {
      setFailed(true);
      setAllowance(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllowance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // 1. Loading State
  if (loading) {
    return (
      <div
        className="product-card rounded-2xl bg-surface border border-outline-variant p-6 shadow-xs space-y-4 animate-pulse"
        data-testid="document-allowance-card"
      >
        <div className="flex items-center justify-between border-b border-outline-variant/60 pb-4">
          <div className="h-6 w-48 bg-neutral-dark/10 rounded-md" />
          <div className="h-6 w-24 bg-neutral-dark/10 rounded-md" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          <div className="h-24 bg-neutral-dark/5 rounded-xl" />
          <div className="h-24 bg-neutral-dark/5 rounded-xl" />
          <div className="h-24 bg-neutral-dark/5 rounded-xl" />
        </div>
      </div>
    );
  }

  // 2. Unavailable / Failed State (Do NOT fabricate fake free or 0 usage)
  if (failed || !allowance) {
    return (
      <div
        className="product-card rounded-2xl bg-surface border border-amber-200/80 bg-amber-50/20 p-6 shadow-xs space-y-4"
        data-testid="document-allowance-card"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="font-serif text-lg font-bold text-neutral-dark">
                Sənəd balansı məlumatı əlçatan deyil
              </h2>
              <p className="text-xs text-neutral-dark/70 mt-1">
                Serverlə əlaqə qurularkən xəta baş verdi. Cari sənəd limiti və qalıq məlumatı müəyyən edilə bilmədi.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchAllowance}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border border-neutral-dark/20 hover:bg-neutral-dark/5 transition-colors shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Yenidən yoxla</span>
          </button>
        </div>
      </div>
    );
  }

  // 3. Authorized State: check if unlimited or capped
  const isUnlimited = allowance.limit === null;
  const isExhausted = !isUnlimited && allowance.remaining !== null && allowance.remaining <= 0;
  const planLabel = formatPlanLabel(allowance.plan);
  const resetDateFormatted = formatBakuDate(allowance.resetsAt);

  const summary = isUnlimited
    ? `Bu ay ${allowance.used} sənəd hazırlanıb. Aylıq limit yoxdur.`
    : isExhausted
      ? `Bu ayın ${allowance.limit} sənədi istifadə olunub. Yenilənmə: ${resetDateFormatted}.`
      : `Bu ay ${allowance.remaining ?? 0} sənəd qalıb (${allowance.used} / ${allowance.limit} istifadə olunub). Yenilənmə: ${resetDateFormatted}.`;

  return (
    <section
      aria-labelledby="doc-allowance-h"
      className={`ui-card space-y-3 ${isExhausted ? 'border-amber-300' : ''}`}
      data-testid="document-allowance-card"
    >
      {allowance.generationAvailable === false && (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-medium text-neutral-dark" data-testid="generation-unavailable">
          Sənəd hazırlama hazırda əlçatan deyil. Mövcud sənədləri redaktə etmək, yükləmək və təsdiqləmək mümkündür.
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="doc-allowance-h" className="text-base font-semibold text-on-background">Sənəd balansı</h2>
            <span className={`ui-badge ${isExhausted ? 'ui-badge-warn' : 'ui-badge-good'}`}>{planLabel}</span>
            {allowance.reserved > 0 && (
              <span className="ui-badge ui-badge-progress"><Clock className="h-3 w-3" aria-hidden="true" />{allowance.reserved} hazırlanır</span>
            )}
          </div>
          <p className="mt-1 text-sm text-on-surface-variant" data-testid="document-allowance-summary">{summary}</p>
        </div>
        <Link href="/pricing" className={isExhausted ? 'ui-btn ui-btn-primary' : 'ui-btn ui-btn-quiet'}>
          <span>{isExhausted ? 'Planı yüksəlt' : 'Planlar'}</span>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {isExhausted && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <span>Yeni sənəd hazırlamaq üçün yenilənməni gözləyin və ya planınızı yüksəldin. Mövcud sənədləri redaktə etmək və yükləmək davam edir.</span>
        </p>
      )}

      <details className="group text-xs text-on-surface-variant">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 font-semibold text-on-background">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          Balans necə hesablanır
        </summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>1 sənəd = 1 vahid. CV, qısa rezüme və motivasiya məktubu eyni balansdan istifadə edir.</li>
          <li>Əsas CV yükləmək, mətni redaktə etmək və təsdiqlənmiş PDF-i yükləmək <strong>ödənişsizdir</strong>.</li>
          <li>Uğursuz hazırlıq balansdan çıxılmır.</li>
          {isUnlimited && allowance.protections && (
            <li>Sabitlik üçün eyni anda ən çox {allowance.protections.concurrent ?? 3} sənəd, saatda ən çox {allowance.protections.perHour ?? 30} sənəd hazırlanır.</li>
          )}
          <li>Dövr: {allowance.period} (Bakı vaxtı).</li>
        </ul>
      </details>
    </section>
  );
}
