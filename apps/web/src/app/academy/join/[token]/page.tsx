'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { CheckCircle2, ShieldCheck, ArrowRight, AlertCircle, Sparkles, Building2, Calendar } from 'lucide-react';

interface InvitationData {
  token: string;
  invitedEmail: string;
  expiresAt?: string;
  status: string;
  academy: {
    name: string;
    slug: string;
    contactEmail: string;
    website?: string;
  };
  cohort: {
    name: string;
    slug: string;
    description?: string;
    startDate: string;
    endDate: string;
  };
  consentExplanation: {
    title: string;
    defaultScope?: string;
    visibleItems: string[];
    hiddenItems: string[];
    optionalRosterNote?: string;
    revocationNote: string;
  };
}

export default function AcademyJoinPage() {
  const params = useParams();
  const token = params?.token as string;
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();

  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [joined, setJoined] = useState(false);
  const [allowIdentifiableRoster, setAllowIdentifiableRoster] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;

    apiFetch(`/academies/invitations/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Dəvət tapılmadı və ya artıq etibarsızdır');
        return res.json();
      })
      .then((data) => {
        if (active) {
          setInvitation(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message || 'Dəvət yüklənə bilmədi');
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [token]);

  const handleAccept = async () => {
    if (!session) {
      router.push(`/login?callbackUrl=${encodeURIComponent(`/academy/join/${token}`)}`);
      return;
    }

    setSubmitting(true);
    setError(null);

    const scope = allowIdentifiableRoster ? 'IDENTIFIABLE_ROSTER' : 'AGGREGATE_ONLY';

    try {
      const res = await apiFetch(`/academies/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: JSON.stringify({ scope }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Qoşulma zamanı xəta baş verdi');
      }

      setJoined(true);
      setTimeout(() => {
        router.push('/dashboard/profile');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Xəta baş verdi');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background-warm flex items-center justify-center p-4">
        <div className="product-card text-center p-8 max-w-md w-full bg-surface rounded-2xl border border-primary/10 shadow-xs">
          <Sparkles className="mx-auto h-8 w-8 text-primary animate-pulse mb-3" />
          <p className="text-sm font-semibold text-neutral-dark">Dəvət məlumatları yüklənir...</p>
        </div>
      </div>
    );
  }

  if (error || !invitation) {
    return (
      <div className="min-h-screen bg-background-warm flex items-center justify-center p-4">
        <div className="product-card text-center p-8 max-w-md w-full bg-surface rounded-2xl border border-red-200 shadow-xs">
          <AlertCircle className="mx-auto h-8 w-8 text-red-600 mb-3" />
          <h1 className="text-lg font-bold text-neutral-dark mb-1">Dəvət keçərsizdir</h1>
          <p className="text-sm text-neutral-dark/70 mb-6">{error || 'Bu dəvət linki tapılmadı və ya artıq istifadə olunub.'}</p>
          <Link href="/" className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-xs font-semibold text-white hover:bg-primary-hover transition-colors">
            Ana səhifəyə qayıt
          </Link>
        </div>
      </div>
    );
  }

  if (joined) {
    return (
      <div className="min-h-screen bg-background-warm flex items-center justify-center p-4">
        <div className="product-card text-center p-8 max-w-md w-full bg-surface rounded-2xl border border-emerald-200 shadow-xs">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600 mb-3" />
          <h1 className="text-xl font-bold text-neutral-dark mb-1">Kohorta qoşuldunuz!</h1>
          <p className="text-sm text-neutral-dark/70 mb-4">
            «{invitation.academy.name}» akademiyasının «{invitation.cohort.name}» proqramına uğurla qoşuldunuz.
          </p>
          <p className="text-xs text-neutral-dark/50">Profil bölməsinə yönləndirilirsiniz...</p>
        </div>
      </div>
    );
  }

  const startDateFormatted = new Date(invitation.cohort.startDate).toLocaleDateString('az-AZ', { month: 'short', year: 'numeric' });
  const endDateFormatted = new Date(invitation.cohort.endDate).toLocaleDateString('az-AZ', { month: 'short', year: 'numeric' });

  return (
    <div className="min-h-screen bg-background-warm flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-xl bg-surface rounded-3xl border border-primary/15 shadow-sm p-6 sm:p-8 space-y-6">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Building2 className="h-3.5 w-3.5" /> Akademiya Karyera Dəstəyi
          </span>
          <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-neutral-dark">
            «{invitation.academy.name}» kohortuna qoşulun
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-neutral-dark/65">
            <span className="font-semibold text-primary">{invitation.cohort.name}</span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" /> {startDateFormatted} – {endDateFormatted}
            </span>
            {invitation.expiresAt && (
              <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full text-[11px] font-medium border border-amber-200">
                Son tarix: {new Date(invitation.expiresAt).toLocaleDateString('az-AZ')}
              </span>
            )}
          </div>
        </div>

        {invitation.cohort.description && (
          <p className="text-sm text-neutral-dark/75 leading-relaxed bg-background-warm/50 p-3.5 rounded-xl border border-primary/10">
            {invitation.cohort.description}
          </p>
        )}

        {/* Explicit Consent Explanation Card */}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 space-y-4">
          <div className="flex items-center gap-2 text-primary font-semibold text-sm">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            <span>Məxfilik və paylaşılan məlumatlar</span>
          </div>

          <div className="space-y-3 text-xs leading-relaxed">
            <div>
              <p className="font-semibold text-neutral-dark mb-1">Akademiyanın görəcəyi məlumatlar:</p>
              <ul className="list-disc pl-4 space-y-1 text-neutral-dark/75">
                {invitation.consentExplanation.visibleItems.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="border-t border-primary/10 pt-3">
              <p className="font-semibold text-neutral-dark mb-1">Akademiyanın GÖRMƏYƏCƏYİ məlumatlar:</p>
              <ul className="list-disc pl-4 space-y-1 text-neutral-dark/75">
                {invitation.consentExplanation.hiddenItems.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>

            <p className="text-[11px] text-neutral-dark/60 italic pt-1 border-t border-primary/10">
              {invitation.consentExplanation.revocationNote}
            </p>
          </div>
        </div>

        {/* Optional Identifiable Roster Consent Option */}
        <div className="rounded-2xl border border-neutral-dark/15 bg-background p-4 space-y-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={allowIdentifiableRoster}
              onChange={(e) => setAllowIdentifiableRoster(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-neutral-dark/30 text-primary focus:ring-primary"
            />
            <div className="text-xs">
              <span className="font-semibold text-neutral-dark block">
                Mentorlar üçün kohort siyahısında adım və e-poçtum görünsün (İstəyə bağlı)
              </span>
              <span className="text-neutral-dark/65 block mt-0.5 leading-relaxed">
                İşarələnmədikdə (Defolt): Yalnız anonim aqreqat hesabat aparılır (adınız və e-poçtunuz heç vaxt akademiyaya göstərilmir).
                İşarələndikdə: Kohort mentorlarının fərdi karyera dəstəyi üçün ad və e-poçtunuz kohort siyahısında qeyd olunur. CV mətnləri, telefon nömrəsi və şəxsi qeydlər heç bir halda paylaşılmır.
              </span>
            </div>
          </label>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
          <button
            type="button"
            onClick={handleAccept}
            disabled={submitting}
            className="w-full sm:w-auto flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-hover transition-colors disabled:opacity-60"
          >
            {submitting ? 'Qoşulur...' : 'Razıyam — Kohorta qoşul'}
            <ArrowRight className="h-4 w-4" />
          </button>
          <Link
            href="/"
            className="w-full sm:w-auto text-center px-4 py-3 text-xs font-semibold text-neutral-dark/65 hover:text-neutral-dark transition-colors"
          >
            İmtina et
          </Link>
        </div>
      </div>
    </div>
  );
}
