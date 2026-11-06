'use client';

import React, { use, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, CheckCircle, AlertCircle, Upload, FileText, User } from 'lucide-react';
import { apiFetch } from '@/lib/api';

export default function ApplyPage({ params }: { params: Promise<{ id: string, vacancyId: string }> }) {
  const { id, vacancyId } = use(params);
  const router = useRouter();
  const [vacancy, setVacancy] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [alreadyApplied, setAlreadyApplied] = useState(false);
  const [isReapplying, setIsReapplying] = useState(false);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [resumes, setResumes] = useState<any[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const submitInFlight = useRef(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [vacancyRes, profileRes, applicationsRes, resumesRes] = await Promise.all([
          apiFetch(`/vacancies/${vacancyId}`),
          apiFetch('/profile'),
          apiFetch('/dashboard/applications'),
          apiFetch('/resumes'),
        ]);

        if (!vacancyRes.ok) throw new Error('Vakansiya tapılmadı');

        const vacancyData = await vacancyRes.json();
        setVacancy(vacancyData);

        if (profileRes.ok) {
          const profileData = await profileRes.json();
          setProfile(profileData);
        }

        if (applicationsRes.ok) {
          const applications = await applicationsRes.json();
          const existing = Array.isArray(applications) ? applications.find((a: any) => a.vacancyId === vacancyId) : null;
          if (existing) {
            if (existing.status === 'REJECTED') {
              setIsReapplying(true);
            } else if (existing.status !== 'APPLIED') {
              setAlreadyApplied(true);
            }
          }
        }
        if (resumesRes.ok) {
          const rows = await resumesRes.json();
          const usable = Array.isArray(rows) ? rows.filter((r: any) =>
            r.status === 'READY' && r.fileUrl && (r.isBase || r.reviewedAt)) : [];
          setResumes(usable);
          setSelectedResumeId(usable.find((r: any) => r.isBase)?.id || usable[0]?.id || '');
        }
      } catch (err: any) {
        setError(err.message || 'Məlumatları yükləyərkən xəta baş verdi');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [vacancyId]);

  const handleInputChange = (questionId: string, value: any) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleFileChange = (questionId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFiles(prev => ({ ...prev, [questionId]: e.target.files![0] }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitInFlight.current || alreadyApplied || success) return;
    submitInFlight.current = true;
    setSubmitting(true);
    setError(null);

    try {
      if (!selectedResumeId) throw new Error('Göndərmək üçün təsdiqlənmiş CV seçin.');
      const finalAnswers: { questionId: string, value: string }[] = [];

      for (const q of vacancy.questions) {
        let value = answers[q.id];

        if (q.type === 'FILE_UPLOAD' && files[q.id]) value = files[q.id].name;

        if (q.required && !value && value !== false && value !== 0) {
          throw new Error('Zəhmət olmasa bütün vacib sahələri doldurun');
        }

        if (value !== undefined && q.type !== 'FILE_UPLOAD') {
          finalAnswers.push({
            questionId: q.id,
            value: String(value)
          });
        }
      }

      const formData = new FormData();
      formData.append('resumeId', selectedResumeId);
      formData.append('answers', JSON.stringify(finalAnswers));
      const fileQuestionIds = vacancy.questions
        .filter((q: any) => q.type === 'FILE_UPLOAD' && files[q.id])
        .map((q: any) => q.id);
      formData.append('fileQuestionIds', JSON.stringify(fileQuestionIds));
      for (const questionId of fileQuestionIds) formData.append('files', files[questionId]);

      let applyRes: Response;
      try {
        applyRes = await apiFetch(`/vacancies/${vacancyId}/apply`, {
          method: 'POST',
          body: formData,
        });
      } catch {
        throw new Error('Serverlə əlaqə kəsildi, müraciət göndərilmədi. Bağlantını yoxlayıb yenidən cəhd edin.');
      }

      if (!applyRes.ok) {
        if (applyRes.status === 401) throw new Error('Sessiyanız bitib. Yenidən daxil olun və müraciəti təkrar yoxlayın.');
        if (applyRes.status === 409) throw new Error('Bu vakansiyaya artıq müraciət etmisiniz.');
        // 400/404 carry the API's own Azerbaijani reason (expired vacancy,
        // missing required answer, CV not approved or not found).
        if (applyRes.status === 400 || applyRes.status === 404) {
          const body = await applyRes.json().catch(() => null);
          const reason = typeof body?.message === 'string' ? body.message : null;
          throw new Error(reason || 'Müraciət müddəti bitmişdir və ya müraciət forması səhvdir.');
        }
        throw new Error('Müraciət göndərilərkən xəta baş verdi. Yenidən cəhd edin.');
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Gözlənilməz xəta baş verdi');
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20 text-neutral-dark/50">Yüklənir...</div>;
  }

  if (success) {
    return (
      <div className="max-w-2xl mx-auto py-10 animate-in fade-in duration-500">
        <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 shadow-xs p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mb-6">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="font-serif text-2xl font-bold text-neutral-dark mb-2">Müraciətiniz göndərildi!</h2>
          <p className="text-neutral-dark/75 mb-8">
            Uğurlar! Müraciətiniz şirkətə çatdırıldı. Şirkətin qərarını gözləyin. Nəticələri «Müraciətlərim» bölməsindən izləyə bilərsiniz.
          </p>
          <Link
            href={`/dashboard/companies/${id}`}
            className="inline-flex items-center justify-center product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all"
          >
            Şirkətə qayıt
          </Link>
        </div>
      </div>
    );
  }

  if (alreadyApplied) {
    return (
      <div className="max-w-2xl mx-auto py-10 animate-in fade-in duration-500">
        <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 shadow-xs p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mb-6">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="font-serif text-2xl font-bold text-neutral-dark mb-2">Artıq müraciət etmisiniz</h2>
          <p className="text-neutral-dark/75 mb-8">
            Bu vakansiyaya müraciətinizi artıq göndərmisiniz. Nəticələri «Müraciətlərim» bölməsindən izləyə bilərsiniz.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/dashboard/applications"
              className="inline-flex items-center justify-center product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all"
            >
              Müraciətlərim
            </Link>
            <Link
              href={`/dashboard/companies/${id}`}
              className="tap inline-flex items-center justify-center rounded-xl border border-neutral-dark/20 py-2.5 px-6 text-sm font-semibold text-neutral-dark hover:bg-background-warm/40 transition-all"
            >
              Şirkətə qayıt
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!vacancy) {
    return <div className="text-center py-20">Vakansiya tapılmadı</div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Link href={`/dashboard/companies/${id}/vacancies/${vacancyId}`} className="inline-flex items-center text-sm font-medium text-neutral-dark/65 hover:text-neutral-dark transition-colors mb-2">
        <ChevronLeft className="h-4 w-4 mr-1" />
        Vakansiyaya qayıt
      </Link>

      <div>
        <h1 className="font-serif text-2xl md:text-3xl font-bold text-neutral-dark mb-2">
          {vacancy.title} vakansiyasına müraciət
        </h1>
        <p className="text-neutral-dark/65">{vacancy.company?.name}</p>
      </div>

      {isReapplying && (
        <div role="status" className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3 text-amber-900">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-amber-700" />
          <div className="text-sm">
            <span className="font-bold">Yenidən müraciət edirsiniz:</span> Əvvəlki müraciətiniz rədd edilmişdir. Zəhmət olmasa yenilənmiş CV və məlumatlarınızı nəzərdən keçirib təsdiqləyin.
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 border border-red-200 p-4 flex items-start gap-3 text-red-800">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 shadow-xs p-6">
          <label htmlFor="application-resume" className="block font-serif text-xl font-bold text-neutral-dark mb-3">Göndəriləcək CV</label>
          <p className="text-sm text-neutral-dark/65 mb-3">Şirkət seçdiyiniz CV-nin müraciət anındakı surətini alacaq. Sonrakı düzəlişlər bu müraciəti dəyişməyəcək.</p>
          {resumes.length ? (
            <select id="application-resume" value={selectedResumeId} onChange={(e) => setSelectedResumeId(e.target.value)} className="w-full rounded-xl border border-neutral-dark/20 bg-background p-3" required>
              {resumes.map((resume: any) => <option key={resume.id} value={resume.id}>{resume.isBase ? 'Əsas CV' : 'Təsdiqlənmiş uyğunlaşdırılmış CV'} · {new Date(resume.createdAt).toLocaleDateString('az-AZ')}</option>)}
            </select>
          ) : <p className="text-sm text-red-700">Göndərilə bilən CV yoxdur. Əvvəl CV yükləyin və ya uyğunlaşdırılmış CV-ni təsdiqləyin.</p>}
          <Link href="/dashboard/resumes" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">CV-lərimə bax</Link>
        </div>
        <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 shadow-xs p-6">
          <h2 className="font-serif text-xl font-bold text-neutral-dark mb-4 flex items-center gap-2">
            <User className="h-5 w-5 text-accent" />
            Profiliniz
          </h2>
          <p className="text-sm text-neutral-dark/65 mb-6">
            Bu məlumatlar müraciətinizlə birlikdə şirkətə göndəriləcək.
          </p>
          
          <div className="bg-background-warm/30 rounded-xl p-5 border border-neutral-dark/10 space-y-4">
            <div>
              <p className="text-xs text-neutral-dark/50 font-medium uppercase tracking-wider mb-1">Ad və soyad</p>
              <p className="font-medium text-neutral-dark">{profile?.name || 'Göstərilməyib'}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-dark/50 font-medium uppercase tracking-wider mb-1">E-poçt</p>
              <p className="font-medium text-neutral-dark">{profile?.email}</p>
            </div>
            {profile?.headline && (
              <div>
                <p className="text-xs text-neutral-dark/50 font-medium uppercase tracking-wider mb-1">Başlıq</p>
                <p className="font-medium text-neutral-dark">{profile.headline}</p>
              </div>
            )}
            {profile?.location && (
              <div>
                <p className="text-xs text-neutral-dark/50 font-medium uppercase tracking-wider mb-1">Məkan</p>
                <p className="font-medium text-neutral-dark">{profile.location}</p>
              </div>
            )}
            <div className="pt-2">
              <Link href="/dashboard/profile" target="_blank" className="text-xs font-semibold text-accent hover:underline">
                Profilə bax və ya düzəliş et &rarr;
              </Link>
            </div>
          </div>
        </div>

        {vacancy.questions && vacancy.questions.length > 0 && (
          <div className="product-card rounded-2xl bg-background border border-neutral-dark/5 shadow-xs p-6">
            <h2 className="font-serif text-xl font-bold text-neutral-dark mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-accent" />
              Şirkətin sualları
            </h2>
            <p className="text-sm text-neutral-dark/65 mb-6">
              Zəhmət olmasa aşağıdakı sualları cavablandırın.
            </p>
            
            <div className="space-y-6">
              {vacancy.questions.map((q: any) => (
                <div key={q.id}>
                  {q.type !== 'YES_NO' && (
                    <label htmlFor={`question-${q.id}`} className="block text-sm font-medium text-neutral-dark mb-2">
                      {q.label}
                      {q.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                  )}
                  
                  {q.type === 'SHORT_TEXT' && (
                    <input
                      id={`question-${q.id}`}
                      type="text"
                      required={q.required}
                      onChange={(e) => handleInputChange(q.id, e.target.value)}
                      className="w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                    />
                  )}
                  
                  {q.type === 'LONG_TEXT' && (
                    <textarea
                      id={`question-${q.id}`}
                      required={q.required}
                      rows={4}
                      onChange={(e) => handleInputChange(q.id, e.target.value)}
                      className="w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                    />
                  )}
                  
                  {q.type === 'YES_NO' && (
                    <fieldset>
                      <legend className="block text-sm font-medium text-neutral-dark mb-2">
                        {q.label}{q.required && <span className="text-red-500 ml-1">*</span>}
                      </legend>
                      <div className="flex gap-4">
                      <label className="tap flex items-center gap-2">
                        <input
                          type="radio"
                          name={q.id}
                          value="true"
                          required={q.required}
                          onChange={() => handleInputChange(q.id, 'true')}
                          className="text-primary focus:ring-primary"
                        />
                        <span className="text-sm">Bəli</span>
                      </label>
                      <label className="tap flex items-center gap-2">
                        <input
                          type="radio"
                          name={q.id}
                          value="false"
                          required={q.required}
                          onChange={() => handleInputChange(q.id, 'false')}
                          className="text-primary focus:ring-primary"
                        />
                        <span className="text-sm">Xeyr</span>
                      </label>
                      </div>
                    </fieldset>
                  )}
                  
                  {q.type === 'MULTIPLE_CHOICE' && q.options && (
                    <select
                      id={`question-${q.id}`}
                      required={q.required}
                      onChange={(e) => handleInputChange(q.id, e.target.value)}
                      className="w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                    >
                      <option value="">Seçin...</option>
                      {q.options.map((opt: any) => (
                        <option key={opt.id} value={opt.label}>{opt.label}</option>
                      ))}
                    </select>
                  )}
                  
                  {q.type === 'NUMBER' && (
                    <input
                      id={`question-${q.id}`}
                      type="number"
                      required={q.required}
                      onChange={(e) => handleInputChange(q.id, e.target.value)}
                      className="w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark focus:ring-2 focus:ring-primary focus:border-transparent transition-all sm:text-sm"
                    />
                  )}
                  
                  {q.type === 'FILE_UPLOAD' && (
                    <div className="relative">
                      <input
                        id={`question-${q.id}`}
                        type="file"
                        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        required={q.required}
                        onChange={(e) => handleFileChange(q.id, e)}
                        className="block w-full text-sm text-neutral-dark/70
                          file:mr-4 file:py-2 file:px-4
                          file:rounded-xl file:border-0
                          file:text-sm file:font-semibold
                          file:bg-primary/10 file:text-primary
                          hover:file:bg-primary/20 cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col items-end gap-2 pt-4">
          {!selectedResumeId && (
            <p id="apply-missing" className="text-xs text-neutral-dark/70">Müraciət etmək üçün yuxarıda bir CV seçin.</p>
          )}
          <button
            type="submit"
            aria-describedby={!selectedResumeId ? 'apply-missing' : undefined}
            disabled={submitting || !selectedResumeId}
            className="product-action rounded-full bg-primary py-3 px-8 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50 transition-all flex items-center gap-2"
          >
            {submitting ? 'Göndərilir...' : 'Müraciət et'}
          </button>
        </div>
      </form>
    </div>
  );
}
