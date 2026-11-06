'use client';

import React, { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle, ChevronLeft, Download, Loader2, MailCheck, ShieldCheck } from 'lucide-react';
import { apiFetch, downloadAuthedFile } from '@/lib/api';
import { EmailAllowanceNote, useEmailAllowance } from '@/components/email-allowance-note';
import {
  COMMON_TIMEZONES, DELIVERY, EVIDENCE, HOLD_REASONS, RECRUITMENT, TONES, failureText, fromLocalInput, toLocalInput,
  type EmailApplicationView, type RecruitmentState,
} from '@/lib/email-application';
import { formatDate } from '@/lib/format';
import { formatInterview } from '@/lib/format-az';
import { BUTTON as UI_BUTTON, LoadingState, Notice } from '@/components/ui';

const BOX = 'product-card rounded-2xl border border-neutral-dark/10 bg-background p-5 space-y-3';
const INPUT = 'w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm text-neutral-dark disabled:opacity-60';
const BUTTON = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-50';

interface ResumeOption { id: string; isBase: boolean; status: string; reviewedAt: string | null; createdAt: string; version: number; docKind?: 'CV' | 'RESUME' | 'LETTER'; matchId?: string | null }

async function errorOf(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}));
  const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
  return message || `Xəta (${res.status})`;
}

const NEXT_STATES: Record<RecruitmentState, RecruitmentState[]> = {
  NOT_SENT: [],
  SENT: ['ACKNOWLEDGED', 'INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED', 'OFFER', 'REJECTED', 'WITHDRAWN', 'HIRED'],
  ACKNOWLEDGED: ['INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED', 'OFFER', 'REJECTED', 'WITHDRAWN', 'HIRED'],
  INTERVIEW_INVITED: ['ACKNOWLEDGED', 'INTERVIEW_SCHEDULED', 'OFFER', 'REJECTED', 'WITHDRAWN', 'HIRED'],
  INTERVIEW_SCHEDULED: ['INTERVIEW_INVITED', 'OFFER', 'REJECTED', 'WITHDRAWN', 'HIRED'],
  OFFER: ['INTERVIEW_SCHEDULED', 'REJECTED', 'WITHDRAWN', 'HIRED'],
  REJECTED: ['ACKNOWLEDGED', 'INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED', 'OFFER'],
  WITHDRAWN: [],
  HIRED: ['OFFER'],
};

