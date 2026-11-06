'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';

const BOX = 'product-card rounded-2xl border border-neutral-dark/10 bg-background p-5 space-y-3';
const INPUT = 'w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm text-neutral-dark';
const BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-50';

interface Settings { sendingPausedAt: string | null; consentRevokedAt: string | null; automationEnabled: boolean }
interface Capabilities { enabled: boolean; testMode: boolean; emergencyPaused: boolean; automationAvailable: boolean; automationPremiumRequired?: boolean; reviewQueueAvailable?: boolean }
interface Automation {
  available: boolean; enabled: boolean; consentedAt: string | null;
  rules: { allowedRoles: string[]; allowedLocations: string[]; allowedEmployers: string[]; excludedEmployers: string[]; excludedKeywords: string[]; dailyLimit: number; cvResumeId: string | null; letterTemplate: string };
  decisions: { jobId: string; outcome: string; reason: string; at: string }[];
  reviewQueue?: { available: boolean; enabled: boolean; since: string | null; pending: number; maxPending: number };
}
interface Resume { id: string; isBase: boolean; status: string; createdAt: string; version: number }

const REASONS: Record<string, string> = {
  RULES_MATCHED: 'Qaydalarınıza uyğun idi', ROLE_NOT_ALLOWED: 'Vəzifə qaydalarına uyğun deyil', LOCATION_UNKNOWN: 'Elanda şəhər bəlli deyil', LOCATION_NOT_ALLOWED: 'Şəhər qaydalarına uyğun deyil',
  EMPLOYER_NOT_ALLOWED: 'İşəgötürən icazə siyahısında deyil', EXCLUDED_EMPLOYER: 'İstisna etdiyiniz işəgötürən', EXCLUDED_KEYWORD: 'İstisna etdiyiniz söz var',
  EXTRA_REQUIREMENTS: 'Elan CV-dən əlavə tələb edir (əl ilə baxın)', NO_CV: 'CV uyğun deyil', NOT_ELIGIBLE: 'Müraciət mümkün olmadı', PREPARE_FAILED: 'Hazırlanmadı', ALREADY_EXISTS: 'Bu vakansiya üçün artıq müraciətiniz var',
};

const lines = (value: string) => value.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
async function errorOf(res: Response) {
  const data = await res.json().catch(() => ({}));
  return (Array.isArray(data.message) ? data.message.join(', ') : data.message) || `Xəta (${res.status})`;
}

