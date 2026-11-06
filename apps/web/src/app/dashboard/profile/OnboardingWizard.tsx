'use client';

import { LinkedInImportPanel } from '@/components/profile/linkedin-import-panel';
import { ExtractionNotice } from '@/components/profile/extraction-notice';
import { ImportPreview } from '@/components/profile/import-preview';
import { PeriodInput, type DatePrecision } from '@/components/profile/period-input';
import { ExperienceWritingGuide } from '@/components/profile/writing-guide';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useSession } from 'next-auth/react';
import { mergeEducation, mergeExperiences, mergeSkills, type ExperienceConflict, type MergeEducation, type MergeExperience } from '@/lib/profile-merge';
import { blockNegativeAndExponentKeys, parseNonNegativeNumber } from '@/lib/number-input';
import { resumeFileError, RESUME_ACCEPT_HINT } from '@/lib/resume-file';
import { ArrowLeft, ArrowRight, Check, Plus, Trash2, UploadCloud, FileText, Sparkles, AlertCircle } from 'lucide-react';
import { CareerEvidenceEditor } from '@/components/profile/career-evidence-editor';
import {
  CareerEvidenceState,
  EMPTY_CAREER_EVIDENCE,
  normalizeExtractedEvidence,
  careerEntriesToEvidenceState,
  syncCareerEntriesToBackend,
  BackendCareerEntry,
  generateEvidenceId,
} from '@/lib/career-evidence';

/**
 * Onboarding: upload a CV, correct what was read out of it, done.
 *
 * The previous version asked eleven questions in sequence — name, headline,
 * location, skills, target roles, target locations, work mode, salary,
 * experience, education, review — before a new account could reach the
 * dashboard. Everything after the first two is already written down in the CV
 * the user is about to upload anyway, so it was asking people to retype their
 * own document.
 *
 * Now there are three steps: upload, review, and an optional preferences
 * step. Extraction is best-effort (see apps/api/src/resumes/cv-parser.ts), so
 * the review step is the point of the flow rather than a formality: every
 * field is editable, every list row is deletable, and anything the parser
 * could not find is shown empty instead of guessed at.
 */

interface Experience {
  title: string;
  company: string;
  /** Only what the CV states for this role ("Remote", "Baku, Azerbaijan"); empty when it does not say. */
  location?: string;
  startDate: string;
  endDate: string | null;
  startPrecision?: DatePrecision | null;
  endPrecision?: DatePrecision | null;
  description: string;
  /** From an import: fields the reader could not determine, and the lines it read them from. Shown for review, never saved. */
  uncertain?: string[];
  source?: string;
}

interface Education {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  location?: string;
  /** Empty when the record states no dates; saved undated, never filled in. */
  startDate: string;
  endDate: string | null;
  startPrecision?: DatePrecision | null;
  endPrecision?: DatePrecision | null;
  uncertain?: string[];
  source?: string;
}

/** Import fields kept beside a parsed role/school for the review: precision, what was unclear, and the source lines. */
const importFacts = (e: any) => ({
  startPrecision: e?.startPrecision === 'YEAR' ? ('YEAR' as const) : null,
  endPrecision: e?.endPrecision === 'YEAR' ? ('YEAR' as const) : null,
  ...(Array.isArray(e?.uncertain) && e.uncertain.length ? { uncertain: e.uncertain as string[], source: typeof e?.source === 'string' ? e.source : undefined } : {}),
});

const UNCERTAIN_LABEL: Record<string, string> = { company: 'şirkət adı', startDate: 'başlama tarixi', endDate: 'bitmə tarixi', description: 'təsvir', detail: 'dərəcə və ixtisas' };

function ImportCheck({ uncertain, source }: { uncertain?: string[]; source?: string }) {
  if (!uncertain?.length) return null;
  return (
    <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
      <p>Yoxlayın: {uncertain.map((f) => UNCERTAIN_LABEL[f] ?? f).join(', ')} mənbədən aydın oxunmadı. Tarix yoxdursa, bildiyinizi yazın; təxmin yazmayın.</p>
      {source && (
        <details className="mt-1">
          <summary className="cursor-pointer">Mənbədəki mətn</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-sans">{source}</pre>
        </details>
      )}
    </div>
  );
}

interface WizardState {
  name: string;
  headline: string;
  /** The profile paragraph exactly as written, kept whole. */
  summary: string;
  location: string;
  skills: string[];
  roles: string[];
  prefLocations: string[];
  workTypes: string[];
  salaryMin: number | '';
  salaryMax: number | '';
  experiences: Experience[];
  education: Education[];
  evidence: CareerEvidenceState;
}

const EMPTY_STATE: WizardState = {
  name: '',
  headline: '',
  summary: '',
  location: '',
  skills: [],
  roles: [],
  prefLocations: [],
  workTypes: [],
  salaryMin: '',
  salaryMax: '',
  experiences: [],
  education: [],
  evidence: EMPTY_CAREER_EVIDENCE,
};

const DRAFT_KEY_PREFIX = 'aise-onboarding-draft-v2';

// A fixed key here previously meant one user's in-progress draft (name,
// phone-adjacent fields, work history) auto-restored into *any* account
// that next opened the onboarding wizard on the same browser/device — e.g.
// User A abandons onboarding on a shared computer, User B signs into their
// own account, and User B's form silently fills with User A's PII.
// Namespacing by user id confines a draft to the account that wrote it.
const draftKey = (userId: string) => `${DRAFT_KEY_PREFIX}:${userId}`;

const WORK_TYPES = [
  { value: 'remote', label: 'Uzaqdan' },
  { value: 'hybrid', label: 'Hibrid' },
  { value: 'onsite', label: 'Ofisdə' },
];

const FIELD_CLASS =
  'block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all';
const LABEL_CLASS = 'block text-xs font-semibold text-neutral-dark/85 mb-1';

