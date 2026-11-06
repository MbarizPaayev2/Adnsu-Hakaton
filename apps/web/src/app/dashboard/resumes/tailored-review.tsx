'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch, downloadAuthedFile } from '@/lib/api';
import { notify } from '@/lib/notify';
import { AlertTriangle, ArrowLeft, CheckCircle, Download, Save } from 'lucide-react';

interface ReviewIssue {
  code: string;
  severity: 'error' | 'warning';
  section: string;
  detail: string;
  reason?: 'NO_ROOM' | 'OTHER_LANGUAGE';
}

interface Experience {
  company: string;
  position: string;
  period: string;
  location: string;
  highlights: string[];
}

interface TailoredDetail {
  id: string;
  kind?: 'CV' | 'RESUME' | 'LETTER';
  language?: string | null;
  status: 'PENDING' | 'NEEDS_REVIEW' | 'READY' | 'FAILED';
  statusError: string | null;
  version: number;
  fileUrl: string | null;
  reviewedAt: string | null;
  content: {
    basics: { name: string; headline: string; email: string; location: string };
    summary: string;
    experience: Experience[];
    education: { school: string; degree: string; area: string; period: string }[];
    skills: { name?: string; keywords: string[] }[];
  } | null;
  reviewNotes: {
    issues?: ReviewIssue[];
    revision?: number;
    vacancyAnalysis?: {
      targetRole: string;
      statedSeniority?: string;
      priorities: Array<{ id: string; category: string; sourceText: string; weight: number }>;
      unknowns?: string[];
    };
    untranslatedAcknowledged?: boolean;
    acknowledgedUntranslatedCount?: number;
  } | null;
  provenance?: {
    vacancyAnalysis?: {
      targetRole: string;
      statedSeniority?: string;
      priorities: Array<{ id: string; category: string; sourceText: string; weight: number }>;
      unknowns?: string[];
    };
  } | null;
  /** How long the document is as it would be approved (drafts only). */
  layout?: { pages: number; expectedMaxPages: number; status: 'OK' | 'LONGER_THAN_EXPECTED' } | null;
  posting: { title: string; company: string; actionable: boolean } | null;
  /** English text still present in an Azerbaijani CV; approval waits until this is empty or acknowledged. */
  untranslated?: { path: string; text: string; section: string }[];
}

/** The server names a left-out career entry as "KIND: title"; show the kind in the candidate's words. */
const CAREER_KIND_LABELS: Record<string, string> = { PROJECT: 'Layihə', VOLUNTEERING: 'Könüllülük', LEADERSHIP: 'Liderlik', EXTRACURRICULAR: 'Fəaliyyət', CERTIFICATION: 'Sertifikat', LANGUAGE: 'Dil', AWARD: 'Mükafat', STORY: 'Hekayə', OTHER: 'Digər' };
export function issueDetail(detail: string | undefined | null): string {
  if (!detail) return '';
  const m = /^([A-Z_]+): ([\s\S]*)$/.exec(detail);
  return m && CAREER_KIND_LABELS[m[1]] ? `${CAREER_KIND_LABELS[m[1]]}: ${m[2]}` : detail;
}

