'use client';

import React, { useEffect, useState } from 'react';

export default function BusinessCompanyPage() {
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/business/company')
      .then(res => res.json())
      .then(data => {
        setCompany(data);
        setLoading(false);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/business/company', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(company)
    });
    setSaving(false);
    alert('Məlumatlar yeniləndi.');
  };

  if (loading) return <div>Yüklənir...</div>;

  return (
    <div className="max-w-3xl space-y-6 animate-in fade-in duration-500 pb-10">
      <h1 className="font-serif text-3xl font-bold text-neutral-dark">Şirkət profili</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 p-6 shadow-xs space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-dark mb-1">Şirkət adı</label>
            <input type="text" value={company.name || ''} onChange={e => setCompany({...company, name: e.target.value})} className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-dark mb-1">Haqqında</label>
            <textarea value={company.about || ''} onChange={e => setCompany({...company, about: e.target.value})} rows={4} className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-dark mb-1">Vebsayt</label>
            <input type="text" value={company.website || ''} onChange={e => setCompany({...company, website: e.target.value})} className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-sm" />
          </div>
          <button type="submit" disabled={saving} className="product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50">
            {saving ? 'Yadda saxlanılır...' : 'Yadda saxla'}
          </button>
        </div>
      </form>
    </div>
  );
}
