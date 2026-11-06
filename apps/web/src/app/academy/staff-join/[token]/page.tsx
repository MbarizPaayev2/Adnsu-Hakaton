'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

export default function AcademyStaffJoinPage() {
  const { token } = useParams<{ token: string }>();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await apiFetch(`/academies/staff-invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || 'Dəvəti qəbul etmək mümkün olmadı');
      }
      router.replace('/academy');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dəvəti qəbul etmək mümkün olmadı');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#F6F7F0] px-4 py-16 text-[#232A24]">
      <section className="mx-auto max-w-lg rounded-3xl border border-[#DCE0D5] bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#667064]">AISE · Akademiya komandası</p>
        <h1 className="mt-3 text-2xl font-semibold">Akademiya dəvəti</h1>
        <p className="mt-2 text-sm leading-6 text-[#667064]">Dəvəti qəbul etmək üçün dəvətin göndərildiyi e-poçtla təsdiqlənmiş hesaba daxil olun. Dəvətin rolu və e-poçt uyğunluğu serverdə yoxlanır.</p>
        {status === 'loading' ? <p className="mt-6 text-sm" role="status">Hesab yoxlanılır…</p> : !session ? (
          <Link className="mt-6 inline-flex min-h-11 items-center rounded-full bg-[#253B2C] px-5 text-sm font-semibold text-white" href={`/login?callbackUrl=${encodeURIComponent(`/academy/staff-join/${token}`)}`}>Daxil ol</Link>
        ) : (
          <button type="button" disabled={pending} onClick={accept} className="mt-6 inline-flex min-h-11 items-center rounded-full bg-[#253B2C] px-5 text-sm font-semibold text-white disabled:opacity-50">{pending ? 'Dəvət qəbul edilir…' : 'Dəvəti qəbul et'}</button>
        )}
        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      </section>
    </main>
  );
}