const ISSUE_LABELS: Record<string, string> = {
  invented_experience: 'Profildə olmayan iş yeri çıxarıldı',
  changed_position: 'Vəzifə adı profildəki kimi saxlanıldı',
  changed_period: 'Tarixlər profildəki kimi saxlanıldı',
  missing_rewrite: 'Bu bölmə üçün profildəki mətn saxlanıldı',
  unsupported_number: 'Profildə olmayan rəqəm olan cümlə çıxarıldı',
  unsupported_term: 'Profildə olmayan bacarıq/ad olan cümlə çıxarıldı',
  unsupported_personal_claim: 'Siz demədiyiniz hiss və ya fikir olan cümlə çıxarıldı',
  unsupported_employer_claim: 'Profilinizdə olmayan iş yeri iddiası olan cümlə çıxarıldı',
  filler_phrase: 'Məlumat verməyən ümumi ifadə var — daha konkret yazmağı düşünün',
  restored_metric: 'Sizin yazdığınız rəqəm itməsin deyə saxlanılmış mətn əlavə edildi',
  dropped_metric: 'Sizin yazdığınız rəqəm bəndlərdə yer almadı',
  skill_list: 'Bir cümlədə çoxlu bacarıq sadalanıb — qısaltmağı düşünün',
  candidate_wording: 'Sizin yazdığınız mətndə başqa dilin forması ola bilər (mətn dəyişdirilməyib, yoxlayın)',
  left_out_entry: 'Təsdiqlənmiş qeyd bu sənədə daxil edilməyib; lazımdırsa baxış mərhələsində geri əlavə edin',
  reworded: 'Bənd daha aydın ifadə edildi (sizin sözləriniz → yeni mətn)',
  unused_evidence: 'Təsdiqlənmiş təcrübəniz bu məktubda istifadə edilmədi',
  uncovered_requirement: 'Elanın bu tələbinə cavab verən təsdiqlənmiş fakt tapılmadı',
  add_detail: 'Bu iş yerində bəndlər qısadır: rəqəm, alət və ya nəticə yoxdur',
  reason_missing: 'Cavab verilməyən suallar üzrə məktubda heç nə yazılmadı (bu işin sizi nə cəlb etməsi, hansı təcrübənin bunu aydınlaşdırması, vakansiyada diqqət çəkən məqam, nəzərə alınmasını istədiyiniz töhfə)',
  writer_fallback: 'Bu sənəd təkmil yazı mərhələsi ilə deyil, standart qaydada hazırlandı (mərhələ yoxlamadan keçmədi və ya əlçatan olmadı)',
  answer_length: 'Cavabın uzunluğu gözlənilən aralıqdan kənardadır',
  invented_skill: 'Profildə olmayan bacarıq çıxarıldı',
  invented_education: 'Profildə olmayan təhsil çıxarıldı',
  invented_language: 'Profildə olmayan dil çıxarıldı',
  invented_project: 'Profildə olmayan layihə/sertifikat çıxarıldı',
  trimmed_highlights: 'Artıq yaradılmış bəndlər istifadə edilmədi',
  invented_activity: 'Profildə olmayan fəaliyyət/mükafat çıxarıldı',
  invented_certification: 'Profildə olmayan sertifikat çıxarıldı',
  unsupported_project_text: 'Layihə təsvirindəki əsassız cümlə çıxarıldı',
  wrong_language_text: 'Seçilmiş dilə uyğun olmayan cümlə çıxarıldı',
  translated: 'Mətn ingilis dilindən Azərbaycan dilinə çevrildi (orijinal → tərcümə)',
  not_translated: 'Bu hissə hələ ingilis dilindədir',
  check_wording: 'Tərcümədə təbii olmayan söz ola bilər — bu sözləri yoxlayın',
  evidence_not_translated: 'Bu faktlar etibarlı tərcümə olunmadığı üçün məktuba daxil edilmədi',
};

