'use client';

import React, { useEffect, useRef, useState, useId } from 'react';
import { X, FileText, Sparkles, Briefcase, Globe, Check, AlertCircle, ArrowRight, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { CareerEvidenceState } from '@/lib/career-evidence';
import { createRequestIdKeeper } from '@/lib/documents/request-id';
import { useDialogFocus } from '@/lib/documents/use-dialog-focus';
import { refusalMessage, type QuoteRefusal } from '@/lib/documents/refusal';
import { CandidatePreparationSheet } from './candidate-preparation-sheet';

export type DocumentKind = 'RESUME' | 'CV' | 'LETTER';

export interface ActionableMatchOption {
  id: string;
  title: string;
  company: string;
  location?: string;
  /** Set for a saved posting that has no recommendation of its own: the match is created (hidden) on selection. */
  savedRef?: string;
}

interface CreateDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  baseResumeId?: string | null;
  candidateEvidence?: CareerEvidenceState;
  initialMatchId?: string | null;
  initialSavedRef?: string | null;
  initialKind?: DocumentKind;
  initialLanguage?: string;
  onStartLetterFlow?: (job: {
    matchId?: string;
    title: string;
    company: string;
    language?: string;
    selectedCareerEntryIds?: string[];
    letterInputs?: {
      whyRole?: string | null;
      formative?: string | null;
      whyCompany?: string | null;
      contribution?: string | null;
    } | null;
  }) => void;
  onSuccess?: (createdDocument?: any) => void;
}

const LANGUAGES = [
  { code: 'az', label: 'Azərbaycan dili' },
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'tr', label: 'Türkçe' },
];

