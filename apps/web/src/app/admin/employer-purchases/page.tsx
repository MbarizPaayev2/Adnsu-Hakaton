'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AdminHeader, useAdminMe } from '@/components/admin-header';
import { adminCall, AdminEmptyState, AdminLoadingState, CARD, ConfirmDialog, Notices, StatusPill, when } from '@/components/admin-ui';
import { RefreshCw, Undo2 } from 'lucide-react';

interface PurchaseRow {
  id: string;
  kind: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUND_PENDING' | 'REFUNDED' | string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  company: { id: string; name: string; status: string };
  credit: { status: string; consumedVacancyId: string | null; consumedAt: string | null } | null;
}

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'muted'> = { PAID: 'ok', PENDING: 'muted', FAILED: 'bad', REFUND_PENDING: 'warn', REFUNDED: 'muted' };
const FILTERS = [{ value: '', label: 'Hamısı' }, { value: 'PAID', label: 'Ödənilib' }, { value: 'REFUND_PENDING', label: 'Geri ödəniş gözləyir' }, { value: 'REFUNDED', label: 'Geri ödənilib' }, { value: 'FAILED', label: 'Uğursuz' }];

/** Employer single-listing purchases and their refunds (docs/employer-refund-policy-2026-10-11.md). A refund needs a reason and moves money at the provider. */
export default function AdminEmployerPurchasesPage() {
  const me = useAdminMe();
  const canRefund = !!me?.permissions.includes('payments.refund');
  const [rows, setRows] = useState<PurchaseRow[] | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [target, setTarget] = useState<PurchaseRow | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminCall<PurchaseRow[]>(`employer-purchases${status ? `?status=${status}` : ''}`)
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />
      <main className="flex-1 p-4 sm:p-6 md:p-10 w-full max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-neutral-dark">İşəgötürən ödənişləri</h1>
            <p className="text-xs sm:text-sm text-neutral-dark/65 mt-1">
              Tək vakansiya alışları. Geri ödəniş səbəb tələb edir, provayderdə pulu qaytarır və istifadə olunmamış krediti ləğv edir.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="purchase-status" className="sr-only">Status</label>
            <select id="purchase-status" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-xs min-h-11">
              {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <button onClick={load} disabled={loading} className="rounded-xl border border-neutral-dark/20 bg-background px-4 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 min-h-11 inline-flex items-center gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Yenilə
            </button>
          </div>
        </div>

        <Notices notice={notice} error={error} onClearError={() => setError('')} />

        {loading && !rows ? (
          <AdminLoadingState />
        ) : rows && rows.length === 0 ? (
          <AdminEmptyState title="Ödəniş tapılmadı" />
        ) : (
          <ul className="space-y-3">
            {(rows ?? []).map((r) => (
              <li key={r.id} className={`${CARD} p-4 flex flex-wrap items-center justify-between gap-3`}>
                <div className="space-y-1">
                  <p className="font-semibold text-sm text-neutral-dark">{r.company.name} · {money(r.amountMinor, r.currency)}</p>
                  <p className="text-xs text-neutral-dark/65">
                    {r.id.slice(-8)} · {r.paidAt ? `ödənilib ${when(r.paidAt)}` : `yaradılıb ${when(r.createdAt)}`}
                    {r.credit ? ` · kredit: ${r.credit.status === 'AVAILABLE' ? 'istifadə olunmayıb' : r.credit.status === 'CONSUMED' ? 'vakansiyada istifadə olunub' : 'ləğv edilib'}` : ''}
                    {r.refundReason ? ` · səbəb: ${r.refundReason}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={STATUS_TONE[r.status] ?? 'muted'}>{r.status}</StatusPill>
                  {canRefund && r.status === 'PAID' && (
                    <button type="button" onClick={() => setTarget(r)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-neutral-dark/20 bg-background px-4 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5">
                      <Undo2 className="h-4 w-4" aria-hidden="true" /> Geri ödə
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {target && (
        <ConfirmDialog
          title="Geri ödəniş"
          description={
            target.credit?.status === 'CONSUMED'
              ? `${money(target.amountMinor, target.currency)} geri ödəniləcək və bu kreditlə yayımlanmış elan dayandırılacaq (platforma xətası). Müraciətlər saxlanılır.`
              : `${money(target.amountMinor, target.currency)} geri ödəniləcək və istifadə olunmamış kredit ləğv ediləcək.`
          }
          confirmLabel="Geri ödə"
          requireReason
          danger
          onClose={() => setTarget(null)}
          onConfirm={async (reason) => {
            await adminCall(`employer-purchases/${target.id}/refund`, 'POST', { reason, endListing: target.credit?.status === 'CONSUMED' });
            setNotice('Geri ödəniş provayderə göndərildi. Nəticə bir neçə dəqiqə ərzində burada görünəcək.');
            setTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}