/** What the candidate can do about a note (shown after it). Removed items need a profile fix; notes need a look at the wording. */
const ISSUE_ACTIONS: Record<string, string> = {
  dropped_metric: 'Lazımdırsa, aşağıdakı müvafiq bəndə özünüz əlavə edin.',
  restored_metric: 'Bu sizin öz mətninizdir; bəndin düzgün olduğunu yoxlayın.',
  filler_phrase: 'Daha konkret yazın: nə etdiniz, nəyə gətirdi.',
  skill_list: 'Yalnız işi izah edən alətləri saxlayın.',
  candidate_wording: 'Sözü və ya ifadəni özünüz düzəldin; mənanı dəyişməyin.',
  left_out_entry: 'Əlavə etmək üçün baxış səhifəsindəki seçimdən istifadə edin.',
  reworded: 'Avtomatik yoxlama mənanın düzgünlüyünü təsdiqləmir: kim nə etdi, rəqəmlər və alətlər sizin dediyiniz kimidir? Dəyişibsə, bəndi öz sözlərinizlə düzəldin.',
  unused_evidence: 'Bu məktuba daha uyğundursa, aşağıda öz cümlənizi əlavə edə bilərsiniz.',
  uncovered_requirement: 'Bununla bağlı real təcrübəniz varsa, profilinizə əlavə edin və ya aşağıda öz sözlərinizlə yazın. Yoxdursa, məktub bu tələbi iddia etmir.',
  add_detail: 'İstəyə bağlı: bu işdə konkret nə qədər, hansı alətlə, nəyə gətirdi? Bir cümlə əlavə etsəniz, bənd dolğun olur; etməsəniz, mövcud faktlarla qalır, heç nə uydurulmur.',
  reason_missing: 'İstəyə bağlı: bu suallara qısa cavab verib məktubu yenidən hazırlaya və ya aşağıda cümləni özünüz əlavə edə bilərsiniz. Boş buraxmaq düzgündür: heç bir həvəs və səbəb uydurulmur.',
  writer_fallback: 'Mətn sizin təsdiqlənmiş faktlarınızdan hazırlanıb; yenidən yaratmaq istəsəniz, bu, ayrıca generasiya sayılır.',
  missing_rewrite: 'Profildəki mətn dəyişmədən saxlanıldı; istəsəniz aşağıda redaktə edin.',
  trimmed_highlights: 'Əlavə bəndlər istifadə edilmədi; lazım olanı özünüz əlavə edin.',
  answer_length: 'Mətni gözlənilən uzunluğa gətirin.',
  translated: 'Tərcüməni orijinalla yoxlayın: rəqəmlər, adlar və alətlər eynidir, məna dəyişməyib? Lazımdırsa aşağıda düzəldin.',
  check_wording: 'Göstərilən sözləri düzgün Azərbaycan sözü ilə əvəz edin və ya bəndi özünüz yazın. Avtomatik tərcümə təbii olduğunu təsdiqləmir.',
  evidence_not_translated: 'Məktubda istifadə olunsun istəyirsinizsə, bu bəndləri profilinizdə Azərbaycan dilində yazın və məktubu yenidən hazırlayın.',
  not_translated: 'Bu hissəni özünüz Azərbaycan dilində yazın və ya “Tərcüməni yenidən cəhd et” düyməsinə basın. Bu hissə tərcümə olunmayana qədər PDF yaradılmır.',
};

/** Why a note exists (the API sends a code; the wording is the app's, in the candidate's language). */
const ISSUE_REASONS: Record<string, string> = {
  NO_ROOM: 'bu sənəddə ona yer qalmadı',
  OTHER_LANGUAGE: 'saxlanmış sətriniz bu sənədin dilində deyil, ona görə kopyalanmadı',
};

const KIND_TITLE = { CV: 'Geniş CV', RESUME: 'Rezüme', LETTER: 'Motivasiya məktubu' } as const;

async function errorMessage(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  return (Array.isArray(data.message) ? data.message.join(', ') : data.message) || fallback;
}

/**
 * Candidate review of a generated draft: the fact-check findings, editable
 * wording, read-only facts from the saved profile, and approval — which is
 * the only step that produces the downloadable PDF.
 */
