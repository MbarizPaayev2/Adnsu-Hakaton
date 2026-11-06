import React from 'react';
import { PLAN_WEEKLY_MATCH_QUOTAS, PLAN_MATCH_QUOTAS, PLAN_DAILY_MATCH_QUOTAS } from '@aise/shared-types';
import type { PlanView } from '@/lib/retention/contract';

type Grant = NonNullable<PlanView['grants']>[string];
type Plan = { key: 'FREE' | 'PLUS' | 'PREMIUM'; view: PlanView | null };

const PERIOD: Record<string, string> = { month: 'ayda', day: 'gündə', lifetime: 'cəmi' };

/** One cell: what the server grants, in the row's own unit. Planned or unknown is said plainly, never shown as included. */
function cell(g: Grant | undefined, unit: string, unlimited = 'aylıq limit yoxdur'): string {
  if (!g) return '—';
  if (g.availability === 'planned') return 'hazırlanır';
  if (!g.enabled) return 'yoxdur';
  if (g.limit === null) return unlimited;
  if (typeof g.limit === 'number') return `${PERIOD[g.period ?? ''] ?? ''} ${g.limit} ${unit}`.trim();
  return 'var';
}

/**
 * The candidate plans side by side: the same rows, in the same units, for every plan, read from the server's grants. A plan whose grants did
 * not load shows "—" rather than a guessed number. Rows describe what exists today; nothing planned is presented as available.
 */
export function PlanComparison({ plans, automationOn = null }: { plans: Plan[]; automationOn?: boolean | null }) {
  const g = (p: Plan, key: string) => p.view?.grants?.[key];
  const rows: { label: string; hint?: string; value: (p: Plan) => string }[] = [
    { label: 'Vakansiyaya uyğun sənəd', hint: 'CV, rezüme və ya məktub; 1 sənəd = 1 vahid. Uğursuz cəhd, redaktə və yenidən yükləmə vahid aparmır.', value: (p) => cell(g(p, 'documents.generations'), 'sənəd', 'aylıq limit yoxdur (eyni anda 3, saatda 30)') },
    { label: 'İş tövsiyələri', hint: 'Yeni uyğun vakansiyalar olduqda. Gündəlik limit Bakı vaxtı ilə gecə 00:00-da yenilənir; istifadə olunmayan hissə yığılmır.', value: (p) => (PLAN_WEEKLY_MATCH_QUOTAS[p.key] !== undefined ? `həftədə ${PLAN_WEEKLY_MATCH_QUOTAS[p.key]}-ə qədər` : PLAN_DAILY_MATCH_QUOTAS[p.key] !== undefined ? `gündə ${PLAN_DAILY_MATCH_QUOTAS[p.key]}-ə qədər` : PLAN_MATCH_QUOTAS[p.key] == null ? 'limit yoxdur' : `ayda ${PLAN_MATCH_QUOTAS[p.key]}`) },
    { label: 'E-poçtla müraciət', hint: 'Göndərilməyən müraciət vahid aparmır.', value: (p) => cell(g(p, 'email.applications'), 'müraciət') },
    { label: 'Avtomatik e-poçt müraciəti', hint: 'Yalnız açıq razılığınızla, e-poçt limitinə daxildir.', value: (p) => { const c = cell(g(p, 'email.automation'), ''); return automationOn !== true && g(p, 'email.automation')?.enabled ? 'hələ açıq deyil' : c; } },
    { label: 'Brauzer köməkçisi', hint: 'Formada ad və əlaqə məlumatlarını doldurur; təsdiqlə göndəriş yalnız dəstəklənən portalda.', value: (p) => cell(g(p, 'browser.applications'), 'təsdiqli müraciət') },
    { label: 'CV versiyaları', value: (p) => cell(g(p, 'cv.versions'), 'versiya') },
    { label: 'Saxlanan elanlar', value: (p) => cell(g(p, 'saved.jobs'), 'elan') },
    { label: 'Axtarış bildirişləri', value: (p) => cell(g(p, 'saved.searches'), 'axtarış') },
    { label: 'Ani bildirişlər', value: (p) => cell(g(p, 'alerts.instant'), 'bildiriş') },
    { label: 'Müraciət cədvəli', value: (p) => (g(p, 'applications.tracking') ? cell(g(p, 'applications.tracking'), '', 'var') : '—') },
  ];
  return (
    <section aria-labelledby="compare-h" className="mx-auto max-w-6xl" data-testid="plan-comparison">
      <h2 id="compare-h" className="font-serif text-2xl font-bold text-on-background">Planları müqayisə edin</h2>
      <p className="mt-1 text-xs text-on-surface-variant">Eyni sətirlər, eyni vahidlər. Rəqəmlər serverdəki plan qaydalarından gəlir.</p>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-outline-variant" role="region" aria-labelledby="compare-h" tabIndex={0}>
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="bg-surface-container">
            <tr>
              <th scope="col" className="p-3 font-semibold">İmkan</th>
              {plans.map((p) => <th key={p.key} scope="col" className="p-3 font-semibold">{p.key === 'FREE' ? 'Ödənişsiz' : p.view?.name ?? p.key}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-outline-variant/60 align-top">
                <th scope="row" className="p-3 font-medium">
                  {r.label}
                  {r.hint && <span className="mt-0.5 block font-normal text-on-surface-variant">{r.hint}</span>}
                </th>
                {plans.map((p) => <td key={p.key} className="p-3">{r.value(p)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
