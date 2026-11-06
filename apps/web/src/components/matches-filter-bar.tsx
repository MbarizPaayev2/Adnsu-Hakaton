'use client';

import React, { useId, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Search, SlidersHorizontal, X, ChevronDown } from 'lucide-react';
import { activeCriteriaCount, type MatchCriteria } from '@/lib/match-filters';

const STATUS_LABELS: Record<string, string> = {
  new: 'Yeni',
  viewed: 'Baxılıb',
  applied: 'Müraciət edilib',
  dismissed: 'Rədd edilib',
};

const field =
  'block w-full min-h-11 rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-background focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden';

export interface MatchesFilterBarProps {
  criteria: MatchCriteria;
  onChange: (next: MatchCriteria) => void;
  onReset: () => void;
  onRefresh: () => void;
  companies: string[];
  cities: string[];
  skillSuggestions: string[];
  /** Matches the account is entitled to see, before any filter. */
  totalVisible: number;
  /** Matches shown after filters. */
  shown: number;
}

/**
 * Filters for /dashboard/matches. They narrow ONLY the matches already visible
 * to this account (plan quotas are applied by the server); they never search
 * the public catalogue — that is what /jobs is for.
 */
export function MatchesFilterBar({
  criteria,
  onChange,
  onReset,
  onRefresh,
  companies,
  cities,
  skillSuggestions,
  totalVisible,
  shown,
}: MatchesFilterBarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const ids = { search: useId(), company: useId(), city: useId(), panel: useId(), hint: useId(), list: useId() };
  const total = activeCriteriaCount(criteria);
  const advancedCount = criteria.city ? 1 : 0;
  const hasCityOption = cities.length > 0;
  const trimmedQuery = criteria.query.trim();

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (criteria.status !== 'all') chips.push({ key: 'status', label: STATUS_LABELS[criteria.status] ?? criteria.status, clear: () => onChange({ ...criteria, status: 'all' }) });
  if (trimmedQuery) chips.push({ key: 'query', label: `“${trimmedQuery}”`, clear: () => onChange({ ...criteria, query: '' }) });
  if (criteria.company) chips.push({ key: 'company', label: criteria.company, clear: () => onChange({ ...criteria, company: '' }) });
  if (criteria.city) chips.push({ key: 'city', label: `Yer: ${criteria.city}`, clear: () => onChange({ ...criteria, city: '' }) });

  return (
    <section aria-label="Uyğunluqları süz" className="space-y-3 min-w-0">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] md:items-end min-w-0">
        <div className="min-w-0">
          <label htmlFor={ids.search} className="text-sm font-medium text-on-background">
            Vəzifə və ya bacarıq
          </label>
          <div className="relative mt-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
            <input
              id={ids.search}
              type="search"
              value={criteria.query}
              onChange={(e) => onChange({ ...criteria, query: e.target.value })}
              maxLength={100}
              list={skillSuggestions.length ? ids.list : undefined}
              aria-describedby={ids.hint}
              placeholder="Məsələn, mühasib və ya Excel"
              autoComplete="off"
              className={`${field} pl-9`}
            />
            {skillSuggestions.length > 0 && (
              <datalist id={ids.list}>
                {skillSuggestions.map((skill) => (
                  <option key={skill} value={skill} />
                ))}
              </datalist>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <label htmlFor={ids.company} className="text-sm font-medium text-on-background">
            Şirkət
          </label>
          <select
            id={ids.company}
            value={criteria.company}
            onChange={(e) => onChange({ ...criteria, company: e.target.value })}
            className={`${field} mt-1 truncate`}
          >
            <option value="">Bütün şirkətlər</option>
            {criteria.company && !companies.includes(criteria.company) && <option value={criteria.company}>{criteria.company}</option>}
            {companies.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {hasCityOption && (
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              aria-expanded={advancedOpen}
              aria-controls={ids.panel}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-outline-variant bg-surface px-4 text-sm font-semibold text-on-background hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
            >
              <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
              Əlavə filtrlər
              {advancedCount > 0 && (
                <span aria-label={`${advancedCount} aktiv`} className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-highlight px-1.5 text-xs font-bold text-primary">
                  {advancedCount}
                </span>
              )}
              <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform motion-reduce:transition-none ${advancedOpen ? 'rotate-180' : ''}`} />
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Yenilə"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-outline-variant bg-surface text-on-background hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {hasCityOption && advancedOpen && (
        <div id={ids.panel} className="rounded-2xl border border-outline-variant bg-surface p-4">
          <div className="max-w-xs">
            <label htmlFor={ids.city} className="text-sm font-medium text-on-background">
              Yer (elanda yazıldığı kimi)
            </label>
            <select id={ids.city} value={criteria.city} onChange={(e) => onChange({ ...criteria, city: e.target.value })} className={`${field} mt-1`}>
              <option value="">Bütün şəhərlər</option>
              {criteria.city && !cities.includes(criteria.city) && <option value={criteria.city}>{criteria.city}</option>}
              {cities.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <p id={ids.hint} className="text-xs text-on-surface-variant">
        Görünən uyğunluqlarda axtar: yalnız hesabınıza açıq olan {totalVisible} uyğunluq süzülür.{' '}
        <Link href="/jobs" className="font-semibold text-primary underline underline-offset-2">
          Bütün vakansiyalar kataloqda
        </Link>
      </p>

      {chips.length > 0 && (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Aktiv filtrlər">
          {chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                onClick={chip.clear}
                aria-label={`${chip.label} filtrini sil`}
                className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-outline-variant bg-highlight/50 px-3 text-xs font-semibold text-primary hover:bg-highlight focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
              >
                <span className="truncate max-w-[16rem]">{chip.label}</span>
                <X aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex min-h-9 items-center rounded-full px-3 text-xs font-semibold text-primary underline underline-offset-2 hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
            >
              Hamısını sıfırla ({total})
            </button>
          </li>
        </ul>
      )}

      <p aria-live="polite" className="text-xs font-medium text-on-surface-variant">
        {total > 0 ? `${totalVisible} görünən uyğunluqdan ${shown}-i göstərilir` : `${totalVisible} uyğunluq`}
      </p>
    </section>
  );
}
