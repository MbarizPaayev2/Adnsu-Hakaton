'use client';

import React, { useEffect, useState } from 'react';
import { AdminHeader, useAdminMe } from '@/components/admin-header';
import Link from 'next/link';
import { adminCall, CARD, Notices, SECONDARY, StatusPill, when } from '@/components/admin-ui';

interface Source {
  key: string; name: string; employer: string | null; collectionMethod: string; scope: string; accessReview: string; accessNote: string | null; enabled: boolean; scheduled: boolean;
  schedule: { mode: string; intervalMinutes: number; nextRunAt: string | null; consecutiveFailures: number; staleness: string; isPaused?: boolean; leaseUntil?: string | null; cooldownUntil?: string | null; cooldownReason?: string | null; cooldownCount?: number };
  operationalStatus?: 'COOLING_DOWN' | 'RUNNING' | 'HEALTHY' | 'DEGRADED' | 'CIRCUIT_BROKEN' | 'BLOCKED' | 'RATE_LIMITED' | 'PAUSED' | 'DISABLED' | 'RESTRICTED' | 'OVERDUE' | 'IDLE'; recommendedAction?: string;
  lastRunAt: string | null; lastRunStatus: string | null; lastSuccessAt: string | null; lastCompleteListingAt: string | null; lastError: string | null;
  lastRun: { discovered: number; accepted: number; rejected: number; skipped: number; expired: number; closed: number; listingComplete: boolean; closureSkipped: string | null; outcome?: string | null } | null;
  counts: { open: number; total: number; closed: number; expiredByDeadline: number; hidden: number; duplicates: number; emailApplicable: number };
}
interface Coverage { registeredEmployerTargets: number; employerTargetsWithAdapter: number; sourcesWithOpenPostings: number; openPostings: number; openPostingsWithEmailApplication: number; sources: Source[]; caveats: string[] }

const OPERATIONAL: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  COOLING_DOWN: { label: 'Soyutma rejimində', tone: 'bad' }, RUNNING: { label: 'İcra olunur', tone: 'warn' }, HEALTHY: { label: 'Sağlam', tone: 'ok' }, IDLE: { label: 'Hazırdır', tone: 'muted' }, DEGRADED: { label: 'Xəta var', tone: 'warn' }, RATE_LIMITED: { label: 'Limitə düşüb', tone: 'warn' },
  BLOCKED: { label: 'Bloklanıb', tone: 'bad' }, CIRCUIT_BROKEN: { label: 'Dayanıb (5+ xəta)', tone: 'bad' }, PAUSED: { label: 'Dayandırılıb', tone: 'muted' }, DISABLED: { label: 'Söndürülüb', tone: 'muted' },
  RESTRICTED: { label: 'Məhdudiyyət var', tone: 'bad' }, OVERDUE: { label: 'Gecikib', tone: 'warn' },
};
const SCHEDULE: Record<string, string> = { scheduled: 'cədvəllə yenilənir', paused: 'cədvəl dayandırılıb', manual: 'yalnız əl ilə (son əl icrasının məlumatı)' };
const REVIEW: Record<string, string> = { UNREVIEWED: 'Yoxlanmayıb', ROBOTS_ALLOWED_TERMS_PENDING: 'Robots icazə verir, şərtlər yoxlanmayıb', TERMS_REVIEWED_ALLOWED: 'Şərtlər yoxlanıb', RESTRICTED: 'Məhdudiyyət var' };
const OUTCOME: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  COMPLETE_CENSUS: { label: 'Siyahı tam yoxlanıb', tone: 'ok' }, NO_OPENINGS: { label: 'Açıq elan yoxdur', tone: 'muted' },
  BOUNDED_PROGRESS: { label: 'Məhdud həcmdə yenilənib', tone: 'warn' }, INVALID_DETAIL: { label: 'Bəzi elan detalları oxunmayıb', tone: 'warn' },
  UPSTREAM_FAILURE: { label: 'Mənbə əlçatan olmayıb', tone: 'bad' },
};

