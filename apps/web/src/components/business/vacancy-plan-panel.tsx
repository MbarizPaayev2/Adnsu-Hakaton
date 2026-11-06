'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { callPlans, nextAction, STATUS_LABEL, PLAN_LABEL, daysLeft, type PlanVacancy, type PlansOverview } from '@/lib/business-plans';
import { formatDate } from '@/lib/format';

/**
 * Per-vacancy publication state and the one next step, under employer plans. What it will cost is shown before the click; the server then decides
 * (entitlement, moderation, expiry) and its answer is shown as it is. Renders nothing when plans are off.
 */
export function VacancyPlanPanel({
  vacancy,
  overview,
  onChanged,
}: {
  vacancy: PlanVacancy;
  overview: PlansOverview | null;
  /** Called with the server's updated vacancy (and the caller should refresh the plan overview). */
  onChanged: (updated: Partial<PlanVacancy> & { id: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  if (!overview || !overview.gated) return null;
  if (vacancy.status === 'DELETED' || vacancy.status === 'PAUSED') {
    return vacancy.status === 'PAUSED' && vacancy.expiresAt ? (
      <p className="text-xs text-neutral-dark/65">Dayandırılıb. Yayım müddəti {formatDate(vacancy.expiresAt)} tarixinədək davam edir.</p>
    ) : null;
  }

  const action = nextAction(vacancy, overview);
  const left = vacancy.status === 'ACTIVE' ? daysLeft(vacancy.expiresAt) : null;

  const run = async () => {
    if (busy) return;
    const path =
      action.kind === 'submit' ? 'submit' : action.kind === 'publish' ? 'publish' : action.kind === 'extend' ? 'extend' : action.kind === 'reconfirm' ? 'reconfirm' : null;
    if (!path) return;
    setBusy(true);
    setMessage(null);
    const r = await callPlans(`/vacancies/${vacancy.id}/${path}`, { method: 'POST' });
    setBusy(false);
    if (r.ok && r.data) {
      onChanged({ id: vacancy.id, ...r.data });
      setMessage({
        tone: 'ok',
        text:
          path === 'submit' ? 'Vakansiya yoxlamaya göndərildi.'
          : path === 'publish' ? 'Vakansiya yayımlandı.'
          : path === 'extend' ? 'Yayım müddəti uzadıldı.'
          : 'Elanın aktual olduğu təsdiqləndi.',
      });
    } else {
      setMessage({ tone: 'error', text: r.message ?? 'Əməliyyat alınmadı.' });
    }
  };

  return (
    <div className="mt-2 space-y-2 text-xs" data-testid="vacancy-plan-panel">
      <p className="text-neutral-dark/80">
        <span className="font-semibold">{STATUS_LABEL[vacancy.status]}</span>
        {vacancy.status === 'ACTIVE' && vacancy.publicationPlan ? <> · {PLAN_LABEL[vacancy.publicationPlan]}</> : null}
        {left !== null && vacancy.expiresAt ? <> · {formatDate(vacancy.expiresAt)} tarixinədək ({left} gün)</> : null}
      </p>
      {action.hint ? <p className="text-neutral-dark/65">{action.hint}</p> : null}
      {action.cost ? <p className="font-medium text-neutral-dark/80">{action.cost}</p> : null}
      {action.kind === 'buy' ? (
        <a href="/business/billing" className="tap inline-flex min-h-9 items-center rounded-2xl bg-primary px-4 py-2 text-left text-xs font-semibold text-white hover:bg-primary-hover">
          {action.label}
        </a>
      ) : action.kind === 'edit' ? (
        <Link href={`/business/vacancies/${vacancy.id}/edit`} className="tap inline-flex min-h-9 items-center rounded-full border border-neutral-dark/20 px-4 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5">
          {action.label}
        </Link>
      ) : action.kind !== 'none' ? (
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="tap inline-flex min-h-9 items-center rounded-2xl bg-primary px-4 py-2 text-left text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {busy ? 'Gözləyin…' : action.label}
        </button>
      ) : null}
      <div aria-live="polite" role="status" className="min-h-0">
        {message ? (
          <p className={message.tone === 'ok' ? 'font-medium text-emerald-800' : 'font-medium text-red-700'}>
            {message.text}
            {message.tone === 'error' && /plan|ödəniş|Biznes|Tək vakansiya/i.test(message.text) ? (
              <> <a href="/business/billing" className="underline">Tariflərə bax</a></>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
