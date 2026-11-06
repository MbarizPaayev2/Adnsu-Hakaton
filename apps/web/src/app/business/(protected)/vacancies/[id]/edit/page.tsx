'use client';

import React, { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { loadPlansOverview } from '@/lib/business-plans';
import {
  VacancyForm,
  EMPTY_VACANCY,
  type VacancyFormValues,
} from '@/components/business/vacancy-form';

/**
 * Maps a vacancy as the API returns it onto the form's string-based state.
 */
function toFormValues(v: Record<string, unknown>): VacancyFormValues {
  const str = (x: unknown) => (x == null ? '' : String(x));
  const questions = Array.isArray(v.questions) ? v.questions : [];

  return {
    title: str(v.title),
    description: str(v.description),
    responsibilities: str(v.responsibilities),
    requirements: str(v.requirements),
    skills: Array.isArray(v.skills) ? v.skills.join(', ') : '',
    experienceLevel: str(v.experienceLevel) || EMPTY_VACANCY.experienceLevel,
    salaryMin: str(v.salaryMin),
    salaryMax: str(v.salaryMax),
    location: str(v.location),
    workArrangement: str(v.workArrangement) || EMPTY_VACANCY.workArrangement,
    employmentType: str(v.employmentType) || EMPTY_VACANCY.employmentType,
    deadline: v.deadline ? String(v.deadline).slice(0, 10) : '',
    applicationEmail: str((v.applicationDestination as { email?: string } | null | undefined)?.email),
    questions: questions
      .slice()
      .sort((a: any, b: any) => (a?.order ?? 0) - (b?.order ?? 0))
      .map((q: any) => ({
        label: str(q?.label),
        type: str(q?.type) || 'SHORT_TEXT',
        required: Boolean(q?.required),
        options: Array.isArray(q?.options)
          ? q.options
              .slice()
              .sort((a: any, b: any) => (a?.order ?? 0) - (b?.order ?? 0))
              .map((o: any) => str(o?.label))
          : [],
      })),
  };
}

export default function EditVacancyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [values, setValues] = useState<VacancyFormValues | null>(null);
  const [applicationCount, setApplicationCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [plansEnabled, setPlansEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPlansOverview().then((o) => { if (alive) setPlansEnabled(!!o?.gated); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const vacRes = await fetch(`/api/business/vacancies/${id}`);

        if (!vacRes.ok) {
          if (vacRes.status === 404) {
            throw new Error('Vakansiya tapılmadı və ya silinib.');
          }
          if (vacRes.status === 401) {
            throw new Error('Sessiyanız bitib. Zəhmət olmasa yenidən daxil olun.');
          }
          throw new Error(`Vakansiya yüklənmədi (${vacRes.status}).`);
        }

        const data = await vacRes.json();
        // The vacancy response carries the authoritative count (same read as the question lock). Anything else is unknown, never zero.
        const raw = data?._count?.applications;
        const appCount = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null;

        if (!cancelled) {
          setValues(toFormValues(data));
          setApplicationCount(appCount);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Vakansiya yüklənmədi.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center text-sm text-neutral-dark/70" role="status">
        Vakansiya məlumatları yüklənir...
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto my-12 product-card rounded-2xl bg-background border border-red-200 p-8 text-center shadow-xs">
        <AlertTriangle className="mx-auto h-12 w-12 text-red-600 mb-3" />
        <h2 className="font-serif text-2xl font-bold text-neutral-dark mb-2">Vakansiya tapılmadı</h2>
        <p className="text-sm text-neutral-dark/70 mb-6">{error}</p>
        <Link
          href="/business/vacancies"
          className="inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all"
        >
          <ArrowLeft className="h-4 w-4" /> Vakansiyalara qayıt
        </Link>
      </div>
    );
  }

  if (!values) return null;

  return (
    <VacancyForm
      mode="edit"
      vacancyId={id}
      initialValues={values}
      hasApplications={applicationCount !== null && applicationCount > 0}
      applicationsUnknown={applicationCount === null}
      plansEnabled={plansEnabled}
    />
  );
}
