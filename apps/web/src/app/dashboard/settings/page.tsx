'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { apiFetch } from '@/lib/api';
import { PLAN_WEEKLY_MATCH_QUOTAS, PLAN_MATCH_QUOTAS, PLAN_DAILY_MATCH_QUOTAS } from '@aise/shared-types';
import { CreditCard, KeyRound, AlertTriangle } from 'lucide-react';
import { formatDate } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABELS, usePaymentsEnabled, type SubscriptionView } from '@/lib/billing';
import { AcademyConsentSettings } from '@/components/academy-consent-settings';

const INPUT_CLASS =
  'mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all';

function messageForError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function SettingsPage() {
  const router = useRouter();
  const [sub, setSub] = useState<SubscriptionView | null>(null);
  const paymentsEnabled = usePaymentsEnabled();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch('/billing/subscription')
      .then(async (res) => {
        if (!res.ok) throw new Error('Abunəlik məlumatları yüklənə bilmədi');
        return res.json();
      })
      .then((data) => { if (active) setSub(data); })
      .catch((err: unknown) => { if (active) setError(messageForError(err, 'Abunəlik məlumatlarını yükləyərkən xəta baş verdi.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const handlePortalRedirect = async () => {
    if (!sub?.providerManaged) {
      router.push('/pricing');
      return;
    }

    setActionLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await apiFetch('/billing/portal-session', { method: 'POST' });
      if (!res.ok) throw new Error('Ödəniş idarəetməsinə yönləndirilə bilmədi');

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      setError(messageForError(err, 'Məlumat alınarkən xəta baş verdi.'));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-neutral-dark/65">Abunəlik məlumatları yüklənir...</p>
      </div>
    );
  }

  const translatedPlanName = sub?.plan === 'FREE' ? 'ÖDƏNİŞSİZ' : sub?.plan || 'ÖDƏNİŞSİZ';
  const matchQuota = PLAN_MATCH_QUOTAS[(sub?.plan as keyof typeof PLAN_MATCH_QUOTAS) || 'FREE'];

  const dailyQuota = PLAN_DAILY_MATCH_QUOTAS[sub?.plan || 'FREE'];
  const weeklyQuota = PLAN_WEEKLY_MATCH_QUOTAS[sub?.plan || 'FREE'];

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">
      <div>
        <h1 className="font-serif text-3xl font-bold text-neutral-dark">Parametrlər və abunəlik</h1>
        <p className="mt-1 text-sm text-neutral-dark/70">
          Abunəlik planınızı idarə edin.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100" role="alert">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg bg-green-50 p-4 text-sm text-green-700 border border-green-100" role="alert">
          {success}
        </div>
      )}

      <div className="max-w-xl">
        {/* Billing Status */}
        <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 p-6 shadow-xs space-y-6">
          <h2 className="font-serif text-xl font-bold text-neutral-dark flex items-center gap-2 border-b border-neutral-dark/5 pb-2">
            <CreditCard className="h-5 w-5 text-accent" /> Abunəlik statusu
          </h2>

          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-neutral-dark/5">
              <span className="text-sm text-neutral-dark/65">Aktiv plan</span>
              <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary border border-primary/10 uppercase">
                {translatedPlanName}
              </span>
            </div>

            <div className="flex justify-between items-center py-2 border-b border-neutral-dark/5">
              <span className="text-sm text-neutral-dark/65">Status</span>
              <span className="text-sm font-semibold text-neutral-dark">{SUBSCRIPTION_STATUS_LABELS[sub?.status || 'active'] || sub?.status}</span>
            </div>

            <div className="flex justify-between items-center py-2 border-b border-neutral-dark/5">
              <span className="text-sm text-neutral-dark/65">{weeklyQuota !== undefined ? 'Bu həftə istifadə olunan yeni uyğunluqlar' : dailyQuota !== undefined ? 'Bu gün istifadə olunan yeni uyğunluqlar' : 'Bu dövrdə istifadə olunan uyğunluqlar'}</span>
              <span className="text-sm font-semibold text-neutral-dark">
                {weeklyQuota !== undefined ? `${sub?.matchesUsedThisWeek ?? 0} / ${weeklyQuota}` : dailyQuota !== undefined ? `${sub?.matchesUsedToday ?? 0} / ${dailyQuota}` : `${sub?.matchesUsedThisPeriod ?? 0} / ${matchQuota === null ? 'Sonsuz' : matchQuota}`}
              </span>
            </div>

            {weeklyQuota !== undefined && <p className="text-xs text-neutral-dark/65">Həftəlik limit bazar ertəsi Bakı vaxtı ilə 00:00-da yenilənir; istifadə olunmayan limit yığılmır.</p>}
            {dailyQuota !== undefined && <p className="text-xs text-neutral-dark/65">Limit hər gün Bakı vaxtı ilə 00:00-da yenilənir. Yeni uyğun vakansiyalar olduqda göstərilir; istifadə olunmayan limit yığılmır.</p>}

            {sub?.override && (
              <p className="rounded-lg bg-primary/5 border border-primary/10 p-3 text-xs text-neutral-dark/80">
                {sub.override.plan} planı komandamız tərəfindən {formatDate(sub.override.expiresAt)} tarixinədək verilib. Ödəniş abunəliyinizə təsir etmir.
              </p>
            )}

            {sub?.sponsoredAccess && (
              <p className="rounded-lg bg-primary/5 border border-primary/10 p-3 text-xs leading-relaxed text-neutral-dark/80">
                <strong>{sub.sponsoredAccess.academyName}</strong> sizin üçün {sub.sponsoredAccess.plan} planını {formatDate(sub.sponsoredAccess.expiresAt)} tarixinədək təmin edir.
                {sub.sponsoredAccess.matchesPerDay !== null && ` Hesabınızda gündə ${sub.sponsoredAccess.matchesPerDay} uyğunluq limiti var; bu gün ${sub.sponsoredAccess.matchesRemainingToday ?? 0} qalıb.`}
                {' '}Şəxsi abunəliyinizlə sponsor limitləri toplanmır; hesabınız daha yüksək uyğun planın limitindən istifadə edir.
              </p>
            )}

            {sub?.providerManaged && sub.status !== 'active' && (
              <p role="alert" className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                Abunəliyiniz hazırda aktiv deyil, ona görə ödənişsiz planın limitləri tətbiq olunur. Ödəniş məlumatlarınızı aşağıdakı düymə ilə yeniləyə bilərsiniz.
              </p>
            )}

            {sub?.currentPeriodEnd && (
              <div className="flex justify-between items-center py-2 border-b border-neutral-dark/5">
                <span className="text-sm text-neutral-dark/65">{sub.cancelAtPeriodEnd ? 'Abunəlik bitir' : 'Yenilənmə tarixi'}</span>
                <span className="text-sm font-semibold text-neutral-dark">
                  {formatDate(sub.currentPeriodEnd)}
                </span>
              </div>
            )}
          </div>

          {sub?.providerManaged ? (
            <button
              onClick={handlePortalRedirect}
              disabled={actionLoading}
              className="w-full min-h-11 inline-flex justify-center items-center py-2.5 px-4 product-action rounded-full bg-primary text-white text-sm font-semibold hover:bg-primary-hover shadow-xs transition-all disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
            >
              Abunəliyi idarə et (Dodo Payments)
            </button>
          ) : paymentsEnabled ? (
            <button
              onClick={handlePortalRedirect}
              className="w-full min-h-11 inline-flex justify-center items-center py-2.5 px-4 product-action rounded-full bg-primary text-white text-sm font-semibold hover:bg-primary-hover shadow-xs transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
            >
              Planları müqayisə et
            </button>
          ) : paymentsEnabled === false ? (
            <p className="text-xs text-neutral-dark/60">Ödənişli planlar hələ aktiv deyil.</p>
          ) : null}
        </div>

        <AcademyConsentSettings />
        <ChangePasswordSection />

        <DeleteAccountSection hasPaidPlan={!!sub?.providerManaged && sub.status !== 'cancelled' && sub.status !== 'expired'} />
      </div>
    </div>
  );
}

