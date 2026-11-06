'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { apiFetch } from '@/lib/api';
import { useAuthedFileUrl } from '@/hooks/use-authed-file-url';
import { blockNegativeAndExponentKeys, parseNonNegativeNumber } from '@/lib/number-input';
import { Plus, Trash2, Save, Sparkles, MapPin, Briefcase, GraduationCap, ShieldCheck, Upload, ArrowRight } from 'lucide-react';
import OnboardingWizard from './OnboardingWizard';
import Link from 'next/link';
import { CheckoutReturn } from '@/components/billing/checkout-return';
import { CareerEvidenceEditor } from '@/components/profile/career-evidence-editor';
import {
  CareerEvidenceState,
  EMPTY_CAREER_EVIDENCE,
  normalizeExtractedEvidence,
  careerEntriesToEvidenceState,
  syncCareerEntriesToBackend,
  BackendCareerEntry,
} from '@/lib/career-evidence';

import { PeriodInput, type DatePrecision } from '@/components/profile/period-input';
import { ExperienceWritingGuide } from '@/components/profile/writing-guide';

interface Experience {
  id?: string;
  title: string;
  company: string;
  /** Only what the role states; kept when the profile is saved (this page does not edit it, the onboarding review does). */
  location?: string | null;
  startDate: string;
  endDate: string | null;
  startPrecision?: DatePrecision | null;
  endPrecision?: DatePrecision | null;
  description: string;
}

interface Education {
  id?: string;
  institution: string;
  degree: string;
  fieldOfStudy: string;
  location?: string | null;
  /** Empty when the record states no dates. */
  startDate: string;
  endDate: string | null;
  startPrecision?: DatePrecision | null;
  endPrecision?: DatePrecision | null;
}

const GATED_LABELS: Record<string, string> = {
  '/dashboard/matches': 'Uyğunluqlar',
  '/dashboard/jobs': 'Bütün vakansiyalar',
  '/dashboard/saved': 'Saxlanılanlar',
  '/dashboard/companies': 'Şirkətlər',
  '/dashboard/resumes': 'CV-lər',
  '/dashboard/applications': 'Müraciətlərim',
  '/dashboard/agent': 'Brauzer köməkçisi',
  '/dashboard/volunteering': 'Könüllülük',
};

/** After the onboarding gate redirected here, says which page was asked for and what is open meanwhile, instead of a silent bounce. */
function GatedPageNotice({ from }: { from: string | null }) {
  if (!from || !from.startsWith('/dashboard/')) return null;
  const key = Object.keys(GATED_LABELS).find((p) => from === p || from.startsWith(`${p}/`));
  const label = key ? `«${GATED_LABELS[key]}» bölməsi` : 'Bu bölmə';
  return (
    <div role="status" className="rounded-2xl border border-outline-variant bg-surface-container px-4 py-3 text-sm text-neutral-dark">
      <p>{label} profilin hazır olandan sonra açılır: uyğun vakansiyalar və sənədlər profilindəki məlumatlara əsaslanır.</p>
      <p className="mt-1 text-on-surface-variant">
        Bu arada <Link href="/dashboard/applications/tracker" className="font-semibold text-primary underline underline-offset-4">müraciət cədvəli</Link> və{' '}
        <Link href="/dashboard/settings" className="font-semibold text-primary underline underline-offset-4">parametrlər</Link> açıqdır.
      </p>
    </div>
  );
}

function ProfileContent() {
  const searchParams = useSearchParams();
  const isOnboarding = searchParams.get('onboarding') === 'true';

  if (isOnboarding) {
    return (
      <div className="space-y-6">
        {/* Shown only when the payment page sent the candidate back; announces the plan from the verified backend state, never from the URL. */}
        <CheckoutReturn />
        <GatedPageNotice from={searchParams.get('from')} />
        <OnboardingWizard />
      </div>
    );
  }

  return <ProfileEditor />;
}

