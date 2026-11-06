'use client';

import React, { useEffect, useState } from 'react';
import { HeartHandshake, Plus, Pause, Play } from 'lucide-react';

interface VolunteerOpportunity {
  id: string;
  title: string;
  description: string;
  location: string | null;
  status: 'ACTIVE' | 'CLOSED';
  createdAt: string;
}

export default function BusinessVolunteeringPage() {
  const [opportunities, setOpportunities] = useState<VolunteerOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');

  const fetchOpportunities = async () => {
    try {
      const res = await fetch('/api/business/volunteer-opportunities');
      if (!res.ok) throw new Error('Fürsətlər yüklənə bilmədi');
      setOpportunities(await res.json());
    } catch (err: any) {
      setError(err.message || 'Fürsətlər yüklənərkən xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOpportunities();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!title.trim() || !description.trim()) {
      setError('Zəhmət olmasa başlıq və təsviri doldurun.');
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch('/api/business/volunteer-opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, location: location || undefined }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Fürsət yaradıla bilmədi.');

      setSuccess('Könüllülük fürsəti uğurla yaradıldı və maraqlanan istifadəçilərə bildiriş göndərildi.');
      setTitle('');
      setDescription('');
      setLocation('');
      await fetchOpportunities();
    } catch (err: any) {
      setError(err.message || 'Xəta baş verdi.');
    } finally {
      setActionLoading(false);
    }
  };

  const toggleStatus = async (opportunity: VolunteerOpportunity) => {
    setActionLoading(true);
    try {
      const newStatus = opportunity.status === 'ACTIVE' ? 'CLOSED' : 'ACTIVE';
      const res = await fetch(`/api/business/volunteer-opportunities/${opportunity.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setOpportunities(opportunities.map((o) => (o.id === opportunity.id ? { ...o, status: newStatus } : o)));
      }
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div>Yüklənir...</div>;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">
      <div>
        <h1 className="font-serif text-3xl font-bold text-neutral-dark flex items-center gap-2">
          <HeartHandshake className="h-7 w-7 text-accent" /> Gənclər üçün könüllülük
        </h1>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100" role="alert">{error}</div>
      )}
      {success && (
        <div className="rounded-lg bg-green-50 p-4 text-sm text-green-700 border border-green-100" role="alert">{success}</div>
      )}

      <form onSubmit={handleSubmit} className="product-card rounded-2xl bg-background border border-neutral-dark/5 p-6 shadow-xs space-y-4">
        <h2 className="font-serif text-xl font-bold text-neutral-dark">Yeni fürsət yerləşdir</h2>
        <div>
          <label className="block text-sm font-medium text-neutral-dark mb-1">Başlıq *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-sm"
            placeholder="Məs: Sahil təmizliyi könüllüsü"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-dark mb-1">Təsvir *</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-sm"
            placeholder="Fürsət haqqında ətraflı məlumat verin"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-dark mb-1">Məkan</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-sm"
            placeholder="Məs: Bakı (könüllü olaraq)"
          />
        </div>
        <button
          type="submit"
          disabled={actionLoading}
          className="inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {actionLoading ? 'Yerləşdirilir...' : 'Fürsəti yerləşdir'}
        </button>
      </form>

      <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 shadow-xs overflow-hidden">
        {opportunities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <HeartHandshake className="h-10 w-10 text-neutral-dark/20 mb-3" />
            <p className="text-neutral-dark/65 text-sm">Hələ heç bir könüllülük fürsəti yerləşdirməmisiniz.</p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-dark/5">
            {opportunities.map((o) => (
              <div key={o.id} className="p-6 space-y-2">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-neutral-dark">{o.title}</h3>
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium border ${
                        o.status === 'ACTIVE' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-neutral-50 text-neutral-700 border-neutral-200'
                      }`}>
                        {o.status === 'ACTIVE' ? 'Aktiv' : 'Bağlı'}
                      </span>
                    </div>
                    {o.location && <p className="text-xs text-neutral-dark/60 mt-0.5">{o.location}</p>}
                    <p className="text-sm text-neutral-dark/75 mt-2 whitespace-pre-line">{o.description}</p>
                  </div>
                  <button
                    onClick={() => toggleStatus(o)}
                    disabled={actionLoading}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-neutral-dark/20 py-2 px-3 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 disabled:opacity-50"
                  >
                    {o.status === 'ACTIVE' ? <><Pause className="h-3.5 w-3.5" /> Bağla</> : <><Play className="h-3.5 w-3.5" /> Aktivləşdir</>}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
