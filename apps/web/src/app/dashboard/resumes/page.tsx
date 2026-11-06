'use client';

import React, { useState, useEffect, useRef } from 'react';
import { apiFetch, downloadAuthedFile } from '@/lib/api';
import { ExtractionNotice } from '@/components/profile/extraction-notice';
import { FileText, Upload, Trash2, Edit2, CheckCircle, X, Save, Plus, ArrowLeft, Sparkles, ClipboardPaste } from 'lucide-react';
import { formatDate } from "@/lib/format";
import TailoredReview from './tailored-review';
import { DocumentAllowanceCard } from '@/components/documents/document-allowance-card';
import { CreateDocumentModal, type DocumentKind } from '@/components/documents/create-document-modal';
import { MotivationLetterComposer, TargetJobContext } from '@/components/documents/motivation-letter-composer';
import { refusalMessage } from '@/lib/documents/refusal';
import { newRequestId } from '@/lib/documents/request-id';
import { PastedVacancyModal } from '@/components/documents/pasted-vacancy-modal';

interface Resume {
  id: string;
  isBase: boolean;
  fileUrl: string | null;
  parsedContent: any;
  version: number;
  matchId: string | null;
  status: 'PENDING' | 'NEEDS_REVIEW' | 'READY' | 'FAILED';
  statusError?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  /** CV (fuller), RESUME (concise) or LETTER; rows from before documents existed have none and are CVs. */
  docKind?: 'CV' | 'RESUME' | 'LETTER';
  language?: string | null;
}

const KIND_LABEL: Record<'CV' | 'RESUME' | 'LETTER', string> = { CV: 'Geniş CV', RESUME: 'Rezüme', LETTER: 'Motivasiya məktubu' };
const kindOf = (r: Resume) => r.docKind ?? 'CV';
const fileStem = (r: Resume) => ({ CV: 'cv', RESUME: 'rezume', LETTER: 'motivasiya-mektubu' })[kindOf(r)];

