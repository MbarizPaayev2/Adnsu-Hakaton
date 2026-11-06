'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus,
  Edit2,
  Play,
  Pause,
  Trash2,
  Clock,
  Briefcase,
  AlertTriangle,
  Users,
  Eye,
  Calendar,
} from 'lucide-react';
import { formatDate } from '@/lib/format';
import { loadPlansOverview, STATUS_LABEL, type PlansOverview, type VacancyStatus } from '@/lib/business-plans';
import { PlanSummary } from '@/components/business/plan-summary';
import { VacancyPlanPanel } from '@/components/business/vacancy-plan-panel';

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  PAUSED: 'bg-amber-50 text-amber-800 border-amber-200',
  PENDING_REVIEW: 'bg-sky-50 text-sky-800 border-sky-200',
  APPROVED: 'bg-sky-50 text-sky-800 border-sky-200',
  REJECTED: 'bg-red-50 text-red-800 border-red-200',
  EXPIRED: 'bg-neutral-100 text-neutral-700 border-neutral-200',
  DRAFT: 'bg-neutral-100 text-neutral-700 border-neutral-200',
};
const statusBadge = (status: string) => STATUS_BADGE[status] ?? 'bg-neutral-100 text-neutral-700 border-neutral-200';
const statusLabel = (status: string) => STATUS_LABEL[status as VacancyStatus] ?? 'Silinmiş';

