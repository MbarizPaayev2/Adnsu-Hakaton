'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  Bookmark, Bell, Trash2, Pause, Play, ExternalLink, 
  ArrowRight, Search, Clock, MapPin, Briefcase, AlertCircle
} from 'lucide-react';
import { useRetention, LoadingBlock, UnavailableBlock, ErrorBlock, FixtureNotice } from '@/components/retention/shared';
import type { AlertFrequency, SavedJob, SavedSearch } from '@/lib/retention/contract';
import { catalogueQuery } from '@/lib/job-catalogue';

export default function SavedItemsPage() {
  const [activeTab, setActiveTab] = useState<'jobs' | 'searches'>('jobs');
  const [editingSearchId, setEditingSearchId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFreq, setEditFreq] = useState<AlertFrequency>('daily');
  const [actionError, setActionError] = useState<string | null>(null);

  const { state, setState, reload } = useRetention(async (api) => {
    const [savedJobs, savedSearches] = await Promise.all([
      api.listSavedJobs(),
      api.listSearches(),
    ]);
    return { savedJobs, savedSearches, api };
  });

  if (state.status === 'loading') {
    return <LoadingBlock label="Saxlanan məlumatlar yüklənir..." />;
  }

  if (state.status === 'unavailable') {
    return (
      <UnavailableBlock
        title="Saxlanan elanlar və axtarışlar"
        alt={{ href: '/jobs', label: 'Vakansiyalara bax' }}
      />
    );
  }

  if (state.status === 'error') {
    return <ErrorBlock onRetry={reload} text={state.message ?? 'Saxlanan məlumatları yükləmək mümkün olmadı.'} />;
  }

  const { savedJobs, savedSearches, api } = state.data;

  // Unsave job action with optimistic update & rollback
  const handleUnsaveJob = async (key: string) => {
    setActionError(null);
    const prev = [...savedJobs];
    setState({
      ...state,
      data: {
        ...state.data,
        savedJobs: savedJobs.filter((j) => j.key !== key),
      },
    });

    try {
      await api.unsaveJob(key);
    } catch {
      setActionError('Elanı silmək mümkün olmadı. Əvvəlki vəziyyət bərpa edildi.');
      setState({
        ...state,
        data: {
          ...state.data,
          savedJobs: prev,
        },
      });
    }
  };

  // Toggle pause/resume search
  const handleToggleSearchPause = async (search: SavedSearch) => {
    setActionError(null);
    const nextPaused = !search.paused;
    const prev = [...savedSearches];
    setState({
      ...state,
      data: {
        ...state.data,
        savedSearches: savedSearches.map((s) => (s.id === search.id ? { ...s, paused: nextPaused } : s)),
      },
    });

    try {
      await api.updateSearch(search.id, { paused: nextPaused });
    } catch {
      setActionError('Axtarış vəziyyətini dəyişmək mümkün olmadı.');
      setState({
        ...state,
        data: {
          ...state.data,
          savedSearches: prev,
        },
      });
    }
  };

  // Delete search
  const handleDeleteSearch = async (id: string) => {
    setActionError(null);
    const prev = [...savedSearches];
    setState({
      ...state,
      data: {
        ...state.data,
        savedSearches: savedSearches.filter((s) => s.id !== id),
      },
    });

    try {
      await api.deleteSearch(id);
    } catch {
      setActionError('Axtarışı silmək mümkün olmadı.');
      setState({
        ...state,
        data: {
          ...state.data,
          savedSearches: prev,
        },
      });
    }
  };

  // Save edit search
  const handleSaveSearchEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSearchId) return;

    setActionError(null);
    const target = savedSearches.find((s) => s.id === editingSearchId);
    if (!target) return;

    const prev = [...savedSearches];
    setState({
      ...state,
      data: {
        ...state.data,
        savedSearches: savedSearches.map((s) =>
          s.id === editingSearchId ? { ...s, name: editName.trim(), ...(api.capabilities.perSearchFrequency ? { frequency: editFreq } : {}) } : s
        ),
      },
    });
    setEditingSearchId(null);

    try {
      await api.updateSearch(editingSearchId, {
        name: editName.trim(),
        ...(api.capabilities.perSearchFrequency ? { frequency: editFreq } : {}),
      });
    } catch {
      setActionError('Axtarışı yeniləmək mümkün olmadı.');
      setState({
        ...state,
        data: {
          ...state.data,
          savedSearches: prev,
        },
      });
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">
      <div>
        <h1 className="font-serif text-3xl md:text-4xl font-bold text-neutral-dark">
          Saxlanılanlar
        </h1>
        <p className="mt-2 text-sm md:text-base text-neutral-dark/70">
          Maraqlandığınız vakansiyalar və bildiriş qurduğunuz axtarışlar
        </p>
      </div>

      <FixtureNotice mode={state.mode} />

      {actionError && (
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 p-4 text-xs text-red-800 border border-red-200">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-outline-variant gap-4" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'jobs'}
          onClick={() => setActiveTab('jobs')}
          className={`flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden ${
            activeTab === 'jobs'
              ? 'border-primary text-primary'
              : 'border-transparent text-on-surface-variant hover:text-on-background'
          }`}
        >
          <Bookmark className="h-4 w-4" aria-hidden="true" />
          <span>Saxlanan elanlar</span>
          <span className="rounded-full bg-surface-container px-2 py-0.5 text-xs">
            {savedJobs.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'searches'}
          onClick={() => setActiveTab('searches')}
          className={`flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden ${
            activeTab === 'searches'
              ? 'border-primary text-primary'
              : 'border-transparent text-on-surface-variant hover:text-on-background'
          }`}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          <span>Saxlanan axtarışlar</span>
          <span className="rounded-full bg-surface-container px-2 py-0.5 text-xs">
            {savedSearches.length}
          </span>
        </button>
      </div>

      {/* Tab 1: Saved Jobs */}
      {activeTab === 'jobs' && (
        <div className="space-y-4">
          {savedJobs.length === 0 ? (
            <div className="product-card text-center py-16 bg-background rounded-2xl border border-neutral-dark/5 shadow-xs px-4">
              <Bookmark className="mx-auto h-12 w-12 text-neutral-dark/30 mb-2" aria-hidden="true" />
              <p className="text-sm font-semibold text-neutral-dark">Hələ saxlanmış elan yoxdur.</p>
              <p className="text-xs text-neutral-dark/65 mt-1">
                Kataloqda bəyəndiyiniz elanları &ldquo;Saxla&rdquo; düyməsi ilə bura əlavə edə bilərsiniz.
              </p>
              <Link
                href="/jobs"
                className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 product-action rounded-full bg-primary px-6 text-xs font-semibold text-white hover:bg-primary-hover transition-colors"
              >
                Vakansiyalara bax <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Saxlanan vakansiyalar">
              {savedJobs.map((job) => {
                const [kind, id] = job.key.split(':');
                const detailHref = `/jobs/${kind}/${encodeURIComponent(id)}`;

                return (
                  <li
                    key={job.key}
                    className="product-card rounded-2xl bg-surface border border-outline-variant p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={detailHref}
                          className="tap-inline max-w-full font-bold text-base text-on-background hover:text-accent transition-colors truncate"
                        >
                          {job.title}
                        </Link>
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium border ${
                            job.open
                              ? 'bg-green-50 text-green-800 border-green-200'
                              : 'bg-neutral-50 text-neutral-800 border-neutral-200'
                          }`}
                        >
                          {job.open ? 'Aktiv elan' : 'Müddəti bitib'}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-on-surface-variant flex-wrap">
                        <span className="flex items-center gap-1">
                          <Briefcase className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{job.company}</span>
                        </span>
                        {job.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{job.location}</span>
                          </span>
                        )}
                        {job.deadline && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>Son tarix: {new Date(job.deadline).toLocaleDateString('az-AZ')}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      {job.open && (
                        <Link
                          href={`/dashboard/resumes?create=${encodeURIComponent(job.key)}`}
                          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 text-xs font-semibold text-white"
                        >
                          Sənəd hazırla
                        </Link>
                      )}
                      <Link
                        href={detailHref}
                        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-background border border-outline-variant px-4 text-xs font-semibold text-on-background hover:bg-surface-container transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                      >
                        Ətraflı
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleUnsaveJob(job.key)}
                        aria-label={`Saxlananlardan sil: ${job.title}`}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-outline-variant bg-surface text-on-surface-variant hover:text-red-700 hover:bg-red-50 hover:border-red-200 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Tab 2: Saved Searches */}
      {activeTab === 'searches' && (
        <div className="space-y-4">
          {savedSearches.length === 0 ? (
            <div className="product-card text-center py-16 bg-background rounded-2xl border border-neutral-dark/5 shadow-xs px-4">
              <Bell className="mx-auto h-12 w-12 text-neutral-dark/30 mb-2" aria-hidden="true" />
              <p className="text-sm font-semibold text-neutral-dark">Hələ saxlanmış axtarış yoxdur.</p>
              <p className="text-xs text-neutral-dark/65 mt-1">
                Kataloqda süzgəcləri tətbiq edərək &ldquo;Axtarışı saxla&rdquo; düyməsi ilə bildiriş qura bilərsiniz.
              </p>
              <Link
                href="/jobs"
                className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 product-action rounded-full bg-primary px-6 text-xs font-semibold text-white hover:bg-primary-hover transition-colors"
              >
                Axtarışa başla <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Saxlanan axtarışlar">
              {savedSearches.map((s) => {
                const searchUrl = `/jobs?${catalogueQuery({
                  q: s.criteria.q,
                  location: s.criteria.location,
                  category: s.criteria.category,
                  source: s.criteria.source,
                  work: s.criteria.work,
                  experience: s.criteria.experience,
                  company: s.criteria.company,
                })}`;

                const freqLabel =
                  s.frequency === 'instant' ? 'Dərhal' : s.frequency === 'daily' ? 'Gündəlik' : 'Həftəlik';

                return (
                  <li
                    key={s.id}
                    className="product-card rounded-2xl bg-surface border border-outline-variant p-5 shadow-xs space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="font-bold text-base text-on-background">{s.name}</h2>
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium border ${
                              s.paused
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-green-50 text-green-800 border-green-200'
                            }`}
                          >
                            {s.paused ? 'Dayandırılıb' : 'Aktiv bildiriş'}
                          </span>
                        </div>
                        <p className="text-xs text-on-surface-variant mt-1">
                          Tezlik: <strong>{freqLabel}</strong> · Son yenilənmə: {new Date(s.updatedAt).toLocaleDateString('az-AZ')}
                          {s.newSinceLastVisit !== null && s.newSinceLastVisit > 0 && (
                            <span className="ml-2 font-bold text-accent">({s.newSinceLastVisit} yeni elan)</span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap self-end sm:self-center">
                        <Link
                          href={searchUrl}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-background border border-outline-variant px-4 text-xs font-semibold text-on-background hover:bg-surface-container transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                        >
                          <Search className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Vakansiyalara bax</span>
                        </Link>

                        <button
                          type="button"
                          onClick={() => {
                            setEditingSearchId(s.id);
                            setEditName(s.name);
                            setEditFreq(s.frequency);
                          }}
                          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-outline-variant px-3 text-xs font-semibold text-on-background hover:bg-surface-container transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                        >
                          Dəyiş
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleSearchPause(s)}
                          aria-label={s.paused ? 'Bildirişləri bərpa et' : 'Bildirişləri dayandır'}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-outline-variant text-on-surface-variant hover:bg-surface-container transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                        >
                          {s.paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteSearch(s.id)}
                          aria-label={`Axtarışı sil: ${s.name}`}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-outline-variant text-on-surface-variant hover:text-red-700 hover:bg-red-50 hover:border-red-200 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {/* Criteria Chips */}
                    <div className="flex flex-wrap gap-1.5 pt-2 border-t border-outline-variant/40">
                      {s.criteria.q && <span className="rounded-full bg-surface-container px-2.5 py-0.5 text-[11px]">Söz: “{s.criteria.q}”</span>}
                      {s.criteria.category && s.criteria.category !== 'all' && <span className="rounded-full bg-surface-container px-2.5 py-0.5 text-[11px]">Kateqoriya: {s.criteria.category}</span>}
                      {s.criteria.location && <span className="rounded-full bg-surface-container px-2.5 py-0.5 text-[11px]">Şəhər: {s.criteria.location}</span>}
                      {s.criteria.company && <span className="rounded-full bg-surface-container px-2.5 py-0.5 text-[11px]">Şirkət: {s.criteria.company}</span>}
                      {s.criteria.work && s.criteria.work !== 'all' && <span className="rounded-full bg-surface-container px-2.5 py-0.5 text-[11px]">Format: {s.criteria.work}</span>}
                    </div>

                    {/* Inline Edit Form */}
                    {editingSearchId === s.id && (
                      <form onSubmit={handleSaveSearchEdit} className="mt-3 p-4 rounded-xl border border-primary/20 bg-background-warm/30 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label htmlFor={`edit-name-${s.id}`} className="block text-xs font-semibold text-on-background mb-1">
                              Axtarışın adı
                            </label>
                            <input
                              id={`edit-name-${s.id}`}
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="block w-full min-h-11 rounded-xl border border-outline-variant bg-surface px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                              required
                            />
                          </div>
                          {api.capabilities.perSearchFrequency ? (
                          <div>
                            <label htmlFor={`edit-freq-${s.id}`} className="block text-xs font-semibold text-on-background mb-1">
                              Tezlik
                            </label>
                            <select
                              id={`edit-freq-${s.id}`}
                              value={editFreq}
                              onChange={(e) => setEditFreq(e.target.value as AlertFrequency)}
                              className="block w-full min-h-11 rounded-xl border border-outline-variant bg-surface px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                            >
                              <option value="daily">Gündəlik xülasə</option>
                              <option value="weekly">Həftəlik xülasə</option>
                              <option value="instant">Hər yeni elanda dərhal</option>
                            </select>
                          </div>
                          ) : (
                            <p className="self-end text-xs text-on-surface-variant">Tezlik bildiriş parametrlərində seçilir.</p>
                          )}
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingSearchId(null)}
                            className="inline-flex min-h-11 items-center px-4 rounded-full border border-outline-variant text-xs font-semibold"
                          >
                            Ləğv et
                          </button>
                          <button
                            type="submit"
                            className="inline-flex min-h-11 items-center px-5 rounded-full bg-primary text-white text-xs font-bold"
                          >
                            Yadda saxla
                          </button>
                        </div>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
