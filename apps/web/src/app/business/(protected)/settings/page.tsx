'use client';

import React, { useState } from 'react';

export default function BusinessSettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    setError('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Zəhmət olmasa bütün xanaları doldurun.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Yeni şifrələr eyni deyil.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Yeni şifrə ən azı 8 simvoldan ibarət olmalıdır.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/business/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || 'Şifrə yenilənə bilmədi.');
      }

      setMsg(data.message || 'Şifrə uğurla yeniləndi.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.message || 'Xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6 animate-in fade-in duration-500">
      <h1 className="font-serif text-3xl font-bold text-neutral-dark">Parametrlər</h1>
      <form onSubmit={handleSubmit} className="product-card rounded-2xl bg-background border border-neutral-dark/5 p-6 shadow-xs space-y-4">
        <h2 className="font-serif text-xl font-bold text-neutral-dark">Şifrəni dəyiş</h2>
        {msg && <p className="text-sm text-green-700 font-medium">{msg}</p>}
        {error && <p className="text-sm text-red-700 font-medium">{error}</p>}
        <div>
          <label className="block text-sm font-medium text-neutral-dark mb-1">Cari şifrə</label>
          <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-dark mb-1">Yeni şifrə</label>
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-dark mb-1">Yeni şifrəni təsdiqlə</label>
          <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-sm" />
        </div>
        <button type="submit" disabled={loading} className="product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50">
          {loading ? 'Yenilənir...' : 'Yadda saxla'}
        </button>
      </form>
    </div>
  );
}
