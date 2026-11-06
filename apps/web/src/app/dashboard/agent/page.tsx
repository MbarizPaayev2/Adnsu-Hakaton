'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bot, ChevronLeft, Loader2, MonitorSmartphone, Ban, Plus } from 'lucide-react';
import { apiFetch, downloadAuthedFile } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { ErrorState, LoadingState } from '@/components/ui';
import { TONES, REASON, deviceConnection, errorOf, stateOf, type AgentApplication, type AgentCampaign, type AgentCapabilities, type AgentDevice } from '@/lib/agent';
import { browserSupport, detectExtension, olderThan, pairErrorText, pairViaExtension, type BrowserSupport, type ExtensionPresence } from '@/lib/extension-bridge';

const BOX = 'product-card rounded-2xl border border-neutral-dark/10 bg-background p-5 space-y-3';
const BTN = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const PRIMARY = `${BTN} bg-primary text-white hover:bg-primary/90`;
const SECONDARY = `${BTN} border border-neutral-dark/25 text-neutral-dark hover:bg-neutral-dark/5`;
const DANGER = `${BTN} border border-red-300 text-red-800 hover:bg-red-50`;

/** Application states that change without the candidate doing anything; the page checks more often while one exists. */
const ACTIVE_STATES = new Set(['QUEUED', 'PREPARING', 'READY', 'SUBMITTING']);

const CAMPAIGN_STATUS: Record<string, string> = { ACTIVE: 'Aktiv', PAUSED: 'Dayandırılıb', REVOKED: 'Razılıq geri götürülüb', EXPIRED: 'Müddəti bitib', STOPPED: 'Təcili dayandırılıb' };

