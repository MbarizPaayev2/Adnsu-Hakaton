'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play, Square } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { BUTTON } from '@/components/ui';

/**
 * Pause controls next to the agent. "Hazırlığı dayandır" stops background preparation (drafts already prepared stay for the candidate);
 * "Göndərişi dayandır" holds every approved e-mail application in the queue until resumed. One request at a time; the page reloads its
 * numbers from the server afterwards, so nothing is shown that the server did not record.
 */
export function AgentControls({ queueOn, paused }: { queueOn: boolean; paused: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const act = async (key: string, path: string) => {
    if (busy) return;
    setBusy(key); setError('');
    try {
      const res = await apiFetch(path, { method: 'POST' });
      if (!res.ok) { setError('Alınmadı. Bir az sonra yenidən cəhd edin.'); return; }
      router.refresh();
    } catch {
      setError('Bağlantı xətası. Yenidən cəhd edin.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {queueOn && (
        <button type="button" className={BUTTON.quiet} disabled={!!busy} aria-busy={busy === 'stop'} onClick={() => act('stop', '/email-applications/automation/review/stop')}>
          <Square aria-hidden="true" className="h-4 w-4" />{busy === 'stop' ? 'Dayandırılır…' : 'Hazırlığı dayandır'}
        </button>
      )}
      {paused ? (
        <button type="button" className={BUTTON.quiet} disabled={!!busy} aria-busy={busy === 'resume'} onClick={() => act('resume', '/email-applications/settings/resume')}>
          <Play aria-hidden="true" className="h-4 w-4" />{busy === 'resume' ? 'Davam etdirilir…' : 'Göndərişi davam etdir'}
        </button>
      ) : (
        <button type="button" className={BUTTON.quiet} disabled={!!busy} aria-busy={busy === 'pause'} onClick={() => act('pause', '/email-applications/settings/pause')}>
          <Pause aria-hidden="true" className="h-4 w-4" />{busy === 'pause' ? 'Dayandırılır…' : 'Bütün göndərişi dayandır'}
        </button>
      )}
      {error && <p role="alert" className="w-full text-sm text-red-800">{error}</p>}
    </>
  );
}
