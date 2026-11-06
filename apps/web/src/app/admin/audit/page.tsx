'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AdminHeader, useAdminMe } from '@/components/admin-header';
import {
  adminCall,
  AdminEmptyState,
  AdminLoadingState,
  CARD,
  INPUT,
  Notices,
  Pager,
  when,
} from '@/components/admin-ui';
import { Filter, RefreshCw, ScrollText, User } from 'lucide-react';

interface Entry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: unknown;
  createdAt: string;
  actor: string;
}

export default function AdminAuditPage() {
  const me = useAdminMe();
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    data: Entry[];
    meta: { totalPages: number; total: number };
    actions: string[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      page: String(page),
      ...(action ? { action } : {}),
      ...(actor.trim() ? { actor: actor.trim() } : {}),
    });
    adminCall(`audit?${params}`)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, action, actor]);

  useEffect(() => {
    load();
  }, [load]);

  const formatMetadata = (meta: unknown) => {
    if (!meta) return null;
    try {
      if (typeof meta === 'object') {
        return JSON.stringify(meta, null, 2);
      }
      return String(meta);
    } catch {
      return String(meta);
    }
  };

  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />

      <main className="flex-1 p-4 sm:p-6 md:p-10 w-full max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-neutral-dark">Audit jurnalı</h1>
            <p className="text-xs sm:text-sm text-neutral-dark/65 mt-1">Sistem daxilində operatorlar tərəfindən icra edilən bütün əməliyyatların dəyişməz arxivi.</p>
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

        {/* Filters */}
        <form
          className="flex flex-wrap gap-3 items-end p-4 rounded-2xl bg-surface border border-outline-variant shadow-xs"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            load();
          }}
        >
          <div className="w-full sm:w-auto min-w-[200px]">
            <label htmlFor="au-action" className="block text-xs font-semibold mb-1 text-neutral-dark/80">
              Əməliyyat
            </label>
            <select
              id="au-action"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
              className={`${INPUT} w-full min-h-11`}
            >
              <option value="">Hamısı</option>
              {data?.actions?.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label htmlFor="au-actor" className="block text-xs font-semibold mb-1 text-neutral-dark/80">
              Operator e-poçtu
            </label>
            <input
              id="au-actor"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="operator@example.com..."
              className={`${INPUT} w-full min-h-11`}
            />
          </div>

          <button className="min-h-11 rounded-xl border border-neutral-dark/20 bg-background px-5 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-colors flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5" />
            <span>Filtrlə</span>
          </button>
        </form>

        {/* Audit Log Table */}
        <section className={`${CARD} overflow-hidden`} aria-label="Audit qeydləri">
          {loading && !data ? (
            <AdminLoadingState message="Audit jurnalı yüklənir..." />
          ) : data?.data.length === 0 ? (
            <AdminEmptyState
              icon={ScrollText}
              title={action || actor ? 'Axtarışa uyğun qeyd tapılmadı' : 'Audit jurnalı boşdur'}
              description={action || actor ? 'Filtrləri sıfırlayaraq digər qeydlərə baxın.' : 'Sistemdə hələ heç bir əməliyyat qeydə alınmayıb.'}
            />
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block relative overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-dark/[0.03] text-left text-xs uppercase tracking-wider text-neutral-dark/60 border-b border-neutral-dark/5">
                    <tr>
                      <th scope="col" className="p-4 font-semibold">Vaxt</th>
                      <th scope="col" className="p-4 font-semibold">Operator</th>
                      <th scope="col" className="p-4 font-semibold">Əməliyyat</th>
                      <th scope="col" className="p-4 font-semibold">Hədəf</th>
                      <th scope="col" className="p-4 font-semibold">Detallar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-dark/5">
                    {data?.data.map((e) => (
                      <tr key={e.id} className="hover:bg-neutral-dark/[0.02] transition-colors">
                        <td className="p-4 text-xs whitespace-nowrap text-neutral-dark/70 font-mono">
                          {when(e.createdAt)}
                        </td>
                        <td className="p-4 text-xs font-medium text-neutral-dark max-w-xs break-all">
                          {e.actor}
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          <span className="inline-flex rounded-md bg-neutral-dark/5 px-2.5 py-1 text-xs font-mono font-semibold text-neutral-dark">
                            {e.action}
                          </span>
                        </td>
                        <td className="p-4 text-xs whitespace-nowrap">
                          <span className="font-semibold text-neutral-dark">{e.targetType}</span>
                          <span className="font-mono text-neutral-dark/60 ml-1.5">#{e.targetId}</span>
                        </td>
                        <td className="p-4 text-xs font-mono max-w-md">
                          {e.metadata ? (
                            <pre className="max-h-24 overflow-y-auto bg-neutral-dark/[0.03] p-2 rounded-lg text-[11px] text-neutral-dark/80 whitespace-pre-wrap break-all border border-neutral-dark/5">
                              {formatMetadata(e.metadata)}
                            </pre>
                          ) : (
                            <span className="text-neutral-dark/40">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View (< 768px) */}
              <div className="md:hidden divide-y divide-neutral-dark/5">
                {data?.data.map((e) => (
                  <div key={e.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="inline-flex rounded bg-neutral-dark/5 px-2 py-0.5 text-xs font-mono font-semibold text-neutral-dark">
                        {e.action}
                      </span>
                      <span className="text-[11px] font-mono text-neutral-dark/60">{when(e.createdAt)}</span>
                    </div>

                    <div className="text-xs space-y-1">
                      <p className="text-neutral-dark">
                        <strong>Operator:</strong> <span className="font-mono break-all">{e.actor}</span>
                      </p>
                      <p className="text-neutral-dark">
                        <strong>Hədəf:</strong> {e.targetType} <span className="font-mono text-neutral-dark/60">#{e.targetId}</span>
                      </p>
                    </div>

                    {e.metadata != null && (
                      <div className="pt-1">
                        <pre className="max-h-24 overflow-y-auto bg-neutral-dark/[0.03] p-2 rounded-lg text-[11px] font-mono text-neutral-dark/80 whitespace-pre-wrap break-all border border-neutral-dark/5">
                          {formatMetadata(e.metadata)}
                        </pre>
                      </div>
                    )}
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
