'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Shield } from 'lucide-react';
import { ROLE_LABELS } from '@/components/admin-header';

interface SetupInfo {
  kind: 'INVITE' | 'RESET';
  email: string;
  role: keyof typeof ROLE_LABELS;
  expiresAt: string;
}

const INPUT = 'w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-3 px-4 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all';

function SetupContent() {
  const token = useSearchParams().get('token') || '';
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/auth/setup?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Keçid etibarsızdır.');
        setInfo(data);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 12) return setError('Şifrə ən azı 12 simvol olmalıdır');
    if (password !== repeat) return setError('Şifrələr uyğun gəlmir');
    setSaving(true);
    try {
      const res = await fetch('/api/admin/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, ...(info?.kind === 'INVITE' && name.trim() ? { name: name.trim() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message || 'Saxlanılmadı.');
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gözlənilməz xəta baş verdi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background-warm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-background rounded-2xl shadow-xl border border-neutral-dark/10 p-8 space-y-6">
        <div className="text-center">
          <div className="mx-auto bg-accent/15 h-14 w-14 rounded-2xl flex items-center justify-center mb-3 text-accent">
            <Shield className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="font-serif text-2xl font-bold text-neutral-dark">
            {info?.kind === 'RESET' ? 'Yeni şifrə təyin edin' : 'Admin hesabını quraşdırın'}
          </h1>
        </div>
        {loadError && (
          <div role="alert" className="rounded-xl bg-red-50 border border-red-200 p-4 flex gap-3 text-sm text-red-800">
            <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" /> {loadError} Yeni keçid üçün super-admin ilə əlaqə saxlayın.
          </div>
        )}
        {done ? (
          <div role="status" className="space-y-4 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto" aria-hidden="true" />
            <p className="text-sm text-neutral-dark/80">Hazırdır. İndi daxil olun və “Hesabım” bölməsində iki mərhələli təsdiqi aktivləşdirin.</p>
            <Link href="/admin" className="inline-block product-action rounded-full bg-primary py-2.5 px-4 text-sm font-semibold text-white">Daxil ol</Link>
          </div>
        ) : info && (
          <form onSubmit={submit} className="space-y-5">
            <p className="text-sm text-neutral-dark/75">
              <span className="font-semibold">{info.email}</span> · {ROLE_LABELS[info.role]}. Keçid bir dəfə istifadə olunur.
            </p>
            {info.kind === 'INVITE' && (
              <div>
                <label htmlFor="setup-name" className="block text-sm font-medium text-neutral-dark mb-2">Ad (istəyə bağlı)</label>
                <input id="setup-name" value={name} onChange={(e) => setName(e.target.value)} className={INPUT} autoComplete="name" />
              </div>
            )}
            <div>
              <label htmlFor="setup-password" className="block text-sm font-medium text-neutral-dark mb-2">Şifrə (ən azı 12 simvol)</label>
              <input id="setup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} autoComplete="new-password" required />
            </div>
            <div>
              <label htmlFor="setup-repeat" className="block text-sm font-medium text-neutral-dark mb-2">Şifrəni təkrarlayın</label>
              <input id="setup-repeat" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={INPUT} autoComplete="new-password" required />
            </div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={saving} className="w-full product-action rounded-full bg-primary py-3 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? 'Saxlanılır...' : 'Saxla'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function AdminSetupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background-warm" />}>
      <SetupContent />
    </Suspense>
  );
}
