'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, ArrowUp, ArrowDown, AlertTriangle, Briefcase, DollarSign, FileText, HelpCircle } from 'lucide-react';
import { blockNegativeAndExponentKeys } from '@/lib/number-input';
import {
  EXPERIENCE_LEVELS,
  WORK_FORMATS,
  EMPLOYMENT_TYPES,
  QUESTION_TYPES,
} from '@/lib/vacancy-labels';

export type QuestionDraft = {
  label: string;
  type: string;
  required: boolean;
  options: string[];
};

export type VacancyFormValues = {
  title: string;
  description: string;
  responsibilities: string;
  requirements: string;
  skills: string;
  experienceLevel: string;
  salaryMin: string;
  salaryMax: string;
  location: string;
  workArrangement: string;
  employmentType: string;
  deadline: string;
  /** Where the employer wants to be told about new applications (empty = only in the AISE inbox). */
  applicationEmail?: string;
  questions: QuestionDraft[];
};

export const EMPTY_VACANCY: VacancyFormValues = {
  title: '',
  description: '',
  responsibilities: '',
  requirements: '',
  skills: '',
  experienceLevel: 'Junior',
  salaryMin: '',
  salaryMax: '',
  location: '',
  workArrangement: 'On-site',
  employmentType: 'Full-time',
  deadline: '',
  applicationEmail: '',
  questions: [],
};

const FIELD_CLASS =
  'block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm';
const LABEL_CLASS = 'block text-sm font-medium text-neutral-dark mb-1';

async function readError(res: Response): Promise<string> {
  if (res.status === 409) {
    return 'Bu vakansiyaya artıq müraciət daxil olduğu üçün sualları dəyişmək mümkün deyil.';
  }
  try {
    const body = await res.json();
    if (Array.isArray(body?.message)) return body.message.join('. ');
    if (typeof body?.message === 'string') return body.message;
  } catch {
    // fall through
  }
  return `Serverdə xəta baş verdi (${res.status}).`;
}

