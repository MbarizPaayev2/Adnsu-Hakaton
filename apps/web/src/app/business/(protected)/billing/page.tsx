'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Check, ExternalLink, ShieldCheck } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { callPlans, daysLeft, loadPlansOverview, newIdempotencyKey, type PlansOverview } from '@/lib/business-plans';
import { PlanSummary } from '@/components/business/plan-summary';
import { EmbeddedCheckout, type SessionResult } from '@/components/billing/embedded-checkout';

type Notice = { tone: 'ok' | 'error' | 'info'; text: string };

export default function BusinessBillingPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-neutral-dark/70" role="status">Tariflər yüklənir...</div>}>
      <BillingContent />
    </Suspense>
  );
}

function BillingContent() {
  const params = useSearchParams();
  const returned = params.get('checkout') === 'return' || params.get('checkout') === 'success';
  const [overview, setOverview] = useState<PlansOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<'portal' | null>(null);
  // The payment form opens inside this page for the chosen offer; closing it leaves everything unchanged.
  const [panel, setPanel] = useState<'single' | 'business' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // One key per purchase intent: a network retry of the SAME click returns the same purchase and never a second charge.
  const singleKey = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const o = await loadPlansOverview();
    if (o) { setOverview(o); setFailed(false); } else setFailed(true);
    setLoading(false);
    return o;
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // After the hosted checkout the grant arrives from the provider (a signed webhook), not from this redirect. Show that honestly and re-read a few times.
  useEffect(() => {
    if (!returned) return;
    setNotice({ tone: 'info', text: 'Ödəniş səhifəsindən qayıtdınız. Təsdiq ödəniş provayderindən gəlir; bir neçə saniyə çəkə bilər.' });
    let tries = 0;
    const id = setInterval(async () => {
      tries += 1;
      const o = await refresh();
      if (o && (o.business.active || o.credits.available > 0)) {
        setNotice({ tone: 'ok', text: o.business.active ? 'Biznes abunəliyi aktivdir.' : 'Ödəniş təsdiqləndi. Kredit hesabınıza əlavə olundu.' });
        clearInterval(id);
      } else if (tries >= 8) {
        setNotice({ tone: 'info', text: 'Ödəniş hələ təsdiqlənməyib. Ödənişi tamamlamısınızsa, bu səhifəni bir az sonra yeniləyin; təsdiq gələndə burada görünəcək. Heç nə təkrar tutulmur.' });
        clearInterval(id);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [returned, refresh]);

  // Sessions are created by the server from the approved offer; a retry of the same single-vacancy intent carries the same key.
  const createPanelSession = useCallback(async (): Promise<SessionResult> => {
    if (panel === 'single') {
      if (!singleKey.current) singleKey.current = newIdempotencyKey();
      const r = await callPlans<{ url: string | null; alreadyPaid?: boolean; pending?: boolean }>('/checkout/single', { method: 'POST', body: { idempotencyKey: singleKey.current } });
      if (r.ok && r.data?.url) return { url: r.data.url };
      singleKey.current = null;
      if (r.ok && r.data?.alreadyPaid) {
        setNotice({ tone: 'ok', text: 'Bu ödəniş artıq qəbul edilib.' });
        setPanel(null);
        void refresh();
        return { url: null, message: 'Bu ödəniş artıq qəbul edilib.' };
      }
      if (r.ok) return { url: null, message: 'Əvvəlki ödəniş səhifəsi hələ açıqdır. “Yenidən cəhd et” düyməsi yeni forma açacaq.' };
      return { url: null, message: r.message ?? 'Ödəniş forması açılmadı. Heç bir ödəniş tutulmayıb.' };
    }
    const r = await callPlans<{ url: string }>('/checkout/business', { method: 'POST' });
    if (r.ok && r.data?.url) return { url: r.data.url };
    return { url: null, message: r.message ?? 'Ödəniş forması açılmadı. Heç bir ödəniş tutulmayıb.' };
  }, [panel, refresh]);

  // The provider's "paid" event proves nothing: the page reloads into the verified-return state, which re-reads the plan the API holds.
  const handlePaid = useCallback(() => {
    window.location.assign('/business/billing?checkout=return');
  }, []);

  const openPanel = (kind: 'single' | 'business') => {
    if (busy || panel) return;
    setNotice(null);
    setPanel(kind);
  };

  const portal = async () => {
    if (busy) return;
    setBusy('portal');
    setNotice(null);
    const r = await callPlans<{ url: string }>('/portal', { method: 'POST' });
    if (r.ok && r.data?.url) { window.location.assign(r.data.url); return; }
    setNotice({ tone: 'error', text: r.message ?? 'Abunəlik səhifəsi açılmadı.' });
    setBusy(null);
  };

  if (loading) return <div className="py-12 text-center text-sm text-neutral-dark/70" role="status">Tariflər yüklənir...</div>;

  if (failed || !overview) {
    return (
      <div className="product-card rounded-2xl bg-background border border-red-200 p-8 text-center shadow-xs max-w-xl mx-auto my-12">
        <AlertTriangle className="mx-auto h-12 w-12 text-red-600 mb-3" aria-hidden="true" />
        <h1 className="font-serif text-2xl font-bold text-neutral-dark mb-2">Tarif məlumatı yüklənmədi</h1>
        <p className="text-sm text-neutral-dark/70 mb-6">Bir az sonra yenidən cəhd edin. Heç bir ödəniş tutulmayıb.</p>
        <button onClick={() => { setLoading(true); void refresh(); }} className="tap inline-flex items-center gap-2 rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white">Yenidən cəhd et</button>
      </div>
    );
  }

  if (!overview.gated) {
    return (
      <div className="space-y-4 pb-12 max-w-2xl">
        <h1 className="font-serif text-3xl font-bold text-neutral-dark">Tariflər</h1>
        <p className="text-sm text-neutral-dark/75">
          Vakansiya planları bu mühitdə hələ aktiv deyil. Vakansiyalarınız əvvəlki qaydada yayımlanır və ödəniş tələb olunmur.
        </p>
      </div>
    );
  }

  const p = overview.prices;
  const canBuy = overview.checkoutAvailable;
  const trialLeft = overview.trial.endsAt ? daysLeft(overview.trial.endsAt) : null;
  const notBuyable = 'Ödəniş hazırda aktiv deyil. Təklif hazır olduqda bu düymə açılacaq.';

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-500">
      <header>
        <h1 className="font-serif text-3xl font-bold text-neutral-dark">Tariflər və ödəniş</h1>
        <p className="mt-1 text-sm text-neutral-dark/70 max-w-2xl">
          Planlar şirkətinizə aiddir. Namizədlərin Plus və Premium planlarından ayrıdır və uyğunluq ballarına təsir etmir.
        </p>
      </header>

      <div aria-live="polite" role="status">
        {notice && (
          <p className={`rounded-xl border p-4 text-sm font-medium ${notice.tone === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : notice.tone === 'error' ? 'bg-red-50 border-red-200 text-red-900' : 'bg-sky-50 border-sky-200 text-sky-900'}`}>
            {notice.text}
          </p>
        )}
      </div>

      <PlanSummary overview={overview} compact />

      {panel && (
        <section aria-labelledby="checkout-panel" className="product-card rounded-2xl border border-primary bg-background p-5 sm:p-6 shadow-md space-y-4">
          <div>
            <h2 id="checkout-panel" className="font-serif text-xl font-bold text-neutral-dark">
              {panel === 'single' ? `Tək vakansiya — ${p.singleAzn} AZN, bir dəfəlik` : `Biznes planı — ${p.businessAznPerMonth} AZN / ay`}
            </h2>
            <p className="mt-1 text-xs text-neutral-dark/75">
              {panel === 'single'
                ? `Bir vakansiya üçün ${p.singleDays} gün. Avtomatik yenilənmir və abunəlik yaratmır.`
                : `Hər ay ${p.businessAznPerMonth} AZN ilə avtomatik yenilənir. İstədiyiniz vaxt ləğv edə bilərsiniz; ödənilmiş dövrün sonuna qədər aktiv qalır.`}
              {' '}
              <a href="/refund#isegoturen" className="underline underline-offset-2">Geri ödəniş qaydası</a>
            </p>
          </div>
          <EmbeddedCheckout key={panel} createSession={createPanelSession} onPaid={handlePaid} onCancel={() => setPanel(null)} cancelLabel="Ödənişi bağla" />
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Sınaq */}
        <article className="product-card flex flex-col justify-between rounded-3xl border border-neutral-dark/10 bg-background p-6 shadow-xs" aria-labelledby="plan-trial">
          <div className="space-y-3">
            <h2 id="plan-trial" className="font-serif text-xl font-bold text-neutral-dark">Sınaq</h2>
            <p className="text-3xl font-extrabold text-neutral-dark">Ödənişsiz</p>
            <p className="text-sm text-neutral-dark/75">İlk vakansiyanız üçün {p.trialDays} gün. Kart tələb olunmur.</p>
            <ul className="space-y-2 border-t border-neutral-dark/10 pt-4 text-sm text-neutral-dark/80">
              <Bullet>Müddət vakansiya <strong>faktiki yayımlandığı</strong> gündən hesablanır</Bullet>
              <Bullet>Hər təsdiqlənmiş şirkət üçün bir dəfə</Bullet>
              <Bullet>Bitəndə yeni müraciətlər dayanır; şirkət profili və gələn müraciətlər əlçatan qalır</Bullet>
              <Bullet>Loqo, müraciət qutusu və namizəd mərhələlərinin idarəsi daxildir</Bullet>
            </ul>
          </div>
          <p className="mt-5 rounded-xl bg-background-warm/40 p-3 text-xs text-neutral-dark/80" data-testid="trial-state">
            {overview.trial.available
              ? 'Hələ istifadə olunmayıb. İlk vakansiyanı yayımladığınız an başlayır.'
              : overview.trial.endsAt && new Date(overview.trial.endsAt) > new Date()
                ? `Davam edir: ${formatDate(overview.trial.endsAt)} tarixinədək${trialLeft !== null ? ` (${trialLeft} gün)` : ''}.`
                : overview.trial.used ? 'Bu şirkət üçün istifadə olunub.' : 'Bu şirkət adı və ya saytı ilə sınaq artıq istifadə edilib.'}
          </p>
        </article>

        {/* Tək vakansiya */}
        <article className="product-card flex flex-col justify-between rounded-3xl border border-neutral-dark/10 bg-background p-6 shadow-xs" aria-labelledby="plan-single">
          <div className="space-y-3">
            <h2 id="plan-single" className="font-serif text-xl font-bold text-neutral-dark">Tək vakansiya</h2>
            <p className="text-3xl font-extrabold text-neutral-dark">{p.singleAzn} AZN <span className="text-sm font-medium text-neutral-dark/60">bir dəfəlik</span></p>
            <p className="text-sm text-neutral-dark/75">Bir vakansiya, yayımlandığı gündən {p.singleDays} gün.</p>
            <ul className="space-y-2 border-t border-neutral-dark/10 pt-4 text-sm text-neutral-dark/80">
              <Bullet>Avtomatik yenilənmir və abunəlik yaratmır</Bullet>
              <Bullet>Daha {p.singleDays} gün üçün yenidən açıq şəkildə ödəyirsiniz</Bullet>
              <Bullet>Loqo, müraciət qutusu və namizəd mərhələlərinin idarəsi daxildir</Bullet>
              <Bullet>Ödəniş vakansiya yoxlamadan keçməmişdən əvvəl də edilə bilər; kredit yalnız yayımlananda işlənir</Bullet>
            </ul>
          </div>
          <div className="mt-5 space-y-2">
            <button
              type="button"
              onClick={() => openPanel('single')}
              disabled={!canBuy || busy !== null || panel !== null}
              aria-describedby={!canBuy ? 'single-unavailable' : undefined}
              className="tap w-full min-h-11 rounded-xl bg-primary text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {`${p.singleAzn} AZN ödə`}
            </button>
            {!canBuy && <p id="single-unavailable" className="text-xs text-neutral-dark/65">{notBuyable}</p>}
            {overview.credits.available > 0 && <p className="text-xs font-medium text-emerald-800">{overview.credits.available} işlənməmiş krediti var.</p>}
          </div>
        </article>

        {/* Biznes */}
        <article className="product-card flex flex-col justify-between rounded-3xl border border-primary bg-background p-6 shadow-md" aria-labelledby="plan-business">
          <div className="space-y-3">
            <h2 id="plan-business" className="font-serif text-xl font-bold text-neutral-dark">Biznes</h2>
            <p className="text-3xl font-extrabold text-neutral-dark">{p.businessAznPerMonth} AZN <span className="text-sm font-medium text-neutral-dark/60">/ ay</span></p>
            <p className="text-sm text-neutral-dark/75">Bir təsdiqlənmiş şirkət üçün qaydalara uyğun vakansiyaların sayı məhdud deyil.</p>
            <ul className="space-y-2 border-t border-neutral-dark/10 pt-4 text-sm text-neutral-dark/80">
              <Bullet>Gizli say limiti yoxdur; spam, təkrar və agentlik ilə yenidən satış qaydaları tətbiq olunur</Bullet>
              <Bullet>Hər elan ən çox 60 gündən bir təsdiqlənməlidir (“hələ də aktualdır”)</Bullet>
              <Bullet>Abunəlik bitəndə və ya yenilənmə ödənişi alınmayanda (3 gün möhlətdən sonra) elanlar dayanır; müraciətlər və məlumatlar saxlanılır</Bullet>
              <Bullet>İstədiyiniz vaxt ləğv edə bilərsiniz; ödənilmiş dövrün sonuna qədər aktiv qalır</Bullet>
              <Bullet>Loqo, müraciət qutusu və namizəd mərhələlərinin idarəsi daxildir</Bullet>
            </ul>
          </div>
          <div className="mt-5 space-y-2">
            {overview.business.active ? (
              <>
                <p className="text-xs text-neutral-dark/80" data-testid="business-state">
                  {overview.business.cancelAtPeriodEnd
                    ? `Ləğv edilib. ${overview.business.currentPeriodEnd ? formatDate(overview.business.currentPeriodEnd) : 'Cari dövrün sonu'} tarixinədək aktivdir.`
                    : `Aktivdir${overview.business.currentPeriodEnd ? `, növbəti ödəniş ${formatDate(overview.business.currentPeriodEnd)}` : ''}.`}
                </p>
                <button type="button" onClick={portal} disabled={busy !== null} className="tap inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border border-neutral-dark/20 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 disabled:opacity-60">
                  Abunəliyi idarə et <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => openPanel('business')}
                  disabled={!canBuy || busy !== null || panel !== null}
                  aria-describedby={!canBuy ? 'business-unavailable' : undefined}
                  className="tap w-full min-h-11 rounded-xl bg-primary text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {`Biznes planına keç — ${p.businessAznPerMonth} AZN / ay`}
                </button>
                {!canBuy && <p id="business-unavailable" className="text-xs text-neutral-dark/65">{notBuyable}</p>}
                {overview.business.status && <p className="text-xs text-neutral-dark/70">Əvvəlki abunəlik aktiv deyil. Yenidən abunə olduqda dayandırılmış elanlar öz son tarixləri çərçivəsində bərpa olunur.</p>}
              </>
            )}
          </div>
        </article>
      </div>

      <section aria-labelledby="plan-rules" className="product-card rounded-2xl border border-neutral-dark/10 bg-background p-6 shadow-xs">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 id="plan-rules" className="font-serif text-xl font-bold text-neutral-dark">Qaydalar</h2>
        </div>
        <ul className="mt-4 space-y-3 text-sm text-neutral-dark/80">
          <Bullet>Hər yeni vakansiya əvvəlcə AISE tərəfindən qaydalara uyğunluq üçün yoxlanılır. Yoxlama mərhələsində sınaq və ya kredit işlənmir.</Bullet>
          <Bullet>Qaydalara zidd, təkrarlanan (eyni elanın bir neçə nüsxəsi), saxta, ödəniş tələb edən və ya başqa şirkət adına agentlik kimi yenidən satılan elanlar qəbul edilmir və dayandırıla bilər.</Bullet>
          <Bullet>Biznes planı bir şirkət üçündür; onu başqa şirkətlərin elanlarını yerləşdirmək üçün istifadə etmək olmaz.</Bullet>
          <Bullet>Elanın son tarixi yayım müddətindən əvvəl çatarsa, elan həmin gün bağlanır.</Bullet>
          <Bullet>Müddət bitəndə yeni müraciətlər dayanır. Şirkət profiliniz, artıq daxil olan müraciətlər və namizəd cavabları həmişə sizin üçün əlçatan qalır.</Bullet>
          <Bullet>Ödəniş uğursuz olarsa heç nə aktivləşmir. Eyni ödəniş təkrar göndərilsə belə bir dəfə hesablanır.</Bullet>
          <Bullet>
            Ətraflı: <a href="/employer-terms" className="underline">İşəgötürən şərtləri</a> və <a href="/refund#isegoturen" className="underline">geri ödəniş qaydası</a>.
          </Bullet>
        </ul>
      </section>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}
