'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Check, Plus } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { BUTTON, LoadingState } from '@/components/ui';

type Need = { skill: string; level: 'required' | 'preferred'; requirement: string };
type Evidenced = Need & { via: 'skills' | 'experience'; where?: string };
type Other = { kind: 'degree' | 'experience' | 'other'; text: string; level: 'required' | 'preferred' };
type Guidance = { hasProfile: boolean; evidenced: Evidenced[]; missingRequired: Need[]; missingPreferred: Need[]; other: Other[] };

const OTHER_LABEL: Record<Other['kind'], string> = { degree: 'Təhsil', experience: 'Təcrübə müddəti', other: 'Digər şərt' };

/**
 * What the posting asks for next to what the signed-in candidate's profile already shows. "Not in your profile" is a statement about the
 * profile only. Nothing is added without the candidate pressing the confirmation; degrees and years of experience are not treated as skills.
 */
export function JobSkillGuidance({ kind, id, loginHref }: { kind: string; id: string; loginHref: string }) {
  const { status } = useSession();
  const [data, setData] = useState<Guidance | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/jobs/${kind}/${encodeURIComponent(id)}/skills`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Guidance);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [kind, id]);

  useEffect(() => {
    if (status === 'authenticated') void load();
  }, [status, load]);

  const add = async (need: Need) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(need.skill);
    setError(null);
    try {
      const res = await apiFetch('/profile/skills', { method: 'POST', body: JSON.stringify({ skill: need.skill, confirmed: true }) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.message === 'string' ? body.message : 'Bacarıq əlavə edilmədi.');
      }
      setNotice(`“${need.skill}” profilinizə əlavə olundu. Uyğunluq nəticələri yenidən hesablanır.`);
      setConfirming(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bacarıq əlavə edilmədi.');
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  if (status === 'loading') return null;
  if (status !== 'authenticated') {
    return (
      <section className="p-5 sm:p-8" aria-labelledby="skills-heading">
        <h2 id="skills-heading" className="mb-2 text-xl font-semibold">Bu vakansiya üçün bacarıqlarınız</h2>
        <p className="text-sm text-on-surface-variant">
          Elanın tələb etdiyi bacarıqları profilinizlə müqayisə etmək üçün <Link href={loginHref} className="underline">daxil olun</Link>.
        </p>
      </section>
    );
  }
  if (failed) {
    return (
      <section className="p-5 sm:p-8" aria-labelledby="skills-heading">
        <h2 id="skills-heading" className="mb-2 text-xl font-semibold">Bu vakansiya üçün bacarıqlarınız</h2>
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-on-surface-variant">
          <p>Bacarıq müqayisəsi yüklənmədi.</p>
          <button type="button" onClick={() => void load()} className={BUTTON.secondary}>Yenidən cəhd et</button>
        </div>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="p-5 sm:p-8" aria-labelledby="skills-heading">
        <h2 id="skills-heading" className="mb-2 text-xl font-semibold">Bu vakansiya üçün bacarıqlarınız</h2>
        <LoadingState label="Bacarıqlar profilinizlə müqayisə olunur…" />
      </section>
    );
  }

  const noSkills = data.evidenced.length + data.missingRequired.length + data.missingPreferred.length === 0;

  const missing = (title: string, hint: string, items: Need[]) =>
    items.length === 0 ? null : (
      <div className="mt-5">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mb-2 text-xs text-on-surface-variant">{hint}</p>
        <ul className="space-y-3">
          {items.map((n) => (
            <li key={n.skill} className="rounded-xl border border-outline-variant p-3">
              <p className="font-medium">{n.skill}</p>
              <p className="mt-1 break-words text-xs text-on-surface-variant">Elanda: “{n.requirement}”</p>
              <p className="mt-1 text-xs text-on-surface-variant">Profilinizdə göstərilməyib</p>
              {confirming === n.skill ? (
                <div className="mt-3 rounded-lg bg-surface-container p-3 text-sm" role="group" aria-label={`${n.skill} bacarığını təsdiqləyin`}>
                  <p>“{n.skill}” bacarığını profilinizə əlavə edirik. Yalnız bu bacarığa həqiqətən sahibsinizsə təsdiqləyin; CV-yə yalnız profilinizdəki faktlar düşür.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => add(n)} disabled={busy !== null} className={BUTTON.primary}>
                      {busy === n.skill ? 'Əlavə olunur...' : 'Təsdiqləyirəm, əlavə et'}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} disabled={busy !== null} className={BUTTON.secondary}>Ləğv et</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => { setNotice(null); setError(null); setConfirming(n.skill); }} disabled={busy !== null} className={`${BUTTON.secondary} mt-3`}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Bu bacarığım var — profilə əlavə et
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <section className="p-5 sm:p-8" aria-labelledby="skills-heading" data-testid="skill-guidance">
      <h2 id="skills-heading" className="mb-1 text-xl font-semibold">Bu vakansiya üçün bacarıqlarınız</h2>
      <p className="text-xs text-on-surface-variant">Müqayisə elanın mətninə və profilinizə əsaslanır; “profilinizdə göstərilməyib” o bacarığın sizdə olmadığı demək deyil, sadəcə profilinizdə hələ yazılmayıb.</p>

      <div aria-live="polite" role="status" className="mt-3">
        {notice && <p className="rounded-lg bg-surface-container p-3 text-sm">{notice}</p>}
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </div>

      {!data.hasProfile && (
        <p className="mt-3 text-sm">Müqayisə üçün əvvəlcə <Link href="/dashboard/profile" className="underline">profilinizi doldurun</Link>.</p>
      )}

      {noSkills && data.hasProfile && (
        <p className="mt-3 text-sm text-on-surface-variant">Bu elan konkret bacarıq adları göstərmir. Aşağıdakı şərtlərə (varsa) baxın.</p>
      )}

      {data.evidenced.length > 0 && (
        <div className="mt-5">
          <h3 className="text-base font-semibold">Profilinizdə artıq göstərilənlər</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {data.evidenced.map((s) => (
              <li key={s.skill} className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1.5 text-sm">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{s.skill}</span>
                <span className="text-xs text-on-surface-variant">
                  {s.via === 'skills' ? '· bacarıqlar siyahısında' : `· təcrübənizdə${s.where ? ` (${s.where})` : ''}`}
                </span>
                {s.level === 'preferred' && <span className="text-xs text-on-surface-variant">· üstünlük</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {missing('Tələb olunur və profilinizdə göstərilməyib', 'Elan bunu tələb kimi göstərir.', data.missingRequired)}
      {missing('Üstünlük sayılır və profilinizdə göstərilməyib', 'Elan bunu arzuolunan və ya üstünlük kimi göstərir.', data.missingPreferred)}

      {data.other.length > 0 && (
        <div className="mt-5">
          <h3 className="text-base font-semibold">Bacarıq olmayan şərtlər</h3>
          <p className="mb-2 text-xs text-on-surface-variant">Təhsil və təcrübə müddəti bacarıq kimi sayılmır; bunlar profilinizə avtomatik əlavə edilmir.</p>
          <ul className="space-y-2 text-sm">
            {data.other.map((o, i) => (
              <li key={`${o.kind}-${i}`} className="break-words">
                <span className="font-medium">{OTHER_LABEL[o.kind]}{o.level === 'preferred' ? ' (üstünlük)' : ''}:</span> {o.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
