'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { BUTTON } from '@/components/ui';

/** "Keç": cancels one prepared application after a second, explicit tap. Nothing was sent; the posting is not prepared again. */
export function SkipApplicationButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const skip = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const res = await apiFetch(`/email-applications/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      if (!res.ok) { setError('Keçmək alınmadı. Səhifəni yeniləyib yenidən cəhd edin.'); return; }
      router.refresh();
    } catch {
      setError('Bağlantı xətası. Yenidən cəhd edin.');
    } finally {
      inFlight.current = false; setBusy(false);
    }
  };
  if (!confirming) return <button type="button" className={BUTTON.quiet} onClick={() => setConfirming(true)} aria-label={`${title}: keç`}>Keç</button>;
  return (
    <span className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-surface-container-low p-2 text-sm sm:w-auto" role="group" aria-label="Keçməyi təsdiqləyin">
      <span className="px-1">Bu müraciət göndərilməyəcək.</span>
      <button type="button" className={BUTTON.danger} disabled={busy} aria-busy={busy} onClick={skip}>{busy ? 'Keçilir…' : 'Bəli, keç'}</button>
      <button type="button" className={BUTTON.quiet} disabled={busy} onClick={() => setConfirming(false)}>İmtina</button>
      {error && <span role="alert" className="w-full text-red-800">{error}</span>}
    </span>
  );
}