export function CreateDocumentModal({
  isOpen,
  onClose,
  baseResumeId,
  candidateEvidence,
  initialMatchId,
  initialSavedRef,
  initialKind,
  initialLanguage,
  onStartLetterFlow,
  onSuccess,
}: CreateDocumentModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  const [kind, setKind] = useState<DocumentKind>(initialKind || 'RESUME');
  const [language, setLanguage] = useState(initialLanguage || 'az');
  const [matches, setMatches] = useState<ActionableMatchOption[]>([]);
  const [selectedOptionId, setSelectedMatchId] = useState<string>(initialMatchId || '');
  const [loadingMatches, setLoadingMatches] = useState(false);
  // A saved posting becomes a match only when it is chosen; its id is kept here.
  const [savedMatchIds, setSavedMatchIds] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState(false);
  const [prepSaving, setPrepSaving] = useState(false);
  const [targetResolutionError, setTargetResolutionError] = useState<string | null>(null);
  const selectedMatchId = selectedOptionId.startsWith('saved:') ? savedMatchIds[selectedOptionId] ?? '' : selectedOptionId;

  // Quoting state
  const [quote, setQuote] = useState<{
    units: number;
    affordable: boolean;
    refusal: QuoteRefusal | null;
    detectedLanguage?: string;
    remainingAfter?: number | null;
  } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedMotivation, setConfirmedMotivation] = useState<{
    whyRole?: string;
    formative?: string;
    whyCompany?: string;
    contribution?: string;
  } | null>(null);

  const [selectedCareerEntryIds, setSelectedCareerEntryIds] = useState<string[] | undefined>();

  useEffect(() => {
    setConfirmedMotivation(null);
    setSelectedCareerEntryIds(undefined);
  }, [selectedMatchId]);


  // Idempotency key: kept only while the outcome of an identical request is unknown (see lib/documents/request-id.ts).
  const requestIds = useRef(createRequestIdKeeper());

  // A new creation session never inherits the previous one's key or error.
  useEffect(() => {
    if (isOpen) {
      requestIds.current.settle();
      setSubmitError(null);
      setTargetResolutionError(null);
      setConfirmedMotivation(null);
      setSelectedCareerEntryIds(undefined);
      if (initialMatchId) setSelectedMatchId(initialMatchId);
      if (initialKind) setKind(initialKind);
      if (initialLanguage) setLanguage(initialLanguage);
    }
  }, [isOpen, initialMatchId, initialKind, initialLanguage]);

  // Focus moves into the dialog, stays inside it, Escape closes it and focus returns to the opener.
  useDialogFocus(isOpen, dialogRef, onClose);

  // Fetch actionable matches (and the candidate's saved postings, whatever their score) when the modal opens
  useEffect(() => {
    if (!isOpen) return;
    setLoadingMatches(true);
    setTargetResolutionError(null);
    Promise.all([
      apiFetch('/matches').then((res) => (res.ok ? res.json() : [])).catch(() => []),
      apiFetch('/saved-jobs').then((res) => (res.ok ? res.json() : [])).catch(() => []),
    ])
      .then(async ([data, savedRows]: [any[], any[]]) => {
        const active: ActionableMatchOption[] = (Array.isArray(data) ? data : [])
          .filter((m) => m.actionable !== false)
          .map((m) => ({
            id: m.id,
            title: m.job?.title || m.vacancy?.title || 'Vakansiya',
            company: m.job?.company || m.vacancy?.company?.name || 'Şirkət',
            location: m.job?.location || m.vacancy?.location,
          }));
        const known = new Set((Array.isArray(data) ? data : []).map((m) => (m.job?.id ? `imported:${m.job.id}` : m.vacancy?.id ? `native:${m.vacancy.id}` : '')));
        const saved: ActionableMatchOption[] = (Array.isArray(savedRows) ? savedRows : [])
          .filter((r) => r?.state === 'open' && typeof r?.ref === 'string' && !known.has(r.ref))
          .map((r) => ({ id: `saved:${r.ref}`, savedRef: r.ref as string, title: r.title || 'Vakansiya', company: r.company || '', location: r.location || undefined }));
        const all = [...active, ...saved];

        // If an explicit target was requested (initialMatchId)
        const targetId = initialMatchId || selectedOptionId;
        if (targetId) {
          // 1. Is targetId already in active matches or saved options?
          const found = all.find((o) => o.id === targetId);
          if (found) {
            setMatches(all);
            setSelectedMatchId(found.id);
            return;
          }

          // 2. Could targetId be a saved option ID (saved:...)?
          if (targetId.startsWith('saved:')) {
            const savedOpt = saved.find((o) => o.id === targetId);
            if (savedOpt) {
              setMatches(all);
              setSelectedMatchId(savedOpt.id);
              return;
            }
          }

          // 3. Otherwise targetId is a match ID (e.g. a hidden unscored document match for a saved job).
          // Attempt authenticated match-resolution via GET /matches/:id
          try {
            const res = await apiFetch(`/matches/${encodeURIComponent(targetId)}`);
            if (res.ok) {
              const match = await res.json();
              if (match && match.actionable !== false) {
                const restoredOption: ActionableMatchOption = {
                  id: match.id,
                  title: match.job?.title || match.vacancy?.title || 'Vakansiya',
                  company: match.job?.company || match.vacancy?.company?.name || 'Şirkət',
                  location: match.job?.location || match.vacancy?.location,
                  savedRef: match.ref || initialSavedRef || undefined,
                };
                setMatches([restoredOption, ...all.filter((o) => o.id !== restoredOption.id)]);
                setSelectedMatchId(restoredOption.id);
                if (restoredOption.savedRef) {
                  setSavedMatchIds((m) => ({ ...m, [`saved:${restoredOption.savedRef}`]: match.id }));
                }
                return;
              }
            }
          } catch {
            // Handled below by target resolution error
          }

          // 4. Target could not be resolved! Never silently generate for another vacancy!
          setMatches(all);
          setSelectedMatchId('');
          setTargetResolutionError('Seçilmiş vakansiya tapılmadı və ya artıq aktiv deyil. Zəhmət olmasa siyahıdan başqa bir vakansiya seçin.');
          return;
        }

        // Default open without preselected target: pick first
        setMatches(all);
        setSelectedMatchId(all.length > 0 ? all[0].id : '');
      })
      .catch(() => {
        setMatches([]);
        setSelectedMatchId('');
      })
      .finally(() => {
        setLoadingMatches(false);
      });
  }, [isOpen, initialMatchId, initialSavedRef]);

  // A saved posting without a recommendation of its own is turned into a (hidden) match the moment it is chosen.
  useEffect(() => {
    if (!isOpen || !selectedOptionId.startsWith('saved:') || savedMatchIds[selectedOptionId]) return;
    let active = true;
    setResolving(true);
    setQuoteError(null);
    apiFetch('/documents/saved-job-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: selectedOptionId.slice('saved:'.length) }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || 'Bu saxlanmış elan üçün sənəd hazırlamaq mümkün olmadı.');
        if (active && typeof body.matchId === 'string') setSavedMatchIds((m) => ({ ...m, [selectedOptionId]: body.matchId }));
      })
      .catch((err) => {
        if (active) setQuoteError(err.message || 'Bu saxlanmış elan üçün sənəd hazırlamaq mümkün olmadı.');
      })
      .finally(() => {
        if (active) setResolving(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, selectedOptionId, savedMatchIds]);

  // Run Quote whenever matchId, kind or language changes
  useEffect(() => {
    if (!isOpen || !selectedMatchId) {
      setQuote(null);
      return;
    }

    let active = true;
    // A quote belongs to the exact inputs it was asked for: while a new one is being fetched the old cost is not shown and cannot be used.
    setQuote(null);
    setQuoting(true);
    setQuoteError(null);

    apiFetch('/documents/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: selectedMatchId,
        items: [{ kind, language }],
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Qiymət sorğusu uğursuz oldu');
        }
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        if (!data || typeof data.units !== 'number' || typeof data.affordable !== 'boolean') {
          setQuote(null);
          setQuoteError('Serverdən etibarlı qiymət məlumatı alına bilmədi.');
          return;
        }
        setQuote({
          units: data.units,
          affordable: data.affordable,
          refusal: data.refusal && typeof data.refusal === 'object' ? (data.refusal as QuoteRefusal) : null,
          detectedLanguage: data.detectedLanguage,
          remainingAfter: data.remainingAfter,
        });
      })
      .catch((err) => {
        if (!active) return;
        setQuoteError(err.message || 'Balans və qiymət yoxlanıla bilmədi');
        setQuote(null);
      })
      .finally(() => {
        if (active) setQuoting(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, selectedMatchId, kind, language]);

  if (!isOpen) return null;

  const selectedMatch = matches.find((m) => m.id === selectedOptionId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (prepSaving) {
      setSubmitError('Bacarıqların profilə əlavə edilməsi davam edir; zəhmət olmasa tamamlanmasını gözləyin.');
      return;
    }

    // Letter flow handoff
    if (kind === 'LETTER') {
      if (onStartLetterFlow) {
        onStartLetterFlow({
          matchId: selectedMatchId || undefined,
          title: selectedMatch?.title || 'Seçilmiş vəzifə',
          company: selectedMatch?.company || 'Hədəf şirkət',
          language,
          selectedCareerEntryIds,
          letterInputs: confirmedMotivation ? {
            whyRole: confirmedMotivation.whyRole,
            formative: confirmedMotivation.formative,
            whyCompany: confirmedMotivation.whyCompany,
            contribution: confirmedMotivation.contribution,
          } : undefined,
        });
        onClose();
        return;
      }
    }

    if (!selectedMatchId) {
      setSubmitError('Sənəd hazırlamaq üçün aktiv bir vakansiya uyğunluğu seçilməlidir.');
      return;
    }

    if (!quote || !quote.affordable) {
      setSubmitError(refusalMessage(quote?.refusal ?? null));
      return;
    }

    setSubmitting(true);
    try {
      const letterInputs = confirmedMotivation ? {
        whyRole: confirmedMotivation.whyRole,
        formative: confirmedMotivation.formative,
        whyCompany: confirmedMotivation.whyCompany,
        contribution: confirmedMotivation.contribution,
      } : undefined;
      const request = {
        matchId: selectedMatchId,
        items: [{ kind, language }],
        expectedUnits: quote.units,
        ...(selectedCareerEntryIds !== undefined ? { selectedCareerEntryIds } : {}),
        ...(kind === 'LETTER' && letterInputs ? {
          letter: {
            motivation: letterInputs.whyRole || undefined,
            formative: letterInputs.formative || undefined,
            companyReason: letterInputs.whyCompany || undefined,
            contribution: letterInputs.contribution || undefined,
          },
        } : {}),
      };
      let res: Response;
      let data: any = null;
      try {
        res = await apiFetch('/documents/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...request, requestId: requestIds.current.forRequest(request) }),
        });
        data = await res.json().catch(() => null);
        // A success status whose body never arrived (the connection was cut mid-answer) is as unknown as no answer at all.
        if (res.ok && !data) throw new Error('unreadable answer');
      } catch {
        // No usable answer arrived: the document may or may not exist. The key is kept, so pressing the button again repeats the SAME request —
        // the server returns what it already made and charges nothing a second time.
        setSubmitError('Serverdən cavab alınmadı; sənədin yaradılıb-yaradılmadığı bilinmir. Yenidən basın: eyni sorğu təkrarlanacaq və ikinci dəfə generasiya sayılmayacaq.');
        return;
      }
      // Any answer ends this attempt: the next press is a new request.
      requestIds.current.settle();

      if (!res.ok) {
        const errData = data ?? {};
        if (res.status === 409 && errData.code === 'COST_MISMATCH') {
          throw new Error('Dəyər dəyişib; qiymət yenilənir. Zəhmət olmasa yenidən yoxlayın.');
        }
        if (res.status === 402 || res.status === 429) {
          throw new Error(refusalMessage({ code: errData.code, ...errData }));
        }
        throw new Error(errData.message || 'Sənəd yaradıla bilmədi.');
      }

      const createdDoc = Array.isArray(data.documents) ? data.documents[0] : null;
      if (createdDoc?.status === 'FAILED') throw new Error(createdDoc.statusError || 'Sənəd yaradıla bilmədi. Balansdan heç nə çıxılmadı.');

      // Only on real server success
      if (onSuccess) onSuccess(createdDoc);
      onClose();
    } catch (err: any) {
      setSubmitError(err.message || 'Sənəd yaradıla bilmədi.');
    } finally {
      setSubmitting(false);
    }
  };

  const isAffordable = quote ? quote.affordable === true : false;
  const canSubmit = !submitting && !quoting && !resolving && !prepSaving && !targetResolutionError && Boolean(selectedMatchId) && Boolean(quote) && isAffordable;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-doc-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-dark/40 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-xl rounded-3xl bg-surface border border-outline-variant p-6 sm:p-8 shadow-xl space-y-6 max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-outline-variant/60 pb-4">
          <div>
            <h2 id="create-doc-title" className="font-serif text-2xl font-bold text-on-background">
              Yeni sənəd hazırla
            </h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Harvard CV şablonu əsasında təmiz və oxunaqlı sənəd formatı
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-on-surface-variant hover:text-on-background hover:bg-surface-container transition-colors min-h-11 min-w-11 flex items-center justify-center focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
            aria-label="Bağla"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {submitError && (
          <div role="alert" className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
            <span>{submitError}</span>
          </div>
        )}

        {targetResolutionError && (
          <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <span className="font-semibold block">Seçilmiş vakansiya bərpa edilə bilmədi</span>
              <p className="text-amber-800 leading-relaxed">{targetResolutionError}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Target Job / Match Selector */}
          <div className="space-y-2">
            <label htmlFor="target-match-select" className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Hədəf vakansiya uyğunluğu
            </label>
            {loadingMatches ? (
              <div className="text-xs text-neutral-dark/60 py-2">Uyğunluqlar yüklənir...</div>
            ) : matches.length === 0 ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                Sənəd hazırlamaq üçün aktiv elan tapılmadı. Əvvəlcə{' '}
                <a href="/jobs" className="underline font-semibold text-primary">
                  Vakansiyalar
                </a>{' '}
                bölməsindən bir elanı “Saxla” ilə yadda saxlayın; saxlanmış istənilən açıq elan üçün sənəd hazırlaya bilərsiniz.
              </div>
            ) : (
              <select
                id="target-match-select"
                value={selectedOptionId}
                onChange={(e) => {
                  setSelectedMatchId(e.target.value);
                  setTargetResolutionError(null);
                }}
                className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2.5 text-sm text-on-background focus:ring-2 focus:ring-primary"
              >
                {!selectedOptionId && (
                  <option value="" disabled>
                    Zəhmət olmasa vakansiya seçin
                  </option>
                )}
                {matches.filter((m) => !m.savedRef).length > 0 && (
                  <optgroup label="Sizə uyğun gələnlər">
                    {matches.filter((m) => !m.savedRef).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title} — {m.company} {m.location ? `(${m.location})` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {matches.filter((m) => m.savedRef).length > 0 && (
                  <optgroup label="Saxladığınız elanlar (uyğunluq xalından asılı olmayaraq)">
                    {matches.filter((m) => m.savedRef).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title} — {m.company} {m.location ? `(${m.location})` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
          </div>

          {/* Candidate Preparation Sheet: skill confirmation and profile guidance */}
          {selectedMatchId && (
            <CandidatePreparationSheet
              matchId={selectedMatchId}
              savedRef={matches.find((m) => m.id === selectedOptionId)?.savedRef || initialSavedRef || undefined}
              kind={kind}
              language={language}
              onMutationChange={(isPending) => setPrepSaving(isPending)}
              onMotivationConfirmed={setConfirmedMotivation}
              onEvidenceToggled={setSelectedCareerEntryIds}
            />
          )}

          {/* Document Kind Selector */}
          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Sənədin növü
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Option 1: Resume */}
              <button
                type="button"
                onClick={() => setKind('RESUME')}
                className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all min-h-24 ${
                  kind === 'RESUME'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-outline-variant bg-surface hover:border-outline'
                }`}
              >
                <div>
                  <div className="font-bold text-sm text-on-background">Rezüme (Resume)</div>
                  <div className="text-[11px] text-on-surface-variant mt-1 leading-snug">
                    Vakansiyaya uyğunlaşdırılmış hədəfli format; ən vacib nailiyyətlər önə çıxarılır
                  </div>
                </div>
                {kind === 'RESUME' && <Check className="h-4 w-4 text-primary mt-2" />}
              </button>

              {/* Option 2: Full CV */}
              <button
                type="button"
                onClick={() => setKind('CV')}
                className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all min-h-24 ${
                  kind === 'CV'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-outline-variant bg-surface hover:border-outline'
                }`}
              >
                <div>
                  <div className="font-bold text-sm text-on-background">Geniş CV</div>
                  <div className="text-[11px] text-on-surface-variant mt-1 leading-snug">
                    Bütün təsdiqlənmiş iş təcrübəsi, sertifikat və layihələri əhatə edən tam sənəd
                  </div>
                </div>
                {kind === 'CV' && <Check className="h-4 w-4 text-primary mt-2" />}
              </button>

              {/* Option 3: Motivation Letter */}
              <button
                type="button"
                onClick={() => setKind('LETTER')}
                className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all min-h-24 ${
                  kind === 'LETTER'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-outline-variant bg-surface hover:border-outline'
                }`}
              >
                <div>
                  <div className="font-bold text-sm text-on-background">Motivasiya məktubu</div>
                  <div className="text-[11px] text-on-surface-variant mt-1 leading-snug">
                    Seçilmiş vakansiya üçün faktiki sübutlara əsaslanan fərdi müşayiət məktubu
                  </div>
                </div>
                {kind === 'LETTER' && <Check className="h-4 w-4 text-primary mt-2" />}
              </button>
            </div>

            <p className="text-[11px] text-on-surface-variant leading-relaxed bg-surface-container-low p-3 rounded-xl border border-outline-variant/60">
              <strong>Fərq nədədir?</strong> AISE-də <em>Rezüme</em> konkret vakansiyanın tələblərinə yönəlmiş hədəfli sənəddir; <em>CV</em> isə bütün iş təcrübənizi, sertifikat və fəaliyyətlərinizi saxlayan daha geniş sənəddir. Heç bir sənəd üçün dəqiq səhifə sayı məhdudiyyəti qoyulmur.
            </p>
          </div>

          {/* Language Selector */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Sənədin dili
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setLanguage(lang.code)}
                  className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                    language === lang.code
                      ? 'border-primary bg-primary text-white'
                      : 'border-outline-variant bg-surface text-on-background hover:bg-surface-container'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {kind !== 'LETTER' && (
            <p className="text-[11px] text-on-surface-variant leading-relaxed">
              Hansı layihə, sertifikat və fəaliyyətlərin sənədə düşəcəyini hazırlıqdan sonra yoxlama mərhələsində siz seçirsiniz; yalnız təsdiqlədiyiniz qeydlər istifadə olunur.
            </p>
          )}

          {/* Quoted Cost & Allowance Indicator */}
          <div className="rounded-xl bg-surface-container-low border border-outline-variant/60 p-3 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">Generasiya dəyəri:</span>
              <span className="font-bold text-primary">
                {quoting ? 'Hesablanır...' : quote ? `${quote.units} generasiya` : '—'}
              </span>
            </div>
            {quote && quote.remainingAfter !== undefined && quote.remainingAfter !== null && (
              <div className="flex items-center justify-between text-[11px] text-neutral-dark/70 border-t border-outline-variant/40 pt-1">
                <span>Generasiyadan sonra qalan balans:</span>
                <span className="font-semibold text-neutral-dark">{quote.remainingAfter} ədəd</span>
              </div>
            )}
            {quote && !quote.affordable && (
              <div role="status" className="text-red-700 font-semibold text-[11px] pt-1">
                {refusalMessage(quote.refusal)}
              </div>
            )}
            {quoteError && (
              <div className="text-amber-700 text-[11px] pt-1">
                {quoteError}
              </div>
            )}
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-outline-variant/60">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-xl border border-outline-variant px-5 py-2 text-xs font-semibold text-on-background hover:bg-surface-container transition-colors"
            >
              Ləğv et
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="min-h-11 inline-flex items-center gap-2 product-action rounded-full bg-primary px-6 py-2.5 text-xs font-bold text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {kind === 'LETTER' ? (
                <>
                  <span>Məktub axınına keç</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              ) : (
                <>
                  {submitting ? (
                    <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>{submitting ? 'Yaradılır...' : 'Sənədi Hazırla'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
