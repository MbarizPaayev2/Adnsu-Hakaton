'use client';

import React, { useState } from 'react';
import {
  FolderGit2,
  HeartHandshake,
  Award,
  Globe2,
  Trophy,
  Plus,
  Trash2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  CareerEvidenceState,
  ProjectEvidence,
  VolunteeringEvidence,
  CertificationEvidence,
  LanguageEvidence,
  AwardEvidence,
  generateEvidenceId,
  EVIDENCE_SECTION_EXPLANATION,
} from '@/lib/career-evidence';

const FIELD_CLASS =
  'block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all';
const LABEL_CLASS = 'block text-xs font-semibold text-neutral-dark/85 mb-1';

function FromCvBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary-hover px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
      <Sparkles className="h-3 w-3" aria-hidden="true" /> CV-dən oxundu
    </span>
  );
}

function ConfirmationBadge({ confirmed }: { confirmed: boolean }) {
  if (confirmed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 text-[11px] font-semibold">
        <CheckCircle2 className="h-3 w-3 text-emerald-700" aria-hidden="true" /> Təsdiqlənib
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 px-2 py-0.5 text-[11px] font-semibold">
      <AlertCircle className="h-3 w-3 text-amber-700" aria-hidden="true" /> Təsdiq gözləyir
    </span>
  );
}

interface CareerEvidenceEditorProps {
  evidence: CareerEvidenceState;
  onChange: (evidence: CareerEvidenceState) => void;
  disabled?: boolean;
}