function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 8) {
      setError('Yeni şifrə ən azı 8 simvoldan ibarət olmalıdır.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Yeni şifrələr eyni deyil.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Şifrə dəyişdirilə bilmədi.');
      }
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setError(messageForError(err, 'Şifrə dəyişdirilərkən xəta baş verdi.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="product-card mt-6 rounded-2xl bg-background border border-neutral-dark/5 p-6 shadow-xs space-y-4">
      <h2 className="font-serif text-xl font-bold text-neutral-dark flex items-center gap-2 border-b border-neutral-dark/5 pb-2">
        <KeyRound className="h-5 w-5 text-accent" /> Şifrəni dəyiş
      </h2>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-100" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700 border border-green-100" role="alert">
          Şifrəniz uğurla dəyişdirildi.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="pw-current" className="block text-xs font-semibold text-neutral-dark/85">Hazırkı şifrə</label>
          <input
            id="pw-current"
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor="pw-new" className="block text-xs font-semibold text-neutral-dark/85">Yeni şifrə</label>
          <input
            id="pw-new"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor="pw-confirm" className="block text-xs font-semibold text-neutral-dark/85">Yeni şifrəni təkrar edin</label>
          <input
            id="pw-confirm"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-11 inline-flex justify-center items-center py-2.5 px-4 product-action rounded-full bg-primary text-white text-sm font-semibold hover:bg-primary-hover shadow-xs transition-all disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
        >
          {submitting ? 'Dəyişdirilir...' : 'Şifrəni Dəyiş'}
        </button>
      </form>
    </div>
  );
}

