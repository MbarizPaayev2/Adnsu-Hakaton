'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { HeartHandshake, MapPin } from 'lucide-react';

interface VolunteerOpportunity {
  id: string;
  title: string;
  description: string;
  location: string | null;
  createdAt: string;
  company: { name: string; logo: string | null };
}

export default function VolunteeringPage() {
  const [opportunities, setOpportunities] = useState<VolunteerOpportunity[]>([]);
  const [optIn, setOptIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [oppsRes, profileRes] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_API_URL}/volunteer-opportunities`),
          apiFetch('/profile'),
        ]);

        if (oppsRes.ok) setOpportunities(await oppsRes.json());
        if (profileRes.ok) {
          const profile = await profileRes.json();
          setOptIn(!!profile.volunteerOpportunitiesOptIn);
        }
      } catch (err: any) {
        setError('Fürsətlər yüklənərkən xəta baş verdi.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleToggle = async () => {
    setToggleLoading(true);
    const next = !optIn;
    try {
      const res = await apiFetch('/profile/volunteer-opt-in', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) setOptIn(next);
    } finally {
      setToggleLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-neutral-dark/65">Yüklənir...</p>
      </div>
    );
  }

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

      <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 p-6 shadow-xs flex items-center justify-between gap-4">
        <div>
          <h2 id="volunteer-alerts-label" className="font-semibold text-neutral-dark">Yeni fürsətlər üçün bildiriş al</h2>
          <p className="text-xs text-neutral-dark/65 mt-1">Yeni könüllülük fürsəti yerləşdirildikdə tətbiqdaxili bildiriş alacaqsınız. Planınızdan asılı olmayaraq ödənişsizdir.</p>
        </div>
        <button
          onClick={handleToggle}
          disabled={toggleLoading}
          role="switch"
          aria-checked={optIn}
          aria-labelledby="volunteer-alerts-label"
          className={`shrink-0 relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${optIn ? 'bg-primary' : 'bg-neutral-dark/20'}`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${optIn ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 shadow-xs overflow-hidden">
        {opportunities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <HeartHandshake className="h-10 w-10 text-neutral-dark/20 mb-3" />
            <p className="text-neutral-dark/65 text-sm">Hazırda aktiv könüllülük fürsəti yoxdur.</p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-dark/5">
            {opportunities.map((o) => (
              <div key={o.id} className="p-6 space-y-2">
                <h3 className="font-semibold text-neutral-dark">{o.title}</h3>
                <p className="text-xs text-neutral-dark/60">{o.company.name}</p>
                {o.location && (
                  <p className="text-xs text-neutral-dark/60 flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {o.location}
                  </p>
                )}
                <p className="text-sm text-neutral-dark/75 mt-2 whitespace-pre-line">{o.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
