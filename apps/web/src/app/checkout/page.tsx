'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- Checkout exit must restore the destination document CSP. */

import { BrandWordmark } from '@/components/landing/brand-logo';
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { apiFetch } from '@/lib/api';
import { usePaymentsEnabled } from '@/lib/billing';
import { Check, ArrowLeft } from 'lucide-react';
import { LoadingState } from '@/components/ui';
import { EmbeddedCheckout, type SessionResult } from '@/components/billing/embedded-checkout';

interface Plan {
  id: string;
  name: string;
  price: number;
  currency: string;
  matchesPerMonth: number | null;
  features: string[];
}

function CheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();

  const planId = (searchParams.get('plan') || '').toLowerCase();
  const paymentsEnabled = usePaymentsEnabled();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    if (!session) {
      router.push(`/register?plan=${planId}`);
      return;
    }

    (async () => {
      try {
        const res = await apiFetch('/billing/plans');
        if (!res.ok) throw new Error('Planlar yüklənə bilmədi');
        const plans: Plan[] = await res.json();
        const match = plans.find((p) => p.id === planId);
        if (!match || match.id === 'free') {
          // No such plan, or someone hit /checkout?plan=free directly —
          // there's nothing to pay for, send them back to compare plans.
          router.replace('/pricing');
          return;
        }
        // An offer without a server-set price (or flagged unpurchasable) is not for sale: back to the comparison, never a price guess.
        if ((match as { purchasable?: boolean }).purchasable === false || match.price == null) {
          router.replace('/pricing');
          return;
        }
        setPlan(match);
      } catch (err: any) {
        setError(err.message || 'Planlar yüklənərkən xəta baş verdi.');
      } finally {
        setLoadingPlans(false);
      }
    })();
  }, [session, sessionStatus, planId, router]);

  // The server creates the session from the approved plan; the embedded form only ever receives its address.
  const createSession = useCallback(async (): Promise<SessionResult> => {
    if (!plan || plan.id === 'free' || plan.price <= 0) return { url: null };
    const res = await apiFetch('/billing/checkout-session', {
      method: 'POST',
      body: JSON.stringify({ planId: plan.id }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return { url: null, alreadyActive: errData.message === 'Bu plan artıq aktivdir', message: errData.message || 'Ödəniş başladıla bilmədi. Heç bir ödəniş tutulmayıb.' };
    }
    const data = await res.json();
    return { url: typeof data.url === 'string' ? data.url : null };
  }, [plan]);

  // The provider's "paid" event is not proof. The dashboard asks the API, which is updated from the signed webhook, and only then names the plan.
  const handlePaid = useCallback(() => {
    window.location.replace('/dashboard?checkout=success');
  }, []);

  if (sessionStatus === 'loading' || loadingPlans || paymentsEnabled === null) {
    return (
      <div className="mx-auto max-w-md p-6"><LoadingState label="Ödəniş səhifəsi yüklənir…" /></div>
    );
  }

  return (
    <div className="min-h-screen bg-background-warm flex flex-col font-sans selection:bg-primary/20 selection:text-primary">
      <header className="px-6 lg:px-16 h-20 flex items-center justify-between border-b border-neutral-dark/10">
        <a href="/" className="tap flex items-center gap-2">
          <BrandWordmark className="text-3xl" />
        </a>
        <a
          href="/pricing"
          className="tap flex items-center gap-1.5 text-sm font-semibold text-neutral-dark hover:text-accent transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Planlara qayıt
        </a>
      </header>

      <main className="flex-1 py-10 sm:py-16 px-4 sm:px-6 max-w-5xl mx-auto w-full animate-in fade-in duration-500">
        <div className="text-center space-y-2 mb-8">
          <h1 className="font-serif text-3xl font-bold text-neutral-dark">Ödənişi tamamlayın</h1>
          <p className="text-sm text-neutral-dark/70">
            Ödənişi bu səhifədən çıxmadan edin. Kart, Apple Pay və Google Pay yalnız cihazınız və brauzeriniz dəstəklədikdə göstərilir.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100" role="alert">
            {error}
          </div>
        )}

        {plan && paymentsEnabled === false && (
          <p role="status" className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
            Ödənişli planlar hələ aktiv deyil, ona görə bu plan hazırda alına bilməz. Ödənişsiz planla davam edə bilərsiniz.
          </p>
        )}

        {plan && paymentsEnabled && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start">
            <section aria-labelledby="order-heading" className="rounded-2xl bg-background border border-neutral-dark/10 p-6 sm:p-8 space-y-6 shadow-xs">
              <div className="flex items-center justify-between border-b border-neutral-dark/5 pb-4">
                <div>
                  <h2 id="order-heading" className="font-serif text-xl font-bold text-neutral-dark">{plan.name}</h2>
                  <p className="text-xs text-neutral-dark/60">Aylıq abunəlik</p>
                </div>
                <div className="text-right">
                  <span className="font-serif text-3xl font-extrabold text-neutral-dark">{plan.price}₼</span>
                  <span className="text-xs text-neutral-dark/65">/ay</span>
                </div>
              </div>

              <ul className="space-y-3">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 text-sm text-neutral-dark/85">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="rounded-lg bg-background-warm border border-neutral-dark/10 p-4 text-xs text-neutral-dark/75 space-y-1.5">
                <p><span className="font-semibold text-neutral-dark">Yenilənmə:</span> abunəlik hər ay {plan.price}₼ ilə avtomatik yenilənir.</p>
                <p><span className="font-semibold text-neutral-dark">Ləğv:</span> istənilən vaxt Parametrlər bölməsindən ləğv edə bilərsiniz; plan ödənilmiş dövrün sonuna qədər qalır.</p>
                <p>
                  <a href="/refund" className="underline underline-offset-2 hover:text-accent">Geri ödəniş siyasəti</a>
                  {' · '}
                  <a href="/terms" className="underline underline-offset-2 hover:text-accent">İstifadə şərtləri</a>
                </p>
              </div>
            </section>

            <section aria-label="Ödəniş forması" className="rounded-2xl bg-background border border-neutral-dark/10 p-4 sm:p-6 shadow-xs">
              <EmbeddedCheckout createSession={createSession} onPaid={handlePaid} onCancel={() => window.location.assign('/pricing')} cancelLabel="Planlara qayıt" />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md p-6"><LoadingState label="Ödəniş səhifəsi yüklənir…" /></div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