export function VacancyForm({
  mode,
  vacancyId,
  initialValues,
  hasApplications = false,
  applicationsUnknown = false,
  plansEnabled = false,
}: {
  mode: 'create' | 'edit';
  vacancyId?: string;
  initialValues?: VacancyFormValues;
  hasApplications?: boolean;
  /** The application count could not be read: questions stay locked (never assume zero) and the form says why. */
  applicationsUnknown?: boolean;
  /** Employer plans are on (reported by the server): a saved vacancy is a draft until it is reviewed and published. */
  plansEnabled?: boolean;
}) {
  const questionsLocked = hasApplications || applicationsUnknown;
  const router = useRouter();
  const errorRef = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<VacancyFormValues>(
    initialValues ?? EMPTY_VACANCY,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof VacancyFormValues>(
    key: K,
    value: VacancyFormValues[K],
  ) => setValues((v) => ({ ...v, [key]: value }));

  const { questions } = values;

  const addQuestion = () => {
    if (questionsLocked) return;
    set('questions', [
      ...questions,
      { label: '', type: 'SHORT_TEXT', required: false, options: [] },
    ]);
  };

  const updateQuestion = (index: number, patch: Partial<QuestionDraft>) => {
    if (questionsLocked) return;
    set(
      'questions',
      questions.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    );
  };

  const removeQuestion = (index: number) => {
    if (questionsLocked) return;
    set(
      'questions',
      questions.filter((_, i) => i !== index),
    );
  };

  const moveQuestion = (index: number, dir: number) => {
    if (questionsLocked) return;
    const target = index + dir;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[index], next[target]] = [next[target], next[index]];
    set('questions', next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!values.title.trim()) {
      setError('Vakansiya başlığı mütləqdir.');
      errorRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    if (!questionsLocked) {
      const unlabelled = questions.findIndex((q) => !q.label.trim());
      if (unlabelled !== -1) {
        setError(`${unlabelled + 1}-ci sualın mətni boş qala bilməz.`);
        errorRef.current?.scrollIntoView({ behavior: 'smooth' });
        return;
      }

      const emptyChoice = questions.findIndex(
        (q) =>
          q.type === 'MULTIPLE_CHOICE' &&
          q.options.map((o) => o.trim()).filter(Boolean).length === 0,
      );
      if (emptyChoice !== -1) {
        setError(`${emptyChoice + 1}-ci çoxvariantlı sual üçün ən azı bir seçim variantı daxil edin.`);
        errorRef.current?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }

    const min = values.salaryMin ? Number(values.salaryMin) : undefined;
    const max = values.salaryMax ? Number(values.salaryMax) : undefined;

    if (min !== undefined && min < 0) {
      setError('Minimum maaş mənfi ola bilməz.');
      errorRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (max !== undefined && max < 0) {
      setError('Maksimum maaş mənfi ola bilməz.');
      errorRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (min !== undefined && max !== undefined && min > max) {
      setError('Minimum maaş maksimum maaşdan böyük ola bilməz.');
      errorRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    setLoading(true);
    setError(null);

    // Omit questions when questionsLocked is true to avoid ConflictException on update
    const payload: Record<string, unknown> = {
      title: values.title.trim(),
      description: values.description?.trim() || undefined,
      responsibilities: values.responsibilities?.trim() || undefined,
      requirements: values.requirements?.trim() || undefined,
      skills: values.skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      experienceLevel: values.experienceLevel,
      salaryMin: min,
      salaryMax: max,
      location: values.location?.trim() || undefined,
      workArrangement: values.workArrangement,
      employmentType: values.employmentType,
      deadline: values.deadline
        ? new Date(values.deadline).toISOString()
        : undefined,
      // '' clears a saved address on edit; on create the server ignores it.
      applicationEmail: (values.applicationEmail ?? '').trim(),
    };

    if (!questionsLocked) {
      payload.questions = questions.map((q, order) => ({
        label: q.label.trim(),
        type: q.type,
        required: q.required,
        order,
        options:
          q.type === 'MULTIPLE_CHOICE'
            ? q.options
                .map((label) => label.trim())
                .filter(Boolean)
                .map((label, optionOrder) => ({ label, order: optionOrder }))
            : [],
      }));
    }

    try {
      const res = await fetch(
        mode === 'create'
          ? '/api/business/vacancies'
          : `/api/business/vacancies/${vacancyId}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        throw new Error(await readError(res));
      }

      router.push('/business/vacancies');
    } catch (err) {
      // Preserve entered values and show error
      setError(err instanceof Error ? err.message : 'Xəta baş verdi.');
      setLoading(false);
      errorRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-12">
      <div>
        <h1 className="font-serif text-3xl font-bold text-neutral-dark">
          {mode === 'create' ? 'Yeni vakansiya yerləşdir' : 'Vakansiyanı redaktə et'}
        </h1>
        <p className="mt-2 text-sm text-neutral-dark/70">
          {mode === 'create'
            ? 'Vakansiya məlumatlarını dolduraraq uyğun namizədləri qəbul etməyə başlayın.'
            : 'Vakansiya detallarını yeniləyin. Bütün dəyişikliklər dərhal qüvvəyə minir.'}
        </p>
        {plansEnabled && (
          <p role="note" className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs sm:text-sm text-sky-900">
            {mode === 'create'
              ? 'Yadda saxladıqdan sonra vakansiya qaralama olaraq qalır. Siyahıda “Yoxlamaya göndər” deyin; AISE təsdiqləyəndən sonra “Yayımla” ilə yayımlanır. Yoxlama mərhələsində sınaq və ya ödəniş işlənmir.'
              : 'Təsdiqlənmiş, lakin hələ yayımlanmamış vakansiyanın mətni dəyişərsə, o, yenidən qaralamaya düşür və yoxlamaya göndərilməlidir. Yayımlanmış vakansiyada düzəlişlər dərhal görünür.'}
          </p>
        )}
      </div>

      {error && (
        <div
          ref={errorRef}
          role="alert"
          className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-800 flex items-start gap-3 shadow-xs"
        >
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Məlumatlar yadda saxlanılmadı</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8" noValidate={false}>
        {/* Qrup 1: Əsas məlumatlar */}
        <div className="rounded-2xl bg-background border border-neutral-dark/10 p-6 shadow-xs space-y-6">
          <div className="flex items-center gap-2 border-b border-neutral-dark/10 pb-3">
            <Briefcase className="h-5 w-5 text-primary" />
            <h2 className="font-serif text-lg font-bold text-neutral-dark">Əsas məlumatlar</h2>
          </div>

          <div>
            <label htmlFor="v-title" className={LABEL_CLASS}>
              Vakansiya başlığı *
            </label>
            <input
              id="v-title"
              type="text"
              placeholder="məs. Senior Frontend Developer"
              value={values.title}
              onChange={(e) => set('title', e.target.value)}
              required
              className={FIELD_CLASS}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="v-format" className={LABEL_CLASS}>
                İş formatı
              </label>
              <select
                id="v-format"
                value={values.workArrangement}
                onChange={(e) => set('workArrangement', e.target.value)}
                className={FIELD_CLASS}
              >
                {WORK_FORMATS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="v-employment" className={LABEL_CLASS}>
                Məşğulluq növü
              </label>
              <select
                id="v-employment"
                value={values.employmentType}
                onChange={(e) => set('employmentType', e.target.value)}
                className={FIELD_CLASS}
              >
                {EMPLOYMENT_TYPES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="v-exp" className={LABEL_CLASS}>
                Təcrübə səviyyəsi
              </label>
              <select
                id="v-exp"
                value={values.experienceLevel}
                onChange={(e) => set('experienceLevel', e.target.value)}
                className={FIELD_CLASS}
              >
                {EXPERIENCE_LEVELS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="v-location" className={LABEL_CLASS}>
                Şəhər / Məkan
              </label>
              <input
                id="v-location"
                type="text"
                placeholder="məs. Bakı"
                value={values.location}
                onChange={(e) => set('location', e.target.value)}
                className={FIELD_CLASS}
              />
            </div>
          </div>
        </div>

        {/* Qrup 2: Maaş və Müraciət müddəti */}
        <div className="rounded-2xl bg-background border border-neutral-dark/10 p-6 shadow-xs space-y-6">
          <div className="flex items-center gap-2 border-b border-neutral-dark/10 pb-3">
            <DollarSign className="h-5 w-5 text-primary" />
            <h2 className="font-serif text-lg font-bold text-neutral-dark">Maaş və müddət</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label htmlFor="v-min" className={LABEL_CLASS}>
                Minimum maaş (₼)
              </label>
              <input
                id="v-min"
                type="number"
                min={0}
                placeholder="məs. 1500"
                value={values.salaryMin}
                onKeyDown={blockNegativeAndExponentKeys}
                onChange={(e) => set('salaryMin', e.target.value)}
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label htmlFor="v-max" className={LABEL_CLASS}>
                Maksimum maaş (₼)
              </label>
              <input
                id="v-max"
                type="number"
                min={0}
                placeholder="məs. 2500"
                value={values.salaryMax}
                onKeyDown={blockNegativeAndExponentKeys}
                onChange={(e) => set('salaryMax', e.target.value)}
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label htmlFor="v-deadline" className={LABEL_CLASS}>
                Son müraciət tarixi
              </label>
              <input
                id="v-deadline"
                type="date"
                value={values.deadline}
                onChange={(e) => set('deadline', e.target.value)}
                className={FIELD_CLASS}
              />
              <p className="mt-1 text-xs text-neutral-dark/60">Boş saxlandıqda müddətsiz sayılır</p>
            </div>

            <div className="md:col-span-2">
              <label htmlFor="v-application-email" className={LABEL_CLASS}>
                Yeni müraciət bildirişi üçün e-poçt (ixtiyari)
              </label>
              <input
                id="v-application-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="məs. kadr@sirket.az"
                value={values.applicationEmail ?? ''}
                onChange={(e) => set('applicationEmail', e.target.value)}
                className={FIELD_CLASS}
                maxLength={254}
              />
              <p className="mt-1 text-xs text-neutral-dark/60">
                Namizəd müraciət etdikdə bu ünvana xəbərdarlıq gedir. Məktubda yalnız AISE müraciət qutusuna keçid olur; CV və əlaqə məlumatları e-poçtla göndərilmir.
                Boş saxlasanız, müraciətlər yalnız AISE müraciət qutunuzda görünür.
              </p>
            </div>
          </div>
        </div>

        {/* Qrup 3: Tələblər və Təsvir */}
        <div className="rounded-2xl bg-background border border-neutral-dark/10 p-6 shadow-xs space-y-6">
          <div className="flex items-center gap-2 border-b border-neutral-dark/10 pb-3">
            <FileText className="h-5 w-5 text-primary" />
            <h2 className="font-serif text-lg font-bold text-neutral-dark">Tələblər və təsvir</h2>
          </div>

          <div>
            <label htmlFor="v-skills" className={LABEL_CLASS}>
              Tələb olunan bacarıqlar (vergüllə ayırın)
            </label>
            <input
              id="v-skills"
              type="text"
              placeholder="məs. TypeScript, React, Tailwind CSS, REST API"
              value={values.skills}
              onChange={(e) => set('skills', e.target.value)}
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label htmlFor="v-desc" className={LABEL_CLASS}>
              Vəzifə haqqında ümumi təsvir
            </label>
            <textarea
              id="v-desc"
              placeholder="Vakansiya və komanda haqqında ümumi məlumat..."
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              rows={4}
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label htmlFor="v-resp" className={LABEL_CLASS}>
              Vəzifə öhdəlikləri
            </label>
            <textarea
              id="v-resp"
              placeholder="İşçinin icra edəcəyi əsas vəzifələr və məsuliyyətlər..."
              value={values.responsibilities}
              onChange={(e) => set('responsibilities', e.target.value)}
              rows={4}
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label htmlFor="v-req" className={LABEL_CLASS}>
              Namizədə tələblər
            </label>
            <textarea
              id="v-req"
              placeholder="Təhsil, təcrübə və dil tələbləri..."
              value={values.requirements}
              onChange={(e) => set('requirements', e.target.value)}
              rows={4}
              className={FIELD_CLASS}
            />
          </div>
        </div>

        {/* Qrup 4: Xüsusi müraciət sualları */}
        <div className="rounded-2xl bg-background border border-neutral-dark/10 p-6 shadow-xs space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-dark/10 pb-3">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-primary" />
              <h2 className="font-serif text-lg font-bold text-neutral-dark">
                Müraciət sualları
              </h2>
            </div>
            {!questionsLocked && (
              <button
                type="button"
                onClick={addQuestion}
                className="tap inline-flex items-center gap-2 rounded-xl bg-background border border-neutral-dark/20 py-1.5 px-3 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all"
              >
                <Plus className="h-4 w-4" /> Sual əlavə et
              </button>
            )}
          </div>

          {questionsLocked && (
            <div role="status" className="rounded-xl bg-amber-50/90 border border-amber-200/90 p-4 text-xs sm:text-sm text-amber-900 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Müraciət sualları dondurulub</p>
                <p className="mt-0.5 text-amber-800">
                  {applicationsUnknown && !hasApplications
                    ? 'Bu vakansiyaya daxil olan müraciətlərin sayı yüklənmədi. Namizədlərin cavablarını qorumaq üçün suallar müvəqqəti dəyişdirilə bilməz; səhifəni yeniləyin. Digər məlumatları (başlıq, təsvir, tələblər, maaş və s.) redaktə edə bilərsiniz.'
                    : 'Bu vakansiyaya artıq namizəd müraciəti daxil olduğu üçün mövcud suallar dəyişdirilə bilməz. Digər məlumatları (başlıq, təsvir, tələblər, maaş və s.) sərbəst redaktə edə bilərsiniz.'}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {questions.map((q, idx) => (
              <div
                key={idx}
                className={`p-4 border rounded-xl relative transition-all ${
                  questionsLocked
                    ? 'border-neutral-dark/10 bg-neutral-100/50 opacity-80'
                    : 'border-neutral-dark/15 bg-background-warm/15'
                }`}
              >
                <div className="flex flex-col sm:flex-row justify-between items-start gap-3 mb-4">
                  <div className="flex-1 w-full">
                    <input
                      type="text"
                      placeholder="Sual mətni"
                      aria-label={`${idx + 1}-ci sualın mətni`}
                      value={q.label}
                      disabled={questionsLocked}
                      onChange={(e) =>
                        updateQuestion(idx, { label: e.target.value })
                      }
                      className={FIELD_CLASS}
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                    <select
                      value={q.type}
                      disabled={questionsLocked}
                      aria-label={`${idx + 1}-ci sualın növü`}
                      onChange={(e) =>
                        updateQuestion(idx, { type: e.target.value })
                      }
                      className="rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm disabled:opacity-60"
                    >
                      {QUESTION_TYPES.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {!questionsLocked && (
                      <>
                        <button
                          type="button"
                          onClick={() => moveQuestion(idx, -1)}
                          disabled={idx === 0}
                          aria-label="Yuxarı daşı"
                          className="p-2 text-neutral-dark/60 hover:text-primary disabled:opacity-25 transition-colors"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveQuestion(idx, 1)}
                          disabled={idx === questions.length - 1}
                          aria-label="Aşağı daşı"
                          className="p-2 text-neutral-dark/60 hover:text-primary disabled:opacity-25 transition-colors"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeQuestion(idx)}
                          aria-label="Sualı sil"
                          className="p-2 text-neutral-dark/60 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`req-${idx}`}
                    disabled={questionsLocked}
                    checked={q.required}
                    onChange={(e) =>
                      updateQuestion(idx, { required: e.target.checked })
                    }
                    className="rounded text-primary focus:ring-primary h-4 w-4"
                  />
                  <label htmlFor={`req-${idx}`} className="text-sm text-neutral-dark select-none">
                    Məcburi cavablandırılmalıdır
                  </label>
                </div>

                {q.type === 'MULTIPLE_CHOICE' && (
                  <div className="mt-4">
                    <label className="block text-xs font-medium text-neutral-dark/70 mb-1">
                      Variantlar (vergüllə ayırın)
                    </label>
                    <input
                      type="text"
                      placeholder="Variant A, Variant B, Variant C"
                      aria-label={`${idx + 1}-ci sualın seçimləri`}
                      value={q.options.join(', ')}
                      disabled={questionsLocked}
                      onChange={(e) =>
                        updateQuestion(idx, {
                          options: e.target.value.split(','),
                        })
                      }
                      className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2 px-3 text-neutral-dark text-sm disabled:opacity-60"
                    />
                  </div>
                )}
              </div>
            ))}

            {questions.length === 0 && (
              <p className="text-sm text-neutral-dark/65 text-center py-6 border border-dashed border-neutral-dark/15 rounded-xl">
                Bu vakansiya üçün əlavə xüsusi sual təyin edilməyib.
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="tap-inline rounded-full bg-background border border-neutral-dark/20 py-2.5 px-6 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all"
          >
            Ləğv et
          </button>
          <button
            type="submit"
            disabled={loading}
            className="product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50 transition-all"
          >
            {loading ? 'Yadda saxlanılır...' : 'Yadda saxla'}
          </button>
        </div>
      </form>
    </div>
  );
}
