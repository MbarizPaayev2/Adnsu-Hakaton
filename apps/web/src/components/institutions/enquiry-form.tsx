'use client';

import React, { useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';

const FIELD = 'mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 px-3 py-2.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-primary';
const LABEL = 'block text-sm font-medium text-neutral-dark';

/** Pilot enquiry: stored and passed to the team, who reply in person. Nothing is bought and no student data is asked for. */
export function InstitutionEnquiryForm() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (sending.current) return;
    const f = new FormData(e.currentTarget);
    const size = Number(f.get('cohortSize'));
    const body = {
      organization: String(f.get('organization') ?? ''),
      contactName: String(f.get('contactName') ?? ''),
      role: String(f.get('role') ?? '') || undefined,
      email: String(f.get('email') ?? ''),
      phone: String(f.get('phone') ?? '') || undefined,
      cohortSize: Number.isInteger(size) && size > 0 ? size : undefined,
      timing: String(f.get('timing') ?? '') || undefined,
      message: String(f.get('message') ?? '') || undefined,
      consent: f.get('consent') === 'on',
      website: String(f.get('website') ?? '') || undefined,
    };
    sending.current = true;
    setState('sending');
    setError(null);
    try {
      const res = await apiFetch('/institutions/enquiries', { method: 'POST', body: JSON.stringify(body) });
      if (res.status === 429) throw new Error('Qısa müddətdə çox sorğu göndərildi. Bir az sonra yenidən cəhd edin və ya support@aisehr.com ünvanına yazın.');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(Array.isArray(data?.message) ? 'Formada düzəliş lazımdır: ad, e-poçt və razılıq sahələrini yoxlayın.' : 'Sorğu göndərilmədi. Yenidən cəhd edin və ya support@aisehr.com ünvanına yazın.');
      }
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sorğu göndərilmədi.');
      setState('idle');
    } finally {
      sending.current = false;
    }
  };

  if (state === 'sent') {
    return (
      <p role="status" className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-900" data-testid="enquiry-sent">
        Sorğunuz qəbul olundu. Komandamız sizə e-poçtla yazacaq. Bu, öhdəlik və ya ödəniş deyil.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby="enquiry-note" noValidate={false}>
      <p id="enquiry-note" className="text-xs text-neutral-dark/70">Tələbələrin şəxsi məlumatlarını burada göndərməyin. Yalnız sizinlə əlaqə üçün istifadə olunur.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="inst-org" className={LABEL}>Təşkilat *</label><input id="inst-org" name="organization" required minLength={2} maxLength={160} className={FIELD} autoComplete="organization" /></div>
        <div><label htmlFor="inst-name" className={LABEL}>Ad və soyad *</label><input id="inst-name" name="contactName" required minLength={2} maxLength={120} className={FIELD} autoComplete="name" /></div>
        <div><label htmlFor="inst-role" className={LABEL}>Vəzifə</label><input id="inst-role" name="role" maxLength={120} className={FIELD} autoComplete="organization-title" /></div>
        <div><label htmlFor="inst-email" className={LABEL}>E-poçt *</label><input id="inst-email" name="email" type="email" required maxLength={200} className={FIELD} autoComplete="email" /></div>
        <div><label htmlFor="inst-phone" className={LABEL}>Telefon</label><input id="inst-phone" name="phone" type="tel" maxLength={40} className={FIELD} autoComplete="tel" /></div>
        <div><label htmlFor="inst-size" className={LABEL}>Təxmini tələbə sayı</label><input id="inst-size" name="cohortSize" type="number" min={1} max={2000} inputMode="numeric" className={FIELD} /></div>
        <div className="sm:col-span-2">
          <label htmlFor="inst-timing" className={LABEL}>Nə vaxt başlamaq istərdiniz?</label>
          <select id="inst-timing" name="timing" className={FIELD} defaultValue="">
            <option value="">Seçin</option>
            <option value="this_month">Bu ay</option>
            <option value="next_month">Gələn ay</option>
            <option value="later">Daha sonra</option>
            <option value="exploring">Hələlik yalnız məlumat</option>
          </select>
        </div>
        <div className="sm:col-span-2"><label htmlFor="inst-msg" className={LABEL}>Qrupunuz və ehtiyacınız barədə qısa</label><textarea id="inst-msg" name="message" rows={4} maxLength={2000} className={FIELD} /></div>
      </div>
      <div aria-hidden="true" className="hidden"><label htmlFor="inst-web">Veb sayt</label><input id="inst-web" name="website" tabIndex={-1} autoComplete="off" /></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="consent" required className="mt-1" /> Bu sorğu ilə bağlı mənimlə əlaqə saxlanılmasına razıyam.</label>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button type="submit" disabled={state === 'sending'} className="min-h-11 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {state === 'sending' ? 'Göndərilir...' : 'Pilot üçün sorğu göndər'}
      </button>
    </form>
  );
}
