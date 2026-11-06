'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, CheckSquare, Square, AlertCircle, ArrowRight, Sparkles, RefreshCw, Edit2, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { apiFetch } from '@/lib/api';

export interface GuidedPrompt {
  id: string;
  title: string;
  description: string;
  section: 'skills' | 'experience' | 'education' | 'projects';
  link: string;
}

export type SkillNeedInput = string | { key?: string; label: string };

export function getSkillLabel(raw: SkillNeedInput): string {
  if (typeof raw === 'string') return raw;
  return raw.label || raw.key || '';
}

export interface SkillNeedItem {
  skill: SkillNeedInput;
  level: 'required' | 'preferred';
  requirement?: string;
}

export interface EvidencedSkillItem {
  skill: SkillNeedInput;
  level?: 'required' | 'preferred';
  via?: string;
  where?: string;
}

export interface MotivationSuggestionItem {
  id: string;
  type: 'role' | 'experience' | 'company' | 'contribution';
  title: string;
  text: string;
  field: 'whyRole' | 'formative' | 'whyCompany' | 'contribution';
}

export interface CandidateEvidenceItem {
  id: string;
  kind: 'PROJECT' | 'VOLUNTEERING' | 'LEADERSHIP' | 'EXTRACURRICULAR' | 'AWARD' | 'CERTIFICATION';
  title: string;
  organization?: string;
  role?: string;
  explanation: string;
}

export interface MatchSkillsGuidance {
  matchId: string;
  hasProfile: boolean;
  evidenced: EvidencedSkillItem[];
  missingRequired: SkillNeedItem[];
  missingPreferred: SkillNeedItem[];
  other: Array<{ text: string; kind?: string }>;
  sourceRequirements?: Array<{ text: string; level: 'required' | 'preferred'; needsReview: boolean }>;
  guidedPrompts: GuidedPrompt[];
  motivationSuggestions?: MotivationSuggestionItem[];
  candidateEvidenceItems?: CandidateEvidenceItem[];
}

export interface CandidatePreparationSheetProps {
  matchId: string;
  savedRef?: string;
  kind?: string;
  language?: string;
  onSkillsUpdated?: () => void;
  onMutationChange?: (isPending: boolean) => void;
  onMotivationConfirmed?: (answers: { whyRole?: string; formative?: string; whyCompany?: string; contribution?: string }) => void;
  onEvidenceToggled?: (selectedEntryIds: string[]) => void;
}

