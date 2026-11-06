'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  FileText,
  Building2,
  Briefcase,
  HelpCircle,
  Copy,
  Check,
  Download,
  RefreshCw,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { MotivationProposals } from './motivation-proposals';
import { apiFetch } from '@/lib/api';
import { getDocumentsMode } from '@/lib/documents/mode';
import { careerEntriesToEvidenceState, type BackendCareerEntry, type CareerEvidenceState } from '@/lib/career-evidence';
import { createRequestIdKeeper } from '@/lib/documents/request-id';
import { refusalMessage, type QuoteRefusal } from '@/lib/documents/refusal';

export interface TargetJobContext {
  id?: string;
  title: string;
  company: string;
  location?: string | null;
  requirements?: string;
  matchId?: string | null;
  language?: string;
  selectedCareerEntryIds?: string[];
  letterInputs?: {
    motivation?: string | null;
    companyReason?: string | null;
    formative?: string | null;
    contribution?: string | null;
    whyRole?: string | null;
    whyCompany?: string | null;
    storyIds?: string[];
  } | null;
}

interface MotivationLetterComposerProps {
  initialJob?: TargetJobContext;
  /** Open an existing letter (pending, draft or approved) instead of writing a new one: it follows the same pending → review → approve path. */
  existingDocumentId?: string;
  candidateName: string;
  candidateEvidence?: CareerEvidenceState;
  onClose: () => void;
  onSuccess?: () => void;
}

const FIELD_CLASS =
  'block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all';
const LABEL_CLASS = 'block text-xs font-semibold text-neutral-dark/85 mb-1';

/**
 * Short answer options for an optional question. A chip puts a complete first-person sentence (or a sentence start ending in "…") into the answer box, where the
 * candidate can edit or delete it: nothing is sent that is not visible in the box, and the box can always hold free text.
 */
function AnswerChips({ testId, options, onPick }: { testId: string; options: string[]; onPick: (text: string) => void }) {
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId} role="group" aria-label="Nümunə cavablar">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onPick(o)}
          className="rounded-full border border-outline-variant bg-surface px-2.5 py-1 text-[11px] text-on-background hover:bg-surface-container text-left"
        >
          {o}
        </button>
      ))}
    </div>
  );
}

const ATTRACT_OPTIONS = [
  'Müştərilərlə birbaşa işləməyi və onların problemini həll etməyi sevirəm.',
  'Dəqiqlik və səliqə tələb edən işə yaxınlığım var.',
  'Rəqəmlər, hesabat və məlumatlarla işləməyi sevirəm.',
  'Komandada işləyib ümumi nəticəyə töhfə verməyi sevirəm.',
  'Bu sahədə öyrənib irəliləmək istəyirəm.',
];
// Founder review of a composed letter (17 October 2026): finished generic sentences ("Vəzifənin məsuliyyət dairəsi mənim üçün maraqlı gəlir.") were
// printed word for word and said nothing about this employer or this candidate. These options only start the sentence; the answer is sent once the
// candidate has finished it with something specific (see `unfinished`).
const HOOK_OPTIONS = [
  'Elandakı bu iş mənə tanışdır: …',
  'Şirkətin fəaliyyət sahəsi mənə yaxındır, çünki …',
  'Bu vəzifədə məni ən çox maraqlandıran iş: …',
];
const CONTRIBUTION_OPTIONS = [
  'Tapşırıqları vaxtında və dəqiq yerinə yetirirəm; məsələn, …',
  'İş proseslərinin təhlili və hesabatların hazırlanmasında dəqiqlik nümayiş etdirirəm; məsələn, …',
  'Hesabat və qeydləri səliqəli aparıram; məsələn, …',
];
const PLACEHOLDER_ELLIPSIS = '…';
/** A chip that starts a sentence ends in "…"; an answer that still ends so is unfinished and is not sent. */
const unfinished = (t: string) => t.trim().endsWith(PLACEHOLDER_ELLIPSIS);