function ProfileEditor() {
  const { update: updateSession } = useSession();
  const searchParams = useSearchParams();
  const rawReturnTo = searchParams.get('returnTo');
  const safeReturnTo = (rawReturnTo && rawReturnTo.startsWith('/dashboard/') && !rawReturnTo.startsWith('/dashboard//') && !rawReturnTo.includes('//'))
    ? rawReturnTo
    : null;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [headline, setHeadline] = useState('');
  const [location, setLocation] = useState('');
  const [skills, setSkills] = useState('');
  
  // Preferences
  const [roles, setRoles] = useState<string[]>([]);
  const [newRole, setNewRole] = useState('');
  const [prefLocations, setPrefLocations] = useState<string[]>([]);
  const [newPrefLocation, setNewPrefLocation] = useState('');
  const [prefTypes, setPrefTypes] = useState<string[]>([]);
  const [salaryMin, setSalaryMin] = useState<number | ''>('');
  const [salaryMax, setSalaryMax] = useState<number | ''>('');

  // Automated external application fields
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [dob, setDob] = useState('');
  const [citizenship, setCitizenship] = useState('');
  const [salaryExpectation, setSalaryExpectation] = useState<number | ''>('');
  const [preferredNetGross, setPreferredNetGross] = useState<'Net' | 'Gross'>('Net');
  const [preferredCurrency, setPreferredCurrency] = useState<'AZN' | 'USD' | 'EUR'>('AZN');
  const [defaultCoverLetter, setDefaultCoverLetter] = useState('');
  const [idDocumentUrl, setIdDocumentUrl] = useState<string | null>(null);
  const [idDocUploading, setIdDocUploading] = useState(false);
  const [idDocError, setIdDocError] = useState<string | null>(null);

  // Lists
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [education, setEducation] = useState<Education[]>([]);
  const [evidence, setEvidence] = useState<CareerEvidenceState>(EMPTY_CAREER_EVIDENCE);
  const [backendEntries, setBackendEntries] = useState<BackendCareerEntry[]>([]);

  // State flags
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [matchingQueued, setMatchingQueued] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;
    const timeout = setTimeout(() => {
      const target = document.getElementById(hash);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const focusable = target.querySelector<HTMLElement>('input, textarea, button, select') || target;
        focusable.focus?.();
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [loading]);

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await apiFetch('/profile');
        if (!res.ok) throw new Error('Profil yüklənə bilmədi');
        const data = await res.json();

        setName(data.name || '');
        setEmail(data.email || '');
        setHeadline(data.headline || '');
        setLocation(data.location || '');
        setSkills(data.skills ? data.skills.join(', ') : '');
        
        const prefs = data.jobPreferences || {};
        setRoles(prefs.roles || []);
        setPrefLocations(prefs.locations || []);
        setPrefTypes(prefs.types || []);
        setSalaryMin(prefs.salaryMin !== undefined ? prefs.salaryMin : '');
        setSalaryMax(prefs.salaryMax !== undefined ? prefs.salaryMax : '');

        setPhone(data.phone || '');
        setAddress(data.address || '');
        setDob(data.dob ? data.dob.substring(0, 10) : '');
        setCitizenship(data.citizenship || '');
        setSalaryExpectation(data.salaryExpectation !== undefined && data.salaryExpectation !== null ? data.salaryExpectation : '');
        setPreferredNetGross(data.preferredNetGross || 'Net');
        setPreferredCurrency(data.preferredCurrency || 'AZN');
        setDefaultCoverLetter(data.defaultCoverLetter || '');
        setIdDocumentUrl(data.idDocumentUrl || null);

        // Format dates correctly (YYYY-MM-DD for input fields)
        const formattedExp = (data.experiences || []).map((exp: any) => ({
          ...exp,
          startDate: exp.startDate ? exp.startDate.substring(0, 10) : '',
          endDate: exp.endDate ? exp.endDate.substring(0, 10) : null,
        }));
        
        const formattedEdu = (data.education || []).map((edu: any) => ({
          ...edu,
          startDate: edu.startDate ? edu.startDate.substring(0, 10) : '',
          endDate: edu.endDate ? edu.endDate.substring(0, 10) : null,
        }));

        setExperiences(formattedExp);
        setEducation(formattedEdu);

        // Load career entries from validated backend contract
        try {
          const ceRes = await apiFetch('/profile/career-entries');
          if (ceRes.ok) {
            const ceData = await ceRes.json();
            const rawEntries = (Array.isArray(ceData) ? ceData : ceData?.entries || []) as BackendCareerEntry[];
            setBackendEntries(rawEntries);
            if (rawEntries.length > 0) {
              setEvidence(careerEntriesToEvidenceState(rawEntries));
            } else {
              setEvidence(normalizeExtractedEvidence(data.evidence || data));
            }
          } else {
            setEvidence(normalizeExtractedEvidence(data.evidence || data));
          }
        } catch {
          setEvidence(normalizeExtractedEvidence(data.evidence || data));
        }
      } catch (err: any) {
        setError(err.message || 'Profil məlumatlarını yükləyərkən xəta baş verdi.');
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, []);

  const handleAddRole = (e: React.FormEvent) => {
    e.preventDefault();
    if (newRole.trim() && !roles.includes(newRole.trim())) {
      setRoles([...roles, newRole.trim()]);
      setNewRole('');
    }
  };

  const handleRemoveRole = (role: string) => {
    setRoles(roles.filter((r) => r !== role));
  };

  const handleAddLocation = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPrefLocation.trim() && !prefLocations.includes(newPrefLocation.trim())) {
      setPrefLocations([...prefLocations, newPrefLocation.trim()]);
      setNewPrefLocation('');
    }
  };

  const handleRemoveLocation = (loc: string) => {
    setPrefLocations(prefLocations.filter((l) => l !== loc));
  };

  const handleToggleType = (type: string) => {
    if (prefTypes.includes(type)) {
      setPrefTypes(prefTypes.filter((t) => t !== type));
    } else {
      setPrefTypes([...prefTypes, type]);
    }
  };

  // Experience handlers
  const handleAddExperience = () => {
    setExperiences([
      ...experiences,
      { title: '', company: '', startDate: '', endDate: null, description: '' },
    ]);
  };

  const handleUpdateExperience = (index: number, field: keyof Experience, value: any) => {
    const updated = [...experiences];
    updated[index] = { ...updated[index], [field]: value };
    setExperiences(updated);
  };
  const patchExperience = (index: number, patch: Partial<Experience>) =>
    setExperiences((list) => list.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  const patchEducation = (index: number, patch: Partial<Education>) =>
    setEducation((list) => list.map((e, i) => (i === index ? { ...e, ...patch } : e)));

  const handleRemoveExperience = (index: number) => {
    setExperiences(experiences.filter((_, i) => i !== index));
  };

  // Education handlers
  const handleAddEducation = () => {
    setEducation([
      ...education,
      { institution: '', degree: '', fieldOfStudy: '', startDate: '', endDate: null },
    ]);
  };

  const handleUpdateEducation = (index: number, field: keyof Education, value: any) => {
    const updated = [...education];
    updated[index] = { ...updated[index], [field]: value };
    setEducation(updated);
  };

  const handleRemoveEducation = (index: number) => {
    setEducation(education.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Ad və soyadınızı yazın.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // A missing start date is never saved as today: the candidate writes what they know (the year alone is enough) or removes the role.
    const undated = experiences.filter((e) => (e.title.trim() || e.company.trim()) && !e.startDate).map((e) => e.title || e.company);
    if (undated.length) {
      setError(`İş təcrübəsinin başlama tarixi yazılmayıb: ${undated.slice(0, 3).join('; ')}. Bildiyiniz tarixi yazın (yalnız il də olar) və ya həmin sətri silin.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    const skillsArray = skills
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const payload = {
      name: name.trim(),
      headline,
      location,
      skills: skillsArray,
      jobPreferences: {
        roles,
        locations: prefLocations,
        types: prefTypes,
        salaryMin: salaryMin !== '' ? Number(salaryMin) : undefined,
        salaryMax: salaryMax !== '' ? Number(salaryMax) : undefined,
      },
      phone: phone || undefined,
      address: address || undefined,
      dob: dob ? new Date(dob).toISOString() : undefined,
      citizenship: citizenship || undefined,
      salaryExpectation: salaryExpectation !== '' ? Number(salaryExpectation) : undefined,
      preferredNetGross,
      preferredCurrency,
      defaultCoverLetter: defaultCoverLetter || undefined,
      experiences: experiences.map((exp) => ({
        title: exp.title,
        company: exp.company,
        location: exp.location?.trim() || null,
        startDate: new Date(exp.startDate).toISOString(),
        endDate: exp.endDate ? new Date(exp.endDate).toISOString() : null,
        startPrecision: exp.startPrecision ?? null,
        endPrecision: exp.endDate ? exp.endPrecision ?? null : null,
        description: exp.description,
      })),
      education: education.map((edu) => ({
        institution: edu.institution,
        degree: edu.degree,
        fieldOfStudy: edu.fieldOfStudy,
        location: edu.location?.trim() || null,
        startDate: edu.startDate ? new Date(edu.startDate).toISOString() : null,
        endDate: edu.endDate ? new Date(edu.endDate).toISOString() : null,
        startPrecision: edu.startDate ? edu.startPrecision ?? null : null,
        endPrecision: edu.endDate ? edu.endPrecision ?? null : null,
      })),
    };

    try {
      // 1. Save core profile fields
      const res = await apiFetch('/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Profil yadda saxlanıla bilmədi');
      }
      const saved = await res.json();
      setMatchingQueued(saved.matchingQueued ?? null);

      // 2. Persist career evidence entries to /profile/career-entries
      const freshEntries = await syncCareerEntriesToBackend(evidence, backendEntries, apiFetch);
      setBackendEntries(freshEntries);
      setEvidence(careerEntriesToEvidenceState(freshEntries));

      // Keep the sidebar badge in sync with the name just saved
      await updateSession({ name: name.trim() });

      setSuccess(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setError(err.message || 'Məlumatları saxlayarkən xəta baş verdi.');
    } finally {
      setSaving(false);
    }
  };

  const handleIdDocumentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIdDocUploading(true);
    setIdDocError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await apiFetch('/profile/id-document', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Sənəd yüklənə bilmədi.');
      }

      const data = await res.json();
      setIdDocumentUrl(data.idDocumentUrl || null);
    } catch (err: any) {
      setIdDocError(err.message || 'Sənəd yüklənərkən xəta baş verdi.');
    } finally {
      setIdDocUploading(false);
      // Allow re-selecting the same file again later.
      e.target.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-neutral-dark/65">Profil redaktoru yüklənir...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-neutral-dark/10 pb-5">
        <div>
          <h1 className="font-serif text-3xl font-bold text-neutral-dark">Profilim</h1>
          <Link href="/dashboard/profile?onboarding=true" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4">
            CV yüklə və ya LinkedIn məlumatlarını əlavə et
          </Link>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 product-action rounded-full bg-primary py-2.5 px-4 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50 transition-all"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Yadda saxlanılır...' : 'Profili Yadda Saxla'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100" role="alert">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg bg-green-50 p-4 text-sm text-green-700 border border-green-100" role="alert">
          {matchingQueued === false
            ? 'Profil yadda saxlanıldı, lakin uyğun iş axtarışı başlaya bilmədi. Yenidən yadda saxlayaraq cəhd edin.'
            : matchingQueued === true
              ? 'Profil uğurla yadda saxlanıldı! Uyğun iş axtarışı növbəyə əlavə edildi.'
              : 'Profil uğurla yadda saxlanıldı!'}
        </div>
      )}

      {safeReturnTo && (
        <div className="sticky top-4 z-40 mb-4 flex items-center justify-between rounded-2xl border border-primary/20 bg-surface-container p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs font-medium text-on-surface">
              Sənəd hazırlığından keçid etmisiniz. Profil məlumatlarını yenilədikdən sonra sənədə qayıda bilərsiniz.
            </span>
          </div>
          <Link
            href={safeReturnTo}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary-hover transition-colors shrink-0"
          >
            <span>Sənəd hazırlığına qayıt</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      <div className="space-y-6">
        {/* Bölmə 1: Əsas Məlumatlar */}
        <section className="bg-background border border-neutral-dark/5 rounded-2xl p-6 shadow-xs space-y-4">
          <h2 className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" /> Əsas məlumatlar
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pf-1" className="block text-xs font-semibold text-neutral-dark/85">Ad və soyad *</label>
              <input id="pf-1"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="məs. Aygün Məmmədova"
                required
              />
            </div>
            <div>
              <label htmlFor="pf-email" className="block text-xs font-semibold text-neutral-dark/85">E-poçt ünvanı</label>
              <input id="pf-email"
                type="email"
                value={email}
                disabled
                className="mt-1 block w-full rounded-xl border border-neutral-dark/15 bg-neutral-dark/5 py-2.5 px-3 text-neutral-dark/70 text-sm cursor-not-allowed"
                title="E-poçt ünvanı hesabınızla bağlıdır"
              />
            </div>
            <div>
              <label htmlFor="pf-2" className="block text-xs font-semibold text-neutral-dark/85">Peşəkar başlıq (headline)</label>
              <input id="pf-2"
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="məs. Senior Software Engineer / React Expert"
              />
            </div>
            <div>
              <label htmlFor="pf-3" className="block text-xs font-semibold text-neutral-dark/85">Hazırkı məkan</label>
              <input id="pf-3"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="məs. Bakı, Azərbaycan"
              />
            </div>
            <div id="skills" className="md:col-span-2 scroll-mt-24">
              <label htmlFor="pf-4" className="block text-xs font-semibold text-neutral-dark/85">Bacarıqlar (vergüllə ayrılmış)</label>
              <input id="pf-4"
                type="text"
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="məs. TypeScript, React, Next.js, Postgres"
              />
            </div>
          </div>
        </section>

        {/* Bölmə 2: Tərcihlər */}
        <section className="bg-background border border-neutral-dark/5 rounded-2xl p-6 shadow-xs space-y-4">
          <h2 className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
            <MapPin className="h-5 w-5 text-accent" /> İş tərcihləri
          </h2>
          <div className="space-y-4">
            {/* Rollar */}
            <div>
              <label htmlFor="pf-5" className="block text-xs font-semibold text-neutral-dark/85">İstədiyiniz rollar</label>
              <form onSubmit={handleAddRole} className="mt-1 flex gap-2">
                <input id="pf-5"
                  type="text"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  placeholder="məs. Full Stack Developer"
                />
                <button type="submit" className="product-action rounded-full bg-accent text-white px-4 text-xs font-bold hover:bg-accent-hover shrink-0 transition-colors">
                  Əlavə et
                </button>
              </form>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {roles.map((role) => (
                  <span key={role} className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 text-primary px-2.5 py-0.5 text-xs font-medium">
                    {role}
                    <button type="button" onClick={() => handleRemoveRole(role)} className="text-primary hover:text-primary-hover font-bold">
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* İş Rejimi */}
            <div>
              <label className="block text-xs font-semibold text-neutral-dark/85">İş mühiti parametrləri</label>
              <div className="mt-1.5 flex gap-4">
                {['remote', 'onsite', 'hybrid'].map((type) => {
                  const active = prefTypes.includes(type);
                  let translatedType = 'Ofisdə';
                  if (type === 'remote') translatedType = 'Məsafədən (Remote)';
                  if (type === 'hybrid') translatedType = 'Hibrid';
                  
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleToggleType(type)}
                      className={`tap rounded-xl px-4 py-2 text-xs font-semibold border transition-all ${
                        active
                          ? 'bg-primary border-primary text-white'
                          : 'bg-background-warm/15 border-neutral-dark/20 text-neutral-dark hover:bg-background-warm/35'
                      }`}
                    >
                      {translatedType}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Məkanlar */}
            <div>
              <label htmlFor="pf-6" className="block text-xs font-semibold text-neutral-dark/85">Hədəf məkanlar</label>
              <form onSubmit={handleAddLocation} className="mt-1 flex gap-2">
                <input id="pf-6"
                  type="text"
                  value={newPrefLocation}
                  onChange={(e) => setNewPrefLocation(e.target.value)}
                  className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  placeholder="məs. Məsafədən / Bakı"
                />
                <button type="submit" className="product-action rounded-full bg-accent text-white px-4 text-xs font-bold hover:bg-accent-hover shrink-0 transition-colors">
                  Əlavə et
                </button>
              </form>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {prefLocations.map((loc) => (
                  <span key={loc} className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 text-primary px-2.5 py-0.5 text-xs font-medium">
                    {loc}
                    <button type="button" onClick={() => handleRemoveLocation(loc)} className="text-primary hover:text-primary-hover font-bold">
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Maaş */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="pf-7" className="block text-xs font-semibold text-neutral-dark/85">Minimum maaş (USD/illik)</label>
                <input id="pf-7"
                  type="number"
                  min={0}
                  value={salaryMin}
                  onKeyDown={blockNegativeAndExponentKeys}
                  onChange={(e) => setSalaryMin(parseNonNegativeNumber(e.target.value))}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  placeholder="məs. 100000"
                />
              </div>
              <div>
                <label htmlFor="pf-8" className="block text-xs font-semibold text-neutral-dark/85">Maksimum maaş (USD/illik)</label>
                <input id="pf-8"
                  type="number"
                  min={0}
                  value={salaryMax}
                  onKeyDown={blockNegativeAndExponentKeys}
                  onChange={(e) => setSalaryMax(parseNonNegativeNumber(e.target.value))}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  placeholder="məs. 150000"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Bölmə: Avtomatik Müraciət Məlumatları */}
        <section className="bg-background border border-neutral-dark/5 rounded-2xl p-6 shadow-xs space-y-4">
          <h2 className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" /> Avtomatik müraciət məlumatları
          </h2>
          <p className="text-xs text-neutral-dark/55 -mt-2">
            Bu məlumatlar yalnız siz konkret müraciəti ayrıca təsdiqlədikdə, həmin müraciətdə istifadə olunur.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pf-9" className="block text-xs font-semibold text-neutral-dark/85">Telefon nömrəsi</label>
              <input id="pf-9"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="məs. +994 50 123 45 67"
              />
            </div>
            <div>
              <label htmlFor="pf-10" className="block text-xs font-semibold text-neutral-dark/85">Ünvan</label>
              <input id="pf-10"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="məs. Bakı, Nərimanov r."
              />
            </div>
            <div>
              <label htmlFor="pf-11" className="block text-xs font-semibold text-neutral-dark/85">Doğum tarixi</label>
              <input id="pf-11"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label htmlFor="pf-12" className="block text-xs font-semibold text-neutral-dark/85">Vətəndaşlıq</label>
              <input id="pf-12"
                type="text"
                value={citizenship}
                onChange={(e) => setCitizenship(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="məs. Azərbaycan"
              />
            </div>
            <div>
              <label htmlFor="pf-13" className="block text-xs font-semibold text-neutral-dark/85">Gözlənilən maaş</label>
              <input id="pf-13"
                type="number"
                min={0}
                value={salaryExpectation}
                onKeyDown={blockNegativeAndExponentKeys}
                onChange={(e) => setSalaryExpectation(parseNonNegativeNumber(e.target.value))}
                className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="məs. 2000"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="pf-14" className="block text-xs font-semibold text-neutral-dark/85">Net/Brüt</label>
                <select id="pf-14"
                  value={preferredNetGross}
                  onChange={(e) => setPreferredNetGross(e.target.value as 'Net' | 'Gross')}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                >
                  <option value="Net">Net</option>
                  <option value="Gross">Brüt</option>
                </select>
              </div>
              <div>
                <label htmlFor="pf-15" className="block text-xs font-semibold text-neutral-dark/85">Valyuta</label>
                <select id="pf-15"
                  value={preferredCurrency}
                  onChange={(e) => setPreferredCurrency(e.target.value as 'AZN' | 'USD' | 'EUR')}
                  className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                >
                  <option value="AZN">AZN</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="pf-16" className="block text-xs font-semibold text-neutral-dark/85">Standart motivasiya məktubu</label>
              <textarea id="pf-16"
                value={defaultCoverLetter}
                onChange={(e) => setDefaultCoverLetter(e.target.value)}
                rows={4}
                className="mt-1 block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="Müraciətlərdə istifadə olunacaq standart motivasiya məktubu..."
              />
            </div>
          </div>

          <div className="pt-2 border-t border-neutral-dark/5">
            <label className="block text-xs font-semibold text-neutral-dark/85 mb-1.5">Şəxsiyyət vəsiqəsi (ID sənədi)</label>
            <div className="flex items-center gap-4">
              {idDocumentUrl && (
                <IdDocumentPreview src={idDocumentUrl} />
              )}
              <label className="inline-flex items-center gap-2 rounded-xl border border-neutral-dark/20 bg-background px-4 py-2.5 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 cursor-pointer transition-all">
                <Upload className="h-4 w-4" />
                {idDocUploading ? 'Yüklənir...' : idDocumentUrl ? 'Sənədi Dəyiş' : 'Sənəd Yüklə'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleIdDocumentChange}
                  disabled={idDocUploading}
                  className="hidden"
                />
              </label>
            </div>
            {idDocError && <p className="mt-2 text-xs text-red-600">{idDocError}</p>}
            {!idDocError && idDocumentUrl && <p className="mt-2 text-xs text-green-700">Sənəd uğurla yükləndi.</p>}
          </div>
        </section>

        {/* Bölmə 3: İş Təcrübəsi */}
        <section id="experience" className="bg-background border border-neutral-dark/5 rounded-2xl p-6 shadow-xs space-y-4 scroll-mt-24">
          <div className="flex items-center justify-between border-b border-neutral-dark/5 pb-2">
            <h2 className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-accent" /> İş təcrübəsi
            </h2>
            <button
              type="button"
              onClick={handleAddExperience}
              className="tap inline-flex items-center gap-1 rounded-lg border border-primary text-primary px-3 py-1 text-xs font-bold hover:bg-primary/5 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> İş əlavə et
            </button>
          </div>

          <ExperienceWritingGuide id="experience-writing-guide" />

          {experiences.length === 0 ? (
            <p className="text-xs text-neutral-dark/50 text-center py-4">Təcrübə məlumatı daxil edilməyib.</p>
          ) : (
            <div className="space-y-4 divide-y divide-neutral-dark/5">
              {experiences.map((exp, idx) => (
                <div key={idx} className="pt-4 first:pt-0 space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-xs font-bold text-neutral-dark">İş #{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveExperience(idx)}
                      aria-label={`İş #${idx + 1} sil`}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor={`exp-${idx}-17`} className="block text-xs font-medium text-neutral-dark/75">Vəzifə</label>
                      <input id={`exp-${idx}-17`}
                        type="text"
                        value={exp.title}
                        onChange={(e) => handleUpdateExperience(idx, 'title', e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
                        placeholder="məs. Senior Backend Engineer"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor={`exp-${idx}-18`} className="block text-xs font-medium text-neutral-dark/75">Şirkət</label>
                      <input id={`exp-${idx}-18`}
                        type="text"
                        value={exp.company}
                        onChange={(e) => handleUpdateExperience(idx, 'company', e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
                        placeholder="məs. Google"
                        required
                      />
                    </div>
                    <PeriodInput label="Başlama tarixi *" className="mt-1 block w-full rounded-lg border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary focus:border-transparent transition-all" value={exp.startDate} precision={exp.startPrecision}
                      onChange={(v, p) => patchExperience(idx, { startDate: v, startPrecision: p === 'YEAR' ? 'YEAR' : null })} />
                    <PeriodInput label="Bitmə tarixi (boş = davam edir)" className="mt-1 block w-full rounded-lg border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary focus:border-transparent transition-all" value={exp.endDate || ''} precision={exp.endPrecision}
                      onChange={(v, p) => patchExperience(idx, { endDate: v || null, endPrecision: p === 'YEAR' ? 'YEAR' : null })} />
                    <div className="md:col-span-2">
                      <label htmlFor={`exp-${idx}-21`} className="block text-xs font-medium text-neutral-dark/75">Təsvir (Açıqlama)</label>
                      <textarea id={`exp-${idx}-21`}
                        value={exp.description}
                        onChange={(e) => handleUpdateExperience(idx, 'description', e.target.value)}
                        rows={3}
                        className="mt-1 block w-full rounded-lg border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
                        aria-describedby="experience-writing-guide"
                        placeholder="Hər sətirdə bir bənd: nə etdim, hansı üsulla və nəticə nə oldu?"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Bölmə 4: Təhsil */}
        <section id="education" className="bg-background border border-neutral-dark/5 rounded-2xl p-6 shadow-xs space-y-4 scroll-mt-24">
          <div className="flex items-center justify-between border-b border-neutral-dark/5 pb-2">
            <h2 className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-accent" /> Təhsil tarixçəsi
            </h2>
            <button
              type="button"
              onClick={handleAddEducation}
              className="tap inline-flex items-center gap-1 rounded-lg border border-primary text-primary px-3 py-1 text-xs font-bold hover:bg-primary/5 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Təhsil əlavə et
            </button>
          </div>

          {education.length === 0 ? (
            <p className="text-xs text-neutral-dark/50 text-center py-4">Təhsil məlumatı daxil edilməyib.</p>
          ) : (
            <div className="space-y-4 divide-y divide-neutral-dark/5">
              {education.map((edu, idx) => (
                <div key={idx} className="pt-4 first:pt-0 space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-xs font-bold text-neutral-dark">Təhsil #{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveEducation(idx)}
                      aria-label={`Təhsil #${idx + 1} sil`}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor={`edu-${idx}-22`} className="block text-xs font-medium text-neutral-dark/75">Təhsil müəssisəsi</label>
                      <input id={`edu-${idx}-22`}
                        type="text"
                        value={edu.institution}
                        onChange={(e) => handleUpdateEducation(idx, 'institution', e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
                        placeholder="məs. Bakı Dövlət Universiteti"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor={`edu-${idx}-23`} className="block text-xs font-medium text-neutral-dark/75">Dərəcə</label>
                      <input id={`edu-${idx}-23`}
                        type="text"
                        value={edu.degree}
                        onChange={(e) => handleUpdateEducation(idx, 'degree', e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
                        placeholder="məs. Bakalavr"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor={`edu-${idx}-24`} className="block text-xs font-medium text-neutral-dark/75">İxtisas</label>
                      <input id={`edu-${idx}-24`}
                        type="text"
                        value={edu.fieldOfStudy}
                        onChange={(e) => handleUpdateEducation(idx, 'fieldOfStudy', e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
                        placeholder="məs. Kompüter Elmləri"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <PeriodInput label="Başlama tarixi (istəyə bağlı)" className="mt-1 block w-full rounded-lg border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary focus:border-transparent transition-all" value={edu.startDate} precision={edu.startPrecision}
                        onChange={(v, p) => patchEducation(idx, { startDate: v, startPrecision: p === 'YEAR' ? 'YEAR' : null })} />
                      <PeriodInput label="Bitmə tarixi (istəyə bağlı)" className="mt-1 block w-full rounded-lg border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-1 focus:ring-primary focus:border-transparent transition-all" value={edu.endDate || ''} precision={edu.endPrecision}
                        onChange={(v, p) => patchEducation(idx, { endDate: v || null, endPrecision: p === 'YEAR' ? 'YEAR' : null })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Bölmə 5: Əlavə Karyera Sübutları */}
        <section id="projects" className="bg-background border border-neutral-dark/5 rounded-2xl p-6 shadow-xs space-y-4 scroll-mt-24">
          <h2 className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" /> Karyera sübutları
          </h2>
          <CareerEvidenceEditor
            evidence={evidence}
            onChange={setEvidence}
            disabled={saving}
          />
        </section>
      </div>

      <div className="flex justify-end border-t border-neutral-dark/10 pt-5">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 product-action rounded-full bg-primary py-3 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50 transition-all"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Yadda saxlanılır...' : 'Məlumatları Yadda Saxla'}
        </button>
      </div>
    </div>
  );
}

function IdDocumentPreview({ src }: { src: string }) {
  const objectUrl = useAuthedFileUrl(src);
  if (!objectUrl) {
    return <div className="h-16 w-16 rounded-lg border border-neutral-dark/10 bg-neutral-dark/5 animate-pulse" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={objectUrl}
      alt="Şəxsiyyət vəsiqəsi"
      className="h-16 w-16 rounded-lg object-cover border border-neutral-dark/10"
    />
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-neutral-dark/65">Profil redaktoru yüklənir...</p>
      </div>
    }>
      <ProfileContent />
    </Suspense>
  );
}