export function CandidatePreparationSheet({
  matchId,
  savedRef,
  kind = 'RESUME',
  language = 'az',
  onSkillsUpdated,
  onMutationChange,
  onMotivationConfirmed,
  onEvidenceToggled,
}: CandidatePreparationSheetProps) {
  const [data, setData] = useState<MatchSkillsGuidance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<Set<string>>(new Set());
  const [submittingBulk, setSubmittingBulk] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);

  // Motivation suggestions state for letters
  const [adoptedSuggestions, setAdoptedSuggestions] = useState<Map<string, string>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [motivationSkipped, setMotivationSkipped] = useState(false);
  const [showAllRequirements, setShowAllRequirements] = useState(false);

  // Active request sequence to discard stale/out-of-order responses when switching vacancies
  const reqIdRef = useRef(0);
  const activeMatchRef = useRef(matchId);
  const evidenceMatchRef = useRef<string | null>(null);
  const evidenceSelectionRef = useRef(new Set<string>());

  const setPending = (isPending: boolean) => {
    setSubmittingBulk(isPending);
    if (onMutationChange) onMutationChange(isPending);
  };

  const toggleEvidence = (id: string) => {
    const next = new Set(evidenceSelectionRef.current);
    if (next.has(id)) next.delete(id); else next.add(id);
    evidenceSelectionRef.current = next;
    setSelectedEvidenceIds(next);
    onEvidenceToggled?.(Array.from(next));
  };

  const loadGuidance = (activeMatchId: string) => {
    if (!activeMatchId) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setBulkError(null);

    apiFetch(`/matches/${encodeURIComponent(activeMatchId)}/skills`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Vakansiya üzrə bacarıq tələbləri yüklənə bilmədi.');
        return res.json();
      })
      .then((json: MatchSkillsGuidance) => {
        if (reqId === reqIdRef.current) {
          setData(json);
          setSelectedSkills(new Set());
          if (json.candidateEvidenceItems) {
            const available = new Set(json.candidateEvidenceItems.map((e) => e.id));
            const next = evidenceMatchRef.current === activeMatchId
              ? new Set([...evidenceSelectionRef.current].filter((id) => available.has(id))) : available;
            evidenceMatchRef.current = activeMatchId;
            evidenceSelectionRef.current = next;
            setSelectedEvidenceIds(next);
            onEvidenceToggled?.(Array.from(next));
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        if (reqId === reqIdRef.current) {
          setError(err.message || 'Məlumat alına bilmədi.');
          setLoading(false);
        }
      });
  };

  useEffect(() => {
    activeMatchRef.current = matchId;
    if (!matchId) {
      setData(null);
      setError(null);
      setPending(false);
      return;
    }
    setData(null);
    setSkipped(false);
    setSuccessMessage(null);
    setAdoptedSuggestions(new Map());
    setRejectedIds(new Set());
    setEditingId(null);
    setMotivationSkipped(false);
    setShowAllRequirements(false);
    onMotivationConfirmed?.({});
    loadGuidance(matchId);
    return () => { reqIdRef.current++; };
  }, [matchId]);

  if (!matchId) {
    return null;
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4 text-xs text-on-surface-variant flex items-center gap-2">
        <Sparkles className="h-4 w-4 animate-spin text-primary shrink-0" aria-hidden="true" />
        <span>Vakansiya tələbləri və profil bacarıqları yoxlanılır...</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
          <span>Bacarıq hazırlığı müvəqqəti alına bilmədi</span>
        </div>
        <p className="text-amber-800 leading-relaxed">{error}</p>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => loadGuidance(matchId)}
            className="px-3 py-1.5 rounded-lg bg-amber-200 hover:bg-amber-300 font-semibold text-amber-950 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            <span>Yenidən cəhd et</span>
          </button>
          <button
            type="button"
            onClick={() => setSkipped(true)}
            className="px-3 py-1.5 rounded-lg border border-amber-300 hover:bg-amber-100 font-medium text-amber-900 transition-colors"
          >
            Əlavə etmədən davam et
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const allMissing = [...(data.missingRequired || []), ...(data.missingPreferred || [])];
  const hasMissing = allMissing.length > 0;
  const hasEvidenced = (data.evidenced || []).length > 0;
  const hasPrompts = (data.guidedPrompts || []).length > 0;

  const toggleSkill = (label: string) => {
    if (submittingBulk) return;
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (submittingBulk) return;
    if (selectedSkills.size === allMissing.length) {
      setSelectedSkills(new Set());
    } else {
      setSelectedSkills(new Set(allMissing.map((m) => getSkillLabel(m.skill)).filter(Boolean)));
    }
  };

  const handleBulkAdd = async () => {
    if (selectedSkills.size === 0 || submittingBulk) return;
    setPending(true);
    setSuccessMessage(null);
    setBulkError(null);

    try {
      const res = await apiFetch('/profile/skills/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skills: Array.from(selectedSkills),
          confirmed: true,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.message || 'Bacarıqlar əlavə edilə bilmədi.');
      }

      if (activeMatchRef.current !== matchId) return;
      setSuccessMessage(`${selectedSkills.size} bacarıq profilinizə əlavə edildi.`);
      setSelectedSkills(new Set());
      loadGuidance(matchId);
      if (onSkillsUpdated) onSkillsUpdated();
    } catch (err: any) {
      // Preserve candidate's selected skills on failure
      setBulkError(err.message || 'Bacarıqlar əlavə edilərkən xəta baş verdi.');
    } finally {
      setPending(false);
    }
  };

  const savedRefParam = savedRef ? `&savedRef=${encodeURIComponent(savedRef)}` : '';
  const returnUrl = `/dashboard/resumes?matchId=${encodeURIComponent(matchId)}${savedRefParam}&kind=${encodeURIComponent(kind)}&lang=${encodeURIComponent(language)}`;

  const buildProfilePromptUrl = (prompt: GuidedPrompt) => {
    const params = new URLSearchParams();
    params.set('matchId', matchId);
    if (savedRef) params.set('savedRef', savedRef);
    params.set('kind', kind);
    params.set('lang', language);
    params.set('returnTo', returnUrl);
    return `/dashboard/profile?${params.toString()}#${prompt.section}`;
  };

  const defaultSuggestions: MotivationSuggestionItem[] = [];

  const notifyMotivation = (adopted: Map<string, string>) => {
    if (!onMotivationConfirmed) return;
    const suggestions = data?.motivationSuggestions && data.motivationSuggestions.length > 0
      ? data.motivationSuggestions
      : defaultSuggestions;
    const answers: { whyRole?: string; formative?: string; whyCompany?: string; contribution?: string } = {};
    for (const [id, text] of adopted.entries()) {
      const item = suggestions.find((s) => s.id === id);
      if (item) {
        answers[item.field] = text;
      }
    }
    onMotivationConfirmed(answers);
  };

  const handleAdopt = (id: string, text: string) => {
    const next = new Map(adoptedSuggestions);
    next.set(id, text);
    setAdoptedSuggestions(next);
    notifyMotivation(next);
    setEditingId(null);
  };

  const handleReject = (id: string) => {
    setRejectedIds(new Set([...rejectedIds, id]));
    const next = new Map(adoptedSuggestions);
    next.delete(id);
    setAdoptedSuggestions(next);
    notifyMotivation(next);
  };

  const handleStartEdit = (id: string, currentText: string) => {
    setEditingId(id);
    setEditText(currentText);
  };

  const handleSaveEdit = (id: string) => {
    if (editText.trim()) {
      handleAdopt(id, editText.trim());
    }
  };

  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 space-y-4">
      {/* Motivasiyanızı dəqiqləşdirin (Only for Letter generation) */}
      {kind === 'LETTER' && (
        motivationSkipped ? (
          <div className="rounded-xl border border-outline-variant/60 bg-surface-container-low p-3 text-xs text-on-surface-variant flex items-center justify-between gap-3">
            <span>Motivasiya təklifləri addımı keçildi.</span>
            <button
              type="button"
              onClick={() => setMotivationSkipped(false)}
              className="text-primary font-semibold hover:underline"
            >
              Yenidən göstər
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-primary">
                  Motivasiyanızı dəqiqləşdirin
                </h4>
              </div>
              <span className="text-[11px] text-on-surface-variant">Təkliflər (1 kliklə əlavə et)</span>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              Məktubun inandırıcı olması üçün vakansiya və təcrübənizə əsaslanan 2–3 qısa təklif:
            </p>

            <div className="space-y-2">
              {(data.motivationSuggestions && data.motivationSuggestions.length > 0
                ? data.motivationSuggestions
                : defaultSuggestions
              )
                .filter((sug) => !rejectedIds.has(sug.id))
                .map((sug) => {
                  const isAdopted = adoptedSuggestions.has(sug.id);
                  const isEditing = editingId === sug.id;
                  const currentText = adoptedSuggestions.get(sug.id) || sug.text;

                  return (
                    <div
                      key={sug.id}
                      className={`p-3 rounded-xl border text-xs space-y-2 transition-all ${
                        isAdopted
                          ? 'border-emerald-300 bg-emerald-50/80 text-emerald-950'
                          : 'border-outline-variant/70 bg-surface text-on-background'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[11px] text-on-surface-variant uppercase tracking-wider">
                          {sug.title}
                        </span>
                        {isAdopted && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            <Check className="h-3 w-3" aria-hidden="true" />
                            Əlavə edildi
                          </span>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={3}
                            className="w-full rounded-lg border border-outline-variant bg-surface p-2 text-xs text-on-background focus:ring-1 focus:ring-primary"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(sug.id)}
                              className="px-3 py-1 rounded-lg bg-primary text-white text-[11px] font-bold hover:bg-primary-hover transition-colors"
                            >
                              Yadda saxla və əlavə et
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1 rounded-lg border border-outline-variant text-[11px] font-medium text-on-surface-variant hover:bg-surface-container transition-colors"
                            >
                              Ləğv et
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="leading-relaxed text-on-surface">{currentText}</p>
                      )}

                      {!isEditing && (
                        <div className="flex items-center justify-between pt-1 border-t border-outline-variant/40">
                          {isAdopted ? (
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => handleStartEdit(sug.id, currentText)}
                                className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1"
                              >
                                <Edit2 className="h-3 w-3" aria-hidden="true" />
                                <span>Redaktə et</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReject(sug.id)}
                                className="text-[11px] font-medium text-red-700 hover:underline flex items-center gap-1"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                                <span>Çıxar</span>
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleAdopt(sug.id, sug.text)}
                                className="px-3 py-1 rounded-lg bg-primary text-white text-[11px] font-bold hover:bg-primary-hover transition-colors flex items-center gap-1"
                              >
                                <Check className="h-3 w-3" aria-hidden="true" />
                                <span>Mənə uyğundur — əlavə et</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStartEdit(sug.id, sug.text)}
                                className="px-2.5 py-1 rounded-lg border border-outline-variant text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container transition-colors"
                              >
                                Redaktə et
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReject(sug.id)}
                                className="px-2.5 py-1 text-[11px] font-medium text-on-surface-variant/70 hover:text-red-700 transition-colors"
                              >
                                İmtina et
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            <div className="flex items-center justify-end pt-1">
              <button
                type="button"
                onClick={() => { setMotivationSkipped(true); setAdoptedSuggestions(new Map()); onMotivationConfirmed?.({}); }}
                className="text-xs text-on-surface-variant hover:underline"
              >
                Əlavə etmədən davam et
              </button>
            </div>
          </div>
        )
      )}

      {/* Evidenced Skills in Profile */}
      {hasEvidenced && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
            <Check className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>Profilinizdə təsdiqlənmiş bacarıqlar:</span>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {data.evidenced.map((item, idx) => {
              const label = getSkillLabel(item.skill);
              return (
                <span
                  key={`${label}_${idx}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-medium"
                >
                  <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Relevant Candidate Projects, Awards and Activities */}
      {data.candidateEvidenceItems && data.candidateEvidenceItems.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-primary/15 bg-surface-container-low p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-on-surface">
              <Sparkles className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
              <span>Əlaqəli layihələr, təltiflər və fəaliyyətlər:</span>
            </div>
            <span className="text-[11px] text-on-surface-variant">
              {selectedEvidenceIds.size}/{data.candidateEvidenceItems.length} seçilib
            </span>
          </div>
          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            Profilinizdən bu vakansiyaya uyğun gələn fəaliyyətlər müəyyən edildi. Sənəddə vurğulanmasını istədiyiniz bəndləri seçin.
          </p>
          <div className="space-y-1.5 pt-1">
            {data.candidateEvidenceItems.map((item) => {
              const isChecked = selectedEvidenceIds.has(item.id);
              const kindLabel =
                item.kind === 'PROJECT' ? 'Layihə' :
                item.kind === 'AWARD' ? 'Təltif' :
                item.kind === 'CERTIFICATION' ? 'Sertifikat' : 'Fəaliyyət';
              return (
                <div
                  key={item.id}
                  className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition-colors ${
                    isChecked
                      ? 'border-primary/40 bg-surface text-on-surface'
                      : 'border-outline-variant/60 bg-surface-container-lowest text-on-surface-variant/70'
                  }`}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isChecked}
                    onClick={() => toggleEvidence(item.id)}
                    aria-label={`${item.title} seçin`}
                    className="mt-0.5 shrink-0"
                  >
                    {isChecked ? (
                      <CheckSquare className="h-4 w-4 text-primary" aria-hidden="true" />
                    ) : (
                      <Square className="h-4 w-4 text-outline" aria-hidden="true" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-xs text-on-surface truncate">{item.title}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-secondary/10 text-secondary">
                        {kindLabel}
                      </span>
                      {item.organization && (
                        <span className="text-[10px] text-on-surface-variant truncate">
                          ({item.organization})
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-on-surface-variant/90 mt-0.5 leading-normal">
                      {item.explanation}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Success Banner */}
      {successMessage && (
        <div role="status" className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-800 flex items-center gap-2">
          <Check className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Bulk Error Banner: preserves choices and allows retry */}
      {bulkError && (
        <div role="alert" className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800 space-y-2">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" aria-hidden="true" />
            <span>{bulkError}</span>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              disabled={submittingBulk}
              onClick={handleBulkAdd}
              className="px-3 py-1 rounded-lg bg-red-100 hover:bg-red-200 font-semibold text-red-900 transition-colors"
            >
              Yenidən cəhd et
            </button>
            <button
              type="button"
              onClick={() => setSkipped(true)}
              className="px-3 py-1 rounded-lg border border-red-200 hover:bg-red-50 font-medium text-red-800 transition-colors"
            >
              Əlavə etmədən davam et
            </button>
          </div>
        </div>
      )}

      {/* Missing Skills Section */}
      {hasMissing && (
        skipped ? (
          <div className="rounded-xl border border-outline-variant/60 bg-surface-container-low p-3 text-xs text-on-surface-variant flex items-center justify-between gap-3">
            <span>Bacarıq hazırlığı addımı keçildi.</span>
            <button
              type="button"
              onClick={() => setSkipped(false)}
              className="text-primary font-semibold hover:underline"
            >
              Yenidən göstər
            </button>
          </div>
        ) : (
          <div className="space-y-3 pt-1 border-t border-outline-variant/50">
            <div className="space-y-1">
              <div className="text-xs font-bold text-on-surface">
                Profilinizdə hələ qeyd olunmayan tələblər
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Elanda bu bacarıqlar tələb olunur, amma profilinizdə göstərilməyib. Sahib olduğunuz bacarıqları seçərək profilinizə əlavə edin. Bu, təcrübənizi daha düzgün təqdim etməyə kömək edir; işə qəbul zəmanəti deyil.
              </p>
            </div>

            <div className="space-y-2">
              {/* Required Skills */}
              {data.missingRequired.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Tələb olunan bacarıqlar:
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {data.missingRequired.map((item, idx) => {
                      const label = getSkillLabel(item.skill);
                      const isChecked = selectedSkills.has(label);
                      return (
                        <button
                          type="button"
                          key={`req_${label}_${idx}`}
                          disabled={submittingBulk}
                          onClick={() => toggleSkill(label)}
                          className={`flex items-center gap-2 p-2 rounded-xl border text-left text-xs transition-colors ${
                            isChecked
                              ? 'border-primary bg-primary/5 text-primary font-medium'
                              : 'border-outline-variant/70 bg-surface hover:border-outline text-on-surface'
                          }`}
                        >
                          {isChecked ? (
                            <CheckSquare className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                          ) : (
                            <Square className="h-4 w-4 text-outline shrink-0" aria-hidden="true" />
                          )}
                          <span className="min-w-0 break-words">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Preferred Skills */}
              {data.missingPreferred.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    Üstünlük sayılan biliklər:
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {data.missingPreferred.map((item, idx) => {
                      const label = getSkillLabel(item.skill);
                      const isChecked = selectedSkills.has(label);
                      return (
                        <button
                          type="button"
                          key={`pref_${label}_${idx}`}
                          disabled={submittingBulk}
                          onClick={() => toggleSkill(label)}
                          className={`flex items-center gap-2 p-2 rounded-xl border text-left text-xs transition-colors ${
                            isChecked
                              ? 'border-primary bg-primary/5 text-primary font-medium'
                              : 'border-outline-variant/70 bg-surface hover:border-outline text-on-surface'
                          }`}
                        >
                          {isChecked ? (
                            <CheckSquare className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                          ) : (
                            <Square className="h-4 w-4 text-outline shrink-0" aria-hidden="true" />
                          )}
                          <span className="min-w-0 break-words">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Action Row */}
            <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={submittingBulk}
                  onClick={handleSelectAll}
                  className="text-xs font-semibold text-primary hover:underline transition-colors"
                >
                  {selectedSkills.size === allMissing.length
                    ? 'Seçimi sıfırla'
                    : 'Hamısını seç (bu bacarıqların hamısına sahibəm)'}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={submittingBulk}
                  onClick={() => setSkipped(true)}
                  className="px-3 py-1.5 rounded-xl border border-outline-variant text-xs font-semibold text-on-surface-variant hover:bg-surface-container transition-colors"
                >
                  Əlavə etmədən davam et
                </button>

                <button
                  type="button"
                  disabled={selectedSkills.size === 0 || submittingBulk}
                  onClick={handleBulkAdd}
                  className="px-4 py-1.5 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-hover disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {submittingBulk ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      <span>Yadda saxlanılır...</span>
                    </>
                  ) : (
                    <span>Seçilən bacarıqlar məndə var — profilə əlavə et</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )
      )}

      {/* Complete Requirements Detail Toggle */}
      {((data.sourceRequirements?.length ?? 0) > 0 || data.other?.length > 0) && (
        <div className="pt-2 border-t border-outline-variant/40 space-y-2">
          <button
            type="button"
            onClick={() => setShowAllRequirements((prev) => !prev)}
            className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            {showAllRequirements ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Daha az göstər</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Hamısını göstər ({data.sourceRequirements?.length ?? data.other.length} mənbə tələbi)</span>
              </>
            )}
          </button>

          {showAllRequirements && (
            <div className="rounded-xl border border-outline-variant/60 bg-surface-container-low p-3 space-y-2 text-xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                Təhsil, təcrübə və digər şərtlər:
              </div>
              <ul className="list-disc list-inside space-y-1 text-on-surface">
                {(data.sourceRequirements?.length ? data.sourceRequirements : data.other).map((item, idx) => (
                  <li key={`other_req_${idx}`} className="leading-relaxed">
                    <span className="font-medium">[{'level' in item && item.level === 'preferred' ? 'Üstünlük' : 'Tələb'}]:</span>{' '}
                    {item.text}
                    {'needsReview' in item && item.needsReview && <span className="block text-[11px] text-on-surface-variant">Avtomatik təsnif olunmayıb — mətnin profilinizdə necə əks olunduğunu yoxlayın.</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Guided Prompts to Profile */}
      {hasPrompts && (
        <div className="space-y-2 pt-2 border-t border-outline-variant/50">
          <div className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Sənədi daha inandırıcı etmək üçün praktik addımlar:
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {data.guidedPrompts.map((prompt) => (
              <a
                key={prompt.id}
                href={buildProfilePromptUrl(prompt)}
                className="p-2.5 rounded-xl border border-outline-variant/60 bg-surface-container-low hover:border-primary/40 transition-colors space-y-1 block group"
              >
                <div className="text-xs font-bold text-on-background group-hover:text-primary transition-colors">
                  {prompt.title}
                </div>
                <p className="text-[11px] text-on-surface-variant leading-snug line-clamp-2">
                  {prompt.description}
                </p>
                <div className="text-[10px] font-semibold text-primary pt-1 inline-flex items-center gap-0.5">
                  <span>Profilə keç</span>
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
