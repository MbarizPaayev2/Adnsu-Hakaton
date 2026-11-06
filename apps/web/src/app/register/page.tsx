'use client';

import { BrandWordmark } from '@/components/landing/brand-logo';
import React, { useState } from 'react';
import Link from 'next/link';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import {
  performVerificationResend,
  verificationResendLabel,
  type VerificationResendState,
} from '@/lib/verification-resend';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<VerificationResendState>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Zəhmət olmasa ad və soyadınızı qeyd edin.');
      return;
    }

    if (!email || !password) {
      setError('Zəhmət olmasa bütün xanaları doldurun.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Şifrələr eyni deyil.');
      return;
    }

    if (!acceptTerms) {
      setError('Davam etmək üçün İstifadə Şərtləri və Məxfilik Siyasəti ilə razılaşın.');
      return;
    }

    setLoading(true);

    try {
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
      const endpoint = apiUrl ? `${apiUrl}/auth/register` : '/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: name.trim(), email, password, acceptTerms }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Qeydiyyat uğursuz oldu. Yenidən cəhd edin.');
      }

      // Registration doesn't log the user in — they must verify their email
      // first (POST /auth/verify-email) before /auth/login will succeed.
      setRegisteredEmail(email);
    } catch (err: any) {
      setError(err.message || 'Qeydiyyat zamanı xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!registeredEmail) return;
    setResendState('sending');
    const nextState = await performVerificationResend({
      apiUrl: process.env.NEXT_PUBLIC_API_URL || '',
      path: '/auth/resend-verification',
      email: registeredEmail,
    });
    setResendState(nextState);
  };

  if (registeredEmail) {
    return (
      <div className="auth-scene flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8 bg-background-warm">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <Link href="/" className="tap flex justify-center">
            <BrandWordmark className="text-3xl" />
          </Link>
          <h1 className="mt-6 text-center font-serif text-2xl font-semibold tracking-tight text-neutral-dark">
            E-poçtunuzu təsdiqləyin
          </h1>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="auth-card bg-background py-8 px-4 shadow-sm border border-neutral-dark/5 rounded-2xl sm:px-10 text-center space-y-4">
            <p className="text-sm text-neutral-dark/80">
              <strong>{registeredEmail}</strong> ünvanı üçün hesab yaradıldı. Təsdiq e-poçtunu yoxlayın; gəlməsə yenidən göndərə bilərsiniz. Daxil olmadan əvvəl e-poçtunuzu təsdiqləməlisiniz.
            </p>
            <button
              onClick={handleResend}
              disabled={resendState === 'sending'}
              className="tap-inline text-sm font-medium text-accent hover:text-accent-hover transition-colors disabled:opacity-50"
            >
              {verificationResendLabel(resendState)}
            </button>
            <div>
              <Link href="/login" className="tap-inline text-sm font-medium text-accent hover:text-accent-hover transition-colors">
                Daxil olma səhifəsinə qayıt
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-scene flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8 bg-background-warm">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link href="/" className="tap flex justify-center">
          <BrandWordmark className="text-3xl" />
        </Link>
        <h1 className="mt-6 text-center font-serif text-2xl font-semibold tracking-tight text-neutral-dark">
          Karyera hesabınızı yaradın
        </h1>
        <p className="mt-2 text-center text-sm text-neutral-dark/80">
          Artıq hesabınız var?{' '}
          <Link href="/login" className="tap-inline font-medium text-accent hover:text-accent-hover transition-colors">
            Daxil olun
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="auth-card bg-background py-8 px-4 shadow-sm border border-neutral-dark/5 rounded-2xl sm:px-10">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100" role="alert">
              {error}
            </div>
          )}

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-neutral-dark">
                Ad və soyad
              </label>
              <div className="mt-1">
                <input
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark placeholder:text-neutral-dark/45 focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                  placeholder="məs. Aygün Məmmədova"
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-neutral-dark">
                E-poçt ünvanı
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
                  placeholder="ad@nümunə.com"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-neutral-dark">
                Şifrə
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
                Şifrəni təsdiqləyin
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

            <div className="flex items-start gap-3">
              <input
                id="accept-terms"
                name="accept-terms"
                type="checkbox"
                required
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 rounded border-neutral-dark/30 text-primary focus:ring-2 focus:ring-primary"
              />
              <label htmlFor="accept-terms" className="text-sm text-neutral-dark/80">
                <Link href="/terms" className="font-medium text-primary underline" target="_blank">İstifadə şərtləri</Link> və{' '}
                <Link href="/privacy" className="font-medium text-primary underline" target="_blank">Məxfilik siyasəti</Link> ilə tanış oldum və razıyam.
              </label>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="flex w-full justify-center product-action rounded-full bg-primary py-2.5 px-4 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 transition-all"
              >
                {loading ? 'Hesab yaradılır...' : 'Hesab yarat'}
              </button>
            </div>
          </form>

          <GoogleSignInButton callbackUrl="/dashboard" />
        </div>
      </div>
    </div>
  );
}
