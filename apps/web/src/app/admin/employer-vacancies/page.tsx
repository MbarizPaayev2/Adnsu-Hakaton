'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AdminHeader, useAdminMe } from '@/components/admin-header';
import { adminCall, AdminEmptyState, AdminLoadingState, CARD, ConfirmDialog, Notices, StatusPill, when } from '@/components/admin-ui';
import { Check, RefreshCw, Trash2, X } from 'lucide-react';

interface PendingVacancy {
  id: string;
  title: string;
  description: string | null;
  requirements: string | null;
  responsibilities: string | null;
  location: string | null;
  deadline: string | null;
  submittedAt: string | null;
  company: { id: string; name: string; status: string; website: string | null };
  checks: string[];
}

interface AllVacancy { id: string; title: string; status: string; createdAt: string; deadline: string | null; company: { name: string } }
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Yayımda', PAUSED: 'Dayandırılıb', DELETED: 'Silinib', DRAFT: 'Qaralama', PENDING_REVIEW: 'Yoxlamada', APPROVED: 'Təsdiqlənib', REJECTED: 'Rədd edilib', EXPIRED: 'Vaxtı bitib',
};

const CHECK_LABEL: Record<string, string> = {
  TOO_SHORT: 'Mətn çox qısadır',
  TOO_MANY_LINKS: 'Çox sayda keçid',
  SPAM_TERMS: 'Spam və ya aldadıcı ifadələr',
  DUPLICATE_OF_OPEN_LISTING: 'Eyni başlıqlı açıq elan var',
};

/** Employer plans: vacancies submitted for review. Approving spends nothing; rejection needs a reason the employer will read. */
export default function AdminEmployerVacanciesPage() {
  const me = useAdminMe();
  const canModerate = !!me?.permissions.includes('listings.moderate');
  const [rows, setRows] = useState<PendingVacancy[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState<PendingVacancy | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const canRemove = !!me?.permissions.includes('vacancies.remove');
  const [all, setAll] = useState<AllVacancy[] | null>(null);
  const [removing, setRemoving] = useState<AllVacancy | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminCall<PendingVacancy[]>('employer-vacancies/pending')
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadAll = useCallback(() => {
    adminCall<AllVacancy[]>('vacancies').then((rows) => setAll(Array.isArray(rows) ? rows : [])).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => { load(); loadAll(); }, [load, loadAll]);

  const approve = async (v: PendingVacancy) => {
    setBusyId(v.id);
    setError('');
    setNotice('');
    try {
      await adminCall(`employer-vacancies/${v.id}/approve`, 'PATCH');
      setNotice(`"${v.title}" təsdiqləndi. İşəgötürən indi yayımlaya bilər.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />
      <main className="flex-1 p-4 sm:p-6 md:p-10 w-full max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-neutral-dark">İşəgötürən vakansiyaları</h1>
            <p className="text-xs sm:text-sm text-neutral-dark/65 mt-1">
              Qaydalara uyğunluq üçün göndərilmiş vakansiyalar. Təsdiq sınaq və ya ödənişi işlətmir; yayım işəgötürənin öz əməliyyatıdır.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-xl border border-neutral-dark/20 bg-background px-4 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 min-h-11 inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Yenilə</span>
          </button>
        </div>

        <Notices notice={notice} error={error} onClearError={() => setError('')} />

        {loading && !rows ? (
          <AdminLoadingState />
        ) : rows && rows.length === 0 ? (
          <AdminEmptyState title="Yoxlama gözləyən vakansiya yoxdur" />
        ) : (
          <ul className="space-y-4">
            {(rows ?? []).map((v) => (
              <li key={v.id} className={`${CARD} p-5 space-y-3`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-lg font-bold text-neutral-dark">{v.title}</h2>
                    <p className="text-xs text-neutral-dark/65">
                      {v.company.name}
                      {v.company.website ? ` · ${v.company.website}` : ''} · göndərilib {when(v.submittedAt)}
                      {v.deadline ? ` · son tarix ${when(v.deadline)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {v.company.status !== 'APPROVED' && <StatusPill tone="bad">Şirkət: {v.company.status}</StatusPill>}
                    {v.checks.length === 0 ? <StatusPill tone="ok">Avtomatik yoxlamalar keçdi</StatusPill> : v.checks.map((c) => <StatusPill key={c} tone="warn">{CHECK_LABEL[c] ?? c}</StatusPill>)}
                  </div>
                </div>
                <details className="text-sm text-neutral-dark/80">
                  <summary className="cursor-pointer font-semibold text-xs min-h-11 flex items-center">Mətni göstər</summary>
                  <div className="mt-2 space-y-3 whitespace-pre-wrap">
                    {v.description && <p>{v.description}</p>}
                    {v.responsibilities && <p><strong>Vəzifələr: </strong>{v.responsibilities}</p>}
                    {v.requirements && <p><strong>Tələblər: </strong>{v.requirements}</p>}
                    {v.location && <p><strong>Yer: </strong>{v.location}</p>}
                  </div>
                </details>
                {canModerate && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => approve(v)}
                      disabled={busyId === v.id}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" /> Təsdiqlə
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejecting(v)}
                      disabled={busyId === v.id}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-red-300 bg-background px-5 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" aria-hidden="true" /> Rədd et
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <section aria-labelledby="all-vacancies" className="space-y-3 pt-8">
          <h2 id="all-vacancies" className="font-serif text-lg font-bold text-neutral-dark">Bütün işəgötürən vakansiyaları</h2>
          {all === null ? <AdminLoadingState /> : all.length === 0 ? <AdminEmptyState title="Vakansiya yoxdur" /> : (
            <ul className="space-y-2">
              {all.map((v) => (
                <li key={v.id} className={`${CARD} p-4 flex flex-wrap items-center justify-between gap-3`}>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-neutral-dark break-words">{v.title}</p>
                    <p className="text-xs text-neutral-dark/65">{v.company.name} · yaradılıb {when(v.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={v.status === 'ACTIVE' ? 'ok' : v.status === 'DELETED' || v.status === 'REJECTED' ? 'bad' : 'warn'}>{STATUS_LABEL[v.status] ?? v.status}</StatusPill>
                    {canRemove && v.status !== 'DELETED' && (
                      <button
                        type="button"
                        onClick={() => setRemoving(v)}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-red-300 bg-background px-4 text-xs font-semibold text-red-800 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Sil
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {rejecting && (
        <ConfirmDialog
          title="Vakansiyanı rədd et"
          description={`"${rejecting.title}" rədd ediləcək. Səbəb işəgötürənə göstəriləcək; o, düzəldib yenidən göndərə bilər.`}
          confirmLabel="Rədd et"
          requireReason
          danger
          onClose={() => setRejecting(null)}
          onConfirm={async (reason) => {
            await adminCall(`employer-vacancies/${rejecting.id}/reject`, 'PATCH', { reason });
            setNotice(`"${rejecting.title}" rədd edildi.`);
            setRejecting(null);
            load();
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Vakansiya platformadan silinsin?"
          description={`"${removing.title}" (${removing.company.name}) namizədlərə göstərilməyəcək və yeni müraciət qəbul etməyəcək. Artıq gələn müraciətlər işəgötürənin qutusunda qalır.`}
          confirmLabel="Sil"
          requireReason
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            await adminCall(`vacancies/${removing.id}/remove`, 'POST', { reason });
            setNotice(`"${removing.title}" silindi.`);
            setRemoving(null);
            loadAll();
            load();
          }}
        />
      )}
    </div>
  );
}
