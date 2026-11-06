'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AdminHeader, useAdminMe } from '@/components/admin-header';
import {
  adminCall,
  AdminEmptyState,
  AdminLoadingState,
  CARD,
  ConfirmDialog,
  INPUT,
  Notices,
  Pager,
  StatusPill,
  when,
} from '@/components/admin-ui';
import { Briefcase, ExternalLink, Eye, EyeOff, RefreshCw, Search } from 'lucide-react';

interface Listing {
  id: string;
  source: string;
  title: string;
  company: string;
  url: string;
  status: string;
  deadline: string | null;
  lastSeenAt: string;
  closedReason: string | null;
  hiddenAt: string | null;
  hiddenReason: string | null;
  _count: { matches: number };
}

export default function AdminListingsPage() {
  const me = useAdminMe();
  const canModerate = !!me?.permissions.includes('listings.moderate');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [hidden, setHidden] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ data: Listing[]; meta: { total: number; totalPages: number } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [hiding, setHiding] = useState<Listing | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      page: String(page),
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(status ? { status } : {}),
      ...(hidden ? { hidden } : {}),
    });
    adminCall(`listings?${params}`)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, q, status, hidden]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRestore = async (l: Listing) => {
    setError('');
    setNotice('');
    try {
      await adminCall(`listings/${l.id}/restore`, 'POST');
      setNotice(`"${l.title}" yenidən görünür.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />

      <main className="flex-1 p-4 sm:p-6 md:p-10 w-full max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-neutral-dark">Xarici elanlar</h1>
            <p className="text-xs sm:text-sm text-neutral-dark/65 mt-1">Müxtəlif mənbələrdən toplanmış vakansiyaların moderasiyası və görünüşü.</p>
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

        <Notices notice={notice} error={error} onClearError={() => setError('')} />

        {/* Filter Form */}
        <form
          className="flex flex-wrap gap-3 items-end p-4 rounded-2xl bg-surface border border-outline-variant shadow-xs"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            load();
          }}
        >
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="l-q" className="block text-xs font-semibold mb-1 text-neutral-dark/80">
              Axtarış
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-dark/40" />
              <input
                id="l-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className={`${INPUT} pl-9 w-full min-h-11`}
                placeholder="Vəzifə və ya şirkət adı..."
              />
            </div>
          </div>

          <div className="w-full sm:w-auto min-w-[140px]">
            <label htmlFor="l-status" className="block text-xs font-semibold mb-1 text-neutral-dark/80">
              Mənbə statusu
            </label>
            <select
              id="l-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className={`${INPUT} w-full min-h-11`}
            >
              <option value="">Hamısı</option>
              <option value="ACTIVE">Aktiv</option>
              <option value="CLOSED">Bağlı</option>
            </select>
          </div>

          <div className="w-full sm:w-auto min-w-[140px]">
            <label htmlFor="l-hidden" className="block text-xs font-semibold mb-1 text-neutral-dark/80">
              Moderasiya
            </label>
            <select
              id="l-hidden"
              value={hidden}
              onChange={(e) => {
                setHidden(e.target.value);
                setPage(1);
              }}
              className={`${INPUT} w-full min-h-11`}
            >
              <option value="">Hamısı</option>
              <option value="false">Görünən</option>
              <option value="true">Gizlədilmiş</option>
            </select>
          </div>

          <button className="min-h-11 rounded-xl border border-neutral-dark/20 bg-background px-4 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-colors">
            Filtrlə
          </button>
        </form>

        {/* Listings Data */}
        <section className={`${CARD} overflow-hidden`} aria-label="Elanlar">
          {loading && !data ? (
            <AdminLoadingState message="Elanlar yüklənir..." />
          ) : data?.data.length === 0 ? (
            <AdminEmptyState
              icon={Briefcase}
              title={q || status || hidden ? 'Axtarışa uyğun elan tapılmadı' : 'Elan siyahısı boşdur'}
              description={q || status || hidden ? 'Axtarış filtrlərini sıfırlayaraq yenidən yoxlayın.' : 'Sistemdə hələ heç bir xarici elan qeydə alınmayıb.'}
            />
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block relative overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-dark/[0.03] text-left text-xs uppercase tracking-wider text-neutral-dark/60 border-b border-neutral-dark/5">
                    <tr>
                      <th scope="col" className="p-4 font-semibold">Elan və Şirkət</th>
                      <th scope="col" className="p-4 font-semibold">Mənbə</th>
                      <th scope="col" className="p-4 font-semibold">Status</th>
                      <th scope="col" className="p-4 font-semibold">Son görülüb</th>
                      <th scope="col" className="p-4 font-semibold">Uyğunluq</th>
                      <th scope="col" className="p-4 text-right font-semibold">Əməliyyat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-dark/5">
                    {data?.data.map((l) => (
                      <tr key={l.id} className="hover:bg-neutral-dark/[0.02] transition-colors">
                        <td className="p-4 max-w-sm">
                          <a
                            href={l.url}
                            target="_blank"
                            rel="noreferrer"
                            className="tap font-medium text-neutral-dark hover:text-primary hover:underline inline-flex items-center gap-1.5 break-words group"
                          >
                            <span>{l.title}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100" />
                          </a>
                          <p className="text-xs text-neutral-dark/65 mt-0.5 truncate">{l.company}</p>
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          <span className="inline-flex rounded-md bg-neutral-dark/5 px-2 py-0.5 text-xs font-mono text-neutral-dark/80">
                            {l.source}
                          </span>
                        </td>
                        <td className="p-4 whitespace-nowrap space-x-1.5">
                          <StatusPill tone={l.status === 'ACTIVE' ? 'ok' : 'muted'}>
                            {l.status === 'ACTIVE' ? 'Aktiv' : `Bağlı${l.closedReason ? ` (${l.closedReason})` : ''}`}
                          </StatusPill>
                          {l.hiddenAt && (
                            <StatusPill tone="warn">
                              Gizli: {l.hiddenReason || 'Moderator tərəfindən'}
                            </StatusPill>
                          )}
                        </td>
                        <td className="p-4 text-xs text-neutral-dark/65 whitespace-nowrap">{when(l.lastSeenAt)}</td>
                        <td className="p-4 whitespace-nowrap">
                          <span className="text-xs font-semibold text-neutral-dark">{l._count.matches}</span>
                        </td>
                        <td className="p-4 text-right whitespace-nowrap">
                          {canModerate && (
                            l.hiddenAt ? (
                              <button
                                className="min-h-11 inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold text-primary hover:bg-neutral-dark/5 transition-colors"
                                onClick={() => handleRestore(l)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span>Bərpa et</span>
                              </button>
                            ) : (
                              <button
                                className="min-h-11 inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors"
                                onClick={() => setHiding(l)}
                              >
                                <EyeOff className="h-3.5 w-3.5" />
                                <span>Gizlət</span>
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View (< 768px) */}
              <div className="md:hidden divide-y divide-neutral-dark/5">
                {data?.data.map((l) => (
                  <div key={l.id} className="p-4 space-y-2.5">
                    <div className="space-y-1">
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="tap font-bold text-sm text-neutral-dark hover:text-primary inline-flex items-center gap-1 break-words"
                      >
                        <span>{l.title}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      <p className="text-xs text-neutral-dark/65 font-medium">{l.company}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="rounded bg-neutral-dark/5 px-2 py-0.5 font-mono text-[11px] text-neutral-dark/80">
                        {l.source}
                      </span>
                      <StatusPill tone={l.status === 'ACTIVE' ? 'ok' : 'muted'}>
                        {l.status === 'ACTIVE' ? 'Aktiv' : `Bağlı${l.closedReason ? ` (${l.closedReason})` : ''}`}
                      </StatusPill>
                      {l.hiddenAt && (
                        <StatusPill tone="warn">Gizli: {l.hiddenReason || 'Moderator tərəfindən'}</StatusPill>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-neutral-dark/60 pt-1">
                      <span>Son baxış: {when(l.lastSeenAt)}</span>
                      <span>{l._count.matches} uyğunluq</span>
                    </div>

                    {canModerate && (
                      <div className="pt-2 border-t border-neutral-dark/5 flex justify-end">
                        {l.hiddenAt ? (
                          <button
                            className="min-h-11 w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-neutral-dark/20 text-xs font-semibold text-primary hover:bg-neutral-dark/5"
                            onClick={() => handleRestore(l)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Bərpa et</span>
                          </button>
                        ) : (
                          <button
                            className="min-h-11 w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50"
                            onClick={() => setHiding(l)}
                          >
                            <EyeOff className="h-3.5 w-3.5" />
                            <span>Gizlət</span>
                          </button>
                        )}
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

      {/* Hide Listing Confirmation Dialog */}
      {hiding && (
        <ConfirmDialog
          title="Elan gizlədilsin?"
          description={`“${hiding.title}” yeni tövsiyələrdən və yeni müraciətlərdən çıxarılacaq. Mənbə idxalı onu yenidən açsa belə, gizli qalacaq.`}
          confirmLabel="Gizlət"
          requireReason
          danger
          onClose={() => setHiding(null)}
          onConfirm={async (reason) => {
            await adminCall(`listings/${hiding.id}/hide`, 'POST', { reason });
            setNotice('Elan gizlədildi.');
            load();
          }}
        />
      )}
    </div>
  );
}
