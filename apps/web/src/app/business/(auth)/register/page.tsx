'use client';

import { BrandWordmark } from '@/components/landing/brand-logo';
import React, { useState } from 'react';
import Link from 'next/link';
import {
  performVerificationResend,
  verificationResendLabel,
  type VerificationResendState,
} from '@/lib/verification-resend';

export default function BusinessRegisterPage() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('');
  const [location, setLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [size, setSize] = useState('1-10');
  const [about, setAbout] = useState('');

  const [registered, setRegistered] = useState(false);
  const [resendState, setResendState] = useState<VerificationResendState>('idle');

  const handleNextStep = () => {
    if (!email || !password || !confirmPassword) {
      setError('Zəhmət olmasa bütün xanaları doldurun.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Şifrələr uyğun gəlmir.');
      return;
    }
    if (password.length < 8) {
      setError('Şifrə minimum 8 simvol olmalıdır.');
      return;
    }
    setError(null);
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName) {
      setError('Şirkət adı mütləqdir.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const regRes = await fetch(`${apiUrl}/business/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          companyName,
          industry,
          location,
          website,
          size,
          about
        })
      });

      if (!regRes.ok) {
        const data = await regRes.json();
        throw new Error(data.message || 'Qeydiyyat zamanı xəta baş verdi.');
      }

      // Registration doesn't log the business in — it must verify its email
      // first (POST /business/auth/verify-email) before login will succeed.
      setRegistered(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendState('sending');
    const nextState = await performVerificationResend({
      apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
      path: '/business/auth/resend-verification',
      email,
    });
    setResendState(nextState);
  };

  if (registered) {
    return (
      <div className="auth-scene flex min-h-screen flex-col justify-center items-center py-12 sm:px-6 lg:px-8 bg-background-warm">
        <div className="auth-card bg-background py-8 px-4 shadow-sm border border-neutral-dark/5 rounded-2xl sm:px-10 text-center max-w-md w-full space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="mt-4 font-serif text-2xl font-bold text-neutral-dark">Qeydiyyat uğurludur!</h1>
          <p className="text-neutral-dark/80">
            <strong>{email}</strong> ünvanı üçün biznes hesabı yaradıldı. Təsdiq e-poçtunu yoxlayın; gəlməsə yenidən göndərə bilərsiniz. Daxil olmadan əvvəl e-poçtunuzu təsdiqləməlisiniz. Hesabınız təsdiqləndikdən sonra AISE komandası şirkətinizi nəzərdən keçirəcək.
          </p>
          <button
            onClick={handleResend}
            disabled={resendState === 'sending'}
            className="tap-inline text-sm font-medium text-accent hover:text-accent-hover transition-colors disabled:opacity-50"
          >
            {verificationResendLabel(resendState)}
          </button>
          <div>
            <Link href="/business/login" className="tap-inline text-sm font-medium text-accent hover:text-accent-hover transition-colors">
              Daxil olma səhifəsinə qayıt
            </Link>
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
          İşəgötürən hesabı yaradın
        </h1>
        <p className="mt-2 text-center text-sm text-neutral-dark/80">
          Artıq hesabınız var?{' '}
          <Link href="/business/login" className="tap-inline font-medium text-accent hover:text-accent-hover transition-colors">
            Daxil olun
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="auth-card bg-background py-8 px-4 shadow-sm border border-neutral-dark/5 rounded-2xl sm:px-10">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100">
              {error}
            </div>
          )}

          {step === 1 ? (
            <div className="space-y-6">
              <div>
                <label htmlFor="biz-reg-1" className="block text-sm font-medium text-neutral-dark">E-poçt ünvanı</label>
                <input
                  id="biz-reg-1"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                  required
                />
              </div>
              <div>
                <label htmlFor="biz-reg-2" className="block text-sm font-medium text-neutral-dark">Şifrə</label>
                <input
                  id="biz-reg-2"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                  required
                />
              </div>
              <div>
                <label htmlFor="biz-reg-3" className="block text-sm font-medium text-neutral-dark">Şifrəni təsdiqləyin</label>
                <input
                  id="biz-reg-3"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                  required
                />
              </div>
              <button
                type="button"
                onClick={handleNextStep}
                className="flex w-full justify-center product-action rounded-full bg-primary py-2.5 px-4 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover focus-visible:outline-hidden disabled:opacity-50 transition-all"
              >
                Növbəti
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="biz-reg-4" className="block text-sm font-medium text-neutral-dark">Şirkət adı *</label>
                <input
                  id="biz-reg-4"
                  type="text"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                  required
                />
              </div>
              <div>
                <label htmlFor="biz-reg-5" className="block text-sm font-medium text-neutral-dark">Sənaye</label>
                <input
                  id="biz-reg-5"
                  type="text"
                  value={industry}
                  onChange={e => setIndustry(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="biz-reg-6" className="block text-sm font-medium text-neutral-dark">Şəhər/Yer</label>
                  <input
                    id="biz-reg-6"
                    type="text"
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-dark">Şirkətin ölçüsü</label>
                  <select
                    value={size}
                    onChange={e => setSize(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                  >
                    <option value="1-10">1-10</option>
                    <option value="11-50">11-50</option>
                    <option value="51-200">51-200</option>
                    <option value="201-500">201-500</option>
                    <option value="500+">500+</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="biz-reg-7" className="block text-sm font-medium text-neutral-dark">Vebsayt</label>
                <input
                  id="biz-reg-7"
                  type="url"
                  value={website}
                  onChange={e => setWebsite(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-dark">Şirkət haqqında</label>
                <textarea
                  value={about}
                  onChange={e => setAbout(e.target.value)}
                  rows={3}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                />
              </div>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex w-full justify-center rounded-xl bg-background border border-neutral-dark/20 py-2.5 px-4 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all"
                >
                  Geri
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full justify-center product-action rounded-full bg-primary py-2.5 px-4 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50 transition-all"
                >
                  {loading ? 'Yaradılır...' : 'Qeydiyyatı Tamamla'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
