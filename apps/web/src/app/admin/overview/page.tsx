'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminHeader, useAdminMe } from '@/components/admin-header';
import { adminCall, AdminLoadingState, CARD, Notices, StatusPill, when } from '@/components/admin-ui';
import { evaluateHealth, type HealthPayload } from '@/lib/admin/health';
import { formatDate } from '@/lib/format';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  Compass,
  FileText,
  RefreshCw,
  Users,
} from 'lucide-react';

export interface ServerRecommendationItem {
  id: string;
  area: string;
  status: 'attention' | 'unknown';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  condition: string;
  facts: Record<string, any>;
  observedAt: string;
  freshness: { source: string; asOf: string | null; ageSeconds: number | null; stale: boolean };
  nextStep: string;
  link: { page: string | null; runbook: string | null };
  requiredPermission: string;
  canAct: boolean;
}

export interface ServerCheckedArea {
  area: string;
  status: 'ok' | 'attention' | 'unknown' | 'skipped';
  checkedAt: string;
  itemCount: number;
  note?: string;
}

export interface ServerRecommendationsResponse {
  contractVersion: number;
  generatedAt: string;
  environment: string;
  role: string;
  summary: {
    attention: number;
    unknown: number;
    bySeverity: { critical: number; high: number; medium: number; low: number; info: number };
  };
  checked: ServerCheckedArea[];
  items: ServerRecommendationItem[];
}

export interface AdminRecommendation {
  id: string;
  severity: 'info' | 'attention' | 'critical';
  title: string;
  why: string;
  evidenceAt?: string;
  stale: boolean;
  suggestedStep: string;
  href?: string;
  status?: 'attention' | 'unknown';
  freshness?: { source: string; asOf: string | null; ageSeconds: number | null; stale: boolean };
  requiredPermission?: string;
  canAct?: boolean;
}

type Counts = Record<string, number>;
interface Overview {
  users: { total: number; verified: number; suspended: number };
  companies: Counts;
  vacancies: Counts;
  jobs: Counts & { hidden: number };
  applications: { native: Counts; external: Counts };
  matchesLast24h: number;
  failures: { tailoredCvLast7d: number; externalUnconfirmed: number; queues: { name: string; failed: number }[]; queuesUnavailable?: string[]; emailFailuresSinceRestart: number };
  lastImport: { status: string; startedAt: string; finishedAt: string | null; listed: number; created: number; error: string | null } | null;
  features: { key: string; label: string; paused: boolean; reason: string | null }[];
}

const sum = (c?: Counts) => Object.values(c || {}).reduce((a, b) => a + b, 0);

