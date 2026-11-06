'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

export interface EmailAllowance {
  plan: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  resetsAt: string;
  dailyLimit?: number;
}

const PLAN_LABEL: Record<string, string> = { FREE: 'Ödənişsiz', PLUS: 'Plus', PREMIUM: 'Premium', BASIC: 'Basic', STANDARD: 'Standard', Limitsiz: 'Limitsiz' };

/** "dd.mm.yyyy" of the reset moment, in Baku time (the allowance period is the calendar month in Baku). */
export function resetDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 4 * 3600_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
}

/** Loads the signed-in candidate's monthly e-mail application allowance (server-side numbers; nothing is computed here). */
export function useEmailAllowance(enabled = true): EmailAllowance | null {
  const [allowance, setAllowance] = useState<EmailAllowance | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiFetch('/email-applications/allowance', { cache: 'no-store' })
      .then(async (res) => { if (!cancelled && res.ok) setAllowance(await res.json()); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [enabled]);
  return allowance;
}

/**
 * States the monthly e-mail application allowance before anything is approved. A unit is used when the candidate approves; a send that definitively
 * fails or is cancelled gives it back. This is separate from the document allowance.
 */
export function EmailAllowanceNote({ allowance, className = '' }: { allowance: EmailAllowance | null; className?: string }) {
  if (!allowance) return null;
  const plan = PLAN_LABEL[allowance.plan] ?? allowance.plan;
  if (allowance.limit == null) {
    return <p data-testid="email-allowance" className={`text-xs text-on-surface-variant ${className}`}>{plan} planı: aylıq e-poçt müraciət limiti yoxdur (gündəlik qoruma limiti tətbiq olunur).</p>;
  }
  const out = (allowance.remaining ?? 0) <= 0;
  return (
    <p data-testid="email-allowance" role={out ? 'alert' : undefined} className={`text-xs ${out ? 'font-semibold text-red-800' : 'text-on-surface-variant'} ${className}`}>
      {out
        ? <>Bu ayın e-poçt müraciət limiti ({allowance.limit}) çatılıb; {resetDate(allowance.resetsAt)} tarixində yenilənir. </>
        : <>{plan} planı: bu ay {allowance.used} / {allowance.limit} e-poçt müraciəti istifadə olunub, <strong>{allowance.remaining} qalıb</strong>. Göndərilməyən və ya ləğv edilən müraciət limiti azaltmır. </>}
      <Link href="/pricing" className="underline">Planlar</Link>
    </p>
  );
}
