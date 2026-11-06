'use client';

import React from 'react';
import { CalendarClock, CreditCard, Sparkles } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { daysLeft, nextPublicationText, type PlansOverview } from '@/lib/business-plans';

/**
 * The company's plan state exactly as the server reports it: trial, paid listing credits, Business subscription and what the next publication
 * will use. Renders nothing when plans are not switched on (the vacancy flow is then unchanged) or when the server could not be read.
 */
export function PlanSummary({ overview, compact = false }: { overview: PlansOverview | null; compact?: boolean }) {
  if (!overview || !overview.gated) return null;
  const trialDays = overview.trial.endsAt ? daysLeft(overview.trial.endsAt) : null;
  const trialRunning = overview.trial.used && overview.trial.endsAt && new Date(overview.trial.endsAt) > new Date();

  const rows: { label: string; value: string }[] = [];
  if (overview.business.active) {
    const until = overview.business.currentPeriodEnd ? formatDate(overview.business.currentPeriodEnd) : null;
    rows.push({
      label: 'Biznes',
      value: overview.business.cancelAtPeriodEnd
        ? `Ləğv edilib, ${until ?? 'cari dövrün sonu'} tarixinədək aktivdir`
        : `Aktiv${until ? `, növbəti ödəniş ${until}` : ''}. Vakansiya sayı məhdud deyil.`,
    });
  } else if (overview.business.status) {
    rows.push({ label: 'Biznes', value: 'Abunəlik aktiv deyil. Mövcud müraciətlər və məlumatlar saxlanılır; abunəlik bərpa olunanda dayandırılmış elanlar yenidən açılır.' });
  }
  rows.push({
    label: 'Sınaq',
    value: overview.trial.available
      ? `İlk vakansiyanı yayımladığınız gündən ${overview.prices.trialDays} gün ödənişsizdir. Hər şirkət üçün bir dəfə.`
      : trialRunning
        ? `Davam edir${trialDays !== null ? `, ${trialDays} gün qalıb` : ''} (${formatDate(overview.trial.endsAt!)} tarixinədək).`
        : overview.trial.used
          ? 'İstifadə olunub.'
          : 'Bu şirkət üçün əlçatan deyil (eyni şirkət adı və ya sayt ilə sınaq artıq istifadə edilib).',
  });
  rows.push({
    label: 'Tək vakansiya',
    value: overview.credits.available > 0
      ? `${overview.credits.available} işlənməmiş kredit (hər biri ${overview.prices.singleDays} gün).`
      : `İşlənməmiş kredit yoxdur. Qiymət ${overview.prices.singleAzn} AZN, ${overview.prices.singleDays} gün, avtomatik yenilənmir.`,
  });

  return (
    <section aria-labelledby="plan-summary-title" className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-5 sm:p-6 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 id="plan-summary-title" className="font-serif text-xl font-bold text-neutral-dark">Plan və yayım hüququ</h2>
        </div>
        <a href="/business/billing" className="tap text-xs font-semibold text-accent hover:underline inline-flex items-center gap-1 shrink-0">
          <CreditCard className="h-3.5 w-3.5" aria-hidden="true" /> Tariflər
        </a>
      </div>
      {!compact && (
        <dl className="mt-4 space-y-3 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-1 gap-0.5 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
              <dt className="font-semibold text-neutral-dark">{r.label}</dt>
              <dd className="text-neutral-dark/75">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-background-warm/40 border border-neutral-dark/10 p-3 text-xs text-neutral-dark/80">
        <CalendarClock className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden="true" />
        <span><strong>Növbəti yayımda:</strong> {nextPublicationText(overview)}</span>
      </p>
    </section>
  );
}
