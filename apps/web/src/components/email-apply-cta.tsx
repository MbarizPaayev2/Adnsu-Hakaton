'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { MailCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { captureFunnelEvent } from './posthog-provider';
import { EmailAllowanceNote, useEmailAllowance } from './email-allowance-note';

type Eligibility = { eligible: boolean; reason?: string; existing?: { id: string; deliveryState: string } };

const REASONS: Record<string, string> = {
  RECIPIENT_SUPPRESSED: 'Bu ünvana əvvəl göndərilən e-poçt çatdırılmadığı üçün göndərmək mümkün deyil.',
  JOB_NOT_OPEN: 'Bu elan artıq açıq deyil.',
};
const OPEN_EXISTING = new Set(['AWAITING_APPROVAL', 'QUEUED', 'SENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'UNCERTAIN', 'BOUNCED', 'COMPLAINED']);

/**
 * Offered only where the vacancy itself names an application address. Preparing is free and sends nothing:
 * the candidate reviews everything on the next page and approves there.
 */
export function EmailApplyCta({ jobId, loginHref }: { jobId: string; loginHref: string }) {
  const router = useRouter();
  const { status } = useSession();
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const allowance = useEmailAllowance(status === 'authenticated' && enabled === true);

  useEffect(() => { if (status !== 'loading') captureFunnelEvent('email_apply_job_viewed', { jobId, source: 'job_detail' }); }, [jobId, status]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    (async () => {
      try {
        const caps = await apiFetch('/email-applications/capabilities', { cache: 'no-store' });
        const on = caps.ok && !!(await caps.json()).enabled;
        if (cancelled) return;
        setEnabled(on);
        if (!on) return;
        const res = await apiFetch(`/email-applications/eligibility/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
        if (!cancelled && res.ok) setEligibility(await res.json());
      } catch { if (!cancelled) setEnabled(false); }
    })();
    return () => { cancelled = true; };
  }, [jobId, status]);

  if (status === 'unauthenticated') {
    return <p className="mt-4 text-sm"><Link href={loginHref} className="font-medium text-accent underline">Daxil olun</Link> və bu elana e-poçtla müraciət hazırlayın. Müraciət yalnız sizin təsdiqinizlə göndərilir.</p>;
  }
  if (status !== 'authenticated' || enabled === false || !eligibility) return null;

  const existing = eligibility.existing && OPEN_EXISTING.has(eligibility.existing.deliveryState) ? eligibility.existing : null;
  const prepare = async () => {
    setBusy(true); setError('');
    try {
      const res = await apiFetch('/email-applications/prepare', { method: 'POST', body: JSON.stringify({ jobId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
        setError(String(message || 'Müraciət hazırlanmadı.').replace(/\s*\(NO_CV\)$/, ''));
        return;
      }
      captureFunnelEvent('email_apply_prepared', { jobId, source: 'job_detail' });
      router.push(`/dashboard/email-applications/${data.id}`);
    } catch { setError('Bağlantı xətası. Yenidən cəhd edin.'); } finally { setBusy(false); }
  };

  return (
    <section className="mt-5 rounded-2xl border border-outline-variant bg-surface-container-low p-4" aria-labelledby="email-apply-title">
      <h2 id="email-apply-title" className="flex items-center gap-2 text-base font-semibold"><MailCheck className="h-5 w-5" aria-hidden="true" /> E-poçtla müraciət</h2>
      {existing ? (
        <p className="mt-2 text-sm">Bu elana artıq e-poçt müraciəti var. <Link href={`/dashboard/email-applications/${existing.id}`} className="font-medium text-accent underline">Müraciətə bax</Link></p>
      ) : eligibility.eligible ? (
        <>
          <p className="mt-2 text-sm text-on-surface-variant">Elan müraciət üçün e-poçt ünvanı göstərir. Mövzunu, məktubu və CV-ni yoxlayırsınız; siz təsdiq etməyincə heç nə göndərilmir.</p>
          <EmailAllowanceNote allowance={allowance} className="mt-2" />
          <button type="button" onClick={prepare} disabled={busy || (allowance?.limit != null && (allowance.remaining ?? 0) <= 0)} className="mt-3 min-h-11 product-action rounded-full bg-accent px-5 py-3 font-medium text-white disabled:opacity-60">{busy ? 'Hazırlanır...' : 'Müraciəti hazırla və yoxla'}</button>
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error} {/CV/.test(error) && <Link href="/dashboard/resumes" className="underline">CV-lərə keç</Link>}</p>}
        </>
      ) : <p className="mt-2 text-sm text-on-surface-variant">{REASONS[eligibility.reason ?? ''] ?? 'Bu elana e-poçtla müraciət mümkün deyil.'}</p>}
    </section>
  );
}