export default function EmailApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [app, setApp] = useState<EmailApplicationView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [testMode, setTestMode] = useState(false);
  const [resumes, setResumes] = useState<ResumeOption[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // A second tap while the approval is on its way must not send a second request (the button re-renders as disabled a moment later).
  const approving = useRef(false);

  // Review form state
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [copyToSelf, setCopyToSelf] = useState(true);
  const [resumeId, setResumeId] = useState('');
  const [ack, setAck] = useState(false);
  const [consent, setConsent] = useState(false);
  const allowance = useEmailAllowance(true);

  // Tracking form state
  const [nextState, setNextState] = useState<RecruitmentState | ''>('');
  const [note, setNote] = useState('');
  const [interviewLocal, setInterviewLocal] = useState('');
  const [zone, setZone] = useState('Asia/Baku');
  const [interviewNotes, setInterviewNotes] = useState('');
  const [reminder, setReminder] = useState(false);
  const [riskAck, setRiskAck] = useState(false);

  const adopt = useCallback((view: EmailApplicationView) => {
    setApp(view);
    setBody(view.body);
    setSubject(view.subject);
    setCopyToSelf(view.copyToSelf);
    setResumeId(view.cv.resumeId ?? '');
    setZone(view.interviewTimezone ?? 'Asia/Baku');
    setInterviewLocal(toLocalInput(view.interviewAt, view.interviewTimezone ?? 'Asia/Baku'));
    setInterviewNotes(view.interviewNotes ?? '');
    setReminder(view.reminderOptIn);
  }, []);

  const load = useCallback(async () => {
    try {
      const [res, caps] = await Promise.all([apiFetch(`/email-applications/${encodeURIComponent(id)}`, { cache: 'no-store' }), apiFetch('/email-applications/capabilities', { cache: 'no-store' })]);
      if (res.status === 404) return setLoadError('Müraciət tapılmadı.');
      if (!res.ok) return setLoadError(await errorOf(res));
      adopt(await res.json());
      if (caps.ok) setTestMode(!!(await caps.json()).testMode);
    } catch {
      setLoadError('Müraciət yüklənmədi. Bir az sonra yenidən cəhd edin.');
    }
  }, [id, adopt]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (app?.deliveryState !== 'AWAITING_APPROVAL') return;
    apiFetch('/resumes', { cache: 'no-store' }).then(async (res) => { if (res.ok) setResumes(await res.json()); }).catch(() => undefined);
  }, [app?.deliveryState]);

  const run = async (success: string, fn: () => Promise<Response>, after?: (view: EmailApplicationView) => void) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fn();
      if (!res.ok) { setError(await errorOf(res)); return null; }
      const view = await res.json();
      adopt(view);
      after?.(view);
      setNotice(success);
      return view as EmailApplicationView;
    } catch {
      setError('Bağlantı xətası. Yenidən cəhd edin.');
      return null;
    } finally {
      setBusy(false);
    }
  };
  const send = (method: string, path: string, payload?: unknown) => () => apiFetch(`/email-applications/${encodeURIComponent(id)}${path}`, { method, body: payload === undefined ? undefined : JSON.stringify(payload) });

  if (loadError) return <div className="mx-auto max-w-3xl space-y-4"><Link href="/dashboard/applications" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent"><ChevronLeft className="h-4 w-4" aria-hidden="true" /> Müraciətlərim</Link><Notice tone="error" title="Müraciət açılmadı" action={<button type="button" className={UI_BUTTON.secondary} onClick={() => { setLoadError(''); void load(); }}>Yenidən cəhd et</button>}>{loadError}</Notice></div>;
  if (!app) return <LoadingState label="Müraciət yüklənir…" />;

  const state = DELIVERY[app.deliveryState];
  const reviewing = app.deliveryState === 'AWAITING_APPROVAL';
  const pending = app.deliveryState === 'QUEUED' || app.deliveryState === 'SENDING';
  const draftDirty = body !== app.body || (!app.subjectLocked && subject !== app.subject) || copyToSelf !== app.copyToSelf || (resumeId && resumeId !== (app.cv.resumeId ?? ''));
  const canApprove = consent && (!app.instructions || ack) && !busy;

  const saveDraft = () => run('Dəyişikliklər saxlanıldı.', send('PATCH', '/draft', { body, ...(app.subjectLocked ? {} : { subject }), copyToSelf, ...(resumeId && resumeId !== app.cv.resumeId ? { resumeId } : {}) }));
  const approve = async () => {
    if (approving.current) return;
    approving.current = true;
    try {
      // Approve exactly what is on screen: unsaved edits are saved first and the new fingerprint is used.
      let hash = app.payloadSha256;
      if (draftDirty) {
        const saved = await saveDraft();
        if (!saved) return;
        hash = saved.payloadSha256;
      }
      await run('Müraciət təsdiqləndi və göndəriş növbəsinə qoyuldu. Göndərilməsi növbədən çıxanda burada görünəcək.', send('POST', '/approve', { payloadSha256: hash, consent: true, instructionsAcknowledged: ack }));
    } finally {
      approving.current = false;
    }
  };

  const statusChanged = nextState !== '' && nextState !== app.recruitmentState;
  const needsInterview = nextState === 'INTERVIEW_SCHEDULED' || (app.recruitmentState === 'INTERVIEW_SCHEDULED' && !statusChanged);
  const updateStatus = () => {
    const instant = interviewLocal ? fromLocalInput(interviewLocal, zone) : null;
    if (needsInterview && !instant) { setError('Müsahibə tarixini və saatını seçin.'); return Promise.resolve(null); }
    return run('Status yeniləndi.', send('PATCH', '/status', {
      ...(statusChanged ? { state: nextState } : {}), ...(note.trim() ? { note: note.trim() } : {}),
      ...(needsInterview && instant ? { interviewAt: instant, interviewTimezone: zone } : {}), interviewNotes, reminderOptIn: reminder,
    }), () => { setNextState(''); setNote(''); });
  };

  const forward = NEXT_STATES[app.recruitmentState];
  const trackable = !reviewing && !pending && app.deliveryState !== 'CANCELLED' && (app.recruitmentState !== 'NOT_SENT' || app.deliveryState === 'UNCERTAIN');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard/applications" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent"><ChevronLeft className="h-4 w-4" aria-hidden="true" /> Müraciətlərim</Link>
      <header>
        <h1 className="font-serif text-2xl font-bold text-neutral-dark md:text-3xl">{app.jobTitle}</h1>
        <p className="text-neutral-dark/70">{app.jobCompany} · <a href={app.jobUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline">Mənbə elanı ↗</a></p>
      </header>

      {app.preparedByAgentAt && app.deliveryState === 'AWAITING_APPROVAL' && (
        <p role="note" data-testid="prepared-by-agent" className="rounded-xl border border-primary/30 bg-highlight/40 p-3 text-sm text-neutral-dark">
          AISE bu müraciəti qaydalarınıza uyğun yeni elan üçün hazırladı ({formatDate(app.preparedByAgentAt)}). Hələ heç nə göndərilməyib. Alıcını, mətni və sənədləri yoxlayın; təsdiqlədiyiniz an göndərilən məhz budur.
          {app.asksMoreThanCv ? ' Diqqət: elan CV-dən əlavə məlumat istəyir (məsələn, maaş gözləntisi və ya sənəd); göstərişi oxuyub mətnə özünüz əlavə edin.' : ''}
        </p>
      )}
      {testMode && <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Sınaq rejimi: məktub heç yerə göndərilmir, yalnız yerli sınaq qutusunda saxlanılır.</p>}
      {notice && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <section className={BOX} aria-labelledby="status-title">
        <h2 id="status-title" className="font-serif text-lg font-bold">Vəziyyət</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${TONES[state.tone]}`}>Çatdırılma: {state.label}</span>
          <span className="inline-flex items-center rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-800">Mərhələ: {RECRUITMENT[app.recruitmentState]}</span>
          {app.mode === 'AUTOMATIC' && <span className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800">Avtomatik göndərilib</span>}
        </div>
        <p className="text-sm text-neutral-dark/80">{state.explain}</p>
        {app.holdReason && <p className="text-sm text-amber-900">{HOLD_REASONS[app.holdReason] ?? 'Gözləyir'}</p>}
        {app.deliveryState === 'FAILED' && <p className="text-sm text-red-800">{failureText(app.failureCode)}</p>}
        {(app.evidence.providerAcceptedAt || app.evidence.deliveredAt || app.evidence.bouncedAt) && (
          <dl className="grid gap-1 text-xs text-neutral-dark/70 sm:grid-cols-3">
            {app.evidence.providerAcceptedAt && <div><dt className="inline font-medium">E-poçt xidməti qəbul etdi: </dt><dd className="inline">{formatDate(app.evidence.providerAcceptedAt)}</dd></div>}
            {app.evidence.deliveredAt && <div><dt className="inline font-medium">Qəbuledicinin serveri qəbul etdi: </dt><dd className="inline">{formatDate(app.evidence.deliveredAt)}</dd></div>}
            {app.evidence.bouncedAt && <div><dt className="inline font-medium">Qaytarıldı: </dt><dd className="inline">{formatDate(app.evidence.bouncedAt)}</dd></div>}
          </dl>
        )}
        {app.recruitment && (
          <div className="rounded-xl border border-neutral-dark/10 bg-background-warm/20 p-3 space-y-1">
            <p className="text-xs font-bold text-neutral-dark">İşə qəbul mərhələsi sübutu:</p>
            <p className="text-sm">
              <span className="font-semibold">{RECRUITMENT[app.recruitment.state]}</span>
              {app.recruitment.evidence && (
                <span className="text-xs text-neutral-dark/70 ml-2">
                  (Mənbə: {EVIDENCE[app.recruitment.evidence] || app.recruitment.evidence})
                </span>
              )}
            </p>
            {app.recruitment.employerConfirmed ? (
              <p className="text-xs font-semibold text-green-800 flex items-center gap-1">
                <CheckCircle className="h-3.5 w-3.5 text-green-700" /> İşəgötürənin rəsmi cavabı ilə təsdiqlənib
              </p>
            ) : (
              <p className="text-xs text-neutral-dark/60">
                Bu məlumat e-poçt xidmətinin hadisələrinə və ya namizədin qeydinə əsaslanır; işəgötürən tərəfindən təsdiq olunmuş sayılmır.
              </p>
            )}
          </div>
        )}
        {pending && <button type="button" className={`${BUTTON} border border-red-300 text-red-700`} disabled={busy} onClick={() => run('Ləğv sorğusu qəbul edildi.', send('POST', '/cancel'))}>Göndərişi ləğv et</button>}
        {app.deliveryState === 'UNCERTAIN' && (
          <div className="space-y-2 rounded-xl bg-amber-50 p-3">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={riskAck} onChange={(e) => setRiskAck(e.target.checked)} /> Mesajın artıq çatmış ola biləcəyini və təkrar göndərişin dublikat yarada biləcəyini başa düşürəm.</label>
            <button type="button" className={`${BUTTON} bg-primary text-white`} disabled={!riskAck || busy} onClick={() => run('Təkrar göndəriş növbəyə qoyuldu.', send('POST', '/retry', { acknowledgeDuplicateRisk: true }))}>Yenidən göndər</button>
          </div>
        )}
      </section>

      {reviewing && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void approve(); }} aria-label="Müraciətin önizləməsi">
          <section className={BOX}>
            <h2 className="font-serif text-lg font-bold">1. Alıcı və göstəriş</h2>
            <div className="space-y-2">
              <p className="text-sm"><span className="font-medium">Kimə:</span> <span data-testid="recipient">{app.recipient}</span></p>
              {app.recipientEvidence && (
                <div className="rounded-xl border border-neutral-dark/10 bg-neutral-50/70 p-3 text-xs space-y-1.5 text-neutral-dark/80">
                  <p className="font-semibold text-neutral-dark">Mənbə sübutu:</p>
                  <blockquote className="italic border-l-2 border-primary/40 pl-2">
                    &ldquo;{app.recipientEvidence.excerpt}&rdquo;
                  </blockquote>
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-neutral-dark/65">
                    {app.recipientEvidence.sourceUrl && (
                      <a
                        href={app.recipientEvidence.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline font-medium"
                      >
                        Orijinal elan mənbəsi ↗
                      </a>
                    )}
                    {app.recipientEvidence.observedAt && (
                      <span>Son müşahidə tarixi: {formatDate(app.recipientEvidence.observedAt)}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-neutral-dark/65">Bu ünvan vakansiya elanında müraciət üçün göstərilib. Dəyişdirilə bilməz.</p>
            {app.instructions && (
              <>
                <blockquote className="whitespace-pre-line rounded-lg border-l-4 border-accent bg-neutral-50 p-3 text-sm" data-testid="instructions">{app.instructions}</blockquote>
                {app.instructionsExtra && (
                  <p role="note" data-testid="instructions-extra" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    Bu elan CV və məktubdan əlavə bir tapşırıq və ya material istəyə bilər (yuxarıdakı göstərişə baxın). AISE onu sizin üçün hazırlamır və göndərmir:
                    göndərişdən əvvəl göstərişi oxuyun. Tapşırığı yerinə yetirməsəniz, müraciət işəgötürənin tələbini ödəməyə bilər.
                  </p>
                )}
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Elanın müraciət göstərişini oxudum{app.instructionsExtra ? ' və əlavə tapşırığın mənim tərəfimdən ayrıca yerinə yetirilməli olduğunu başa düşürəm' : ''}.</label>
              </>
            )}
          </section>

          <section className={`${BOX} scroll-mt-6`} id="message">
            <h2 className="font-serif text-lg font-bold">2. Mövzu və məktub</h2>
            <label className="block space-y-1 text-sm font-medium">Mövzu
              <input className={INPUT} value={subject} maxLength={200} disabled={app.subjectLocked} onChange={(e) => setSubject(e.target.value)} />
            </label>
            {app.subjectLocked && <p className="text-xs text-neutral-dark/65">Mövzu vakansiya elanında göstərildiyi kimi saxlanılır.</p>}
            <label className="block space-y-1 text-sm font-medium">Məktub (e-poçtun mətni)
              <textarea className={`${INPUT} min-h-44`} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
            </label>
            <p className="text-xs text-neutral-dark/65">Başlanğıc mətn yalnız vəzifəni göstərir; qabiliyyət və ya təcrübə haqqında heç nə yazılmayıb. Göndərəcəyiniz sözləri siz seçirsiniz.</p>
          </section>

          <section className={BOX}>
            <h2 className="font-serif text-lg font-bold">3. Sənədlər və qoşmalar</h2>
            
            {/* CV Section */}
            <div className="space-y-2 border-b border-neutral-dark/10 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-neutral-dark/60">CV Sənədi (Məcburi)</p>
                <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border ${app.cv.kind === 'tailored' ? 'bg-green-50 text-green-800 border-green-200' : 'bg-amber-50 text-amber-900 border-amber-200'}`}>
                  {app.cv.kind === 'tailored' ? 'Fərdiləşdirilmiş CV' : 'Əsas CV'}
                </span>
              </div>
              <p className="text-sm"><span className="font-medium">{app.cv.fileName}</span> · {app.cv.kind === 'tailored' ? 'Fərdiləşdirilmiş (təsdiqlənmiş) CV' : 'Əsas CV'} · <span className="font-mono text-xs">{app.cv.sha256.slice(0, 12)}</span></p>

              {app.cv.kind !== 'tailored' ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-950 space-y-1">
                  <p className="font-semibold">Qeyd: Bu müraciətə ümumi Əsas CV qoşulub</p>
                  <p>Bu vakansiya üçün ayrıca fərdiləşdirilmiş və təsdiqlənmiş CV tapılmadı və ya seçilmədi. Əsas CV ilə təsdiqləyib göndərə bilərsiniz və ya vakansiyaya uyğunlaşdırılmış CV hazırlayıb təsdiqlədikdən sonra buradan seçə bilərsiniz.</p>
                </div>
              ) : (
                <p className="text-xs text-green-800">✓ Bu vakansiya üçün xüsusi fərdiləşdirilmiş və təsdiqlənmiş CV qoşulub.</p>
              )}

              <button type="button" className={`${BUTTON} border border-neutral-dark/20`} onClick={() => void downloadAuthedFile(`/email-applications/${encodeURIComponent(id)}/cv`, app.cv.fileName)}><Download className="h-4 w-4" aria-hidden="true" /> CV-ni yüklə və yoxla</button>
              {resumes.length > 1 && (
                <label className="block space-y-1 text-sm font-medium">Başqa CV seç
                  <select className={INPUT} value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                    {resumes.filter((r) => r.status === 'READY' && r.docKind !== 'LETTER' && (r.isBase || r.reviewedAt)).map((r) => <option key={r.id} value={r.id}>{r.isBase ? 'Əsas CV' : 'Fərdiləşdirilmiş CV'} · v{r.version} · {formatDate(r.createdAt)}</option>)}
                  </select>
                </label>
              )}
            </div>

            {/* Letter Section */}
            <div className="space-y-2 pt-1">
              <p className="text-xs font-bold uppercase tracking-wider text-neutral-dark/60">Motivasiya məktubu (istəyə bağlı)</p>
              {app.letter ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border border-neutral-dark/10 bg-background-warm/30">
                  <div>
                    <p className="text-sm font-semibold text-neutral-dark">{app.letter.fileName}</p>
                    <p className="text-xs text-neutral-dark/60 font-mono">SHA-256: {app.letter.sha256.slice(0, 12)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={`${BUTTON} border border-neutral-dark/20 text-xs py-1.5`}
                      onClick={() => void downloadAuthedFile(`/email-applications/${encodeURIComponent(id)}/letter`, app.letter!.fileName)}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" /> Yüklə
                    </button>
                    <button
                      type="button"
                      className={`${BUTTON} border border-red-200 text-red-700 text-xs py-1.5`}
                      disabled={busy}
                      onClick={() => run('Motivasiya məktubu çıxarıldı.', send('PATCH', '/draft', { removeLetter: true }))}
                    >
                      Çıxar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-neutral-dark/65">Bu vakansiya üçün təsdiqlənmiş motivasiya məktubunuz varsa, müraciətə əlavə edə bilərsiniz.</p>
                  {resumes.filter((r) => !r.isBase && r.status === 'READY' && r.docKind === 'LETTER').length > 0 && (
                    <div className="flex items-center gap-2">
                      <select
                        id="select-letter"
                        className={INPUT}
                        onChange={(e) => {
                          if (e.target.value) {
                            run('Motivasiya məktubu əlavə edildi.', send('PATCH', '/draft', { letterId: e.target.value }));
                          }
                        }}
                        defaultValue=""
                      >
                        <option value="" disabled>Təsdiqlənmiş məktub seçin...</option>
                        {resumes.filter((r) => !r.isBase && r.status === 'READY' && r.docKind === 'LETTER').map((l) => (
                          <option key={l.id} value={l.id}>Motivasiya məktubu · {formatDate(l.createdAt)}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            <p className="text-xs text-neutral-dark/65 pt-2">Təsdiq anında seçilmiş sənədlərin dəyişməz nüsxəsi götürülür. Sonradan sənədi redaktə etsəniz, göndərilən nüsxə dəyişmir.</p>
          </section>

          <section className={BOX}>
            <h2 className="font-serif text-lg font-bold">4. Nə paylaşılır</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm">{app.sharing.map((item) => <li key={item}>{item}</li>)}</ul>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={copyToSelf} onChange={(e) => setCopyToSelf(e.target.checked)} /> Eyni məktubun surətini mənə də göndər (gizli surət).</label>
            {app.senderAddress && <p className="text-sm break-all">Göndərən: {app.senderName} &lt;{app.senderAddress}&gt;. Cavab ünvanı: {app.replyTo}.</p>}
            <p className="flex items-start gap-2 text-xs text-neutral-dark/65"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> Cavablar birbaşa e-poçt ünvanınıza ({app.replyTo}) gələcək. Göndərişin işəgötürənə çatdığına və ya oxunduğuna AISE zəmanət vermir.</p>
          </section>

          <section className={BOX}>
            <label className="flex items-start gap-2 text-sm font-medium"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>Yuxarıdakı məzmunun <strong data-testid="consent-recipient" className="break-all">{app.recipient}</strong> ünvanına göndərilməsinə razıyam.</span></label>
            <EmailAllowanceNote allowance={allowance} />
            {!canApprove && !busy && <p className="text-xs text-neutral-dark/70" id="approve-why">{!consent && app.instructions && !ack ? 'Göndərmək üçün elanın göstərişini oxuduğunuzu və göndərişə razılığınızı işarələyin.' : !consent ? 'Göndərmək üçün yuxarıdakı razılığı işarələyin.' : 'Göndərmək üçün elanın göstərişini oxuduğunuzu təsdiqləyin.'}</p>}
            <div className="ui-sticky-actions flex flex-wrap gap-3">
              <button type="submit" className={UI_BUTTON.primary} aria-describedby={!canApprove ? 'approve-why' : undefined} aria-busy={busy} disabled={!canApprove || (allowance?.limit != null && (allowance.remaining ?? 0) <= 0)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MailCheck className="h-4 w-4" aria-hidden="true" />} {busy ? 'Göndərilir…' : draftDirty ? 'Saxla, təsdiq et və göndər' : 'Təsdiq et və göndər'}</button>
              <button type="button" className={UI_BUTTON.secondary} disabled={busy || !draftDirty} onClick={() => void saveDraft()}>Dəyişiklikləri saxla</button>
              <button type="button" className={UI_BUTTON.danger} disabled={busy} onClick={() => { if (window.confirm('Bu müraciət göndərilməyəcək. Keçmək istəyirsiniz?')) void run('Müraciət keçildi; heç nə göndərilmədi.', send('POST', '/cancel')); }}>Keç, göndərmə</button>
            </div>
          </section>
        </form>
      )}

      {!reviewing && (
        <section className={BOX} aria-labelledby="sent-title">
          <h2 id="sent-title" className="font-serif text-lg font-bold">Göndərilən məzmun</h2>
          <p className="text-sm"><span className="font-medium">Kimə:</span> {app.recipient}</p>
          <p className="text-sm"><span className="font-medium">Mövzu:</span> {app.subject}</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-sm">{app.body}</pre>
          <div className="flex flex-wrap gap-2 pt-2">
            {app.cv.fileName && app.deliveryState !== 'CANCELLED' && (
              <button type="button" className={`${BUTTON} border border-neutral-dark/20`} onClick={() => void downloadAuthedFile(`/email-applications/${encodeURIComponent(id)}/cv`, app.cv.fileName)}>
                <Download className="h-4 w-4" aria-hidden="true" /> Göndərilən CV nüsxəsi
              </button>
            )}
            {app.letter?.fileName && app.deliveryState !== 'CANCELLED' && (
              <button type="button" className={`${BUTTON} border border-neutral-dark/20`} onClick={() => void downloadAuthedFile(`/email-applications/${encodeURIComponent(id)}/letter`, app.letter!.fileName)}>
                <Download className="h-4 w-4" aria-hidden="true" /> Göndərilən məktub nüsxəsi
              </button>
            )}
          </div>
        </section>
      )}

      {trackable && (
        <section className={BOX} aria-labelledby="track-title">
          <h2 id="track-title" className="font-serif text-lg font-bold">Müraciətin gedişatı</h2>
          <p className="text-sm text-neutral-dark/75">Mərhələni siz yeniləyirsiniz. E-poçt xidmətinin hadisəsi işəgötürənin müraciətə baxdığını göstərmir.</p>
          <label className="block space-y-1 text-sm font-medium">Yeni mərhələ
            <select className={INPUT} value={nextState} onChange={(e) => setNextState(e.target.value as RecruitmentState | '')}>
              <option value="">Dəyişmə ({RECRUITMENT[app.recruitmentState]})</option>
              {(app.recruitmentState === 'NOT_SENT' ? (['ACKNOWLEDGED', 'INTERVIEW_INVITED', 'INTERVIEW_SCHEDULED', 'OFFER', 'REJECTED', 'HIRED'] as RecruitmentState[]) : forward).map((s) => <option key={s} value={s}>{RECRUITMENT[s]}</option>)}
            </select>
          </label>
          {needsInterview && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1 text-sm font-medium">Müsahibə tarixi və saatı
                <input type="datetime-local" className={INPUT} value={interviewLocal} onChange={(e) => setInterviewLocal(e.target.value)} />
              </label>
              <label className="block space-y-1 text-sm font-medium">Saat qurşağı
                <select className={INPUT} value={zone} onChange={(e) => setZone(e.target.value)}>{[...new Set([zone, ...COMMON_TIMEZONES])].map((z) => <option key={z} value={z}>{z}</option>)}</select>
              </label>
            </div>
          )}
          {(needsInterview || app.interviewAt) && (
            <>
              <label className="block space-y-1 text-sm font-medium">Müsahibə qeydləri (yalnız sizə görünür)
                <textarea className={`${INPUT} min-h-20`} value={interviewNotes} maxLength={2000} onChange={(e) => setInterviewNotes(e.target.value)} />
              </label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={reminder} onChange={(e) => setReminder(e.target.checked)} /> Müsahibədən 24 saat əvvəl mənə e-poçtla xatırlat.</label>
            </>
          )}
          <label className="block space-y-1 text-sm font-medium">Qeyd (istəyə bağlı)
            <input className={INPUT} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="button" className={`${BUTTON} bg-primary text-white`} disabled={busy || (!statusChanged && !needsInterview && !app.interviewAt)} onClick={() => void updateStatus()}>Yadda saxla</button>
          {app.interviewAt && <p className="text-sm">Təyin olunan müsahibə: <strong>{formatInterview(app.interviewAt, app.interviewTimezone ?? 'UTC')}</strong></p>}
        </section>
      )}

      {app.replies && app.replies.length > 0 && (
        <section className={BOX} aria-labelledby="replies-title">
          <h2 id="replies-title" className="font-serif text-lg font-bold">Yönləndirilmiş cavablar</h2>
          <p className="text-xs text-neutral-dark/65">Yalnız mövzu və göndərən saxlanılır. Əlavələr açılmır və saxlanılmır. Təklif edilən mərhələ yalnız sizin təsdiqinizlə tətbiq olunur.</p>
          <ul className="divide-y divide-neutral-dark/10">
            {app.replies.map((r) => (
              <li key={r.id} className="space-y-2 py-3 text-sm">
                <p className="font-medium">{r.subject || '(mövzu yoxdur)'} <span className="text-xs font-normal text-neutral-dark/60">· {formatDate(r.receivedAt)}{r.attachmentCount ? ` · ${r.attachmentCount} əlavə (açılmır)` : ''}</span></p>
                {r.status === 'PENDING_REVIEW' && r.suggestedState && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span>Təklif: <strong>{RECRUITMENT[r.suggestedState]}</strong> ({r.suggestionReason})</span>
                    <button type="button" className={`${BUTTON} bg-primary text-white`} disabled={busy} onClick={() => run('Mərhələ təsdiqləndi.', send('POST', `/replies/${r.id}`, { accept: true }))}>Təsdiq et</button>
                    <button type="button" className={`${BUTTON} border border-neutral-dark/20`} disabled={busy} onClick={() => run('Təklif rədd edildi.', send('POST', `/replies/${r.id}`, { accept: false }))}>Rədd et</button>
                  </div>
                )}
                {r.status !== 'PENDING_REVIEW' && <p className="text-xs text-neutral-dark/60">{r.status === 'CONFIRMED' ? 'Təsdiqləndi' : 'Nəzərə alınmadı'}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {app.inboundAddress && (
        <p className="text-xs text-neutral-dark/65">İstəsəniz, işəgötürənin cavabını bu ünvana yönləndirə bilərsiniz: <span className="font-mono">{app.inboundAddress}</span></p>
      )}

      {app.history && app.history.length > 0 && (
        <section className={BOX} aria-labelledby="history-title">
          <h2 id="history-title" className="font-serif text-lg font-bold">Tarixçə</h2>
          <ol className="space-y-2 text-sm">
            {app.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>{h.from ? `${RECRUITMENT[h.from]} → ` : ''}<strong>{RECRUITMENT[h.to]}</strong>{h.note ? ` · ${h.note}` : ''}</span>
                <span className="text-xs text-neutral-dark/60">{EVIDENCE[h.evidence] ?? h.evidence} · {formatDate(h.at)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="text-xs text-neutral-dark/60">E-poçt müraciətlərini dayandırmaq, gözləyənləri ləğv etmək və ya razılığı geri götürmək üçün <Link href="/dashboard/email-applications/settings" className="text-accent underline">idarəetmə səhifəsinə</Link> keçin.</p>
    </div>
  );
}
