'use client';

import React, { useId } from 'react';

export type DatePrecision = 'YEAR' | 'MONTH';

/** yyyy-MM-dd (what the profile form stores) → the value a month or year field shows. */
const monthValue = (iso: string) => (iso ? iso.slice(0, 7) : '');
const yearValue = (iso: string) => (iso ? iso.slice(0, 4) : '');

/**
 * A start or end date as precise as the candidate knows it: month and year, or the year alone. A year-only date is stored as 1 January with
 * precision YEAR and shown as the year, never as "January". Empty stays empty: nothing is filled in.
 */
export function PeriodInput({
  label,
  value,
  precision,
  onChange,
  hint,
  className,
}: {
  label: string;
  value: string;
  precision?: DatePrecision | null;
  onChange: (value: string, precision: DatePrecision) => void;
  hint?: string;
  className?: string;
}) {
  const id = useId();
  const yearOnly = precision === 'YEAR';
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-neutral-dark/85">{label}</label>
      {yearOnly ? (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={1950}
          max={2100}
          placeholder="İl"
          className={className}
          value={yearValue(value)}
          onChange={(e) => {
            const y = e.target.value.trim();
            onChange(/^\d{4}$/.test(y) ? `${y}-01-01` : '', 'YEAR');
          }}
        />
      ) : (
        <input
          id={id}
          type="month"
          className={className}
          value={monthValue(value)}
          onChange={(e) => onChange(e.target.value ? `${e.target.value}-01` : '', 'MONTH')}
        />
      )}
      <label className="mt-1 inline-flex min-h-8 items-center gap-1.5 text-xs text-neutral-dark/70">
        <input
          type="checkbox"
          checked={yearOnly}
          onChange={(e) => onChange(value ? `${value.slice(0, 4)}-01-01` : '', e.target.checked ? 'YEAR' : 'MONTH')}
        />
        Yalnız il məlumdur
      </label>
      {hint && <p className="text-xs text-neutral-dark/60">{hint}</p>}
    </div>
  );
}
