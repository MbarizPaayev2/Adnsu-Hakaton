import React from 'react';
import Link from 'next/link';
import { Send, Building2, Calendar, ArrowRight, ExternalLink, UserCheck, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatDate } from "@/lib/format";
import { CompanyLogo } from '@/components/company-logo';
import { stateOf as agentState, REASON as AGENT_REASON, type AgentApplication } from '@/lib/agent';
import { DELIVERY, HOLD_REASONS, RECRUITMENT, failureText, type EmailApplicationSummary, type EmailApplicationView } from '@/lib/email-application';
import { BUTTON, PageHeader } from '@/components/ui';
import { ReviewQueue, type ReviewItem } from '@/components/dashboard/review-queue';
import { AgentControls } from '@/components/dashboard/agent-controls';
import { reviewReason } from '@/lib/dashboard/review-reason';
import { CandidateOutcomesManager } from '@/components/candidate-outcomes-manager';

// Three different things, never presented as one another:
//  - native: sent inside AISE to an employer on the platform;
//  - external: prepared/sent by AISE on the employer's own site — "received"
//    only when that site returned a validated receipt;
//  - self-reported: the candidate marked a listing as applied; AISE did not
//    send anything and cannot confirm it.

type Tone = 'neutral' | 'progress' | 'good' | 'warn' | 'bad';
const TONES: Record<Tone, string> = {
  neutral: 'bg-neutral-50 text-neutral-800 border-neutral-200',
  progress: 'bg-blue-50 text-blue-800 border-blue-200',
  good: 'bg-green-50 text-green-800 border-green-200',
  warn: 'bg-amber-50 text-amber-900 border-amber-200',
  bad: 'bg-red-50 text-red-800 border-red-200',
};

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium border ${TONES[tone]}`}>{children}</span>;
}

const NATIVE_STATUS: Record<string, [Tone, string]> = {
  APPLIED: ['warn', 'Göndərildi'],
  REVIEWING: ['progress', 'Nəzərdən keçirilir'],
  INTERVIEW: ['progress', 'Müsahibə'],
  HIRED: ['good', 'Qəbul edildi'],
  REJECTED: ['bad', 'Rədd edildi'],
};

interface NativeRow {
  id: string;
  status: string;
  createdAt: string;
  vacancyId: string;
  vacancy?: { title: string; companyId: string; company?: { name: string; logo?: string | null } | null } | null;
}

interface MatchRow {
  id: string;
  status: string;
  details?: { matchedKeywords?: unknown; gaps?: unknown } | null;
  job?: { id?: string; title: string; company: string; url?: string | null } | null;
  vacancy?: { title: string; company?: { name: string } | null } | null;
}

interface ExternalRow {
  id: string;
  status: string;
  dryRun: boolean;
  createdAt: string;
  submittedAt: string | null;
  receiptConfirmed: boolean;
  receiptReference: string | null;
  destinationName: string | null;
  matchId: string;
  vacancy: { title: string; company: string } | null;
}

function externalStatus(row: ExternalRow): { tone: Tone; label: string; hint?: string } {
  switch (row.status) {
    case 'SUBMITTED':
      return row.receiptConfirmed
        ? { tone: 'good', label: `Qəbul təsdiqləndi · ${row.receiptReference}` }
        : { tone: 'warn', label: 'Göndərildi — qəbul təsdiqi yoxdur' };
    case 'SUBMITTED_DRY_RUN':
      return { tone: 'neutral', label: 'Sınaq — göndərilmədi' };
    case 'DELIVERY_UNCONFIRMED':
      return { tone: 'warn', label: 'Çatdırılma təsdiqlənməyib', hint: 'Təkrar göndərməyin: müraciət çatmış ola bilər. Lazım olsa, işəgötürənlə birbaşa əlaqə saxlayın.' };
    case 'SUBMITTING':
      return { tone: 'progress', label: 'Göndərilir...' };
    case 'AWAITING_OTP':
      return { tone: 'progress', label: 'Təsdiq kodu gözlənilir' };
    case 'FAILED':
      return { tone: 'bad', label: 'Göndərilmədi' };
    case 'EXPIRED':
      return { tone: 'neutral', label: 'Müddəti bitdi — göndərilmədi' };
    default:
      return { tone: 'neutral', label: 'Hazırlanır — hələ göndərilməyib' };
  }
}

async function load<T>(path: string): Promise<T | null> {
  try {
    const res = await apiFetch(path, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div>
        <h2 className="font-serif text-xl font-bold text-neutral-dark">{title}</h2>
        <p className="text-sm text-neutral-dark/65">{description}</p>
      </div>
      {children}
    </section>
  );
}

const CARD = 'product-card rounded-2xl bg-background border border-neutral-dark/5 shadow-xs divide-y divide-neutral-dark/5';
const ROW = 'flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5';
const ACTION = 'inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-accent hover:bg-accent/5 hover:text-accent-hover transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden';

function emailRowHint(row: EmailApplicationSummary): string | null {
  if (row.deliveryState === 'QUEUED') {
    return 'Göndəriş növbəsindədir — təsdiqlənib, hələ göndərilməyib.';
  }
  if (row.deliveryState === 'SENDING') {
    return 'Mesaj e-poçt xidmətinə təhvil verilir.';
  }
  if (row.recruitmentState === 'SENT' || row.deliveryState === 'PROVIDER_ACCEPTED') {
    return 'E-poçt xidmətinə təhvil verildi; çatdırılma təsdiqi yoxdur və bu, işəgötürənin baxdığı və ya qəbul etdiyi demək deyil.';
  }
  return null;
}

export default async function ApplicationsPage() {
  const [native, external, matches, emailApps, agentApps, automation, sending] = await Promise.all([
    load<NativeRow[]>('/dashboard/applications'),
    load<ExternalRow[]>('/external-applications/mine'),
    load<MatchRow[]>('/matches'),
    load<EmailApplicationSummary[]>('/email-applications'),
    load<AgentApplication[]>('/agent/applications'),
    load<{ rules: { allowedRoles: string[]; allowedLocations: string[] }; reviewQueue?: { enabled: boolean }; premiumRequired?: boolean }>('/email-applications/automation'),
    load<{ sendingPausedAt: string | null }>('/email-applications/settings'),
  ]);

  if (native === null && external === null) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-500">
        <Send aria-hidden="true" className="h-16 w-16 text-neutral-dark/30 mb-4" />
        <h1 className="text-xl font-bold text-neutral-dark mb-2">Müraciətlər yüklənmədi</h1>
        <p className="text-neutral-dark/65 mb-4">Bağlantıda problem ola bilər. Bir az sonra yenidən cəhd edin.</p>
        <Link href="/dashboard/applications" className="inline-flex min-h-11 items-center justify-center product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden">
          Yenidən yüklə
        </Link>
      </div>
    );
  }

  const externalMatchIds = new Set((external ?? []).map((row) => row.matchId));
  const selfReported = (matches ?? []).filter((m) => m.status === 'APPLIED' && !externalMatchIds.has(m.id));
  // Prepared (by AISE in the background or by the candidate) and waiting for approval: shown first, apart from what was actually sent.
  const awaitingReview = (emailApps ?? []).filter((row) => row.deliveryState === 'AWAITING_APPROVAL');
  const emailRows = (emailApps ?? []).filter((row) => row.deliveryState !== 'DRAFT' && !awaitingReview.includes(row));
  const views = await Promise.all(awaitingReview.map((row) => load<EmailApplicationView>(`/email-applications/${encodeURIComponent(row.id)}`)));
  const reviewItems: ReviewItem[] = views.filter((v): v is EmailApplicationView => !!v).map((view) => {
    const match = (matches ?? []).find((m) => m.job?.id && m.job.id === view.jobId) ?? null;
    return { view, matchId: match?.id ?? null, reason: view.preparedByAgentAt ? reviewReason({ title: view.jobTitle, rules: automation?.rules ?? null, match: match?.details }) : reviewReason({ title: view.jobTitle, rules: null, match: match?.details }) };
  });
  const nothing = !native?.length && !external?.length && !selfReported.length && !emailRows.length && !awaitingReview.length;

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <PageHeader
        title="Müraciətlərim"
        intro="AISE ilə hazırlanan, göndərilən və özünüz qeyd etdiyiniz müraciətlər. Hər birinin yanında onun nə dərəcədə təsdiqləndiyi yazılıb: təsdiq gözləyən heç vaxt “göndərildi” kimi göstərilmir."
        actions={<>
          <Link className={BUTTON.secondary} href="/dashboard/outcomes">Nəticələrim</Link>
          <Link className={BUTTON.secondary} href="/dashboard/applications/tracker">Müraciət cədvəlim</Link>
          <Link className={BUTTON.quiet} href="/dashboard/email-applications/settings">Agent və e-poçt qaydaları</Link>
        </>}
      />

      {nothing && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-background rounded-2xl border border-neutral-dark/5 shadow-xs">
          <Send aria-hidden="true" className="h-14 w-14 text-neutral-dark/30 mb-4" />
          <p className="text-neutral-dark/65 font-medium mb-4">Hələ heç bir müraciətiniz yoxdur.</p>
          <Link href="/dashboard/matches" className="inline-flex min-h-11 items-center justify-center gap-2 product-action rounded-full bg-primary py-2.5 px-6 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden">
            Uyğunluqlarınıza baxın <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      )}

      {reviewItems.length > 0 && (
        <ReviewQueue
          items={reviewItems}
          controls={automation && !automation.premiumRequired ? <div className="flex flex-wrap gap-1"><AgentControls queueOn={!!automation.reviewQueue?.enabled} paused={!!sending?.sendingPausedAt} /></div> : undefined}
        />
      )}
      {awaitingReview.length > reviewItems.length && (
        <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">Təsdiq gözləyən {awaitingReview.length - reviewItems.length} müraciət yüklənmədi. Səhifəni yeniləyin.</p>
      )}

      {native === null && (
        <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">AISE daxilindəki müraciətlər yüklənmədi. Səhifəni yeniləyin.</p>
      )}
      {!!native?.length && (
        <Section title="AISE-də göndərilənlər" description="Platformadakı işəgötürənlərə birbaşa göndərildi; status işəgötürən tərəfindən yenilənir.">
          <ul className={CARD}>
            {native.map((app) => {
              const [tone, label] = NATIVE_STATUS[app.status] ?? ['neutral', app.status];
              const href = `/dashboard/companies/${app.vacancy?.companyId}/vacancies/${app.vacancyId}`;
              return (
                <li key={app.id} className={ROW}>
                  <div className="flex min-w-0 items-center gap-4">
                    {app.vacancy?.company?.logo ? (
                      <CompanyLogo src={app.vacancy.company.logo} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover border border-neutral-dark/10" />
                    ) : (
                      <div aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent font-serif font-bold text-sm shrink-0 border border-neutral-dark/10">
                        {app.vacancy?.company?.name?.[0]?.toUpperCase() || 'C'}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-dark break-words">{app.vacancy?.title}</p>
                      <p className="text-xs text-neutral-dark/65 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                        <span className="inline-flex items-center gap-1"><Building2 aria-hidden="true" className="h-3 w-3" />{app.vacancy?.company?.name}</span>
                        <span className="inline-flex items-center gap-1"><Calendar aria-hidden="true" className="h-3 w-3" />{formatDate(app.createdAt)}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <Badge tone={tone}>{label}</Badge>
                    <Link href={href} className={ACTION} aria-label={`${app.vacancy?.title ?? 'Vakansiya'} — bax`}>
                      Bax <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {!!emailRows.length && (
        <Section title="E-poçtla göndərilənlər" description="Elanın özündə göstərilən ünvana, sizin təsdiqinizlə göndərilir. Çatdırılma sübutu ilə işəgötürənin cavabı ayrı göstərilir: e-poçt xidmətinin qəbul etməsi işəgötürənin gördüyü demək deyil.">
          <ul className={CARD}>
            {emailRows.map((row) => {
              const state = DELIVERY[row.deliveryState];
              const note = row.holdReason ? (HOLD_REASONS[row.holdReason] ?? '') : row.deliveryState === 'FAILED' ? failureText(row.failureCode) : '';
              const hint = emailRowHint(row);
              return (
                <li key={row.id} className={ROW}>
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-dark break-words">{row.jobTitle}</p>
                    <p className="text-xs text-neutral-dark/65 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                      <span className="inline-flex items-center gap-1"><Building2 aria-hidden="true" className="h-3 w-3" />{row.jobCompany}</span>
                      <span className="inline-flex items-center gap-1"><Calendar aria-hidden="true" className="h-3 w-3" />{formatDate(row.approvedAt ?? row.createdAt)}</span>
                      {row.mode === 'AUTOMATIC' && <span>Avtomatik</span>}
                    </p>
                    {hint && <p className="mt-1.5 text-xs text-neutral-dark/75">{hint}</p>}
                    {note && <p className="mt-1.5 text-xs text-amber-900">{note}</p>}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                    <Badge tone={state.tone}>{state.label}</Badge>
                    {row.recruitmentState !== 'NOT_SENT' && <Badge tone="neutral">{RECRUITMENT[row.recruitmentState]}</Badge>}
                    <Link href={`/dashboard/email-applications/${row.id}`} className={ACTION} aria-label={`${row.jobTitle} — ətraflı`}>
                      {row.deliveryState === 'AWAITING_APPROVAL' ? 'Yoxla' : 'Ətraflı'} <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-neutral-dark/60"><Link href="/dashboard/email-applications/settings" className="underline">E-poçt müraciətlərini dayandır, ləğv et və ya razılığı geri götür</Link></p>
        </Section>
      )}

      {!!agentApps?.length && (
        <Section title="Brauzer köməkçisi ilə" description="Köməkçi müraciəti sizin öz brauzerinizdə, portalın formasında edir. “Göndərildi — portalın təsdiq səhifəsi saxlanıldı” yalnız portalın öz təsdiq səhifəsi görüləndə yazılır; sizin bildirişiniz ayrıca qeyd olunur.">
          <ul className={CARD}>
            {agentApps.map((row) => {
              const st = agentState(row);
              const hint = row.stateReason ? AGENT_REASON[row.stateReason] : null;
              return (
                <li key={row.id} className={ROW}>
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-dark break-words">{row.title}</p>
                    <p className="text-xs text-neutral-dark/65 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                      <span className="inline-flex items-center gap-1"><Building2 aria-hidden="true" className="h-3 w-3" />{row.company}</span>
                      <span className="inline-flex items-center gap-1"><Calendar aria-hidden="true" className="h-3 w-3" />{formatDate(row.submittedAt ?? row.createdAt)}</span>
                      <span>{row.mode === 'ASSISTED' ? 'Sizin təsdiqinizlə' : 'Avtonom müraciət icazəsi'}</span>
                    </p>
                    {hint && <p className="mt-1.5 text-xs text-neutral-dark/75">{hint}</p>}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <Link href={`/dashboard/agent/applications/${row.id}`} className={ACTION} aria-label={`${row.title} — ətraflı`}>
                      {row.nextActions.length ? 'Addım lazımdır' : 'Ətraflı'} <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {external === null && (
        <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">Xarici saytlara müraciətlər yüklənmədi. Səhifəni yeniləyin.</p>
      )}
      {!!external?.length && (
        <Section title="Xarici saytlarda — AISE vasitəsilə" description="AISE işəgötürənin öz saytındakı formanı sizin təsdiqinizlə doldurur. “Qəbul təsdiqləndi” yalnız sayt qəbul nömrəsi qaytardıqda yazılır.">
          <ul className={CARD}>
            {external.map((row) => {
              const state = externalStatus(row);
              return (
                <li key={row.id} className={ROW}>
                  <div className="flex min-w-0 items-start gap-4">
                    <div aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                      {row.receiptConfirmed ? <ShieldCheck className="h-5 w-5" /> : <ExternalLink className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-dark break-words">{row.vacancy?.title ?? 'Vakansiya'}</p>
                      <p className="text-xs text-neutral-dark/65 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                        <span className="inline-flex items-center gap-1"><Building2 aria-hidden="true" className="h-3 w-3" />{row.vacancy?.company}{row.destinationName ? ` · ${row.destinationName}` : ''}</span>
                        <span className="inline-flex items-center gap-1"><Calendar aria-hidden="true" className="h-3 w-3" />{formatDate(row.submittedAt ?? row.createdAt)}</span>
                      </p>
                      {state.hint && <p className="mt-1.5 text-xs text-amber-900">{state.hint}</p>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <Badge tone={state.tone}>{state.label}</Badge>
                    <Link href={`/dashboard/apply/${row.id}`} className={ACTION} aria-label={`${row.vacancy?.title ?? 'Müraciət'} — ətraflı`}>
                      Ətraflı <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {selfReported.length > 0 && (
        <Section title="Özünüz qeyd etdikləriniz" description="Mənbə saytda özünüz müraciət edib “Müraciət etdim” ilə qeyd etdiniz. AISE bu müraciəti göndərməyib və onu təsdiqləyə bilmir.">
          <ul className={CARD}>
            {selfReported.map((m) => (
              <li key={m.id} className={ROW}>
                <div className="flex min-w-0 items-center gap-4">
                  <div aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-dark/5 text-neutral-dark/70 shrink-0">
                    <UserCheck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-dark break-words">{m.job?.title ?? m.vacancy?.title ?? 'Vakansiya'}</p>
                    <p className="text-xs text-neutral-dark/65 inline-flex items-center gap-1 mt-0.5">
                      <Building2 aria-hidden="true" className="h-3 w-3" />{m.job?.company ?? m.vacancy?.company?.name ?? ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <Badge tone="neutral">Siz qeyd etdiniz</Badge>
                  {m.job?.url && (
                    <a href={m.job.url} target="_blank" rel="noopener noreferrer" className={ACTION}>
                      Mənbə elan <ExternalLink aria-hidden="true" className="h-4 w-4" />
                      <span className="sr-only">(yeni pəncərədə açılır)</span>
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="pt-6 border-t border-neutral-dark/10">
        <CandidateOutcomesManager />
      </div>
    </div>
  );
}
