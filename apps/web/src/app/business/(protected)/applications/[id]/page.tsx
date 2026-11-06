'use client';

import React, { use, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  FileText,
  Briefcase,
  Calendar,
  AlertTriangle,
  Clock,
  ExternalLink,
  Download,
  Info,
  CheckCircle,
} from 'lucide-react';
import { formatDate } from '@/lib/format';

const STATUS_OPTIONS = [
  { value: 'APPLIED', label: 'Müraciət etdi' },
  { value: 'REVIEWING', label: 'Nəzərdən keçirilir' },
  { value: 'INTERVIEW', label: 'Müsahibə' },
  { value: 'HIRED', label: 'Qəbul edildi' },
  { value: 'REJECTED', label: 'Rədd edildi' },
];

export default function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [app, setApp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successNote, setSuccessNote] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/business/applications/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) {
            setIsSessionExpired(true);
            throw new Error('Sessiyanız bitib. Yenidən daxil olun.');
          }
          if (res.status === 404) {
            throw new Error('Müraciət tapılmadı və ya silinib.');
          }
          throw new Error('Müraciət yüklənmədi.');
        }
        return res.json();
      })
      .then(setApp)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value;
    const previousStatus = app?.status;
    setSaving(true);
    setError(null);
    setSuccessNote(null);

    try {
      const res = await fetch(`/api/business/applications/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          setIsSessionExpired(true);
          throw new Error('Sessiyanız bitib. Yenidən daxil olun.');
        }
        throw new Error('Status dəyişmədi. Yenidən cəhd edin.');
      }

      const updated = await res.json();
      setApp((current: any) => ({ ...current, status: updated.status }));
      setSuccessNote('Status uğurla yeniləndi.');
    } catch (err: any) {
      setError(err.message || 'Status dəyişmədi.');
      // Revert status on failure
      setApp((current: any) => ({ ...current, status: previousStatus }));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-neutral-dark/70" role="status">
        Müraciət detalları yüklənir...
      </div>
    );
  }

  if (isSessionExpired) {
    return (
      <div
        role="alert"
        className="product-card rounded-2xl bg-background border border-amber-200 p-8 text-center shadow-xs max-w-md mx-auto my-12"
      >
        <Clock className="mx-auto h-12 w-12 text-amber-600 mb-3" />
        <h2 className="font-serif text-2xl font-bold text-neutral-dark mb-2">Sessiyanız bitib</h2>
        <p className="text-sm text-neutral-dark/70 mb-6">
          Təhlükəsizlik məqsədilə daxilolma müddətiniz başa çatıb. Zəhmət olmasa yenidən daxil olun.
        </p>
        <Link
          href="/business/login"
          className="inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all"
        >
          Yenidən daxil ol
        </Link>
      </div>
    );
  }

  if (!app) {
    return (
      <div
        role="alert"
        className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-8 text-center shadow-xs max-w-md mx-auto my-12"
      >
        <AlertTriangle className="mx-auto h-12 w-12 text-amber-600 mb-3" />
        <h2 className="font-serif text-2xl font-bold text-neutral-dark mb-2">Müraciət tapılmadı</h2>
        <p className="text-sm text-neutral-dark/70 mb-6">{error || 'Müraciət tapılmadı və ya bu hesaba aid deyil.'}</p>
        <Link
          href="/business/applications"
          className="inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all"
        >
          <ArrowLeft className="h-4 w-4" /> Müraciətlərə qayıt
        </Link>
      </div>
    );
  }

  const resumeFilename = app.resumeUrl ? app.resumeUrl.split('/').pop() : null;
  const initial = app.candidateName ? app.candidateName[0].toUpperCase() : 'N';

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500 pb-12">
      {/* Back Link */}
      <Link
        href="/business/applications"
        className="tap inline-flex items-center text-sm font-medium text-neutral-dark/65 hover:text-primary transition-colors gap-1.5"
      >
        <ArrowLeft className="h-4 w-4" /> Bütün müraciətlərə qayıt
      </Link>

      {/* Header with Title and Status Selector */}
      <div className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-neutral-dark/60 uppercase tracking-wider mb-1">
              <span>Vakansiya:</span>
              <span className="text-neutral-dark font-bold">{app.vacancyTitle}</span>
            </div>
            <h1 className="font-serif text-2xl sm:text-3xl font-bold text-neutral-dark break-words">
              {app.candidateName}
            </h1>
            <p className="mt-1 text-xs text-neutral-dark/65 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Müraciət tarixi: {formatDate(app.createdAt)}
            </p>
          </div>

          <div className="shrink-0 self-start sm:self-center">
            <div className="flex flex-col items-start sm:items-end gap-1.5">
              <label htmlFor="app-status" className="text-xs font-semibold text-neutral-dark/75">
                Müraciət statusu
              </label>
              <select
                id="app-status"
                aria-label="Müraciət statusu"
                value={app.status}
                onChange={handleStatusChange}
                disabled={saving}
                className="rounded-xl border border-neutral-dark/20 bg-background py-2 px-3 text-sm font-semibold text-neutral-dark focus:ring-2 focus:ring-primary disabled:opacity-60 transition-all"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Clear separation note distinguishing internal status from external outcomes */}
        <div className="mt-4 pt-4 border-t border-neutral-dark/10 flex items-start gap-2 text-xs text-neutral-dark/65 bg-background-warm/30 p-3 rounded-xl">
          <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p>
            <strong>Status AISE daxilində qeyd olunur.</strong> Namizədə e-poçt və ya bildiriş göndərilmir, müsahibə təyin olunmur.
            «Nəzərdən keçirilir», «Müsahibə», «Qəbul edildi» və «Rədd edildi» statusları namizədin AISE müraciət xronologiyasında sizin təsdiqiniz kimi görünə bilər.
            Müsahibə vaxtı və qərar barədə namizədlə e-poçt və ya telefonla özünüz əlaqə saxlayın.
          </p>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs sm:text-sm font-semibold text-red-700 bg-red-50 p-2.5 rounded-lg border border-red-200">
            {error}
          </p>
        )}
        {successNote && (
          <p className="mt-3 text-xs font-semibold text-emerald-800 bg-emerald-50 p-2.5 rounded-lg border border-emerald-200 flex items-center gap-1.5">
            <CheckCircle className="h-4 w-4 text-emerald-600" /> {successNote}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Candidate Profile and CV Card */}
        <div className="md:col-span-1 space-y-6">
          <div className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-6 shadow-xs space-y-5">
            <h2 className="font-serif text-lg font-bold text-neutral-dark border-b border-neutral-dark/10 pb-3">
              Namizəd
            </h2>

            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/20 text-accent font-serif font-bold text-lg shrink-0">
                {initial}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm text-neutral-dark truncate">{app.candidateName}</p>
                <p className="text-xs text-neutral-dark/60 truncate">{app.candidateEmail}</p>
              </div>
            </div>

            <div className="space-y-3 text-sm pt-2 border-t border-neutral-dark/10">
              <div>
                <span className="block text-xs font-medium text-neutral-dark/60 mb-0.5">E-poçt</span>
                <a
                  href={`mailto:${app.candidateEmail}`}
                  className="tap flex items-center gap-2 text-neutral-dark hover:text-primary transition-colors font-medium break-all"
                >
                  <Mail className="h-4 w-4 text-neutral-dark/60 shrink-0" />
                  <span>{app.candidateEmail}</span>
                </a>
              </div>

              <div>
                <span className="block text-xs font-medium text-neutral-dark/60 mb-0.5">Telefon</span>
                {app.candidatePhone ? (
                  <a
                    href={`tel:${app.candidatePhone}`}
                    className="tap flex items-center gap-2 text-neutral-dark hover:text-primary transition-colors font-medium"
                  >
                    <Phone className="h-4 w-4 text-neutral-dark/60 shrink-0" />
                    <span>{app.candidatePhone}</span>
                  </a>
                ) : (
                  <span className="text-xs text-neutral-dark/50">Qeyd edilməyib</span>
                )}
              </div>
            </div>

            {/* Resume Attachment Card */}
            <div className="pt-2 border-t border-neutral-dark/10">
              <span className="block text-xs font-medium text-neutral-dark/60 mb-2">CV Faylı</span>
              {resumeFilename ? (
                <div className="rounded-xl border border-neutral-dark/15 bg-background-warm/30 p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary shrink-0" />
                    <span
                      className="text-xs font-semibold text-neutral-dark truncate"
                      title={resumeFilename}
                    >
                      {resumeFilename}
                    </span>
                  </div>
                  <a
                    href={`/api/business/uploads/${resumeFilename}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tap inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2 px-3 text-xs font-semibold text-white hover:bg-primary-hover shadow-xs transition-all"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> CV-yə bax / Yüklə
                  </a>
                </div>
              ) : (
                <p className="text-xs text-neutral-dark/60 italic">CV faylı əlavə edilməyib.</p>
              )}
            </div>
          </div>
        </div>

        {/* Experience and Answers Column */}
        <div className="md:col-span-2 space-y-6">
          {/* Work Experience */}
          <div className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2 border-b border-neutral-dark/10 pb-3">
              <Briefcase className="h-5 w-5 text-primary" />
              <h2 className="font-serif text-lg font-bold text-neutral-dark">
                İş təcrübəsi
              </h2>
            </div>

            {app.experiences && app.experiences.length > 0 ? (
              <div className="divide-y divide-neutral-dark/10">
                {app.experiences.map((exp: any, idx: number) => (
                  <div key={idx} className="py-3.5 first:pt-0 last:pb-0 space-y-1">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                      <p className="text-sm font-bold text-neutral-dark">
                        {exp.title} <span className="font-normal text-neutral-dark/70">— {exp.company}</span>
                      </p>
                      <p className="text-xs text-neutral-dark/60 shrink-0">
                        {formatDate(exp.startDate)} — {exp.endDate ? formatDate(exp.endDate) : 'Hazırda davam edir'}
                      </p>
                    </div>
                    {exp.description && (
                      <p className="text-xs sm:text-sm text-neutral-dark/80 whitespace-pre-line pt-1">
                        {exp.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs sm:text-sm text-neutral-dark/65 py-2">
                Namizəd profilində iş təcrübəsi qeyd etməyib.
              </p>
            )}
          </div>

          {/* Question Answers & Question Attachments */}
          <div className="product-card rounded-2xl bg-background border border-neutral-dark/10 p-6 shadow-xs space-y-4">
            <h2 className="font-serif text-lg font-bold text-neutral-dark border-b border-neutral-dark/10 pb-3">
              Müraciət suallarına cavablar
            </h2>

            {app.answers && app.answers.length > 0 ? (
              <div className="space-y-4">
                {app.answers.map((ans: any, idx: number) => {
                  const ansFilename = ans.fileUrl ? ans.fileUrl.split('/').pop() : null;
                  return (
                    <div key={idx} className="space-y-1.5 bg-background-warm/25 p-4 rounded-xl border border-neutral-dark/10">
                      <p className="text-xs font-bold text-neutral-dark">
                        {ans.questionLabel || `${idx + 1}-ci sual`}
                      </p>
                      {ansFilename ? (
                        <div className="mt-2 flex items-center justify-between gap-3 bg-background p-2.5 rounded-lg border border-neutral-dark/15">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-4 w-4 text-primary shrink-0" />
                            <span className="text-xs font-medium text-neutral-dark truncate" title={ansFilename}>
                              {ansFilename}
                            </span>
                          </div>
                          <a
                            href={`/api/business/uploads/${ansFilename}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tap inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline shrink-0"
                          >
                            <Download className="h-3.5 w-3.5" /> Faylı yüklə
                          </a>
                        </div>
                      ) : (
                        <p className="text-xs sm:text-sm text-neutral-dark/85 whitespace-pre-wrap break-words">
                          {ans.value || 'Cavab daxil edilməyib'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs sm:text-sm text-neutral-dark/65 py-2">
                Bu vakansiya üçün xüsusi sual cavablandırılmayıb.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
