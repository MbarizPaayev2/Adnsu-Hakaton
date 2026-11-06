'use client';

import React, { useEffect, useState } from 'react';
import { Bell, Check, Loader2, X } from 'lucide-react';
import { loadRetentionApi, type RetentionApi } from '@/lib/retention/api';
import type { AlertFrequency, SearchCriteria } from '@/lib/retention/contract';

export interface SaveSearchButtonProps {
  criteria: SearchCriteria;
}

export function SaveSearchButton({ criteria }: SaveSearchButtonProps) {
  const [api, setApi] = useState<RetentionApi | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<AlertFrequency>('daily');
  const [busy, setBusy] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive default search name from active criteria
  const defaultName = [
    criteria.q ? `"${criteria.q}"` : '',
    criteria.category && criteria.category !== 'all' ? criteria.category : '',
    criteria.company ? criteria.company : '',
    criteria.location ? criteria.location : '',
  ]
    .filter(Boolean)
    .join(' · ') || 'Bütün vakansiyalar';

  useEffect(() => {
    let alive = true;
    loadRetentionApi()
      .then((a) => {
        if (alive && a.mode !== 'unavailable') {
          setApi(a);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // If feature is completely unavailable, do not render a non-functional button
  if (!api) return null;

  const handleOpen = () => {
    setName(defaultName);
    setError(null);
    setSavedSuccess(false);
    setIsOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setBusy(true);
    setError(null);

    try {
      await api.createSearch({
        name: name.trim(),
        criteria,
        frequency,
      });
      setSavedSuccess(true);
      setTimeout(() => {
        setIsOpen(false);
        setSavedSuccess(false);
      }, 1500);
    } catch (err: any) {
      setError(err?.message || 'Axtarışı saxlamaq mümkün olmadı. Yenidən cəhd edin.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-outline-variant bg-surface px-4 py-2 text-xs font-semibold text-on-background hover:bg-surface-container transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
        aria-label="Bu axtarışı yadda saxla və bildiriş qur"
      >
        <Bell className="h-4 w-4 text-on-surface-variant" aria-hidden="true" />
        <span>Axtarışı saxla</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-search-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-200"
        >
          <div className="w-full max-w-md rounded-2xl border border-outline-variant bg-surface p-6 shadow-xl animate-in zoom-in-95 duration-200 space-y-4">
            <div className="flex items-center justify-between border-b border-outline-variant/60 pb-3">
              <h2 id="save-search-title" className="text-lg font-bold text-on-background">
                Axtarışı yadda saxla
              </h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                aria-label="Bağla"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <p className="text-xs text-on-surface-variant">
              Bu kriteriyalara uyğun yeni elanlar çıxanda seçdiyiniz tezliklə bildiriş alacaqsınız.
            </p>

            {savedSuccess ? (
              <div role="status" className="flex items-center gap-2 rounded-xl bg-highlight/30 p-4 text-sm font-semibold text-primary">
                <Check className="h-5 w-5 text-primary" aria-hidden="true" />
                <span>Axtarış uğurla saxlanıldı!</span>
              </div>
            ) : (
              <form onSubmit={handleSave} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="save-search-name" className="block text-xs font-semibold text-on-background">
                    Axtarışın adı
                  </label>
                  <input
                    id="save-search-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                    required
                    className="block w-full min-h-11 rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-background focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                  />
                </div>

                {api.capabilities.perSearchFrequency ? (
                <div className="space-y-1.5">
                  <label htmlFor="save-search-frequency" className="block text-xs font-semibold text-on-background">
                    Bildiriş tezliyi
                  </label>
                  <select
                    id="save-search-frequency"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as AlertFrequency)}
                    className="block w-full min-h-11 rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-background focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                  >
                    <option value="daily">Gündəlik xülasə</option>
                    <option value="weekly">Həftəlik xülasə</option>
                    <option value="instant">Hər yeni elanda dərhal</option>
                  </select>
                </div>
                ) : (
                  <p className="rounded-xl bg-surface-container-low p-3 text-xs text-on-surface-variant">
                    Bildirişlər hesabınızın seçdiyi tezliklə gəlir (bildiriş parametrlərində dəyişə bilərsiniz). Yalnız yeni elanlar bildirilir.
                  </p>
                )}

                {error && (
                  <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200">
                    {error}
                  </p>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-outline-variant bg-surface px-4 text-xs font-semibold text-on-background hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                  >
                    Ləğv et
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !name.trim()}
                    className="inline-flex min-h-11 items-center justify-center product-action rounded-full bg-primary px-6 text-xs font-bold text-white hover:bg-primary-hover disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                  >
                    {busy ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        Saxlanılır...
                      </span>
                    ) : (
                      'Yadda saxla'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