export default function EmailApplicationSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [auto, setAuto] = useState<Automation | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<'cancel' | 'revoke' | null>(null);

  const [roles, setRoles] = useState('');
  const [locations, setLocations] = useState('');
  const [employers, setEmployers] = useState('');
  const [excludedEmployers, setExcludedEmployers] = useState('');
  const [excludedKeywords, setExcludedKeywords] = useState('');
  const [dailyLimit, setDailyLimit] = useState(3);
  const [cvId, setCvId] = useState('');
  const [template, setTemplate] = useState('');
  const [consent, setConsent] = useState(false);

  const fillAutomation = (a: Automation) => {
    setAuto(a);
    setRoles(a.rules.allowedRoles.join('\n')); setLocations(a.rules.allowedLocations.join('\n')); setEmployers(a.rules.allowedEmployers.join('\n'));
    setExcludedEmployers(a.rules.excludedEmployers.join('\n')); setExcludedKeywords(a.rules.excludedKeywords.join('\n'));
    setDailyLimit(a.rules.dailyLimit); setCvId(a.rules.cvResumeId ?? ''); setTemplate(a.rules.letterTemplate);
  };

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([apiFetch('/email-applications/settings', { cache: 'no-store' }), apiFetch('/email-applications/capabilities', { cache: 'no-store' })]);
      if (!s.ok || !c.ok) return setError('Parametrlər yüklənmədi.');
      setSettings(await s.json());
      const capabilities: Capabilities = await c.json();
      setCaps(capabilities);
      if (capabilities.automationAvailable || capabilities.reviewQueueAvailable) {
        const [a, r] = await Promise.all([apiFetch('/email-applications/automation', { cache: 'no-store' }), apiFetch('/resumes', { cache: 'no-store' })]);
        if (a.ok) fillAutomation(await a.json());
        if (r.ok) setResumes(await r.json());
      }
    } catch {
      setError('Bağlantı xətası.');
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const act = async (success: string, request: () => Promise<Response>) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await request();
      if (!res.ok) { setError(await errorOf(res)); return; }
      setNotice(success);
      setConfirming(null);
      await load();
    } catch {
      setError('Bağlantı xətası.');
    } finally {
      setBusy(false);
    }
  };
  const post = (path: string) => () => apiFetch(`/email-applications/${path}`, { method: 'POST' });

  if (!settings || !caps) return error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p> : <div className="flex items-center gap-2 p-6" role="status"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Yüklənir...</div>;

  const saveRules = (enable?: boolean, review?: boolean) => act(review ? 'Hazırlıq aktivləşdirildi: uyğun yeni elanlar üçün müraciətləri hazırlayıb təsdiqinizə göndərəcəyik.' : enable ? 'Avtomatik müraciət aktivləşdirildi.' : 'Qaydalar saxlanıldı.', () => apiFetch('/email-applications/automation', {
    method: 'PUT',
    body: JSON.stringify({
      ...(enable !== undefined ? { enabled: enable } : {}), ...(enable ? { consent: true } : {}), ...(review !== undefined ? { reviewQueue: review } : {}),
      allowedRoles: lines(roles), allowedLocations: lines(locations), allowedEmployers: lines(employers), excludedEmployers: lines(excludedEmployers), excludedKeywords: lines(excludedKeywords),
      dailyLimit, cvResumeId: cvId || undefined, letterTemplate: template,
    }),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard/email-applications" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent"><ChevronLeft className="h-4 w-4" aria-hidden="true" /> E-poçt müraciətləri və vakansiyalar</Link>
      <h1 className="font-serif text-2xl font-bold text-neutral-dark md:text-3xl">E-poçt müraciətlərinin idarəsi</h1>
      <p className="text-sm text-neutral-dark/70">Burada AISE-nin sizin adınıza nə vaxt və necə müraciət etdiyini idarə edirsiniz: hər müraciəti özünüz təsdiqləyirsiniz{caps.automationAvailable ? ', istəsəniz açıq icazə və limitlərlə avtomatik göndərişi aça bilərsiniz' : ''}. İstənilən an dayandıra bilərsiniz.</p>
      {caps.testMode && <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Sınaq rejimi: məktublar heç yerə göndərilmir.</p>}
      {caps.emergencyPaused && <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Sistem müvəqqəti dayandırılıb: növbədəki müraciətlər gözləyir.</p>}
      {notice && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <section className={BOX} aria-labelledby="control-title">
        <h2 id="control-title" className="font-serif text-lg font-bold">Göndərişə nəzarət</h2>
        <p className="text-sm text-neutral-dark/75">Bu düymələr yalnız sizin müraciətlərinizə aiddir və dərhal işləyir. Artıq göndərilmiş e-poçtu geri götürmək mümkün deyil.</p>
        <p className="text-sm">{settings.sendingPausedAt ? <strong>Göndəriş dayandırılıb ({formatDate(settings.sendingPausedAt)}). Növbədəkilər itmir, gözləyir.</strong> : 'Göndəriş aktivdir.'}</p>
        <div className="flex flex-wrap gap-3">
          {settings.sendingPausedAt
            ? <button type="button" className={`${BUTTON} bg-primary text-white`} disabled={busy} onClick={() => act('Göndəriş davam etdirildi.', post('settings/resume'))}>Göndərişi davam etdir</button>
            : <button type="button" className={`${BUTTON} border border-neutral-dark/20`} disabled={busy} onClick={() => act('Göndəriş dayandırıldı.', post('settings/pause'))}>Göndərişi dayandır</button>}
          <button type="button" className={`${BUTTON} border border-red-300 text-red-700`} disabled={busy} onClick={() => setConfirming('cancel')}>Gözləyənləri ləğv et</button>
          <button type="button" className={`${BUTTON} border border-red-300 text-red-700`} disabled={busy} onClick={() => setConfirming('revoke')}>Razılığı geri götür</button>
        </div>
        {confirming && (
          <div role="alertdialog" aria-labelledby="confirm-title" className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4">
            <p id="confirm-title" className="text-sm font-medium">{confirming === 'cancel' ? 'Təsdiq gözləyən və növbədəki bütün müraciətlər ləğv edilsin?' : 'Bütün gözləyən müraciətlər ləğv edilsin və avtomatik göndəriş söndürülsün?'}</p>
            <div className="flex gap-3">
              <button type="button" className={`${BUTTON} bg-red-700 text-white`} disabled={busy} onClick={() => act(confirming === 'cancel' ? 'Gözləyən müraciətlər ləğv edildi.' : 'Razılıq geri götürüldü.', post(confirming === 'cancel' ? 'settings/cancel-pending' : 'settings/revoke-consent'))}>Bəli, ləğv et</button>
              <button type="button" className={`${BUTTON} border border-neutral-dark/20`} onClick={() => setConfirming(null)}>Vaz keç</button>
            </div>
          </div>
        )}
        {settings.consentRevokedAt && <p className="text-xs text-neutral-dark/60">Razılıq geri götürülüb: {formatDate(settings.consentRevokedAt)}. Yeni müraciət üçün hər dəfə yenidən təsdiq verirsiniz.</p>}
      </section>

      {caps.automationPremiumRequired && <section className={BOX}><h2 className="font-semibold">Avtomatik e-poçt müraciətləri Premium planına daxildir</h2><p className="text-sm">Təsdiqlədiyiniz CV və məktub, seçdiyiniz vəzifə və şəhər qaydaları ilə işləyir. Cavablar təsdiqlənmiş şəxsi e-poçtunuza gəlir.</p><Link href="/pricing" className="underline">Planlara bax</Link></section>}
      {(caps.automationAvailable || caps.reviewQueueAvailable) && auto && (
        <section className={BOX} aria-labelledby="auto-title">
          <h2 id="auto-title" className="font-serif text-lg font-bold">Müraciət agenti · Premium</h2>
          <p className="text-sm text-neutral-dark/75">AISE serverdə, kompüteriniz bağlı olanda da, yeni elanları aşağıdakı qaydalarla yoxlayır. Yalnız e-poçtla müraciət qəbul edən elanlar üçün işləyir; vaxtı keçmiş, təkrarlanan və artıq müraciət etdiyiniz elanlar çıxarılır.</p>
          <label className="block space-y-1 text-sm font-medium">Vəzifələr (hər sətirdə biri)<textarea className={`${INPUT} min-h-16`} value={roles} onChange={(e) => setRoles(e.target.value)} /></label>
          <label className="block space-y-1 text-sm font-medium">Şəhərlər<textarea className={`${INPUT} min-h-16`} value={locations} onChange={(e) => setLocations(e.target.value)} /></label>
          <label className="block space-y-1 text-sm font-medium">Yalnız bu işəgötürənlər (boş = istisna olunmayanların hamısı)<textarea className={`${INPUT} min-h-16`} value={employers} onChange={(e) => setEmployers(e.target.value)} /></label>
          <label className="block space-y-1 text-sm font-medium">İstisna olunan işəgötürənlər<textarea className={`${INPUT} min-h-16`} value={excludedEmployers} onChange={(e) => setExcludedEmployers(e.target.value)} /></label>
          <label className="block space-y-1 text-sm font-medium">İstisna olunan sözlər<textarea className={`${INPUT} min-h-16`} value={excludedKeywords} onChange={(e) => setExcludedKeywords(e.target.value)} /></label>
          <label className="block space-y-1 text-sm font-medium">Gündəlik limit (1–10)<input type="number" min={1} max={10} className={INPUT} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} /></label>
          <label className="block space-y-1 text-sm font-medium">CV (yalnız əsas CV)
            <select className={INPUT} value={cvId} onChange={(e) => setCvId(e.target.value)}>
              <option value="">Seçin</option>
              {resumes.filter((r) => r.isBase && r.status === 'READY').map((r) => <option key={r.id} value={r.id}>Əsas CV · v{r.version} · {formatDate(r.createdAt)}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm font-medium">Məktub şablonu ({'{{title}}'}, {'{{company}}'}, {'{{reference}}'}, {'{{name}}'}){caps.automationAvailable ? '' : ' · istəyə bağlı'}<textarea className={`${INPUT} min-h-28`} value={template} onChange={(e) => setTemplate(e.target.value)} /></label>

          {auto.reviewQueue?.available && (
            <div className="space-y-2 rounded-xl border border-primary/30 bg-highlight/30 p-4" data-testid="review-queue">
              <h3 className="font-semibold">1. Hazırlasın, mən təsdiqləyim (tövsiyə olunur)</h3>
              <p className="text-sm text-neutral-dark/80">Qaydalarınıza uyğun yeni elan çıxanda AISE müraciəti hazırlayır və sizə bildirir. Heç nə göndərilmir: hər müraciəti açıb yoxlayır, düzəldir və özünüz təsdiqləyirsiniz. Eyni anda ən çox {auto.reviewQueue.maxPending} hazır müraciət gözləyə bilər.</p>
              <p className="text-sm">{auto.reviewQueue.enabled ? <strong>Aktivdir{auto.reviewQueue.since ? ` (${formatDate(auto.reviewQueue.since)} tarixindən gələn elanlar)` : ''}. Təsdiqinizi gözləyən: {auto.reviewQueue.pending}.</strong> : 'Söndürülüb.'}</p>
              <div className="flex flex-wrap gap-3">
                {auto.reviewQueue.enabled
                  ? <>
                      <button type="button" className={`${BUTTON} bg-primary text-white`} disabled={busy} onClick={() => saveRules(undefined, true)}>Qaydaları saxla</button>
                      <button type="button" className={`${BUTTON} border border-neutral-dark/20`} disabled={busy} onClick={() => act('Hazırlıq dayandırıldı. Hazır müraciətlər yerində qalır; heç biri göndərilməyib.', post('automation/review/stop'))}>Dayandır</button>
                      {auto.reviewQueue.pending > 0 && <Link href="/dashboard/applications" className={`${BUTTON} border border-neutral-dark/20`}>Gözləyənlərə bax</Link>}
                    </>
                  : <button type="button" className={`${BUTTON} bg-primary text-white`} disabled={busy} onClick={() => saveRules(undefined, true)}>Aktivləşdir</button>}
              </div>
            </div>
          )}

          {caps.automationAvailable && (
            <div className="space-y-2 rounded-xl border border-neutral-dark/10 p-4">
              <h3 className="font-semibold">2. Qaydalarıma uyğun özü göndərsin</h3>
              <p className="text-sm text-neutral-dark/75">Ayrıca razılıq tələb edir. Qaydalarınıza tam uyğun yeni elanlara əsas CV və yuxarıdakı şablonla, sizin təsdiqiniz olmadan e-poçtla müraciət göndərilir. Elanda şəhər bəlli deyilsə, CV-dən əlavə tələb varsa və ya qaydalar uyğun gəlmirsə, göndərmir{auto.reviewQueue?.enabled ? '; belə elanlar təsdiqiniz üçün hazırlanır' : ''}.</p>
              <p className="text-sm">Göndərən: ad.soyad.unikal-kod@aisehr.com. Bu, ayrıca poçt qutusu deyil; işəgötürənin cavabı təsdiqlənmiş şəxsi e-poçtunuza gəlir.</p>
              <p className="text-sm">{auto.enabled ? <strong>Aktivdir ({formatDate(auto.consentedAt)}).</strong> : 'Söndürülüb.'}</p>
              {!auto.enabled && <label className="flex items-start gap-2 text-sm font-medium"><input type="checkbox" className="mt-1 h-4 w-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Yuxarıdakı qaydalara və CV-yə uyğun elanlara mənim adımdan, mənim təsdiqim olmadan e-poçtla müraciət göndərilməsinə razıyam. İstədiyim vaxt geri götürə bilərəm.</label>}
              <div className="flex flex-wrap gap-3">
                {auto.enabled
                  ? <>
                      <button type="button" className={`${BUTTON} bg-primary text-white`} disabled={busy} onClick={() => saveRules()}>Qaydaları saxla</button>
                      <button type="button" className={`${BUTTON} border border-neutral-dark/20`} disabled={busy} onClick={() => act('Avtomatik müraciət söndürüldü.', post('automation/disable'))}>Söndür</button>
                    </>
                  : <button type="button" className={`${BUTTON} bg-primary text-white`} disabled={busy || !consent} onClick={() => saveRules(true)}>Razılıqla aktivləşdir</button>}
              </div>
            </div>
          )}

          {auto.decisions.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">Son qərarlar</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {auto.decisions.map((d) => <li key={d.jobId} className="flex flex-wrap justify-between gap-2"><span>{d.outcome === 'APPLIED' ? 'Göndərildi' : d.outcome === 'PREPARED' ? 'Təsdiqiniz üçün hazırlandı' : 'Dayandı'} — {REASONS[d.reason] ?? d.reason}</span><span className="text-xs text-neutral-dark/60">{formatDate(d.at)}</span></li>)}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
