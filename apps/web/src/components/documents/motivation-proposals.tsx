'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type Field = 'whyRole' | 'whyCompany' | 'formative' | 'contribution';
type Proposal = { id: string; field: Field; title: string; text: string; sourceText?: string; tip?: string };
type Guidance = { field: string; tip: string };
export type MotivationAnswers = Partial<Record<Field, string>>;
type Props = {
  matchId: string; language: string; values: MotivationAnswers; onAdopt: (field: Field, text: string) => void;
};

/** Proposals need explicit adoption; browsing alternatives never modifies candidate answers. */
export function MotivationProposals(props: Props) {
  return props.language === 'az' ? <ProposalEditor key={props.matchId} {...props} /> : null;
}

function ProposalEditor({ matchId, values, onAdopt }: Props) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [guidance, setGuidance] = useState<Guidance[]>([]);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<string[]>([]);
  const [choices, setChoices] = useState<Partial<Record<Field, number>>>({});
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    apiFetch(`/matches/${encodeURIComponent(matchId)}/skills`, { signal: controller.signal })
      .then(async (res) => { if (!res.ok) throw new Error('PREPARATION_UNAVAILABLE'); return res.json(); })
      .then((data) => { if (active) { setProposals(data.motivationSuggestions ?? []); setGuidance(data.motivationGuidance ?? []); setStatus('ready'); } })
      .catch(() => { if (active) setStatus('failed'); });
    return () => { active = false; controller.abort(); };
  }, [matchId, retry]);
  const groups = (['whyRole', 'whyCompany', 'formative', 'contribution'] as Field[])
    .map((field) => ({ field, options: proposals.filter((p) => p.field === field && !rejected.includes(p.id)) }))
    .filter((group) => group.options.length);
  return <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3" aria-label="Vakansiyaya uyğun motivasiya təklifləri">
    <div>
      <h3 className="font-semibold text-sm">Məktubunuz üçün hazır cümlələr</h3>
      <p className="mt-1 text-xs text-on-surface-variant">Vəzifə ilə bağlı faktlar elandan, şəxsi səbəblər isə yalnız sizdən gəlir. Mötərizədəki hissəni öz sözlərinizlə tamamlayın; hazır cavablarınız dəyişdirilmir.</p>
    </div>
    <details className="rounded-xl border border-primary/15 bg-surface p-3 text-xs">
      <summary className="cursor-pointer font-semibold min-h-6">Daha güclü məktub üçün tövsiyələr</summary>
      <ul className="mt-2 space-y-2 list-disc pl-4 leading-relaxed">
        {guidance.length ? guidance.map((g) => <li key={g.field}>{g.tip}</li>) : <>
          <li>Elanın bir konkret tapşırığını seçin və ona marağınızın səbəbini izah edin.</li>
          <li>Bir əlaqəli nümunə göstərin: gördüyünüz iş, istifadə etdiyiniz üsul və nəticə.</li>
          <li>Şirkət barədə yalnız yoxladığınız məlumatı yazın. Sahib olmadığınız bacarığı və ya təcrübəni iddia etməyin.</li>
        </>}
        <li>Məktub CV-nin təkrarı olmasın: 1–2 nümunənin bu rola nə üçün aid olduğunu izah edin.</li>
      </ul>
    </details>
    {status === 'loading' && <p role="status" className="text-xs">Cümlələr hazırlanır… Bu vaxt aşağıdakı cavabları yaza bilərsiniz.</p>}
    {status === 'failed' && <div role="status" className="text-xs">Təkliflər alınmadı. Öz cavablarınızla davam edə bilərsiniz. <button type="button" className="underline min-h-10" onClick={() => { setStatus('loading'); setRetry((n) => n + 1); }}>Yenidən yoxla</button></div>}
    {status === 'ready' && !groups.length && <p className="text-xs">Göstəriləcək hazır təklif yoxdur. Tövsiyələrə baxıb öz səbəbinizi aşağıda yaza bilərsiniz.</p>}
    {groups.map(({ field, options }) => {
      const index = Math.min(choices[field] ?? 0, options.length - 1);
      const proposal = options[index];
      const text = edited[proposal.id] ?? proposal.text;
      const accepted = !!text.trim() && values[field] === text.trim();
      const needsCandidateInput = /\[[^\]]+\]/u.test(text);
      return <div key={field} className="rounded-xl border border-outline-variant bg-surface p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor={`proposal-${proposal.id}`} className="block text-xs font-semibold">{proposal.title}</label>
            {!accepted ? (
              <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300 border border-amber-500/20">
                Təsdiqlənməyib — redaktə edib qəbul edin
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-300 border border-emerald-500/20">
                Qəbul edilib
              </span>
            )}
          </div>
          {options.length > 1 && <div className="flex items-center gap-2 text-xs">
            <span aria-live="polite">Variant {index + 1} / {options.length}</span>
            <button type="button" className="min-h-10 underline" aria-label={`${proposal.title}: başqa variant`} onClick={() => setChoices((c) => ({ ...c, [field]: (index + 1) % options.length }))}>Başqa variant</button>
          </div>}
        </div>
        {proposal.tip && <p className="text-xs text-on-surface-variant leading-relaxed">{proposal.tip}</p>}
        <textarea id={`proposal-${proposal.id}`} rows={3} maxLength={field === 'whyRole' ? 2000 : 1000} value={text}
          onChange={(event) => setEdited((current) => ({ ...current, [proposal.id]: event.target.value }))}
          className="w-full rounded-lg border border-outline-variant bg-background p-2 text-sm leading-relaxed" />
        {proposal.sourceText && <details className="text-xs text-on-surface-variant"><summary className="cursor-pointer min-h-6">Təklifin əsaslandığı mətn</summary><p className="mt-1 leading-relaxed">{proposal.sourceText}</p></details>}
        {needsCandidateInput && <p className="text-xs text-amber-800" role="note">Bu, tamamlanmamış qaralamadır. Mötərizədəki göstərişi öz həqiqi səbəbinizlə əvəz etmədən qəbul etmək mümkün deyil.</p>}
        <div className="flex flex-wrap gap-3 items-center">
          <button type="button" disabled={!text.trim() || accepted || needsCandidateInput} onClick={() => onAdopt(field, text.trim())}
            className="min-h-10 rounded-full bg-primary px-4 text-xs font-semibold text-white disabled:opacity-60">
            {accepted ? 'Qəbul edildi' : values[field]?.trim() ? 'Cavabımı bununla əvəz et' : 'Məni ifadə edir — əlavə et'}
          </button>
          <button type="button" onClick={() => { setRejected((current) => [...current, proposal.id]); setChoices((c) => ({ ...c, [field]: 0 })); }} className="min-h-10 text-xs underline">Bu təklifi keç</button>
        </div>
      </div>;
    })}
  </section>;
}