export default function ResumesPage() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Editing state
  const [editingResume, setEditingResume] = useState<Resume | null>(null);
  const [editedContent, setEditedContent] = useState<any>(null);
  // Tailored-CV review (opened from this list or /dashboard/resumes?review=<id>)
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  // Create document modal and motivation letter composer
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isPastedVacancyOpen, setIsPastedVacancyOpen] = useState(false);
  // "Sənəd hazırla" on a saved job opens the creation dialog already pointed at that posting.
  const [createFor, setCreateFor] = useState<string | null>(null);
  const [createSavedRef, setCreateSavedRef] = useState<string | null>(null);
  const [createKind, setCreateKind] = useState<DocumentKind>('RESUME');
  const [createLang, setCreateLang] = useState<string>('az');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const searchParams = new URLSearchParams(window.location.search);
    const ref = searchParams.get('create');
    const matchId = searchParams.get('matchId');
    const savedRef = searchParams.get('savedRef');
    const kind = searchParams.get('kind');
    const lang = searchParams.get('lang');

    if (ref && /^(imported|native):[A-Za-z0-9_-]{1,64}$/.test(ref)) {
      setCreateFor(`saved:${ref}`);
      setCreateSavedRef(ref);
      setIsCreateModalOpen(true);
    } else if (matchId) {
      setCreateFor(matchId);
      if (savedRef) {
        setCreateSavedRef(savedRef);
      }
      if (kind === 'RESUME' || kind === 'CV' || kind === 'LETTER') {
        setCreateKind(kind);
      }
      if (lang) {
        setCreateLang(lang);
      }
      setIsCreateModalOpen(true);
    }
  }, []);
  const [letterComposerJob, setLetterComposerJob] = useState<TargetJobContext | null>(null);
  // An existing letter opened from the list (pending, draft or approved).
  const [reviewingLetterId, setReviewingLetterId] = useState<string | null>(null);

  const [allowanceVersion, setAllowanceVersion] = useState(0);

  const fetchResumes = async () => {
    setAllowanceVersion((v) => v + 1);
    try {
      const res = await apiFetch('/resumes');
      if (!res.ok) throw new Error('CV-lər yüklənə bilmədi');
      const data = await res.json();
      setResumes(data);
    } catch (err: any) {
      setError(err.message || 'CV-ləri yükləyərkən xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResumes();
    const review = new URLSearchParams(window.location.search).get('review');
    if (review) setReviewingId(review);
  }, []);

  const closeReview = () => {
    setReviewingId(null);
    window.history.replaceState(null, '', '/dashboard/resumes');
    fetchResumes();
  };

  /** A document opens in the review that fits its kind: a letter has paragraphs, a CV or resume has sections. */
  const openDocument = (resume: Resume) => (kindOf(resume) === 'LETTER' ? setReviewingLetterId(resume.id) : setReviewingId(resume.id));

  const retryTailoring = async (resume: Resume) => {
    setError(null);
    if (!resume.matchId) {
      const detail = await apiFetch(`/documents/${resume.id}`).then((r) => r.ok ? r.json() : null).catch(() => null);
      const privateVacancy = detail?.privateVacancy;
      if (!privateVacancy) return;
      const items = [{ kind: kindOf(resume), language: resume.language || undefined }];
      const quote = await apiFetch('/documents/quote', { method: 'POST', body: JSON.stringify({ privateVacancy, items }) }).then((r) => r.ok ? r.json() : null).catch(() => null);
      if (!quote || !quote.affordable) { setError(quote?.message || 'Limit yoxlanıla bilmədi; yenidən cəhd edin.'); return; }
      const gen = await apiFetch('/documents/generate', { method: 'POST', body: JSON.stringify({ privateVacancy, items, expectedUnits: quote.units, requestId: newRequestId() }) }).catch(() => null);
      if (!gen?.ok) { setError('Yenidən cəhd etmək mümkün olmadı. Vakansiya mətni sənədinizdə saxlanılıb.'); return; }
      fetchResumes();
      return;
    }
    if (kindOf(resume) === 'LETTER') {
      // A failed letter is written again from the questions, for the same vacancy and language (nothing was charged for the failed one).
      const detail = await apiFetch(`/documents/${resume.id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      setLetterComposerJob({
        matchId: resume.matchId,
        title: detail?.posting?.title || '',
        company: detail?.posting?.company || '',
        language: resume.language || undefined,
        letterInputs: detail?.letterInputs || null,
      });
      return;
    }
    if (kindOf(resume) === 'RESUME') {
      // The same kind and language again, with the cost checked first.
      const items = [{ kind: 'RESUME', language: resume.language || undefined }];
      const quote = await apiFetch('/documents/quote', { method: 'POST', body: JSON.stringify({ matchId: resume.matchId, items }) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!quote || typeof quote.units !== 'number') { setError('Qiymət yoxlanıla bilmədi; bir az sonra yenidən cəhd edin.'); return; }
      if (!quote.affordable) { setError(refusalMessage(quote.refusal)); return; }
      const gen = await apiFetch('/documents/generate', { method: 'POST', body: JSON.stringify({ matchId: resume.matchId, items, expectedUnits: quote.units, requestId: newRequestId() }) }).catch(() => null);
      if (!gen || !gen.ok) { const data = await gen?.json().catch(() => ({})); setError(data?.message || 'Yenidən cəhd etmək mümkün olmadı.'); return; }
      fetchResumes();
      return;
    }
    const res = await apiFetch('/resumes/tailor', { method: 'POST', body: JSON.stringify({ matchId: resume.matchId }) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message || 'Yenidən cəhd etmək mümkün olmadı.');
      return;
    }
    fetchResumes();
  };

  // Tailoring runs asynchronously (AI + PDF compile), so poll while anything is still generating.
  useEffect(() => {
    const hasPending = resumes.some((r) => r.status === 'PENDING');
    if (!hasPending) return;
    const interval = setInterval(fetchResumes, 5000);
    return () => clearInterval(interval);
  }, [resumes]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setError(null);
    setSuccess(null);

    const file = files[0];
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await apiFetch('/resumes', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'CV yüklənə bilmədi. Bu əməliyyat üçün limitinizin olduğunu yoxlayın.');
      }

      setSuccess('CV uğurla yükləndi!');
      fetchResumes();
    } catch (err: any) {
      setError(err.message || 'Yükləmə uğursuz oldu.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bu CV-ni silmək istədiyinizdən əminsiniz?')) return;

    setError(null);
    setSuccess(null);

    try {
      const res = await apiFetch(`/resumes/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('CV silinə bilmədi');

      setSuccess('CV silindi.');
      fetchResumes();
    } catch (err: any) {
      setError(err.message || 'Silinmə zamanı xəta baş verdi.');
    }
  };

  // Editing handlers
  const startEditing = (resume: Resume) => {
    setEditingResume(resume);
    // Deep clone content
    setEditedContent(JSON.parse(JSON.stringify(resume.parsedContent || {
      personalInfo: { name: '', email: '', phone: '' },
      workExperience: [],
      skills: [],
    })));
  };

  const cancelEditing = () => {
    setEditingResume(null);
    setEditedContent(null);
  };

  const handleSaveEdit = async () => {
    if (!editingResume) return;

    setError(null);
    setSuccess(null);

    try {
      const res = await apiFetch(`/resumes/${editingResume.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ parsedContent: editedContent }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Dəyişikliklər yadda saxlanıla bilmədi');
      }

      setSuccess('CV uğurla yeniləndi!');
      setEditingResume(null);
      setEditedContent(null);
      fetchResumes();
    } catch (err: any) {
      setError(err.message || 'Dəyişiklikləri yadda saxlayarkən xəta baş verdi.');
    }
  };

  const handleUpdateExperience = (idx: number, field: string, val: string) => {
    const updated = { ...editedContent };
    updated.workExperience[idx][field] = val;
    setEditedContent(updated);
  };

  const handleAddExperience = () => {
    const updated = { ...editedContent };
    if (!updated.workExperience) updated.workExperience = [];
    updated.workExperience.push({ title: '', company: '', description: '' });
    setEditedContent(updated);
  };

  const handleRemoveExperience = (idx: number) => {
    const updated = { ...editedContent };
    updated.workExperience = updated.workExperience.filter((_: any, i: number) => i !== idx);
    setEditedContent(updated);
  };

  const baseResumes = resumes.filter((r) => r.isBase);
  const tailoredResumes = resumes.filter((r) => !r.isBase);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-neutral-dark/65">CV-lər yüklənir...</p>
      </div>
    );
  }

  // --- Inline Resume Editor Panel ---
  if (reviewingId) {
    return <TailoredReview id={reviewingId} onClose={closeReview} />;
  }

  // --- An existing letter opened from the list ---
  if (reviewingLetterId) {
    return (
      <MotivationLetterComposer
        existingDocumentId={reviewingLetterId}
        candidateName={baseResumes[0]?.parsedContent?.personalInfo?.name || ''}
        onClose={() => { setReviewingLetterId(null); fetchResumes(); }}
        onSuccess={() => { fetchResumes(); }}
      />
    );
  }

  // --- Inline Motivation Letter Composer ---
  if (letterComposerJob) {
    return (
      <MotivationLetterComposer
        initialJob={letterComposerJob}
        candidateName={baseResumes[0]?.parsedContent?.personalInfo?.name || ''}
        candidateEvidence={baseResumes[0]?.parsedContent?.evidence}
        onClose={() => setLetterComposerJob(null)}
        onSuccess={() => {
          setLetterComposerJob(null);
          fetchResumes();
        }}
      />
    );
  }

  if (editingResume && editedContent) {
    return (
      <div className="space-y-8 animate-in slide-in-from-right duration-300 max-w-4xl">
        <div className="flex items-center gap-4 border-b border-neutral-dark/10 pb-5">
          <button
            onClick={cancelEditing}
            className="p-2 rounded-xl hover:bg-neutral-dark/5 transition-all text-neutral-dark shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-neutral-dark">
              CV-ni Fərdiləşdir (v{editingResume.version})
            </h1>
            <p className="mt-1 text-xs md:text-sm text-neutral-dark/70">
              CV sənədinizin daxili məzmununu hədəflədiyiniz vakansiyanın tələblərinə uyğunlaşdırın.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Əlaqə Məlumatları */}
          <div className="bg-background border border-neutral-dark/5 rounded-2xl p-6 shadow-xs space-y-4">
            <h2 className="font-serif text-lg font-bold text-neutral-dark">Əlaqə məlumatları</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-dark/85">Ad</label>
                <input
                  type="text"
                  value={editedContent.personalInfo?.name || ''}
                  onChange={(e) => {
                    const copy = { ...editedContent };
                    if (!copy.personalInfo) copy.personalInfo = {};
                    copy.personalInfo.name = e.target.value;
                    setEditedContent(copy);
                  }}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-dark/85">E-poçt</label>
                <input
                  type="email"
                  value={editedContent.personalInfo?.email || ''}
                  onChange={(e) => {
                    const copy = { ...editedContent };
                    if (!copy.personalInfo) copy.personalInfo = {};
                    copy.personalInfo.email = e.target.value;
                    setEditedContent(copy);
                  }}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-dark/85">Telefon</label>
                <input
                  type="text"
                  value={editedContent.personalInfo?.phone || ''}
                  onChange={(e) => {
                    const copy = { ...editedContent };
                    if (!copy.personalInfo) copy.personalInfo = {};
                    copy.personalInfo.phone = e.target.value;
                    setEditedContent(copy);
                  }}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Bacarıqlar */}
          <div className="bg-background border border-neutral-dark/5 rounded-2xl p-6 shadow-xs space-y-4">
            <h2 className="font-serif text-lg font-bold text-neutral-dark">Bacarıqlar (vergüllə ayrılmış siyahı)</h2>
            <input
              type="text"
              value={Array.isArray(editedContent.skills) ? editedContent.skills.join(', ') : ''}
              onChange={(e) => {
                const copy = { ...editedContent };
                copy.skills = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                setEditedContent(copy);
              }}
              className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* İş Tarixçəsi */}
          <div className="bg-background border border-neutral-dark/5 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex justify-between items-center border-b border-neutral-dark/5 pb-2">
              <h2 className="font-serif text-lg font-bold text-neutral-dark">İş tarixçəsi</h2>
              <button
                onClick={handleAddExperience}
                className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:text-primary-hover"
              >
                <Plus className="h-4 w-4" /> Vəzifə əlavə et
              </button>
            </div>

            <div className="space-y-4 divide-y divide-neutral-dark/5">
              {(editedContent.workExperience || []).map((exp: any, idx: number) => (
                <div key={idx} className="pt-4 first:pt-0 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-xs font-bold text-neutral-dark">Vəzifə #{idx + 1}</span>
                    <button
                      onClick={() => handleRemoveExperience(idx)}
                      className="text-red-500 hover:text-red-700 text-xs font-semibold"
                    >
                      Sil
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-neutral-dark/75">Başlıq</label>
                      <input
                        type="text"
                        value={exp.title || ''}
                        onChange={(e) => handleUpdateExperience(idx, 'title', e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-dark/75">Şirkət</label>
                      <input
                        type="text"
                        value={exp.company || ''}
                        onChange={(e) => handleUpdateExperience(idx, 'company', e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-neutral-dark/75">Vəzifə açıqlaması</label>
                      <textarea
                        value={exp.description || ''}
                        onChange={(e) => handleUpdateExperience(idx, 'description', e.target.value)}
                        rows={3}
                        className="mt-1 block w-full rounded-lg border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-neutral-dark/10 pt-5">
          <button
            onClick={cancelEditing}
            className="rounded-xl border border-neutral-dark/20 px-5 py-2.5 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all"
          >
            Ləğv et
          </button>
          <button
            onClick={handleSaveEdit}
            className="inline-flex items-center gap-2 product-action rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover shadow-xs transition-all"
          >
            <Save className="h-4 w-4" /> Fərdiləşdirilmiş nüsxəni saxla
          </button>
        </div>
      </div>
    );
  }

  // --- Main View (Resumes Dashboard) ---
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold text-neutral-dark">Sənədlər və CV-lər</h1>
          <p className="mt-2 text-sm text-neutral-dark/70">
            Harvard CV şablonu əsasında hazırlanmış peşəkar format. Hər vakansiya üçün faktiki təcrübənizi aydın şəkildə vurğulayın.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreateModalOpen(true)}
          className="product-action inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-primary-hover shadow-xs transition-all self-start sm:self-auto min-h-11"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Yeni sənəd hazırla</span>
        </button>
        <button type="button" onClick={() => setIsPastedVacancyOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary px-5 py-2.5 text-xs font-semibold text-primary hover:bg-primary/5 self-start sm:self-auto">
          <ClipboardPaste className="h-4 w-4" aria-hidden="true" /> Vakansiya mətni ilə hazırla
        </button>
      </div>

      {/* Authoritative Document Allowance Card */}
      <DocumentAllowanceCard refreshKey={allowanceVersion} />

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100" role="alert">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg bg-green-50 p-4 text-sm text-green-700 border border-green-100" role="alert">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Sol sütun: Əsas CV yüklə */}
        <div className="space-y-6">
          <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 p-6 shadow-xs">
            <h2 className="font-serif text-xl font-bold text-neutral-dark mb-2">Əsas CV Yüklə</h2>
            <p className="text-xs text-neutral-dark/65 mb-4">
              PDF və ya DOCX formatında əsas CV-nizi əlavə edin. Bu sənəd sistemdəki iş elanları ilə uyğunlaşdırılacaq.
            </p>
            
            <div className="flex justify-center rounded-xl border border-dashed border-neutral-dark/25 px-6 py-8 hover:bg-background-warm/15 transition-all">
              <div className="text-center">
                <Upload className="mx-auto h-10 w-10 text-neutral-dark/45" />
                <div className="mt-4 flex flex-wrap justify-center gap-x-1 text-sm text-neutral-dark">
                  <label
                    htmlFor="file-upload"
                    className="relative cursor-pointer rounded-md font-semibold text-accent hover:text-accent-hover focus-within:outline-hidden"
                  >
                    <span>Fayl yükləyin</span>
                    <input
                      id="file-upload"
                      name="file-upload"
                      type="file"
                      ref={fileInputRef}
                      onChange={handleUpload}
                      disabled={uploading}
                      accept=".pdf,.docx"
                      className="sr-only"
                    />
                  </label>
                  <p>və ya buraya sürükləyin</p>
                </div>
                <p className="text-xs text-neutral-dark/50 mt-1">Maksimum 10MB, PDF və ya DOCX</p>
              </div>
            </div>
            {uploading && <p className="text-xs text-primary mt-2 text-center animate-pulse">Fayl yüklənir...</p>}
          </div>
        </div>

        {/* Sağ sütun: Əsas CV və Fərdiləşdirilmiş siyahı */}
        <div className="lg:col-span-2 space-y-6">
          {/* Əsas CV-lər Siyahısı */}
          <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 p-6 shadow-xs">
            <h2 className="font-serif text-lg font-bold text-neutral-dark mb-4 border-b border-neutral-dark/5 pb-2">CV-lər</h2>
            {baseResumes[0] && <div className="mb-4"><ExtractionNotice parsed={baseResumes[0].parsedContent} /></div>}

            {baseResumes.length === 0 ? (
              <p className="text-xs text-neutral-dark/50 text-center py-6">Hələ heç bir əsas CV yüklənməyib.</p>
            ) : (
              <div className="space-y-4">
                {baseResumes.map((resume) => (
                  <div key={resume.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-neutral-dark/15 p-4 hover:border-neutral-dark/30 transition-all bg-background-warm/5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="rounded-lg bg-primary/10 p-2 text-primary">
                        <FileText className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => resume.fileUrl && downloadAuthedFile(resume.fileUrl, `cv-${resume.id}.pdf`)}
                          className="tap font-semibold text-sm text-neutral-dark hover:text-accent transition-colors block truncate text-left"
                        >
                          Əsas sənədə bax
                        </button>
                        <p className="text-[10px] text-neutral-dark/50 mt-0.5">
                          Yüklənmə tarixi: {formatDate(resume.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEditing(resume)}
                        className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl p-2 text-neutral-dark hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                        title="CV məzmununu düzənlə"
                        aria-label="CV məzmununu düzənlə"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(resume.id)}
                        className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl p-2 text-red-500 hover:bg-red-50 transition-all focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-hidden"
                        title="CV-ni sil"
                        aria-label="CV-ni sil"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Fərdiləşdirilmiş CV-lər Siyahısı */}
          <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 p-6 shadow-xs">
            <h2 className="font-serif text-lg font-bold text-neutral-dark mb-4 border-b border-neutral-dark/5 pb-2">Hazırlanmış sənədlər (CV, rezümə, məktub)</h2>
            
            {tailoredResumes.length === 0 ? (
              <p className="text-xs text-neutral-dark/50 text-center py-6">Hələ heç bir sənəd hazırlanmayıb. «Yeni sənəd hazırla» düyməsi ilə seçdiyiniz vakansiya üçün CV, rezümə və ya motivasiya məktubu yarada bilərsiniz.</p>
            ) : (
              <div className="space-y-4">
                {tailoredResumes.map((resume) => (
                  <div key={resume.id} data-testid={`document-row-${resume.id}`} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-neutral-dark/15 p-4 hover:border-neutral-dark/30 transition-all bg-background-warm/5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`rounded-lg p-2 ${
                        resume.status === 'FAILED' ? 'bg-red-50 text-red-500' :
                        resume.status === 'PENDING' ? 'bg-neutral-dark/5 text-neutral-dark/40' :
                        'bg-accent/15 text-accent'
                      }`}>
                        <CheckCircle className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => openDocument(resume)}
                          className="tap font-semibold text-sm text-neutral-dark hover:text-accent transition-colors block text-left break-words"
                        >
                          {KIND_LABEL[kindOf(resume)]} (v{resume.version}){resume.language ? ` · ${resume.language.toUpperCase()}` : ''}
                        </button>
                        <p className="text-[11px] mt-0.5 font-medium" data-testid={`tailored-status-${resume.id}`}>
                          {resume.status === 'PENDING' && <span className="text-primary animate-pulse">Hazırlanır...</span>}
                          {resume.status === 'NEEDS_REVIEW' && <span className="text-amber-700">Yoxlanılmalı və təsdiqlənməlidir</span>}
                          {resume.status === 'READY' && resume.reviewedAt && <span className="text-green-700">Təsdiqlənib — PDF hazırdır</span>}
                          {resume.status === 'READY' && !resume.reviewedAt && <span className="text-amber-700">Köhnə versiya — yoxlanılmayıb</span>}
                          {resume.status === 'FAILED' && <span className="text-red-600">Uğursuz oldu: {resume.statusError}</span>}
                        </p>
                        <p className="text-[10px] text-neutral-dark/50 mt-0.5">
                          Yaradılma tarixi: {formatDate(resume.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      {resume.status === 'READY' && resume.fileUrl && (
                        <button
                          type="button"
                          onClick={() => downloadAuthedFile(resume.fileUrl!, `${fileStem(resume)}-v${resume.version}.pdf`)}
                          className="min-h-11 inline-flex items-center justify-center rounded-xl px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent/10 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                        >
                          PDF yüklə
                        </button>
                      )}
                      {resume.status === 'NEEDS_REVIEW' && (
                        <button type="button" onClick={() => openDocument(resume)} className="ui-btn ui-btn-primary">
                          Yoxla və təsdiqlə
                        </button>
                      )}
                      {resume.status === 'READY' && (
                        <button
                          type="button"
                          onClick={() => openDocument(resume)}
                          className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl p-2 text-neutral-dark hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                          title="Yoxla və redaktə et"
                          aria-label="Yoxla və redaktə et"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                      )}
                      {resume.status === 'FAILED' && (
                        <button
                          type="button"
                          onClick={() => retryTailoring(resume)}
                          className="min-h-11 inline-flex items-center justify-center rounded-xl px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                        >
                          Yenidən cəhd et
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(resume.id)}
                        className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl p-2 text-red-500 hover:bg-red-50 transition-all focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-hidden"
                        title="Nüsxəni sil"
                        aria-label="Nüsxəni sil"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <CreateDocumentModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        initialMatchId={createFor}
        initialSavedRef={createSavedRef}
        initialKind={createKind}
        initialLanguage={createLang}
        baseResumeId={baseResumes[0]?.id}
        candidateEvidence={baseResumes[0]?.parsedContent?.evidence}
        onStartLetterFlow={(job) => {
          setIsCreateModalOpen(false);
          setLetterComposerJob(job);
        }}
        onSuccess={() => {
          setIsCreateModalOpen(false);
          fetchResumes();
        }}
      />
      <PastedVacancyModal
        open={isPastedVacancyOpen}
        onClose={() => setIsPastedVacancyOpen(false)}
        onGenerated={(id) => {
          setIsPastedVacancyOpen(false);
          setReviewingId(id);
          fetchResumes();
          window.history.replaceState(null, '', `/dashboard/resumes?review=${encodeURIComponent(id)}`);
        }}
      />
    </div>
  );
}