function StatCard({
  label,
  value,
  detail,
  href,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  href?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const content = (
    <div className={`${CARD} p-5 h-full flex flex-col justify-between transition-all hover:border-primary/30 group`}>
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs font-semibold uppercase text-neutral-dark/60 tracking-wider">{label}</p>
          {Icon && <Icon className="h-4 w-4 text-neutral-dark/40 group-hover:text-primary transition-colors" />}
        </div>
        <div className="text-2xl font-bold font-serif text-neutral-dark tracking-tight">{value}</div>
      </div>
      {detail && (
        <div className="mt-3 pt-3 border-t border-neutral-dark/5 flex items-center justify-between text-xs text-neutral-dark/65">
          <span className="truncate">{detail}</span>
          {href && <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 text-primary transition-all" />}
        </div>
      )}
    </div>
  );

  return href ? (
    <Link href={href} className="block outline-hidden focus-visible:ring-2 focus-visible:ring-primary rounded-2xl min-h-11">
      {content}
    </Link>
  ) : (
    content
  );
}

export default function AdminOverviewPage() {
  const me = useAdminMe();
  const [data, setData] = useState<Overview | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [serverRecommendationsResponse, setServerRecommendationsResponse] = useState<ServerRecommendationsResponse | null>(null);
  const [serverRecommendations, setServerRecommendations] = useState<AdminRecommendation[]>([]);
  const [recommendationsStatus, setRecommendationsStatus] = useState<
    'loading' | 'authoritative' | 'inferred'
  >('loading');

  const load = useCallback(() => {
    setLoading(true);
    setHealthLoading(true);
    setError('');
    setHealthError('');

    adminCall<Overview>('ops/overview')
      .then((res) => {
        setData(res);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

    adminCall<HealthPayload>('ops/health')
      .then((res) => {
        setHealth(res);
      })
      .catch((e: Error) => {
        setHealth(null);
        setHealthError(e.message);
      })
      .finally(() => setHealthLoading(false));

    adminCall<any>('ops/recommendations')
      .then((res) => {
        if (res && Array.isArray(res.items) && Array.isArray(res.checked)) {
          setServerRecommendationsResponse(res);
          setServerRecommendations(
            res.items.map((item: ServerRecommendationItem) => ({
              id: item.id,
              severity:
                item.severity === 'critical'
                  ? 'critical'
                  : item.severity === 'info'
                  ? 'info'
                  : 'attention',
              title: item.title,
              why: item.condition,
              evidenceAt: item.freshness?.asOf || item.observedAt,
              stale: !!item.freshness?.stale,
              suggestedStep: item.nextStep,
              href: item.link?.page || undefined,
              status: item.status,
              freshness: item.freshness,
              requiredPermission: item.requiredPermission,
              canAct: item.canAct,
            }))
          );
          setRecommendationsStatus('authoritative');
        } else if (Array.isArray(res)) {
          setServerRecommendationsResponse(null);
          setServerRecommendations(res);
          setRecommendationsStatus('authoritative');
        } else {
          setServerRecommendationsResponse(null);
          setServerRecommendations([]);
          setRecommendationsStatus('inferred');
        }
      })
      .catch(() => {
        setServerRecommendationsResponse(null);
        setServerRecommendations([]);
        setRecommendationsStatus('inferred');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Operational counts: separate failed-job totals from affected-queue counts
  const queues = data?.failures?.queues || [];
  const failedJobsCount = queues.reduce((acc, q) => acc + (q.failed || 0), 0);
  const affectedQueuesCount = queues.filter((q) => (q.failed || 0) > 0).length;

  const tailoredCvFailures7d = data?.failures?.tailoredCvLast7d || 0;
  const emailFailuresSession = data?.failures?.emailFailuresSinceRestart || 0;
  const externalUnconfirmed = data?.failures?.externalUnconfirmed || 0;

  const hasRecordedFailures =
    failedJobsCount > 0 || tailoredCvFailures7d > 0 || emailFailuresSession > 0;
  const hasDeliveryUncertainty = externalUnconfirmed > 0;
  const hasImportError = Boolean(data?.lastImport?.error);
  // Counters only mean something when the API actually reported them and could read every queue; otherwise they are unknown, not zero.
  const failuresKnown = Boolean(data?.failures);
  const queuesUnavailable = data?.failures?.queuesUnavailable ?? [];
  const hasAnyAttentionItem = hasRecordedFailures || hasDeliveryUncertainty || hasImportError || queuesUnavailable.length > 0 || !failuresKnown;

  // Authoritative health verdict (shared with /admin/system): never based on zero failure counters.
  const healthState = evaluateHealth({ loading: healthLoading, error: healthError, health });

  // Data-driven diagnostic recommendations (honours Claude's contract shape)
  const computedRecommendations: AdminRecommendation[] = [];

  if (healthState.tone === 'bad') {
    computedRecommendations.push({
      id: 'rec-health-bad',
      severity: 'critical',
      title: `Sistem vəziyyəti: ${healthState.label}`,
      why: healthState.detail,
      evidenceAt: undefined,
      stale: false,
      suggestedStep: 'Sistem monitorinqində servisləri yoxlayın.',
      href: '/admin/system',
    });
  } else if (healthState.tone === 'unknown') {
    computedRecommendations.push({
      id: 'rec-health-unknown',
      severity: 'attention',
      title: 'Sistem sağlamlığı məlum deyil',
      why: healthState.detail,
      evidenceAt: undefined,
      stale: true,
      suggestedStep: 'Servislərin canlı sağlamlıq göstəricilərini təftiş edin.',
      href: '/admin/system',
    });
  }

  if (failedJobsCount > 0) {
    computedRecommendations.push({
      id: 'rec-failed-jobs',
      severity: 'critical',
      title: `${failedJobsCount} uğursuz növbə tapşırığı`,
      why: `${affectedQueuesCount} növbə üzrə tapşırıqlarda icra xətası qeydə alınıb.`,
      evidenceAt: undefined,
      stale: false,
      suggestedStep: 'Əməliyyatlar bölməsində xəta səbəblərinə baxın.',
      href: '/admin/operations',
    });
  }

  if (externalUnconfirmed > 0) {
    computedRecommendations.push({
      id: 'rec-external-unconfirmed',
      severity: 'attention',
      title: `${externalUnconfirmed} təsdiq gözləyən xarici müraciət`,
      why: 'Xarici qəbul sistemindən təsdiq daxil olmayıb. Dublikat yaratmamaq üçün avtomatik təkrar göndərilmir.',
      evidenceAt: undefined,
      stale: false,
      suggestedStep: 'Xarici müraciətlər siyahısında əl ilə yoxlayın.',
      href: '/admin/applications?kind=external',
    });
  }

  if (data?.lastImport?.error) {
    computedRecommendations.push({
      id: 'rec-import-error',
      severity: 'critical',
      title: 'Son elan idxalında xəta',
      why: data.lastImport.error,
      evidenceAt: data.lastImport.finishedAt || data.lastImport.startedAt,
      stale: false,
      suggestedStep: 'Elanlar bölməsində mənbə vəziyyətlərini yoxlayın.',
      href: '/admin/listings',
    });
  }

  if (queuesUnavailable.length > 0) {
    computedRecommendations.push({
      id: 'rec-queues-unavail',
      severity: 'attention',
      title: 'Bəzi növbələr oxuna bilmədi',
      why: `${queuesUnavailable.join(', ')}: bu növbələrdə xəta olub-olmadığı bilinmir (sıfır xəta demək deyil).`,
      evidenceAt: undefined,
      stale: true,
      suggestedStep: 'Əməliyyatlar bölməsində növbə infrastrukturunu yoxlayın.',
      href: '/admin/operations',
    });
  }

  const activeRecommendations =
    recommendationsStatus === 'authoritative'
      ? serverRecommendations
      : computedRecommendations;


  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />

      <main className="flex-1 p-4 sm:p-6 md:p-10 w-full max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-neutral-dark">Ümumi baxış</h1>
            <p className="text-xs sm:text-sm text-neutral-dark/65 mt-1">Platformanın cari əməliyyat vəziyyəti və əsas göstəriciləri.</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-xl border border-neutral-dark/20 bg-background px-4 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 min-h-11 inline-flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Yenilə</span>
          </button>
        </div>

        <Notices error={error} />

        {loading && !data && <AdminLoadingState message="Göstəricilər yüklənir..." />}

        {data && (
          <>
            {(data.features || []).some((f) => f.paused) && (
              <div role="status" className="rounded-2xl bg-amber-50 border border-amber-200/80 p-4 text-sm text-amber-900 flex items-start gap-3 shadow-xs">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="font-semibold">Müvəqqəti dayandırılmış funksiyalar var:</p>
                  <ul className="mt-1 list-disc list-inside text-xs space-y-0.5">
                    {(data.features || [])
                      .filter((f) => f.paused)
                      .map((f) => (
                        <li key={f.key}>
                          <span className="font-medium">{f.label}</span>
                          {f.reason ? ` (${f.reason})` : ''}
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            )}

            <section aria-label="Əsas göstəricilər" className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="İstifadəçilər"
                value={data.users?.total ?? 0}
                detail={`${data.users?.verified ?? 0} təsdiqlənmiş · ${data.users?.suspended ?? 0} dayandırılmış`}
                href="/admin/users"
                icon={Users}
              />
              <StatCard
                label="Şirkətlər"
                value={sum(data.companies)}
                detail={`${data.companies?.PENDING ?? 0} gözləyir · ${data.companies?.SUSPENDED ?? 0} dayandırılmış`}
                href="/admin/businesses"
                icon={Building2}
              />
              <StatCard
                label="Xarici elanlar"
                value={data.jobs?.ACTIVE ?? 0}
                detail={`${data.jobs?.CLOSED ?? 0} bağlı · ${data.jobs?.hidden ?? 0} gizli`}
                href="/admin/listings"
                icon={Briefcase}
              />
              <StatCard
                label="Uyğunluqlar (24 saat)"
                value={data.matchesLast24h ?? 0}
                detail="Namizəd və vakansiya uyğunlaşmaları"
                icon={Activity}
              />
              <StatCard
                label="AISE müraciətləri"
                value={sum(data.applications?.native)}
                detail={Object.entries(data.applications?.native || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}
                href="/admin/applications"
                icon={FileText}
              />
              <StatCard
                label="Xarici müraciətlər"
                value={sum(data.applications?.external)}
                detail={`${data.applications?.external?.SUBMITTED ?? 0} qəbul təsdiqli · ${externalUnconfirmed} təsdiq gözləyən`}
                href="/admin/applications?kind=external"
                icon={FileText}
              />
              <StatCard
                label="Növbə xətaları"
                value={
                  failedJobsCount > 0 ? (
                    <StatusPill tone="bad">{failedJobsCount} uğursuz tapşırıq</StatusPill>
                  ) : !failuresKnown || queuesUnavailable.length > 0 ? (
                    <StatusPill tone="unknown">Məlum deyil</StatusPill>
                  ) : (
                    <StatusPill tone="ok">0 uğursuz tapşırıq</StatusPill>
                  )
                }
                detail={
                  queuesUnavailable.length > 0
                    ? `${queuesUnavailable.join(', ')} növbəsi oxuna bilmədi${affectedQueuesCount > 0 ? `; ${affectedQueuesCount} oxunan növbədə xəta var` : ''}`
                    : !failuresKnown
                      ? 'Növbə məlumatı gəlmədi'
                      : affectedQueuesCount > 0
                        ? `${affectedQueuesCount} aktiv növbədə xəta var`
                        : 'Oxunan növbələrdə xəta qeydə alınmayıb'
                }
                href="/admin/operations"
                icon={Activity}
              />
              <StatCard
                label="Sistem vəziyyəti"
                value={<StatusPill tone={healthState.tone}>{healthState.label}</StatusPill>}
                detail={healthState.detail}
                href="/admin/system"
              />
            </section>

            {/* Diagnostic Recommendations Section */}
            <section className={`${CARD} p-6 space-y-4`} aria-labelledby="recommendations-title">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-dark/5 pb-3">
                <div className="flex items-center gap-2">
                  <Compass className="h-5 w-5 text-primary" aria-hidden="true" />
                  <h2 id="recommendations-title" className="font-serif text-lg font-bold text-neutral-dark">
                    Tövsiyə olunan addımlar
                  </h2>
                </div>
                <span className="text-xs text-neutral-dark/60 font-medium">
                  {recommendationsStatus === 'authoritative'
                    ? 'Avtoritativ server tövsiyələri'
                    : 'Lokal diaqnostik təhlil'}
                </span>
              </div>

              {serverRecommendationsResponse?.checked?.some((c) => c.status === 'unknown') && (
                <div role="status" className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs text-slate-800 space-y-1">
                  <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-slate-700" /> Bəzi sahələrin yoxlanış statusu məlum deyil
                  </p>
                  <p className="text-slate-700">
                    Aşağıdakı sahələr üzrə yoxlama aparıla bilmədi:{' '}
                    {serverRecommendationsResponse.checked
                      .filter((c) => c.status === 'unknown')
                      .map((c) => c.area)
                      .join(', ')}
                    . Bu, heç bir xəta olmadığı demək deyil.
                  </p>
                </div>
              )}

              {activeRecommendations.length === 0 ? (
                <div className="flex items-start gap-3 py-3 text-sm text-neutral-dark/80">
                  <CheckCircle2 className="h-5 w-5 text-green-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-neutral-dark">
                      {serverRecommendationsResponse?.checked?.some((c) => c.status === 'unknown')
                        ? 'Təcili addım tələb olunmur (lakin bəzi yoxlamalar natamamdır)'
                        : 'Təcili addım tələb olunmur'}
                    </p>
                    <p className="text-xs text-neutral-dark/65 mt-0.5">
                      {serverRecommendationsResponse?.checked?.some((c) => c.status === 'unknown')
                        ? 'Yoxlanmış sahələrdə problem aşkarlanmadı, lakin statusu məlum olmayan sahələr əl ilə təftiş edilməlidir.'
                        : 'Sistem monitorinqi: yoxlanılan bütün sahələr cari parametrlər daxilindədir.'}
                    </p>
                  </div>
                </div>
              ) : (
                <ul className="text-sm space-y-3 divide-y divide-neutral-dark/5">
                  {activeRecommendations.map((rec) => (
                    <li
                      key={rec.id}
                      className={`pt-3 first:pt-0 space-y-1.5 ${
                        rec.status === 'unknown'
                          ? 'p-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/50'
                          : ''
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                              rec.status === 'unknown'
                                ? 'bg-slate-100 text-slate-800 border border-slate-300'
                                : rec.severity === 'critical'
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : rec.severity === 'attention'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                            }`}
                          >
                            {rec.status === 'unknown'
                              ? 'Məlum deyil'
                              : rec.severity === 'critical'
                              ? 'Kritik'
                              : rec.severity === 'attention'
                              ? 'Diqqət'
                              : 'Məlumat'}
                          </span>
                          <span className="font-bold text-neutral-dark">{rec.title}</span>
                        </div>
                        <div className="text-[11px] text-neutral-dark/50 min-w-0 max-w-full flex flex-wrap items-center gap-1 break-words">
                          <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>
                            {rec.freshness?.source
                              ? `${rec.freshness.source} · ${
                                  rec.freshness.ageSeconds != null
                                    ? `${rec.freshness.ageSeconds} san əvvəl`
                                    : rec.evidenceAt
                                    ? formatDate(rec.evidenceAt)
                                    : 'canlı'
                                }`
                              : rec.evidenceAt
                              ? formatDate(rec.evidenceAt)
                              : 'Server monitorinqi'}
                          </span>
                          {rec.stale && <span className="text-amber-700 font-semibold">(Köhnəlmiş)</span>}
                        </div>
                      </div>

                      <p className="text-xs text-neutral-dark/75 leading-relaxed">{rec.why}</p>

                      <div className="pt-1 flex items-center justify-between">
                        <span className="text-xs font-medium text-neutral-dark/65">
                          Tövsiyə olunan addım: {rec.suggestedStep}
                        </span>
                        {rec.href && (
                          rec.canAct !== false ? (
                            <Link
                              href={rec.href}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline min-h-11 px-2 -mr-2"
                            >
                              <span>Bax</span>
                              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                            </Link>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-xs text-neutral-dark/45 cursor-not-allowed min-h-11 px-2 -mr-2 select-none"
                              title={rec.requiredPermission ? `İcazə tələb olunur: ${rec.requiredPermission}` : 'İcazəniz çatmır'}
                            >
                              <span>Bax ({rec.requiredPermission ? `${rec.requiredPermission} tələb olunur` : 'icazəsiz'})</span>
                            </span>
                          )
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={`${CARD} p-6 space-y-4`} aria-labelledby="failures-title">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-dark/5 pb-3">
                <h2 id="failures-title" className="font-serif text-lg font-bold text-neutral-dark">
                  Diqqət tələb edən əməliyyatlar
                </h2>
                <Link href="/admin/operations" className="tap-inline text-xs font-semibold text-primary hover:underline">
                  Əməliyyatlar bölməsinə keçid →
                </Link>
              </div>

              {!hasAnyAttentionItem ? (
                <div className="flex items-start gap-3 py-3 text-sm text-neutral-dark/80">
                  <CheckCircle2 className="h-5 w-5 text-green-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-neutral-dark">
                      Bu sayğaclarda heç bir xəta qeydə alınmayıb (son 7 gün və cari sessiya)
                    </p>
                    <p className="text-xs text-neutral-dark/65 mt-0.5">
                      Aktiv növbə, e-poçt və ya CV generasiyası xətası mövcud deyil. Servislərin canlı texniki vəziyyəti üçün Sistem bölməsinin nəticələrinə baxın.
                    </p>
                  </div>
                </div>
              ) : (
                <ul className="text-sm space-y-3 divide-y divide-neutral-dark/5">
                  {!failuresKnown && (
                    <li className="pt-3 flex items-start justify-between gap-3">
                      <span className="font-medium text-neutral-dark">Xəta sayğacları əlçatan deyil</span>
                      <StatusPill tone="unknown">Məlum deyil</StatusPill>
                    </li>
                  )}
                  {queuesUnavailable.length > 0 && (
                    <li className="pt-3 flex items-start justify-between gap-3">
                      <div>
                        <span className="font-medium text-neutral-dark">Oxuna bilməyən növbələr</span>
                        <p className="text-xs text-neutral-dark/60 mt-0.5">{queuesUnavailable.join(', ')}: bu növbələrdə xəta olub-olmadığı bilinmir (sıfır demək deyil).</p>
                      </div>
                      <StatusPill tone="unknown">Məlum deyil</StatusPill>
                    </li>
                  )}
                  {failedJobsCount > 0 && (
                    <li className="pt-3 flex items-start justify-between gap-3">
                      <div>
                        <span className="font-medium text-neutral-dark">Uğursuz növbə tapşırıqları</span>
                        <p className="text-xs text-neutral-dark/60 mt-0.5">
                          Cəmi {failedJobsCount} uğursuz tapşırıq, {affectedQueuesCount} növbə üzrə:{' '}
                          {queues
                            .filter((q) => (q.failed || 0) > 0)
                            .map((q) => `${q.name} (${q.failed})`)
                            .join(', ')}
                        </p>
                      </div>
                      <StatusPill tone="bad">{failedJobsCount} tapşırıq</StatusPill>
                    </li>
                  )}
                  {externalUnconfirmed > 0 && (
                    <li className="pt-3 flex items-start justify-between gap-3">
                      <div>
                        <span className="font-medium text-neutral-dark">Çatdırılması təsdiqlənməmiş xarici müraciətlər</span>
                        <p className="text-xs text-neutral-dark/60 mt-0.5">
                          Qeyd: Bu sistem nasazlığı deyil, qəbul edən xarici saytın təsdiq verməməsidir. Təkrarlanma riskinə görə avtomatik göndərilmir, əl ilə yoxlanılmalıdır.
                        </p>
                      </div>
                      <StatusPill tone="warn">{externalUnconfirmed} müraciət</StatusPill>
                    </li>
                  )}
                  {tailoredCvFailures7d > 0 && (
                    <li className="pt-3 flex items-center justify-between">
                      <div>
                        <span className="text-neutral-dark/80">Uğursuz fərdi CV tərtibi</span>
                        <span className="text-xs text-neutral-dark/50 ml-1.5">(son 7 gün)</span>
                      </div>
                      <strong className="text-red-700">{tailoredCvFailures7d}</strong>
                    </li>
                  )}
                  {emailFailuresSession > 0 && (
                    <li className="pt-3 flex items-center justify-between">
                      <div>
                        <span className="text-neutral-dark/80">Uğursuz e-poçt cəhdləri</span>
                        <span className="text-xs text-neutral-dark/50 ml-1.5">(cari sessiya / restart-dan bəri)</span>
                      </div>
                      <strong className="text-red-700">{emailFailuresSession}</strong>
                    </li>
                  )}
                  {data.lastImport?.error && (
                    <li className="pt-3">
                      <span className="font-medium text-red-700">Son idxal xətası:</span>
                      <p className="text-xs font-mono text-neutral-dark/75 mt-1 bg-neutral-dark/5 p-2 rounded-lg break-words">
                        {data.lastImport.error}
                      </p>
                    </li>
                  )}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
