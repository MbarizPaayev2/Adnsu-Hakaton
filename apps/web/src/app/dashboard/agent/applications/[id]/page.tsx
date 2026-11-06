'use client';

import React, { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { ASK_REASON, CATEGORY, EVENT, REASON, TONES, errorOf, stateOf, type AgentApplication, type AgentQuestion } from '@/lib/agent';

const BOX = 'product-card rounded-2xl border border-neutral-dark/10 bg-background p-5 space-y-3';
const INPUT = 'w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm text-neutral-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const BTN = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const PRIMARY = `${BTN} bg-primary text-white hover:bg-primary/90`;
const SECONDARY = `${BTN} border border-neutral-dark/25 text-neutral-dark hover:bg-neutral-dark/5`;
const HANDOFF = ['CAPTCHA', 'CAPTCHA_PENDING', 'LOGIN_REQUIRED'];

const show = (v: unknown) => (typeof v === 'boolean' ? (v ? 'Bəli' : 'Xeyr') : Array.isArray(v) ? v.join(', ') : String(v ?? ''));

export default function AgentApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [app, setApp] = useState<AgentApplication | null | 'missing'>(null);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [remember, setRemember] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const res = await apiFetch(`/agent/applications/${id}`, { cache: 'no-store' }).catch(() => null);
    if (!res) return;
    if (res.status === 404) return setApp('missing');
    if (res.ok) setApp(await res.json());
  }, [id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function post(key: string, path: string, body: object, ok: string) {
    setBusy(key); setError(''); setNotice('');
    const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
    if (!res) setError('Bağlantı xətası.'); else if (!res.ok) setError(await errorOf(res)); else { setNotice(ok); setApp(await res.json()); setAnswers({}); }
    setBusy('');
  }

  if (app === null) return <div role="status" className="flex items-center gap-2 p-6 text-sm"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Yüklənir…</div>;
  if (app === 'missing') return <p className="m-6 text-sm">Müraciət tapılmadı. <Link href="/dashboard/agent" className="underline">Agentə qayıt</Link></p>;

  const s = stateOf(app);
  const handoff = app.state === 'AWAITING_INPUT' && app.stateReason && HANDOFF.includes(app.stateReason);
  const questions: AgentQuestion[] = app.questions.filter((q) => q.key !== '__handoff');
  const answeredAll = questions.every((q) => !q.required || answers[q.key] !== undefined || q.answer !== undefined);
  const needsApproval = app.state === 'READY' && app.approval.required && !app.approval.approved;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
      <Link href="/dashboard/agent" className="inline-flex items-center gap-1 text-sm underline"><ChevronLeft aria-hidden="true" className="h-4 w-4" />Agent</Link>
      <header className="space-y-2">
        <h1 className="font-serif text-2xl font-bold break-words">{app.title}</h1>
        <p className="text-sm text-neutral-dark/70">{app.company} · {app.mode === 'ASSISTED' ? 'hər müraciəti siz təsdiq edirsiniz' : 'avtonom müraciət icazəsi'} · müraciət icazəsi: {app.campaign.name}</p>
        <p><span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${TONES[s.tone]}`}>{s.label}</span></p>
        {app.stateReason && REASON[app.stateReason] && <p className="text-sm text-neutral-dark/80">{REASON[app.stateReason]}</p>}
      </header>

      <div aria-live="polite">
        {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </div>

      {app.matchScore !== null && (
        <section className={BOX} aria-labelledby="why">
          <h2 id="why" className="font-semibold">Niyə bu vakansiya</h2>
          <p className="text-sm">AISE-nin uyğunluq xalı <strong>{Math.round(app.matchScore * 100)}%</strong>{Array.isArray(app.matchedKeywords) && app.matchedKeywords.length ? <> · uyğun gələn açar sözlər: <strong>{(app.matchedKeywords as string[]).slice(0, 8).join(', ')}</strong></> : null}. Bu vakansiya həm də icazənizın hədəf vəzifə, yer və işəgötürən şərtlərinə uyğundur: xal tək başına seçim səbəbi deyil.</p>
        </section>
      )}

      {handoff && (
        <section className={BOX} aria-labelledby="ho">
          <h2 id="ho" className="font-semibold">Sizin addımınız</h2>
          <p className="text-sm">Portal sizdən bir addım tələb edir. Brauzerinizdə açıq qalan vakansiya səhifəsinə keçin və onu özünüz tamamlayın (AISE CAPTCHA-nı və ya girişi keçmir). Təsdiq səhifəsi görünən kimi agent onu qeyd edir. Özünüz göndərmisinizsə, aşağıda bildirə bilərsiniz.</p>
          <button className={SECONDARY} disabled={!!busy} onClick={() => post('rep', `/agent/applications/${id}/reconcile`, { outcome: 'submitted' }, 'Göndərildiyini bildirdiniz. Bu, portalın təsdiqi deyil.')}>Özüm göndərdim</button>
        </section>
      )}

      {app.state === 'AWAITING_INPUT' && !handoff && questions.length > 0 && (
        <form className={BOX} aria-labelledby="qh" onSubmit={(e) => { e.preventDefault(); post('ans', `/agent/applications/${id}/answers`, { remember, answers: questions.filter((q) => answers[q.key] !== undefined).map((q) => ({ key: q.key, value: answers[q.key] })) }, 'Cavablarınız saxlanıldı.'); }}>
          <h2 id="qh" className="font-semibold">Forma bunları soruşur</h2>
          <p className="text-sm text-neutral-dark/75">AISE bu suallara təsdiqlənmiş cavablarınızdan cavab tapa bilmədi və <strong>cavab uydurmur</strong>.</p>
          {questions.map((q) => {
            const id2 = `q-${q.key.replace(/[^a-z0-9]/gi, '_')}`;
            return (
              <div key={q.key} className="space-y-1">
                <label htmlFor={id2} className="block text-sm font-medium break-words">{q.label || q.key}{q.required ? ' *' : ''}</label>
                <p className="text-xs text-neutral-dark/60">{CATEGORY[q.category] ?? ''}{q.askReason ? ` · ${ASK_REASON[q.askReason] ?? ''}` : ''}</p>
                {q.type === 'checkbox' ? (
                  <label className="flex items-center gap-2 text-sm"><input id={id2} type="checkbox" className="h-5 w-5" checked={answers[q.key] === true} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.checked }))} />Bəli, razıyam</label>
                ) : q.options?.length ? (
                  <select id={id2} className={INPUT} required={q.required} value={String(answers[q.key] ?? '')} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}><option value="">Seçin…</option>{q.options.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                ) : q.type === 'textarea' ? (
                  <textarea id={id2} className={INPUT} rows={4} required={q.required} value={String(answers[q.key] ?? '')} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} />
                ) : q.askReason === 'unsupported_control' ? (
                  <p className="text-sm text-amber-900">Bu sahəni agent doldura bilmir. Vakansiya səhifəsində özünüz müraciət edin və sonra “Özüm göndərdim” düyməsini basın.</p>
                ) : (
                  <input id={id2} className={INPUT} required={q.required} value={String(answers[q.key] ?? '')} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} />
                )}
              </div>
            );
          })}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Eyni işəgötürənin eyni sualı üçün yadda saxla (həssas və hüquqi suallar heç vaxt saxlanmır)</label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={PRIMARY} disabled={!!busy || !answeredAll}>{busy === 'ans' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Cavabları saxla</button>
            <button type="button" className={SECONDARY} disabled={!!busy} onClick={() => post('rep', `/agent/applications/${id}/reconcile`, { outcome: 'submitted' }, 'Göndərildiyini bildirdiniz. Bu, portalın təsdiqi deyil.')}>Özüm göndərdim</button>
          </div>
        </form>
      )}

      {needsApproval && (
        <section className={BOX} aria-labelledby="ap">
          <h2 id="ap" className="font-semibold">Göndərməzdən əvvəl təsdiq</h2>
          <p className="text-sm">Aşağıdakı plan <strong>dəqiq</strong> bu formaya yazılacaq və göndəriləcək. Siz təsdiqləməyincə heç nə göndərilmir. Portalın hüquqi mətni dəyişərsə, təsdiq ləğv olunur.</p>
          <button className={PRIMARY} disabled={!!busy || !app.planHash} onClick={() => post('apv', `/agent/applications/${id}/approve`, { planHash: app.planHash }, 'Təsdiqləndi. Brauzeriniz növbəti yoxlamada göndərəcək; brauzer açıq olmalıdır.')}>{busy === 'apv' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Planı təsdiqləyirəm</button>
        </section>
      )}

      {app.state === 'UNCERTAIN' && (
        <section className={BOX} aria-labelledby="un">
          <h2 id="un" className="font-semibold">Nəticə bəlli deyil</h2>
          <p className="text-sm">Müraciət çatmış ola bilər. <strong>AISE heç vaxt özü təkrar göndərmir.</strong> Portalın e-poçt təsdiqini yoxlayın (spam qovluğu da) və nəticəni bildirin:</p>
          <div className="flex flex-wrap gap-2">
            <button className={SECONDARY} disabled={!!busy} onClick={() => post('r1', `/agent/applications/${id}/reconcile`, { outcome: 'submitted' }, 'Göndərildiyini bildirdiniz. Bu, portalın təsdiqi deyil.')}>Çatıb (təsdiq aldım)</button>
            <button className={SECONDARY} disabled={!!busy} onClick={() => post('r2', `/agent/applications/${id}/reconcile`, { outcome: 'not_submitted' }, 'Forma yenidən oxunacaq; təsdiqiniz yenidən lazım olacaq.')}>Çatmayıb (yenidən cəhd)</button>
          </div>
        </section>
      )}

      {app.state === 'SUBMITTED' && (
        <section className={BOX} aria-labelledby="ev">
          <h2 id="ev" className="flex items-center gap-2 font-semibold"><ShieldCheck aria-hidden="true" className="h-5 w-5" />Nəyin göndərildiyi</h2>
          {app.confirmation === 'PORTAL' && app.evidence ? (
            <p className="text-sm">Portalın öz təsdiq səhifəsi qeyd edildi: <a className="underline break-all" href={app.evidence.confirmationUrl} target="_blank" rel="noopener noreferrer">{app.evidence.confirmationUrl}<ExternalLink aria-hidden="true" className="ml-1 inline h-3 w-3" /></a> · {formatDate(app.evidence.capturedAt)}. Bu, müraciətin portala çatdığını göstərir; işəgötürənin baxdığını və ya cavab verəcəyini yox.</p>
          ) : (
            <p className="text-sm">Göndərildiyini <strong>siz bildirdiniz</strong>; portal təsdiqləməyib və AISE bunu yoxlaya bilmir.</p>
          )}
          {app.submittedAt && <p className="text-sm text-neutral-dark/70">Vaxt: {formatDate(app.submittedAt)}</p>}
        </section>
      )}

      {app.plan && app.plan.length > 0 && (
        <section className={BOX} aria-labelledby="pl">
          <h2 id="pl" className="font-semibold">Forma belə doldurulur</h2>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Doldurulacaq sahələr və dəyərlər</caption>
            <thead><tr className="text-xs text-neutral-dark/60"><th scope="col" className="py-1 pr-3">Sahə</th><th scope="col" className="py-1 pr-3">Dəyər</th><th scope="col" className="py-1">Mənbə</th></tr></thead>
            <tbody className="divide-y divide-neutral-dark/10">
              {app.plan.map((p) => (
                <tr key={p.key}><th scope="row" className="py-2 pr-3 font-medium align-top break-words">{p.label || CATEGORY[p.category] || p.key}</th>
                  <td className="py-2 pr-3 align-top break-words">{p.action === 'file' ? `CV (SHA-256 ${app.documents.resume.sha256.slice(0, 12)}…)` : show(p.value).slice(0, 400)}</td>
                  <td className="py-2 align-top text-xs text-neutral-dark/65">{p.source === 'candidate_answer' ? 'Sizin cavabınız' : p.source === 'remembered_answer' ? 'Əvvəlki cavabınız' : p.source === 'approved_cover_note' ? 'Təsdiqlənmiş qeyd' : p.source === 'approved_letter' ? 'Bu vakansiya üçün təsdiqlədiyiniz məktub' : 'Təsdiqlənmiş məlumat'}</td></tr>
              ))}
            </tbody></table></div>
          {app.documents.letter?.enabled && !app.documents.letter.approved && (
            <p className="text-xs text-amber-900" data-testid="letter-missing">Bu vakansiya üçün təsdiqlədiyiniz məktub yoxdur: ümumi qeyd (varsa) istifadə olunur. Fərdi məktub üçün <a className="underline" href="/dashboard/resumes">Sənədlər</a> bölməsində hazırlayıb təsdiqləyin, sonra planı yenidən oxutdurun.</p>
          )}
          <p className="text-xs text-neutral-dark/60">Bu plandan kənar heç nə doldurulmur. Həssas, hüquqi və tanımadığımız sahələr boş qalır və ya sizdən soruşulur. Göndərilən CV razılaşdırdığınız fayldır: dəyişərsə göndərilmir.</p>
        </section>
      )}

      <section className={BOX} aria-labelledby="hist">
        <h2 id="hist" className="font-semibold">Tarixçə</h2>
        <ol className="space-y-1.5 text-sm">
          {app.events.map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-2"><span>{EVENT[e.kind] ?? e.kind}{e.detail && typeof e.detail.reason === 'string' && REASON[e.detail.reason] ? ` — ${REASON[e.detail.reason]}` : ''}</span><span className="text-xs text-neutral-dark/60">{formatDate(e.createdAt)}</span></li>
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        {['QUEUED', 'PREPARING', 'AWAITING_INPUT', 'READY', 'UNCERTAIN'].includes(app.state) && <button className={SECONDARY} disabled={!!busy} onClick={() => post('cx', `/agent/applications/${id}/cancel`, {}, 'Ləğv edildi.')}>Bu müraciəti ləğv et</button>}
        <a className="text-sm underline" href={app.jobUrl} target="_blank" rel="noopener noreferrer">Vakansiyaya bax<ExternalLink aria-hidden="true" className="ml-1 inline h-3 w-3" /></a>
      </div>
    </div>
  );
}
