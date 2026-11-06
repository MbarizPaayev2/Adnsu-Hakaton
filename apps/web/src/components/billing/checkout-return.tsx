'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

const POLL_MS = 3000;
const POLL_LIMIT = 20; // about a minute

type State = { kind: 'checking' } | { kind: 'confirmed'; plan: string } | { kind: 'pending' } | { kind: 'mock' };

/**
 * Shown after the payment page sends the candidate back. The return URL proves
 * nothing, so the plan is only announced once the API — updated from the
 * provider's signed webhook — reports it.
 */
export function CheckoutReturn() {
  const params = useSearchParams();
  const returned = params.get('checkout') === 'success';
  const mock = params.get('mock') === '1';
  const [state, setState] = useState<State>({ kind: mock ? 'mock' : 'checking' });

  useEffect(() => {
    if (!returned || mock) return;
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      tries++;
      try {
        const res = await apiFetch('/billing/subscription');
        const data = res.ok ? await res.json() : null;
        if (!alive) return;
        if (data && data.plan !== 'FREE' && data.status === 'active') {
          setState({ kind: 'confirmed', plan: data.plan });
          return;
        }
      } catch {
        // Keep polling; a transient network error proves nothing either way.
      }
      if (!alive) return;
      if (tries >= POLL_LIMIT) setState({ kind: 'pending' });
      else timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [returned, mock]);

  if (!returned) return null;
  if (state.kind === 'mock') {
    return (
      <p role="status" className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
        Test rejimi: real ödəniş aparılmadı və planınız dəyişmədi.
      </p>
    );
  }
  if (state.kind === 'confirmed') {
    return (
      <p role="status" className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-800">
        Ödəniş təsdiqləndi — {state.plan === 'Limitsiz' ? 'Limitsiz' : state.plan} planı aktivdir.
      </p>
    );
  }
  if (state.kind === 'pending') {
    return (
      <p role="status" className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
        Ödəniş hələ təsdiqlənməyib. Bu adətən bir neçə dəqiqə çəkir — səhifəni bir az sonra yeniləyin. Kartınızdan vəsait çıxılıbsa və plan
        aktivləşməyibsə, Parametrlər bölməsindən bizimlə əlaqə saxlayın; ikinci dəfə ödəməyin.
      </p>
    );
  }
  return (
    <p role="status" className="rounded-lg bg-background border border-neutral-dark/10 p-4 text-sm text-neutral-dark/80">
      Ödənişiniz yoxlanılır...
    </p>
  );
}
