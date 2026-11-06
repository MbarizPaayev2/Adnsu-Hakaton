'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  Edit2,
  Plus,
  Shield,
  Trash2,
  Undo2,
  X,
  AlertCircle,
  Building2,
} from 'lucide-react';

export type CandidateOutcomeType =
  | 'INTERVIEW'
  | 'OFFER_RECEIVED'
  | 'OFFER_ACCEPTED'
  | 'JOB_STARTED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type OutcomeVerificationStatus =
  | 'STUDENT_ATTESTED'
  | 'UNVERIFIED'
  | 'EMPLOYER_CONFIRMED';

export interface CandidateOutcomeItem {
  id: string;
  outcomeType: CandidateOutcomeType;
  occurredAt: string;
  jobTitle?: string | null;
  companyName?: string | null;
  channel?: string | null;
  applicationId?: string | null;
  verificationStatus: OutcomeVerificationStatus;
  provenance: string;
  note?: string | null;
  shareWithAcademy: boolean;
  withdrawnAt?: string | null;
  isWithdrawn: boolean;
  createdAt: string;
  updatedAt?: string;
}

export const OUTCOME_TYPE_LABELS: Record<CandidateOutcomeType, { label: string; badgeClass: string }> = {
  INTERVIEW: { label: 'Müsahibə', badgeClass: 'bg-purple-100 text-purple-900 border-purple-300' },
  OFFER_RECEIVED: { label: 'İş təklifi alındı', badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
  OFFER_ACCEPTED: { label: 'Təklif qəbul edildi', badgeClass: 'bg-teal-100 text-teal-900 border-teal-300' },
  JOB_STARTED: { label: 'İşə başlandı', badgeClass: 'bg-green-100 text-green-950 border-green-400 font-bold' },
  REJECTED: { label: 'İmtina', badgeClass: 'bg-rose-100 text-rose-900 border-rose-300' },
  WITHDRAWN: { label: 'Namizəd geri götürdü', badgeClass: 'bg-neutral-100 text-neutral-800 border-neutral-300' },
};

export const VERIFICATION_STATUS_LABELS: Record<OutcomeVerificationStatus, { label: string; badgeClass: string; hint: string }> = {
  STUDENT_ATTESTED: {
    label: 'Tələbə bəyanı',
    badgeClass: 'bg-blue-50 text-blue-800 border-blue-200',
    hint: 'Sizin tərəfinizdən bəyan edilib. İşəgötürən təsdiqi yalnız rəsmi yoxlama ilə müəyyən edilir.',
  },
  UNVERIFIED: {
    label: 'Təsdiqlənməyib',
    badgeClass: 'bg-neutral-50 text-neutral-700 border-neutral-200',
    hint: 'Qeyri-rəsmi qeyd.',
  },
  EMPLOYER_CONFIRMED: {
    label: 'İşəgötürən təsdiqi',
    badgeClass: 'bg-emerald-100 text-emerald-950 border-emerald-400 font-semibold',
    hint: 'İşəgötürən tərəfindən rəsmi təsdiqlənib.',
  },
};

export function CandidateOutcomesManager() {
  const [outcomes, setOutcomes] = useState<CandidateOutcomeItem[]>([]);
  const [enrolledAcademies, setEnrolledAcademies] = useState<{ id: string; academyName: string; cohortName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal form state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOutcomeType, setFormOutcomeType] = useState<CandidateOutcomeType>('INTERVIEW');
  const [formOccurredAt, setFormOccurredAt] = useState<string>(new Date().toISOString().slice(0, 10));
  const [formJobTitle, setFormJobTitle] = useState('');
  const [formCompanyName, setFormCompanyName] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formShareWithAcademy, setFormShareWithAcademy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchOutcomes = async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, enrRes] = await Promise.all([
        apiFetch('/candidate/outcomes'),
        apiFetch('/academies/my-enrollments').catch(() => null),
      ]);
      if (!res.ok) {
        throw new Error('Nəticələri yükləmək mümkün olmadı');
      }
      const data = await res.json();
      setOutcomes(Array.isArray(data) ? data : []);

      if (enrRes && enrRes.ok) {
        const enrData = await enrRes.json();
        if (Array.isArray(enrData)) {
          setEnrolledAcademies(
            enrData
              .filter((e: any) => e.status === 'ACTIVE' && e.consentActive)
              .map((e: any) => ({
                id: e.id,
                academyName: e.academy?.name || 'Tərəfdaş Təhsil Mərkəzi',
                cohortName: e.cohort?.name || 'Kohort',
              })),
          );
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Gözlənilməz xəta baş verdi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOutcomes();
  }, []);

  const openCreateModal = () => {
    setEditingId(null);
    setFormOutcomeType('INTERVIEW');
    setFormOccurredAt(new Date().toISOString().slice(0, 10));
    setFormJobTitle('');
    setFormCompanyName('');
    setFormNote('');
    setFormShareWithAcademy(false);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (outcome: CandidateOutcomeItem) => {
    setEditingId(outcome.id);
    setFormOutcomeType(outcome.outcomeType);
    setFormOccurredAt(outcome.occurredAt.slice(0, 10));
    setFormJobTitle(outcome.jobTitle || '');
    setFormCompanyName(outcome.companyName || '');
    setFormNote(outcome.note || '');
    setFormShareWithAcademy(outcome.shareWithAcademy);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const todayStr = new Date().toISOString().slice(0, 10);
    if (formOccurredAt > todayStr) {
      setFormError('Nəticə tarixi gələcəkdə ola bilməz');
      return;
    }

    setSubmitting(true);
    try {
      if (editingId) {
        // Update existing outcome
        const res = await apiFetch(`/candidate/outcomes/${encodeURIComponent(editingId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            outcomeType: formOutcomeType,
            occurredAt: new Date(formOccurredAt).toISOString(),
            jobTitle: formJobTitle.trim() || undefined,
            companyName: formCompanyName.trim() || undefined,
            note: formNote.trim() || undefined,
            shareWithAcademy: formShareWithAcademy,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message || 'Nəticəni yeniləmək mümkün olmadı');
        }
      } else {
        // Create new outcome
        const res = await apiFetch('/candidate/outcomes', {
          method: 'POST',
          body: JSON.stringify({
            outcomeType: formOutcomeType,
            occurredAt: new Date(formOccurredAt).toISOString(),
            jobTitle: formJobTitle.trim() || undefined,
            companyName: formCompanyName.trim() || undefined,
            note: formNote.trim() || undefined,
            shareWithAcademy: formShareWithAcademy,
            verificationStatus: 'STUDENT_ATTESTED',
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message || 'Nəticəni qeyd etmək mümkün olmadı');
        }
      }

      setModalOpen(false);
      await fetchOutcomes();
    } catch (err: any) {
      setFormError(err?.message || 'Xəta baş verdi');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async (id: string) => {
    if (!window.confirm('Bu nəticəni geri götürmək istədiyinizə əminsiniz? Geri götürülən nəticələr akademiya hesabatlarında sayılmır.')) {
      return;
    }

    try {
      const res = await apiFetch(`/candidate/outcomes/${encodeURIComponent(id)}/withdraw`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error('Nəticəni geri götürmək mümkün olmadı');
      }
      await fetchOutcomes();
    } catch (err: any) {
      alert(err?.message || 'Xəta baş verdi');
    }
  };

  const handleRestore = async (id: string) => {
    try {
      const res = await apiFetch(`/candidate/outcomes/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ withdrawn: false }),
      });
      if (!res.ok) {
        throw new Error('Nəticəni bərpa etmək mümkün olmadı');
      }
      await fetchOutcomes();
    } catch (err: any) {
      alert(err?.message || 'Xəta baş verdi');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Bu nəticə qeydini həmişəlik silmək istədiyinizə əminsiniz?')) {
      return;
    }

    try {
      const res = await apiFetch(`/candidate/outcomes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Nəticəni silmək mümkün olmadı');
      }
      await fetchOutcomes();
    } catch (err: any) {
      alert(err?.message || 'Xəta baş verdi');
    }
  };

  return (
    <section className="space-y-4" aria-label="Karyera nəticələri">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-bold text-neutral-dark">Karyera Nəticələrim</h2>
          <p className="text-sm text-neutral-dark/65">
            İş müsahibələriniz, aldığınız təkliflər və başladığınız işlər barədə bəyanınız.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-hover transition-colors"
        >
          <Plus className="h-4 w-4" /> Yeni nəticə bildir
        </button>
      </div>

      {/* Info notice about student-attested vs employer-confirmed */}
      <div className="rounded-xl border border-primary/10 bg-primary/5 p-3.5 flex items-start gap-2.5 text-xs text-neutral-dark/80">
        <Shield className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-neutral-dark block mb-0.5">Məxfilik və Yoxlama Qaydası</span>
          Namizədlər nəticələri tələbə bəyanı (STUDENT_ATTESTED) kimi daxil edir. İşəgötürən təsdiqi (EMPLOYER_CONFIRMED) yalnız müstəqil yoxlama yolu ilə aparılır və birbaşa tələbə tərəfindən seçilə bilməz.
        </div>
      </div>

      {loading && (
        <div className="p-8 text-center text-sm text-neutral-dark/50">Nəticələr yüklənir...</div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchOutcomes}
            className="text-xs font-bold underline hover:no-underline ml-3"
          >
            Yenidən yoxla
          </button>
        </div>
      )}

      {!loading && !error && outcomes.length === 0 && (
        <div className="rounded-2xl border border-neutral-dark/10 bg-background p-8 text-center space-y-3">
          <Briefcase className="h-10 w-10 text-neutral-dark/30 mx-auto" />
          <p className="text-sm text-neutral-dark/65 font-medium">Hələ heç bir karyera nəticəsi qeyd edilməyib.</p>
          <p className="text-xs text-neutral-dark/50 max-w-md mx-auto">
            Müsahibəyə çağırıldıqda, iş təklifi aldıqda və ya faktiki işə başladıqda buradan qeyd edin.
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-background px-4 py-2 text-xs font-semibold text-primary hover:bg-primary/5 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Nəticə bildir
          </button>
        </div>
      )}

      {!loading && outcomes.length > 0 && (
        <div className="rounded-2xl border border-neutral-dark/10 bg-background divide-y divide-neutral-dark/5 shadow-xs overflow-hidden">
          {outcomes.map((outcome) => {
            const typeConfig = OUTCOME_TYPE_LABELS[outcome.outcomeType] || {
              label: outcome.outcomeType,
              badgeClass: 'bg-neutral-100 text-neutral-800 border-neutral-200',
            };
            const verificationConfig = VERIFICATION_STATUS_LABELS[outcome.verificationStatus] || {
              label: outcome.verificationStatus,
              badgeClass: 'bg-neutral-100 text-neutral-800 border-neutral-200',
              hint: '',
            };

            return (
              <div key={outcome.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-medium border ${typeConfig.badgeClass}`}
                    >
                      {typeConfig.label}
                    </span>

                    <span
                      title={verificationConfig.hint}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium border ${verificationConfig.badgeClass}`}
                    >
                      {outcome.verificationStatus === 'EMPLOYER_CONFIRMED' ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-700" />
                      ) : (
                        <Shield className="h-3 w-3 text-neutral-500" />
                      )}
                      {verificationConfig.label}
                    </span>

                    {outcome.isWithdrawn && (
                      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-neutral-200 text-neutral-700 border border-neutral-300">
                        Geri götürülüb
                      </span>
                    )}

                    {!outcome.shareWithAcademy && (
                      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                        Akademiyadan gizli
                      </span>
                    )}
                  </div>

                  <div className="font-semibold text-neutral-dark break-words">
                    {outcome.jobTitle || 'Vəzifə qeyd edilməyib'}
                    {outcome.companyName && (
                      <span className="font-normal text-neutral-dark/70 ml-1.5 inline-flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5 inline text-neutral-dark/40" />
                        {outcome.companyName}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-neutral-dark/60 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Tarix: {new Date(outcome.occurredAt).toLocaleDateString('az-AZ')}
                    </span>
                    {outcome.note && (
                      <span className="italic text-neutral-dark/70 max-w-sm truncate" title={outcome.note}>
                        Qeyd: {outcome.note}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 sm:self-center shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditModal(outcome)}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-neutral-dark/70 hover:bg-neutral-dark/5 transition-colors"
                  >
                    <Edit2 className="h-3.5 w-3.5" /> Düzəliş et
                  </button>

                  {outcome.isWithdrawn ? (
                    <button
                      type="button"
                      onClick={() => handleRestore(outcome.id)}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 transition-colors"
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Bərpa et
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleWithdraw(outcome.id)}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 transition-colors"
                    >
                      <Clock className="h-3.5 w-3.5" /> Geri götür
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDelete(outcome.id)}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Sil
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Form for Create / Edit */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-background rounded-2xl border border-neutral-dark/15 max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-lg font-bold text-neutral-dark">
                {editingId ? 'Nəticəyə düzəliş et' : 'Yeni karyera nəticəsi bildir'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-neutral-dark/40 hover:text-neutral-dark transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-dark mb-1">
                  Nəticə növü <span className="text-red-500">*</span>
                </label>
                <select
                  value={formOutcomeType}
                  onChange={(e) => setFormOutcomeType(e.target.value as CandidateOutcomeType)}
                  className="w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm text-neutral-dark focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  <option value="INTERVIEW">Müsahibə</option>
                  <option value="OFFER_RECEIVED">İş təklifi alındı</option>
                  <option value="OFFER_ACCEPTED">Təklif qəbul edildi</option>
                  <option value="JOB_STARTED">Faktiki işə başlandı</option>
                  <option value="REJECTED">İmtina</option>
                  <option value="WITHDRAWN">Namizəd geri götürdü</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-dark mb-1">
                  Hadisə tarixi <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  max={new Date().toISOString().slice(0, 10)}
                  value={formOccurredAt}
                  onChange={(e) => setFormOccurredAt(e.target.value)}
                  className="w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm text-neutral-dark focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-dark mb-1">Vəzifə adı</label>
                <input
                  type="text"
                  placeholder="məs. Junior Data Analyst"
                  value={formJobTitle}
                  onChange={(e) => setFormJobTitle(e.target.value)}
                  maxLength={120}
                  className="w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm text-neutral-dark focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-dark mb-1">Şirkət adı</label>
                <input
                  type="text"
                  placeholder="məs. Pasha Bank"
                  value={formCompanyName}
                  onChange={(e) => setFormCompanyName(e.target.value)}
                  maxLength={120}
                  className="w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm text-neutral-dark focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-dark mb-1">Əlavə qeydlər</label>
                <textarea
                  rows={2}
                  placeholder="İstəyə bağlı şəxsi qeydlər..."
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  maxLength={500}
                  className="w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm text-neutral-dark focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              <div className="rounded-xl border border-neutral-dark/15 p-3.5 bg-neutral-dark/5 space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formShareWithAcademy}
                    onChange={(e) => setFormShareWithAcademy(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-neutral-dark/30 text-primary focus:ring-primary"
                  />
                  <div className="text-xs text-neutral-dark/80 space-y-1">
                    <span className="font-semibold text-neutral-dark block">
                      Akademiya hesabatında paylaşılsın (İstəyə bağlı opt-in)
                    </span>
                    <span className="block leading-relaxed">
                      {enrolledAcademies.length > 0 ? (
                        <>
                          İşarələndikdə: Aktiv razılıq verdiyiniz təhsil mərkəzinin (<strong>{enrolledAcademies.map((a) => `${a.academyName} – ${a.cohortName}`).join(', ')}</strong>) anonim ümumi kohort aqreqat statistikasında nəzərə alınır.
                        </>
                      ) : (
                        <>
                          İşarələndikdə: Yalnız aktiv razılıq verdiyiniz tərəfdaş təhsil mərkəzinin anonim ümumi kohort aqreqat statistikasında nəzərə alınır.
                        </>
                      )}
                    </span>
                    <span className="block text-neutral-dark/60 text-[11px] leading-relaxed">
                      Yalnız nəticə kateqoriyası (müsahibə, təklif, işə qəbul) və hadisə tarixi aqreqat hesabata daxil edilir. Şəxsi CV mətnləri, telefon nömrəsi, əməkhaqqı və qeydlər heç bir halda paylaşılmır.
                    </span>
                    <span className="block text-neutral-dark/60 text-[11px] italic">
                      İşarələnmədikdə (Defolt): Bu nəticə tam məxfi saxlanılır və heç bir akademiya ilə paylaşılmır.
                    </span>
                  </div>
                </label>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={submitting}
                  className="rounded-full border border-neutral-dark/20 px-4 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-colors disabled:opacity-50"
                >
                  Ləğv et
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-full bg-primary px-5 py-2 text-xs font-semibold text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Saxlanılır...' : editingId ? 'Yenilə' : 'Nəticəni bildir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