function DeleteAccountSection({ hasPaidPlan }: { hasPaidPlan: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch('/auth/account', {
        method: 'DELETE',
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Hesab silinə bilmədi.');
      }
      // The account (and its API-side session) is gone — just clear the
      // local NextAuth cookie and send them off the dashboard.
      await signOut({ callbackUrl: '/' });
    } catch (err: unknown) {
      setError(messageForError(err, 'Hesab silinərkən xəta baş verdi.'));
      setSubmitting(false);
    }
  };

  return (
    <div className="product-card mt-6 rounded-2xl bg-background border border-red-200 p-6 shadow-xs space-y-4">
      <h2 className="font-serif text-xl font-bold text-red-700 flex items-center gap-2 border-b border-red-100 pb-2">
        <AlertTriangle className="h-5 w-5" /> Hesabı sil
      </h2>

      <p className="text-sm text-neutral-dark/70">
        Hesabınızı sildikdə profiliniz, CV-ləriniz, uyğunluqlarınız və bütün digər məlumatlarınız
        həmişəlik silinəcək. Bu əməliyyat geri qaytarıla bilməz.
        {hasPaidPlan && ' Aktiv abunəliyiniz avtomatik ləğv ediləcək.'}
      </p>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-100" role="alert">
          {error}
        </div>
      )}

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-11 inline-flex items-center justify-center rounded-xl border border-red-300 text-red-700 px-5 py-2.5 text-sm font-semibold hover:bg-red-50 transition-colors focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-hidden"
        >
          Hesabımı sil
        </button>
      ) : (
        <form onSubmit={handleDelete} className="space-y-3">
          <div>
            <label htmlFor="delete-password" className="block text-xs font-semibold text-neutral-dark/85">
              Təsdiqləmək üçün şifrənizi daxil edin
            </label>
            <input
              id="delete-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 inline-flex items-center justify-center rounded-xl bg-red-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-hidden"
            >
              {submitting ? 'Silinir...' : 'Həmişəlik sil'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setPassword('');
                setError(null);
              }}
              disabled={submitting}
              className="min-h-11 inline-flex items-center justify-center rounded-xl border border-neutral-dark/20 px-5 py-2.5 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
            >
              İmtina
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
