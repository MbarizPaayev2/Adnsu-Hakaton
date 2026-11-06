'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, AlertCircle } from 'lucide-react';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Second step after the password, when the operator has MFA enrolled.
  const [mfaStep, setMfaStep] = useState(false);
  const [code, setCode] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('E-poçt və şifrə tələb olunur');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || 'Daxil olarkən xəta baş verdi.');
      }
      if (data.mfaRequired) {
        setPassword('');
        setMfaStep(true);
        return;
      }

      router.push('/admin/overview');
    } catch (err: any) {
      setError(err.message || 'Gözlənilməz xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401 && /yenidən daxil olun/i.test(data.message || '')) setMfaStep(false);
        throw new Error(data.message || 'Kod qəbul edilmədi.');
      }
      router.push('/admin/overview');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gözlənilməz xəta baş verdi.');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background-warm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-background rounded-2xl shadow-xl border border-neutral-dark/10 p-8 animate-in fade-in zoom-in-95 duration-500">
        <div className="text-center mb-8">
          <div className="mx-auto bg-accent/15 h-16 w-16 rounded-2xl flex items-center justify-center mb-4 text-accent shadow-sm">
            <Shield className="h-8 w-8" />
          </div>
          <h1 className="font-serif text-3xl font-bold text-neutral-dark tracking-wide mb-1">
            AISE
          </h1>
          <p className="text-neutral-dark/65">Admin Paneli</p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-red-50 border border-red-200 p-4 flex items-start gap-3 text-red-800">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <span className="text-sm font-medium">{error}</span>
          </div>
        )}

        {mfaStep ? (
          <form onSubmit={handleCode} className="space-y-6">
            <div>
              <label htmlFor="admin-mfa-code" className="block text-sm font-medium text-neutral-dark mb-2">
                Autentifikator tətbiqindəki 6 rəqəmli kod və ya bərpa kodu
              </label>
              <input
                id="admin-mfa-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
                className="w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-3 px-4 text-neutral-dark tracking-widest focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="123456"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="w-full flex justify-center items-center product-action rounded-full bg-primary py-3 px-4 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all disabled:opacity-50"
            >
              {loading ? 'Yoxlanılır...' : 'Təsdiqlə'}
            </button>
            <button type="button" onClick={() => { setMfaStep(false); setError(''); }} className="w-full text-sm text-neutral-dark/65 hover:underline">
              Geri
            </button>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="admin-email" className="block text-sm font-medium text-neutral-dark mb-2">
              E-poçt
            </label>
            <input
              id="admin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-3 px-4 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              placeholder="admin@aise.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label htmlFor="admin-password" className="block text-sm font-medium text-neutral-dark mb-2">
              Şifrə
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-3 px-4 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center items-center product-action rounded-full bg-primary py-3 px-4 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all disabled:opacity-50"
          >
            {loading ? 'Daxil olunur...' : 'Daxil ol'}
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
