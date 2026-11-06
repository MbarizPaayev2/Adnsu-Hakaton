'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { Building2, Check, Clock, RefreshCw, Search, Trash2, X, XCircle } from 'lucide-react';

interface CompanyRow {
  id: string;
  name: string;
  email?: string;
  status: 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REJECTED' | string;
  rejectionReason?: string | null;
  createdAt: string;
}

const STATUS_FILTERS = [
  { value: '', label: 'Hamısı' },
  { value: 'PENDING', label: 'Gözləyir' },
  { value: 'APPROVED', label: 'Təsdiqləndi' },
  { value: 'SUSPENDED', label: 'Dayandırılıb' },
  { value: 'REJECTED', label: 'Rədd edildi' },
];

export default function AdminBusinessesPage() {
  const me = useAdminMe();
  const router = useRouter();
  const canModerate = !!me?.permissions.includes('companies.moderate');
  const canDelete = !!me?.permissions.includes('companies.delete');

  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Dialog states
  const [rejectTarget, setRejectTarget] = useState<CompanyRow | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<{ company: CompanyRow; restore: boolean } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanyRow | null>(null);

  const fetchCompanies = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({
        page: String(page),
        limit: '15',
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      const data = await adminCall<{ data: CompanyRow[]; meta?: { totalPages: number; total: number } }>(
        `companies?${params}`
      );
      setCompanies(data.data || []);
      setTotalPages(data.meta?.totalPages || 1);
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      if (e.status === 401 || e.status === 403) {
        router.push('/admin');
        return;
      }
      setError(e.message || 'Məlumat yüklənmədi');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, router]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  const handleApprove = async (company: CompanyRow) => {
    setError('');
    setNotice('');
    try {
      await adminCall(`companies/${company.id}/approve`, 'PATCH');
      setNotice(`"${company.name}" uğurla təsdiqləndi.`);
      await fetchCompanies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Təsdiqləmə zamanı xəta baş verdi.');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <StatusPill tone="warn">Gözləyir</StatusPill>;
      case 'APPROVED':
        return <StatusPill tone="ok">Təsdiqləndi</StatusPill>;
      case 'SUSPENDED':
        return <StatusPill tone="bad">Dayandırılıb</StatusPill>;
      case 'REJECTED':
        return <StatusPill tone="bad">Rədd edildi</StatusPill>;
      default:
        return <StatusPill tone="muted">{status}</StatusPill>;
    }
  };

  // Client search filter over fetched page items
  const filteredCompanies = companies.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.email && c.email.toLowerCase().includes(q));
  });

  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />

      <main className="flex-1 p-4 sm:p-6 md:p-10 w-full max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-neutral-dark">Biznes qeydiyyatları</h1>
            <p className="text-xs sm:text-sm text-neutral-dark/65 mt-1">Platformaya qoşulmaq istəyən şirkətləri və onların hüquqi statusunu idarə edin.</p>
          </div>
          <button
            onClick={() => fetchCompanies()}
            disabled={loading}
            className="rounded-xl border border-neutral-dark/20 bg-background px-4 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 min-h-11 inline-flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Yenilə</span>
          </button>
        </div>

        <Notices notice={notice} error={error} onClearError={() => setError('')} />

        {/* Controls: Search and Status Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Status filtri">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                role="tab"
                aria-selected={statusFilter === f.value}
                onClick={() => {
                  setStatusFilter(f.value);
                  setPage(1);
                }}
                className={`min-h-11 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                  statusFilter === f.value
                    ? 'bg-neutral-dark text-white shadow-xs'
                    : 'bg-background border border-neutral-dark/15 text-neutral-dark/70 hover:bg-neutral-dark/5'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-auto min-w-[240px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-dark/40" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Şirkət adı və ya e-poçt..."
              className={`${INPUT} pl-9 w-full min-h-11`}
            />
          </div>
        </div>

        {/* Data Container */}
        <div className={`${CARD} overflow-hidden`}>
          {loading && companies.length === 0 ? (
            <AdminLoadingState message="Şirkətlər siyahısı yüklənir..." />
          ) : filteredCompanies.length === 0 ? (
            <AdminEmptyState
              icon={Building2}
              title={search ? 'Axtarışa uyğun şirkət tapılmadı' : 'Şirkət siyahısı boşdur'}
              description={search ? 'Axtarış sözünü dəyişdirərək yenidən cəhd edin.' : 'Seçilmiş statusda heç bir şirkət qeydiyyatı yoxdur.'}
              action={
                search ? (
                  <button
                    onClick={() => setSearch('')}
                    className="min-h-11 px-4 py-2 text-xs font-semibold rounded-xl border border-neutral-dark/20 text-neutral-dark hover:bg-neutral-dark/5"
                  >
                    Axtarışı təmizlə
                  </button>
                ) : undefined
              }
            />
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block relative overflow-x-auto">
                <table className="w-full text-left text-sm text-neutral-dark/80">
                  <thead className="bg-neutral-dark/[0.03] text-neutral-dark/70 font-semibold border-b border-neutral-dark/10 text-xs uppercase tracking-wider">
                    <tr>
                      <th scope="col" className="px-6 py-4">Şirkət</th>
                      <th scope="col" className="px-6 py-4">Biznes e-poçtu</th>
                      <th scope="col" className="px-6 py-4">Status</th>
                      <th scope="col" className="px-6 py-4">Qeydiyyat tarixi</th>
                      <th scope="col" className="px-6 py-4 text-right">Əməliyyatlar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-dark/5">
                    {filteredCompanies.map((company) => (
                      <tr key={company.id} className="hover:bg-neutral-dark/[0.02] transition-colors">
                        <td className="px-6 py-4 font-medium text-neutral-dark max-w-xs break-words">
                          {company.name}
                        </td>
                        <td className="px-6 py-4 font-mono text-xs text-neutral-dark/80 max-w-xs break-all">
                          {company.email || '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col gap-1 items-start">
                            {getStatusBadge(company.status)}
                            {company.status === 'REJECTED' && company.rejectionReason && (
                              <span className="text-[11px] text-red-700 max-w-[220px] truncate" title={company.rejectionReason}>
                                Səbəb: {company.rejectionReason}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-xs text-neutral-dark/65">
                          {when(company.createdAt)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-2">
                            {canModerate && (company.status === 'APPROVED' || company.status === 'SUSPENDED') && (
                              <button
                                onClick={() => setSuspendTarget({ company, restore: company.status === 'SUSPENDED' })}
                                className="min-h-11 inline-flex items-center justify-center rounded-xl border border-neutral-dark/20 px-3.5 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-colors"
                              >
                                {company.status === 'SUSPENDED' ? 'Bərpa et' : 'Dayandır'}
                              </button>
                            )}
                            {canModerate && (company.status === 'PENDING' || company.status === 'REJECTED') && (
                              <button
                                onClick={() => handleApprove(company)}
                                className="min-h-11 inline-flex items-center justify-center rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-hover transition-colors gap-1.5"
                              >
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Təsdiqlə</span>
                              </button>
                            )}
                            {canModerate && (company.status === 'PENDING' || company.status === 'APPROVED') && (
                              <button
                                onClick={() => setRejectTarget(company)}
                                className="min-h-11 inline-flex items-center justify-center rounded-xl bg-background border border-red-200 px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors gap-1.5"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Rədd et</span>
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => setDeleteTarget(company)}
                                className="min-h-11 inline-flex items-center justify-center rounded-xl bg-red-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-800 transition-colors gap-1.5"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Sil</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View (< 768px) */}
              <div className="md:hidden divide-y divide-neutral-dark/5">
                {filteredCompanies.map((company) => (
                  <div key={company.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <h3 className="font-serif font-bold text-sm text-neutral-dark break-words">{company.name}</h3>
                        <p className="font-mono text-xs text-neutral-dark/65 break-all">{company.email || '—'}</p>
                      </div>
                      <div className="shrink-0">{getStatusBadge(company.status)}</div>
                    </div>

                    {company.status === 'REJECTED' && company.rejectionReason && (
                      <p className="text-xs text-red-700 bg-red-50 p-2.5 rounded-lg border border-red-200/60 break-words">
                        <strong>Rədd səbəbi:</strong> {company.rejectionReason}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-xs text-neutral-dark/60 pt-1">
                      <span>Qeydiyyat:</span>
                      <span>{when(company.createdAt)}</span>
                    </div>

                    {canModerate && (
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-neutral-dark/5">
                        {(company.status === 'PENDING' || company.status === 'REJECTED') && (
                          <button
                            onClick={() => handleApprove(company)}
                            className="flex-1 min-h-11 inline-flex items-center justify-center rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-hover gap-1"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>Təsdiqlə</span>
                          </button>
                        )}
                        {(company.status === 'PENDING' || company.status === 'APPROVED') && (
                          <button
                            onClick={() => setRejectTarget(company)}
                            className="flex-1 min-h-11 inline-flex items-center justify-center rounded-xl bg-background border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 gap-1"
                          >
                            <X className="h-3.5 w-3.5" />
                            <span>Rədd et</span>
                          </button>
                        )}
                        {(company.status === 'APPROVED' || company.status === 'SUSPENDED') && (
                          <button
                            onClick={() => setSuspendTarget({ company, restore: company.status === 'SUSPENDED' })}
                            className="flex-1 min-h-11 inline-flex items-center justify-center rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5"
                          >
                            {company.status === 'SUSPENDED' ? 'Bərpa et' : 'Dayandır'}
                          </button>
                        )}
                      </div>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => setDeleteTarget(company)}
                        className="w-full min-h-11 inline-flex items-center justify-center rounded-xl border border-red-200 bg-background px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 gap-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Hesabı sil</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <Pager page={page} totalPages={totalPages} onPage={setPage} />
            </>
          )}
        </div>
      </main>

      {/* Reject Confirmation Dialog */}
      {rejectTarget && (
        <ConfirmDialog
          title="Qeydiyyatı rədd et"
          description={`"${rejectTarget.name}" şirkətinin qeydiyyatı rədd ediləcək. Şirkətə rəsmi səbəb bildiriləcək.`}
          confirmLabel="Rədd et"
          requireReason
          danger
          onClose={() => setRejectTarget(null)}
          onConfirm={async (reason) => {
            await adminCall(`companies/${rejectTarget.id}/reject`, 'PATCH', { reason });
            setNotice(`"${rejectTarget.name}" qeydiyyatı rədd edildi.`);
            await fetchCompanies();
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <ConfirmDialog
          title="Şirkət hesabı birdəfəlik silinsin?"
          description={`"${deleteTarget.name}" (${deleteTarget.email || 'e-poçt yoxdur'}): şirkət profili, bütün vakansiyaları, bu vakansiyalara gələn müraciətlər və logo silinəcək; aktiv Biznes abunəliyi əvvəlcə ləğv ediləcək. Namizədlərin öz hesabları qalır. Bu geri qaytarılmır. Alternativ: "Dayandır" (geri qaytarıla bilər).`}
          confirmLabel="Birdəfəlik sil"
          requireReason
          danger
          onClose={() => setDeleteTarget(null)}
          onConfirm={async (reason) => {
            const result = await adminCall<{ vacancies: number; applications: number }>(`companies/${deleteTarget.id}`, 'DELETE', { reason });
            setNotice(`"${deleteTarget.name}" silindi (${result?.vacancies ?? 0} vakansiya, ${result?.applications ?? 0} müraciət).`);
            await fetchCompanies();
          }}
        />
      )}

      {/* Suspend / Restore Confirmation Dialog */}
      {suspendTarget && (
        <ConfirmDialog
          title={suspendTarget.restore ? 'Şirkət bərpa edilsin?' : 'Şirkət dayandırılsın?'}
          description={
            suspendTarget.restore
              ? `"${suspendTarget.company.name}" vakansiyaları yenidən platformada görünəcək və müraciət qəbul edəcək.`
              : `"${suspendTarget.company.name}": vakansiyaları gizlədiləcək, yeni müraciət və yeni elan qəbul edilməyəcək. Mövcud müraciətlər qorunur.`
          }
          confirmLabel={suspendTarget.restore ? 'Bərpa et' : 'Dayandır'}
          requireReason={!suspendTarget.restore}
          danger={!suspendTarget.restore}
          onClose={() => setSuspendTarget(null)}
          onConfirm={async (reason) => {
            await adminCall(
              `companies/${suspendTarget.company.id}/${suspendTarget.restore ? 'restore' : 'suspend'}`,
              'POST',
              suspendTarget.restore ? undefined : { reason }
            );
            setNotice(
              suspendTarget.restore
                ? `"${suspendTarget.company.name}" bərpa edildi.`
                : `"${suspendTarget.company.name}" dayandırıldı.`
            );
            await fetchCompanies();
          }}
        />
      )}
    </div>
  );
}
