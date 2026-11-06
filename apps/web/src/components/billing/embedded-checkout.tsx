'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { classifyStatus, formatCharged, parseSessionUrl, readBreakdown, safeRedirectTarget, type Breakdown } from '@/lib/embedded-checkout';

type Phase = 'creating' | 'loading' | 'ready' | 'paying' | 'confirming' | 'failed' | 'expired' | 'unavailable' | 'active';

export type SessionResult = { url: string | null; message?: string; alreadyActive?: boolean };

interface Props {
  /** Asks AISE's server for a session. The browser never holds a price, a product id or a provider key. */
  createSession: () => Promise<SessionResult>;
  /** The provider reported a finished payment. This is NOT proof; navigate to the screen that asks the API. */
  onPaid: () => void;
  onCancel: () => void;
  onBreakdown?: (b: Breakdown) => void;
  /** Wording for the cancel button. */
  cancelLabel?: string;
  /** Loads the provider SDK. Replaceable so tests never talk to the real script. */
  loadSdk?: () => Promise<{ DodoPayments: typeof import('dodopayments-checkout').DodoPayments }>;
}

const defaultLoadSdk = () => import('dodopayments-checkout');
const LOAD_TIMEOUT_MS = 15_000;

async function withCheckoutDeadline<T>(task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('CHECKOUT_LOAD_TIMEOUT')), LOAD_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer!); }
}

const CONTAINER_ID = 'aise-embedded-checkout';
let initialized: 'test' | 'live' | null = null;
type ProviderEvent = { event_type: string; data?: unknown };
let activeCheckout: { owner: object; handle: (event: ProviderEvent) => void } | null = null;

/**
 * The provider's checkout embedded in an AISE page (inline SDK). Exactly one session per mount: a double click, a StrictMode remount or a
 * re-render shares the in-flight request, and the provider frame is closed again on unmount. A hosted page remains an explicit choice.
 */