export default function TailoredReview({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<TailoredDetail | null>(null);
  const [headline, setHeadline] = useState('');
  const [summary, setSummary] = useState('');
  const [highlights, setHighlights] = useState<string[]>([]);
  const [groupedSkills, setGroupedSkills] = useState<{ name: string; keywords: { name: string; included: boolean }[] }[]>([]);
  const [busy, setBusy] = useState<'save' | 'approve' | 'translate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    const res = await apiFetch(`/resumes/${id}`);
    if (!res.ok) {
      setError(await errorMessage(res, 'CV yüklənə bilmədi.'));
      return;
    }
    const data: TailoredDetail = await res.json();
    setDetail(data);
    if (data.content) {
      setHeadline(data.content.basics.headline || '');
      setSummary(data.content.summary || '');
      setHighlights(data.content.experience.map((e) => e.highlights.join('\n')));
      const rawGroups = data.content.skills || [];
      const groups = rawGroups.map((g) => ({
        name: g.name || '',
        keywords: (g.keywords || []).map((name) => ({ name, included: true })),
      }));
      setGroupedSkills(groups);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (detail?.status !== 'PENDING') return;
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.status]);

  const save = async (): Promise<TailoredDetail | null> => {
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const hasNamedGroups = groupedSkills.some((g) => g.name && g.name.trim().length > 0);
      const skillsPayload = hasNamedGroups
        ? groupedSkills
            .map((g) => ({
              name: g.name,
              keywords: g.keywords.filter((k) => k.included).map((k) => k.name),
            }))
            .filter((g) => g.keywords.length > 0)
        : groupedSkills.flatMap((g) => g.keywords.filter((k) => k.included).map((k) => k.name));

      const res = await apiFetch(`/resumes/${id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({
          headline,
          summary,
          experience: highlights.map((text) => ({ highlights: text.split('\n').map((l) => l.trim()).filter(Boolean) })),
          skills: skillsPayload,
        }),
      });
      if (!res.ok) {
        setError(await errorMessage(res, 'Dəyişikliklər yadda saxlanılmadı.'));
        return null;
      }
      const data: TailoredDetail = await res.json();
      setDetail(data);
      setNotice('Dəyişikliklər yadda saxlanıldı. PDF üçün qaralamanı təsdiqləyin.');
      await load();
      return data;
    } finally {
      setBusy(null);
    }
  };

  const approveWithUntranslated = async () => {
    const saved = await save();
    if (!saved) return;
    const rev = saved.reviewNotes?.revision ?? saved.version ?? 0;
    setBusy('approve');
    try {
      const res = await apiFetch(`/resumes/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          acknowledgeUntranslated: true,
          reviewedRevision: rev,
        }),
      });
      if (!res.ok) {
        setError(await errorMessage(res, 'Təsdiqləmək mümkün olmadı.'));
        return;
      }
      setNotice('Təsdiqləndi. PDF hazırdır.');
      await load();
    } finally {
      setBusy(null);
    }
  };

  /**
   * The PDF as it would be approved (draft) or as approved (after approval): the server renders it with the same code. Free.
   * The tab is opened synchronously inside the tap (a window opened after the download finishes is blocked on phones) and pointed at the PDF
   * afterwards; if the browser still refuses, the PDF is offered as a tap-to-open link instead of nothing happening.
   */
  const preview = async () => {
    setError(null);
    const tab = window.open('', '_blank');
    try {
      const res = await apiFetch(`/documents/${id}/preview`);
      if (!res.ok) {
        tab?.close();
        setError(await errorMessage(res, 'PDF önizləməsi alına bilmədi.'));
        return;
      }
      const url = window.URL.createObjectURL(await res.blob());
      const name = `${detail?.kind === 'RESUME' ? 'rezume' : 'cv'}-v${detail?.version ?? ''}-onizleme.pdf`;
      if (tab && !tab.closed) {
        tab.location.href = url;
      } else {
        notify({ tone: 'info', text: 'PDF hazırdır. Brauzer yeni pəncərəni açmağa icazə vermədi; aşağıdakı düyməyə toxunun.', href: url, hrefLabel: 'PDF-i aç', download: name });
      }
      setTimeout(() => window.URL.revokeObjectURL(url), 120_000);
    } catch {
      tab?.close();
      setError('PDF önizləməsi alına bilmədi. Bağlantınızı yoxlayıb yenidən cəhd edin.');
    }
  };

  const retranslate = async () => {
    if (busy) return;
    setBusy('translate');
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/resumes/${id}/translate`, { method: 'POST' });
      if (!res.ok) {
        setError(await errorMessage(res, 'Tərcümə alınmadı. Bir az sonra yenidən cəhd edin.'));
        return;
      }
      const result = await res.json();
      if (result.untranslated?.length) setError(`${result.untranslated.length} hissə hələ tərcümə olunmadı. Yenidən cəhd edə bilərsiniz; uğurlu tərcümələr saxlanılıb.`);
      else setNotice('Bütün hissələr tərcümə olundu. Nəticəni yoxlayın.');
      await load();
    } catch {
      setError('Tərcümə alınmadı. Bağlantınızı yoxlayıb yenidən cəhd edin.');
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!(await save())) return;
    setBusy('approve');
    try {
      const res = await apiFetch(`/resumes/${id}/approve`, { method: 'POST' });
      if (!res.ok) {
        setError(await errorMessage(res, 'Təsdiqləmək mümkün olmadı.'));
        return;
      }
      setNotice('Təsdiqləndi. PDF hazırdır.');
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (!detail) {
    return <p className="text-sm text-neutral-dark/65">{error || 'Yüklənir...'}</p>;
  }

  const issues = detail.reviewNotes?.issues || [];
  const removed = issues.filter((i) => i.severity === 'error');
  const kept = issues.filter((i) => i.severity === 'warning');
  const editable = detail.status === 'NEEDS_REVIEW' || detail.status === 'READY';

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-300" data-testid="tailored-review">
      <button onClick={onClose} className="inline-flex items-center gap-1 text-sm font-semibold text-neutral-dark/70 hover:text-neutral-dark">
        <ArrowLeft className="h-4 w-4" /> CV-lərə qayıt
      </button>

      <div className="border-b border-neutral-dark/10 pb-4">
        <h1 className="font-serif text-2xl font-bold text-neutral-dark">{KIND_TITLE[detail.kind ?? 'CV']} (v{detail.version}){detail.language ? ` · ${detail.language.toUpperCase()}` : ''}</h1>
        {detail.posting && (
          <p className="text-sm text-neutral-dark/70 mt-1">
            {detail.posting.title} — {detail.posting.company}
            {!detail.posting.actionable && <span className="ml-2 text-red-600 font-semibold">Elan artıq aktiv deyil</span>}
          </p>
        )}
        <p className="mt-2 text-sm font-semibold" role="status">
          {detail.status === 'PENDING' && 'Hazırlanır... Bu səhifəni yeniləsəniz də proses davam edir.'}
          {detail.status === 'NEEDS_REVIEW' && 'Qaralama hazırdır — yoxlayın, düzəldin və təsdiqləyin. Təsdiqlənməmiş CV yüklənə bilməz.'}
          {detail.status === 'READY' && 'Təsdiqlənib — PDF yüklənə bilər. CV avtomatik heç yerə göndərilmir.'}
          {detail.status === 'FAILED' && `Uğursuz oldu: ${detail.statusError || ''}`}
        </p>
      </div>

      {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-100">{error}</div>}
      {notice && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-800 border border-green-100">{notice}</div>}

      {/* Vacancy Priorities & Selected Evidence Panel */}
      {(() => {
        const analysis = detail.reviewNotes?.vacancyAnalysis || detail.provenance?.vacancyAnalysis;
        if (!analysis && !detail.posting) return null;
        return (
          <details data-testid="vacancy-priorities-panel" className="group rounded-xl border border-neutral-dark/15 bg-background-warm/5 p-4 text-sm space-y-3">
            <summary className="flex cursor-pointer items-center justify-between font-bold text-neutral-dark select-none">
              <span>Vakansiya üzrə prioritetlər və seçilmiş faktlar</span>
              <span className="text-xs text-neutral-dark/60 group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="pt-2 text-xs space-y-3 border-t border-neutral-dark/10">
              {analysis?.targetRole && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-neutral-dark">Hədəf vəzifə:</span>
                  <span className="rounded bg-neutral-dark/10 px-2 py-0.5 font-medium">{analysis.targetRole}</span>
                  {analysis.statedSeniority && (
                    <span className="text-neutral-dark/60 font-medium">({analysis.statedSeniority} səviyyə)</span>
                  )}
                </div>
              )}
              {analysis?.priorities && analysis.priorities.length > 0 && (
                <div className="space-y-1.5">
                  <p className="font-semibold text-neutral-dark">Əsas tələb və məsuliyyətlər:</p>
                  <ul className="space-y-1 pl-1">
                    {analysis.priorities.map((p, idx) => (
                      <li key={p.id || idx} className="flex items-start gap-1.5 text-neutral-dark/80">
                        <span className="mt-0.5 inline-block rounded bg-primary/10 text-primary font-mono text-[10px] px-1 py-0.2">P{idx + 1}</span>
                        <span>{p.sourceText}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[11px] text-neutral-dark/55 italic">
                Süni intellekt uyğunluq balı (ATS score) uydurulmur; yalnız elandakı faktiki tələblər və profilinizdəki təsdiqlənmiş sübutlar göstərilir.
              </p>
            </div>
          </details>
        );
      })()}

      {detail.status === 'NEEDS_REVIEW' && (detail.untranslated?.length ?? 0) > 0 && (
        <section role="alert" data-testid="untranslated-notice" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950 space-y-2">
          <p className="font-semibold">{detail.untranslated!.length} hissə hələ ingilis dilindədir</p>
          <p className="text-xs">
            Bəzi hissələr tərcümə olunmayıb. Mətnləri yoxlayaraq sənədi bu formada təsdiqləyə bilərsiniz.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-xs">
            {detail.untranslated!.slice(0, 8).map((u) => (
              <li key={u.path} className="break-words">
                <span className="font-semibold">{u.section === 'summary' ? 'Xülasə' : u.section === 'headline' ? 'Başlıq' : u.section}:</span> {u.text.length > 140 ? `${u.text.slice(0, 140)}…` : u.text}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={retranslate} disabled={busy !== null}
              className="min-h-11 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {busy === 'translate' ? 'Tərcümə olunur...' : 'Tərcüməni yenidən cəhd et'}
            </button>
            <button type="button" onClick={approveWithUntranslated} disabled={busy !== null}
              className="min-h-11 rounded-full border border-red-300 bg-white px-5 py-2 text-sm font-semibold text-red-900 hover:bg-red-100/50 disabled:opacity-60">
              {busy === 'approve' ? 'Təsdiqlənir...' : 'Bu formada təsdiqlə və PDF yüklə'}
            </button>
          </div>
        </section>
      )}

      {detail.layout?.status === 'LONGER_THAN_EXPECTED' && (
        <section role="status" data-testid="layout-notice" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Bu sənəd {detail.layout.pages} səhifədir (gözlənilən: ən çox {detail.layout.expectedMaxPages})</p>
          <p className="mt-1 text-xs">
            Heç nə kəsilmədi və ya gizlədilmədi; PDF-in hamısı belə çıxacaq. Qısa olmasını istəyirsinizsə, təsdiqdən əvvəl aşağıda ən az uyğun bəndləri silin. Profilinizdəki məlumat dəyişməz qalır.
          </p>
        </section>
      )}

      {removed.length > 0 && (
        <section aria-labelledby="fact-check-heading" className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <h2 id="fact-check-heading" className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <AlertTriangle className="h-4 w-4" /> Faktların yoxlanışı: çıxarılanlar
          </h2>
          <p className="text-xs text-amber-900/80">
            Aşağıdakılar profilinizdə təsdiqlənmədiyi üçün qaralamaya daxil edilmədi. Doğrudursa, əvvəlcə profilinizi yeniləyin.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-xs text-amber-950">
            {removed.map((issue, i) => (
              <li key={i}>
                <span className="font-semibold">{ISSUE_LABELS[issue.code] || issue.code}{issue.code === 'writer_fallback' || issue.code === 'reason_missing' ? '' : ':'}</span> {issue.code === 'writer_fallback' || issue.code === 'reason_missing' ? null : issueDetail(issue.detail)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {kept.length > 0 && (
        <section aria-labelledby="review-notes-heading" data-testid="review-notes" className="rounded-xl border border-neutral-dark/15 bg-background-warm/10 p-4 space-y-2">
          <h2 id="review-notes-heading" className="text-sm font-bold text-neutral-dark">Yoxlamaq üçün qeydlər</h2>
          <p className="text-xs text-neutral-dark/70">Bunlar çıxarılmayıb; sadəcə diqqət tələb edir.</p>
          <ul className="list-disc pl-5 space-y-1 text-xs text-neutral-dark">
            {kept.map((issue, i) => (
              <li key={i}>
                <span className="font-semibold">{ISSUE_LABELS[issue.code] || issue.code}{issue.code === 'writer_fallback' || issue.code === 'reason_missing' ? '' : ':'}</span> {issue.code === 'writer_fallback' || issue.code === 'reason_missing' ? null : issueDetail(issue.detail)}
                {issue.reason && ISSUE_REASONS[issue.reason] && <span className="block text-neutral-dark/70">({ISSUE_REASONS[issue.reason]})</span>}
                {ISSUE_ACTIONS[issue.code] && <span className="block text-neutral-dark/70">→ {ISSUE_ACTIONS[issue.code]}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.content && (
        <div className="space-y-5">
          <p className="text-xs text-neutral-dark/60">
            Ad, əlaqə, iş yerləri, vəzifələr, tarixlər və təhsil saxlanılmış profilinizdən götürülür və burada dəyişdirilmir.
          </p>
          <div>
            <p className="text-lg font-bold">{detail.content.basics.name}</p>
            <p className="text-xs text-neutral-dark/60">{detail.content.basics.location} · {detail.content.basics.email}</p>
          </div>
          <label className="block text-sm font-semibold">
            Başlıq
            <input value={headline} disabled={!editable} onChange={(e) => setHeadline(e.target.value)} maxLength={300}
              className="mt-1 w-full rounded-lg border border-neutral-dark/20 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="block text-sm font-semibold">
            Xülasə
            <textarea value={summary} disabled={!editable} onChange={(e) => setSummary(e.target.value)} rows={3} maxLength={3000}
              className="mt-1 w-full rounded-lg border border-neutral-dark/20 px-3 py-2 text-sm font-normal" />
          </label>
          {detail.content.experience.map((exp, i) => (
            <fieldset key={i} className="rounded-xl border border-neutral-dark/10 p-4 space-y-2">
              <legend className="px-1 text-sm font-bold">{exp.position} — {exp.company}</legend>
              <p className="text-xs text-neutral-dark/60">{exp.period}{exp.location ? ` · ${exp.location}` : ''}</p>
              <label className="block text-xs font-semibold">
                Bəndlər (hər sətir bir bənd)
                <textarea value={highlights[i] ?? ''} disabled={!editable} rows={Math.max(3, (highlights[i] || '').split('\n').length + 1)}
                  onChange={(e) => setHighlights(highlights.map((h, j) => (j === i ? e.target.value : h)))}
                  className="mt-1 w-full rounded-lg border border-neutral-dark/20 px-3 py-2 text-sm font-normal" />
              </label>
            </fieldset>
          ))}
          {detail.content.education.length > 0 && (
            <div className="text-sm">
              <p className="font-semibold">Təhsil</p>
              {detail.content.education.map((e, i) => (
                <p key={i} className="text-neutral-dark/80">{e.school} — {[e.degree, e.area].filter(Boolean).join(', ')} ({e.period})</p>
              ))}
            </div>
          )}
          <fieldset className="text-sm">
            <legend className="font-semibold">Bacarıqlar (saxlanılmış profilinizdən)</legend>
            <div className="mt-2 space-y-3">
              {groupedSkills.map((group, gi) => (
                <div key={gi} className="space-y-1">
                  {group.name ? (
                    <p className="text-xs font-bold text-neutral-dark/80">{group.name}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {group.keywords.map((s, ki) => (
                      <label key={s.name} className="inline-flex items-center gap-1 rounded-lg border border-neutral-dark/15 px-2 py-1 text-xs">
                        <input
                          type="checkbox"
                          checked={s.included}
                          disabled={!editable}
                          onChange={() =>
                            setGroupedSkills(
                              groupedSkills.map((g, idx) =>
                                idx === gi
                                  ? {
                                      ...g,
                                      keywords: g.keywords.map((k, kIdx) =>
                                        kIdx === ki ? { ...k, included: !k.included } : k,
                                      ),
                                    }
                                  : g,
                              ),
                            )
                          }
                        />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-neutral-dark/10 pt-4">
        {editable && (
          <button onClick={save} disabled={busy !== null}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-neutral-dark/20 px-4 py-2 text-sm font-bold disabled:opacity-60">
            <Save className="h-4 w-4" /> {busy === 'save' ? 'Saxlanılır...' : 'Yadda saxla'}
          </button>
        )}
        {editable && (
          <button type="button" onClick={preview} disabled={busy !== null}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-neutral-dark/20 px-4 py-2 text-sm font-bold disabled:opacity-60">
            <Download className="h-4 w-4" /> PDF önizləmə
          </button>
        )}
        {detail.status === 'NEEDS_REVIEW' && (
          <button onClick={approve} disabled={busy !== null || (detail.untranslated?.length ?? 0) > 0}
            title={(detail.untranslated?.length ?? 0) > 0 ? 'Əvvəlcə ingilis dilində qalan hissələri tərcümə edin' : undefined}
            className="inline-flex min-h-11 items-center gap-1 product-action rounded-full bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            <CheckCircle className="h-4 w-4" /> {busy === 'approve' ? 'Təsdiqlənir...' : 'Yoxladım, təsdiqlə və PDF yarat'}
          </button>
        )}
        {detail.status === 'READY' && detail.fileUrl && (
          <button onClick={() => downloadAuthedFile(detail.fileUrl!, `${detail.kind === 'RESUME' ? 'rezume' : 'cv'}-v${detail.version}.pdf`)}
            className="inline-flex min-h-11 items-center gap-1 product-action rounded-full bg-accent px-4 py-2 text-sm font-bold text-white">
            <Download className="h-4 w-4" /> PDF-i yüklə
          </button>
        )}
      </div>
    </div>
  );
}