export function CareerEvidenceEditor({ evidence, onChange, disabled = false }: CareerEvidenceEditorProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    projects: evidence.projects.length > 0,
    volunteering: evidence.volunteering.length > 0,
    certifications: evidence.certifications.length > 0,
    languages: evidence.languages.length > 0,
    awards: evidence.awards.length > 0,
  });

  React.useEffect(() => {
    setOpenSections((prev) => ({
      projects: prev.projects || evidence.projects.length > 0,
      volunteering: prev.volunteering || evidence.volunteering.length > 0,
      certifications: prev.certifications || evidence.certifications.length > 0,
      languages: prev.languages || evidence.languages.length > 0,
      awards: prev.awards || evidence.awards.length > 0,
    }));
  }, [
    evidence.projects.length,
    evidence.volunteering.length,
    evidence.certifications.length,
    evidence.languages.length,
    evidence.awards.length,
  ]);

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Handlers for Projects
  const addProject = () => {
    const next: ProjectEvidence = {
      id: generateEvidenceId('proj'),
      name: '',
      period: '',
      description: '',
      source: 'USER',
      confirmed: true,
    };
    onChange({ ...evidence, projects: [...evidence.projects, next] });
    setOpenSections((s) => ({ ...s, projects: true }));
  };

  const updateProject = (id: string, patch: Partial<ProjectEvidence>) => {
    onChange({
      ...evidence,
      projects: evidence.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  };

  const trackDeletedId = (id: string) => {
    const currentList = evidence.deletedEntryIds || [];
    if (!currentList.includes(id)) {
      return [...currentList, id];
    }
    return currentList;
  };

  const removeProject = (id: string) => {
    onChange({
      ...evidence,
      projects: evidence.projects.filter((p) => p.id !== id),
      deletedEntryIds: trackDeletedId(id),
    });
  };

  // Handlers for Volunteering
  const addVolunteering = () => {
    const next: VolunteeringEvidence = {
      id: generateEvidenceId('vol'),
      organization: '',
      role: '',
      period: '',
      description: '',
      source: 'USER',
      confirmed: true,
    };
    onChange({ ...evidence, volunteering: [...evidence.volunteering, next] });
    setOpenSections((s) => ({ ...s, volunteering: true }));
  };

  const updateVolunteering = (id: string, patch: Partial<VolunteeringEvidence>) => {
    onChange({
      ...evidence,
      volunteering: evidence.volunteering.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    });
  };

  const removeVolunteering = (id: string) => {
    onChange({
      ...evidence,
      volunteering: evidence.volunteering.filter((v) => v.id !== id),
      deletedEntryIds: trackDeletedId(id),
    });
  };

  // Handlers for Certifications
  const addCertification = () => {
    const next: CertificationEvidence = {
      id: generateEvidenceId('cert'),
      title: '',
      issuer: '',
      date: '',
      description: '',
      source: 'USER',
      confirmed: true,
    };
    onChange({ ...evidence, certifications: [...evidence.certifications, next] });
    setOpenSections((s) => ({ ...s, certifications: true }));
  };

  const updateCertification = (id: string, patch: Partial<CertificationEvidence>) => {
    onChange({
      ...evidence,
      certifications: evidence.certifications.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  };

  const removeCertification = (id: string) => {
    onChange({
      ...evidence,
      certifications: evidence.certifications.filter((c) => c.id !== id),
      deletedEntryIds: trackDeletedId(id),
    });
  };

  // Handlers for Languages
  const addLanguage = () => {
    const next: LanguageEvidence = {
      id: generateEvidenceId('lang'),
      language: '',
      level: 'B2 - Yaxşı',
      source: 'USER',
      confirmed: true,
    };
    onChange({ ...evidence, languages: [...evidence.languages, next] });
    setOpenSections((s) => ({ ...s, languages: true }));
  };

  const updateLanguage = (id: string, patch: Partial<LanguageEvidence>) => {
    onChange({
      ...evidence,
      languages: evidence.languages.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
  };

  const removeLanguage = (id: string) => {
    onChange({
      ...evidence,
      languages: evidence.languages.filter((l) => l.id !== id),
      deletedEntryIds: trackDeletedId(id),
    });
  };

  // Handlers for Awards
  const addAward = () => {
    const next: AwardEvidence = {
      id: generateEvidenceId('award'),
      title: '',
      issuer: '',
      date: '',
      description: '',
      source: 'USER',
      confirmed: true,
    };
    onChange({ ...evidence, awards: [...evidence.awards, next] });
    setOpenSections((s) => ({ ...s, awards: true }));
  };

  const updateAward = (id: string, patch: Partial<AwardEvidence>) => {
    onChange({
      ...evidence,
      awards: evidence.awards.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  };

  const removeAward = (id: string) => {
    onChange({
      ...evidence,
      awards: evidence.awards.filter((a) => a.id !== id),
      deletedEntryIds: trackDeletedId(id),
    });
  };

  return (
    <div className="space-y-6">
      {/* Explanation Banner */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-xs sm:text-sm text-neutral-dark/85">
        <p className="font-semibold text-primary mb-1">Əlavə karyera sübutları (istəyə bağlı)</p>
        <p>{EVIDENCE_SECTION_EXPLANATION}</p>
      </div>

      {/* Section Trigger Pills (Progressive disclosure shortcuts) */}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            if (!openSections.projects) setOpenSections((s) => ({ ...s, projects: true }));
            if (evidence.projects.length === 0) addProject();
          }}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 min-h-11 rounded-full border border-neutral-dark/15 bg-background px-3.5 py-1.5 text-xs font-semibold text-neutral-dark hover:border-primary/40 hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
        >
          <FolderGit2 className="h-4 w-4 text-primary" aria-hidden="true" />
          <span>Layihələr</span>
          {evidence.projects.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-bold text-primary">
              {evidence.projects.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            if (!openSections.volunteering) setOpenSections((s) => ({ ...s, volunteering: true }));
            if (evidence.volunteering.length === 0) addVolunteering();
          }}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 min-h-11 rounded-full border border-neutral-dark/15 bg-background px-3.5 py-1.5 text-xs font-semibold text-neutral-dark hover:border-primary/40 hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
        >
          <HeartHandshake className="h-4 w-4 text-primary" aria-hidden="true" />
          <span>Könüllülük və liderlik</span>
          {evidence.volunteering.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-bold text-primary">
              {evidence.volunteering.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            if (!openSections.certifications) setOpenSections((s) => ({ ...s, certifications: true }));
            if (evidence.certifications.length === 0) addCertification();
          }}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 min-h-11 rounded-full border border-neutral-dark/15 bg-background px-3.5 py-1.5 text-xs font-semibold text-neutral-dark hover:border-primary/40 hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
        >
          <Award className="h-4 w-4 text-primary" aria-hidden="true" />
          <span>Sertifikatlar</span>
          {evidence.certifications.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-bold text-primary">
              {evidence.certifications.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            if (!openSections.languages) setOpenSections((s) => ({ ...s, languages: true }));
            if (evidence.languages.length === 0) addLanguage();
          }}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 min-h-11 rounded-full border border-neutral-dark/15 bg-background px-3.5 py-1.5 text-xs font-semibold text-neutral-dark hover:border-primary/40 hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
        >
          <Globe2 className="h-4 w-4 text-primary" aria-hidden="true" />
          <span>Dillər</span>
          {evidence.languages.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-bold text-primary">
              {evidence.languages.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            if (!openSections.awards) setOpenSections((s) => ({ ...s, awards: true }));
            if (evidence.awards.length === 0) addAward();
          }}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 min-h-11 rounded-full border border-neutral-dark/15 bg-background px-3.5 py-1.5 text-xs font-semibold text-neutral-dark hover:border-primary/40 hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
        >
          <Trophy className="h-4 w-4 text-primary" aria-hidden="true" />
          <span>Mükafatlar</span>
          {evidence.awards.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-bold text-primary">
              {evidence.awards.length}
            </span>
          )}
        </button>
      </div>

      {/* 1. Projects Section */}
      <section className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => toggleSection('projects')}
            className="flex items-center gap-2 text-left font-serif text-lg font-bold text-neutral-dark focus-visible:outline-hidden"
            aria-expanded={openSections.projects}
          >
            <FolderGit2 className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
            <span>Layihələr</span>
            {openSections.projects ? <ChevronUp className="h-4 w-4 text-neutral-dark/50" /> : <ChevronDown className="h-4 w-4 text-neutral-dark/50" />}
          </button>
          <button
            type="button"
            onClick={addProject}
            disabled={disabled}
            className="inline-flex items-center gap-1 min-h-11 rounded-xl border border-neutral-dark/20 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-dark/5 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Layihə əlavə et
          </button>
        </div>

        {openSections.projects && (
          <div className="space-y-4 pt-2">
            {evidence.projects.length === 0 ? (
              <p className="text-xs text-neutral-dark/60 py-2">
                Hələ heç bir layihə əlavə edilməyib. Əhəmiyyətli şəxsi və ya peşəkar layihələrinizi qeyd edin.
              </p>
            ) : (
              evidence.projects.map((proj, idx) => (
                <div
                  key={proj.id}
                  className="rounded-xl border border-neutral-dark/15 bg-background-warm/15 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-dark/10 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-neutral-dark">Layihə #{idx + 1}</span>
                      {proj.source === 'EXTRACTED' && <FromCvBadge />}
                      <ConfirmationBadge confirmed={proj.confirmed} />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeProject(proj.id)}
                      disabled={disabled}
                      aria-label={`${proj.name || idx + 1}. layihəni sil`}
                      className="p-1.5 text-neutral-dark/50 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor={`ev-name-${proj.id}`} className={LABEL_CLASS}>Layihənin adı</label>
                      <input id={`ev-name-${proj.id}`}
                        className={FIELD_CLASS}
                        placeholder="məs. AISE Axtarış Mühərriki"
                        value={proj.name}
                        onChange={(e) => updateProject(proj.id, { name: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                    <div>
                      <label htmlFor={`ev-period-${proj.id}`} className={LABEL_CLASS}>Dövr / Tarix</label>
                      <input id={`ev-period-${proj.id}`}
                        className={FIELD_CLASS}
                        placeholder="məs. 2025 – 2026"
                        value={proj.period}
                        onChange={(e) => updateProject(proj.id, { period: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor={`ev-description-${proj.id}`} className={LABEL_CLASS}>Təsvir və əldə olunan nəticə</label>
                    <textarea id={`ev-description-${proj.id}`}
                      rows={2}
                      className={FIELD_CLASS}
                      placeholder="Nə etdiniz, hansı texnologiyalardan istifadə etdiniz və nəticə nə oldu?"
                      value={proj.description}
                      onChange={(e) => updateProject(proj.id, { description: e.target.value })}
                      disabled={disabled}
                    />
                  </div>

                  <label className="inline-flex items-center gap-2 cursor-pointer pt-1 text-xs font-medium text-neutral-dark/85">
                    <input
                      type="checkbox"
                      checked={proj.confirmed}
                      onChange={(e) => updateProject(proj.id, { confirmed: e.target.checked })}
                      disabled={disabled}
                      className="rounded-md border-neutral-dark/30 text-primary focus:ring-primary h-4 w-4"
                    />
                    <span>Bu layihə məlumatlarını və faktları təsdiqləyirəm</span>
                  </label>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* 2. Volunteering & Leadership Section */}
      <section className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => toggleSection('volunteering')}
            className="flex items-center gap-2 text-left font-serif text-lg font-bold text-neutral-dark focus-visible:outline-hidden"
            aria-expanded={openSections.volunteering}
          >
            <HeartHandshake className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
            <span>Könüllülük və liderlik</span>
            {openSections.volunteering ? <ChevronUp className="h-4 w-4 text-neutral-dark/50" /> : <ChevronDown className="h-4 w-4 text-neutral-dark/50" />}
          </button>
          <button
            type="button"
            onClick={addVolunteering}
            disabled={disabled}
            className="inline-flex items-center gap-1 min-h-11 rounded-xl border border-neutral-dark/20 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-dark/5 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Fəaliyyət əlavə et
          </button>
        </div>

        {openSections.volunteering && (
          <div className="space-y-4 pt-2">
            {evidence.volunteering.length === 0 ? (
              <p className="text-xs text-neutral-dark/60 py-2">
                Hələ heç bir könüllülük və ya təşkilati liderlik qeydi yoxdur.
              </p>
            ) : (
              evidence.volunteering.map((vol, idx) => (
                <div
                  key={vol.id}
                  className="rounded-xl border border-neutral-dark/15 bg-background-warm/15 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-dark/10 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-neutral-dark">Fəaliyyət #{idx + 1}</span>
                      {vol.source === 'EXTRACTED' && <FromCvBadge />}
                      <ConfirmationBadge confirmed={vol.confirmed} />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeVolunteering(vol.id)}
                      disabled={disabled}
                      aria-label={`${vol.organization || idx + 1}. könüllülük fəaliyyətini sil`}
                      className="p-1.5 text-neutral-dark/50 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor={`ev-organization-${vol.id}`} className={LABEL_CLASS}>Təşkilat / Qrup</label>
                      <input id={`ev-organization-${vol.id}`}
                        className={FIELD_CLASS}
                        placeholder="məs. Formula 1 Bakı Şəhər Halqası"
                        value={vol.organization}
                        onChange={(e) => updateVolunteering(vol.id, { organization: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                    <div>
                      <label htmlFor={`ev-role-${vol.id}`} className={LABEL_CLASS}>Rol / Vəzifə</label>
                      <input id={`ev-role-${vol.id}`}
                        className={FIELD_CLASS}
                        placeholder="məs. Komanda rəhbəri"
                        value={vol.role}
                        onChange={(e) => updateVolunteering(vol.id, { role: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                    <div>
                      <label htmlFor={`ev-period-${vol.id}`} className={LABEL_CLASS}>Dövr</label>
                      <input id={`ev-period-${vol.id}`}
                        className={FIELD_CLASS}
                        placeholder="məs. 2024"
                        value={vol.period}
                        onChange={(e) => updateVolunteering(vol.id, { period: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor={`ev-description-${vol.id}`} className={LABEL_CLASS}>Təsvir</label>
                    <textarea id={`ev-description-${vol.id}`}
                      rows={2}
                      className={FIELD_CLASS}
                      placeholder="Məsuliyyətiniz və ya təşkilata verdiyiniz töhfə"
                      value={vol.description}
                      onChange={(e) => updateVolunteering(vol.id, { description: e.target.value })}
                      disabled={disabled}
                    />
                  </div>

                  <label className="inline-flex items-center gap-2 cursor-pointer pt-1 text-xs font-medium text-neutral-dark/85">
                    <input
                      type="checkbox"
                      checked={vol.confirmed}
                      onChange={(e) => updateVolunteering(vol.id, { confirmed: e.target.checked })}
                      disabled={disabled}
                      className="rounded-md border-neutral-dark/30 text-primary focus:ring-primary h-4 w-4"
                    />
                    <span>Bu könüllülük məlumatlarını təsdiqləyirəm</span>
                  </label>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* 3. Certifications Section */}
      <section className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => toggleSection('certifications')}
            className="flex items-center gap-2 text-left font-serif text-lg font-bold text-neutral-dark focus-visible:outline-hidden"
            aria-expanded={openSections.certifications}
          >
            <Award className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
            <span>Sertifikatlar</span>
            {openSections.certifications ? <ChevronUp className="h-4 w-4 text-neutral-dark/50" /> : <ChevronDown className="h-4 w-4 text-neutral-dark/50" />}
          </button>
          <button
            type="button"
            onClick={addCertification}
            disabled={disabled}
            className="inline-flex items-center gap-1 min-h-11 rounded-xl border border-neutral-dark/20 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-dark/5 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Sertifikat əlavə et
          </button>
        </div>

        {openSections.certifications && (
          <div className="space-y-4 pt-2">
            {evidence.certifications.length === 0 ? (
              <p className="text-xs text-neutral-dark/60 py-2">
                Hələ heç bir sertifikat qeyd edilməyib. Peşəkar sertifikatlarınızı əlavə edin.
              </p>
            ) : (
              evidence.certifications.map((cert, idx) => (
                <div
                  key={cert.id}
                  className="rounded-xl border border-neutral-dark/15 bg-background-warm/15 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-dark/10 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-neutral-dark">Sertifikat #{idx + 1}</span>
                      {cert.source === 'EXTRACTED' && <FromCvBadge />}
                      <ConfirmationBadge confirmed={cert.confirmed} />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCertification(cert.id)}
                      disabled={disabled}
                      aria-label={`${cert.title || idx + 1}. sertifikatı sil`}
                      className="p-1.5 text-neutral-dark/50 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor={`ev-title-${cert.id}`} className={LABEL_CLASS}>Sertifikatın adı</label>
                      <input id={`ev-title-${cert.id}`}
                        className={FIELD_CLASS}
                        placeholder="məs. AWS Certified Solutions Architect"
                        value={cert.title}
                        onChange={(e) => updateCertification(cert.id, { title: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                    <div>
                      <label htmlFor={`ev-issuer-${cert.id}`} className={LABEL_CLASS}>Verən qurum</label>
                      <input id={`ev-issuer-${cert.id}`}
                        className={FIELD_CLASS}
                        placeholder="məs. Amazon Web Services"
                        value={cert.issuer}
                        onChange={(e) => updateCertification(cert.id, { issuer: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                    <div>
                      <label htmlFor={`ev-date-${cert.id}`} className={LABEL_CLASS}>Verilmə tarixi</label>
                      <input id={`ev-date-${cert.id}`}
                        className={FIELD_CLASS}
                        placeholder="məs. 2025"
                        value={cert.date}
                        onChange={(e) => updateCertification(cert.id, { date: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 cursor-pointer pt-1 text-xs font-medium text-neutral-dark/85">
                    <input
                      type="checkbox"
                      checked={cert.confirmed}
                      onChange={(e) => updateCertification(cert.id, { confirmed: e.target.checked })}
                      disabled={disabled}
                      className="rounded-md border-neutral-dark/30 text-primary focus:ring-primary h-4 w-4"
                    />
                    <span>Bu sertifikatı təsdiqləyirəm</span>
                  </label>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* 4. Languages Section */}
      <section className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => toggleSection('languages')}
            className="flex items-center gap-2 text-left font-serif text-lg font-bold text-neutral-dark focus-visible:outline-hidden"
            aria-expanded={openSections.languages}
          >
            <Globe2 className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
            <span>Xarici dillər</span>
            {openSections.languages ? <ChevronUp className="h-4 w-4 text-neutral-dark/50" /> : <ChevronDown className="h-4 w-4 text-neutral-dark/50" />}
          </button>
          <button
            type="button"
            onClick={addLanguage}
            disabled={disabled}
            className="inline-flex items-center gap-1 min-h-11 rounded-xl border border-neutral-dark/20 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-dark/5 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Dil əlavə et
          </button>
        </div>

        {openSections.languages && (
          <div className="space-y-4 pt-2">
            {evidence.languages.length === 0 ? (
              <p className="text-xs text-neutral-dark/60 py-2">
                Hələ heç bir dil əlavə edilməyib. Bildiyiniz dilləri və səviyyənizi göstərin.
              </p>
            ) : (
              evidence.languages.map((lang, idx) => (
                <div
                  key={lang.id}
                  className="rounded-xl border border-neutral-dark/15 bg-background-warm/15 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-dark/10 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-neutral-dark">Dil #{idx + 1}</span>
                      {lang.source === 'EXTRACTED' && <FromCvBadge />}
                      <ConfirmationBadge confirmed={lang.confirmed} />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLanguage(lang.id)}
                      disabled={disabled}
                      aria-label={`${lang.language || idx + 1}. dili sil`}
                      className="p-1.5 text-neutral-dark/50 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor={`ev-language-${lang.id}`} className={LABEL_CLASS}>Dil</label>
                      <input id={`ev-language-${lang.id}`}
                        className={FIELD_CLASS}
                        placeholder="məs. İngilis dili"
                        value={lang.language}
                        onChange={(e) => updateLanguage(lang.id, { language: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                    <div>
                      <label htmlFor={`ev-level-${lang.id}`} className={LABEL_CLASS}>Bilik səviyyəsi</label>
                      <input id={`ev-level-${lang.id}`}
                        className={FIELD_CLASS}
                        placeholder="məs. C1 - Sərbəst və ya Ana dili"
                        value={lang.level}
                        onChange={(e) => updateLanguage(lang.id, { level: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 cursor-pointer pt-1 text-xs font-medium text-neutral-dark/85">
                    <input
                      type="checkbox"
                      checked={lang.confirmed}
                      onChange={(e) => updateLanguage(lang.id, { confirmed: e.target.checked })}
                      disabled={disabled}
                      className="rounded-md border-neutral-dark/30 text-primary focus:ring-primary h-4 w-4"
                    />
                    <span>Bu dil məlumatını təsdiqləyirəm</span>
                  </label>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* 5. Awards Section */}
      <section className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => toggleSection('awards')}
            className="flex items-center gap-2 text-left font-serif text-lg font-bold text-neutral-dark focus-visible:outline-hidden"
            aria-expanded={openSections.awards}
          >
            <Trophy className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
            <span>Mükafatlar və nailiyyətlər</span>
            {openSections.awards ? <ChevronUp className="h-4 w-4 text-neutral-dark/50" /> : <ChevronDown className="h-4 w-4 text-neutral-dark/50" />}
          </button>
          <button
            type="button"
            onClick={addAward}
            disabled={disabled}
            className="inline-flex items-center gap-1 min-h-11 rounded-xl border border-neutral-dark/20 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-dark/5 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Mükafat əlavə et
          </button>
        </div>

        {openSections.awards && (
          <div className="space-y-4 pt-2">
            {evidence.awards.length === 0 ? (
              <p className="text-xs text-neutral-dark/60 py-2">
                Hələ heç bir mükafat və ya xüsusi nailiyyət qeyd edilməyib.
              </p>
            ) : (
              evidence.awards.map((award, idx) => (
                <div
                  key={award.id}
                  className="rounded-xl border border-neutral-dark/15 bg-background-warm/15 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-dark/10 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-neutral-dark">Mükafat #{idx + 1}</span>
                      {award.source === 'EXTRACTED' && <FromCvBadge />}
                      <ConfirmationBadge confirmed={award.confirmed} />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAward(award.id)}
                      disabled={disabled}
                      aria-label={`${award.title || idx + 1}. mükafatı sil`}
                      className="p-1.5 text-neutral-dark/50 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor={`ev-title-${award.id}`} className={LABEL_CLASS}>Mükafat / Təltif</label>
                      <input id={`ev-title-${award.id}`}
                        className={FIELD_CLASS}
                        placeholder="məs. İlin gənc tədqiqatçısı"
                        value={award.title}
                        onChange={(e) => updateAward(award.id, { title: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                    <div>
                      <label htmlFor={`ev-issuer-${award.id}`} className={LABEL_CLASS}>Təqdim edən qurum</label>
                      <input id={`ev-issuer-${award.id}`}
                        className={FIELD_CLASS}
                        placeholder="məs. Təhsil Nazirliyi"
                        value={award.issuer}
                        onChange={(e) => updateAward(award.id, { issuer: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                    <div>
                      <label htmlFor={`ev-date-${award.id}`} className={LABEL_CLASS}>Tarix</label>
                      <input id={`ev-date-${award.id}`}
                        className={FIELD_CLASS}
                        placeholder="məs. 2024"
                        value={award.date}
                        onChange={(e) => updateAward(award.id, { date: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor={`ev-description-${award.id}`} className={LABEL_CLASS}>Təsvir (istəyə bağlı)</label>
                    <textarea id={`ev-description-${award.id}`}
                      rows={2}
                      className={FIELD_CLASS}
                      placeholder="Nailiyyətin detalları"
                      value={award.description || ''}
                      onChange={(e) => updateAward(award.id, { description: e.target.value })}
                      disabled={disabled}
                    />
                  </div>

                  <label className="inline-flex items-center gap-2 cursor-pointer pt-1 text-xs font-medium text-neutral-dark/85">
                    <input
                      type="checkbox"
                      checked={award.confirmed}
                      onChange={(e) => updateAward(award.id, { confirmed: e.target.checked })}
                      disabled={disabled}
                      className="rounded-md border-neutral-dark/30 text-primary focus:ring-primary h-4 w-4"
                    />
                    <span>Bu nailiyyəti təsdiqləyirəm</span>
                  </label>
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}
