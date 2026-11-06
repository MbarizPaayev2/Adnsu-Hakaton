'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search, UserCheck, X } from 'lucide-react';
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
  PRIMARY,
  StatusPill,
  when,
} from '@/components/admin-ui';

const PLAN_LABELS: Record<string, string> = { FREE: 'Ödənişsiz', BASIC: 'Basic', STANDARD: 'Standard', Limitsiz: 'Limitsiz' };
const PLANS = ['FREE', 'BASIC', 'STANDARD', 'Limitsiz'];

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  emailVerified: string | null;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  subscription: { plan: string; status: string } | null;
  planOverrides: { plan: string; expiresAt: string }[];
  _count: { resumes: number; matches: number; applications: number };
}

interface PlanInfo {
  subscription: { plan: string; status: string; currentPeriodEnd: string | null; providerManaged: boolean } | null;
  overrides: { id: string; plan: string; reason: string; expiresAt: string; createdAt: string; revokedAt: string | null; active: boolean }[];
}

type Dialog = { kind: 'suspend' | 'restore' | 'delete' | 'revoke'; user: UserRow; overrideId?: string } | null;

export default function AdminUsersPage() {
  const me = useAdminMe();
  const can = (p: string) => !!me?.permissions.includes(p);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ data: UserRow[]; meta: { totalPages: number; total: number } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [plans, setPlans] = useState<PlanInfo | null>(null);
  const [plansLoading, setPlansLoading] = useState(false);
  const [grant, setGrant] = useState({ plan: 'Limitsiz', reason: '', days: 30 });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      page: String(page),
      limit: '25',
      ...(search.trim() ? { search: search.trim() } : {}),
    });
    adminCall(`users?${params}`)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => {
    load();
    // Search runs on submit; only the page number reloads automatically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const open = async (user: UserRow) => {
    setSelected(user);
    setPlans(null);
    setPlansLoading(true);
    try {
      setPlans(await adminCall<PlanInfo>(`users/${user.id}/plan-overrides`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPlansLoading(false);
    }
  };

  const refresh = async () => {
    load();
    if (selected) await open(selected);
  };

  const effective = (u: UserRow) => u.planOverrides[0]?.plan ?? u.subscription?.plan ?? 'FREE';

  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />

      <main className="flex-1 p-4 sm:p-6 md:p-10 w-full max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-neutral-dark">İstifadəçilər</h1>
            <p className="text-xs sm:text-sm text-neutral-dark/65 mt-1">Platformada qeydiyyatdan keçmiş namizəd hesabları və onların abunəlik statusu.</p>
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

        <form
          className="flex flex-wrap gap-2 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            load();
          }}
        >
          <div className="relative flex-1 sm:max-w-md">
            <label htmlFor="u-search" className="sr-only">
              E-poçt və ya ad
            </label>
            <input
              id="u-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="E-poçt və ya ad üzrə axtarış..."
              className={`${INPUT} w-full min-h-11`}
            />
          </div>
          <button className="min-h-11 rounded-xl border border-neutral-dark/20 bg-background px-4 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 flex items-center gap-1.5 transition-colors">
            <Search className="h-4 w-4" aria-hidden="true" />
            <span>Axtar</span>
          </button>
        </form>

        <div className="grid gap-6 lg:grid-cols-[1fr_390px] items-start">
          <section className={`${CARD} relative overflow-x-auto`} aria-label="İstifadəçi siyahısı">
            {loading && !data ? (
              <AdminLoadingState message="İstifadəçilər yüklənir..." />
            ) : data?.data.length === 0 ? (
              <AdminEmptyState
                icon={UserCheck}
                title={search ? 'Axtarışa uyğun istifadəçi tapılmadı' : 'İstifadəçi siyahısı boşdur'}
                description={search ? 'Axtarış sorğusunu dəyişdirərək yenidən yoxlayın.' : 'Hələ heç bir istifadəçi qeydiyyatdan keçməyib.'}
              />
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead className="bg-neutral-dark/[0.03] text-left text-xs uppercase tracking-wider text-neutral-dark/60 border-b border-neutral-dark/5">
                    <tr>
                      <th scope="col" className="p-4 font-semibold">İstifadəçi</th>
                      <th scope="col" className="p-4 font-semibold">Faktiki plan</th>
                      <th scope="col" className="p-4 font-semibold">Fəaliyyət</th>
                      <th scope="col" className="p-4 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-dark/5">
                    {data?.data.map((u) => (
                      <tr
                        key={u.id}
                        className={`transition-colors hover:bg-neutral-dark/[0.02] ${selected?.id === u.id ? 'bg-primary/5' : ''}`}
                      >
                        <td className="p-4 max-w-xs">
                          <button
                            className="text-left hover:underline group focus:outline-hidden min-h-11 w-full flex flex-col justify-center"
                            onClick={() => open(u)}
                          >
                            <span className="font-semibold text-neutral-dark block break-all group-hover:text-primary">
                              {u.email}
                            </span>
                            <span className="text-xs text-neutral-dark/60 block mt-0.5 truncate">
                              {u.name ? `${u.name} · ` : ''}{when(u.createdAt)}
                            </span>
                          </button>
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          <span className="font-medium text-neutral-dark">{PLAN_LABELS[effective(u)] || effective(u)}</span>
                          {u.planOverrides[0] && (
                            <span className="block text-xs text-amber-800 font-medium mt-0.5">
                              istisna · {when(u.planOverrides[0].expiresAt)} qədər
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-xs text-neutral-dark/70 whitespace-nowrap">
                          {u._count.resumes} CV · {u._count.matches} uyğunluq · {u._count.applications} müraciət
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          {u.suspendedAt ? (
                            <StatusPill tone="bad">Dayandırılıb</StatusPill>
                          ) : u.emailVerified ? (
                            <StatusPill tone="ok">Aktiv</StatusPill>
                          ) : (
                            <StatusPill tone="muted">Təsdiqlənməyib</StatusPill>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data && <Pager page={page} totalPages={data.meta.totalPages} onPage={setPage} />}
              </>
            )}
          </section>

          {/* Selected User Details Sidebar */}
          <aside className={`${CARD} p-5 sm:p-6 space-y-4`} aria-label="Seçilmiş istifadəçi">
            {!selected ? (
              <div className="py-8 text-center text-sm text-neutral-dark/60">
                <p>Təfərrüat və idarəetmə üçün sol siyahıdan bir istifadəçi seçin.</p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2 border-b border-neutral-dark/5 pb-3">
                  <div className="space-y-1 min-w-0">
                    <h2 className="font-serif text-lg font-bold text-neutral-dark break-all leading-snug">
                      {selected.email}
                    </h2>
                    {selected.name && <p className="text-xs text-neutral-dark/65">{selected.name}</p>}
                    {selected.suspendedAt && (
                      <p className="text-xs text-red-700 font-medium">Dayandırılıb: {selected.suspendedReason}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="p-1 rounded-lg text-neutral-dark/40 hover:text-neutral-dark hover:bg-neutral-dark/5 transition-colors"
                    aria-label="Paneli bağla"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Subscription from payment provider */}
                <div className="space-y-1.5 text-sm rounded-xl bg-neutral-dark/[0.02] p-3.5 border border-neutral-dark/5">
                  <p className="text-xs font-semibold uppercase text-neutral-dark/60 tracking-wider">
                    Ödəniş abunəliyi (provayder)
                  </p>
                  {plansLoading ? (
                    <AdminLoadingState message="Abunəlik məlumatı yüklənir..." />
                  ) : plans ? (
                    <p className="font-medium text-neutral-dark">
                      {PLAN_LABELS[plans.subscription?.plan ?? 'FREE'] || plans.subscription?.plan} ·{' '}
                      {plans.subscription?.status ?? '—'}
                      {plans.subscription?.currentPeriodEnd ? ` · ${when(plans.subscription.currentPeriodEnd)} qədər` : ''}
                    </p>
                  ) : (
                    <p className="text-neutral-dark/60 text-xs">Məlumat yoxdur</p>
                  )}
                  <p className="text-[11px] text-neutral-dark/55 leading-relaxed pt-1">
                    Ödəniş müqaviləsi buradan dəyişdirilmir; onu ödəniş provayderinin panelində idarə edin.
                  </p>
                </div>

                {/* Plan overrides */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase text-neutral-dark/60 tracking-wider">
                    Plan istisnaları
                  </p>
                  <ul className="text-sm space-y-1.5" aria-label="İstisna siyahısı">
                    {plans?.overrides.length === 0 && (
                      <li className="text-xs text-neutral-dark/60 py-1">Aktiv istisna yoxdur.</li>
                    )}
                    {plans?.overrides.map((o) => (
                      <li
                        key={o.id}
                        className="flex items-start justify-between gap-2 p-2.5 rounded-xl border border-neutral-dark/10 bg-background"
                      >
                        <div className="text-xs space-y-0.5 leading-snug">
                          <p className="font-semibold text-neutral-dark">
                            {PLAN_LABELS[o.plan] || o.plan}
                            <span className="ml-2 font-normal text-neutral-dark/65">
                              {when(o.expiresAt)} qədər
                            </span>
                          </p>
                          <p className="text-neutral-dark/70 break-words">{o.reason}</p>
                          <div>
                            {o.active ? (
                              <StatusPill tone="ok">aktiv</StatusPill>
                            ) : (
                              <StatusPill tone="muted">{o.revokedAt ? 'ləğv edilib' : 'müddəti bitib'}</StatusPill>
                            )}
                          </div>
                        </div>
                        {o.active && can('users.plan') && (
                          <button
                            className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold hover:bg-neutral-dark/5 text-red-700 transition-colors border border-red-200"
                            onClick={() => setDialog({ kind: 'revoke', user: selected, overrideId: o.id })}
                          >
                            Ləğv et
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>

                  {/* Grant override form */}
                  {can('users.plan') && (
                    <form
                      className="space-y-3 pt-2 border-t border-neutral-dark/5"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setError('');
                        try {
                          await adminCall(`users/${selected.id}/plan-overrides`, 'POST', {
                            plan: grant.plan,
                            reason: grant.reason,
                            days: Number(grant.days),
                          });
                          setNotice(`${selected.email}: ${PLAN_LABELS[grant.plan] || grant.plan} planı ${grant.days} gün üçün verildi.`);
                          setGrant({ ...grant, reason: '' });
                          await refresh();
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                    >
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <div>
                          <label htmlFor="o-plan" className="block text-xs font-semibold mb-1 text-neutral-dark/80">
                            Plan
                          </label>
                          <select
                            id="o-plan"
                            value={grant.plan}
                            onChange={(e) => setGrant({ ...grant, plan: e.target.value })}
                            className={`${INPUT} w-full min-h-11`}
                          >
                            {PLANS.map((p) => (
                              <option key={p} value={p}>
                                {PLAN_LABELS[p]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="o-days" className="block text-xs font-semibold mb-1 text-neutral-dark/80">
                            Gün (1–365)
                          </label>
                          <input
                            id="o-days"
                            type="number"
                            min={1}
                            max={365}
                            value={grant.days}
                            onChange={(e) => setGrant({ ...grant, days: Number(e.target.value) })}
                            className={`${INPUT} w-24 min-h-11`}
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="o-reason" className="block text-xs font-semibold mb-1 text-neutral-dark/80">
                          Səbəb
                        </label>
                        <input
                          id="o-reason"
                          value={grant.reason}
                          onChange={(e) => setGrant({ ...grant, reason: e.target.value })}
                          placeholder="İstisna vermə səbəbi..."
                          className={`${INPUT} w-full min-h-11`}
                          required
                          maxLength={300}
                        />
                      </div>

                      <button className={`${PRIMARY} w-full`} disabled={!grant.reason.trim()}>
                        İstisna ver
                      </button>
                    </form>
                  )}
                </div>

                {/* Account Operations (Suspend, Restore, Delete) */}
                <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-neutral-dark/10 text-xs font-semibold">
                  {can('users.suspend') &&
                    (selected.suspendedAt ? (
                      <button
                        className="min-h-11 px-3.5 rounded-xl border border-neutral-dark/20 text-primary hover:bg-neutral-dark/5 transition-colors"
                        onClick={() => setDialog({ kind: 'restore', user: selected })}
                      >
                        Bərpa et
                      </button>
                    ) : (
                      <button
                        className="min-h-11 px-3.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                        onClick={() => setDialog({ kind: 'suspend', user: selected })}
                      >
                        Dayandır
                      </button>
                    ))}
                  {can('users.delete') && (
                    <button
                      className="min-h-11 px-3.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 transition-colors ml-auto"
                      onClick={() => setDialog({ kind: 'delete', user: selected })}
                    >
                      Hesabı sil
                    </button>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      </main>

      {dialog?.kind === 'suspend' && (
        <ConfirmDialog
          title="Hesab dayandırılsın?"
          description={`${dialog.user.email}: bütün sessiyalar bağlanacaq və giriş bərpa edilənə qədər qadağan olunacaq.`}
          confirmLabel="Dayandır"
          requireReason
          danger
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await adminCall(`users/${dialog.user.id}/suspend`, 'POST', { reason });
            setNotice('Hesab dayandırıldı.');
            setSelected({ ...dialog.user, suspendedAt: new Date().toISOString(), suspendedReason: reason });
            load();
          }}
        />
      )}

      {dialog?.kind === 'restore' && (
        <ConfirmDialog
          title="Hesab bərpa edilsin?"
          description={`${dialog.user.email} yenidən daxil ola biləcək.`}
          confirmLabel="Bərpa et"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await adminCall(`users/${dialog.user.id}/restore`, 'POST');
            setNotice('Hesab bərpa edildi.');
            setSelected({ ...dialog.user, suspendedAt: null, suspendedReason: null });
            load();
          }}
        />
      )}

      {dialog?.kind === 'revoke' && (
        <ConfirmDialog
          title="Plan istisnası ləğv edilsin?"
          description="İstifadəçi dərhal ödəniş abunəliyinin planına qayıdacaq."
          confirmLabel="Ləğv et"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await adminCall(`users/${dialog.user.id}/plan-overrides/${dialog.overrideId}`, 'DELETE');
            setNotice('İstisna ləğv edildi.');
            await refresh();
          }}
        />
      )}

      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Hesab birdəfəlik silinsin?"
          description={`${dialog.user.email}: profil, CV-lər, müraciətlər və faylları silinəcək. Bu geri qaytarılmır.`}
          confirmLabel="Sil"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await adminCall(`users/${dialog.user.id}`, 'DELETE');
            setNotice('Hesab silindi.');
            setSelected(null);
            load();
          }}
        />
      )}
    </div>
  );
}