/** ISO timestamp -> yyyy-MM-dd, which is what <input type="date"> requires. */
const toDateInput = (v?: string | null) => (v ? String(v).slice(0, 10) : '');

function TagInput({
  placeholder,
  values,
  onChange,
}: {
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };

  return (
    <div>
      <form onSubmit={add} className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={FIELD_CLASS}
          placeholder={placeholder}
        />
        <button
          type="submit"
          className="product-action rounded-full bg-accent text-white px-4 text-xs font-bold hover:bg-accent-hover shrink-0 transition-colors"
        >
          Əlavə et
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5 min-h-8">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 text-primary-hover px-2.5 py-1 text-xs font-medium"
          >
            {v}
            <button
              type="button"
              aria-label={`${v} sil`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-primary-hover hover:text-accent font-bold"
            >
              &times;
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Marks a value that came out of the CV, so a wrong one is easy to spot. */
function FromCv() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary-hover px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
      <Sparkles className="h-3 w-3" /> CV-dən
    </span>
  );
}

export default function OnboardingWizard() {
  const { data: session, update: updateSession } = useSession();

  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(EMPTY_STATE);
  const [extracted, setExtracted] = useState<string[]>([]);
  // What the CV reader could not keep because of its size limits (parsedContent.omitted): shown so the candidate can add it by hand.
  const [readLimits, setReadLimits] = useState<{ omitted: unknown } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  // A second import (LinkedIn text) is merged into the form; what it added, what it already had and what differs is shown here.
  const [importNotice, setImportNotice] = useState<{ addedExperience: number; duplicateExperience: number; addedEducation: number; addedSkills: number; conflicts: ExperienceConflict[] } | null>(null);
  const [linkedinText, setLinkedinText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<Record<string, unknown> | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [backendEntries, setBackendEntries] = useState<BackendCareerEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const set = useCallback(
    <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
      setState((s) => ({ ...s, [key]: value })),
    [],
  );

  // Restore a draft so a refresh mid-onboarding doesn't lose typed
  // corrections. Waits for the session to resolve first: without a userId
  // there's no safe per-account key to read from.
  useEffect(() => {
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) return;

    try {
      const raw = localStorage.getItem(draftKey(userId));
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft.state) setState((s) => ({ ...s, ...draft.state }));
        if (Array.isArray(draft.extracted)) setExtracted(draft.extracted);
        if (draft.step) setStep(draft.step);
        if (draft.uploadedName) setUploadedName(draft.uploadedName);
        if (typeof draft.resumeId === 'string') setResumeId(draft.resumeId);
      }
    } catch {
      // A corrupt draft must not block onboarding.
    } finally {
      setRestored(true);
    }
  }, [session]);

  useEffect(() => {
    // Gated on `restored`, and this is not just tidiness: the save effect runs
    // on the very first render too, while state is still EMPTY_STATE. Writing
    // then overwrites the stored draft with blanks — and because React
    // re-invokes effects on remount in development, the restore that follows
    // reads back the blanks it just wrote. The net effect for a user is that
    // refreshing mid-onboarding silently discards everything they corrected.
    if (!restored) return;
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) return;

    try {
      localStorage.setItem(
        draftKey(userId),
        JSON.stringify({ state, extracted, step, uploadedName, resumeId }),
      );
    } catch {
      // Private mode / full quota — drafting is a convenience, not a requirement.
    }
  }, [restored, state, extracted, step, uploadedName, resumeId, session]);

  /** Fills the form from a resume's parsedContent. With `merge`, an import is merged into what is already there (see lib/profile-merge.ts). */
  const applyParsed = useCallback(
    (parsed: Record<string, unknown> | null | undefined, options: { merge?: boolean } = {}) => {
      if (!parsed) return;
      if (options.merge) {
        const incoming = Array.isArray(parsed.workExperience) ? parsed.workExperience : [];
        const incomingEdu = Array.isArray(parsed.education) ? parsed.education : [];
        setState((s) => {
          const expIn = incoming.map((e: any) => ({ title: e?.title ?? '', company: e?.company ?? '', location: e?.location ?? '', startDate: toDateInput(e?.startDate), endDate: toDateInput(e?.endDate) || null, description: e?.description ?? '', ...importFacts(e) }));
          const eduIn = incomingEdu.map((e: any) => ({ institution: e?.institution ?? '', degree: e?.degree ?? '', fieldOfStudy: e?.fieldOfStudy ?? '', startDate: toDateInput(e?.startDate), endDate: toDateInput(e?.endDate) || null, ...importFacts(e) }));
          const exp = mergeExperiences(s.experiences as MergeExperience[], expIn);
          const edu = mergeEducation(s.education as MergeEducation[], eduIn);
          const skills = mergeSkills(s.skills, Array.isArray(parsed.skills) ? (parsed.skills as string[]) : []);
          const suggestions = Array.isArray(parsed.careerSuggestions) ? parsed.careerSuggestions : [];
          const importedEvidence = careerEntriesToEvidenceState(suggestions.map((entry: any) => ({
            ...entry, id: generateEvidenceId('import'), status: 'SUGGESTED', origin: 'EXTRACTED', datePrecision: entry.precision,
          })));
          const key = (item: any) => [item.name || item.title || item.language || item.role, item.organization || item.issuer].join('|').normalize('NFKC').toLowerCase();
          const mergeEvidence = <T,>(current: T[], incoming: T[]): T[] => {
            const seen = new Set(current.map(key));
            return [...current, ...incoming.filter((item) => { const k = key(item); if (seen.has(k)) return false; seen.add(k); return true; })];
          };
          setImportNotice({ addedExperience: exp.added, duplicateExperience: exp.duplicates, addedEducation: edu.added, addedSkills: skills.added.length, conflicts: exp.conflicts });
          return {
            ...s,
            name: s.name || (parsed.personalInfo as Record<string, string> | undefined)?.name || session?.user?.name || '',
            headline: s.headline || (parsed.headline as string) || '',
            summary: s.summary || (parsed.summary as string) || '',
            location: s.location || (parsed.location as string) || '',
            skills: skills.merged,
            experiences: exp.merged as Experience[],
            education: edu.merged as Education[],
            evidence: {
              ...s.evidence,
              projects: mergeEvidence(s.evidence.projects, importedEvidence.projects),
              volunteering: mergeEvidence(s.evidence.volunteering, importedEvidence.volunteering),
              certifications: mergeEvidence(s.evidence.certifications, importedEvidence.certifications),
              languages: mergeEvidence(s.evidence.languages, importedEvidence.languages),
              awards: mergeEvidence(s.evidence.awards, importedEvidence.awards),
            },
          };
        });
        return;
      }
      setReadLimits(parsed.omitted ? { omitted: parsed.omitted } : null);

      const personal = (parsed.personalInfo ?? {}) as Record<string, string>;
      const experiences = Array.isArray(parsed.workExperience) ? parsed.workExperience : [];
      const education = Array.isArray(parsed.education) ? parsed.education : [];
      const evidence = normalizeExtractedEvidence(parsed.evidence || parsed);

      setState((s) => ({
        ...s,
        name: personal.name || s.name || session?.user?.name || '',
        headline: (parsed.headline as string) || s.headline,
        summary: (parsed.summary as string) || s.summary,
        location: (parsed.location as string) || s.location,
        skills: Array.isArray(parsed.skills) && parsed.skills.length
          ? (parsed.skills as string[])
          : s.skills,
        experiences: experiences.length
          ? experiences.map((e: any) => ({
              title: e?.title ?? '',
              company: e?.company ?? '',
              location: e?.location ?? '',
              startDate: toDateInput(e?.startDate),
              endDate: toDateInput(e?.endDate) || null,
              description: e?.description ?? '',
              ...importFacts(e),
            }))
          : s.experiences,
        education: education.length
          ? education.map((e: any) => ({
              institution: e?.institution ?? '',
              degree: e?.degree ?? '',
              fieldOfStudy: e?.fieldOfStudy ?? '',
              startDate: toDateInput(e?.startDate),
              endDate: toDateInput(e?.endDate) || null,
              ...importFacts(e),
            }))
          : s.education,
        evidence: {
          projects: evidence.projects.length ? evidence.projects : s.evidence.projects,
          volunteering: evidence.volunteering.length ? evidence.volunteering : s.evidence.volunteering,
          certifications: evidence.certifications.length ? evidence.certifications : s.evidence.certifications,
          languages: evidence.languages.length ? evidence.languages : s.evidence.languages,
          awards: evidence.awards.length ? evidence.awards : s.evidence.awards,
        },
      }));

      setExtracted(Array.isArray(parsed.extracted) ? (parsed.extracted as string[]) : []);
    },
    [session?.user?.name],
  );

  const hydratedFromApi = useRef(false);
  useEffect(() => {
    if (!restored || hydratedFromApi.current) return;
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) return;

    let cancelled = false;
    (async () => {
      const [resumesRes, profileRes, careerEntriesRes] = await Promise.all([
        apiFetch('/resumes'),
        apiFetch('/profile'),
        apiFetch('/profile/career-entries'),
      ]);
      if (cancelled) return;
      hydratedFromApi.current = true;

      const resumes = resumesRes.ok ? await resumesRes.json() : [];
      const base = Array.isArray(resumes) ? resumes.find((r: { isBase?: boolean }) => r.isBase) : null;
      const profile = profileRes.ok ? await profileRes.json() : null;
      const careerEntriesData = careerEntriesRes.ok ? await careerEntriesRes.json() : null;
      const rawEntries = (careerEntriesData?.entries || []) as BackendCareerEntry[];
      setBackendEntries(rawEntries);

      if (base?.id) setResumeId(base.id);
      if (base) setUploadedName((name) => name || 'Yüklənmiş CV');

      const profileHasCorrections =
        Boolean(profile?.headline) ||
        (Array.isArray(profile?.skills) && profile.skills.length > 0) ||
        (Array.isArray(profile?.experiences) && profile.experiences.length > 0);

      if (profileHasCorrections) {
        const evidence = rawEntries.length > 0
          ? careerEntriesToEvidenceState(rawEntries)
          : normalizeExtractedEvidence(profile?.evidence || base?.parsedContent);
        setState((s) => ({
          ...s,
          name: profile.name || s.name,
          headline: profile.headline || s.headline,
          summary: profile.summary || s.summary,
          location: profile.location || s.location,
          skills: Array.isArray(profile.skills) && profile.skills.length ? profile.skills : s.skills,
          experiences:
            Array.isArray(profile.experiences) && profile.experiences.length
              ? profile.experiences.map((e: Experience) => ({
                  title: e.title ?? '',
                  company: e.company ?? '',
                  location: e.location ?? '',
                  startDate: toDateInput(e.startDate),
                  endDate: toDateInput(e.endDate) || null,
                  startPrecision: e.startPrecision ?? null,
                  endPrecision: e.endPrecision ?? null,
                  description: e.description ?? '',
                }))
              : s.experiences,
          education:
            Array.isArray(profile.education) && profile.education.length
              ? profile.education.map((e: Education) => ({
                  institution: e.institution ?? '',
                  degree: e.degree ?? '',
                  fieldOfStudy: e.fieldOfStudy ?? '',
                  startDate: toDateInput(e.startDate),
                  endDate: toDateInput(e.endDate) || null,
                  startPrecision: e.startPrecision ?? null,
                  endPrecision: e.endPrecision ?? null,
                }))
              : s.education,
          evidence: {
            projects: evidence.projects.length ? evidence.projects : s.evidence.projects,
            volunteering: evidence.volunteering.length ? evidence.volunteering : s.evidence.volunteering,
            certifications: evidence.certifications.length ? evidence.certifications : s.evidence.certifications,
            languages: evidence.languages.length ? evidence.languages : s.evidence.languages,
            awards: evidence.awards.length ? evidence.awards : s.evidence.awards,
          },
        }));
      } else if (rawEntries.length > 0) {
        setState((s) => ({
          ...s,
          evidence: careerEntriesToEvidenceState(rawEntries),
        }));
      } else if (base?.parsedContent) {
        applyParsed(base.parsedContent);
      }

      if (base) setStep((current) => (current === 0 ? 1 : current));
    })().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [restored, session, applyParsed]);

  const importLinkedIn = async (allowPublicReader = false) => {
    if (importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await apiFetch('/resumes/import-text', { method: 'POST', body: JSON.stringify({ text: linkedinText, allowPublicReader }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((Array.isArray(body?.message) ? body.message.join('. ') : body?.message) || 'Mətn oxunmadı.');
      setPendingImport(body.parsedContent as Record<string, unknown>);
      setLinkedinText('');
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Mətn oxunmadı.');
    } finally {
      setImporting(false);
    }
  };

  /** A LinkedIn PDF is read for review only: it does not replace the stored CV file. */
  const importLinkedInFile = async (file: File) => {
    if (importing) return;
    if (file.type && file.type !== 'application/pdf') { setImportError('LinkedIn-dən saxladığınız PDF faylını seçin.'); return; }
    if (file.size > 10 * 1024 * 1024) { setImportError('Fayl 10 MB-dan böyükdür.'); return; }
    setImporting(true);
    setImportError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch('/resumes/import-file', { method: 'POST', body: form, headers: {} });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((Array.isArray(body?.message) ? body.message.join('. ') : body?.message) || 'PDF oxunmadı.');
      setPendingImport(body.parsedContent as Record<string, unknown>);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'PDF oxunmadı.');
    } finally {
      setImporting(false);
    }
  };

  const applyPendingImport = () => {
    if (!pendingImport) return;
    applyParsed(pendingImport, { merge: true });
    setPendingImport(null);
    setStep(1);
  };

  const importPreview = pendingImport ? (
    <ImportPreview
      parsed={pendingImport}
      existing={{ experiences: state.experiences as MergeExperience[], education: state.education as MergeEducation[], skills: state.skills, name: state.name, headline: state.headline }}
      onApply={applyPendingImport}
      onCancel={() => setPendingImport(null)}
    />
  ) : null;

  const handleUpload = async (file: File) => {
    if (uploading) return;
    const fileError = resumeFileError(file);
    if (fileError) {
      setError(fileError);
      return;
    }

    setUploading(true);
    setError(null);
    setNotice(null);

    try {
      const form = new FormData();
      form.append('file', file);

      const res = await apiFetch('/resumes', {
        method: 'POST',
        body: form,
        headers: {}, // let the browser set the multipart boundary
      });

      if (res.status === 403) {
        // The API allows one base CV below the Limitsiz plan. Re-entering
        // onboarding after an earlier upload is a normal way to hit this, so
        // reuse what was already parsed instead of dead-ending.
        const existing = await apiFetch('/resumes');
        if (existing.ok) {
          const list = await existing.json();
          const base = Array.isArray(list) ? list.find((r: any) => r.isBase) : null;
          if (base) {
            const existingProfileRes = await apiFetch('/profile');
            const existingProfile = existingProfileRes.ok ? await existingProfileRes.json() : null;
            const hasSaved =
              Boolean(existingProfile?.headline) ||
              (Array.isArray(existingProfile?.skills) && existingProfile.skills.length > 0);
            if (!hasSaved) applyParsed(base.parsedContent);
            setResumeId(base.id);
            setUploadedName('Əvvəl yüklənmiş CV');
            setNotice('Əvvəl yüklədiyiniz CV-dən istifadə edildi.');
            setStep(1);
            return;
          }
        }
        throw new Error('Hesabınızda artıq əsas CV var.');
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          (Array.isArray(body?.message) ? body.message.join('. ') : body?.message) ||
            'CV yüklənmədi. Zəhmət olmasa yenidən cəhd edin.',
        );
      }

      const resume = await res.json();
      applyParsed(resume.parsedContent);
      setResumeId(resume.id);
      setUploadedName(file.name);

      try {
        const ceRes = await apiFetch('/profile/career-entries');
        if (ceRes.ok) {
          const ceData = await ceRes.json();
          const rawEntries = (ceData.entries || []) as BackendCareerEntry[];
          setBackendEntries(rawEntries);
          if (rawEntries.length > 0) {
            setState((s) => ({
              ...s,
              evidence: careerEntriesToEvidenceState(rawEntries),
            }));
          }
        }
      } catch {
        // non-fatal fallback
      }

      const found = Array.isArray(resume.parsedContent?.extracted)
        ? resume.parsedContent.extracted
        : [];
      if (found.length === 0) {
        // Most often a scanned PDF: the file is stored, but there is no text
        // layer to read, so say so plainly rather than showing a blank form.
        setNotice(
          'CV-dən mətn oxunmadı — sənəd skan edilmiş ola bilər. Məlumatları aşağıda özünüz doldura bilərsiniz.',
        );
      }
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CV yüklənmədi.');
    } finally {
      setUploading(false);
    }
  };

  const addExperience = () =>
    set('experiences', [
      ...state.experiences,
      { title: '', company: '', location: '', startDate: '', endDate: null, description: '' },
    ]);

  const updateExperience = (i: number, patch: Partial<Experience>) =>
    set('experiences', state.experiences.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  const addEducation = () =>
    set('education', [
      ...state.education,
      { institution: '', degree: '', fieldOfStudy: '', startDate: '', endDate: null },
    ]);

  const updateEducation = (i: number, patch: Partial<Education>) =>
    set('education', state.education.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  const handleFinish = async () => {
    if (!state.name.trim()) {
      setError('Ad və soyadınızı yazın.');
      return;
    }
    if (state.skills.length === 0) {
      setError('Uyğun işləri tapmaq üçün ən azı bir bacarıq lazımdır.');
      return;
    }
    // A role without a start date must not receive today's date: the candidate states it (the year alone is enough), or removes the row.
    // Education may stay undated (a course, a school whose dates the CV does not give).
    const undated = state.experiences.filter((e) => (e.title.trim() || e.company.trim()) && !e.startDate).map((e) => e.title || e.company);
    if (undated.length) {
      setError(`İş təcrübəsinin başlama tarixi yazılmayıb: ${undated.slice(0, 3).join('; ')}. Bildiyiniz tarixi yazın (yalnız il də olar) və ya həmin sətri silin; tarix təxmini yazılmır.`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        name: state.name.trim(),
        headline: state.headline,
        summary: state.summary,
        location: state.location,
        skills: state.skills,
        jobPreferences: {
          roles: state.roles,
          locations: state.prefLocations,
          types: state.workTypes,
          salaryMin: state.salaryMin === '' ? undefined : state.salaryMin,
          salaryMax: state.salaryMax === '' ? undefined : state.salaryMax,
        },
        experiences: state.experiences
          // Drop rows the user left blank rather than saving empty records.
          .filter((e) => e.title.trim() || e.company.trim())
          .map((e) => ({
            title: e.title,
            company: e.company,
            location: e.location?.trim() || null,
            // A date is never made up: rows without one are stopped before saving (see handleFinish).
            startDate: new Date(e.startDate).toISOString(),
            endDate: e.endDate ? new Date(e.endDate).toISOString() : null,
            startPrecision: e.startPrecision ?? null,
            endPrecision: e.endDate ? e.endPrecision ?? null : null,
            description: e.description,
          })),
        education: state.education
          .filter((e) => e.institution.trim() || e.degree.trim())
          .map((e) => ({
            institution: e.institution,
            degree: e.degree,
            fieldOfStudy: e.fieldOfStudy,
            location: e.location?.trim() || null,
            startDate: e.startDate ? new Date(e.startDate).toISOString() : null,
            endDate: e.endDate ? new Date(e.endDate).toISOString() : null,
            startPrecision: e.startDate ? e.startPrecision ?? null : null,
            endPrecision: e.endDate ? e.endPrecision ?? null : null,
          })),
      };

      const saveRes = await apiFetch('/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      if (!saveRes.ok) {
        const errData = await saveRes.json().catch(() => ({}));
        throw new Error(errData.message || 'Profil yadda saxlanılmadı');
      }

      // Persist career evidence entries to /profile/career-entries
      await syncCareerEntriesToBackend(state.evidence, backendEntries, apiFetch);

      if (resumeId) {
        await apiFetch(`/resumes/${resumeId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            parsedContent: {
              personalInfo: { name: payload.name, email: session?.user?.email || '', phone: '' },
              headline: payload.headline,
              location: payload.location,
              skills: payload.skills,
              workExperience: payload.experiences,
              education: payload.education,
              projects: state.evidence.projects,
              volunteering: state.evidence.volunteering,
              certifications: state.evidence.certifications,
              languages: state.evidence.languages,
              awards: state.evidence.awards,
              evidence: state.evidence,
              extracted,
            },
          }),
        });
      }

      const completeRes = await apiFetch('/profile/complete-onboarding', { method: 'POST' });
      if (!completeRes.ok) throw new Error('Qeydiyyat tamamlanmadı');

      // Refresh the JWT's name before navigating away — dashboard/layout.tsx
      // reads the session server-side on the very next request, and without
      // this the sidebar badge would show the pre-onboarding (empty) name
      // until a later edit or re-login. See the jwt callback in
      // app/api/auth/[...nextauth]/route.ts.
      await updateSession({ name: state.name.trim() });

      try {
        const userId = (session?.user as any)?.id as string | undefined;
        if (userId) localStorage.removeItem(draftKey(userId));
      } catch {
        // non-fatal
      }

      // Not router.push: the sidebar's "Ümumi baxış" link is on screen for
      // this entire wizard and Next prefetches it as soon as it renders —
      // while onboarding is still incomplete, so that prefetch caches the
      // proxy's redirect *back* to this page. router.push('/dashboard')
      // then silently replays that stale cached redirect from the client
      // Router Cache instead of asking the server again: the API calls
      // above succeed, but nothing happens on screen. A full navigation
      // bypasses that cache and re-runs proxy.ts against current DB state.
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xəta baş verdi, yenidən cəhd edin.');
      setSubmitting(false);
    }
  };

  const STEP_LABELS = ['CV yüklə', 'Məlumatları yoxla', 'Tərcihlər'];

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      {/* Visual Step Indicators */}
      <nav aria-label="Qeydiyyat addımları" className="mb-8">
        <ol className="flex items-center gap-3">
          {STEP_LABELS.map((label, i) => (
            <li key={label} className="flex-1" aria-current={i === step ? 'step' : undefined}>
              <div
                className={`h-2 rounded-full transition-all duration-300 ${
                  i < step ? 'bg-primary' : i === step ? 'bg-primary shadow-xs' : 'bg-neutral-dark/15'
                }`}
              />
              <p
                className={`mt-2 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                  i === step ? 'text-primary font-bold' : i < step ? 'text-neutral-dark' : 'text-neutral-dark/40'
                }`}
              >
                <span
                  className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${
                    i < step
                      ? 'bg-primary text-white'
                      : i === step
                        ? 'border border-primary text-primary'
                        : 'bg-neutral-dark/10 text-neutral-dark/50'
                  }`}
                >
                  {i < step ? '✓' : i + 1}
                </span>
                <span>{label}</span>
              </p>
            </li>
          ))}
        </ol>
      </nav>

      {error && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-2 rounded-xl bg-red-50 border border-red-100 p-4 text-sm text-red-700"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="mb-6 product-action rounded-full bg-accent/5 border border-accent/20 p-4 text-sm text-neutral-dark">
          {notice}
        </div>
      )}

      {/* ------------------------------------------------------ Step 1: upload */}
      {step === 0 && (
        <div className="space-y-6">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary mb-2">
              <Sparkles className="h-3.5 w-3.5" /> Avtomatik CV oxunması
            </div>
            <h1 className="font-serif text-2xl sm:text-3xl font-bold text-neutral-dark">
              CV-nizi yükləyin
            </h1>
            <p className="text-sm text-neutral-dark/70 mt-1">
              AISE faylı oxuyub profilinizi formalaşdıracaq. Növbəti addımda oxunan məlumatları asanlıqla yoxlayıb düzəldə bilərsiniz.
            </p>
          </div>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-8 sm:p-10 text-center hover:bg-primary/10 transition-colors disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
          >
            {uploading ? (
              <>
                <Sparkles className="h-10 w-10 mx-auto text-primary animate-pulse" />
                <p className="mt-3 font-semibold text-neutral-dark">
                  CV oxunur...
                </p>
              </>
            ) : (
              <>
                <UploadCloud className="h-10 w-10 mx-auto text-primary" />
                <p className="mt-3 font-semibold text-neutral-dark">
                  Faylı seçin
                </p>
                <p className="mt-1 text-xs text-neutral-dark/60">
                  {RESUME_ACCEPT_HINT}
                </p>
              </>
            )}
          </button>

          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset so picking the same file twice still fires onChange.
              e.target.value = '';
              if (file) handleUpload(file);
            }}
          />

          <LinkedInImportPanel text={linkedinText} onTextChange={setLinkedinText} onImport={importLinkedIn}
            onFile={importLinkedInFile} busy={uploading || importing} error={importError} />
          {importPreview}

          <button
            type="button"
            onClick={() => {
              setState((s) => ({ ...s, name: s.name || session?.user?.name || '' }));
              setStep(1);
            }}
            className="mt-6 w-full text-sm text-neutral-dark/70 underline underline-offset-2 hover:text-accent transition-colors"
          >
            CV-m yoxdur — məlumatları özüm dolduracağam
          </button>
        </div>
      )}

      {/* ------------------------------------------------------ Step 2: review */}
      {step === 1 && (
        <div className="space-y-8">
          <div>
            <h1 className="font-serif text-3xl font-bold text-neutral-dark mb-2">
              Məlumatlarınızı yoxlayın
            </h1>
            <p className="text-sm text-neutral-dark/70">
              {uploadedName
                ? 'CV-dən oxunanları aşağıda göstərmişik. Səhv olanları düzəldin, lazımsızları silin.'
                : 'Məlumatlarınızı doldurun.'}
            </p>
            {uploadedName && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-xl bg-background border border-neutral-dark/10 px-3 py-2 text-xs text-neutral-dark/75">
                <FileText className="h-3.5 w-3.5" /> {uploadedName}
              </p>
            )}
            {readLimits && <div className="mt-3"><ExtractionNotice parsed={readLimits} /></div>}

            <LinkedInImportPanel text={linkedinText} onTextChange={setLinkedinText} onImport={importLinkedIn}
              onFile={importLinkedInFile} busy={uploading || importing} error={importError} />
            {importPreview}

            {importNotice && (
              <div role="status" className="mt-4 rounded-xl border border-neutral-dark/10 bg-background-warm/20 p-4 text-sm space-y-2" data-testid="import-notice">
                <p className="font-semibold">Mətn birləşdirildi</p>
                <ul className="list-disc pl-5 text-xs space-y-1">
                  <li>{importNotice.addedExperience} yeni təcrübə, {importNotice.addedEducation} yeni təhsil və {importNotice.addedSkills} yeni bacarıq əlavə olundu.</li>
                  <li>{importNotice.duplicateExperience} təcrübə artıq mövcud idi və təkrar yazılmadı.</li>
                </ul>
                {importNotice.conflicts.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold">Fərqlər (sizin yazdığınız saxlanıldı):</p>
                    <ul className="mt-1 space-y-2">
                      {importNotice.conflicts.map((c, i) => (
                        <li key={i} className="rounded-lg border border-neutral-dark/10 p-2 text-xs">
                          <p className="font-medium">{c.existing.title} — {c.existing.company}: {c.fields.map((f) => (f === 'description' ? 'təsvir' : f === 'dates' ? 'tarixlər' : 'vəzifə adı')).join(', ')} fərqlənir</p>
                          <button type="button" className="mt-1 min-h-11 rounded-full border border-neutral-dark/20 px-3 py-1 text-xs font-semibold"
                            onClick={() => {
                              set('experiences', state.experiences.map((e, idx) => (idx === c.index ? { ...e, title: c.incoming.title || e.title, startDate: c.incoming.startDate || e.startDate, endDate: c.incoming.endDate, startPrecision: (c.incoming as Experience).startPrecision ?? e.startPrecision, endPrecision: (c.incoming as Experience).endPrecision ?? null, description: c.incoming.description || e.description } : e)));
                              setImportNotice((n) => (n ? { ...n, conflicts: n.conflicts.filter((_, j) => j !== i) } : n));
                            }}>
                            LinkedIn variantını götür
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button type="button" onClick={() => setImportNotice(null)} className="min-h-11 text-xs underline">Bağla</button>
              </div>
            )}
          </div>

          <section className="product-card rounded-2xl bg-background border border-neutral-dark/5 p-6 space-y-5">
            <div>
              <label htmlFor="ob-name" className={LABEL_CLASS}>
                Ad və soyad * {extracted.includes('name') && <FromCv />}
              </label>
              <input
                id="ob-name"
                className={FIELD_CLASS}
                value={state.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="ob-headline" className={LABEL_CLASS}>
                Peşəkar başlıq {extracted.includes('headline') && <FromCv />}
              </label>
              <input
                id="ob-headline"
                className={FIELD_CLASS}
                placeholder="məs. Frontend Developer"
                value={state.headline}
                onChange={(e) => set('headline', e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="ob-summary" className={LABEL_CLASS}>
                Qısa məlumat (profil abzası) {extracted.includes('headline') && <FromCv />}
              </label>
              <textarea
                id="ob-summary"
                className={FIELD_CLASS}
                rows={4}
                placeholder="CV-nizdəki “Profil” abzası olduğu kimi saxlanır"
                value={state.summary}
                onChange={(e) => set('summary', e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="ob-location" className={LABEL_CLASS}>
                Yerləşdiyiniz şəhər {extracted.includes('location') && <FromCv />}
              </label>
              <input
                id="ob-location"
                className={FIELD_CLASS}
                placeholder="məs. Bakı"
                value={state.location}
                onChange={(e) => set('location', e.target.value)}
              />
            </div>

            <div>
              <p className={LABEL_CLASS}>
                Bacarıqlar * {extracted.includes('skills') && <FromCv />}
              </p>
              <TagInput
                placeholder="məs. TypeScript"
                values={state.skills}
                onChange={(v) => set('skills', v)}
              />
            </div>
          </section>

          {/* Experience */}
          <section className="product-card rounded-2xl bg-background border border-neutral-dark/5 p-6">
            <div className="flex items-center justify-between border-b border-neutral-dark/5 pb-4 mb-4">
              <h2 className="font-serif text-xl font-bold text-neutral-dark flex items-center gap-2">
                İş təcrübəsi {extracted.includes('workExperience') && <FromCv />}
              </h2>
              <button
                type="button"
                onClick={addExperience}
                className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-dark/20 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-dark/5 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Əlavə et
              </button>
            </div>

            <div className="mb-4"><ExperienceWritingGuide /></div>

            {state.experiences.length === 0 && (
              <p className="text-sm text-neutral-dark/60 py-2">
                Heç bir iş təcrübəsi yoxdur. Kurs işlərinizi və layihələrinizi aşağıdakı “Karyera sübutları” bölməsində əlavə edə bilərsiniz.
              </p>
            )}

            <div className="space-y-4">
              {state.experiences.map((exp, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-neutral-dark/10 bg-background-warm/10 p-4 space-y-3"
                >
                  <div className="flex justify-between gap-3">
                    <input
                      className={FIELD_CLASS}
                      placeholder="Vəzifə"
                      aria-label={`${i + 1}. təcrübə — vəzifə`}
                      value={exp.title}
                      onChange={(e) => updateExperience(i, { title: e.target.value })}
                    />
                    <button
                      type="button"
                      aria-label={`${i + 1}. təcrübəni sil`}
                      onClick={() =>
                        set('experiences', state.experiences.filter((_, idx) => idx !== i))
                      }
                      className="shrink-0 p-2 text-neutral-dark/50 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <input
                    className={FIELD_CLASS}
                    placeholder="Şirkət"
                    aria-label={`${i + 1}. təcrübə — şirkət`}
                    value={exp.company}
                    onChange={(e) => updateExperience(i, { company: e.target.value })}
                  />
                  <input
                    className={FIELD_CLASS}
                    placeholder="Yer (məs. Remote, Bakı) — CV-də yazılıbsa"
                    aria-label={`${i + 1}. təcrübə — yer`}
                    value={exp.location ?? ''}
                    onChange={(e) => updateExperience(i, { location: e.target.value })}
                  />
                  <ImportCheck uncertain={exp.uncertain} source={exp.source} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <PeriodInput label="Başlama *" className={FIELD_CLASS} value={exp.startDate} precision={exp.startPrecision}
                      onChange={(v, p) => updateExperience(i, { startDate: v, startPrecision: p === 'YEAR' ? 'YEAR' : null })} />
                    <PeriodInput label="Bitmə (boş = davam edir)" className={FIELD_CLASS} value={exp.endDate ?? ''} precision={exp.endPrecision}
                      onChange={(v, p) => updateExperience(i, { endDate: v || null, endPrecision: p === 'YEAR' ? 'YEAR' : null })} />
                  </div>
                  <textarea
                    className={FIELD_CLASS}
                    rows={Math.min(10, Math.max(3, exp.description.split('\n').length + 1))}
                    placeholder="Hər sətir bir bənd (CV-dəki kimi)"
                    aria-label={`${i + 1}. təcrübə — təsvir`}
                    value={exp.description}
                    onChange={(e) => updateExperience(i, { description: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Education */}
          <section className="product-card rounded-2xl bg-background border border-neutral-dark/5 p-6">
            <div className="flex items-center justify-between border-b border-neutral-dark/5 pb-4 mb-4">
              <h2 className="font-serif text-xl font-bold text-neutral-dark flex items-center gap-2">
                Təhsil {extracted.includes('education') && <FromCv />}
              </h2>
              <button
                type="button"
                onClick={addEducation}
                className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-dark/20 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-dark/5 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Əlavə et
              </button>
            </div>

            {state.education.length === 0 && (
              <p className="text-sm text-neutral-dark/60 py-2">Təhsil məlumatı yoxdur.</p>
            )}

            <div className="space-y-4">
              {state.education.map((ed, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-neutral-dark/10 bg-background-warm/10 p-4 space-y-3"
                >
                  <div className="flex justify-between gap-3">
                    <input
                      className={FIELD_CLASS}
                      placeholder="Təhsil müəssisəsi"
                      aria-label={`${i + 1}. təhsil — müəssisə`}
                      value={ed.institution}
                      onChange={(e) => updateEducation(i, { institution: e.target.value })}
                    />
                    <button
                      type="button"
                      aria-label={`${i + 1}. təhsili sil`}
                      onClick={() =>
                        set('education', state.education.filter((_, idx) => idx !== i))
                      }
                      className="shrink-0 p-2 text-neutral-dark/50 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      className={FIELD_CLASS}
                      placeholder="Dərəcə (məs. Bakalavr)"
                      aria-label={`${i + 1}. təhsil — dərəcə`}
                      value={ed.degree}
                      onChange={(e) => updateEducation(i, { degree: e.target.value })}
                    />
                    <input
                      className={FIELD_CLASS}
                      placeholder="İxtisas"
                      aria-label={`${i + 1}. təhsil — ixtisas`}
                      value={ed.fieldOfStudy}
                      onChange={(e) => updateEducation(i, { fieldOfStudy: e.target.value })}
                    />
                  </div>
                  <ImportCheck uncertain={ed.uncertain} source={ed.source} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <PeriodInput label="Başlama" className={FIELD_CLASS} value={ed.startDate} precision={ed.startPrecision}
                      onChange={(v, p) => updateEducation(i, { startDate: v, startPrecision: p === 'YEAR' ? 'YEAR' : null })} />
                    <PeriodInput label="Bitmə" className={FIELD_CLASS} value={ed.endDate ?? ''} precision={ed.endPrecision}
                      onChange={(v, p) => updateEducation(i, { endDate: v || null, endPrecision: p === 'YEAR' ? 'YEAR' : null })} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Career Evidence: Projects, Volunteering, Certifications, Languages, Awards */}
          <CareerEvidenceEditor
            evidence={state.evidence}
            onChange={(ev) => set('evidence', ev)}
            disabled={submitting}
          />
        </div>
      )}

      {/* -------------------------------------------------- Step 3: preferences */}
      {step === 2 && (
        <div className="space-y-6">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-dark/10 px-3 py-1 text-xs font-semibold text-neutral-dark/75 mb-2">
              İstəyə bağlı addım
            </span>
            <h1 className="font-serif text-2xl sm:text-3xl font-bold text-neutral-dark">
              İş axtarışı tərcihləriniz
            </h1>
            <p className="text-sm text-neutral-dark/70 mt-1">
              Bu məlumatlar uyğun vakansiyaların tapılmasını dəqiqləşdirir. Boş buraxsanız da davam edə bilərsiniz.
            </p>
          </div>

          <section className="product-card rounded-2xl bg-background border border-neutral-dark/5 p-6 space-y-6">
            <div>
              <p className={LABEL_CLASS}>Hədəflədiyiniz vəzifələr</p>
              <TagInput
                placeholder="məs. Full Stack Developer"
                values={state.roles}
                onChange={(v) => set('roles', v)}
              />
            </div>

            <div>
              <p className={LABEL_CLASS}>İşləmək istədiyiniz yerlər</p>
              <TagInput
                placeholder="məs. Bakı"
                values={state.prefLocations}
                onChange={(v) => set('prefLocations', v)}
              />
            </div>

            <div>
              <p className={LABEL_CLASS}>İş rejimi</p>
              <div className="flex flex-wrap gap-2">
                {WORK_TYPES.map((t) => {
                  const active = state.workTypes.includes(t.value);
                  return (
                    <button
                      key={t.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        set(
                          'workTypes',
                          active
                            ? state.workTypes.filter((x) => x !== t.value)
                            : [...state.workTypes, t.value],
                        )
                      }
                      className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'border-primary bg-primary/10 text-primary-hover'
                          : 'border-neutral-dark/20 text-neutral-dark/75 hover:bg-neutral-dark/5'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Monthly AZN. The old wizard asked for an annual USD figure,
                which does not match this market, the vacancy form's salary
                fields, or the manat pricing shown everywhere else. */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="ob-smin" className={LABEL_CLASS}>
                  Aylıq maaş — minimum (₼)
                </label>
                <input
                  id="ob-smin"
                  type="number"
                  min={0}
                  className={FIELD_CLASS}
                  value={state.salaryMin}
                  onKeyDown={blockNegativeAndExponentKeys}
                  onChange={(e) => set('salaryMin', parseNonNegativeNumber(e.target.value))}
                />
              </div>
              <div>
                <label htmlFor="ob-smax" className={LABEL_CLASS}>
                  Aylıq maaş — maksimum (₼)
                </label>
                <input
                  id="ob-smax"
                  type="number"
                  min={0}
                  className={FIELD_CLASS}
                  value={state.salaryMax}
                  onKeyDown={blockNegativeAndExponentKeys}
                  onChange={(e) => set('salaryMax', parseNonNegativeNumber(e.target.value))}
                />
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Navigation */}
      <div className="mt-10 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting}
          className="inline-flex items-center gap-2 rounded-xl border border-neutral-dark/20 px-5 py-2.5 text-sm font-semibold text-neutral-dark disabled:opacity-40 hover:bg-neutral-dark/5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Geri
        </button>

        {step < 2 ? (
          <div className="flex flex-col items-end gap-1">
          {step === 0 && !uploadedName && (
            <p id="onboarding-missing" className="text-xs text-neutral-dark/70">Davam etmək üçün CV-nizi yükləyin.</p>
          )}
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(2, s + 1))}
            aria-describedby={step === 0 && !uploadedName ? 'onboarding-missing' : undefined}
            disabled={step === 0 && !uploadedName}
            className="inline-flex items-center gap-2 product-action rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
          >
            Davam et <ArrowRight className="h-4 w-4" />
          </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleFinish}
            disabled={submitting}
            className="inline-flex items-center gap-2 product-action rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Yadda saxlanılır...' : 'Tamamla'} <Check className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
