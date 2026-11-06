'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { sameExperience, type MergeEducation, type MergeExperience } from '@/lib/profile-merge';

type Parsed = Record<string, any>;

const UNCERTAIN: Record<string, string> = {
  company: 'şirkət adı',
  startDate: 'başlama tarixi',
  endDate: 'bitmə tarixi',
  description: 'təsvir',
  detail: 'dərəcə və ixtisas',
  dates: 'tarixlər',
};

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'İyn', 'İyl', 'Avq', 'Sen', 'Okt', 'Noy', 'Dek'];
/** A date as stated: the year alone for year precision, month and year otherwise. */
export function formatStated(iso?: string | null, precision?: string | null): string {
  if (!iso) return '';
  const year = iso.slice(0, 4);
  if (precision === 'YEAR') return year;
  const month = Number(iso.slice(5, 7));
  return month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${year}` : year;
}

export function statedPeriod(e: { startDate?: string | null; endDate?: string | null; startPrecision?: string | null; endPrecision?: string | null; current?: boolean }): string {
  const start = formatStated(e.startDate, e.startPrecision);
  const end = e.current ? 'indiyədək' : formatStated(e.endDate, e.endPrecision);
  if (!start && !end) return 'tarix göstərilməyib';
  return start && end ? (start === end ? start : `${start} – ${end}`) : start || end;
}

function Uncertain({ fields, source }: { fields?: string[]; source?: string }) {
  if (!fields?.length && !source) return null;
  return (
    <div className="mt-1 text-xs">
      {!!fields?.length && (
        <p className="flex items-start gap-1.5 text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Yoxlayın: {fields.map((f) => UNCERTAIN[f] ?? f).join(', ')} {fields.includes('startDate') ? 'mənbədə yoxdur və ya aydın deyil.' : 'aydın oxunmadı.'}
        </p>
      )}
      {source && (
        <details className="mt-1 text-neutral-dark/70">
          <summary className="cursor-pointer">Mənbədəki mətn</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-background-warm/40 p-2 font-sans">{source}</pre>
        </details>
      )}
    </div>
  );
}

/**
 * What an import (a LinkedIn PDF or copied profile text) would add, shown BEFORE anything changes in the form. Entries that are already in the
 * profile are marked and will not be added twice; nothing the candidate wrote is overwritten (differences are offered separately after merging).
 */
export function ImportPreview({
  parsed,
  existing,
  onApply,
  onCancel,
}: {
  parsed: Parsed;
  existing: { experiences: MergeExperience[]; education: MergeEducation[]; skills: string[]; name: string; headline: string };
  onApply: () => void;
  onCancel: () => void;
}) {
  const roles: Parsed[] = Array.isArray(parsed.workExperience) ? parsed.workExperience : [];
  const schools: Parsed[] = Array.isArray(parsed.education) ? parsed.education : [];
  const suggestions: Parsed[] = Array.isArray(parsed.careerSuggestions) ? parsed.careerSuggestions : [];
  const skills: string[] = Array.isArray(parsed.skills) ? parsed.skills : [];
  const known = new Set(existing.skills.map((s) => s.toLowerCase().trim()));
  const newSkills = skills.filter((s) => !known.has(s.toLowerCase().trim()));
  const asMerge = (e: Parsed): MergeExperience => ({ title: e.title ?? '', company: e.company ?? '', startDate: (e.startDate ?? '').slice(0, 10), endDate: e.endDate ? String(e.endDate).slice(0, 10) : null, description: e.description ?? '' });
  const uncertainCount = [...roles, ...schools].filter((e) => e.uncertain?.length).length;
  const count = (kind: string) => suggestions.filter((s) => s.kind === kind).length;
  const name = parsed.personalInfo?.name as string | undefined;

  return (
    <section aria-labelledby="import-preview-heading" data-testid="import-preview" className="mt-4 rounded-2xl border border-primary/30 bg-background p-4 sm:p-5">
      <h2 id="import-preview-heading" className="font-semibold text-neutral-dark">Oxunanlara baxın, sonra əlavə edin</h2>
      <p className="mt-1 text-sm text-neutral-dark/75">
        Hələ heç nə dəyişməyib. “Profilə əlavə et” düyməsindən sonra yeni qeydlər forma əlavə olunur; artıq olanlar təkrarlanmır,
        sizin yazdıqlarınız dəyişdirilmir. Saxlamazdan əvvəl hər şeyi düzəldə bilərsiniz.
      </p>
      {uncertainCount > 0 && (
        <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
          {uncertainCount} qeyddə bəzi məlumatlar aydın oxunmadı. Onlar aşağıda işarələnib; əlavə etdikdən sonra yoxlayın.
        </p>
      )}

      {(name || parsed.headline) && (
        <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
          {name && (<><dt className="text-neutral-dark/60">Ad</dt><dd>{name}{existing.name && existing.name !== name ? <span className="text-xs text-neutral-dark/60"> (sizin yazdığınız saxlanılır)</span> : null}</dd></>)}
          {parsed.headline && (<><dt className="text-neutral-dark/60">Başlıq</dt><dd className="break-words">{parsed.headline}{existing.headline ? <span className="text-xs text-neutral-dark/60"> (sizin yazdığınız saxlanılır)</span> : null}</dd></>)}
        </dl>
      )}

      {roles.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-dark/60">Təcrübə ({roles.length})</h3>
          <ul className="mt-2 space-y-2">
            {roles.map((r, i) => {
              const dup = existing.experiences.some((e) => sameExperience(e, asMerge(r)));
              return (
                <li key={i} className="rounded-xl border border-neutral-dark/10 p-3 text-sm">
                  <p className="font-medium break-words">{r.title || 'Vəzifə göstərilməyib'} — {r.company || 'şirkət göstərilməyib'}</p>
                  <p className="text-xs text-neutral-dark/65">{statedPeriod(r)}{r.location ? ` · ${r.location}` : ''} · {dup ? 'artıq profildədir' : 'yeni'}</p>
                  <Uncertain fields={r.uncertain} source={r.uncertain?.length ? r.source : undefined} />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {schools.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-dark/60">Təhsil ({schools.length})</h3>
          <ul className="mt-2 space-y-2">
            {schools.map((s, i) => (
              <li key={i} className="rounded-xl border border-neutral-dark/10 p-3 text-sm">
                <p className="font-medium break-words">{s.institution}</p>
                <p className="text-xs text-neutral-dark/65 break-words">{[s.degree, s.fieldOfStudy].filter(Boolean).join(', ') || 'dərəcə göstərilməyib'} · {statedPeriod(s)}</p>
                <Uncertain fields={s.uncertain} source={s.uncertain?.length ? s.source : undefined} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-xs text-neutral-dark/70">
        Bacarıqlar: {newSkills.length} yeni{skills.length > newSkills.length ? `, ${skills.length - newSkills.length} artıq var` : ''}.
        {count('CERTIFICATION') > 0 && ` Sertifikatlar: ${count('CERTIFICATION')}.`}
        {count('LANGUAGE') > 0 && ` Dillər: ${count('LANGUAGE')}.`}
        {count('AWARD') > 0 && ` Mükafatlar: ${count('AWARD')}.`}
      </p>
      {suggestions.length > 0 && (
        <p className="mt-1 text-xs text-neutral-dark/70">Sertifikat, dil və mükafatlar təklif kimi əlavə olunur; onları “Karyera sübutları” bölməsində təsdiqləyirsiniz.</p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={onApply} className="min-h-11 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          Profilə əlavə et
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-full border border-neutral-dark/25 px-5 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          Ləğv et
        </button>
      </div>
    </section>
  );
}
