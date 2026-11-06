'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';

type Enrollment = {
  id: string;
  academy: { name: string };
  cohort: { name: string };
  status: 'INVITED' | 'ACTIVE' | 'WITHDRAWN' | 'GRADUATED';
  joinedAt: string | null;
  withdrawnAt: string | null;
  consentActive: boolean;
  consentScope: 'AGGREGATE_ONLY' | 'IDENTIFIABLE_ROSTER' | 'SHARED_DOCUMENTS' | null;
};

const scopeLabel: Record<NonNullable<Enrollment['consentScope']>, string> = {
  AGGREGATE_ONLY: 'Anonim, ümumi hesabat',
  IDENTIFIABLE_ROSTER: 'Mentor siyahısında ad və e-poçt',
  SHARED_DOCUMENTS: 'Sənədlər şəxsi qalır',
};

export function AcademyConsentSettings() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const response = await apiFetch('/academies/my-enrollments');
      if (!response.ok) throw new Error('Akademiya razılıqları yüklənmədi.');
      const data = await response.json();
      setEnrollments(Array.isArray(data) ? data : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Məlumat yüklənərkən xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const revoke = async (enrollment: Enrollment) => {
    setBusyId(enrollment.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiFetch(`/academies/enrollments/${encodeURIComponent(enrollment.id)}/revoke`, { method: 'POST' });
      if (!response.ok) throw new Error('Razılığı ləğv etmək mümkün olmadı. Yenidən cəhd edin.');
      setEnrollments((items) => items.map((item) => item.id === enrollment.id
        ? { ...item, status: 'WITHDRAWN', consentActive: false, withdrawnAt: new Date().toISOString() }
        : item));
      setConfirmId(null);
      setSuccess(`${enrollment.academy.name} üçün paylaşım razılığı ləğv edildi.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Razılıq ləğv edilmədi.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="academy-consent-title" className="product-card mt-6 max-w-xl rounded-2xl border border-neutral-dark/5 bg-background p-6 shadow-xs space-y-4">
      <h2 id="academy-consent-title" className="flex items-center gap-2 border-b border-neutral-dark/5 pb-2 font-serif text-xl font-bold text-neutral-dark">
        <ShieldCheck className="h-5 w-5 text-primary" /> Akademiya ilə məlumat paylaşımı
      </h2>
      <p className="text-sm leading-relaxed text-neutral-dark/70">Razılıq aktiv olduqda yalnız göstərilən əhatə dairəsi tətbiq edilir. CV, motivasiya məktubları, telefon və müraciət qeydləri akademiya ilə paylaşılmır. Razılığı istənilən vaxt ləğv edə bilərsiniz.</p>
      {loading && <p className="text-sm text-neutral-dark/60">Razılıqlar yüklənir...</p>}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {success && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{success}</p>}
      {!loading && !error && enrollments.length === 0 && <p className="rounded-xl border border-dashed border-neutral-dark/15 p-4 text-sm text-neutral-dark/65">Hazırda akademiya dəvətiniz və ya aktiv qeydiyyatınız yoxdur.</p>}
      <ul className="space-y-3">
        {enrollments.map((enrollment) => {
          const active = enrollment.consentActive && ['ACTIVE', 'GRADUATED'].includes(enrollment.status);
          return (
            <li key={enrollment.id} className="rounded-xl border border-neutral-dark/10 bg-background-warm/40 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-neutral-dark">{enrollment.academy.name}</p>
                  <p className="mt-0.5 break-words text-xs text-neutral-dark/65">{enrollment.cohort.name}</p>
                  <p className="mt-2 text-xs font-medium text-neutral-dark/75">{active ? enrollment.status === 'GRADUATED' ? 'Məzun olub · razılıq aktivdir' : 'Razılıq aktivdir' : enrollment.status === 'INVITED' ? 'Dəvət gözləyir' : enrollment.status === 'WITHDRAWN' ? 'Razılıq ləğv edilib' : 'Razılıq aktiv deyil'}</p>
                  {active && enrollment.consentScope && <p className="mt-1 text-xs text-neutral-dark/60">Əhatə: {scopeLabel[enrollment.consentScope]}</p>}
                </div>
                {active && confirmId !== enrollment.id && <button type="button" onClick={() => setConfirmId(enrollment.id)} className="min-h-10 self-start rounded-full border border-red-300 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-red-400">Razılığı ləğv et</button>}
              </div>
              {confirmId === enrollment.id && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" role="group" aria-label="Razılığı ləğv etmə təsdiqi">
                  <p className="text-xs leading-relaxed text-amber-950">Ləğv etdikdə akademiya gələcək hesabatlarda bu qeydiyyatı görməyəcək və siz kohortdan çıxarılacaqsınız.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={busyId === enrollment.id} onClick={() => void revoke(enrollment)} className="min-h-10 rounded-full bg-red-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busyId === enrollment.id ? 'Ləğv edilir...' : 'Bəli, razılığı ləğv et'}</button>
                    <button type="button" disabled={busyId === enrollment.id} onClick={() => setConfirmId(null)} className="min-h-10 rounded-full border border-neutral-dark/20 px-4 py-2 text-xs font-semibold text-neutral-dark disabled:opacity-50">Saxla</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
