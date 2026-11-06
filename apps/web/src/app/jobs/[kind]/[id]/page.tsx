import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Briefcase, MapPin, Clock, Calendar } from 'lucide-react';
import { SiteNav } from '@/components/landing/site-nav';
import { SiteFooter } from '@/components/landing/site-footer';
import { catalogueDate, externalJobUrl, factLabel, fetchCatalogue, sourceLabel, unconfirmedDays, type CatalogueDetail } from '@/lib/job-catalogue';
import { experienceLevelLabel, workFormatLabel } from '@/lib/vacancy-labels';
import { EmailApplyCta } from '@/components/email-apply-cta';
import { SaveJobButton } from '@/components/retention/save-job-button';
import { JobSkillGuidance } from '@/components/job-skill-guidance';

export default async function JobDetailPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!['imported', 'native'].includes(kind)) notFound();
  const response = await fetchCatalogue(`/jobs/${kind}/${encodeURIComponent(id)}`);
  if (response?.status === 404) notFound();
  const job: CatalogueDetail | null = response?.ok ? await response.json().catch(() => null) : null;
  // The e-mail application is promised only when this deployment has it switched on (the public status says so); unreadable counts as off.
  const statusResponse = await fetchCatalogue('/billing/status');
  const emailApplicationsOn = !!(statusResponse?.ok && (await statusResponse.json().catch(() => null))?.emailApplicationsEnabled === true);
  const url = job ? externalJobUrl(job.url) : null;

  return (
    <div className="grow bg-background text-on-background">
      <SiteNav />
      <main className="mx-auto max-w-4xl px-4 pb-16 pt-32 sm:px-6">
        <Link
          href="/jobs"
          className="mb-6 inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-accent hover:bg-surface-container transition-colors"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>Bütün vakansiyalar</span>
        </Link>

        {!job ? (
          <p role="alert" className="rounded-2xl border border-outline-variant p-6">
            Vakansiya hazırda yüklənə bilmir. Bir az sonra yenidən yoxlayın.
          </p>
        ) : (
          <article className="rounded-2xl border border-outline-variant bg-background">
            {/* Header section */}
            <header className="border-b border-outline-variant p-5 sm:p-8">
              <p className="mb-2 text-sm text-on-surface-variant">{job.categoryLabel} · {sourceLabel(job.source)}</p>
              <h1 className="product-page-title break-words text-3xl font-medium">{job.title}</h1>
              <div className="mt-4 flex flex-col gap-2 text-sm text-on-surface-variant sm:flex-row sm:flex-wrap sm:gap-4">
                <span className="inline-flex items-center gap-1.5"><Briefcase aria-hidden="true" className="h-4 w-4 shrink-0" />{job.company}</span>
                {job.location && <span className="inline-flex items-center gap-1.5"><MapPin aria-hidden="true" className="h-4 w-4 shrink-0" />{job.location}</span>}
              </div>
              <dl className="mt-4 grid gap-2 text-sm text-on-surface-variant sm:grid-cols-2">
                <div className="inline-flex items-center gap-1.5">
                  <Clock aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <dt className="font-medium">İş formatı:</dt>
                  <dd>{factLabel(job.workArrangement, workFormatLabel)}</dd>
                </div>
                <div className="inline-flex items-center gap-1.5">
                  <Calendar aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <dt className="font-medium">Təcrübə:</dt>
                  <dd>{factLabel(job.experienceLevel, experienceLevelLabel)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-on-surface-variant">
                Elan tarixi: {catalogueDate(job.postedAt)}{job.deadline ? ` · Son tarix: ${catalogueDate(job.deadline)}` : ' · Son tarix göstərilməyib'}
              </p>
              {job.deadlineConflict && (
                <p className="mt-2 rounded-lg bg-surface-container p-3 text-sm" role="note">
                  Mənbənin özündə iki fərqli son tarix var; ən erkən tarix göstərilir. Müraciətdən əvvəl mənbə elanını yoxlayın.
                </p>
              )}
              {job.kind === 'imported' && job.checkedAt && (
                <p className="mt-2 text-xs text-on-surface-variant">Mənbədə son yoxlanış: {catalogueDate(job.checkedAt)}</p>
              )}
              {job.kind === 'imported' && unconfirmedDays(job.checkedAt) > 0 && (
                <p className="mt-2 rounded-lg bg-surface-container p-3 text-sm" role="note" data-testid="unconfirmed-note">
                  Bu elan mənbədə {unconfirmedDays(job.checkedAt)} gündür təsdiqlənməyib. Hələ də açıq olduğuna əmin olmaq üçün müraciətdən əvvəl mənbə elanını yoxlayın.
                </p>
              )}
            </header>

            {/* Application method section */}
            <section className="border-b border-outline-variant p-5 sm:p-8" aria-labelledby="apply-heading">
              <h2 id="apply-heading" className="mb-4 text-xl font-semibold">Müraciət et</h2>
              <div className="flex flex-wrap gap-3">
                {job.kind === 'native' && job.companyId ? (
                  <Link
                    href={`/dashboard/companies/${encodeURIComponent(job.companyId)}/vacancies/${encodeURIComponent(job.id)}/apply`}
                    className="min-h-11 product-action rounded-full bg-accent px-5 py-3 font-medium text-white"
                  >
                    AISE-də müraciət et
                  </Link>
                ) : url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-11 product-action rounded-full bg-accent px-5 py-3 font-medium text-white"
                  >
                    {job.applicationMethod === 'EMAIL' ? 'Mənbədə elana bax ↗' : 'Mənbədə bax və müraciət et ↗'}
                  </a>
                ) : (
                  <p className="rounded-lg border border-outline-variant px-4 py-3 text-sm text-on-surface-variant">
                    Mənbə keçidi əlçatan deyil.
                  </p>
                )}
                <Link href="/dashboard/matches" className="min-h-11 rounded-xl border border-outline-variant px-5 py-3">
                  Uyğunluqlarımı gör
                </Link>
                <SaveJobButton job={{ key: `${job.kind}:${job.id}`, title: job.title, company: job.company, location: job.location ?? null, deadline: job.deadline ?? null }} />

              </div>
              {job.kind === 'imported' && (
                job.applicationMethod === 'EMAIL' ? (
                  <p className="mt-3 text-sm text-on-surface-variant">
                    {emailApplicationsOn
                      ? 'E-poçtla müraciət: CV və müşayiət məktubunuzu hazırlayın, nəzərdən keçirin və göndərilməsini təsdiqləyin.'
                      : 'Bu elan e-poçtla müraciət qəbul edir. AISE vasitəsilə e-poçtla müraciət hələ aktiv deyil; müraciəti elanın göstərdiyi qaydada özünüz göndərin.'}
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-on-surface-variant">
                    Xarici elana müraciət mənbə saytında tamamlanır.
                  </p>
                )
              )}
              {job.kind === 'imported' && job.applicationMethod === 'EMAIL' && emailApplicationsOn && (
                <div className="mt-4">
                  <EmailApplyCta jobId={job.id} loginHref={`/login?next=${encodeURIComponent(`/jobs/imported/${job.id}`)}`} />
                </div>
              )}
            </section>

            {/* Description and requirements */}
            <div className="divide-y divide-outline-variant">
              <section className="p-5 sm:p-8">
                <h2 className="mb-3 text-xl font-semibold">İş haqqında</h2>
                <p className="whitespace-pre-wrap break-words leading-relaxed text-on-surface-variant">
                  {job.description || 'Təsvir göstərilməyib.'}
                </p>
              </section>
              <JobSkillGuidance kind={job.kind} id={job.id} loginHref={`/login?next=${encodeURIComponent(`/jobs/${job.kind}/${job.id}`)}`} />
              {job.requirements && (
                <section className="p-5 sm:p-8">
                  <h2 className="mb-3 text-xl font-semibold">Tələblər</h2>
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-on-surface-variant">{job.requirements}</p>
                </section>
              )}
              {job.responsibilities && (
                <section className="p-5 sm:p-8">
                  <h2 className="mb-3 text-xl font-semibold">Vəzifələr</h2>
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-on-surface-variant">{job.responsibilities}</p>
                </section>
              )}
            </div>
          </article>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
