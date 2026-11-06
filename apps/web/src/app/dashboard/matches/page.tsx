'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch, downloadAuthedFile } from '@/lib/api';
import { Briefcase, ExternalLink, ThumbsDown, Check, FileText, ChevronDown, ChevronUp, Send } from 'lucide-react';
import { MatchesFilterBar } from '@/components/matches-filter-bar';
import { EMPTY_CRITERIA, activeCriteriaCount, applyMatchCriteria, cityOptions, companyOptions, skillSuggestions, type MatchCriteria } from '@/lib/match-filters';
import { formatDate } from "@/lib/format";
import { APPLY_YOURSELF_AFTER, DESTINATION_REASONS, RECEIPT_UNVERIFIABLE_TITLE, receiptUnverifiable, receiptUnverifiableText, type ApplyCapability } from '@/lib/external-apply';

interface Job {
  id: string;
  title: string;
  company: string;
  description: string;
  location: string;
  url: string;
  postedAt: string;
  externalId: string;
  ingestedAt: string;
  lastSeenAt?: string;
  deadline?: string | null;
}

interface TailoredResume {
  id: string;
  version: number;
  status: 'PENDING' | 'NEEDS_REVIEW' | 'READY' | 'FAILED';
  fileUrl: string | null;
  statusError?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

interface Match {
  id: string;
  actionable: boolean;
  details?: { matchedKeywords?: string[]; gaps?: string[] } | null;
  score: number;
  status: 'NEW' | 'VIEWED' | 'DISMISSED' | 'APPLIED';
  createdAt: string;
  job: Job | null;
  vacancy?: {
    id: string;
    title: string;
    description: string | null;
    requirements: string | null;
    location: string | null;
    companyId: string;
    company?: { id: string; name: string } | null;
  } | null;
  tailoredResumes: TailoredResume[];
}

interface Resume {
  id: string;
  isBase: boolean;
}

interface MatchSelectionStatus {
  cadence: 'daily' | 'weekly' | null;
  pendingCount: number;
  nextSelectionAt: string | null;
  firstBatchAvailable: boolean;
}

/** Server-side answer to "may this match offer an automated external application?". */

function MatchesSkeleton() {
  return (
    <div className="space-y-4 max-w-4xl" role="status" aria-label="Uyğun vakansiyalar yüklənir">
      <p className="sr-only">Vakansiya uyğunluqları yüklənir...</p>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          data-testid="match-skeleton"
          className="product-card animate-pulse motion-reduce:animate-none overflow-hidden rounded-2xl bg-background border border-neutral-dark/5 shadow-xs p-6 flex flex-col md:flex-row md:items-center justify-between gap-4"
        >
          <div className="space-y-2.5 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="h-5 w-48 rounded-md bg-neutral-dark/10" />
              <div className="h-5 w-16 rounded-md bg-neutral-dark/10" />
            </div>
            <div className="h-4 w-36 rounded-md bg-neutral-dark/5" />
            <div className="h-3 w-52 rounded-md bg-neutral-dark/5" />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="h-8 w-28 rounded-xl bg-neutral-dark/10" />
            <div className="h-8 w-8 rounded-lg bg-neutral-dark/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchesContent() {
  const searchParams = useSearchParams();

  const [matches, setMatches] = useState<Match[]>([]);
  const [baseResumes, setBaseResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  // Filters narrow only the matches already loaded for this account; they
  // never trigger a request, so typing does not fetch.
  const [criteria, setCriteria] = useState<MatchCriteria>(EMPTY_CRITERIA);
  const deepLinkApplied = useRef<string | null>(null);
  const targetId = searchParams.get('id');
  const [capabilities, setCapabilities] = useState<Record<string, ApplyCapability>>({});
  const [selectionStatus, setSelectionStatus] = useState<MatchSelectionStatus | null>(null);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const nextSelectionLabel = selectionStatus?.nextSelectionAt
    ? new Intl.DateTimeFormat('az-AZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(selectionStatus.nextSelectionAt))
    : null;

  const fetchData = async () => {
    try {
      setError(null);
      // 1. Fetch every match this account may see once; status, company,
      // city and text filters are applied locally so the filter options stay
      // stable and no request is made per interaction.
      const [matchesRes, selectionRes] = await Promise.all([
        apiFetch('/matches'),
        apiFetch('/matches/selection-status').catch(() => null),
      ]);
      if (!matchesRes.ok) throw new Error('Uyğunluqlar yüklənə bilmədi');
      const matchesData = await matchesRes.json();
      setMatches(matchesData);
      if (selectionRes?.ok) setSelectionStatus(await selectionRes.json());

      // Automated external application is offered only where the server says
      // it is supported and eligible; everything else keeps the assisted route.
      const externalIds = (matchesData as Match[]).filter((m) => m.job && m.actionable).map((m) => m.id).slice(0, 100);
      if (externalIds.length) {
        const capsRes = await apiFetch(`/external-applications/capabilities?matchIds=${externalIds.join(',')}`).catch(() => null);
        const caps = capsRes?.ok ? await capsRes.json().catch(() => null) : null;
        setCapabilities(caps && typeof caps === 'object' && !Array.isArray(caps) ? caps : {});
      }

      // 2. Fetch resumes (to check if user has a base resume)
      const resumesRes = await apiFetch('/resumes');
      if (resumesRes.ok) {
        const resumesData = await resumesRes.json();
        setBaseResumes(resumesData.filter((r: any) => r.isBase));
      }
    } catch (err: any) {
      setError(err.message || 'Uyğunluqları yükləyərkən xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  const handleFirstBatch = async () => {
    setSelectionBusy(true);
    setSelectionMessage(null);
    try {
      const res = await apiFetch('/matches/first-batch', { method: 'POST' });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.message || 'İlk uyğunluqları seçmək mümkün olmadı.');
      if (result.status === 'published') {
        setSelectionMessage(`${result.published} uyğun vakansiya seçildi.`);
        await fetchData();
      } else if (result.status === 'no_eligible_candidates') {
        setSelectionMessage('Hazırda seçim meyarlarınıza cavab verən uyğun vakansiya yoxdur. Profil seçimlərinizi yoxlaya bilərsiniz.');
      } else if (result.status === 'selection_already_used') {
        setSelectionMessage('Bu dövr üçün seçim artıq edilib. Növbəti seçim vaxtı yuxarıda göstərilir.');
        await fetchData();
      } else {
        setSelectionMessage('Yeni seçim üçün qiymətləndirilmiş vakansiya tapılmadı. Növbəti planlı seçim vaxtını gözləyin.');
      }
    } catch (err) {
      setSelectionMessage(err instanceof Error ? err.message : 'İlk uyğunluqları seçmək mümkün olmadı.');
    } finally {
      setSelectionBusy(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep link (?id=…): expand that match once; later refreshes and polling
  // must not re-open a card the candidate has closed.
  useEffect(() => {
    if (!targetId || deepLinkApplied.current === targetId || !matches.some((m) => m.id === targetId)) return;
    deepLinkApplied.current = targetId;
    setExpandedMatchId(targetId);
  }, [targetId, matches]);

  // Tailoring runs asynchronously (AI + PDF compile can take up to a few minutes),
  // so poll while any match has a resume still being generated.
  useEffect(() => {
    const hasPending = matches.some((m) => m.tailoredResumes?.some((r) => r.status === 'PENDING'));
    if (!hasPending) return;
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [matches]);

  const handleStatusChange = async (matchId: string, newStatus: string) => {
    setActionLoading(matchId);
    try {
      const res = await apiFetch(`/matches/${matchId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) throw new Error('Status yenilənə bilmədi');
      
      // Update local state
      setMatches(
        matches.map((m) =>
          m.id === matchId ? { ...m, status: newStatus as any } : m
        )
      );
    } catch (err: any) {
      setError(err.message || 'Statusu yeniləmək mümkün olmadı.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleTailorResume = async (match: Match) => {
    setActionLoading(match.id);
    const baseResume = baseResumes[0]; // Use an uploaded base CV if there is one, otherwise fall back to profile data

    try {
      const res = await apiFetch('/resumes/tailor', {
        method: 'POST',
        body: JSON.stringify({
          matchId: match.id,
          ...(baseResume ? { baseResumeId: baseResume.id } : {}),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Fərdiləşdirilmiş nüsxə yaradıla bilmədi.');
      }

      await fetchData();
    } catch (err: any) {
      setError(err.message || 'CV-ni fərdiləşdirmək mümkün olmadı.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartExternalApply = async (match: Match) => {
    setActionLoading(match.id);
    try {
      // Creates a draft only: nothing is sent before the candidate's consent.
      const res = await apiFetch('/external-applications', { method: 'POST', body: JSON.stringify({ matchId: match.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Avtomatik müraciəti başlatmaq mümkün olmadı.');
      window.location.assign(`/dashboard/apply/${data.id}`);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Avtomatik müraciəti başlatmaq mümkün olmadı.');
    } finally {
      setActionLoading(null);
    }
  };

  const toggleExpand = (matchId: string, currentStatus: string) => {
    if (expandedMatchId === matchId) {
      setExpandedMatchId(null);
    } else {
      setExpandedMatchId(matchId);
      // Mark as VIEWED if it was NEW
      if (currentStatus === 'NEW') {
        handleStatusChange(matchId, 'VIEWED');
      }
    }
  };

  const companies = useMemo(() => companyOptions(matches), [matches]);
  const cities = useMemo(() => cityOptions(matches), [matches]);
  const suggestions = useMemo(() => skillSuggestions(matches), [matches]);
  const visibleMatches = useMemo(() => applyMatchCriteria(matches, criteria), [matches, criteria]);
  const filtersActive = activeCriteriaCount(criteria) > 0;
  const resetFilters = () => setCriteria(EMPTY_CRITERIA);

  if (loading) {
    return <MatchesSkeleton />;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">
      <div className="match-page-head flex flex-col gap-5 border-b border-outline-variant pb-6">
        <div>
          <p className="workspace-label mb-3">KARYERANIN NÖVBƏTİ ADDIMI</p>
          <h1 className="font-serif text-3xl font-bold text-neutral-dark">Uyğun vakansiyalar</h1>
          <p className="mt-3 max-w-2xl text-sm text-on-surface-variant">
            AISE profilinizə uyğun vakansiyaları müqayisə edir və plan limitiniz çərçivəsində ən güclü uyğunluqları seçir. Bal işə qəbul ehtimalı deyil; hər vakansiyanı açaraq uyğun bacarıqları və profilinizdə hələ sübutu olmayan tələbləri görün.
          </p>
          {selectionStatus?.pendingCount ? (
            <p className="mt-2 text-xs text-on-surface-variant" role="status">
              {selectionStatus.pendingCount} uyğun vakansiya sıralanıb.
              {!selectionStatus.firstBatchAvailable && nextSelectionLabel ? <> Növbəti planlı seçim: {nextSelectionLabel}.</> : null}
            </p>
          ) : null}
          {selectionStatus?.firstBatchAvailable ? (
            <div className="mt-3 rounded-2xl border border-primary/15 bg-primary/5 p-4">
              <p className="text-sm text-on-surface-variant">Bu dövr üçün uyğunluq hələ seçilməyib. Artıq qiymətləndirilmiş vakansiyaları plan limitiniz daxilində indi sıralaya bilərik.</p>
              <button type="button" onClick={handleFirstBatch} disabled={selectionBusy} className="mt-3 min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {selectionBusy ? 'Seçilir…' : 'İlk uyğunluqları indi seç'}
              </button>
              {selectionMessage ? <p className="mt-2 text-sm" role="status">{selectionMessage}</p> : null}
            </div>
          ) : selectionMessage ? <p className="mt-2 text-sm" role="status">{selectionMessage}</p> : null}
        </div>

        {/* Filter status */}
        <div className="flex gap-2 flex-wrap">
          {['all', 'new', 'viewed', 'applied', 'dismissed'].map((status) => {
            let label = 'Hamısı';
            if (status === 'new') label = 'Yeni';
            if (status === 'viewed') label = 'Baxılıb';
            if (status === 'applied') label = 'Müraciət edilib';
            if (status === 'dismissed') label = 'Rədd edilib';

            return (
              <button
                key={status}
                onClick={() => setCriteria((c) => ({ ...c, status }))}
                aria-pressed={criteria.status === status}
                className={`min-h-11 inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-semibold capitalize border transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden ${
                  criteria.status === status
                    ? 'bg-highlight border-highlight text-primary'
                    : 'bg-background border-neutral-dark/10 text-neutral-dark hover:bg-neutral-dark/5'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <MatchesFilterBar
        criteria={criteria}
        onChange={setCriteria}
        onReset={resetFilters}
        onRefresh={fetchData}
        companies={companies}
        cities={cities}
        skillSuggestions={suggestions}
        totalVisible={matches.length}
        shown={visibleMatches.length}
      />

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100 flex items-center justify-between gap-3" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-900 text-xs font-semibold underline shrink-0 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
          >
            Bağla
          </button>
        </div>
      )}

      {visibleMatches.length === 0 ? (
        <div className="product-card text-center py-16 bg-background rounded-2xl border border-neutral-dark/5 shadow-xs px-4 max-w-xl mx-auto">
          <Briefcase className="mx-auto h-12 w-12 text-neutral-dark/30 mb-2" />
          <p className="text-sm font-semibold text-neutral-dark">
            {matches.length > 0 && filtersActive ? 'Filtrlərə uyğun vakansiya tapılmadı' : 'Meyarlarınıza uyğun vakansiya tapılmadı'}
          </p>
          <p className="text-xs text-neutral-dark/60 mt-2 leading-relaxed">
            {matches.length > 0 && filtersActive
              ? 'Görünən uyğunluqlarda bu meyarlara uyğun nəticə yoxdur. Axtarışı və ya seçilmiş filtrləri dəyişin.'
              : 'AISE tövsiyə sayını doldurmaq üçün hədəf rol, staj, şəhər və ya iş rejimi tələblərinizi gizli şəkildə genişləndirmir. Yalnız profilinizdə təyin etdiyiniz meyarlarla tam səsləşən təkliflər göstərilir.'}
          </p>
          {matches.length > 0 && filtersActive ? (
            <button
              type="button"
              onClick={resetFilters}
              className="mt-4 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-neutral-dark/20 bg-background px-4 py-2.5 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
            >
              Filtrləri sıfırlayın
            </button>
          ) : (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/dashboard/profile"
                className="inline-flex min-h-11 items-center justify-center gap-1.5 product-action rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-white hover:bg-primary-hover transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
              >
                Hədəf rolları və üstünlükləri tənzimləyin
              </Link>
              <Link
                href="/jobs"
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-neutral-dark/20 bg-background px-4 py-2.5 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
              >
                Bütün vakansiyalar kataloqu
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleMatches.map((match) => {
            const isExpanded = expandedMatchId === match.id;
            const scorePct = Math.round(match.score * 100);
            
            // Latest tailored resume for this match (if any), to reflect async generation status
            const latestTailored = match.tailoredResumes && match.tailoredResumes.length > 0
              ? [...match.tailoredResumes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
              : null;
            const hasTailored = !!latestTailored;
            const isTailoring = latestTailored?.status === 'PENDING';

            let statusText = 'Yeni';
            if (match.status === 'APPLIED') statusText = 'Müraciət edilib';
            if (match.status === 'VIEWED') statusText = 'Baxılıb';
            if (match.status === 'DISMISSED') statusText = 'Rədd edilib';

            const posting = match.job ?? {
              title: match.vacancy?.title ?? 'Vakansiya',
              company: match.vacancy?.company?.name ?? '',
              location: match.vacancy?.location ?? '',
              description: match.vacancy?.description ?? match.vacancy?.requirements ?? '',
              url: match.vacancy
                ? `/dashboard/companies/${match.vacancy.companyId}/vacancies/${match.vacancy.id}`
                : '#',
            };
            return (
              <div
                key={match.id}
                className={`product-match-card overflow-hidden rounded-2xl bg-background border transition-all shadow-xs ${
                  isExpanded ? 'border-primary/45 ring-2 ring-primary/5' : 'border-neutral-dark/5 hover:border-neutral-dark/15'
                }`}
              >
                {/* Header Card (Always Visible) */}
                <button
                  type="button"
                  role="button"
                  aria-expanded={isExpanded}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleExpand(match.id, match.status); } }}
                  onClick={() => toggleExpand(match.id, match.status)}
                  className="match-header w-full text-left p-6 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                >
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-semibold text-lg text-neutral-dark hover:text-accent transition-colors break-words">
                        {posting.title}
                      </h2>
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold border ${
                        match.status === 'NEW'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : match.status === 'APPLIED'
                          ? 'bg-green-50 text-green-800 border-green-200'
                          : match.status === 'DISMISSED'
                          ? 'bg-red-50 text-red-800 border-red-200'
                          : 'bg-neutral-50 text-neutral-800 border-neutral-200'
                      }`}>
                        {statusText}
                      </span>
                    </div>
                    <p className="text-sm text-neutral-dark/75">
                      {posting.company} &bull; <span className="text-neutral-dark/60">{posting.location}</span>
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      Uyğunlaşma tarixi: {formatDate(match.createdAt)}
                      {match.job?.lastSeenAt && <> · Mənbədə son görünmə: {formatDate(match.job.lastSeenAt)}</>}
                      {match.job?.deadline && <> · Son tarix: {formatDate(match.job.deadline)}</>}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 justify-between md:justify-end">
                    <div className="match-fit">
                      <span className="sr-only">{scorePct}% Uyğunluq</span>
                      <div className="match-fit-orbit" aria-hidden="true" style={{ '--match-fill': `${Math.max(0, Math.min(100, scorePct))}%` } as React.CSSProperties}>
                        <span>{scorePct}<small>%</small></span>
                      </div>
                      <span aria-hidden="true" className="text-[10px] text-on-surface-variant">Uyğunluq</span>
                    </div>

                    <div className="text-neutral-dark hover:bg-neutral-dark/5 p-1.5 rounded-lg">
                      {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </div>
                  </div>
                </button>

                {/* Expanded Details Section */}
                {isExpanded && (
                  <div className="border-t border-neutral-dark/10 bg-background-warm/5 p-6 space-y-6 animate-in slide-in-from-top-4 duration-200">
                    {!match.actionable && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Bu vakansiya artıq aktiv deyil. Əvvəlki müraciətiniz tarixçədə saxlanılır.</p>}
                    {(match.details?.matchedKeywords?.length || match.details?.gaps?.length) ? (
                      <div className="rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Uyğunluq izahı</h3>
                        {match.details?.matchedKeywords?.length ? (
                          <div>
                            <p className="mb-1.5 text-xs font-medium text-on-surface-variant">Profilinizdə sübutu olan:</p>
                            <div className="flex flex-wrap gap-1.5">
                              {match.details.matchedKeywords.map((kw) => (
                                <span key={kw} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary-strong">{kw}</span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {match.details?.gaps?.length ? (
                          <div>
                            <p className="mb-1.5 text-xs font-medium text-on-surface-variant">Profilinizdə hələ sübutu yoxdur:</p>
                            <p className="mb-1.5 text-xs text-on-surface-variant">Bu, bacarığınız olmadığı demək deyil. Varsa, vakansiya səhifəsində təsdiqləyib profilinizə əlavə edin.</p>
                            <div className="flex flex-wrap gap-1.5">
                              {match.details.gaps.map((g) => (
                                <span key={g} className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-900">{g}</span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {/* Actions bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-dark/5 pb-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        {match.actionable && match.status !== 'APPLIED' && (
                          <button
                            onClick={() => handleStatusChange(match.id, 'APPLIED')}
                            disabled={actionLoading === match.id}
                            className="inline-flex items-center gap-1 min-h-11 text-xs font-bold bg-primary hover:bg-primary-hover text-white px-3.5 py-2 rounded-xl transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                          >
                            <Check className="h-3.5 w-3.5" /> Müraciət etdim
                          </button>
                        )}
                        {match.status !== 'DISMISSED' && (
                          <button
                            onClick={() => handleStatusChange(match.id, 'DISMISSED')}
                            disabled={actionLoading === match.id}
                            className="inline-flex items-center gap-1 min-h-11 text-xs font-bold bg-background border border-neutral-dark/20 hover:bg-neutral-dark/5 text-neutral-dark px-3.5 py-2 rounded-xl transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                          >
                            <ThumbsDown className="h-3.5 w-3.5" /> Rədd et
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {latestTailored?.status === 'READY' && latestTailored.fileUrl && (
                          <button
                            type="button"
                            onClick={() => downloadAuthedFile(latestTailored.fileUrl!, `cv-v${latestTailored.version}.pdf`)}
                            className="inline-flex items-center gap-1 min-h-11 text-xs font-bold bg-primary/10 text-primary px-3.5 py-2 rounded-xl transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                          >
                            <FileText className="h-3.5 w-3.5" /> PDF-i Aç (v{latestTailored.version})
                          </button>
                        )}
                        {latestTailored?.status === 'NEEDS_REVIEW' && (
                          <a
                            href={`/dashboard/resumes?review=${latestTailored.id}`}
                            className="inline-flex items-center gap-1 min-h-11 text-xs font-bold bg-amber-50 border border-amber-200 text-amber-900 px-3.5 py-2 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                          >
                            <FileText className="h-3.5 w-3.5" /> Qaralamanı yoxla və təsdiqlə (v{latestTailored.version})
                          </a>
                        )}
                        {latestTailored?.status === 'FAILED' && (
                          <span className="text-xs font-semibold text-red-600" role="status">
                            Fərdiləşdirmə uğursuz oldu: {latestTailored.statusError || ''}
                          </span>
                        )}

                        <button
                          onClick={() => handleTailorResume(match)}
                          disabled={!match.actionable || actionLoading === match.id || isTailoring}
                          className="inline-flex items-center gap-1 min-h-11 text-xs font-bold bg-accent hover:bg-accent-hover text-white px-3.5 py-2 rounded-xl transition-all disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                        >
                          <FileText className={`h-3.5 w-3.5 ${isTailoring ? 'animate-pulse' : ''}`} />
                          {isTailoring
                            ? 'Hazırlanır...'
                            : hasTailored ? 'CV-ni Yenidən Fərdiləşdir' : 'CV-ni Fərdiləşdir'}
                        </button>

                        {match.actionable && <a
                          href={posting.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 min-h-11 text-xs font-bold bg-background border border-neutral-dark/20 hover:bg-neutral-dark/5 text-neutral-dark px-3.5 py-2 rounded-xl transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                        >
                          {match.job?.externalId?.startsWith('glorri:') ? 'Glorri-də bax' : match.job ? 'Mənbəyə bax' : 'AISE-də bax'} <ExternalLink className="h-3.5 w-3.5" />
                        </a>}
                      </div>
                    </div>

                    {match.job && match.actionable && capabilities[match.id] && (() => {
                      const cap = capabilities[match.id];
                      if (cap.applicationId) {
                        return (
                          <a href={`/dashboard/apply/${cap.applicationId}`} className="inline-flex items-center gap-1 min-h-11 text-xs font-bold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden">
                            <Send className="h-3.5 w-3.5" /> {cap.reason === 'IN_PROGRESS' ? 'Avtomatik müraciətə davam et' : 'Avtomatik müraciətin vəziyyəti'}
                          </a>
                        );
                      }
                      if (cap.available) {
                        return (
                          <div className="space-y-1.5">
                            <button
                              onClick={() => handleStartExternalApply(match)}
                              disabled={actionLoading === match.id}
                              className="inline-flex items-center gap-1 min-h-11 text-xs font-bold bg-primary/10 text-primary px-3.5 py-2 rounded-xl transition-all disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                            >
                              <Send className="h-3.5 w-3.5" /> Avtomatik müraciət hazırla
                            </button>
                            {cap.destination && receiptUnverifiable(cap.destination) && (
                              <p className="text-xs text-amber-900" data-testid="receipt-unverifiable">
                                <strong>{RECEIPT_UNVERIFIABLE_TITLE}.</strong> {receiptUnverifiableText(cap.destination.displayName)}
                              </p>
                            )}
                          </div>
                        );
                      }
                      // A vacancy on a known destination that the destination
                      // itself keeps from automated apply: say why, and point to
                      // the source link and "Müraciət etdim" above rather than
                      // adding new ones. Account and rollout reasons (plan,
                      // pilot, live gate, pause) stay silent: automation is not
                      // offered to this candidate, and a plan upsell while paid
                      // plans are off would mislead.
                      if (cap.destination && cap.reason && DESTINATION_REASONS.has(cap.reason)) {
                        return (
                          <p className="text-xs text-neutral-dark/70" role="note" data-testid="apply-yourself">
                            <strong>Avtomatik müraciət mövcud deyil.</strong> {cap.message ?? ''} {APPLY_YOURSELF_AFTER}
                          </p>
                        );
                      }
                      return null;
                    })()}

                    {/* Job description details */}
                    <div className="space-y-3">
                      <h3 className="font-serif text-base font-bold text-neutral-dark">İşin təsviri</h3>
                      <div className="text-sm text-neutral-dark/80 whitespace-pre-wrap leading-relaxed">
                        {posting.description}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MatchesPage() {
  return (
    <Suspense fallback={<MatchesSkeleton />}>
      <MatchesContent />
    </Suspense>
  );
}