function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export default function AgentHubPage() {
  const [caps, setCaps] = useState<AgentCapabilities | null | 'error'>(null);
  const [devices, setDevices] = useState<AgentDevice[]>([]);
  const [campaigns, setCampaigns] = useState<AgentCampaign[]>([]);
  const [apps, setApps] = useState<AgentApplication[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'revoke' | 'stop-all'; id?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await apiFetch('/agent/capabilities', { cache: 'no-store' });
      if (!c.ok) return setCaps('error');
      const capabilities: AgentCapabilities = await c.json();
      setCaps(capabilities);
      if (!capabilities.enabled) return;
      const [d, k, a] = await Promise.all([apiFetch('/agent/devices', { cache: 'no-store' }), apiFetch('/agent/campaigns', { cache: 'no-store' }), apiFetch('/agent/applications', { cache: 'no-store' })]);
      if (d.ok) setDevices(await d.json());
      if (k.ok) setCampaigns(await k.json());
      if (a.ok) setApps(await a.json());
    } catch { setCaps('error'); }
  }, []);
  // Poll fast only while something is expected to change (a pairing code waiting, an application in flight), never in a hidden tab:
  // four requests every five seconds used most of the API's 60-per-minute allowance and could lock other pages out.
  const waiting = code !== null;
  const inFlight = apps.some((a) => ACTIVE_STATES.has(a.state));
  const every = waiting ? 5_000 : inFlight ? 15_000 : 60_000;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, every);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [load, every]);
  // The pairing code is valid for ten minutes; after that the page says so instead of waiting forever.
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!codeExpiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [codeExpiresAt]);
  // A code is used once: when a new browser appears, it is gone (pairing a second browser later still works).
  const [devicesAtCode, setDevicesAtCode] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (code && devices.length > devicesAtCode) { setCode(null); setCodeExpiresAt(null); }
  }, [code, devices.length, devicesAtCode]);
  const codeLeft = codeExpiresAt ? Math.max(0, codeExpiresAt - now) : 0;
  const codeExpired = code !== null && codeExpiresAt !== null && codeLeft === 0;
  const [support, setSupport] = useState<BrowserSupport | null>(null);
  useEffect(() => {
    const touchOnly = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(any-pointer: fine)').matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupport(browserSupport(typeof navigator !== 'undefined' ? navigator.userAgent : '', touchOnly));
  }, []);
  // Whether the extension is installed in THIS browser (its bridge answers on this page), asked again whenever the tab comes back into view,
  // so installing it in another tab is noticed without a reload.
  const [presence, setPresence] = useState<ExtensionPresence | null | undefined>(undefined);
  const recheck = useCallback(async () => { setPresence(await detectExtension()); }, []);
  useEffect(() => {
    if (support?.kind === 'phone') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void recheck();
    const onVisible = () => { if (!document.hidden) void recheck(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [support?.kind, recheck]);

  async function act(key: string, path: string, method = 'POST', ok = '') {
    setBusy(key); setError(''); setNotice('');
    try {
      const res = await apiFetch(path, { method });
      if (!res.ok) setError(await errorOf(res)); else { setNotice(ok); await load(); }
    } catch { setError('Bağlantı xətası.'); }
    setBusy(''); setConfirm(null);
  }
  async function makeCode() {
    setBusy('code'); setError('');
    try {
      const res = await apiFetch('/agent/pairing', { method: 'POST' });
      if (res.ok) {
        const body = await res.json();
        setDevicesAtCode(devices.length);
        setCode(body.code);
        setCodeExpiresAt(Date.now() + (Number(body.expiresInSeconds) || 600) * 1000);
        setNow(Date.now());
      } else setError(await errorOf(res));
    } catch { setError('Bağlantı xətası.'); }
    setBusy('');
  }

  /** One click: a fresh code goes straight to the extension in this browser. On any failure the code stays on screen for typing by hand. */
  async function connectHere() {
    setBusy('connect'); setError(''); setNotice('');
    try {
      const res = await apiFetch('/agent/pairing', { method: 'POST' });
      if (!res.ok) { setError(await errorOf(res)); return; }
      const body = await res.json();
      const r = await pairViaExtension(body.code);
      if (r.ok) { setNotice('Bu brauzer qoşuldu.'); setCode(null); setCodeExpiresAt(null); await Promise.all([load(), recheck()]); return; }
      setError(pairErrorText(r.error));
      setDevicesAtCode(devices.length); setCode(body.code); setCodeExpiresAt(Date.now() + (Number(body.expiresInSeconds) || 600) * 1000); setNow(Date.now());
    } catch { setError('Bağlantı xətası.'); }
    finally { setBusy(''); }
  }
  async function download() {
    setBusy('download'); setError('');
    try { await downloadAuthedFile('/agent/extension', 'aise-agent-extension.zip'); }
    catch { setError('Fayl yüklənmədi. Premium planınızı və bağlantınızı yoxlayın.'); }
    finally { setBusy(''); }
  }

  if (caps === null) return <div className="p-6"><LoadingState label="Brauzer köməkçisi yüklənir…" /></div>;
  if (caps === 'error') return <div className="m-6"><ErrorState title="Brauzer köməkçisinin məlumatı yüklənmədi" onRetry={() => { setCaps(null); void load(); }}>E-poçt müraciətləri və müraciət cədvəli bundan asılı deyil; onlardan istifadə etməyə davam edə bilərsiniz.</ErrorState></div>;

  const needsAction = apps.filter((a) => a.nextActions.length > 0);
  const rest = apps.filter((a) => a.nextActions.length === 0);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard/applications" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent hover:underline">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Müraciətlərim və təsdiq gözləyənlər
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="flex items-center gap-2 font-serif text-2xl font-bold text-neutral-dark"><Bot aria-hidden="true" className="h-6 w-6" />Brauzer köməkçisi</h1>
        <p className="text-sm text-neutral-dark/70">Köməkçi sizin öz Chrome və ya Edge brauzerinizdə işləyir. Portal parolu, cookie və ya brauzer profili AISE-yə verilmir.</p>
      </header>

      <section aria-labelledby="ways-h" className={BOX} data-testid="application-ways">
        <h2 id="ways-h" className="font-semibold text-neutral-dark">Müraciətin 4 dəstəklənən yolu: hansı nə edir</h2>
        <ul className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <li className="rounded-xl border border-neutral-dark/10 p-3 flex flex-col justify-between">
            <div>
              <p className="font-semibold">1. E-poçtla müraciət</p>
              <p className="mt-1 text-neutral-dark/75">İşəgötürən müraciət üçün e-poçt ünvanı dərc edibsə. Təsdiqlədiyiniz CV və məktub sizin adınızdan göndərilir. Brauzer lazım deyil.</p>
            </div>
            <Link href="/dashboard/email-applications/settings" className="mt-2 inline-block text-accent underline">E-poçt müraciətləri</Link>
          </li>
          <li className="rounded-xl border border-neutral-dark/10 p-3">
            <p className="font-semibold">2. Formada kömək</p>
            <p className="mt-1 text-neutral-dark/75">Glorri və digər işəgötürən formalarında yalnız boş ad, soyad, e-poçt və telefon sahələrini, Glorri-nin məktub addımında isə bu vakansiya üçün AISE-də təsdiqlədiyiniz motivasiya məktubunu doldurur. CV-ni əlavə etmək, sualları cavablandırmaq və göndərmək sizdədir.</p>
          </li>
          <li className="rounded-xl border border-neutral-dark/10 p-3">
            <p className="font-semibold">3. Təsdiqlə göndəriş</p>
            <p className="mt-1 text-neutral-dark/75">Yalnız dəstəklənən portallarda (hazırda Lever). Hər müraciəti əvvəlcə siz təsdiqləyirsiniz; CAPTCHA və ya əlavə sual çıxsa, köməkçi dayanır və sizə deyir.</p>
          </li>
          <li className="rounded-xl border border-neutral-dark/10 p-3 flex flex-col justify-between">
            <div>
              <p className="font-semibold">4. Sərbəst xarici müraciət</p>
              <p className="mt-1 text-neutral-dark/75">Vakansiya kənar sistemdədirsə, AISE sənədləri hazırlayır və linki verir; müraciəti şirkətin öz saytında tam sərbəst şəkildə siz tamamlayırsınız.</p>
            </div>
            <Link href="/dashboard/applications/tracker" className="mt-2 inline-block text-accent underline">Müraciət cədvəli</Link>
          </li>
        </ul>
        <p className="text-xs text-neutral-dark/65">Telefonda müraciətləri hazırlayıb təsdiq edə bilərsiniz. 2 və 3 yalnız kompüterdəki Chrome və ya Edge brauzerində işləyir. AISE hazırlıq və ya forma doldurma mərhələsini heç vaxt avtomatik göndəriş kimi qələmə vermir; siz təsdiqləməyincə heç nə göndərilmir.</p>
      </section>

      <div aria-live="polite">
        {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </div>

      {!caps.enabled ? (
        <section className={BOX} aria-label="Əlçatmazlıq">
          <h2 className="font-semibold text-neutral-dark">Brauzer köməkçisi hələ aktiv deyil</h2>
          <p className="text-sm text-neutral-dark/75">Brauzer köməkçisi bu mühitdə hələ açılmayıb. Hazır olduqda bu səhifədə müraciət icazəsi yarada biləcəksiniz. Bu vaxta qədər müraciətlərinizi əvvəlki kimi göndərə bilərsiniz.</p>
        </section>
      ) : (
        <>
          {caps.pausedByOperator && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">AISE köməkçinin göndərişlərini müvəqqəti dayandırıb. Gözləyən işlər saxlanılır, heç nə göndərilmir.</p>}

          <SetupProgress
            included={!!caps.entitlement?.included}
            connected={devices.some((d) => deviceConnection(d.lastSeenAt).state === 'online')}
            paired={devices.length > 0}
            permission={campaigns.some((c) => c.status === 'ACTIVE')}
          />

          {caps.entitlement && !caps.entitlement.included && (
            <section className={BOX} aria-label="Plan">
              <h2 className="font-semibold text-neutral-dark">Brauzer köməkçisi Premium planına daxildir</h2>
              <p className="text-sm text-neutral-dark/75">
                Mövcud planınızda brauzer köməkçisi yoxdur. Premium plan qiyməti dəyişmir; köməkçi ayda ən çox {50} müraciət üçün istifadə olunur, hər müraciəti siz təsdiq edirsiniz
                və bu, sənəd və e-poçt limitlərindən ayrıdır. Əvvəlki müraciətləriniz və tarixçəniz saxlanılır.
              </p>
              <Link href="/pricing" className={PRIMARY}>Planlara bax</Link>
            </section>
          )}
          {caps.entitlement?.included && caps.entitlement.monthlyLimit !== null && (
            <p className="text-xs text-neutral-dark/70" data-testid="agent-usage">
              Bu ay: {caps.entitlement.usedThisMonth} / {caps.entitlement.monthlyLimit} müraciət istifadə olunub{caps.entitlement.remainingThisMonth === 0 ? '. Limit dolub; yeni ay başlayanda davam edəcək.' : '.'}
            </p>
          )}

          <section className={BOX} aria-labelledby="dev-h">
            <h2 id="dev-h" className="flex items-center gap-2 font-semibold text-neutral-dark"><MonitorSmartphone aria-hidden="true" className="h-5 w-5" />Brauzeriniz</h2>
            <SupportNote support={support} />
            {devices.length === 0 ? (
              <p className="text-sm text-neutral-dark/75">Hələ heç bir brauzer qoşulmayıb. Köməkçi yalnız qoşulmuş, açıq brauzerdə işləyir: brauzer bağlı və ya kompüter yuxu rejimində olanda heç nə doldurmur.</p>
            ) : (
              <ul className="divide-y divide-neutral-dark/10" data-testid="agent-devices">
                {devices.map((d) => {
                  const c = deviceConnection(d.lastSeenAt);
                  return (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">{d.name}</span>{' '}
                        <Badge tone={c.state === 'online' ? 'good' : c.state === 'never' ? 'neutral' : 'warn'}>{c.label}</Badge>{' '}
                        {d.update === 'required' && <Badge tone="bad">Yeniləmə lazımdır</Badge>}
                        {d.update === 'available' && <Badge tone="warn">Yeni versiya var</Badge>}
                        <span className="block text-xs text-neutral-dark/65">
                          {c.hint}{d.lastSeenAt ? ` Son əlaqə: ${formatDate(d.lastSeenAt)}.` : ''}{' '}
                          {d.extensionVersion ? `Versiya ${d.extensionVersion}.` : 'Versiya 0.3.3-dən köhnədir.'}
                          {d.update === 'required' && ' Bu versiya ilə köməkçi heç nə doldurmur və göndərmir.'}
                        </span>
                      </span>
                      <button className={SECONDARY} onClick={() => act(`dev-${d.id}`, `/agent/devices/${d.id}`, 'DELETE', 'Brauzer ayrıldı.')} disabled={!!busy} aria-label={`${d.name} brauzerini ayır`}>Ayır</button>
                    </li>
                  );
                })}
              </ul>
            )}
            {caps.entitlement?.included && devices.some((d) => d.update) && support?.kind !== 'phone' && (
              <div role="note" className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="agent-update">
                <p>
                  Yeni versiyanı quraşdırmaq üçün faylı yükləyin, köhnə <strong>aise-agent-extension</strong> qovluğunun içindəkiləri yeni fayldakılarla əvəz edin, sonra
                  <code className="mx-1 rounded bg-white/70 px-1">chrome://extensions</code> səhifəsində AISE Agent-in yenilə (↻) düyməsinə basın. Cütləmə saxlanılır.
                </p>
                <button className={SECONDARY} disabled={!!busy} onClick={download}>Yeni versiyanı yüklə (ZIP)</button>
              </div>
            )}

            {caps.entitlement?.included && support?.kind !== 'phone' && presence && !presence.paired && (
              <div className="space-y-2 rounded-xl border border-primary/40 bg-highlight/40 p-4 text-sm" data-testid="agent-detected">
                <p className="font-semibold">AISE Agent bu brauzerdə quraşdırılıb (versiya {presence.version}).</p>
                {caps.extension?.latestVersion && olderThan(presence.version, caps.extension.latestVersion) && (
                  <p className="text-neutral-dark/75">Yeni versiya ({caps.extension.latestVersion}) var; qoşulduqdan sonra yeniləyə bilərsiniz.</p>
                )}
                <button className={PRIMARY} onClick={connectHere} disabled={!!busy}>{busy === 'connect' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Bu brauzeri qoş</button>
                <p className="text-xs text-neutral-dark/65">Bir kliklə: AISE kod yaradır və onu bu brauzerdəki genişlənməyə ötürür. Heç nə yazmağa ehtiyac yoxdur.</p>
              </div>
            )}

            {devices.length === 0 && caps.entitlement?.included && presence === null && (support?.kind === 'supported' || support?.kind === 'old') && (
              <ol className="space-y-3 text-sm" aria-label="Brauzeri qoşmaq üçün addımlar">
                <li className="rounded-xl border border-neutral-dark/10 p-4">
                  <p className="font-semibold">1. Faylı yükləyin və açın</p>
                  <p className="mt-1"><button className={PRIMARY} disabled={!!busy} onClick={download}>AISE Agent faylını yüklə (ZIP)</button></p>
                  <p className="mt-2 text-neutral-dark/75">
                    Mac-də arxivə iki dəfə klikləyin; Windows-da sağ klik → “Hamısını çıxar”. <strong>aise-agent-extension</strong> adlı qovluq yaranacaq.
                    Qovluğu silinməyəcək bir yerə köçürün (məsələn, Sənədlər): Chrome genişlənməni həmin qovluqdan oxuyur.
                  </p>
                </li>
                <li className="rounded-xl border border-neutral-dark/10 p-4">
                  <p className="font-semibold">2. {support.kind === 'supported' ? support.name : 'Chrome'}-da quraşdırın</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-neutral-dark/80">
                    <li>
                      Yeni tabda bu ünvanı açın: <code className="rounded bg-neutral-dark/10 px-1">{support.kind === 'supported' && support.name === 'Microsoft Edge' ? 'edge://extensions' : 'chrome://extensions'}</code>{' '}
                      <button type="button" className="underline" onClick={() => { void navigator.clipboard?.writeText(support.kind === 'supported' && support.name === 'Microsoft Edge' ? 'edge://extensions' : 'chrome://extensions').then(() => setNotice('Ünvan kopyalandı. Yeni tabda yapışdırın.')).catch(() => setError('Kopyalanmadı: ünvanı əl ilə yazın.')); }}>
                        Ünvanı kopyala
                      </button>
                    </li>
                    <li><strong>Developer mode</strong> (Tərtibatçı rejimi) açarını yandırın.</li>
                    <li><strong>Load unpacked</strong> (Paketsiz yüklə) düyməsinə basın və <strong>aise-agent-extension</strong> qovluğunu seçin.</li>
                  </ol>
                </li>
                <li className="rounded-xl border border-neutral-dark/10 p-4">
                  <p className="font-semibold">3. Bu səhifəyə qayıdın</p>
                  <p className="mt-1 text-neutral-dark/75">Genişlənmə quraşdırılan kimi burada “Bu brauzeri qoş” düyməsi görünəcək. Görünməsə, səhifəni yeniləyin.</p>
                </li>
              </ol>
            )}

            {caps.entitlement?.included && support?.kind !== 'phone' && (
              <details className="text-sm" open={code !== null || undefined}>
                <summary className="cursor-pointer text-neutral-dark/75">Kodu əl ilə yazmaq (başqa brauzer və ya düymə işləmədikdə)</summary>
                <div className="mt-2 space-y-2">
                  <p className="text-neutral-dark/75">Kod yaradın, alət çubuğunda AISE Agent işarəsinə basın və kodu yazın. Kod 10 dəqiqə etibarlıdır və bir dəfə işləyir.</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button className={SECONDARY} onClick={makeCode} disabled={busy === 'code'}>{busy === 'code' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Cütləmə kodu yarat</button>
                    {code && !codeExpired && <p role="status" className="text-sm">Kod: <strong className="font-mono text-lg tracking-widest">{code}</strong> <span className="text-neutral-dark/60">({Math.floor(codeLeft / 60_000)}:{String(Math.floor((codeLeft % 60_000) / 1000)).padStart(2, '0')} qalıb, bir dəfə işləyir)</span></p>}
                  </div>
                  {codeExpired && <p role="status" className="text-sm text-amber-900">Kodun vaxtı bitdi. Yeni kod yaradın və genişlənmədə 10 dəqiqə ərzində yazın.</p>}
                  {code && !codeExpired && <p role="status" className="flex items-center gap-2 text-sm text-neutral-dark/75"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Qoşulma gözlənilir. Kodu genişlənmədə yazdıqdan sonra bu səhifə özü yenilənir.</p>}
                </div>
              </details>
            )}
            {devices.length > 0 && <p role="status" className="text-sm text-green-800">{presence?.paired ? 'Bu brauzer qoşulub.' : 'Brauzer qoşulub.'}{campaigns.some((c) => c.status === 'ACTIVE') ? '' : ' Növbəti addım: aşağıda müraciət icazəsi yaradın.'}</p>}
          </section>

          <section className={BOX} aria-labelledby="portal-h">
            <h2 id="portal-h" className="font-semibold text-neutral-dark">Dəstəklənən portallar</h2>
            {caps.portals.map((p) => (
              <div key={p.key} className="space-y-1 text-sm">
                <p className="font-medium">{p.name} <Badge tone="warn">Real göndəriş hələ təsdiqlənməyib</Badge></p>
                <ul className="list-disc space-y-0.5 pl-5 text-neutral-dark/75">{p.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
                <p className="text-neutral-dark/60">Avtonom rejim: {p.autonomousAvailable ? 'açıqdır' : 'bağlıdır (yalnız hər müraciəti sizin təsdiqinizlə)'}.</p>
              </div>
            ))}
            <p className="text-xs text-neutral-dark/60">Glorri və digər işəgötürən formaları: səhifəni açın, genişlənmədə “Məlumatlarımı bu formaya köçür” seçin. Yalnız ad, soyad, e-poçt və telefonun boş sahələri, Glorri-də isə təsdiqlədiyiniz motivasiya məktubu da doldurulur; CV-ni əlavə etmək, sualları cavablandırmaq və göndərmək sizə aiddir. Aşağıdakı müraciət icazəsi axını yalnız Lever üçündür.</p>
          </section>

          <section className={BOX} aria-labelledby="camp-h">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="camp-h" className="font-semibold text-neutral-dark">Müraciət icazələri</h2>
              <Link href="/dashboard/agent/campaigns/new" className={PRIMARY}><Plus aria-hidden="true" className="h-4 w-4" />Yeni müraciət icazəsi</Link>
            </div>
            {campaigns.length === 0 && <p className="text-sm text-neutral-dark/75">Hələ müraciət icazəsi yoxdur. Müraciət icazəsi sizin yazılı razılığınızdır: hansı portal, işəgötürən, vəzifə, CV və gündəlik limit.</p>}
            <ul className="space-y-3">
              {campaigns.map((c) => (
                <li key={c.id} className="rounded-xl border border-neutral-dark/10 p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{c.name}</p>
                    <div className="flex flex-wrap gap-2"><Badge tone={c.status === 'ACTIVE' ? 'good' : c.status === 'PAUSED' ? 'warn' : 'neutral'}>{CAMPAIGN_STATUS[c.status]}</Badge><Badge tone="neutral">{c.mode === 'ASSISTED' ? 'Hər müraciəti təsdiq edirəm' : 'Avtonom'}</Badge></div>
                  </div>
                  <p className="text-xs text-neutral-dark/70">İşəgötürənlər: {c.employerAllow.join(', ')}{c.employerDeny.length ? ` (istisna: ${c.employerDeny.join(', ')})` : ''} · Vəzifələr: {c.targetRoles.join(', ')} · Bu gün: {c.submissionsToday}/{c.dailyLimit} · Bitir: {formatDate(c.expiresAt)}</p>
                  <div className="flex flex-wrap gap-2">
                    {c.status === 'ACTIVE' && <button className={SECONDARY} disabled={!!busy} onClick={() => act(`p-${c.id}`, `/agent/campaigns/${c.id}/pause`, 'POST', 'Müraciət icazəsi dayandırıldı. Gözləyən işlər saxlanılır, heç nə göndərilmir.')}>Dayandır</button>}
                    {c.status === 'PAUSED' && <button className={SECONDARY} disabled={!!busy} onClick={() => act(`r-${c.id}`, `/agent/campaigns/${c.id}/resume`, 'POST', 'Müraciət icazəsi davam edir.')}>Davam et</button>}
                    {(c.status === 'ACTIVE' || c.status === 'PAUSED') && <button className={DANGER} disabled={!!busy} onClick={() => setConfirm({ kind: 'revoke', id: c.id })}>Razılığı geri götür</button>}
                  </div>
                </li>
              ))}
            </ul>
            {campaigns.some((c) => c.status === 'ACTIVE' || c.status === 'PAUSED') && (
              <button className={DANGER} onClick={() => setConfirm({ kind: 'stop-all' })} disabled={!!busy}><Ban aria-hidden="true" className="h-4 w-4" />Hamısını təcili dayandır</button>
            )}
          </section>

          {confirm && (
            <div role="alertdialog" aria-modal="true" aria-labelledby="cf-h" className="rounded-2xl border border-red-300 bg-red-50 p-5 space-y-3">
              <h2 id="cf-h" className="font-semibold text-red-900">{confirm.kind === 'revoke' ? 'Razılığı geri götürmək?' : 'Bütün müraciət icazələrini təcili dayandırmaq?'}</h2>
              <p className="text-sm text-red-900/90">Növbədə, hazırlanan və təsdiq gözləyən bütün müraciətlər dərhal ləğv olunacaq. Artıq göndərilmiş müraciətləri geri çağırmaq mümkün deyil.</p>
              <div className="flex flex-wrap gap-2">
                <button className={`${BTN} bg-red-700 text-white hover:bg-red-800`} disabled={!!busy} autoFocus onClick={() => confirm.kind === 'revoke' ? act('rv', `/agent/campaigns/${confirm.id}/revoke`, 'POST', 'Razılıq geri götürüldü; gözləyən müraciətlər ləğv edildi.') : act('sa', '/agent/stop-all', 'POST', 'Bütün müraciət icazələri dayandırıldı.')}>Bəli, dayandır</button>
                <button className={SECONDARY} onClick={() => setConfirm(null)}>Xeyr</button>
              </div>
            </div>
          )}

          <section className={BOX} aria-labelledby="app-h">
            <h2 id="app-h" className="font-semibold text-neutral-dark">Agentin müraciətləri</h2>
            {apps.length === 0 && <p className="text-sm text-neutral-dark/75">Hələ heç nə yoxdur. Müraciət icazəsi aktiv olduqda və brauzeriniz qoşulduqda uyğun vakansiyalar burada görünəcək.</p>}
            {[...needsAction, ...rest].map((a) => {
              const s = stateOf(a);
              return (
                <Link key={a.id} href={`/dashboard/agent/applications/${a.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-dark/10 p-3 hover:bg-neutral-dark/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  <span className="min-w-0"><span className="block font-semibold break-words">{a.title}</span><span className="block text-xs text-neutral-dark/65">{a.company}{a.stateReason && REASON[a.stateReason] ? ` · ${REASON[a.stateReason]}` : ''}</span></span>
                  <span className="flex items-center gap-2"><Badge tone={s.tone}>{s.label}</Badge><ArrowRight aria-hidden="true" className="h-4 w-4" /></span>
                </Link>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}

/** Where the candidate is in the setup, so the next step is obvious. Only facts the page already has: plan, paired browser, its last check-in, an active permission. */
function SetupProgress({ included, paired, connected, permission }: { included: boolean; paired: boolean; connected: boolean; permission: boolean }) {
  const steps = [
    { label: 'Premium plan', pending: 'Premium plan', done: included, todo: 'Köməkçi Premium planına daxildir.' },
    { label: 'Brauzer qoşulub', pending: 'Brauzeri qoşun', done: paired && connected, todo: paired ? 'Brauzer cütlənib, amma indi əlaqə yoxdur: kompüterdə Chrome-u açın.' : 'Genişlənməni kompüterdə quraşdırın və brauzeri qoşun.' },
    { label: 'Müraciət icazəsi var', pending: 'Müraciət icazəsi yaradın', done: permission, todo: 'Hansı portal, işəgötürən və vəzifələr üçün işləyəcəyini seçin.' },
  ];
  const next = steps.find((s) => !s.done);
  return (
    <section aria-labelledby="setup-h" className={BOX} data-testid="agent-setup-progress">
      <h2 id="setup-h" className="font-semibold text-neutral-dark">Hazırlıq</h2>
      <ol className="grid gap-2 text-sm sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.label} className={`flex items-center gap-2 rounded-xl border p-3 ${s.done ? 'border-green-200 bg-green-50 text-green-900' : s === next ? 'border-primary/40 bg-highlight/40' : 'border-neutral-dark/10 text-neutral-dark/70'}`}>
            <span aria-hidden="true" className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.done ? 'bg-green-700 text-white' : 'bg-neutral-dark/10'}`}>{s.done ? '✓' : i + 1}</span>
            <span>{s.done ? s.label : s.pending}<span className="sr-only">{s.done ? ': hazırdır' : ': hələ yox'}</span></span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-neutral-dark/75">{next ? `Növbəti addım: ${next.todo}` : 'Hər şey hazırdır. Uyğun vakansiya tapılanda hər müraciəti sizə təsdiq üçün göstəririk.'}</p>
    </section>
  );
}

/** What this device can do with the assistant, said before anything is downloaded. */
function SupportNote({ support }: { support: BrowserSupport | null }) {
  if (!support || support.kind === 'supported') return null;
  const text = support.kind === 'phone'
    ? 'Telefon və planşetdə genişlənmə quraşdırılmır. Burada müraciətləri nəzərdən keçirib təsdiqləyə, dayandıra və icazələri idarə edə bilərsiniz. Formada kömək və təsdiqlə göndəriş kompüterdə Chrome və ya Edge-də, brauzer açıq olanda işləyir.'
    : support.kind === 'old'
      ? `${support.name} ${support.version} köhnədir: genişlənmə 116 və daha yeni versiya tələb edir. Brauzeri yeniləyin.`
      : `${support.name} genişlənməni dəstəkləmir. Bu səhifəni kompüterdə Chrome və ya Microsoft Edge ilə açın (Windows, Mac və ya Linux).`;
  return <p role="note" data-testid="agent-support" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{text}</p>;
}
