'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AdminHeader, useAdminMe } from '@/components/admin-header';
import {
  adminCall,
  AdminEmptyState,
  AdminLoadingState,
  CARD,
  INPUT,
  Notices,
  Pager,
  StatusPill,
  when,
} from '@/components/admin-ui';
import { AlertCircle, AlertTriangle, FileText, Globe, RefreshCw } from 'lucide-react';

const NATIVE_STATUSES = ['APPLIED', 'REVIEWING', 'INTERVIEW', 'HIRED', 'REJECTED'];
const EXTERNAL_STATUSES = [
  'DRAFT',
  'FILLING',
  'NEEDS_INPUT',
  'READY_FOR_REVIEW',
  'SUBMITTING',
  'AWAITING_OTP',
  'SUBMITTED',
  'SUBMITTED_DRY_RUN',
  'DELIVERY_UNCONFIRMED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
];

interface AppRow {
  id: string;
  status: string;
  stateReason?: string | null;
  destinationHost?: string | null;
  receiptReference?: string | null;
  dryRun?: boolean;
  needsReconciliation?: boolean;
  updatedAt: string;
  user?: { email: string };
  vacancy?: { title: string; company?: { name: string } };
  match?: { job?: { title: string; company: string } };
}

function ApplicationsContent() {
  const me = useAdminMe();
  const searchParams = useSearchParams();
  const initialKind = searchParams.get('kind') === 'external' ? 'external' : 'native';
  const [kind, setKind] = useState<'native' | 'external'>(initialKind);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ data: AppRow[]; meta: { total: number; totalPages: number } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminCall(`applications?kind=${kind}&page=${page}${status ? `&status=${status}` : ''}`)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [kind, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const getStatusTone = (a: AppRow) => {
    if (a.needsReconciliation) return 'bad';
    if (a.status === 'SUBMITTED' || a.status === 'HIRED') return 'ok';
    if (a.status === 'FAILED' || a.status === 'REJECTED' || a.status === 'EXPIRED') return 'bad';
    if (a.status === 'REVIEWING' || a.status === 'INTERVIEW' || a.status === 'DELIVERY_UNCONFIRMED') return 'warn';
    return 'muted';
  };

  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />

      <main className="flex-1 p-4 sm:p-6 md:p-10 w-full max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-neutral-dark">Müraciətlər</h1>
            <p className="text-xs sm:text-sm text-neutral-dark/65 mt-1">Platforma üzərindən daxili və xarici vakansiyalara göndərilən namizəd müraciətləri.</p>
          </div>
          <button
            onClick={() => load()}
            disabled={loading}
            className="rounded-xl border border-neutral-dark/20 bg-background px-4 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 min-h-11 inline-flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Yenilə</span>
          </button>
        </div>

        <Notices error={error} onClearError={() => setError('')} />

        {/* Filter controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Müraciət növü" className="flex gap-1.5">
            {(['native', 'external'] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={kind === k}
                onClick={() => {
                  setKind(k);
                  setStatus('');
                  setPage(1);
                }}
                className={`min-h-11 px-4 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  kind === k
                    ? 'bg-neutral-dark text-white shadow-xs'
                    : 'bg-background border border-neutral-dark/15 text-neutral-dark/70 hover:bg-neutral-dark/5'
                }`}
              >
                {k === 'native' ? <FileText className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
                <span>{k === 'native' ? 'AISE daxili' : 'Xarici sayt'}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="a-status" className="text-xs font-semibold text-neutral-dark/80 whitespace-nowrap">
              Status:
            </label>
            <select
              id="a-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className={`${INPUT} min-h-11 min-w-[140px]`}
            >
              <option value="">Hamısı</option>
              {(kind === 'native' ? NATIVE_STATUSES : EXTERNAL_STATUSES).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {kind === 'external' && (
          <div className="rounded-xl bg-amber-50 border border-amber-200/80 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" aria-hidden="true" />
            <p className="leading-relaxed">
              <strong>Diqqət:</strong> “DELIVERY_UNCONFIRMED” müraciətlər təkrarlanma riskinə görə heç vaxt avtomatik təkrar göndərilmir; nəticə qəbul edən saytla əl ilə yoxlanılmalıdır.
            </p>
          </div>
        )}

        {/* Data Container */}
        <section className={`${CARD} overflow-hidden`} aria-label="Müraciətlər siyahısı">
          {loading && !data ? (
            <AdminLoadingState message="Müraciətlər yüklənir..." />
          ) : data?.data.length === 0 ? (
            <AdminEmptyState
              icon={FileText}
              title={status ? 'Seçilmiş statusda müraciət tapılmadı' : 'Müraciət yoxdur'}
              description={status ? 'Status filtrini dəyişdirərək digər qeydlərə baxın.' : 'Seçilmiş kateqoriyada hələ heç bir müraciət daxil olmayıb.'}
            />
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block relative overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-dark/[0.03] text-left text-xs uppercase tracking-wider text-neutral-dark/60 border-b border-neutral-dark/5">
                    <tr>
                      <th scope="col" className="p-4 font-semibold">Namizəd</th>
                      <th scope="col" className="p-4 font-semibold">Vakansiya və Şirkət</th>
                      <th scope="col" className="p-4 font-semibold">Status və Qeyd</th>
                      <th scope="col" className="p-4 font-semibold">Yenilənib</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-dark/5">
                    {data?.data.map((a) => (
                      <tr key={a.id} className="hover:bg-neutral-dark/[0.02] transition-colors">
                        <td className="p-4 font-mono text-xs text-neutral-dark font-medium max-w-xs break-all">
                          {a.user?.email || '—'}
                        </td>
                        <td className="p-4 max-w-sm">
                          {kind === 'native' ? (
                            <div>
                              <p className="font-medium text-neutral-dark break-words">{a.vacancy?.title || '—'}</p>
                              <p className="text-xs text-neutral-dark/65 truncate">{a.vacancy?.company?.name || '—'}</p>
                            </div>
                          ) : (
                            <div>
                              <p className="font-medium text-neutral-dark break-words">{a.match?.job?.title || '—'}</p>
                              <p className="text-xs text-neutral-dark/65 truncate">
                                {a.match?.job?.company || '—'} {a.destinationHost ? `· ${a.destinationHost}` : ''}
                              </p>
                            </div>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusPill tone={getStatusTone(a)}>{a.status}</StatusPill>
                            {a.receiptReference && (
                              <span className="text-[11px] font-mono bg-neutral-dark/5 px-2 py-0.5 rounded text-neutral-dark/80">
                                qəbul: {a.receiptReference}
                              </span>
                            )}
                            {a.dryRun && <StatusPill tone="muted">sınaq</StatusPill>}
                            {a.needsReconciliation && <StatusPill tone="bad">Reconciliation tələb olunur</StatusPill>}
                          </div>
                          {a.stateReason && (
                            <p className="text-xs text-neutral-dark/65 mt-1 max-w-xs break-words">{a.stateReason}</p>
                          )}
                        </td>
                        <td className="p-4 text-xs text-neutral-dark/65 whitespace-nowrap">{when(a.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View (< 768px) */}
              <div className="md:hidden divide-y divide-neutral-dark/5">
                {data?.data.map((a) => (
                  <div key={a.id} className="p-4 space-y-2">
                    <div className="space-y-0.5">
                      <p className="font-mono text-xs text-neutral-dark font-medium break-all">{a.user?.email || '—'}</p>
                      {kind === 'native' ? (
                        <>
                          <h3 className="font-bold text-sm text-neutral-dark break-words">{a.vacancy?.title}</h3>
                          <p className="text-xs text-neutral-dark/65">{a.vacancy?.company?.name}</p>
                        </>
                      ) : (
                        <>
                          <h3 className="font-bold text-sm text-neutral-dark break-words">{a.match?.job?.title}</h3>
                          <p className="text-xs text-neutral-dark/65">
                            {a.match?.job?.company} {a.destinationHost ? `· ${a.destinationHost}` : ''}
                          </p>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <StatusPill tone={getStatusTone(a)}>{a.status}</StatusPill>
                      {a.receiptReference && (
                        <span className="text-[11px] font-mono bg-neutral-dark/5 px-2 py-0.5 rounded text-neutral-dark/80">
                          qəbul: {a.receiptReference}
                        </span>
                      )}
                      {a.dryRun && <StatusPill tone="muted">sınaq</StatusPill>}
                    </div>

                    {a.stateReason && (
                      <p className="text-xs text-neutral-dark/65 bg-neutral-dark/[0.03] p-2 rounded-lg break-words">
                        {a.stateReason}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-xs text-neutral-dark/60 pt-1">
                      <span>Son yenilənmə:</span>
                      <span>{when(a.updatedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {data && <Pager page={page} totalPages={data.meta.totalPages} onPage={setPage} />}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default function AdminApplicationsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background-warm flex items-center justify-center text-sm text-neutral-dark/60">Yüklənir...</div>}>
      <ApplicationsContent />
    </Suspense>
  );
}
