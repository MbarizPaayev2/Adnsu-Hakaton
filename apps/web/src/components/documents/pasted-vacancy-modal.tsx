'use client';

import { useState } from 'react';
import { X, ClipboardPaste, ArrowLeft, ArrowRight, Loader2, FileText } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { newRequestId } from '@/lib/documents/request-id';

type Parsed = {
  title: string | null; company: string | null; description: string; location: string | null;
  deadline: string | null; sourceUrl: string | null; requirements: string; responsibilities: string; needsReview: string[];
};

export function PastedVacancyModal({ open, onClose, onGenerated }: { open: boolean; onClose: () => void; onGenerated: (id: string) => void }) {
  const [text, setText] = useState('');
  const [vacancy, setVacancy] = useState<Parsed | null>(null);
  const [kind, setKind] = useState<'CV' | 'RESUME' | 'LETTER'>('CV');
  const [language, setLanguage] = useState('az');
  const [motivation, setMotivation] = useState('');
  const [companyReason, setCompanyReason] = useState('');
  const [formative, setFormative] = useState('');
  const [contribution, setContribution] = useState('');
  const [quote, setQuote] = useState<{ units: number; affordable: boolean; refusal?: { code?: string } | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);

  if (!open) return null;

  const field = (name: keyof Parsed, value: string) => {
    setQuote(null);
    setRequestId(null);
    setVacancy((v) => v ? ({ ...v, [name]: ['requirements', 'responsibilities', 'description'].includes(name) ? value : value || null } as Parsed) : v);
  };
  const context = vacancy ? {
    title: vacancy.title || '', originalText: text,
    company: vacancy.company || null, location: vacancy.location || null,
    description: vacancy.description || text,
    requirements: vacancy.requirements,
    responsibilities: vacancy.responsibilities,
    deadline: vacancy.deadline || null,
    sourceUrl: vacancy.sourceUrl || null,
  } : null;
  const parse = async () => {
    setBusy(true); setError(''); setQuote(null); setRequestId(null);
    try {
      const res = await apiFetch('/jobs/parse-text', { method: 'POST', body: JSON.stringify({ text }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Vakansiya mətni oxuna bilmədi. Mətni saxladıq; düzəldib yenidən yoxlayın.');
      setVacancy({ ...data.job, requirements: '', responsibilities: '', sourceUrl: data.job.sourceUrl ?? null });
    } catch (e: any) { setError(e.message || 'Çıxarış uğursuz oldu.'); }
    finally { setBusy(false); }
  };
  const getQuote = async () => {
    if (!context || !context.title.trim()) { setError('Sənəd üçün vakansiyanın adını yoxlayın.'); return; }
    setBusy(true); setError('');
    try {
      const res = await apiFetch('/documents/quote', { method: 'POST', body: JSON.stringify({ privateVacancy: context, items: [{ kind, language }] }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Limit yoxlanıla bilmədi.');
      setQuote({ units: data.units, affordable: data.affordable, refusal: data.refusal });
    } catch (e: any) { setError(e.message || 'Limit yoxlanıla bilmədi.'); }
    finally { setBusy(false); }
  };
  const generate = async () => {
    if (!context || !quote?.affordable) return;
    const key = requestId ?? newRequestId(); setRequestId(key);
    setBusy(true); setError('');
    try {
      const res = await apiFetch('/documents/generate', { method: 'POST', body: JSON.stringify({
        privateVacancy: context, items: [{ kind, language }], expectedUnits: quote.units, requestId: key,
        ...(kind === 'LETTER' ? { letter: { motivation, companyReason, formative, contribution } } : {}),
      }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || 'Sənəd yaradıla bilmədi. Daxil etdiyiniz məlumatlar saxlanılıb; yenidən cəhd edin.');
      const docId = data?.documents?.[0]?.id;
      if (!docId) throw new Error('Sənəd sorğusu qəbul edildi, lakin baxış keçidi alınmadı. Sənədlər siyahısını yeniləyin.');
      setRequestId(null);
      onGenerated(docId);
    } catch (e: any) { setError(e.message || 'Sənəd yaradıla bilmədi. Daxil etdiyiniz məlumatlar saxlanılıb; yenidən cəhd edin.'); }
    finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="paste-vacancy-title">
    <section className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-outline-variant bg-surface p-5 shadow-xl sm:p-7">
      <header className="flex items-start justify-between gap-4 border-b border-outline-variant pb-4">
        <div><h2 id="paste-vacancy-title" className="text-xl font-semibold text-on-background">Vakansiyadan sənəd hazırla</h2><p className="mt-1 text-sm text-on-surface-variant">Mətni özünüz yoxlayın. Bu elan şəxsi qalır və ümumi vakansiya siyahısına əlavə edilmir.</p></div>
        <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-background-warm" aria-label="Bağla"><X size={20}/></button>
      </header>
      {!vacancy ? <div className="space-y-4 pt-5">
        <label className="block text-sm font-medium" htmlFor="pasted-job-text">Vakansiya mətni</label>
        <textarea id="pasted-job-text" value={text} onChange={(e) => setText(e.target.value)} rows={12} maxLength={40000} placeholder="Elanın mətnini bura yapışdırın…" className="w-full rounded-xl border border-outline-variant bg-background-warm/30 p-3 text-sm" />
        <div className="flex justify-between text-xs text-on-surface-variant"><span>Ən azı 50 simvol · maksimum 40 000</span><span>{text.length}/40 000</span></div>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <button type="button" disabled={busy || text.trim().length < 50} onClick={parse} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={16}/> : <ClipboardPaste size={16}/>} Sahələri çıxar və yoxla</button>
      </div> : <div className="space-y-5 pt-5">
        <div className="rounded-xl border border-outline-variant bg-background-warm/30 p-3 text-sm text-on-surface-variant">Çıxarılan məlumatları təsdiqləyin. Boş sahə vakansiyanın bunu bildirmədiyi deməkdir; biz məlumat uydurmuruq.</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Vəzifə adı *<input value={vacancy.title ?? ''} onChange={(e) => field('title', e.target.value)} maxLength={140} className="mt-1 block min-h-11 w-full rounded-lg border border-outline-variant bg-background p-2.5" /></label>
          <label className="text-sm font-medium">Şirkət <span className="font-normal text-on-surface-variant">(naməlumdursa boş saxlayın)</span><input value={vacancy.company ?? ''} onChange={(e) => field('company', e.target.value)} maxLength={160} className="mt-1 block min-h-11 w-full rounded-lg border border-outline-variant bg-background p-2.5" /></label>
          <label className="text-sm font-medium">Yer<input value={vacancy.location ?? ''} onChange={(e) => field('location', e.target.value)} maxLength={256} className="mt-1 block min-h-11 w-full rounded-lg border border-outline-variant bg-background p-2.5" /></label>
          <label className="text-sm font-medium">Son tarix<input type="date" value={vacancy.deadline?.slice(0,10) ?? ''} onChange={(e) => field('deadline', e.target.value ? new Date(`${e.target.value}T23:59:00+04:00`).toISOString() : '')} className="mt-1 block min-h-11 w-full rounded-lg border border-outline-variant bg-background p-2.5" /></label>
          <label className="text-sm font-medium sm:col-span-2">Mənbə linki (istəyə bağlı)<input type="url" value={vacancy.sourceUrl ?? ''} onChange={(e) => field('sourceUrl', e.target.value)} maxLength={2048} placeholder="https://…" className="mt-1 block min-h-11 w-full rounded-lg border border-outline-variant bg-background p-2.5" /></label>
        </div>
        <label className="block text-sm font-medium">Elanın tam mətni<textarea value={text} onChange={(e) => { setText(e.target.value); setQuote(null); setRequestId(null); }} rows={9} maxLength={40000} className="mt-1 block w-full rounded-lg border border-outline-variant bg-background p-3 text-sm" /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Tələblər (elan ayrıca göstərirsə)<textarea value={vacancy.requirements} onChange={(e) => { field('requirements', e.target.value); setQuote(null); }} rows={4} maxLength={5000} className="mt-1 block w-full rounded-lg border border-outline-variant bg-background p-2.5" /></label>
          <label className="text-sm font-medium">Öhdəliklər (elan ayrıca göstərirsə)<textarea value={vacancy.responsibilities} onChange={(e) => { field('responsibilities', e.target.value); setQuote(null); }} rows={4} maxLength={5000} className="mt-1 block w-full rounded-lg border border-outline-variant bg-background p-2.5" /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Sənəd<select value={kind} onChange={(e) => { setKind(e.target.value as any); setQuote(null); setRequestId(null); }} className="mt-1 block min-h-11 w-full rounded-lg border border-outline-variant bg-background p-2"><option value="CV">Geniş CV</option><option value="RESUME">Qısa rezüme</option><option value="LETTER">Motivasiya məktubu</option></select></label>
          <label className="text-sm">Dil<select value={language} onChange={(e) => { setLanguage(e.target.value); setQuote(null); setRequestId(null); }} className="mt-1 block min-h-11 w-full rounded-lg border border-outline-variant bg-background p-2"><option value="az">Azərbaycan dili</option><option value="en">English</option><option value="ru">Русский</option><option value="tr">Türkçe</option></select></label>
        </div>
        {kind === 'LETTER' && <div className="space-y-3 rounded-xl border border-outline-variant p-4">
          <p className="text-sm font-semibold">Məktubda yalnız özünüz təsdiqlədiyiniz fikirləri daxil edin</p>
          {([['motivation','Bu vəzifəyə marağınız nədir?'],['companyReason','Şirkəti niyə seçirsiniz?'],['formative','Bu marağı hansı təcrübə gücləndirib?'],['contribution','Hansı töhfənizi vurğulamaq istəyirsiniz?']] as const).map(([key,label]) => <label key={key} className="block text-sm">{label}<textarea value={{motivation,companyReason,formative,contribution}[key]} onChange={(e) => { ({motivation:setMotivation,companyReason:setCompanyReason,formative:setFormative,contribution:setContribution}[key])(e.target.value); setRequestId(null); }} rows={2} className="mt-1 block w-full rounded-lg border border-outline-variant bg-background p-2.5" /></label>)}
        </div>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => { setVacancy(null); setQuote(null); setRequestId(null); setError(''); }} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-outline-variant px-4 text-sm"><ArrowLeft size={16}/> Mətni yenidən yoxla</button>
          <button type="button" disabled={busy || !vacancy.title?.trim()} onClick={getQuote} className="min-h-11 rounded-full border border-primary px-5 text-sm font-semibold text-primary disabled:opacity-50">Limitə bax</button>
          {quote?.affordable && <button type="button" disabled={busy} onClick={generate} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={16}/> : <FileText size={16}/>} Sənədi hazırla <ArrowRight size={16}/></button>}
        </div>
        {quote && <p className="text-sm text-on-surface-variant">Bu sənəd {quote.units} limit vahidi istifadə edir. {quote.affordable ? 'Hazırdır.' : 'Hazırda limit kifayət etmir.'}</p>}
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      </div>}
    </section>
  </div>;
}
