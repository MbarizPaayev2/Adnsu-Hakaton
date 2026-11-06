'use client';

import { BrandWordmark } from '@/components/landing/brand-logo';
import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('Sıfırlama linki yanlışdır.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Şifrələr eyni deyil.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || 'Şifrə sıfırlana bilmədi.');
      }

      router.push('/login?reset=true');
    } catch (err: any) {
      setError(err.message || 'Xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="auth-card bg-background py-8 px-4 shadow-sm border border-neutral-dark/5 rounded-2xl sm:px-10 text-center space-y-4">
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100">
          Sıfırlama linki yanlışdır və ya vaxtı bitib.
        </div>
        <Link href="/forgot-password" className="tap-inline text-sm font-medium text-accent hover:text-accent-hover transition-colors">
          Yeni sıfırlama linki tələb edin
        </Link>
      </div>
    );
  }

  return (
    <div className="auth-card bg-background py-8 px-4 shadow-sm border border-neutral-dark/5 rounded-2xl sm:px-10">
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100" role="alert">
          {error}
        </div>
      )}

      <form className="space-y-6" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-neutral-dark">
            Yeni şifrə
          </label>
          <div className="mt-1">
            <input
              id="password"
              name="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark placeholder:text-neutral-dark/45 focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
              placeholder="••••••••"
            />
          </div>
        </div>

        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-neutral-dark">
            Yeni şifrəni təsdiqləyin
          </label>
          <div className="mt-1">
            <input
              id="confirm-password"
              name="confirm-password"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark placeholder:text-neutral-dark/45 focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
              placeholder="••••••••"
            />
          </div>
        </div>

        <div>
          <button
            type="submit"
            disabled={loading}
            className="flex w-full justify-center product-action rounded-full bg-primary py-2.5 px-4 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 transition-all"
          >
            {loading ? 'Yenilənir...' : 'Şifrəni yenilə'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="auth-scene flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8 bg-background-warm">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link href="/" className="tap flex justify-center">
          <BrandWordmark className="text-3xl" />
        </Link>
        <h1 className="mt-6 text-center font-serif text-2xl font-semibold tracking-tight text-neutral-dark">
          Yeni şifrə təyin edin
        </h1>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <Suspense fallback={
          <div className="auth-card bg-background py-8 px-4 shadow-sm border border-neutral-dark/5 rounded-2xl sm:px-10 text-center text-sm text-neutral-dark/65">
            Yüklənir...
          </div>
        }>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
