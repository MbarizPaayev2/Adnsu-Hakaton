'use client';

import React, { useId, useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, SlidersHorizontal, ChevronDown, RotateCcw } from 'lucide-react';
import { sourceLabel, UNKNOWN_LABEL } from '@/lib/job-catalogue';
import { formatNumber } from '@/lib/format';
import { experienceLevelLabel, workFormatLabel } from '@/lib/vacancy-labels';

export interface JobsFilterFormProps {
  filters: {
    q?: string;
    location?: string;
    category?: string;
    source?: string;
    company?: string;
    work?: string;
    experience?: string;
    sort?: string;
    application?: string;
  };
  categories: { key: string; label: string; count: number }[];
  sources: { source: string; count: number }[];
  companies: { company: string; count: number }[];
  workArrangements: { value: string; count: number }[];
  experienceLevels: { value: string; count: number }[];
  activeCount: number;
}

const control =
  'min-h-11 w-full max-w-full min-w-0 rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-background focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden';

export function JobsFilterForm({
  filters,
  categories,
  sources,
  companies,
  workArrangements,
  experienceLevels,
  activeCount,
}: JobsFilterFormProps) {
  const ids = {
    q: useId(),
    company: useId(),
    category: useId(),
    location: useId(),
    source: useId(),
    work: useId(),
    experience: useId(),
    sort: useId(),
    advancedPanel: useId(),
  };

  const hasAdvancedActive = Boolean(
    filters.location ||
      (filters.source && filters.source !== 'all') ||
      (filters.work && filters.work !== 'all') ||
      (filters.experience && filters.experience !== 'all') ||
      (filters.sort && filters.sort !== 'newest')
  );

  const advancedActiveCount =
    (filters.location ? 1 : 0) +
    (filters.source && filters.source !== 'all' ? 1 : 0) +
    (filters.work && filters.work !== 'all' ? 1 : 0) +
    (filters.experience && filters.experience !== 'all' ? 1 : 0) +
    (filters.sort && filters.sort !== 'newest' ? 1 : 0);

  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  useEffect(() => {
    // Auto-open on desktop/tablet if an advanced filter is active.
    // Stays collapsed on phones (< 640px) to keep the catalogue directly accessible.
    if (hasAdvancedActive && typeof window !== 'undefined' && window.innerWidth >= 640) {
      setIsAdvancedOpen(true);
    }
  }, [hasAdvancedActive]);

  return (
    <form
      action="/jobs"
      method="get"
      className="mb-6 rounded-2xl border border-outline-variant bg-surface-container-low p-4 sm:p-5 min-w-0 space-y-4"
    >
      {filters.application === 'email' && <input type="hidden" name="application" value="email" />}
      {/* Primary Row: Search -> Company -> Category */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
        <div className="min-w-0 space-y-1.5">
          <label htmlFor={ids.q} className="block min-w-0 text-sm font-medium text-on-background">
            Vəzifə və ya şirkət
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
            />
            <input
              id={ids.q}
              name="q"
              defaultValue={filters.q}
              maxLength={100}
              placeholder="Məsələn, mühasib"
              className={`${control} pl-9`}
            />
          </div>
        </div>

        <div className="min-w-0 space-y-1.5">
          <label htmlFor={ids.company} className="block min-w-0 text-sm font-medium text-on-background">
            Şirkət
          </label>
          <select
            id={ids.company}
            name="company"
            defaultValue={filters.company || ''}
            className={`${control} truncate`}
          >
            <option value="">Bütün şirkətlər</option>
            {filters.company && !companies.some((c) => c.company === filters.company) && (
              <option value={filters.company}>{filters.company}</option>
            )}
            {companies.map((c) => (
              <option key={c.company} value={c.company}>
                {c.company} ({formatNumber(c.count)})
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0 space-y-1.5 sm:col-span-2 lg:col-span-1">
          <label htmlFor={ids.category} className="block min-w-0 text-sm font-medium text-on-background">
            Kateqoriya
          </label>
          <select
            id={ids.category}
            name="category"
            defaultValue={filters.category || 'all'}
            className={`${control} truncate`}
          >
            <option value="all">Bütün kateqoriyalar</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({formatNumber(c.count)})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Action and disclosure controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-outline-variant/60">
        <button
          type="button"
          onClick={() => setIsAdvancedOpen((prev) => !prev)}
          aria-expanded={isAdvancedOpen}
          aria-controls={ids.advancedPanel}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-outline-variant bg-surface px-4 py-2 text-sm font-semibold text-on-background hover:bg-surface-container transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
          <span>Əlavə filtrlər</span>
          {advancedActiveCount > 0 && (
            <span
              aria-label={`${advancedActiveCount} aktiv`}
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-highlight px-1.5 text-xs font-bold text-primary"
            >
              {advancedActiveCount}
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-on-surface-variant transition-transform motion-reduce:transition-none ${
              isAdvancedOpen ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          />
        </button>

        <div className="flex items-center gap-3">
          <Link
            href="/jobs"
            className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden ${
              activeCount > 0
                ? 'border-accent bg-accent/10 font-semibold text-accent hover:bg-accent/20'
                : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'
            }`}
            aria-label={activeCount > 0 ? `Filtrləri sıfırla (${activeCount} aktiv)` : 'Sıfırla'}
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Sıfırla{activeCount > 0 ? ` (${activeCount})` : ''}</span>
          </Link>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center product-action rounded-full bg-primary px-6 py-2.5 text-xs font-bold text-white hover:bg-primary/90 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
          >
            Axtar
          </button>
        </div>
      </div>

      {/* Secondary / Advanced filters: Collapsed by default, auto-opened if active on desktop */}
      <div
        id={ids.advancedPanel}
        className={`${isAdvancedOpen ? 'block' : 'hidden'} pt-2 space-y-4`}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
          <div className="min-w-0 space-y-1.5">
            <label htmlFor={ids.location} className="block min-w-0 text-sm font-medium text-on-background">
              Şəhər
            </label>
            <input
              id={ids.location}
              name="location"
              defaultValue={filters.location}
              maxLength={80}
              placeholder="Məsələn, Bakı"
              className={control}
            />
          </div>

          <div className="min-w-0 space-y-1.5">
            <label htmlFor={ids.source} className="block min-w-0 text-sm font-medium text-on-background">
              Mənbə
            </label>
            <select
              id={ids.source}
              name="source"
              defaultValue={filters.source || 'all'}
              className={`${control} truncate`}
            >
              <option value="all">Bütün mənbələr</option>
              {sources.map((s) => (
                <option key={s.source} value={s.source}>
                  {sourceLabel(s.source)} ({formatNumber(s.count)})
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <label htmlFor={ids.work} className="block min-w-0 text-sm font-medium text-on-background">
              İş formatı
            </label>
            <select
              id={ids.work}
              name="work"
              defaultValue={filters.work || 'all'}
              className={`${control} truncate`}
            >
              <option value="all">Hamısı</option>
              {workArrangements.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.value === 'unknown' ? UNKNOWN_LABEL : workFormatLabel(w.value)} (
                  {formatNumber(w.count)})
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <label htmlFor={ids.experience} className="block min-w-0 text-sm font-medium text-on-background">
              Təcrübə səviyyəsi
            </label>
            <select
              id={ids.experience}
              name="experience"
              defaultValue={filters.experience || 'all'}
              className={`${control} truncate`}
            >
              <option value="all">Hamısı</option>
              {experienceLevels.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.value === 'unknown' ? UNKNOWN_LABEL : experienceLevelLabel(e.value)} (
                  {formatNumber(e.count)})
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <label htmlFor={ids.sort} className="block min-w-0 text-sm font-medium text-on-background">
              Sıralama
            </label>
            <select
              id={ids.sort}
              name="sort"
              defaultValue={filters.sort || 'newest'}
              className={`${control} truncate`}
            >
              <option value="newest">Ən yeni elanlar</option>
              <option value="oldest">Ən köhnə elanlar</option>
            </select>
          </div>
        </div>
      </div>
    </form>
  );
}
