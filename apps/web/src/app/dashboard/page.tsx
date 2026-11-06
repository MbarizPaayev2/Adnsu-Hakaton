import React, { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { 
  Briefcase, CheckCircle, FileText, ArrowRight, 
  Sparkles, Send, MessageCircle, Bookmark
} from 'lucide-react';
import { formatDate } from "@/lib/format";
import { summarizeTimeline, type TimelineSummary } from "@/lib/dashboard/timeline-summary";
import { CheckoutReturn } from "@/components/billing/checkout-return";
import { AgentPanel, type AgentState, type EmailAllowance, type SendingSettings } from "@/components/dashboard/agent-panel";
import { agentPipeline, nextAction } from "@/lib/dashboard/agent-overview";
import type { EmailApplicationSummary } from "@/lib/email-application";
import { BUTTON } from "@/components/ui";

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  status?: string;
  deadline?: string | null;
}

interface Match {
  id: string;
  score: number;
  status: 'NEW' | 'VIEWED' | 'DISMISSED' | 'APPLIED';
  actionable?: boolean;
  createdAt: string;
  job?: Job | null;
  vacancy?: {
    title: string;
    location: string | null;
    status?: string;
    deadline?: string | null;
    company?: { name: string } | null;
  } | null;
}

interface DashboardSummary {
  user: { name: string | null; email: string } | null;
  plan: 'FREE' | 'BASIC' | 'STANDARD' | 'Limitsiz' | 'PREMIUM';
  stats: {
    totalMatches: number;
    newMatches: number;
    totalResumes: number;
  };
  recentMatches: Match[];
}

function isMatchActionable(m: Match): boolean {
  if (m.actionable === false) return false;
  if (m.status === 'DISMISSED') return false;
  if (m.job?.status === 'CLOSED' || m.vacancy?.status === 'CLOSED') return false;
  const now = new Date();
  if (m.job?.deadline && new Date(m.job.deadline) < now) return false;
  if (m.vacancy?.deadline && new Date(m.vacancy.deadline) < now) return false;
  return true;
}

