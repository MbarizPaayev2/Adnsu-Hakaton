'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Monitor } from 'lucide-react';
import { AdminHeader, ROLE_LABELS, useAdminMe } from '@/components/admin-header';

interface AdminSessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  expires: string;
  userAgent: string | null;
  mfaVerified: boolean;
  current: boolean;
}

const INPUT = 'block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-sm text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent';
const CARD = 'rounded-2xl bg-background border border-neutral-dark/5 shadow-xs p-6 space-y-4';
const BUTTON = 'product-action rounded-full bg-primary py-2.5 px-4 text-sm font-semibold text-white disabled:opacity-50';

async function call(path: string, method = 'POST', body?: unknown) {
  const res = await fetch(`/api/admin/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message || 'Xəta baş verdi.');
  return data;
}

const when = (value: string | null) => (value ? new Date(value).toLocaleString('az-AZ') : '—');

export default function AdminAccountPage() {
  const me = useAdminMe();
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<AdminSessionRow[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const [pw, setPw] = useState({ current: '', next: '', repeat: '', code: '' });
  const [enrol, setEnrol] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [enrolCode, setEnrolCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [regenCode, setRegenCode] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSessions = useCallback(() => {
    call('account/sessions', 'GET').then(setSessions).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (me) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMfaEnabled(me.mfaEnabled);
      loadSessions();
    }
  }, [me, loadSessions]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Xəta baş verdi.');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.repeat) return setError('Yeni şifrələr uyğun gəlmir');
    run(async () => {
      await call('account/password', 'POST', { currentPassword: pw.current, newPassword: pw.next, ...(mfaEnabled ? { code: pw.code } : {}) });
      setPw({ current: '', next: '', repeat: '', code: '' });
      setNotice('Şifrə dəyişdirildi. Digər bütün sessiyalar bağlandı.');
      loadSessions();
    });
  };

  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />
      <main className="flex-1 p-6 md:p-10 w-full max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="font-serif text-2xl font-bold text-neutral-dark">Hesabım</h1>
          {me && <p className="text-sm text-neutral-dark/65 mt-1">{me.email} · {ROLE_LABELS[me.role]}</p>}
        </div>
        {notice && <p role="status" className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">{notice}</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</p>}

        <section className={CARD} aria-labelledby="mfa-title">
          <h2 id="mfa-title" className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
            {mfaEnabled ? <ShieldCheck className="h-5 w-5 text-green-600" aria-hidden="true" /> : <ShieldAlert className="h-5 w-5 text-amber-600" aria-hidden="true" />}
            İki mərhələli təsdiq
          </h2>
          {recoveryCodes && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2">
              <p className="text-sm font-semibold text-amber-900">Bərpa kodları — yalnız indi göstərilir. Təhlükəsiz yerdə saxlayın; hər biri bir dəfə işləyir.</p>
              <ul aria-label="Bərpa kodları" className="grid grid-cols-2 gap-1 font-mono text-sm">
                {recoveryCodes.map((c) => <li key={c}>{c}</li>)}
              </ul>
              <button className="text-sm underline" onClick={() => setRecoveryCodes(null)}>Saxladım, gizlət</button>
            </div>
          )}
          {mfaEnabled ? (
            <>
              <p className="text-sm text-neutral-dark/75">Aktivdir. Girişdə şifrədən sonra autentifikator kodu tələb olunur.</p>
              <form className="flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await call('account/mfa/recovery-codes', 'POST', { code: regenCode }); setRecoveryCodes(r.recoveryCodes); setRegenCode(''); }); }}>
                <div>
                  <label htmlFor="regen-code" className="block text-xs font-semibold text-neutral-dark/80 mb-1">Cari kod</label>
                  <input id="regen-code" value={regenCode} onChange={(e) => setRegenCode(e.target.value)} className={INPUT} autoComplete="one-time-code" required />
                </div>
                <button disabled={busy} className={BUTTON}>Yeni bərpa kodları yarat</button>
              </form>
            </>
          ) : enrol ? (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await call('account/mfa/enable', 'POST', { code: enrolCode }); setRecoveryCodes(r.recoveryCodes); setMfaEnabled(true); setEnrol(null); setEnrolCode(''); setNotice('İki mərhələli təsdiq aktivləşdirildi. Digər sessiyalar bağlandı.'); loadSessions(); }); }}>
              <p className="text-sm text-neutral-dark/75">Autentifikator tətbiqinə (Google Authenticator, 1Password, Microsoft Authenticator və s.) bu açarı əlavə edin:</p>
              <p className="font-mono text-sm break-all rounded-lg bg-neutral-dark/5 p-3" aria-label="Açar">{enrol.secret.match(/.{1,4}/g)?.join(' ')}</p>
              <a href={enrol.otpauthUri} className="text-sm text-primary underline">Bu cihazdakı tətbiqdə aç</a>
              <div>
                <label htmlFor="enrol-code" className="block text-xs font-semibold text-neutral-dark/80 mb-1">Tətbiqdəki 6 rəqəmli kod</label>
                <input id="enrol-code" value={enrolCode} onChange={(e) => setEnrolCode(e.target.value)} className={INPUT} inputMode="numeric" autoComplete="one-time-code" required />
              </div>
              <button disabled={busy} className={BUTTON}>Təsdiqlə və aktivləşdir</button>
            </form>
          ) : (
            <>
              <p className="text-sm text-neutral-dark/75">
                Aktiv deyil.{me?.role === 'SUPER_ADMIN' ? ' Operatorları idarə etmək, hesab silmək və sistem əməliyyatları üçün tələb olunur.' : ''}
              </p>
              <button disabled={busy} className={BUTTON} onClick={() => run(async () => setEnrol(await call('account/mfa/setup')))}>Quraşdırmağa başla</button>
            </>
          )}
        </section>

        <section className={CARD} aria-labelledby="pw-title">
          <h2 id="pw-title" className="font-serif text-lg font-bold text-neutral-dark">Şifrəni dəyiş</h2>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={changePassword}>
            <div className="sm:col-span-2">
              <label htmlFor="pw-current" className="block text-xs font-semibold text-neutral-dark/80 mb-1">Cari şifrə</label>
              <input id="pw-current" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} className={INPUT} autoComplete="current-password" required />
            </div>
            <div>
              <label htmlFor="pw-next" className="block text-xs font-semibold text-neutral-dark/80 mb-1">Yeni şifrə (ən azı 12 simvol)</label>
              <input id="pw-next" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className={INPUT} autoComplete="new-password" minLength={12} required />
            </div>
            <div>
              <label htmlFor="pw-repeat" className="block text-xs font-semibold text-neutral-dark/80 mb-1">Yeni şifrəni təkrarlayın</label>
              <input id="pw-repeat" type="password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} className={INPUT} autoComplete="new-password" minLength={12} required />
            </div>
            {mfaEnabled && (
              <div>
                <label htmlFor="pw-code" className="block text-xs font-semibold text-neutral-dark/80 mb-1">Autentifikator kodu</label>
                <input id="pw-code" value={pw.code} onChange={(e) => setPw({ ...pw, code: e.target.value })} className={INPUT} autoComplete="one-time-code" required />
              </div>
            )}
            <div className="sm:col-span-2">
              <button disabled={busy} className={BUTTON}>Şifrəni dəyiş</button>
              <p className="mt-2 text-xs text-neutral-dark/60">Dəyişiklikdən sonra bu sessiyadan başqa bütün sessiyalar bağlanır.</p>
            </div>
          </form>
        </section>

        <section className={CARD} aria-labelledby="sessions-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="sessions-title" className="font-serif text-lg font-bold text-neutral-dark">Aktiv sessiyalar</h2>
            <button disabled={busy || sessions.length < 2} className="tap -my-1 rounded-lg px-3 text-sm font-semibold text-red-700 disabled:opacity-40" onClick={() => run(async () => { const r = await call('account/sessions/revoke-others'); setNotice(`${r.revoked} sessiya bağlandı.`); loadSessions(); })}>
              Digərlərini bağla
            </button>
          </div>
          <ul className="divide-y divide-neutral-dark/5">
            {sessions.map((s) => (
              <li key={s.id} className="py-3 flex items-start justify-between gap-3 text-sm">
                <div className="flex gap-2">
                  <Monitor className="h-4 w-4 mt-0.5 text-neutral-dark/50" aria-hidden="true" />
                  <div>
                    <p className="text-neutral-dark">{s.userAgent?.slice(0, 80) || 'Naməlum cihaz'}{s.current ? ' (bu sessiya)' : ''}</p>
                    <p className="text-xs text-neutral-dark/60">Başlayıb: {when(s.createdAt)} · Son fəaliyyət: {when(s.lastSeenAt)} · {s.mfaVerified ? 'iki mərhələli' : 'yalnız şifrə'}</p>
                  </div>
                </div>
                {!s.current && (
                  <button className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold hover:bg-neutral-dark/5 text-red-700 transition-colors border border-red-200" onClick={() => run(async () => { await call(`account/sessions/${s.id}`, 'DELETE'); loadSessions(); })}>Bağla</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
