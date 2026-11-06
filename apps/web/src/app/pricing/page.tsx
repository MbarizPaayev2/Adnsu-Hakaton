'use client';

import { PLAN_WEEKLY_MATCH_QUOTAS, PLAN_MATCH_QUOTAS, PLAN_DAILY_MATCH_QUOTAS } from '@aise/shared-types';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Check, ArrowRight, ShieldCheck, HelpCircle, Building2, User } from 'lucide-react';
import { BrandWordmark } from '@/components/landing/brand-logo';
import { usePaymentsEnabled, usePublicFeatures } from '@/lib/billing';
import { loadRetentionApi } from '@/lib/retention/api';
import type { CommercialCatalogue, PlanView } from '@/lib/retention/contract';
import { PlanComparison } from '@/components/pricing/plan-comparison';

export default function PricingPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const paymentsEnabled = usePaymentsEnabled();
  const paidUnavailable = paymentsEnabled === false;
  const features = usePublicFeatures();
  // Not promised unless the server says it is on (null while loading counts as not on).
  const docsOff = features.documents !== true;
  const [targetAudience, setTargetAudience] = useState<'candidate' | 'employer'>('candidate');
  // The server's catalogue is the only source of prices, limits and what is purchasable. null = not loaded / failed: nothing is guessed.
  const [catalogue, setCatalogue] = useState<CommercialCatalogue | null>(null);
  const [catalogueFailed, setCatalogueFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadRetentionApi().then((api) => api.getCatalogue()).then((c) => { if (alive) setCatalogue(c); }).catch(() => { if (alive) setCatalogueFailed(true); });
    return () => { alive = false; };
  }, []);
  const free = catalogue?.candidate.free ?? null;
  // The e-mail application allowance is the server's number (separate from documents); nothing is shown until it was stated.
  const emailLine = (p: { allowances: { label: string; value: string | null }[] } | null) => {
    const v = p?.allowances.find((a) => a.label === 'E-poçtla müraciət')?.value;
    const n = v ? Number.parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  // The document allowance as the server states it; nothing is shown until it was loaded.
  const docLimit = (p: PlanView | null) => p?.grants?.['documents.generations']?.limit;
  const plus = catalogue?.candidate.plus ?? null;
  const plusBuyable = !!plus?.purchasable && paymentsEnabled === true;
  const premium = catalogue?.candidate.premium ?? null;
  const premiumBuyable = !!premium?.purchasable && paymentsEnabled === true;
  // Employer prices and availability come from the server's catalogue only; nothing is shown that it did not state.
  const employerOffer = (id: 'single' | 'recurring') => catalogue?.employer.find((e) => e.id === id) ?? null;
  const employerPrice = (id: 'single' | 'recurring') => employerOffer(id)?.priceAzn ?? null;
  const employerAvailable = (id: 'single' | 'recurring') => !!employerOffer(id)?.available && paymentsEnabled === true;

  const handleFreeChoose = () => {
    if (!session) {
      router.push('/register?plan=free');
      return;
    }
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans selection:bg-highlight selection:text-primary">
      {/* Header */}
      <header className="px-6 lg:px-16 h-20 flex items-center justify-between border-b border-outline-variant bg-surface">
        <Link href="/" className="tap flex items-center gap-2">
          <BrandWordmark className="text-3xl" />
        </Link>
        <div className="flex items-center gap-4 text-sm font-semibold">
          {session ? (
            <Link href="/dashboard" className="tap-inline text-on-background hover:text-accent transition-colors">
              İstifadəçi paneli
            </Link>
          ) : (
            <>
              <Link href="/login" className="tap-inline text-on-background hover:text-accent transition-colors">
                Daxil ol
              </Link>
              <Link
                href="/register"
                className="product-action rounded-full bg-primary text-white px-5 py-2 hover:bg-primary-hover transition-colors"
              >
                Qeydiyyat
              </Link>
            </>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 py-16 px-6 lg:px-16 max-w-6xl mx-auto space-y-12 w-full animate-in fade-in duration-500">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-on-background">
            Daha az təkrar iş, daha çox vaxt
          </h1>
          <p className="text-sm md:text-base text-on-surface-variant">
            Profilini bir dəfə qur: AISE uyğun vakansiyaları seçsin, müraciətini hazırlasın və icazənlə göndərsin. Hər planda eyni sətirlər, serverdə tətbiq olunan limitlər.
          </p>
        </div>

        {/* Audience Toggle */}
        <div className="flex justify-center">
          <div className="inline-flex rounded-full border border-outline-variant bg-surface-container p-1 shadow-xs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={targetAudience === 'candidate'}
              onClick={() => setTargetAudience('candidate')}
              className={`tap flex items-center gap-2 rounded-full px-6 py-2.5 text-xs sm:text-sm font-bold transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden ${
                targetAudience === 'candidate'
                  ? 'bg-primary text-white shadow-xs'
                  : 'text-on-surface-variant hover:text-on-background'
              }`}
            >
              <User className="h-4 w-4" aria-hidden="true" />
              <span>Namizədlər üçün</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={targetAudience === 'employer'}
              onClick={() => setTargetAudience('employer')}
              className={`tap flex items-center gap-2 rounded-full px-6 py-2.5 text-xs sm:text-sm font-bold transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden ${
                targetAudience === 'employer'
                  ? 'bg-primary text-white shadow-xs'
                  : 'text-on-surface-variant hover:text-on-background'
              }`}
            >
              <Building2 className="h-4 w-4" aria-hidden="true" />
              <span>İşəgötürənlər üçün</span>
            </button>
          </div>
        </div>

        {paidUnavailable && (
          <p role="status" className="mx-auto max-w-2xl rounded-2xl bg-amber-50 border border-amber-200 p-4 text-xs sm:text-sm text-amber-900 text-center leading-relaxed">
            Ödənişli planlar hələ aktiv deyil. Hazırda ödənişsiz planla başlaya bilərsiniz; ödənişlər açılanda burada görünəcək.
          </p>
        )}

        {/* CANDIDATE PLANS: Free, Plus, Premium */}
        {targetAudience === 'candidate' && (
          <div className="space-y-12">
            {docsOff && features.documents === false && (
              <p role="status" className="max-w-6xl mx-auto rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-neutral-dark" data-testid="documents-unavailable-notice">
                Sənəd hazırlama (rezüme, CV, motivasiya məktubu) hazırda əlçatan deyil və yoxlamalar tamamlandıqdan sonra açılacaq. Aşağıdakı sənəd limitləri açılış zamanı tətbiq olunacaq; mövcud sənədləri yükləmək, redaktə etmək və ixrac etmək həmişə mümkündür.
              </p>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
              {/* 1. Free Plan */}
              <div className="rounded-3xl bg-surface border border-outline-variant p-7 flex flex-col justify-between space-y-6 shadow-xs">
                <div className="space-y-4">
                  <div className="inline-flex rounded-full bg-surface-container px-3 py-1 text-xs font-bold text-on-surface-variant">
                    Başlanğıc
                  </div>
                  <div>
                    <h2 className="font-serif text-2xl font-bold text-on-background">Ödənişsiz</h2>
                    <p className="text-xs text-on-surface-variant mt-1">
                      Vakansiya axtarışı, saxlanan elanlar və müraciət cədvəli üçün
                    </p>
                  </div>

                  <div className="flex items-baseline pt-2">
                    <span className="font-serif text-4xl font-extrabold text-on-background">0₼</span>
                    <span className="text-xs text-on-surface-variant ml-1.5">/həmişə ödənişsiz</span>
                  </div>

                  <ul className="space-y-3 pt-6 border-t border-outline-variant/60 text-xs text-on-background">
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>Bütün açıq vakansiyalara limitsiz sərbəst baxış və axtarış</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>200 elan və 3 axtarış filtrini yadda saxlama</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span><strong>Harvard CV şablonu əsasında</strong> aydın, peşəkar və oxunaqlı sənəd quruluşu</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{features.documents === null ? 'Sənəd imkanları yoxlanılır…' : features.documents === false ? 'Sənəd generasiyası hazırda əlçatan deyil' : typeof docLimit(free) === 'number' ? `Ayda ${docLimit(free)} sənəd generasiyası (Rezüme, CV və ya motivasiya məktubu)` : 'Aylıq limitlə sənəd generasiyası (Rezüme, CV və ya motivasiya məktubu)'}</span>
                    </li>
                    {emailLine(free) !== null && (
                      <li className="flex items-start gap-2.5">
                        <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                        <span><strong>Ayda {emailLine(free)} e-poçt müraciəti</strong> AISE vasitəsilə (sənəd limitindən ayrıdır; göndərilməyən müraciət limiti azaltmır)</span>
                      </li>
                    )}
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>Hər elan üçün dəqiq rəsmi müraciət üsulunun göstərilməsi</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>Həftədə {PLAN_WEEKLY_MATCH_QUOTAS.FREE} yeni fərdi iş tövsiyəsinə qədər</span>
                    </li>
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={handleFreeChoose}
                  className="w-full min-h-11 flex justify-center items-center rounded-xl bg-background border border-outline-variant text-xs font-semibold text-on-background hover:bg-surface-container transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                >
                  Başla
                </button>
              </div>

              {/* 2. Plus Plan */}
              <div className="rounded-3xl bg-surface border border-outline-variant p-7 flex flex-col justify-between space-y-6 shadow-xs">
                <div className="space-y-4">
                  <div className="inline-flex rounded-full bg-surface-container px-3 py-1 text-xs font-bold text-primary">
                    Genişləndirilmiş
                  </div>
                  <div>
                    <h2 className="font-serif text-2xl font-bold text-on-background">{plus?.name ?? 'Plus'}</h2>
                    <p className="text-xs text-on-surface-variant mt-1">
                      Aktiv iş axtarışı və müntəzəm müraciətlər üçün genişləndirilmiş imkanlar
                    </p>
                  </div>

                  <div className="flex items-baseline pt-2">
                    <span className="font-serif text-4xl font-extrabold text-on-background">
                      {plus?.priceAzn != null ? `${plus.priceAzn}₼` : catalogueFailed ? '—' : 'Yüklənir…'}
                    </span>
                    {plus?.priceAzn != null && <span className="text-xs text-on-surface-variant ml-1.5">/ay</span>}
                  </div>

                  {catalogueFailed && (
                    <p role="alert" className="text-xs text-red-800">Plan məlumatı yüklənmədi. Bir az sonra yenidən cəhd edin; heç bir qiymət təxmin edilmir.</p>
                  )}

                  <ul className="space-y-3 pt-6 border-t border-outline-variant/60 text-xs text-on-background">
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span><strong>{typeof docLimit(plus) === 'number' ? `Ayda ${docLimit(plus)} sənəd generasiyası` : 'Aylıq limitlə sənəd generasiyası'}</strong> (Rezüme, CV və ya motivasiya məktubu)</span>
                    </li>
                    {emailLine(plus) !== null && (
                      <li className="flex items-start gap-2.5">
                        <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                        <span><strong>Ayda {emailLine(plus)} e-poçt müraciəti</strong> AISE vasitəsilə (sənəd limitindən ayrıdır; göndərilməyən müraciət limiti azaltmır)</span>
                      </li>
                    )}
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>5 əlavə CV və rezüme versiyası</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>20 saxlanan axtarış və gündəlik 10 ani bildiriş</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>Gündə {PLAN_DAILY_MATCH_QUOTAS.PLUS} yeni fərdi iş tövsiyəsinə qədər</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>Harvard şablonunda təcrübə və bacarıq uyğunlaşdırması</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>Faktlara əsaslanan fərdi motivasiya məktubu</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>Hər dəyişikliyin sizin tərəfinizdən yoxlanması və təsdiqi</span>
                    </li>
                  </ul>
                </div>

                {/* Native document links apply checkout's route-specific CSP on the first visit. */}
                {plusBuyable ? (
                  <a href={session ? '/checkout?plan=plus' : '/register?plan=plus'}
                    className="w-full min-h-11 flex justify-center items-center product-action rounded-xl bg-primary text-xs font-bold text-white hover:bg-primary-hover transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden">
                    Plus plana keç
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                  className="w-full min-h-11 flex justify-center items-center product-action rounded-xl bg-primary text-xs font-bold text-white hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                >
                  {paymentsEnabled === null || (!catalogue && !catalogueFailed) ? 'Yüklənir…' : 'Hazırda əlçatan deyil'}
                </button>
                )}
              </div>

              {/* 3. Premium Plan */}
              <div className="rounded-3xl bg-surface border-2 border-primary p-7 flex flex-col justify-between space-y-6 shadow-md relative">
                <span className="absolute top-0 right-8 -translate-y-1/2 rounded-full bg-primary px-3.5 py-1 text-[11px] font-bold text-white tracking-wide uppercase">
                  Tövsiyə olunan
                </span>

                <div className="space-y-4">
                  <div className="inline-flex rounded-full bg-highlight px-3 py-1 text-xs font-bold text-primary">
                    Maksimum dəstək
                  </div>
                  <div>
                    <h2 className="font-serif text-2xl font-bold text-on-background">{premium?.name ?? 'Premium'}</h2>
                    <p className="text-xs text-on-surface-variant mt-1">
                      {catalogue?.positioning?.premiumComparison ?? 'Təkrarlanan müraciət işini sizin yerinizə görən agent: müraciəti hazırlayır, siz təsdiqləyəndə göndərir. Müsahibə və ya işə qəbul vəd edilmir.'}
                    </p>
                  </div>

                  <div className="flex items-baseline pt-2">
                    <span className="font-serif text-4xl font-extrabold text-on-background">
                      {premium?.priceAzn != null ? `${premium.priceAzn}₼` : catalogueFailed ? '—' : 'Yüklənir…'}
                    </span>
                    {premium?.priceAzn != null && <span className="text-xs text-on-surface-variant ml-1.5">/ay</span>}
                  </div>

                  {catalogueFailed && (
                    <p role="alert" className="text-xs text-red-800">Plan məlumatı yüklənmədi. Bir az sonra yenidən cəhd edin; heç bir qiymət təxmin edilmir.</p>
                  )}
                  <ul className="space-y-3 pt-6 border-t border-outline-variant/60 text-xs text-on-background">
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span><strong>Sənəd üçün aylıq limit yoxdur</strong> (eyni anda ən çox 3, saatda ən çox 30 yeni sənəd)</span>
                    </li>
                    {emailLine(premium) !== null && (
                      <li className="flex items-start gap-2.5">
                        <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                        <span><strong>Ayda {emailLine(premium)} e-poçt müraciəti</strong> AISE vasitəsilə (sənəd limitindən ayrıdır; göndərilməyən müraciət limiti azaltmır)</span>
                      </li>
                    )}
                    {features.emailAutomation === true ? (
                      <li className="flex items-start gap-2.5">
                        <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                        <span><strong>Avtomatik e-poçt müraciətləri:</strong> sizin CV, məktub və qaydalarınızla, yalnız açıq razılığınızdan sonra. Ayın e-poçt limitinə daxildir; cavablar şəxsi e-poçtunuza gəlir.</span>
                      </li>
                    ) : (
                      <li className="flex items-start gap-2.5 text-on-surface-variant" data-testid="automation-planned">
                        <span aria-hidden="true" className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full border border-dashed border-outline" />
                        <span><strong>Qaydalarla avtomatik göndəriş:</strong> hələ açıq deyil. O vaxta qədər AISE müraciəti hazırlayır, hər birini siz təsdiqləyirsiniz.</span>
                      </li>
                    )}
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span><strong>Brauzer köməkçisi:</strong> işəgötürən formalarında ad və əlaqə məlumatlarınızı doldurur; dəstəklənən portalda (hazırda Lever) ayda {premium?.grants?.['browser.applications']?.limit ?? 50} müraciətə qədər, hər birini siz təsdiqləyirsiniz. Kompüterdə Chrome/Edge; sənəd və e-poçt limitlərindən ayrıdır.</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{premium?.grants?.['cv.versions']?.limit ?? 5} CV versiyası və genişləndirilmiş tənzimləmələr</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>20 saxlanan axtarış və gündəlik 10 ani bildiriş</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>Gündə {PLAN_DAILY_MATCH_QUOTAS.PREMIUM} yeni fərdi iş tövsiyəsinə qədər</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>Mövcud sənədlərin yüklənməsi, redaktəsi və ixracı həmişə ödənişsiz</span>
                    </li>
                  </ul>
                  {catalogue?.positioning?.finePrint && <p className="text-[11px] text-on-surface-variant">{catalogue.positioning.finePrint}</p>}
                </div>

                {premiumBuyable ? (
                  <a href={session ? '/checkout?plan=premium' : '/register?plan=premium'}
                    className="w-full min-h-11 flex justify-center items-center product-action rounded-xl bg-primary text-xs font-bold text-white hover:bg-primary-hover transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden">
                    Premium plana keç
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                  className="w-full min-h-11 flex justify-center items-center product-action rounded-xl bg-primary text-xs font-bold text-white hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                >
                  {paymentsEnabled === null || (!catalogue && !catalogueFailed) ? 'Yüklənir…' : 'Hazırda əlçatan deyil'}
                </button>
                )}
              </div>
            </div>

            <PlanComparison automationOn={features.emailAutomation} plans={[{ key: 'FREE', view: free }, { key: 'PLUS', view: plus }, { key: 'PREMIUM', view: premium }]} />

            {/* Factual Disclaimer Card */}
            <div className="max-w-4xl mx-auto rounded-2xl bg-surface-container-low border border-outline-variant p-6 text-xs text-on-surface-variant space-y-3">
              <h3 className="font-bold text-sm text-on-background flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                Dürüstlük və zəmanət siyasətimiz
              </h3>
              <p className="leading-relaxed">
                AISE namizədlərə qondarma zəmanətlər (məsələn: &ldquo;100% iş təminatı&rdquo; və ya &ldquo;mütləq ATS keçidi&rdquo;) vermir. Platformanın məqsədi müraciət sənədlərinizi Harvard CV şablonu əsasında aydın quruluşda hazırlamaq və vakansiyanın tələblərinə yalnız sizin faktlarınız əsasında uyğunlaşdırmaqdır; hər dəyişikliyi siz təsdiq edirsiniz. Müsahibə və ya işə qəbul vəd edilmir.
              </p>
              <div className="pt-2 border-t border-outline-variant/60 text-[11px] space-y-1 text-on-surface-variant">
                <p className="font-semibold text-on-background">Sənəd generasiyası və balans qaydaları:</p>
                <p>CV, rezüme və motivasiya məktubları eyni ortaq generasiya limitini bölüşür (1 sənəd = 1 generasiya). Mövcud sənədlərin yüklənməsi, redaktəsi və ixracı həmişə limitsiz və ödənişsizdir. Uğursuz generasiya cəhdləri balansı azaltmır.</p>
              </div>
            </div>
          </div>
        )}

        {/* EMPLOYER COMMERCIAL PACKAGES */}
        {targetAudience === 'employer' && (
          <div className="space-y-8 max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* 1. Sınaq */}
              <div className="rounded-3xl bg-surface border border-outline-variant p-6 flex flex-col justify-between space-y-5 shadow-xs">
                <div className="space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Sınaq</span>
                  <h3 className="font-serif text-xl font-bold text-on-background">Sınaq</h3>
                  <p className="text-xs text-on-surface-variant">
                    İlk vakansiyanız üçün 14 gün, kart tələb olunmur. Hər təsdiqlənmiş şirkət üçün bir dəfə.
                  </p>
                  <p className="text-2xl font-extrabold text-on-background pt-2">Ödənişsiz</p>
                  <ul className="space-y-2 text-xs text-on-surface-variant pt-4 border-t border-outline-variant/60">
                    <li className="flex items-center gap-2">
                      <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      <span>14 gün vakansiya faktiki yayımlandığı gündən hesablanır</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      <span>Şirkət profili, loqo, müraciət qutusu və namizəd mərhələlərinin idarəsi</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      <span>Bitəndə yeni müraciətlər dayanır; şirkət profili və gələn müraciətlər əlçatan qalır</span>
                    </li>
                  </ul>
                </div>
                <Link
                  href="/business/register"
                  className="w-full min-h-11 flex justify-center items-center rounded-xl bg-background border border-outline-variant text-xs font-semibold text-on-background hover:bg-surface-container transition-colors"
                >
                  Şirkət hesabı yarat
                </Link>
              </div>

              {/* 2. Tək vakansiya */}
              <EmployerPlanCard
                label="Tək vakansiya"
                price={employerPrice('single')}
                priceSuffix="bir dəfəlik"
                summary="Bir vakansiya, yayımlandığı gündən 30 gün."
                bullets={[
                  'Avtomatik yenilənmir, abunəlik yaratmır',
                  'Daha 30 gün üçün yenidən açıq şəkildə ödəyirsiniz',
                  'Şirkət profili, loqo, müraciət qutusu və namizəd mərhələlərinin idarəsi',
                  'Müddət bitəndən sonra profil və müraciətlər əlçatan qalır',
                ]}
                available={employerAvailable('single')}
                state={catalogue ? 'ready' : catalogueFailed ? 'failed' : 'loading'}
                cta="Kabinetdə seçin"
              />

              {/* 3. Biznes */}
              <EmployerPlanCard
                label="Biznes"
                price={employerPrice('recurring')}
                priceSuffix="/ ay"
                summary="Bir təsdiqlənmiş şirkət üçün qaydalara uyğun vakansiyaların sayı məhdud deyil."
                bullets={[
                  'Gizli say limiti yoxdur; spam, təkrar və agentlik ilə yenidən satış qaydaları tətbiq olunur',
                  'Hər elan ən çox 60 gündən bir “hələ də aktualdır” ilə təsdiqlənir',
                  'Şirkət profili, loqo, müraciət qutusu və namizəd mərhələlərinin idarəsi',
                  'İstənilən vaxt ləğv edilir; abunəlik bitəndə profil, müraciətlər və məlumatlar saxlanılır',
                ]}
                available={employerAvailable('recurring')}
                state={catalogue ? 'ready' : catalogueFailed ? 'failed' : 'loading'}
                cta="Kabinetdə seçin"
                highlight
              />
            </div>

            <p className="text-center text-xs text-on-surface-variant">
              Plan namizədlərin uyğunluq ballarına təsir etmir. Namizəd planları (Plus, Premium) ayrıdır.{' '}
              <Link href="/employer-terms" className="underline">İşəgötürən şərtləri</Link>
            </p>

            {/* Enterprise and Promoted rows */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
              {/* Enterprise */}
              <div className="rounded-2xl border border-outline-variant bg-surface p-6 space-y-3">
                <h4 className="font-serif text-lg font-bold text-on-background">Korporativ (Enterprise)</h4>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Böyük holdinqlər və dövlət qurumları üçün fərdi həllər: ATS inteqrasiyası, daxili vakansiya axını və ayrılmış menecer dəstəyi.
                </p>
                <Link
                  href="/contact"
                  className="inline-flex min-h-11 items-center gap-2 text-xs font-bold text-accent hover:underline pt-2"
                >
                  Fərdi təklif alın <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>

              {/* Optional Promoted Listing with explicit trust tag */}
              <div className="rounded-2xl border border-dashed border-outline bg-surface-container-low p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-serif text-lg font-bold text-on-background">Önə çıxarılmış elan</h4>
                  <span className="rounded-full bg-surface-container px-2 py-0.5 text-[10px] font-bold text-on-surface-variant">
                    İstəyə bağlı
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Vakansiyanız kataloqda və axtarış nəticələrində xüsusi <strong>&ldquo;Sponsorlu&rdquo;</strong> etiketi ilə göstərilir. Süni reytinq və ya saxta uyğunluq balı verilmir — namizədlər şəffaf şəkildə sponsorlu elanı görürlər.
                </p>
                <Link
                  href="/contact"
                  className="inline-flex min-h-11 items-center gap-2 text-xs font-bold text-accent hover:underline pt-2"
                >
                  Şərtləri öyrənin <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-outline-variant bg-surface py-8 px-6 lg:px-16 text-center text-xs text-on-surface-variant">
        <p>&copy; {new Date().getFullYear()} AISE. Bütün hüquqlar qorunur.</p>
      </footer>
    </div>
  );
}

function EmployerPlanCard({
  label, price, priceSuffix, summary, bullets, available, state, cta, highlight = false,
}: {
  label: string; price: number | null; priceSuffix: string; summary: string; bullets: string[]; available: boolean; state: 'loading' | 'ready' | 'failed'; cta: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-3xl bg-surface border ${highlight ? 'border-primary shadow-md' : 'border-outline-variant shadow-xs'} p-6 flex flex-col justify-between space-y-5`}>
      <div className="space-y-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-primary">{label}</span>
        <h3 className="font-serif text-xl font-bold text-on-background">{label}</h3>
        <p className="text-xs text-on-surface-variant">{summary}</p>
        <p className="text-2xl font-extrabold text-on-background pt-2">
          {price !== null ? <>{price} AZN <span className="text-sm font-medium text-on-surface-variant">{priceSuffix}</span></> : state === 'loading' ? 'Yüklənir…' : state === 'failed' ? 'Qiymət yüklənmədi' : 'Qiymət hələ elan olunmayıb'}
        </p>
        <ul className="space-y-2 text-xs text-on-surface-variant pt-4 border-t border-outline-variant/60">
          {bullets.map((b) => (
            <li key={b} className="flex items-center gap-2">
              <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      {available ? (
        <a
          href="/business/billing"
          className={`w-full min-h-11 flex justify-center items-center rounded-xl text-xs font-bold transition-colors ${highlight ? 'product-action bg-primary text-white hover:bg-primary-hover' : 'bg-background border border-outline-variant text-on-background hover:bg-surface-container'}`}
        >
          {cta}
        </a>
      ) : (
        <p className="text-xs text-on-surface-variant min-h-11 flex items-center justify-center rounded-xl border border-dashed border-outline-variant">
          {state === 'loading' ? ' ' : 'Hazırda satışda deyil'}
        </p>
      )}
    </div>
  );
}