async function load<T>(path: string): Promise<T | null> {
  try {
    const res = await apiFetch(path, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const PLAN_NAMES: Record<string, string> = { FREE: 'Ödənişsiz', PLUS: 'Plus', PREMIUM: 'Premium' };

export default async function DashboardPage() {
  const [res, timelineRes, agent, emailApps, allowance, sending, docAllowance] = await Promise.all([
    apiFetch('/dashboard/summary', { cache: 'no-store' }),
    apiFetch('/applications/timeline', { cache: 'no-store' }).catch(() => null),
    load<AgentState>('/email-applications/automation'),
    load<EmailApplicationSummary[]>('/email-applications'),
    load<EmailAllowance>('/email-applications/allowance'),
    load<SendingSettings>('/email-applications/settings'),
    load<{ limit: number | null; used: number; remaining: number | null }>('/documents/allowance'),
  ]);

  if (!res.ok) {
    redirect('/login');
  }
  const summary: DashboardSummary = await res.json();
  const { user, plan, stats: rawStats, recentMatches } = summary;

  const translatedPlan = PLAN_NAMES[plan] ?? plan;

  // Filter recommendations: exclude closed and non-actionable jobs
  const actionableMatches = (recentMatches || []).filter(isMatchActionable);
  const unreviewedMatch = actionableMatches.find((m) => m.status === 'NEW') || actionableMatches.find((m) => m.status === 'VIEWED') || null;
  const pipeline = Array.isArray(emailApps) ? agentPipeline(emailApps) : null;
  const next = nextAction({
    pipeline,
    newMatches: actionableMatches.filter((m) => m.status === 'NEW').length,
    profileReady: rawStats.totalResumes > 0,
    agentOn: !!agent?.reviewQueue?.enabled || !!agent?.enabled,
  });

  // Authoritative application count and reply evidence come from the timeline read model only; a failed request is "unavailable", never zero.
  let timeline: TimelineSummary | null = null;
  if (timelineRes && timelineRes.ok) {
    try {
      timeline = summarizeTimeline(await timelineRes.json());
    } catch {
      timeline = null;
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl">
      <Suspense fallback={null}>
        <CheckoutReturn />
      </Suspense>

      {/* The one next step, from recorded states: approve, fix a problem, finish the profile, look at new vacancies, or nothing to do. */}
      <header className={`workspace-welcome ${next.tone === 'calm' ? 'workspace-welcome-calm' : ''}`} data-testid="next-action">
        <p className="workspace-eyebrow">SALAM, {(user?.name || user?.email?.split('@')[0] || '').toLocaleUpperCase('az')} · NÖVBƏTİ ADDIM</p>
        <h1 className="font-serif text-3xl md:text-4xl font-bold text-neutral-dark">{next.title}</h1>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <p className="max-w-[60ch] text-sm leading-relaxed text-on-dark/85">{next.detail}</p>
          <Link href={next.href} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-highlight px-5 py-2.5 text-sm font-semibold text-primary">
            {next.cta} <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <AgentPanel state={agent} pipeline={pipeline} allowance={allowance} docAllowance={docAllowance} sending={sending} />

      {/* Answer Three Immediate Questions (Action Area) */}
      <section aria-labelledby="next-actions-heading" className="space-y-4">
        <h2 id="next-actions-heading" className="font-serif text-xl font-bold text-neutral-dark">
          Hazırda diqqət yetirilməli məqamlar
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 1. Which jobs should I review? (Excludes closed and non-actionable) */}
          <div className="product-card rounded-2xl bg-surface border border-outline-variant p-5 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-accent">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                <span>Nəzərdən keçirilməli vakansiya</span>
              </div>
              {unreviewedMatch ? (
                <>
                  <p className="font-bold text-sm text-on-background line-clamp-1">
                    {unreviewedMatch.job?.title ?? unreviewedMatch.vacancy?.title ?? 'Uyğun vakansiya'}
                  </p>
                  <p className="text-xs text-on-surface-variant truncate">
                    {unreviewedMatch.job?.company ?? unreviewedMatch.vacancy?.company?.name ?? 'Şirkət'}
                  </p>
                </>
              ) : (
                <p className="text-xs text-on-surface-variant">Hazırda nəzərdən keçirilməli aktiv uyğunluq yoxdur.</p>
              )}
            </div>

            <Link
              href={unreviewedMatch ? `/dashboard/matches?id=${unreviewedMatch.id}` : '/dashboard/matches'}
              className="inline-flex min-h-11 items-center justify-between text-xs font-semibold text-accent hover:text-accent-hover pt-2 border-t border-outline-variant/40"
            >
              <span>{unreviewedMatch ? 'Uyğunluğu aç və yoxla' : 'Bütün uyğunluqlara keç'}</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          {/* 2. What application needs my action? (Authoritative data or honest unavailable) */}
          <div className="product-card rounded-2xl bg-surface border border-outline-variant p-5 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                <Send className="h-4 w-4" aria-hidden="true" />
                <span>Müraciət vəziyyəti</span>
              </div>
              {timeline === null ? (
                <>
                  <p className="font-bold text-sm text-on-background">Məlumat əlçatan deyil</p>
                  <p className="text-xs text-on-surface-variant">
                    Müraciətlərin sayı yüklənmədi. Müraciətlər siyahısında cari statusu yoxlayın.
                  </p>
                </>
              ) : timeline.total > 0 ? (
                <>
                  <p className="font-bold text-sm text-on-background">
                    {timeline.total} müraciət cədvəlində
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    {pipeline ? `${pipeline.sent} göndərilib, ${pipeline.sending} növbədə, ${pipeline.awaiting} təsdiq gözləyir. ` : ''}
                    {timeline.needsAttention > 0
                      ? `${timeline.needsAttention} müraciət diqqət tələb edir (çatdırılma problemi və ya təsdiqsiz nəticə).`
                      : 'E-poçt çatdırılma sübutları və status dəyişiklikləri.'}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-bold text-sm text-on-background">Hələ müraciətiniz yoxdur</p>
                  <p className="text-xs text-on-surface-variant">
                    Uyğun elan seçib fərdiləşdirilmiş CV ilə müraciət edin.
                  </p>
                </>
              )}
            </div>

            <Link
              href="/dashboard/applications"
              className="inline-flex min-h-11 items-center justify-between text-xs font-semibold text-accent hover:text-accent-hover pt-2 border-t border-outline-variant/40"
            >
              <span>Müraciətlərə bax</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          {/* 3. Has an employer replied? (Authoritative notifications or honest unavailable) */}
          <div className="product-card rounded-2xl bg-surface border border-outline-variant p-5 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-secondary">
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                <span>İşəgötürənin cavabı</span>
              </div>
              {timeline === null ? (
                <>
                  <p className="font-bold text-sm text-on-background">Məlumat əlçatan deyil</p>
                  <p className="text-xs text-on-surface-variant">
                    Cavab məlumatı yüklənmədi. Müraciətlər bölməsində hər müraciətin vəziyyətini yoxlayın.
                  </p>
                </>
              ) : timeline.employerConfirmed + timeline.candidateReported + timeline.replyReceived > 0 ? (
                <ul className="space-y-1 text-xs text-on-background">
                  {timeline.employerConfirmed > 0 && (
                    <li><span className="font-bold text-sm">{timeline.employerConfirmed}</span> işəgötürən AISE-də status dəyişib (işəgötürən təsdiqi)</li>
                  )}
                  {timeline.replyReceived > 0 && (
                    <li><span className="font-bold text-sm">{timeline.replyReceived}</span> cavab ünvanına məktub daxil olub</li>
                  )}
                  {timeline.candidateReported > 0 && (
                    <li><span className="font-bold text-sm">{timeline.candidateReported}</span> sizin qeyd etdiyiniz cavab və ya nəticə</li>
                  )}
                </ul>
              ) : (
                <>
                  <p className="font-bold text-sm text-on-background">Təsdiqlənmiş cavab yoxdur</p>
                  <p className="text-xs text-on-surface-variant">
                    Cavab aldınızsa, müraciətin səhifəsində qeyd edin. AISE cavabı özü güman etmir.
                  </p>
                </>
              )}
            </div>

            <Link
              href="/dashboard/notifications"
              className="inline-flex min-h-11 items-center justify-between text-xs font-semibold text-accent hover:text-accent-hover pt-2 border-t border-outline-variant/40"
            >
              <span>Bildirişlərə bax</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* Main Grid: Matches feed + Sidebar info */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Matches Feed */}
        <div className="lg:col-span-2 space-y-6">
          <div className="product-card rounded-2xl bg-surface border border-outline-variant p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4 border-b border-outline-variant/60 pb-4">
              <div>
                <h2 className="font-serif text-xl font-bold text-neutral-dark">Son uyğunluqlar</h2>
                <p className="text-xs text-on-surface-variant mt-0.5">{rawStats.newMatches} yeni uyğun vakansiya</p>
              </div>
              <Link
                href="/dashboard/matches"
                className="tap group flex items-center text-xs font-semibold text-accent hover:text-accent-hover transition-colors"
              >
                <span>Hamısını gör</span>
                <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </div>

            {actionableMatches.length === 0 ? (
              <div className="text-center py-10">
                <Briefcase className="mx-auto h-12 w-12 text-neutral-dark/30 mb-2" aria-hidden="true" />
                <p className="text-sm text-neutral-dark/65">Hazırda aktiv uyğunluq tapılmayıb.</p>
                <p className="text-xs text-neutral-dark/50 mt-1">Əsas CV yüklədiyinizdən və profilinizi tamamladığınızdan əmin olun.</p>
              </div>
            ) : (
              <div className="divide-y divide-outline-variant/50">
                {actionableMatches.slice(0, 5).map((match) => {
                  let statusText = 'Yenidir';
                  if (match.status === 'APPLIED') statusText = 'Müraciət edilib';
                  if (match.status === 'VIEWED') statusText = 'Baxılıb';
                  if (match.status === 'DISMISSED') statusText = 'Rədd edilib';
                  const title = match.job?.title ?? match.vacancy?.title ?? 'Vakansiya';
                  const company = match.job?.company ?? match.vacancy?.company?.name ?? '';
                  const location = match.job?.location ?? match.vacancy?.location ?? '';

                  return (
                    <div key={match.id} className="py-4 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0 pr-2">
                        <Link href={`/dashboard/matches?id=${match.id}`} className="tap font-semibold text-sm text-neutral-dark hover:text-accent transition-colors line-clamp-2 break-words">
                          {title}
                        </Link>
                        <p className="text-xs text-neutral-dark/65 line-clamp-2 break-words">{company} {location ? `· ${location}` : ''}</p>
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium border ${
                          match.status === 'NEW'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : match.status === 'APPLIED'
                            ? 'bg-green-50 text-green-800 border-green-200'
                            : 'bg-neutral-50 text-neutral-800 border-neutral-200'
                        }`}>
                          {statusText}
                        </span>
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <div className="flex items-center gap-1 bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded-md">
                          <CheckCircle className="h-3 w-3" aria-hidden="true" />
                          <span>{Math.round(match.score * 100)}%</span>
                        </div>
                        <span className="text-[10px] text-neutral-dark/50 mt-1">
                          {formatDate(match.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Info & Short Links */}
        <div className="space-y-6">
          {/* Saved items shortcut */}
          <div className="product-card rounded-2xl bg-surface border border-outline-variant p-6 shadow-xs space-y-3">
            <h3 className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
              <Bookmark className="h-4 w-4 text-primary" aria-hidden="true" />
              Saxlanılanlar
            </h3>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              Saxladığınız vakansiyaları və aktiv bildirişli axtarışlarınızı idarə edin.
            </p>
            <Link
              href="/dashboard/saved"
              className="inline-flex min-h-11 items-center justify-center w-full rounded-xl bg-background border border-outline-variant text-xs font-semibold text-on-background hover:bg-surface-container transition-colors"
            >
              Saxlananlara keç
            </Link>
          </div>

          {/* Documents: what the plan still allows this month, as the server states it. */}
          <div className="product-card rounded-2xl bg-surface border border-outline-variant p-6 shadow-xs space-y-3">
            <h3 className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
              CV və məktublar
            </h3>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              {docAllowance === null
                ? 'Sənəd limiti hazırda yüklənmədi.'
                : docAllowance.limit === null
                  ? `Bu ay ${docAllowance.used} sənəd hazırlanıb; planınızda aylıq limit yoxdur.`
                  : `Bu ay ${docAllowance.remaining ?? 0} / ${docAllowance.limit} sənəd qalıb. Redaktə və yükləmə limitdən çıxılmır.`}
            </p>
            <Link href="/dashboard/resumes" className={`${BUTTON.secondary} w-full`}>
              Sənədlərə keç
            </Link>
          </div>

          {/* Subscription info */}
          <div className="product-card rounded-2xl bg-surface border border-outline-variant p-6 shadow-xs space-y-2">
            <h3 className="font-serif text-base font-bold text-neutral-dark">Abunəlik planınız</h3>
            <p className="text-xs text-neutral-dark/75">
              Hazırkı plan: <strong className="font-semibold text-primary">{translatedPlan}</strong>
            </p>
            <Link
              href="/pricing"
              className="tap inline-flex text-xs font-semibold text-accent hover:text-accent-hover transition-colors pt-2"
            >
              Plan imkanlarını müqayisə edin &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