export function EmbeddedCheckout({ createSession, onPaid, onCancel, onBreakdown, cancelLabel = 'Ləğv et', loadSdk = defaultLoadSdk }: Props) {
  const [phase, setPhase] = useState<Phase>('creating');
  const [message, setMessage] = useState<string | null>(null);
  const [charged, setCharged] = useState<string | null>(null);
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const alive = useRef(true);
  const handlers = useRef({ onPaid, onBreakdown });
  handlers.current = { onPaid, onBreakdown };
  const paidOnce = useRef(false);
  const owner = useRef({});
  const formReady = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  const closeFrame = useCallback(async () => {
    const closing = activeCheckout;
    if (!closing || closing.owner !== owner.current) return;
    try {
      const { DodoPayments } = await loadSdk();
      if (activeCheckout !== closing) return;
      activeCheckout = null;
      if (DodoPayments.Checkout.isOpen()) DodoPayments.Checkout.close();
    } catch {
      // Nothing was opened.
    }
  }, [loadSdk]);

  const begin = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    setPhase('creating');
    setMessage(null);
    setNotice(null);
    formReady.current = false;
    paidOnce.current = false;
    const run = (async () => {
      let created: SessionResult;
      try {
        created = await withCheckoutDeadline(createSession());
      } catch {
        created = { url: null };
      }
      if (!alive.current) return;
      if (created.alreadyActive) {
        setMessage("Bu plan artıq aktivdir. Abunəliyinizi Parametrlər bölməsindən idarə edə bilərsiniz.");
        setPhase("active");
        return;
      }
      const parsed = parseSessionUrl(created.url);
      if (!parsed) {
        setMessage(created.message ?? 'Ödəniş forması açılmadı. Heç bir ödəniş tutulmayıb.');
        setPhase('unavailable');
        return;
      }
      setSessionUrl(parsed.url);
      setPhase('loading');
      try {
        const { DodoPayments } = await withCheckoutDeadline(loadSdk());
        if (!alive.current) return;
        activeCheckout = { owner: owner.current, handle: (event) => {
              if (!alive.current) return;
              // Development only, and only the event names and payload keys: no values, so no payment details can reach a console.
              if (process.env.NODE_ENV !== 'production') console.debug('[checkout]', event.event_type, Object.keys((event.data as object) ?? {}));
              switch (event.event_type) {
                case 'checkout.opened':
                  // Opening the shell is not evidence that the card form loaded.
                  break;
                case 'checkout.form_ready':
                case 'checkout.payment_page_opened':
                case 'checkout.resize':
                  formReady.current = true;
                  setPhase((p) => (p === 'loading' ? 'ready' : p));
                  break;
                case 'checkout.breakdown': {
                  const b = readBreakdown(event.data);
                  setCharged(formatCharged(b));
                  handlers.current.onBreakdown?.(b);
                  break;
                }
                case 'checkout.pay_button_clicked':
                  // A retry after a decline presses pay again from the failed state.
                  setMessage(null);
                  setPhase((p) => (p === 'ready' || p === 'failed' ? 'paying' : p));
                  break;
                case 'checkout.status': {
                  const kind = classifyStatus(event.data);
                  if (kind === 'succeeded') {
                    if (paidOnce.current) break;
                    paidOnce.current = true;
                    setPhase('confirming');
                    handlers.current.onPaid();
                  } else if (kind === 'failed') {
                    setMessage('Ödəniş tamamlanmadı və kartınızdan vəsait tutulmadı. Məlumatları yoxlayın və ya başqa kartla cəhd edin.');
                    setPhase('failed');
                  } else {
                    setPhase('paying');
                  }
                  break;
                }
                case 'checkout.redirect':
                case 'checkout.redirect_requested': {
                  // Bank authentication or the provider's final step. Navigation is allowed; being sent back is not proof of payment.
                  const target = safeRedirectTarget((event.data as { message?: { redirect_to?: unknown; url?: unknown } } | undefined)?.message?.redirect_to
                    ?? (event.data as { message?: { url?: unknown } } | undefined)?.message?.url);
                  if (target) {
                    const url = new URL(target);
                    if (url.origin === window.location.origin && ['/dashboard', '/business/billing'].includes(url.pathname) && url.searchParams.get('checkout') === 'success') {
                      if (!paidOnce.current) { paidOnce.current = true; setPhase('confirming'); handlers.current.onPaid(); }
                    } else window.location.assign(target);
                  }
                  break;
                }
                case 'checkout.link_expired':
                  setMessage('Ödəniş seansının vaxtı bitdi. Heç bir ödəniş tutulmayıb.');
                  setPhase('expired');
                  break;
                case 'checkout.error': {
                  const detail = (event.data as { message?: unknown } | undefined)?.message;
                  if (formReady.current || (typeof detail === 'string' && /wallet/i.test(detail))) {
                    setNotice('Ödəniş seçimlərindən biri yüklənmədi. Kart forması əlçatandırsa, ondan istifadə edin və ya provayderin səhifəsini ayrıca açın.');
                    break;
                  }
                  setMessage('Ödəniş forması yüklənmədi. Yenidən cəhd edin və ya provayderin səhifəsini ayrıca açın.');
                  setPhase('failed');
                  break;
                }
                default:
                  break;
              }
            } };
        if (initialized !== parsed.mode) {
          DodoPayments.Initialize({ mode: parsed.mode, displayType: 'inline', onEvent: (event) => activeCheckout?.handle(event) });
          initialized = parsed.mode;
        }
        // The SDK is a singleton: a previous route's open frame otherwise prevents this one from opening.
        if (DodoPayments.Checkout.isOpen()) DodoPayments.Checkout.close();
        DodoPayments.Checkout.open({
          checkoutUrl: parsed.url,
          elementId: CONTAINER_ID,
          options: { manualRedirect: true, showTimer: false, showSecurityBadge: true, fontSize: 'md' },
        });
      } catch {
        if (alive.current) {
          setMessage('Ödəniş forması yüklənmədi. Aşağıdakı seçimlə ödəniş səhifəsini ayrıca aça bilərsiniz.');
          setPhase('unavailable');
        }
      }
    })();
    inFlight.current = run.finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [createSession, loadSdk]);

  useEffect(() => {
    alive.current = true;
    void begin();
    return () => {
      alive.current = false;
      void closeFrame();
    };
    // begin is stable for the component's lifetime (createSession identity is the caller's responsibility).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'loading') return;
    const timer = window.setTimeout(() => {
      if (!alive.current || formReady.current) return;
      setMessage('Ödəniş forması vaxtında yüklənmədi. Səhifəni yeniləmədən yenidən cəhd edin və ya Dodo Payments səhifəsini açın.');
      setPhase('failed');
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const retry = async () => {
    await closeFrame();
    setSessionUrl(null);
    setCharged(null);
    void begin();
  };

  const busy = phase === 'creating' || phase === 'loading';
  const retryable = phase === 'failed' || phase === 'expired' || phase === 'unavailable';

  return (
    <div className="space-y-4">
      {busy && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-neutral-dark/10 bg-background p-4 text-sm text-neutral-dark/75">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {phase === 'creating' ? 'Ödəniş forması hazırlanır...' : 'Təhlükəsiz ödəniş forması yüklənir...'}
        </div>
      )}

      {phase === 'confirming' && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-neutral-dark">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Ödəniş qəbul edildi. Provayderin təsdiqi yoxlanılır; planınız təsdiqdən sonra aktivləşəcək.
        </div>
      )}

      {phase === 'paying' && (
        <p role="status" className="text-xs text-neutral-dark/65">
          Ödəniş emal olunur. Bank təsdiqi istənərsə, onu tamamlayın və bu səhifəni bağlamayın.
        </p>
      )}

      {notice && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{notice}</p>}

      {phase === 'active' && <div role="status" className="rounded-lg border border-primary/20 p-4 text-sm">{message} <a className="underline" href="/dashboard/settings">Abunəliyi idarə et</a></div>}

      {message && (phase === 'failed' || phase === 'expired' || phase === 'unavailable') && (
        <div role="alert" className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700 flex gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{message}</span>
        </div>
      )}

      {/* The provider's frame (with its own footer, terms of sale and privacy policy) is never hidden. */}
      <div id={CONTAINER_ID} className={phase === 'unavailable' || phase === 'expired' || phase === 'active' ? 'hidden' : 'w-full min-h-[120px]'} />

      {charged && !retryable && (
        <p className="text-xs text-neutral-dark/65">
          Ödəniləcək yekun məbləğ: <span className="font-semibold text-neutral-dark">{charged}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {retryable && (
          <button
            type="button"
            onClick={retry}
            className="tap inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Yenidən cəhd et
          </button>
        )}
        {phase !== 'confirming' && (
          <button type="button" onClick={onCancel} className="tap text-sm font-semibold text-neutral-dark/75 hover:text-accent">
            {cancelLabel}
          </button>
        )}
        {sessionUrl && phase !== 'confirming' && (
          <a href={sessionUrl} className="tap text-xs text-neutral-dark/60 underline underline-offset-2 hover:text-accent">
            Ödənişi Dodo Payments-in öz səhifəsində tamamla
          </a>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-neutral-dark/50">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Kart məlumatlarınız AISE-yə çatmır; ödənişi Dodo Payments qəbul edir.
      </p>
    </div>
  );
}
