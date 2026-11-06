'use client';

import { BrandWordmark } from '@/components/landing/brand-logo';
import React, { useCallback, useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { verifyEmailOnce } from '@/lib/verify-once';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);

  const run = useCallback(() => {
    if (!token) {
      setStatus('error');
      setMessage('Təsdiq linki yanlışdır.');
      setRetryable(false);
      return;
    }

    let cancelled = false;
    setStatus('verifying');
    setRetryable(false);
    verifyEmailOnce(token, () =>
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
    ).then((result) => {
      if (cancelled) return;
      setStatus(result.status);
      setMessage(result.message);
      setRetryable(result.retryable);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    return run() ?? undefined;
  }, [run]);

  return (
    <div className="auth-card bg-background py-8 px-4 shadow-sm border border-neutral-dark/5 rounded-2xl sm:px-10 text-center space-y-4">
      {status === 'verifying' && (
        <p className="text-sm text-neutral-dark/80">Yoxlanılır...</p>
      )}

      {status === 'success' && (
        <div className="rounded-lg bg-green-50 p-4 text-sm text-green-700 border border-green-100">
          {message}
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100">
          {message}
        </div>
      )}

      {retryable && (
        <button
          type="button"
          onClick={() => run()}
          className="inline-block text-sm font-medium text-accent hover:text-accent-hover transition-colors"
        >
          Yenidən cəhd et
        </button>
      )}

      <Link href="/login" className="inline-block text-sm font-medium text-accent hover:text-accent-hover transition-colors">
        Daxil olma səhifəsinə qayıt
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="auth-scene flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8 bg-background-warm">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link href="/" className="tap flex justify-center">
          <BrandWordmark className="text-3xl" />
        </Link>
        <h1 className="mt-6 text-center font-serif text-2xl font-semibold tracking-tight text-neutral-dark">
          E-poçt təsdiqi
        </h1>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <Suspense fallback={
          <div className="auth-card bg-background py-8 px-4 shadow-sm border border-neutral-dark/5 rounded-2xl sm:px-10 text-center text-sm text-neutral-dark/65">
            Yüklənir...
          </div>
        }>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </div>
  );
}
