'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AdminHeader, useAdminMe } from '@/components/admin-header';
import {
  adminCall,
  AdminEmptyState,
  AdminLoadingState,
  CARD,
  ConfirmDialog,
  Notices,
  PRIMARY,
  StatusPill,
  when,
} from '@/components/admin-ui';
import { Activity, AlertOctagon, CheckCircle2, Play, RefreshCw, RotateCcw, Server } from 'lucide-react';

interface Feature {
  key: string;
  label: string;
  paused: boolean;
  reason: string | null;
  updatedAt: string | null;
}
interface Run {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  listed: number;
  created: number;
  updated: number;
  closed: number;
  detailFailures: number;
  error: string | null;
}
interface QueueCount {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  retryable: boolean;
}
interface FailedJob {
  queue: string;
  id: string;
  name: string;
  attemptsMade: number;
  failedAt: string | null;
  reason: string | null;
  retryable: boolean;
}

export default function AdminOperationsPage() {
  const me = useAdminMe();
  const canControl = !!me?.permissions.includes('ops.control');
  const [features, setFeatures] = useState<Feature[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [importPaused, setImportPaused] = useState(false);
  const [counts, setCounts] = useState<QueueCount[]>([]);
  const [failed, setFailed] = useState<FailedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pausing, setPausing] = useState<Feature | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [overview, imports, queues] = await Promise.all([
        adminCall('ops/overview'),
        adminCall('ops/imports'),
        adminCall('ops/queues'),
      ]);
      setFeatures(overview.features || []);
      setRuns(imports.runs || []);
      setImportPaused(imports.paused || false);
      setCounts(queues.counts || []);
      setFailed(queues.failed || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (message: string, fn: () => Promise<unknown>) => {
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />

      <main className="flex-1 p-4 sm:p-6 md:p-10 w-full max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-neutral-dark">Əməliyyatlar</h1>
            <p className="text-xs sm:text-sm text-neutral-dark/65 mt-1">Platformanın arxa plan işləri, idxal prosesləri və növbə vəziyyətləri.</p>
          </div>
          <button
            onClick={() => load()}
            disabled={loading}
            className="rounded-xl border border-neutral-dark/20 bg-background px-4 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 min-h-11 inline-flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Yenilə</span>
          </button>
        </div>

        <Notices notice={notice} error={error} onClearError={() => setError('')} />

        {/* Section 1: Feature Toggles */}
        <section className={`${CARD} p-5 sm:p-6 space-y-4`} aria-labelledby="features-title">
          <div className="space-y-1">
            <h2 id="features-title" className="font-serif text-lg font-bold text-neutral-dark">
              Funksiyaların dayandırılması
            </h2>
            <p className="text-xs text-neutral-dark/65 leading-relaxed">
              Dayandırma serverdə dərhal tətbiq olunur. Davam etdirmək canlı rejimi özü açmır — mühit qapısı, razılıq və qəbul tələbləri qüvvədə qalır.
            </p>
          </div>

          {features.length === 0 ? (
            <p className="text-xs text-neutral-dark/60 py-2">Konfiqurasiya edilmiş funksiya yoxdur.</p>
          ) : (
            <ul className="divide-y divide-neutral-dark/5" aria-label="Funksiya siyahısı">
              {features.map((f) => (
                <li key={f.key} className="py-3.5 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div className="space-y-0.5">
                    <p className="font-medium text-neutral-dark">{f.label}</p>
                    <p className="text-xs text-neutral-dark/60">
                      {f.paused ? `Dayandırılıb${f.reason ? `: ${f.reason}` : ''} · ${when(f.updatedAt)}` : 'İşləyir'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {f.paused ? <StatusPill tone="warn">Dayandırılıb</StatusPill> : <StatusPill tone="ok">İşləyir</StatusPill>}
                    {canControl &&
                      (f.paused ? (
                        <button
                          className="min-h-11 inline-flex items-center rounded-xl border border-neutral-dark/20 px-3.5 py-2 text-xs font-semibold hover:bg-neutral-dark/5 text-primary transition-colors"
                          onClick={() => act(`${f.label}: davam etdirildi.`, () => adminCall(`ops/features/${f.key}`, 'PUT', { paused: false }))}
                        >
                          Davam etdir
                        </button>
                      ) : (
                        <button
                          className="min-h-11 inline-flex items-center rounded-xl border border-red-200 px-3.5 py-2 text-xs font-semibold hover:bg-red-50 text-red-700 transition-colors"
                          onClick={() => setPausing(f)}
                        >
                          Dayandır
                        </button>
                      ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Section 2: Glorri Ingestion Runs */}
        <section className={`${CARD} p-5 sm:p-6 space-y-4`} aria-labelledby="imports-title">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-dark/5 pb-3">
            <div>
              <h2 id="imports-title" className="font-serif text-lg font-bold text-neutral-dark">
                Glorri idxalı
              </h2>
              <p className="text-xs text-neutral-dark/60 mt-0.5">Xarici vakansiya mənbələrindən son məlumat yeniləmələri.</p>
            </div>
            {canControl && (
              <button
                className={`${PRIMARY}`}
                disabled={importPaused}
                title={importPaused ? 'İdxal dayandırılıb' : undefined}
                onClick={() => act('İdxal növbəyə əlavə edildi.', () => adminCall('ops/imports/glorri', 'POST'))}
              >
                İndi idxal et
              </button>
            )}
          </div>

          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-neutral-dark/60 border-b border-neutral-dark/5">
                <tr>
                  <th scope="col" className="p-3 font-semibold">Başlayıb</th>
                  <th scope="col" className="p-3 font-semibold">Status</th>
                  <th scope="col" className="p-3 font-semibold">Siyahıda</th>
                  <th scope="col" className="p-3 font-semibold">Yeni / yenilənmiş / bağlanmış</th>
                  <th scope="col" className="p-3 font-semibold">Xəta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-dark/5">
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-xs text-neutral-dark/60">
                      Hələ idxal olmayıb.
                    </td>
                  </tr>
                )}
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-neutral-dark/[0.02] transition-colors">
                    <td className="p-3 whitespace-nowrap text-xs text-neutral-dark/80">{when(r.startedAt)}</td>
                    <td className="p-3 whitespace-nowrap">
                      <StatusPill tone={r.status === 'SUCCEEDED' ? 'ok' : r.status === 'RUNNING' ? 'muted' : r.status === 'PARTIAL' ? 'warn' : 'bad'}>
                        {r.status}
                      </StatusPill>
                    </td>
                    <td className="p-3 font-semibold text-neutral-dark">{r.listed}</td>
                    <td className="p-3 text-xs text-neutral-dark/80 whitespace-nowrap">
                      <span className="text-green-700 font-medium">+{r.created}</span> / {r.updated} / <span className="text-neutral-dark/50">{r.closed}</span>
                    </td>
                    <td className="p-3 text-xs text-neutral-dark/70 max-w-xs break-words">
                      {r.error || (r.detailFailures ? `${r.detailFailures} detal alınmadı` : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 3: Queues and Failed Jobs */}
        <section className={`${CARD} p-5 sm:p-6 space-y-4`} aria-labelledby="queues-title">
          <div className="space-y-1">
            <h2 id="queues-title" className="font-serif text-lg font-bold text-neutral-dark">
              Növbələr və uğursuz tapşırıqlar
            </h2>
            <p className="text-xs text-neutral-dark/60">Sistem tapşırıqlarının növbə vəziyyətləri və təkrar icra imkanları.</p>
          </div>

          <ul className="grid gap-3 grid-cols-1 sm:grid-cols-3 text-sm">
            {counts.map((q) => (
              <li
                key={q.name}
                className={`rounded-2xl border p-4 transition-all ${
                  q.failed > 0
                    ? 'border-red-200 bg-red-50/30'
                    : 'border-neutral-dark/10 bg-background'
                }`}
              >
                <p className="font-mono text-xs font-semibold text-neutral-dark truncate" title={q.name}>
                  {q.name}
                </p>
                <div className="mt-2 flex items-center justify-between text-xs text-neutral-dark/70">
                  <span>gözləyir {q.waiting} · işləyir {q.active}</span>
                  <span className={q.failed ? 'text-red-700 font-bold' : 'text-neutral-dark/40'}>
                    uğursuz {q.failed}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {failed.length > 0 && (
            <div className="pt-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-dark/60 mb-2">
                Uğursuz tapşırıqların siyahısı
              </h3>
              <ul className="divide-y divide-neutral-dark/5 text-sm" aria-label="Uğursuz tapşırıqlar">
                {failed.map((j) => (
                  <li key={`${j.queue}:${j.id}`} className="py-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <p className="font-mono text-xs font-medium text-neutral-dark">
                        {j.queue} · <span className="text-primary font-bold">{j.name}</span> · #{j.id}
                      </p>
                      <p className="text-xs text-neutral-dark/70 leading-relaxed break-words">
                        {when(j.failedAt)} · {j.attemptsMade} cəhd · <span className="text-red-700">{j.reason}</span>
                      </p>
                    </div>
                    <div>
                      {j.retryable && canControl ? (
                        <button
                          className="min-h-11 inline-flex items-center gap-1.5 rounded-xl border border-neutral-dark/20 px-3.5 py-2 text-xs font-semibold hover:bg-neutral-dark/5 text-primary transition-colors"
                          onClick={() =>
                            act('Tapşırıq təkrar növbəyə qoyuldu.', () =>
                              adminCall(`ops/queues/${j.queue}/jobs/${encodeURIComponent(j.id)}/retry`, 'POST')
                            )
                          }
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Təkrarla</span>
                        </button>
                      ) : (
                        <span className="text-xs text-neutral-dark/50 italic py-2 inline-block">
                          Buradan təkrarlanmır
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>

      {/* Feature Pause Dialog */}
      {pausing && (
        <ConfirmDialog
          title={`${pausing.label}: dayandırılsın?`}
          description="Dayandırma bütün istifadəçilər üçün dərhal qüvvəyə minir və audit jurnalına yazılır."
          confirmLabel="Dayandır"
          requireReason
          danger
          onClose={() => setPausing(null)}
          onConfirm={async (reason) => {
            await adminCall(`ops/features/${pausing.key}`, 'PUT', { paused: true, reason });
            setNotice(`${pausing.label}: dayandırıldı.`);
            await load();
          }}
        />
      )}
    </div>
  );
}
