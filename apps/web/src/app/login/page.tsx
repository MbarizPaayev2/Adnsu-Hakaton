'use client';

import { BrandWordmark } from '@/components/landing/brand-logo';
import React, { useState, useEffect, Suspense } from 'react';
import { safeNextPath } from '@/lib/safe-next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { GoogleSignInButton, authErrorMessage } from '@/components/auth/google-sign-in-button';
import {
  performVerificationResend,
  verificationResendLabel,
  type VerificationResendState,
} from '@/lib/verification-resend';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendState, setResendState] = useState<VerificationResendState>('idle');

  const needsVerification = !!error?.toLowerCase().includes('e-poçtunuzu təsdiqləyin');

  const handleResend = async () => {
    setResendState('sending');
    const nextState = await performVerificationResend({
      apiUrl: process.env.NEXT_PUBLIC_API_URL || '',
      path: '/auth/resend-verification',
      email,
    });
    setResendState(nextState);
  };

  useEffect(() => {
    if (searchParams.get('registered') === 'true') {
      setSuccess('Qeydiyyat uğurla başa çatdı! Zəhmət olmasa məlumatlarınızla daxil olun.');
    } else if (searchParams.get('reset') === 'true') {
      setSuccess('Şifrəniz uğurla yeniləndi. Zəhmət olmasa yeni şifrənizlə daxil olun.');
    }
    const authError = authErrorMessage(searchParams.get('error'));
    if (authError) setError(authError);
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    if (!email || !password) {
      setError('Zəhmət olmasa bütün xanaları doldurun.');
      setLoading(false);
      return;
    }

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(result.error);
      } else {
        router.push(safeNextPath(searchParams.get('next')));
      }
    } catch (err: any) {
      setError('Gözlənilməz xəta baş verdi. Zəhmət olmasa yenidən cəhd edin.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-card bg-background py-8 px-4 shadow-sm border border-neutral-dark/5 rounded-2xl sm:px-10">
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100 space-y-2" role="alert">
          <p>{error}</p>
          {needsVerification && (
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState === 'sending' || !email}
              className="font-medium text-red-800 underline hover:no-underline disabled:opacity-50"
            >
              {verificationResendLabel(resendState)}
            </button>
          )}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-lg bg-green-50 p-4 text-sm text-green-700 border border-green-100" role="alert">
          {success}
        </div>
      )}

      <form className="space-y-6" onSubmit={handleSubmit}>
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

        <div className="text-right">
          <Link href="/forgot-password" className="tap-inline text-sm font-medium text-accent hover:text-accent-hover transition-colors">
            Şifrəni unutmusunuz?
          </Link>
        </div>

        <div>
          <button
            type="submit"
            disabled={loading}
            className="flex w-full justify-center product-action rounded-full bg-primary py-2.5 px-4 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 transition-all"
          >
            {loading ? 'Daxil olunur...' : 'Daxil ol'}
          </button>
        </div>
      </form>

      <GoogleSignInButton callbackUrl={safeNextPath(searchParams.get('next'))} />
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="auth-scene flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8 bg-background-warm">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link href="/" className="tap flex justify-center">
          <BrandWordmark className="text-3xl" />
        </Link>
        <h1 className="mt-6 text-center font-serif text-2xl font-semibold tracking-tight text-neutral-dark">
          Hesabınıza daxil olun
        </h1>
        <p className="mt-2 text-center text-sm text-neutral-dark/80">
          Və ya{' '}
          <Link href="/register" className="tap-inline font-medium text-accent hover:text-accent-hover transition-colors">
            yeni hesab yaradın
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <Suspense fallback={
          <div className="auth-card bg-background py-8 px-4 shadow-sm border border-neutral-dark/5 rounded-2xl sm:px-10 text-center text-sm text-neutral-dark/65">
            Giriş forması yüklənir...
          </div>
        }>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