export default function BusinessVacanciesPage() {
  const [vacancies, setVacancies] = useState<any[]>([]);
  const [company, setCompany] = useState<any>(null);
  const [overview, setOverview] = useState<PlansOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [actionId, setActionId] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [vacRes, compRes] = await Promise.all([
        fetch('/api/business/vacancies'),
        fetch('/api/business/company'),
      ]);

      if (!vacRes.ok || !compRes.ok) {
        throw new Error('Məlumatlar yüklənərkən xəta baş verdi.');
      }

      setVacancies(await vacRes.json());
      setCompany(await compRes.json());
      // Plans are optional: when they are off or unreadable the page behaves as it always did.
      setOverview(await loadPlansOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const applyUpdate = (updated: { id: string } & Record<string, unknown>) => {
    setVacancies((current) => current.map((v) => (v.id === updated.id ? { ...v, ...updated } : v)));
    // Spending an entitlement changes what the next publication would use.
    loadPlansOverview().then(setOverview).catch(() => undefined);
  };

  const changeStatus = async (id: string, newStatus: string) => {
    setActionId(id);
    try {
      const action = newStatus === 'ACTIVE' ? 'reactivate' : 'pause';
      const res = await fetch(`/api/business/vacancies/${id}/${action}`, {
        method: 'PATCH',
      });
      if (res.ok) {
        setVacancies((current) =>
          current.map((v) => (v.id === id ? { ...v, status: newStatus } : v)),
        );
      } else {
        alert('Statusu dəyişmək mümkün olmadı.');
      }
    } catch (err) {
      console.error(err);
      alert('Şəbəkə xətası baş verdi.');
    } finally {
      setActionId(null);
    }
  };

  const deleteVacancy = async (id: string, title: string) => {
    if (!confirm(`"${title}" vakansiyasını silmək istədiyinizə əminsiniz?`)) return;
    setActionId(id);
    try {
      const res = await fetch(`/api/business/vacancies/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setVacancies((current) => current.filter((v) => v.id !== id));
      } else {
        alert('Vakansiyanı silmək mümkün olmadı.');
      }
    } catch (err) {
      console.error(err);
      alert('Şəbəkə xətası baş verdi.');
    } finally {
      setActionId(null);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-neutral-dark/70" role="status">
        Vakansiyalar yüklənir...
      </div>
    );
  }

  if (error) {
    return (
      <div className="product-card rounded-2xl bg-background border border-red-200 p-8 text-center shadow-xs max-w-xl mx-auto my-12">
        <AlertTriangle className="mx-auto h-12 w-12 text-red-600 mb-3" />
        <h2 className="font-serif text-2xl font-bold text-neutral-dark mb-2">Xəta baş verdi</h2>
        <p className="text-sm text-neutral-dark/70 mb-6">{error}</p>
        <button
          onClick={fetchData}
          className="inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all"
        >
          Yenidən cəhd et
        </button>
      </div>
    );
  }

  const isApproved = company?.status === 'APPROVED';

  const filteredVacancies = vacancies.filter((v) => {
    if (filterStatus === 'ALL') return true;
    return v.status === filterStatus;
  });

  const now = new Date();

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      {/* Header and CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold text-neutral-dark">Vakansiyalar</h1>
          <p className="mt-1 text-sm text-neutral-dark/70">
            Yerləşdirdiyiniz bütün vakansiyaların statusunu, son tarixini və daxil olan müraciətləri izləyin.
          </p>
        </div>
        {isApproved ? (
          <Link
            href="/business/vacancies/new"
            className="inline-flex items-center justify-center gap-2 product-action rounded-full bg-primary py-2.5 px-5 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all shrink-0"
          >
            <Plus className="h-4 w-4" />
            Vakansiya yerləşdir
          </Link>
        ) : (
          <button
            disabled
            aria-describedby="vacancy-approval-note"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-neutral-dark/20 py-2.5 px-5 text-sm font-semibold text-neutral-dark/40 shadow-xs cursor-not-allowed shrink-0"
          >
            <Plus className="h-4 w-4" />
            Vakansiya yerləşdir
          </button>
        )}
      </div>

      <PlanSummary overview={overview} />

      {!isApproved && (
        <div
          role="status"
          className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900 flex items-start gap-3 shadow-xs"
        >
          <Clock className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Hesabınız təsdiq gözləyir</p>
            <p id="vacancy-approval-note" className="mt-0.5 text-amber-800">
              Şirkət hesabınız AISE tərəfindən təsdiqləndikdən sonra yeni vakansiya yerləşdirə biləcəksiniz.
            </p>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      {vacancies.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-dark/10 pb-3">
          {[
            { id: 'ALL', label: 'Bütün vakansiyalar', count: vacancies.length },
            {
              id: 'ACTIVE',
              label: 'Aktiv',
              count: vacancies.filter((v) => v.status === 'ACTIVE').length,
            },
            {
              id: 'PAUSED',
              label: 'Dayandırılmış',
              count: vacancies.filter((v) => v.status === 'PAUSED').length,
            },
            // Publication states exist only under employer plans; a tab appears only when there is something in it.
            ...(overview?.gated
              ? (['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED'] as const)
                  .map((st) => ({ id: st, label: STATUS_LABEL[st], count: vacancies.filter((v) => v.status === st).length }))
                  .filter((t) => t.count > 0)
              : []),
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterStatus(tab.id)}
              className={`tap inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                filterStatus === tab.id
                  ? 'bg-primary text-white shadow-xs'
                  : 'bg-background border border-neutral-dark/15 text-neutral-dark/75 hover:bg-neutral-dark/5'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  filterStatus === tab.id
                    ? 'bg-white/20 text-white'
                    : 'bg-neutral-dark/10 text-neutral-dark/70'
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Vacancies List or Empty State */}
      {vacancies.length === 0 ? (
        <div className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-12 text-center shadow-xs">
          <Briefcase className="mx-auto h-12 w-12 text-neutral-dark/30 mb-4" />
          <h2 className="text-lg font-serif font-bold text-neutral-dark">Hələ vakansiya yerləşdirilməyib</h2>
          <p className="mt-2 text-sm text-neutral-dark/70 max-w-sm mx-auto">
            İlk vakansiyanızı yaradaraq minlərlə ixtisaslı namizəd arasından seçim edin.
          </p>
          {isApproved && (
            <Link
              href="/business/vacancies/new"
              className="mt-6 inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all"
            >
              <Plus className="h-4 w-4" />
              İlk vakansiyanı yarat
            </Link>
          )}
        </div>
      ) : filteredVacancies.length === 0 ? (
        <div className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-8 text-center shadow-xs">
          <p className="text-sm text-neutral-dark/70">Bu statusda heç bir vakansiya tapılmadı.</p>
        </div>
      ) : (
        <>
          {/* Mobile Card View (renders on screens < md) */}
          <div className="block md:hidden space-y-4">
            {filteredVacancies.map((v) => {
              const isDeadlinePassed = v.deadline && new Date(v.deadline) < now;
              return (
                <div
                  key={v.id}
                  className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-5 shadow-xs space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/business/vacancies/${v.id}/edit`}
                        className="tap font-serif font-bold text-base text-neutral-dark hover:text-primary transition-colors block"
                      >
                        {v.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-neutral-dark/65">
                        {v.location || 'Bakı'} · {v.workArrangement || 'Əyani'}
                      </p>
                      <VacancyPlanPanel vacancy={v} overview={overview} onChanged={applyUpdate} />
                    </div>
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border shrink-0 ${statusBadge(v.status)}`}
                    >
                      {statusLabel(v.status)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs bg-background-warm/30 p-3 rounded-xl border border-neutral-dark/5">
                    <div>
                      <p className="text-neutral-dark/60 font-medium">Son tarix</p>
                      {v.deadline ? (
                        <p className={`mt-0.5 font-semibold ${isDeadlinePassed && v.status === 'ACTIVE' ? 'text-amber-800' : 'text-neutral-dark'}`}>
                          {formatDate(v.deadline)}
                          {isDeadlinePassed && v.status === 'ACTIVE' && (
                            <span className="block text-[10px] text-amber-700 font-normal">Müddət bitib</span>
                          )}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-neutral-dark font-semibold">Müddətsiz</p>
                      )}
                    </div>
                    <div>
                      <p className="text-neutral-dark/60 font-medium">Müraciət</p>
                      <Link
                        href={`/business/applications?vacancyId=${v.id}`}
                        className="tap mt-0.5 font-semibold text-primary hover:underline block"
                      >
                        {typeof v._count?.applications === 'number' ? v._count.applications : '—'} müraciət
                      </Link>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-neutral-dark/10">
                    <Link
                      href={`/business/applications?vacancyId=${v.id}`}
                      className="tap inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline py-1.5"
                    >
                      <Users className="h-3.5 w-3.5" /> Müraciətlərə bax
                    </Link>
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/business/vacancies/${v.id}/edit`}
                        aria-label={`${v.title} — redaktə et`}
                        className="tap inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-dark/70 hover:bg-neutral-dark/5 hover:text-primary transition-colors"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Link>
                      {v.status === 'ACTIVE' ? (
                        <button
                          onClick={() => changeStatus(v.id, 'PAUSED')}
                          disabled={actionId === v.id}
                          aria-label={`${v.title} — dayandır`}
                          className="tap inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-dark/70 hover:bg-amber-50 hover:text-amber-800 transition-colors"
                        >
                          <Pause className="h-4 w-4" />
                        </button>
                      ) : v.status === 'PAUSED' ? (
                        <button
                          onClick={() => changeStatus(v.id, 'ACTIVE')}
                          disabled={actionId === v.id}
                          aria-label={`${v.title} — aktivləşdir`}
                          className="tap inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-dark/70 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                        >
                          <Play className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        onClick={() => deleteVacancy(v.id, v.title)}
                        disabled={actionId === v.id}
                        aria-label={`${v.title} — sil`}
                        className="tap inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-dark/70 hover:bg-red-50 hover:text-red-700 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table View (renders on screens >= md) */}
          <div className="hidden md:block product-card rounded-2xl bg-background border border-neutral-dark/10 shadow-xs overflow-hidden">
            <div className="relative overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-dark/10">
                <thead className="bg-background-warm/30">
                  <tr>
                    <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-neutral-dark uppercase tracking-wider">
                      Vakansiya
                    </th>
                    <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-neutral-dark uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-neutral-dark uppercase tracking-wider">
                      Son müraciət tarixi
                    </th>
                    <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-neutral-dark uppercase tracking-wider">
                      Müraciət
                    </th>
                    <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-neutral-dark uppercase tracking-wider">
                      Baxış
                    </th>
                    <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-neutral-dark uppercase tracking-wider">
                      Əməliyyatlar
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-dark/10 bg-background">
                  {filteredVacancies.map((v) => {
                    const isDeadlinePassed = v.deadline && new Date(v.deadline) < now;
                    return (
                      <tr key={v.id} className="hover:bg-neutral-dark/2 transition-colors">
                        <td className="px-6 py-4">
                          <Link
                            href={`/business/vacancies/${v.id}/edit`}
                            className="tap text-sm font-semibold text-neutral-dark hover:text-primary transition-colors block"
                          >
                            {v.title}
                          </Link>
                          <span className="text-xs text-neutral-dark/60 mt-0.5 block">
                            {v.location || 'Bakı'} · {v.workArrangement || 'Əyani'}
                          </span>
                          <VacancyPlanPanel vacancy={v} overview={overview} onChanged={applyUpdate} />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border ${statusBadge(v.status)}`}
                          >
                            {statusLabel(v.status)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-dark/80">
                          {v.deadline ? (
                            <div>
                              <span>{formatDate(v.deadline)}</span>
                              {isDeadlinePassed && v.status === 'ACTIVE' && (
                                <span className="block text-[11px] font-semibold text-amber-700">Müddəti bitib</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-neutral-dark/50">Müddətsiz</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <Link
                            href={`/business/applications?vacancyId=${v.id}`}
                            className="tap font-semibold text-primary hover:underline inline-flex items-center gap-1.5"
                          >
                            <Users className="h-4 w-4 text-accent" />
                            {typeof v._count?.applications === 'number' ? v._count.applications : '—'}
                          </Link>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-dark/70">
                          <span className="inline-flex items-center gap-1">
                            <Eye className="h-3.5 w-3.5 text-neutral-dark/40" />
                            {v.views || 0}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <div className="flex items-center justify-end gap-1">
                            <Link
                              href={`/business/applications?vacancyId=${v.id}`}
                              aria-label={`${v.title} — müraciətlərə bax`}
                              title="Müraciətlərə bax"
                              className="tap inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-dark/70 hover:bg-neutral-dark/5 hover:text-accent transition-colors"
                            >
                              <Users className="h-4 w-4" />
                            </Link>
                            <Link
                              href={`/business/vacancies/${v.id}/edit`}
                              aria-label={`${v.title} — redaktə et`}
                              title="Redaktə et"
                              className="tap inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-dark/70 hover:bg-neutral-dark/5 hover:text-primary transition-colors"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Link>
                            {v.status === 'ACTIVE' ? (
                              <button
                                onClick={() => changeStatus(v.id, 'PAUSED')}
                                disabled={actionId === v.id}
                                aria-label={`${v.title} — dayandır`}
                                title="Dayandır"
                                className="tap inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-dark/70 hover:bg-amber-50 hover:text-amber-800 transition-colors"
                              >
                                <Pause className="h-4 w-4" />
                              </button>
                            ) : v.status === 'PAUSED' ? (
                              <button
                                onClick={() => changeStatus(v.id, 'ACTIVE')}
                                disabled={actionId === v.id}
                                aria-label={`${v.title} — aktivləşdir`}
                                title="Aktivləşdir"
                                className="tap inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-dark/70 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                              >
                                <Play className="h-4 w-4" />
                              </button>
                            ) : null}
                            <button
                              onClick={() => deleteVacancy(v.id, v.title)}
                              disabled={actionId === v.id}
                              aria-label={`${v.title} — sil`}
                              title="Sil"
                              className="tap inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-dark/70 hover:bg-red-50 hover:text-red-700 transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