export default function AdminSourcesPage() {
  const me = useAdminMe();
  const [data, setData] = useState<Coverage | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => adminCall<Coverage>('ops/sources').then(setData).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  const canControl = !!me?.permissions?.includes('ops.control');
  /** One bounded operator action; the server decides (lease, pause, restrictions) and its Azerbaijani message is shown as is. */
  const act = async (key: string, label: string, call: () => Promise<unknown>) => {
    setBusy(key); setError(''); setNotice('');
    try { await call(); setNotice(label); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />
      <main className="flex-1 p-6 md:p-10 w-full max-w-6xl mx-auto space-y-6">
        <h1 className="font-serif text-2xl font-bold text-neutral-dark">Vakansiya mənbələri</h1>
        <Notices notice={notice} error={error} onClearError={() => setError('')} />
        <p className="text-xs text-neutral-dark/70">Bütün cədvəlli idxalı birdən dayandırmaq üçün <Link href="/admin/operations" className="underline">Əməliyyatlar</Link> səhifəsindəki “Cədvəllə vakansiya mənbələrinin yenilənməsi” açarından istifadə edin.</p>
        {data && (
          <>
            <section className={`${CARD} p-6`} aria-labelledby="coverage-title">
              <h2 id="coverage-title" className="font-serif text-lg font-bold">Əhatə (ölçülmüş)</h2>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div><dt className="text-xs text-neutral-dark/60">Siyahıya salınmış işəgötürən</dt><dd className="text-xl font-semibold">{data.registeredEmployerTargets}</dd><dd className="text-xs text-neutral-dark/60">Bunlardan kollektoru olan: {data.employerTargetsWithAdapter}</dd></div>
                <div><dt className="text-xs text-neutral-dark/60">Açıq vakansiyası olan mənbə</dt><dd className="text-xl font-semibold">{data.sourcesWithOpenPostings}</dd></div>
                <div><dt className="text-xs text-neutral-dark/60">Açıq elan (dublikatlar çıxılıb)</dt><dd className="text-xl font-semibold">{data.openPostings}</dd></div>
                <div><dt className="text-xs text-neutral-dark/60">E-poçtla müraciət mümkün olan</dt><dd className="text-xl font-semibold">{data.openPostingsWithEmailApplication}</dd></div>
              </dl>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-neutral-dark/70">{data.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
            </section>

            <section className={`${CARD} p-6`} aria-labelledby="sources-title">
              <h2 id="sources-title" className="font-serif text-lg font-bold">Mənbələrin vəziyyəti</h2>
              <div className="relative mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-neutral-dark/60">
                    <tr><th scope="col" className="p-2">Mənbə</th><th scope="col" className="p-2">Açıq / cəmi</th><th scope="col" className="p-2">Bağlı / müddəti bitmiş</th><th scope="col" className="p-2">E-poçt</th><th scope="col" className="p-2">Son uğurlu</th><th scope="col" className="p-2">Son tam siyahı</th><th scope="col" className="p-2">Son icra</th><th scope="col" className="p-2">İcazə</th><th scope="col" className="p-2">Vəziyyət və əməliyyat</th></tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-dark/5 align-top">
                    {data.sources.map((s) => (
                      <tr key={s.key}>
                        <th scope="row" className="p-2 text-left font-medium">{s.name}<div className="text-xs font-normal text-neutral-dark/60">{s.key} · {SCHEDULE[s.schedule.mode] ?? s.schedule.mode}{s.schedule.mode === 'scheduled' && s.schedule.staleness !== 'own_importer' ? ` (hər ${Math.round(s.schedule.intervalMinutes / 60)} saatdan bir)` : ''}{s.schedule.staleness === 'stale' ? ' · KÖHNƏLİB' : s.schedule.staleness === 'never_completed' ? ' · tam siyahı hələ yoxdur' : ''}{s.schedule.consecutiveFailures ? ` · ${s.schedule.consecutiveFailures} ardıcıl xəta` : ''}{s.enabled ? '' : ' · söndürülüb'}</div></th>
                        <td className="p-2">{s.counts.open} / {s.counts.total}</td>
                        <td className="p-2">{s.counts.closed} / {s.counts.expiredByDeadline}</td>
                        <td className="p-2">{s.counts.emailApplicable}</td>
                        <td className="p-2">{when(s.lastSuccessAt)}</td>
                        <td className="p-2">{when(s.lastCompleteListingAt)}</td>
                        <td className="p-2">
                          {s.lastRunStatus ? <StatusPill tone={s.lastRunStatus === 'SUCCEEDED' ? 'ok' : s.lastRunStatus === 'PARTIAL' || s.lastRunStatus === 'RUNNING' ? 'warn' : 'bad'}>{s.lastRunStatus}</StatusPill> : <span className="text-neutral-dark/60">heç vaxt</span>}
                          {s.lastRun && <div className="mt-1 text-xs text-neutral-dark/70">{s.lastRun.outcome && <span className="mr-1">{OUTCOME[s.lastRun.outcome]?.label ?? s.lastRun.outcome} ·</span>}tapılıb {s.lastRun.discovered}, qəbul {s.lastRun.accepted}, rədd {s.lastRun.rejected}, kənar {s.lastRun.skipped}, bağlanıb {s.lastRun.closed}{s.lastRun.closureSkipped ? ` · bağlanma atlanıb: ${s.lastRun.closureSkipped}` : ''}</div>}
                          {s.lastError && <div className="mt-1 text-xs text-red-700">{s.lastError}</div>}
                        </td>
                        <td className="p-2 text-xs">{REVIEW[s.accessReview] ?? s.accessReview}{s.accessNote && <div className="text-neutral-dark/60">{s.accessNote}</div>}</td>
                        <td className="p-2 text-xs" data-testid={`source-ops-${s.key}`}>
                          {s.operationalStatus && <StatusPill tone={OPERATIONAL[s.operationalStatus]?.tone ?? 'muted'}>{OPERATIONAL[s.operationalStatus]?.label ?? s.operationalStatus}</StatusPill>}
                          {s.recommendedAction && <div className="mt-1 text-neutral-dark/70">{s.recommendedAction}</div>}
                          {s.schedule.leaseUntil && new Date(s.schedule.leaseUntil) > new Date() && <div className="mt-1 font-semibold">İcra olunur…</div>}
                          {s.schedule.cooldownUntil && <div className="mt-1 font-semibold" data-testid={`cooldown-${s.key}`}>Soyutma {when(s.schedule.cooldownUntil)} tarixinə qədər{s.schedule.cooldownReason ? ` · ${s.schedule.cooldownReason}` : ''}</div>}
                          {canControl && s.key !== 'glorri' && s.enabled && s.accessReview !== 'RESTRICTED' && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button type="button" className={SECONDARY} disabled={busy !== null || !!s.schedule.cooldownUntil || (!!s.schedule.leaseUntil && new Date(s.schedule.leaseUntil) > new Date())}
                                onClick={() => void act(s.key, `${s.name}: icra başladıldı. Nəticə bir neçə dəqiqəyə “Son icra” sütununda görünəcək.`, () => adminCall(`ops/sources/${s.key}/run-now`, 'POST'))}>
                                İndi işlət
                              </button>
                              {(s.schedule.cooldownUntil || s.schedule.consecutiveFailures > 0) && (
                                <>
                                  <button type="button" className={SECONDARY} disabled={busy !== null}
                                    onClick={() => void act(s.key, `${s.name}: soyutma və xəta sayğacı sıfırlandı; cədvəl mənbəni yenidən yoxlayacaq.`, () => adminCall(`ops/sources/${s.key}/recover`, 'POST', {}))}>
                                    Bərpa et
                                  </button>
                                  <button type="button" className={SECONDARY} disabled={busy !== null}
                                    onClick={() => void act(s.key, `${s.name}: bərpa edildi və icra başladıldı.`, () => adminCall(`ops/sources/${s.key}/recover`, 'POST', { run: true }))}>
                                    Bərpa et və işlət
                                  </button>
                                </>
                              )}
                              {s.scheduled && (
                                <button type="button" className={SECONDARY} disabled={busy !== null}
                                  onClick={() => void act(s.key, s.schedule.isPaused ? `${s.name}: cədvəl davam etdirildi.` : `${s.name}: cədvəl dayandırıldı.`, () => adminCall(`ops/sources/${s.key}/schedule`, 'PUT', { paused: !s.schedule.isPaused }))}>
                                  {s.schedule.isPaused ? 'Cədvəli davam etdir' : 'Cədvəli dayandır'}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