export function MotivationLetterComposer({
  initialJob,
  existingDocumentId,
  candidateName,
  candidateEvidence,
  onClose,
  onSuccess,
}: MotivationLetterComposerProps) {
  const mode = getDocumentsMode();
  const isPreview = mode === 'preview';

  // Wizard steps: 0 = Job info, 1 = Evidence & 4 questions, 2 = Review & Approve, 3 = Pending Server Generation, 4 = Failed State
  const [step, setStep] = useState<number>(existingDocumentId ? 3 : initialJob ? 1 : 0);

  // Job state
  const [jobTitle, setJobTitle] = useState(initialJob?.title || '');
  const [companyName, setCompanyName] = useState(initialJob?.company || '');
  const [requirements, setRequirements] = useState(initialJob?.requirements || '');
  const [language, setLanguage] = useState<string>((initialJob?.language as string) || 'az');

  // 4 Guiding Questions State
  const [whyRole, setWhyRole] = useState(
    initialJob?.letterInputs?.whyRole || initialJob?.letterInputs?.motivation || '',
  );
  const [whyCompany, setWhyCompany] = useState(
    initialJob?.letterInputs?.whyCompany || initialJob?.letterInputs?.companyReason || '',
  );
  const [formative, setFormative] = useState(initialJob?.letterInputs?.formative || '');
  const [contribution, setContribution] = useState(initialJob?.letterInputs?.contribution || '');
  const [selectedProject, setSelectedProject] = useState('');
  const [whatDidAndResult, setWhatDidAndResult] = useState('');
  const [extraHighlights, setExtraHighlights] = useState('');
  const [numbersConfirmed, setNumbersConfirmed] = useState(false);

  // A previous letter may concern a different occupation. Offer its answers,
  // but never silently insert them into a new vacancy's motivation.
  const [previousAnswerState, setPreviousAnswers] = useState<{ matchId?: string; formative?: string; contribution?: string }>({});
  const previousAnswers = previousAnswerState.matchId === initialJob?.matchId ? previousAnswerState : {};
  useEffect(() => {
    if (isPreview || !initialJob?.matchId) return;
    let active = true;
    apiFetch('/documents/letter-answers')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setPreviousAnswers({
          matchId: initialJob.matchId ?? undefined,
          formative: typeof data.formative === 'string' ? data.formative.trim() : undefined,
          contribution: typeof data.contribution === 'string' ? data.contribution.trim() : undefined,
        });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [isPreview, initialJob?.matchId]);

  // Selected bullet points from confirmed evidence
  const [selectedEvidenceBullets, setSelectedEvidenceBullets] = useState<string[]>([]);

  // Quote state
  const [quote, setQuote] = useState<{ units: number; affordable: boolean; refusal: QuoteRefusal | null } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Draft letter state
  const [draftLetter, setDraftLetter] = useState('');
  const [paragraphs, setParagraphs] = useState<Array<{ id?: string; text: string; approved?: boolean }>>([]);
  const [serverDocumentId, setServerDocumentId] = useState<string | null>(existingDocumentId ?? null);
  const [untranslatedFields, setUntranslatedFields] = useState<Array<{ path: string; text: string; section?: string }>>([]);
  const [acknowledgeUntranslated, setAcknowledgeUntranslated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [approved, setApproved] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Idempotency key: kept only while the outcome of an identical request is unknown (see lib/documents/request-id.ts).
  const requestIds = useRef(createRequestIdKeeper());

  // The candidate's CONFIRMED career entries come from the career-entries API (the only source of facts); the prop is a fallback for callers that
  // already hold them. Nothing unconfirmed and nothing invented is ever offered.
  const [loadedEvidence, setLoadedEvidence] = useState<CareerEvidenceState | null>(null);
  useEffect(() => {
    if (isPreview) return;
    let active = true;
    apiFetch('/profile/career-entries?status=CONFIRMED')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        const entries = (Array.isArray(data) ? data : data.entries || []) as BackendCareerEntry[];
        setLoadedEvidence(careerEntriesToEvidenceState(entries));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [isPreview]);
  const evidenceSource = loadedEvidence ?? candidateEvidence;

  // Strictly filter only CONFIRMED items for factual generation
  const availableProjects = (evidenceSource?.projects || []).filter(
    (p) => Boolean(p.name?.trim()) && p.confirmed === true,
  );
  const availableVolunteering = (evidenceSource?.volunteering || []).filter(
    (v) => Boolean((v.role || v.organization)?.trim()) && v.confirmed === true,
  );
  const availableCertifications = (evidenceSource?.certifications || []).filter(
    (c) => Boolean(c.title?.trim()) && c.confirmed === true,
  );

  // Fetch pre-flight quote whenever matchId or language changes
  useEffect(() => {
    if (!initialJob?.matchId || isPreview) {
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
        matchId: initialJob.matchId,
        items: [{ kind: 'LETTER', language }],
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
        // Require valid quote numbers; NEVER default malformed responses to affordable: true
        if (!data || typeof data.units !== 'number' || typeof data.affordable !== 'boolean') {
          setQuote(null);
          setQuoteError('Serverdən etibarlı qiymət məlumatı alına bilmədi.');
          return;
        }
        setQuote({
          units: data.units,
          affordable: data.affordable,
          refusal: data.refusal && typeof data.refusal === 'object' ? (data.refusal as QuoteRefusal) : null,
        });
      })
      .catch((err) => {
        if (!active) return;
        setQuote(null);
        setQuoteError(err.message || 'Balans və qiymət yoxlanıla bilmədi');
      })
      .finally(() => {
        if (active) setQuoting(false);
      });

    return () => {
      active = false;
    };
  }, [initialJob?.matchId, language, isPreview]);

  // Bounded backoff polling when document is PENDING (step === 3)
  useEffect(() => {
    if (step !== 3 || !serverDocumentId) return;

    let isMounted = true;
    let attempts = 0;
    let timeoutId: NodeJS.Timeout;

    const poll = async () => {
      try {
        const pollRes = await apiFetch(`/documents/${serverDocumentId}`);
        if (!isMounted) return;

        if (pollRes.ok) {
          const finalDoc = await pollRes.json();
          if (finalDoc.status === 'NEEDS_REVIEW' || finalDoc.status === 'READY') {
            setUntranslatedFields(Array.isArray(finalDoc.untranslated) ? finalDoc.untranslated : []);
            // Opened from the list: the vacancy and language come from the server's record of this document.
            if (finalDoc.posting?.title) setJobTitle(finalDoc.posting.title);
            if (finalDoc.posting?.company) setCompanyName(finalDoc.posting.company);
            if (finalDoc.language) setLanguage(finalDoc.language);
            if (finalDoc.letterInputs) {
              if (finalDoc.letterInputs.motivation) setWhyRole((cur) => cur || finalDoc.letterInputs.motivation);
              if (finalDoc.letterInputs.companyReason) setWhyCompany((cur) => cur || finalDoc.letterInputs.companyReason);
              if (finalDoc.letterInputs.formative) setFormative((cur) => cur || finalDoc.letterInputs.formative);
              if (finalDoc.letterInputs.contribution) setContribution((cur) => cur || finalDoc.letterInputs.contribution);
            }
            setApproved(finalDoc.status === 'READY');
            if (finalDoc.content?.paragraphs && Array.isArray(finalDoc.content.paragraphs)) {
              setParagraphs(finalDoc.content.paragraphs);
              const fullText = finalDoc.content.paragraphs.map((p: any) => p.text).join('\n\n');
              setDraftLetter(fullText);
            } else if (finalDoc.content?.text) {
              setDraftLetter(finalDoc.content.text);
            }
            setStep(2);
            return;
          }

          if (finalDoc.status === 'FAILED') {
            setError(finalDoc.statusError || 'Server generasiyası uğursuz oldu. Balansınızdan heç nə çıxılmadı.');
            setStep(4);
            return;
          }
        }
      } catch {
        // Network hiccup during poll: keep document pending and retry
      }

      attempts++;
      // Bounded backoff: 1.0s, 1.5s, 2.0s … max 5.0s
      const delay = Math.min(1000 + attempts * 500, 5000);
      if (isMounted) {
        timeoutId = setTimeout(poll, delay);
      }
    };

    timeoutId = setTimeout(poll, 800);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [step, serverDocumentId]);

  // Generate draft letter: server-side when matchId exists, or honest local draft
  const generateDraft = async () => {
    if (!jobTitle.trim() || !companyName.trim()) {
      setError('Zəhmət olmasa vakansiyanın adını və şirkəti daxil edin.');
      return;
    }
    if ([whyRole, whyCompany, formative, contribution].some(unfinished)) {
      setError('Nümunə cavabın cümləsini tamamlayın (… ilə bitən xana) və ya həmin xananı təmizləyin.');
      return;
    }
    setError(null);

    // A real match outside preview mode: the draft comes from the server or not at all. A failure never turns into a locally written letter.
    if (initialJob?.matchId && !isPreview) {
      if (!quote || !quote.affordable) {
        setError(refusalMessage(quote?.refusal ?? null));
        return;
      }

      setGenerating(true);
      try {
        // 1. Persist the candidate's own answers as a CONFIRMED STORY entry (the career-entry contract). If that fails nothing is generated: the
        //    letter must not silently lose answers the candidate just wrote.
        let createdStoryId: string | null = null;
        if (whatDidAndResult.trim() || selectedProject.trim() || extraHighlights.trim()) {
          const storyTitle = `${jobTitle.slice(0, 60)} @ ${companyName.slice(0, 60)} - Müraciət hekayəsi`;
          const storyPayload = {
            kind: 'STORY' as const,
            title: storyTitle,
            organization: companyName.slice(0, 160) || null,
            role: jobTitle.slice(0, 120) || null,
            situation: selectedProject.trim() ? selectedProject.trim().slice(0, 800) : null,
            action: (whatDidAndResult.trim() || extraHighlights.trim()) ? (whatDidAndResult.trim() || extraHighlights.trim()).slice(0, 800) : null,
            result: whatDidAndResult.trim() ? whatDidAndResult.trim().slice(0, 800) : null,
            description: [
              whatDidAndResult.trim(),
              extraHighlights.trim() ? `Əlavə qeydlər: ${extraHighlights.trim()}` : '',
            ]
              .filter(Boolean)
              .join('\n\n')
              .slice(0, 1500) || null,
          };

          const storyRes = await apiFetch('/profile/career-entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(storyPayload),
          });

          if (storyRes.ok) {
            const created = await storyRes.json().catch(() => ({}));
            if (!created?.id) throw new Error('Cavablarınız yadda saxlanıla bilmədi; məktub hazırlanmadı.');
            createdStoryId = created.id;
          } else if (storyRes.status === 409) {
            const conflictData = await storyRes.json().catch(() => ({}));
            if (!conflictData?.existingId) throw new Error('Cavablarınız yadda saxlanıla bilmədi; məktub hazırlanmadı.');
            const patchRes = await apiFetch(`/profile/career-entries/${conflictData.existingId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...storyPayload, status: 'CONFIRMED' }),
            });
            if (!patchRes.ok) throw new Error('Cavablarınız yadda saxlanıla bilmədi; məktub hazırlanmadı.');
            createdStoryId = conflictData.existingId;
          } else {
            const sErr = await storyRes.json().catch(() => ({}));
            throw new Error(sErr.message || 'Cavablarınız yadda saxlanıla bilmədi; məktub hazırlanmadı.');
          }
        }

        // 2. Prepare motivation text (the candidate's own reason, within 2000 chars)
        // Only the candidate's own reason goes in as the motivation; extra points travel as evidence (the story above), not as a reason.
        const motivationText = whyRole.trim() ? whyRole.trim().slice(0, 2000) : undefined;
        // Why this employer: only the candidate's own words, or nothing (the letter then states no reason for the employer).
        const companyReasonText = whyCompany.trim() ? whyCompany.trim().slice(0, 1000) : undefined;
        const formativeText = formative.trim() ? formative.trim().slice(0, 1000) : undefined;
        const contributionText = contribution.trim() ? contribution.trim().slice(0, 1000) : undefined;

        // 3. Submit the generate request with the selected language. The key lives only while an identical request has no answer yet.
        const request = {
          matchId: initialJob.matchId ?? undefined,
          items: [{ kind: 'LETTER', language }],
          expectedUnits: quote.units,
          ...(initialJob.selectedCareerEntryIds !== undefined ? { selectedCareerEntryIds: initialJob.selectedCareerEntryIds } : {}),
          letter: { motivation: motivationText, companyReason: companyReasonText, formative: formativeText, contribution: contributionText, storyIds: createdStoryId ? [createdStoryId] : undefined },
        };
        let genRes: Response;
        let genData: any = null;
        try {
          genRes = await apiFetch('/documents/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...request, requestId: requestIds.current.forRequest(request) }),
          });
          genData = await genRes.json().catch(() => null);
          // A success status whose body never arrived (the connection was cut mid-answer) is as unknown as no answer at all.
          if (genRes.ok && !genData) throw new Error('unreadable answer');
        } catch {
          setError('Serverdən cavab alınmadı; məktubun yaradılıb-yaradılmadığı bilinmir. Yenidən basın: eyni sorğu təkrarlanacaq və ikinci dəfə generasiya sayılmayacaq.');
          return;
        }
        requestIds.current.settle();

        if (!genRes.ok) {
          const gErr = genData ?? {};
          if (genRes.status === 409 && gErr.code === 'COST_MISMATCH') {
            throw new Error('Dəyər dəyişdi. Zəhmət olmasa yenidən cəhd edin.');
          }
          if (genRes.status === 402 || genRes.status === 429) {
            throw new Error(refusalMessage({ code: gErr.code, ...gErr }));
          }
          throw new Error(gErr.message || 'Məktub generasiyası başladıla bilmədi.');
        }

        const doc = Array.isArray(genData.documents) ? genData.documents[0] : null;
        if (!doc?.id) throw new Error('Sənəd ID-si qəbul olunmadı.');

        setServerDocumentId(doc.id);

        if (doc.status === 'FAILED') {
          throw new Error(doc.statusError || 'Server generasiyası uğursuz oldu. Balansınızdan heç nə çıxılmadı.');
        }
        // PENDING (the normal case) → the honest pending state; a draft appears only when the server has one.
        setStep(3);
      } catch (err: any) {
        setError(err.message || 'Serverdə generasiya xətası baş verdi.');
      } finally {
        setGenerating(false);
      }
      return;
    }

    // Honest local draft without server (or in preview mode):
    const localText = assembleHonestLocalDraft();
    setDraftLetter(localText);
    setStep(2);
  };

  const assembleHonestLocalDraft = () => {
    const whyText = whyRole.trim()
      ? whyRole.trim()
      : `${companyName} şirkətində ${jobTitle} vəzifəsinə müraciət edirəm.`;

    const projectText = selectedProject.trim()
      ? `Təsdiqlənmiş layihə təcrübəsi: ${selectedProject.trim()}`
      : '';

    const actionResultText = whatDidAndResult.trim()
      ? whatDidAndResult.trim()
      : '';

    const extraText = extraHighlights.trim()
      ? extraHighlights.trim()
      : '';

    const bulletList =
      selectedEvidenceBullets.length > 0
        ? `\n\nFaktiki sübutlar:\n${selectedEvidenceBullets.map((b) => `• ${b}`).join('\n')}`
        : '';

    const sections = [
      `Hörmətli ${companyName} komandası,`,
      `${jobTitle} vəzifəsi üzrə elanınızı maraqla nəzərdən keçirdim və bu rola müraciət etmək istəyirəm.`,
      whyText,
      [projectText, actionResultText].filter(Boolean).join('\n') + bulletList,
      extraText,
      `Hörmətlə,\n${candidateName || 'Namizəd'}`,
    ].filter(Boolean);

    return sections.join('\n\n');
  };

  const handleCopy = () => {
    if (!draftLetter) return;
    navigator.clipboard.writeText(draftLetter);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApprove = async () => {
    if (serverDocumentId) {
      setApproving(true);
      setError(null);
      try {
        // 1. PATCH /documents/:id/review must succeed before approval
        if (paragraphs.length > 0) {
          const reviewRes = await apiFetch(`/documents/${serverDocumentId}/review`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paragraphs }),
          });
          if (!reviewRes.ok) {
            const rErr = await reviewRes.json().catch(() => ({}));
            throw new Error(rErr.message || 'Məktub redaktələri yadda saxlanıla bilmədi; təsdiqləmə dayandırıldı.');
          }
        }

        // The canonical documents route returns the current revision and the exact fields the translation checker still flags.
        const detailRes = await apiFetch(`/documents/${serverDocumentId}`);
        if (!detailRes.ok) throw new Error('Sənədin son versiyası yoxlanıla bilmədi; təsdiqləmə dayandırıldı.');
        const latest = await detailRes.json();
        const remaining = Array.isArray(latest.untranslated) ? latest.untranslated : [];
        const revision = latest.reviewNotes?.revision ?? latest.version ?? 0;
        setUntranslatedFields(remaining);
        if (remaining.length > 0 && !acknowledgeUntranslated) {
          throw new Error('Tərcümə olunmamış hissələri yoxlayın və bu formada təsdiqləmək üçün aşağıdakı seçimi qeyd edin.');
        }

        // 2. Approve ONLY after review succeeds
        const approveRes = await apiFetch(`/documents/${serverDocumentId}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(remaining.length > 0
            ? { acknowledgeUntranslated: true, reviewedRevision: revision }
            : {}),
        });
        if (!approveRes.ok) {
          const aErr = await approveRes.json().catch(() => ({}));
          throw new Error(aErr.message || 'Məktub təsdiqlənə bilmədi.');
        }

        // 3. Verify the approved document has an ID
        const approvedDoc = await approveRes.json().catch(() => ({}));
        if (!approvedDoc || !approvedDoc.id) {
          throw new Error('Təsdiqlənmiş sənəd ID-si cavabda tapılmadı.');
        }

        setApproved(true);
        if (onSuccess) onSuccess();
      } catch (err: any) {
        setError(err.message || 'Təsdiqləmə zamanı xəta baş verdi.');
        // If saving edits fails, keep draft open and do NOT approve old content
      } finally {
        setApproving(false);
      }
      return;
    }

    setApproved(true);
    if (onSuccess) onSuccess();
  };

  const handleDownloadPdf = async () => {
    if (!serverDocumentId) return;
    setDownloading(true);
    try {
      const res = await apiFetch(`/documents/${serverDocumentId}/preview`);
      if (!res.ok) throw new Error('PDF faylı alına bilmədi');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Motivasiya-Məktubu-${companyName.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'PDF yüklənməsi uğursuz oldu.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="product-card rounded-2xl bg-surface border border-outline-variant p-6 shadow-sm space-y-6 max-w-3xl mx-auto animate-in fade-in duration-300"
      data-testid="motivation-letter-composer"
    >
      {/* Top Banner for Local Preview Mode */}
      {isPreview ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
          <Sparkles className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <strong>Yerli sınaq rejimi:</strong> Rəsmi sənəd generasiyası serverdə təsdiqlənmiş faktlar əsasında icra olunacaq. Nümayiş olunan mətn yerli qaralamadır.
          </div>
        </div>
      ) : !initialJob?.matchId ? (
        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-3 text-xs text-on-surface-variant flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <strong>Fərdi qaralama rejimi:</strong> Aktiv vakansiya uyğunluğu seçilməyib. Məktub qaralamanızı burada hazırlayıb yoxlaya və kopyalayaraq istifadə edə bilərsiniz.
          </div>
        </div>
      ) : null}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-outline-variant/60 pb-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
            Harvard stilində müşayiət məktubu
          </span>
          <h1 className="font-serif text-2xl font-bold text-on-background mt-0.5">
            Motivasiya məktubu redaktoru
          </h1>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 px-3 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-on-background hover:bg-surface-container transition-colors"
        >
          Bağla
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* ──────────────── STEP 0: TARGET JOB INFO ──────────────── */}
      {step === 0 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-on-background">1. Vakansiya məlumatları</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="comp-job-title" className={LABEL_CLASS}>Vəzifənin adı *</label>
              <input
                id="comp-job-title"
                className={FIELD_CLASS}
                placeholder="məs. Senior Frontend Mühəndisi"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="comp-company-name" className={LABEL_CLASS}>Şirkətin adı *</label>
              <input
                id="comp-company-name"
                className={FIELD_CLASS}
                placeholder="məs. ABB Bank ASC"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="comp-job-reqs" className={LABEL_CLASS}>Vakansiyanın əsas tələbləri (istəyə bağlı)</label>
            <textarea
              id="comp-job-reqs"
              rows={3}
              className={FIELD_CLASS}
              placeholder="Elanın əsas tələbləri və ya mətni..."
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => {
                if (!jobTitle.trim() || !companyName.trim()) {
                  setError('Zəhmət olmasa vakansiyanın adını və şirkəti daxil edin.');
                  return;
                }
                setError(null);
                setStep(1);
              }}
              className="min-h-11 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-xs font-bold text-white hover:bg-primary-hover transition-colors"
            >
              <span>Növbəti: Faktlar və suallar</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ──────────────── STEP 1: GUIDING QUESTIONS & EVIDENCE ──────────────── */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="border-b border-outline-variant/60 pb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-on-background">2. Dəstəkləyici faktlar və 4 istəyə bağlı sual</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Vakansiya: <strong>{jobTitle}</strong> @ <strong>{companyName}</strong>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="letter-lang" className="text-xs font-semibold text-neutral-dark/85">Dil:</label>
              <select
                id="letter-lang"
                className="rounded-xl border border-neutral-dark/20 bg-background px-3 py-1.5 text-xs text-neutral-dark font-medium"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="az">Azərbaycan dili (az)</option>
                <option value="en">English (en)</option>
                <option value="ru">Русский (ru)</option>
                <option value="tr">Türkçe (tr)</option>
              </select>
            </div>
          </div>

          <p className="rounded-xl bg-surface-container-low border border-outline-variant/60 p-3 text-xs text-on-surface-variant leading-relaxed" data-testid="questions-optional-note">
            Bütün suallar istəyə bağlıdır. Boş buraxmaq və ya «bilmirəm» demək düzgündür: məktub yalnız təsdiqlənmiş faktlarınızdan hazırlanacaq, olmayan həvəs, səbəb və ya nəticə əlavə edilməyəcək.
            Nə qədər konkret yazsanız, məktub bir o qədər xüsusi olacaq. Profilinizdə artıq təsdiqlənmiş faktları təkrar yazmayın: yalnız onlarda olmayan səbəbi və təcrübənin sizin üçün mənasını yazın.
          </p>

          {(previousAnswers.formative || previousAnswers.contribution) && (
            <details className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-primary" data-testid="reused-answers-note">
              <summary className="cursor-pointer font-medium">Əvvəlki məktubumdakı cavablara bax</summary>
              <p className="mt-2">Bu cavablar yeni məktuba əlavə edilməyib. Yalnız bu vakansiyaya uyğun olanı seçin.</p>
              {previousAnswers.formative && <div className="mt-3"><p className="leading-relaxed">{previousAnswers.formative}</p><button type="button" className="underline min-h-10" onClick={() => setFormative(previousAnswers.formative!)}>Əvvəlki təcrübə cavabımı istifadə et</button></div>}
              {previousAnswers.contribution && <div className="mt-3"><p className="leading-relaxed">{previousAnswers.contribution}</p><button type="button" className="underline min-h-10" onClick={() => setContribution(previousAnswers.contribution!)}>Əvvəlki töhfə cavabımı istifadə et</button></div>}
            </details>
          )}

          {!isPreview && initialJob?.matchId && <MotivationProposals
            matchId={initialJob.matchId} language={language}
            values={{ whyRole, whyCompany, formative, contribution }}
            onAdopt={(field, text) => {
              if (field === 'whyRole') setWhyRole(text);
              else if (field === 'whyCompany') setWhyCompany(text);
              else if (field === 'formative') setFormative(text);
              else setContribution(text);
            }}
          />}

          {/* Sual 1: Bu işin sizi konkret nə cəlb edir? */}
          <div className="space-y-1.5">
            <label htmlFor="q-why-role" className={LABEL_CLASS}>
              1. Bu işin sizi konkret nə cəlb edir? (istəyə bağlı)
            </label>
            {language === 'az' && <AnswerChips testId="chips-why-role" options={ATTRACT_OPTIONS} onPick={(t) => setWhyRole((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t))} />}
            <textarea
              id="q-why-role"
              rows={2}
              className={FIELD_CLASS}
              placeholder="Öz sözlərinizlə yazın və ya yuxarıdakı cavabı seçib dəyişin. Bilmirsinizsə, boş buraxın: məktub səbəb uydurmayacaq."
              value={whyRole}
              onChange={(e) => setWhyRole(e.target.value)}
            />
          </div>

          {/* Sual 2: Hansı təcrübə bu marağı aydınlaşdırdı? */}
          <div className="space-y-1.5">
            <label htmlFor="q-formative" className={LABEL_CLASS}>
              2. Hansı təcrübə bu marağı sizin üçün aydınlaşdırdı? (istəyə bağlı)
            </label>
            {language === 'az' && (
              <AnswerChips
                testId="chips-formative"
                options={[
                  ...(availableProjects.length ? ['Layihədə işləyərkən …'] : []),
                  'İş yerimdə müştəri ilə işləyərkən …',
                  'Komandada işləyərkən …',
                ]}
                onPick={(t) => setFormative((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t))}
              />
            )}
            <textarea
              id="q-formative"
              rows={2}
              className={FIELD_CLASS}
              placeholder="Bir cümlə ilə: nə baş verdi və bu işdə sizin üçün nəyi aydınlaşdırdı?"
              value={formative}
              onChange={(e) => setFormative(e.target.value)}
            />
          </div>

          {/* Sual 3: Bu vakansiyada və ya şirkətdə diqqətinizi nə çəkdi? */}
          <div className="space-y-1.5">
            <label htmlFor="q-why-company" className={LABEL_CLASS}>
              3. Bu vakansiyada və ya şirkətdə diqqətinizi nə çəkdi? (istəyə bağlı)
            </label>
            {language === 'az' && <AnswerChips testId="chips-why-company" options={HOOK_OPTIONS} onPick={(t) => setWhyCompany((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t))} />}
            <textarea
              id="q-why-company"
              rows={2}
              className={FIELD_CLASS}
              placeholder="Yalnız həqiqətən bildiyiniz və ya sizə doğru gələn məqamı yazın (elanın hansı hissəsi, şirkətin xidməti). Bilmirsinizsə, boş buraxın: şirkət haqqında tərif yazılmayacaq."
              value={whyCompany}
              onChange={(e) => setWhyCompany(e.target.value)}
            />
          </div>

          {/* Sual 4: Hansı töhfə və ya nəticəni işəgötürən görsün? */}
          <div className="space-y-1.5">
            <label htmlFor="q-contribution" className={LABEL_CLASS}>
              4. İşəgötürənin nəzərə almasını istədiyiniz hansı töhfə və ya nəticə var? (istəyə bağlı)
            </label>
            {language === 'az' && <AnswerChips testId="chips-contribution" options={CONTRIBUTION_OPTIONS} onPick={(t) => setContribution((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t))} />}
            <textarea
              id="q-contribution"
              rows={2}
              className={FIELD_CLASS}
              placeholder="Real bir nəticə və ya sizdə olan, işə yarayan bir vərdiş. Rəqəm yazırsınızsa, real olsun."
              value={contribution}
              onChange={(e) => setContribution(e.target.value)}
            />
          </div>

          {/* Sual 2: Hansı təcrübəniz bu vəzifəyə ən yaxşı sübutdur? */}
          <div className="space-y-2">
            <label className={LABEL_CLASS}>
              5. Bu vəzifə ilə bağlı hansı təcrübəniz və ya layihəniz ən yaxşı nümunədir? (istəyə bağlı)
            </label>

            {(availableProjects.length > 0 || availableVolunteering.length > 0 || availableCertifications.length > 0) && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] font-semibold text-on-surface-variant">Yalnız təsdiqlənmiş faktlarınız:</p>
                <div className="flex flex-wrap gap-2">
                  {availableProjects.map((p) => {
                    const isSelected = selectedProject === p.name;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedProject(isSelected ? '' : p.name);
                          if (!isSelected && p.description && !whatDidAndResult) {
                            setWhatDidAndResult(p.description);
                          }
                        }}
                        className={`min-h-11 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-outline-variant bg-surface hover:bg-surface-container text-on-background'
                        }`}
                      >
                        {p.name} (Təsdiqlənib ✓)
                      </button>
                    );
                  })}
                  {availableVolunteering.map((v) => {
                    const title = v.role ? `${v.role} (${v.organization || 'Könüllü'})` : (v.organization || 'Könüllü');
                    const isSelected = selectedProject === title;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setSelectedProject(isSelected ? '' : title);
                          if (!isSelected && v.description && !whatDidAndResult) {
                            setWhatDidAndResult(v.description);
                          }
                        }}
                        className={`min-h-11 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-outline-variant bg-surface hover:bg-surface-container text-on-background'
                        }`}
                      >
                        {title} (Təsdiqlənib ✓)
                      </button>
                    );
                  })}
                  {availableCertifications.map((c) => {
                    const isSelected = selectedProject === c.title;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedProject(isSelected ? '' : c.title);
                        }}
                        className={`min-h-11 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-outline-variant bg-surface hover:bg-surface-container text-on-background'
                        }`}
                      >
                        {c.title} (Təsdiqlənib ✓)
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <input
              className={FIELD_CLASS}
              placeholder="və ya təsdiqlənmiş layihənin adını daxil edin"
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
            />
          </div>

          {/* Sual 3: Nə etdiniz və nəticəsi nə oldu? */}
          <div className="space-y-1.5">
            <label htmlFor="q-what-result" className={LABEL_CLASS}>
              6. Bu nümunədə şəxsən nə etdiniz və nəticəsi nə oldu? (istəyə bağlı)
            </label>
            <textarea
              id="q-what-result"
              rows={3}
              className={FIELD_CLASS}
              placeholder="məs. Mikroservisləri optimallaşdırdım və yüklənmə vaxtını 40% azaltdım..."
              value={whatDidAndResult}
              onChange={(e) => setWhatDidAndResult(e.target.value)}
            />
            <label className="inline-flex items-center gap-2 cursor-pointer pt-1 text-xs text-on-surface-variant">
              <input
                type="checkbox"
                checked={numbersConfirmed}
                onChange={(e) => setNumbersConfirmed(e.target.checked)}
                className="rounded border-outline-variant text-primary focus:ring-primary h-4 w-4"
              />
              <span>Qeyd etdiyim rəqəmlər və nailiyyətlər real təcrübəmə əsaslanır.</span>
            </label>
          </div>

          {/* Sual 4: Əlavə məqamlar */}
          <div className="space-y-1.5">
            <label htmlFor="q-extra" className={LABEL_CLASS}>
              7. CV-də əks olunmayan və ya xüsusi vurğulamaq istədiyiniz başqa bir məqam varmı? (istəyə bağlı)
            </label>
            <textarea
              id="q-extra"
              rows={2}
              className={FIELD_CLASS}
              placeholder="məs. Komandada mentorluq etmək həvəsim və ya sahəyə xüsusi marağım..."
              value={extraHighlights}
              onChange={(e) => setExtraHighlights(e.target.value)}
            />
          </div>

          {/* Pre-submission generation cost notice */}
          {initialJob?.matchId && !isPreview && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-primary flex items-center justify-between">
              <span>Dəyər: <strong>{quoting ? 'Hesablanır...' : quote ? `${quote.units} sənəd generasiyası` : '—'}</strong></span>
              <span className="text-[11px]">Uğursuz cəhdlər balansı azaltmır</span>
            </div>
          )}

          {quoteError && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
              {quoteError}
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-outline-variant/60">
            <button
              type="button"
              onClick={() => setStep(0)}
              className="min-h-11 rounded-xl border border-outline-variant px-4 py-2 text-xs font-semibold text-on-background hover:bg-surface-container"
            >
              Geri
            </button>
            <button
              type="button"
              onClick={generateDraft}
              disabled={generating || quoting || (Boolean(initialJob?.matchId && !isPreview) && (!quote || !quote.affordable))}
              className="min-h-11 inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-xs font-semibold text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {generating ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Serverdə hazırlanır...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  <span>Qaralamanı hazırla</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ──────────────── STEP 3: PENDING GENERATION STATE ──────────────── */}
      {step === 3 && (
        <div className="space-y-6 py-6 text-center" data-testid="letter-pending-state">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
            <RefreshCw className="h-7 w-7 animate-spin" aria-hidden="true" />
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <h2 className="text-lg font-bold text-on-background">
              Motivasiya məktubu serverdə hazırlanır...
            </h2>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              Təsdiqlənmiş sübutlarınız və vəzifə tələbləri əsasında fərdiləşdirilmiş mətn generasiya edilir. Bu proses adətən 10–30 saniyə çəkir.
            </p>
          </div>

          <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs text-amber-800">
            <Clock className="h-3.5 w-3.5" />
            <span>Server statusu: <strong>PENDING</strong> (Gözlənilir)</span>
          </div>

          <div className="pt-4 border-t border-outline-variant/60 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-xl border border-outline-variant px-5 py-2 text-xs font-semibold text-on-background hover:bg-surface-container"
            >
              CV və sənədlərə qayıt (Hazır olanda baxa bilərsiniz)
            </button>
          </div>
        </div>
      )}

      {/* ──────────────── STEP 4: FAILED GENERATION STATE ──────────────── */}
      {step === 4 && (
        <div className="space-y-6 py-4" data-testid="letter-failed-state">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-red-800 font-bold text-sm">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
              <span>Generasiya başa çatmadı</span>
            </div>
            <p className="text-xs text-red-700 leading-relaxed">
              {error || 'Server sənədi tamamlaya bilmədi.'}
            </p>
            <p className="text-[11px] text-red-600/80 pt-1 border-t border-red-200">
              Qeyd: Uğursuz cəhdlər üçün balansınızdan heç bir generasiya vahidi çıxılmayıb.
            </p>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="min-h-11 rounded-xl border border-outline-variant px-4 py-2 text-xs font-semibold text-on-background hover:bg-surface-container"
            >
              Suallara qayıt və düzəliş et
            </button>
            <button
              type="button"
              onClick={generateDraft}
              disabled={generating}
              className="min-h-11 inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-xs font-semibold text-white hover:bg-primary-hover"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Yenidən cəhd et</span>
            </button>
          </div>
        </div>
      )}

      {/* ──────────────── STEP 2: REVIEW & APPROVAL ──────────────── */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="bg-surface-container-low rounded-xl p-3 border border-outline-variant/60 flex items-center justify-between text-xs">
            <div>
              <span className="font-semibold text-on-background">{jobTitle}</span>
              <span className="text-on-surface-variant ml-1.5">@ {companyName}</span>
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary uppercase">
                {language}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-primary hover:underline font-semibold"
            >
              Sualları düzəlt
            </button>
          </div>

          <div>
            <h2 className="text-base font-bold text-on-background">3. Qaralamanı yoxlayın və redaktə edin</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Məktubun mətnini istədiyiniz kimi dəyişdirə bilərsiniz. Şirkət və vəzifə adı məktubda aydın görünməlidir.
            </p>
          </div>

          {/* Missing evidence honest warning if applicable */}
          {(!whatDidAndResult.trim() || !numbersConfirmed) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <strong>Dürüstlük bildirişi:</strong> Rəqəmsal nailiyyət və ya təsdiqlənmiş fakt göstərilməyib. Ümumi ifadələr yerinə konkret nəticələri qeyd etmək müraciəti daha inandırıcı edir.
              </div>
            </div>
          )}

          <div>
            <label htmlFor="letter-draft-text" className={LABEL_CLASS}>Məktubun mətni</label>
            <textarea
              id="letter-draft-text"
              rows={12}
              className={`${FIELD_CLASS} font-sans leading-relaxed`}
              value={draftLetter}
              onChange={(e) => {
                setDraftLetter(e.target.value);
                const parts = e.target.value.split('\n\n').filter(Boolean);
                setParagraphs(parts.map((t, idx) => ({ id: paragraphs[idx]?.id, text: t })));
              }}
            />
          </div>

          {/* Honest Policy Notice */}
          {untranslatedFields.length > 0 && !approved && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="group" aria-labelledby="letter-untranslated-title">
              <p id="letter-untranslated-title" className="font-semibold">Bəzi hissələr Azərbaycan dilinə çevrilməyib</p>
              <p className="mt-1 text-xs leading-relaxed">Onları redaktə edə və ya aşağıda açıq şəkildə təsdiqləyərək bu formada PDF yarada bilərsiniz.</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
                {untranslatedFields.slice(0, 5).map((field) => <li key={field.path}>{field.section || field.path}: {field.text}</li>)}
              </ul>
              <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2 border-t border-amber-200 pt-3 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={acknowledgeUntranslated}
                  onChange={(event) => setAcknowledgeUntranslated(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-amber-800"
                />
                <span>Mətnləri yoxladım və qalan hissələrlə bu formada təsdiq edirəm.</span>
              </label>
            </div>
          )}

          <div className="rounded-xl bg-surface-container-low border border-outline-variant/60 p-3 text-xs text-on-surface-variant leading-relaxed">
            <strong>Dürüstlük və zəmanət siyasətimiz:</strong> Bu motivasiya məktubu müsahibə və ya işə qəbul vəd etmir. Məqsəd faktiki təcrübənizi şirkətin tələblərinə uyğun peşəkar və dürüst şəkildə çatdırmaqdır.
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-outline-variant/60">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="min-h-11 rounded-xl border border-outline-variant px-4 py-2 text-xs font-semibold text-on-background hover:bg-surface-container"
            >
              Geri
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="min-h-11 inline-flex items-center gap-1.5 rounded-xl border border-outline-variant bg-surface px-4 py-2 text-xs font-semibold text-on-background hover:bg-surface-container transition-colors"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-on-surface-variant" />}
                <span>{copied ? 'Kopyalandı!' : 'Mətni kopyala'}</span>
              </button>

              {serverDocumentId && (
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={downloading}
                  className="min-h-11 inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 text-primary px-4 py-2 text-xs font-semibold hover:bg-primary/10 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  <span>{downloading ? 'Yüklənir...' : 'PDF Yüklə'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleApprove}
                disabled={approved || approving || (untranslatedFields.length > 0 && !acknowledgeUntranslated)}
                className="min-h-11 inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-xs font-semibold text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {approving ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{approved ? 'Təsdiqləndi' : 'Yoxladım, təsdiqləyirəm'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
