import Link from 'next/link';
import { AlertTriangle, ArrowRight, FileText, Mail, Paperclip } from 'lucide-react';
import { Badge, BUTTON, SectionHeader } from '@/components/ui';
import { formatDate } from '@/lib/format';
import type { EmailApplicationView } from '@/lib/email-application';
import type { ReviewReason } from '@/lib/dashboard/review-reason';
import { SkipApplicationButton } from './skip-application-button';

export interface ReviewItem { view: EmailApplicationView; reason: ReviewReason; matchId?: string | null }

/**
 * Prepared applications waiting for the candidate, one card each, readable on a phone: who and what, where it goes, why it was picked,
 * what the posting asks beyond a CV, which document versions go with it and the start of the message. Approval happens on the
 * application's own page, where the exact payload is shown and bound to the approval; nothing here sends anything.
 */
export function ReviewQueue({ items, controls }: { items: ReviewItem[]; controls?: React.ReactNode }) {
  return (
    <section id="review" aria-labelledby="review-title" className="scroll-mt-6 space-y-3">
      <SectionHeader
        id="review-title"
        title="Təsdiqinizi gözləyənlər"
        description="Hazırdır, amma heç biri göndərilməyib. Hər birini açın, alıcını, mətni və sənədləri yoxlayın; təsdiqlədiyiniz nüsxə göndərilir. İstəmədiyinizi keçin."
        action={controls}
      />
      <ul className="grid gap-3" data-testid="awaiting-review">
        {items.map(({ view, reason, matchId }) => {
          const extra = view.asksMoreThanCv || view.instructionsExtra;
          return (
            <li key={view.id} className="ui-card space-y-4" data-testid="review-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-neutral-dark/70 break-words">{view.jobCompany}</p>
                  <h3 className="text-base font-semibold leading-snug text-neutral-dark break-words">{view.jobTitle}</h3>
                </div>
                <Badge tone={extra ? 'warn' : 'neutral'}>{extra ? 'Əlavə məlumat istənir' : 'Təsdiq gözləyir'}</Badge>
              </div>

              <dl className="grid gap-2 text-sm">
                <div className="flex items-start gap-2"><dt className="sr-only">Hara</dt><Mail aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-secondary" /><dd className="min-w-0 break-all"><span className="text-neutral-dark/65">E-poçtla: </span>{view.recipient}<span className="text-neutral-dark/60"> · elanda göstərilən ünvan</span></dd></div>
                <div className="flex items-start gap-2">
                  <dt className="sr-only">Sənədlər</dt>
                  <Paperclip aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                  <dd className="min-w-0 break-words flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border ${view.cv.kind === 'tailored' ? 'bg-green-50 text-green-800 border-green-200' : 'bg-neutral-100 text-neutral-800 border-neutral-200'}`}>
                      {view.cv.kind === 'tailored' ? 'Bu elan üçün təsdiqlənmiş CV' : 'Əsas CV'}
                    </span>
                    <span className="text-neutral-dark/80">({view.cv.fileName})</span>
                    {view.letter ? (
                      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border bg-blue-50 text-blue-800 border-blue-200">
                        + Məktub ({view.letter.fileName})
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-dark/60">· məktub əlavə edilməyib</span>
                    )}
                  </dd>
                </div>
              </dl>

              {(reason.roles.length > 0 || reason.evidenced.length > 0 || reason.notEvidenced.length > 0) && (
                <div className="rounded-xl bg-surface-container-low p-3 text-sm">
                  <p className="font-semibold text-neutral-dark">Niyə seçildi</p>
                  <ul className="mt-1 space-y-1 text-neutral-dark/80">
                    {reason.roles.length > 0 && <li>Vəzifə qaydanıza uyğundur: {reason.roles.join(', ')}{reason.cities.length ? ` · şəhər: ${reason.cities.join(', ')}` : ''}</li>}
                    {reason.evidenced.length > 0 && <li>Profilinizdə göstərilən: {reason.evidenced.join(', ')}</li>}
                    {reason.notEvidenced.length > 0 && <li>Profilinizdə göstərilməyən: {reason.notEvidenced.join(', ')}</li>}
                  </ul>
                </div>
              )}

              {extra && (
                <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Elan CV-dən əlavə nəsə istəyir (məsələn, maaş gözləntisi, portfolio və ya sənəd). AISE bunu sizin yerinizə yazmır: göstərişi oxuyub mətnə özünüz əlavə edin.</span>
                </p>
              )}

              <div className="rounded-xl border border-outline-variant p-3 text-sm">
                <p className="flex items-center gap-2 text-xs font-semibold text-neutral-dark/70"><FileText aria-hidden="true" className="h-3.5 w-3.5" />Mövzu: <span className="font-normal break-words">{view.subject}</span></p>
                <p className="mt-2 whitespace-pre-line text-neutral-dark/85 line-clamp-4">{view.body}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/dashboard/email-applications/${view.id}`} className={BUTTON.primary} aria-label={`${view.jobTitle}: yoxla və təsdiqlə`}>Yoxla və təsdiqlə <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
                <Link href={`/dashboard/email-applications/${view.id}#message`} className={BUTTON.quiet}>Mətni düzəlt</Link>
                {matchId && <Link href={`/dashboard/matches?id=${matchId}`} className={BUTTON.quiet}>Elana bax</Link>}
                <SkipApplicationButton id={view.id} title={view.jobTitle} />
              </div>
              {view.preparedByAgentAt && <p className="text-xs text-neutral-dark/55">AISE hazırladı: {formatDate(view.preparedByAgentAt)}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
