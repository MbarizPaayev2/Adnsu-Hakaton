'use client';

import { BrandWordmark } from '@/components/landing/brand-logo';
import React, { useState } from 'react';
import Link from 'next/link';

export default function BusinessForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email) {
      setError('Zəhmət olmasa e-poçt ünvanınızı daxil edin.');
      return;
    }

    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const res = await fetch(`${apiUrl}/business/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Sorğu göndərilə bilmədi.');
      }

      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-scene flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8 bg-background-warm">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link href="/" className="tap flex justify-center">
          <BrandWordmark className="text-3xl" />
        </Link>
        <h1 className="mt-6 text-center font-serif text-2xl font-semibold tracking-tight text-neutral-dark">
          Biznes şifrənizi sıfırlayın
        </h1>
        <p className="mt-2 text-center text-sm text-neutral-dark/80">
          <Link href="/business/login" className="tap-inline font-medium text-accent hover:text-accent-hover transition-colors">
            Daxil olma səhifəsinə qayıt
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="auth-card bg-background py-8 px-4 shadow-sm border border-neutral-dark/5 rounded-2xl sm:px-10">
          {sent ? (
            <div className="rounded-lg bg-green-50 p-4 text-sm text-green-700 border border-green-100 text-center">
              Əgər bu e-poçt ünvanı ilə hesab mövcuddursa, şifrəni sıfırlamaq üçün link göndərildi.
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100" role="alert">
                  {error}
                </div>
              )}

              <form className="space-y-6" onSubmit={handleSubmit}>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-neutral-dark">
                    Biznes e-poçt ünvanı
                  </label>
                  <div className="mt-1">
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark placeholder:text-neutral-dark/45 focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                      placeholder="ad@şirkət.com"
                    />
                  </div>
                </div>

                <div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex w-full justify-center product-action rounded-full bg-primary py-2.5 px-4 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 transition-all"
                  >
                    {loading ? 'Göndərilir...' : 'Sıfırlama linki göndər'}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
