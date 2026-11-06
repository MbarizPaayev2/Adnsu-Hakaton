'use client';

import React, { useState } from 'react';
import { 
  Bell, Mail, MessageSquare, Moon, Pause, AlertCircle, 
  Check, Loader2, ShieldCheck, Info
} from 'lucide-react';
import { useRetention, LoadingBlock, UnavailableBlock, ErrorBlock, FixtureNotice } from '@/components/retention/shared';
import type { AlertFrequency, NotificationPreferences } from '@/lib/retention/contract';

export function NotificationPreferencesView() {
  const { state, setState, reload } = useRetention(async (api) => {
    const prefs = await api.getPreferences();
    return { prefs, api };
  });

  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (state.status === 'loading') {
    return <LoadingBlock label="Bildiriş seçimləri yüklənir..." />;
  }

  if (state.status === 'unavailable') {
    return (
      <UnavailableBlock
        title="Bildiriş seçimləri"
        alt={{ href: '/dashboard/settings', label: 'Hesab parametrlərinə bax' }}
      />
    );
  }

  if (state.status === 'error') {
    return <ErrorBlock onRetry={reload} text={state.message ?? 'Bildiriş seçimlərini yükləmək mümkün olmadı.'} />;
  }

  const { prefs, api } = state.data;

  const handleUpdate = async (next: NotificationPreferences) => {
    setSaving(true);
    setSavedSuccess(false);
    setErrorMessage(null);

    // Optimistic
    setState({
      ...state,
      data: {
        ...state.data,
        prefs: next,
      },
    });

    try {
      await api.updatePreferences(next);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Yeniləmək mümkün olmadı. Əvvəlki vəziyyət bərpa edildi.');
      setState({
        ...state,
        data: {
          ...state.data,
          prefs,
        },
      });
    } finally {
      setSaving(false);
    }
  };

  const handleConnectTelegram = async () => {
    setErrorMessage(null);
    try {
      const { url } = await api.startTelegramLink();
      window.location.href = url;
    } catch (err: any) {
      setErrorMessage('Telegram bağlantısı hazırda aktiv deyil. Heç bir token tələb olunmur.');
    }
  };

  const handleDisconnectTelegram = async () => {
    setErrorMessage(null);
    try {
      await api.disconnectTelegram();
      handleUpdate({ ...prefs, telegram: 'unlinked', channels: { ...prefs.channels, telegram: false } });
    } catch (err: any) {
      setErrorMessage('Telegram bağlantısını kəsmək mümkün olmadı.');
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <FixtureNotice mode={state.mode} />

      {errorMessage && (
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 p-4 text-xs text-red-800 border border-red-200">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {savedSuccess && (
        <div role="status" className="flex items-center gap-2 rounded-xl bg-highlight/30 p-4 text-xs font-semibold text-primary">
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Seçimləriniz yadda saxlanıldı.</span>
        </div>
      )}

      {/* Global Pause & Unsubscribe */}
      <div className="rounded-2xl border border-outline-variant bg-surface p-6 space-y-4">
        <h2 className="text-base font-bold text-on-background">Ümumi nəzarət</h2>
        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.paused}
              onChange={(e) => handleUpdate({ ...prefs, paused: e.target.checked })}
              disabled={saving}
              className="mt-1 h-4 w-4 rounded-sm border-outline-variant text-primary focus:ring-primary/40"
            />
            <div>
              <span className="text-sm font-semibold text-on-background block">Bütün bildirişləri müvəqqəti dayandır</span>
              <span className="text-xs text-on-surface-variant block">Məzuniyyətdə və ya fasilədə olduğunuz zaman e-poçt və Telegram bildirişləri göndərilməyəcək (30 günə qədər; sonra yenidən yandırılır).</span>
              {prefs.paused && prefs.pausedUntil && <span className="text-xs font-semibold text-primary block">Dayandırılma bitir: {new Date(prefs.pausedUntil).toLocaleDateString('az')}</span>}
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer pt-2 border-t border-outline-variant/40">
            <input
              type="checkbox"
              checked={prefs.unsubscribedAll}
              onChange={(e) => handleUpdate({ ...prefs, unsubscribedAll: e.target.checked })}
              disabled={saving}
              className="mt-1 h-4 w-4 rounded-sm border-outline-variant text-primary focus:ring-primary/40"
            />
            <div>
              <span className="text-sm font-semibold text-on-background block">E-poçt bildirişlərindən imtina et</span>
              <span className="text-xs text-on-surface-variant block">Hesab və təhlükəsizlik məktubları (təsdiq, şifrə) göndərilməyə davam edir. Platforma daxili bildirişlər ayrıca idarə olunur.</span>
            </div>
          </label>
        </div>
      </div>

      {/* Channels */}
      <div className="rounded-2xl border border-outline-variant bg-surface p-6 space-y-4">
        <h2 className="text-base font-bold text-on-background">Bildiriş kanalları</h2>
        <p className="text-xs text-on-surface-variant">Hansı vasitələrlə yeniliklərdən xəbərdar olmaq istədiyinizi seçin.</p>

        <div className="space-y-4 pt-2">
          {/* In-app */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-surface-container p-2 text-primary">
                <Bell className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <span className="text-sm font-semibold text-on-background block">Platforma daxili bildirişlər</span>
                <span className="text-xs text-on-surface-variant block">İstifadəçi panelinin zəng nişanında görünür</span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={prefs.channels.inApp}
              onChange={(e) =>
                handleUpdate({ ...prefs, channels: { ...prefs.channels, inApp: e.target.checked } })
              }
              disabled={saving || prefs.paused || prefs.unsubscribedAll}
              className="h-5 w-5 rounded-sm border-outline-variant text-primary focus:ring-primary/40"
              aria-label="Platforma daxili bildirişlər"
            />
          </div>

          {/* Email */}
          <div className="flex items-center justify-between gap-4 pt-3 border-t border-outline-variant/40">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-surface-container p-2 text-primary">
                <Mail className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <span className="text-sm font-semibold text-on-background block">E-poçt bildirişləri</span>
                <span className="text-xs text-on-surface-variant block">Yeni uyğun vakansiyalar olduqda: Plus gündə 1, Premium gündə 5 yeni elana qədər bir gündəlik məktubda; ödənişsiz planda həftədə bir məktubda 3 yeni elana qədər. Eyni elan təkrarlanmır. Axtarış bildirişləri aşağıdakı tezliyə uyğun göndərilir.</span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={prefs.channels.email}
              onChange={(e) =>
                handleUpdate({ ...prefs, channels: { ...prefs.channels, email: e.target.checked } })
              }
              disabled={saving || prefs.paused || prefs.unsubscribedAll}
              className="h-5 w-5 rounded-sm border-outline-variant text-primary focus:ring-primary/40"
              aria-label="E-poçt bildirişləri"
            />
          </div>

          <label className="flex items-center justify-between gap-4 pt-3 border-t border-outline-variant/40 text-sm">
            <span>Plan üstünlükləri haqqında həftədə ən çox 1 əlavə məktub (istəyə bağlı)</span>
            <input type="checkbox" aria-label="Plan təklifləri" checked={prefs.planOffersEmail === true} disabled={saving || prefs.paused || prefs.unsubscribedAll} onChange={(e) => handleUpdate({ ...prefs, planOffersEmail: e.target.checked })} />
          </label>
          {/* Telegram */}
          <div className="pt-3 border-t border-outline-variant/40 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-surface-container p-2 text-primary">
                  <MessageSquare className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <span className="text-sm font-semibold text-on-background block">Telegram bildirişləri</span>
                  <span className="text-xs text-on-surface-variant block">Təhlükəsiz bot vasitəsilə dərhal xəbərdarlıq</span>
                </div>
              </div>

              {prefs.telegram === 'linked' ? (
                <button
                  type="button"
                  onClick={handleDisconnectTelegram}
                  disabled={saving}
                  className="inline-flex min-h-11 items-center px-4 rounded-full border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  Bağlantını kəs
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectTelegram}
                  disabled={saving || prefs.telegram === 'unavailable'}
                  className="inline-flex min-h-11 items-center px-4 rounded-full border border-outline-variant text-xs font-semibold text-accent hover:bg-surface-container"
                >
                  {prefs.telegram === 'unavailable' ? 'Tezliklə' : 'Telegram-ı qoş'}
                </button>
              )}
            </div>

            <p className="text-[11px] text-on-surface-variant flex items-start gap-1.5 bg-surface-container-low p-3 rounded-xl">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary mt-0.5" aria-hidden="true" />
              <span>
                Telegram bağlantısı AISE-nin verdiyi birdəfəlik, qısa müddətli keçidlə qurulur. Çatda heç vaxt bot tokeni və ya şifrə soruşulmur.
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Frequency & Quiet Hours */}
      <div className="rounded-2xl border border-outline-variant bg-surface p-6 space-y-4">
        <h2 className="text-base font-bold text-on-background">Tezlik və sakit saatlar</h2>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="pref-frequency" className="block text-xs font-semibold text-on-background">
              Xülasə göndəriş tezliyi
            </label>
            <select
              id="pref-frequency"
              value={prefs.frequency}
              onChange={(e) => handleUpdate({ ...prefs, frequency: e.target.value as AlertFrequency })}
              disabled={saving || prefs.paused || prefs.unsubscribedAll}
              className="block w-full min-h-11 rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-background focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
            >
              <option value="daily">Gündəlik xülasə (hər səhər)</option>
              {api.capabilities.weeklyDigest && <option value="weekly">Həftəlik xülasə (bazar ertəsi)</option>}
              <option value="instant" disabled={!!prefs.instant && !prefs.instant.available}>
                {prefs.instant && !prefs.instant.available ? 'Dərhal (planınıza daxil deyil)' : prefs.instant?.dailyLimit ? `Dərhal (gündə ən çox ${prefs.instant.dailyLimit})` : 'Dərhal (elan yayımlanan kimi)'}
              </option>
            </select>
          </div>

          <div className="pt-3 border-t border-outline-variant/40 space-y-3">
            <label className="tap flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.quietHours.enabled}
                onChange={(e) =>
                  handleUpdate({
                    ...prefs,
                    quietHours: { ...prefs.quietHours, enabled: e.target.checked },
                  })
                }
                disabled={saving || prefs.paused || prefs.unsubscribedAll}
                className="h-4 w-4 rounded-sm border-outline-variant text-primary focus:ring-primary/40"
              />
              <span className="flex items-center gap-2 text-sm font-semibold text-on-background">
                <Moon className="h-4 w-4 text-primary" aria-hidden="true" /> Sakit saatlar (gecə rejimi)
              </span>
            </label>

            {prefs.quietHours.enabled && (
              <div className="grid grid-cols-2 gap-3 pl-7">
                <div>
                  <label htmlFor="quiet-from" className="block text-xs font-medium text-on-surface-variant mb-1">
                    Başlama saatı
                  </label>
                  <input
                    id="quiet-from"
                    type="time"
                    value={prefs.quietHours.from}
                    onChange={(e) =>
                      handleUpdate({
                        ...prefs,
                        quietHours: { ...prefs.quietHours, from: e.target.value },
                      })
                    }
                    className="block w-full min-h-11 rounded-xl border border-outline-variant bg-surface px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                  />
                </div>
                <div>
                  <label htmlFor="quiet-to" className="block text-xs font-medium text-on-surface-variant mb-1">
                    Bitmə saatı
                  </label>
                  <input
                    id="quiet-to"
                    type="time"
                    value={prefs.quietHours.to}
                    onChange={(e) =>
                      handleUpdate({
                        ...prefs,
                        quietHours: { ...prefs.quietHours, to: e.target.value },
                      })
                    }
                    className="block w-full min-h-11 rounded-xl border border-outline-variant bg-surface px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Explanations of Alert Contents */}
      <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-6 space-y-3">
        <h3 className="text-sm font-bold text-on-background flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" aria-hidden="true" />
          Bildirişlərin məzmunu
        </h3>
        <ul className="text-xs text-on-surface-variant space-y-2 list-disc list-inside">
          <li><strong>Yeni uyğunluqlar:</strong> Profilinizə uyğun yeni vakansiyalar tapıldıqda göndərilir (uyğunluq xəbərdarlığı).</li>
          <li><strong>Yeni elanlar:</strong> Saxladığınız axtarışlara və izlədiyiniz şirkətlərə uyğun yeni elanlar çıxdıqda göndərilir. Bu uyğunluq balı deyil, yalnız seçiminizə uyğunluqdur.</li>
        </ul>
      </div>
    </div>
  );
}
