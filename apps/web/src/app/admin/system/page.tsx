'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AdminHeader, useAdminMe } from '@/components/admin-header';
import { adminCall, AdminLoadingState, CARD, Notices, StatusPill, type StatusTone, when } from '@/components/admin-ui';
import { ageTone, evaluateHealth, type HealthPayload, RESTORE_TEST_MAX_DAYS } from '@/lib/admin/health';
import { AlertCircle, AlertTriangle, CheckCircle2, Database, HardDrive, RefreshCw, Server, ShieldCheck } from 'lucide-react';

const SERVICE_LABELS = {
  database: 'Verilənlər bazası (PostgreSQL)',
  redis: 'Redis (növbələr və sessiyalar)',
  matching: 'Uyğunluq servisi (Matching Engine)',
  applyWorker: 'Xarici müraciət işçisi (Apply Worker)',
};

export default function AdminSystemPage() {
  const me = useAdminMe();
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminCall<HealthPayload>('ops/health')
      .then(setHealth)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const backupTone = (hours?: number | null): StatusTone => ageTone(hours);

  const formatUptime = (seconds?: number) => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'məlum deyil';
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} dəqiqə`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours} saat ${remMins} dəqiqə`;
  };

  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />

      <main className="flex-1 p-4 sm:p-6 md:p-10 w-full max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-neutral-dark">Sistem: buraxılış və vəziyyət</h1>
            <p className="text-xs sm:text-sm text-neutral-dark/65 mt-1">İnfrastrukturun cari durumu, servislərin gecikməsi və ehtiyat nüsxələr.</p>
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

        <div className="rounded-2xl bg-neutral-dark/[0.03] border border-neutral-dark/10 p-4 text-xs sm:text-sm text-neutral-dark/75 leading-relaxed">
          Bu səhifə kodu yerləşdirmir və serverləri yenidən başlatmır. Yeni versiya serverdə <code className="font-mono text-xs bg-neutral-dark/5 px-1.5 py-0.5 rounded">scripts/deploy.sh</code> ilə yerləşdirilir; burada yalnız hazırkı buraxılış və ölçülən vəziyyət göstərilir.
        </div>

        <Notices error={error} onClearError={() => setError('')} />

        {loading && !health && <AdminLoadingState message="Sistem sağlamlığı yoxlanılır..." />}

        {health && (
          <div className="space-y-6">
            {(() => {
              const verdict = evaluateHealth({ loading: false, health });
              return (
                <div role="status" className={`${CARD} p-4 flex flex-wrap items-center gap-3`}>
                  <StatusPill tone={verdict.tone}>{verdict.label}</StatusPill>
                  <span className="text-sm text-neutral-dark/75">{verdict.detail}</span>
                </div>
              );
            })()}
            {/* Release Info */}
            <section className={`${CARD} p-5 sm:p-6 space-y-3`} aria-labelledby="release-title">
              <h2 id="release-title" className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                <span>Buraxılış</span>
              </h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm pt-1">
                <dt className="font-semibold text-neutral-dark/70">Mühit</dt>
                <dd>
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold uppercase ${health.environment === 'production' ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-900 border border-amber-300'}`}>
                    {health.environment ?? 'məlum deyil'}
                  </span>
                </dd>

                <dt className="font-semibold text-neutral-dark/70">Commit</dt>
                <dd className="font-mono text-xs text-neutral-dark font-medium">
                  {health.release?.sha ? health.release.sha.slice(0, 12) : 'məlum deyil (RELEASE_SHA qurulmayıb)'}
                </dd>

                <dt className="font-semibold text-neutral-dark/70">API işləmə müddəti</dt>
                <dd className="text-neutral-dark font-medium">{formatUptime(health.uptimeSeconds)}</dd>
              </dl>
            </section>

            {/* Core Services */}
            <section className={`${CARD} p-5 sm:p-6 space-y-3`} aria-labelledby="services-title">
              <h2 id="services-title" className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
                <Database className="h-4 w-4 text-primary" />
                <span>Servislər</span>
              </h2>
              <ul className="divide-y divide-neutral-dark/5 text-sm" aria-label="Servislər siyahısı">
                {(Object.keys(SERVICE_LABELS) as (keyof typeof SERVICE_LABELS)[]).map((key) => {
                  const check = health.services?.[key];
                  return (
                    <li key={key} className="py-3 flex flex-wrap items-center justify-between gap-3">
                      <span className="font-medium text-neutral-dark">{SERVICE_LABELS[key]}</span>
                      <div className="flex items-center gap-2">
                        {!check || typeof check.ok !== 'boolean' ? (
                          <StatusPill tone="unknown">Məlum deyil</StatusPill>
                        ) : check.ok ? (
                          <StatusPill tone="ok">İşləyir · {check.ms} ms</StatusPill>
                        ) : (
                          <StatusPill tone="bad">Əlçatmaz</StatusPill>
                        )}
                        {check && check.ok === false && check.error && (
                          <span className="text-xs text-red-700 font-mono bg-red-50 px-2 py-0.5 rounded border border-red-200">
                            {check.error}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Backup & Disaster Recovery */}
            <section className={`${CARD} p-5 sm:p-6 space-y-3`} aria-labelledby="backup-title">
              <h2 id="backup-title" className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <span>Ehtiyat nüsxə</span>
              </h2>

              {health.backup?.known ? (
                <ul className="text-sm space-y-2.5 divide-y divide-neutral-dark/5" aria-label="Ehtiyat nüsxə məlumatları">
                  <li className="pt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-neutral-dark/80">Son ehtiyat nüsxə: {when(health.backup.lastBackupAt)}</span>
                    <StatusPill tone={backupTone(health.backup.lastBackupAgeHours)}>
                      {typeof health.backup.lastBackupAgeHours !== 'number' ? 'vaxtı məlum deyil' : `${health.backup.lastBackupAgeHours} saat əvvəl`}
                    </StatusPill>
                  </li>

                  <li className="pt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-neutral-dark/80">
                      Xarici yaddaşa doğrulanmış nüsxə: {health.backup.lastOffhostCopyAt ? when(health.backup.lastOffhostCopyAt) : 'yoxdur'}
                    </span>
                    {health.backup.lastOffhostCopyAgeHours != null && health.backup.lastOffhostResult === 'VERIFIED' ? (
                      <StatusPill tone={backupTone(health.backup.lastOffhostCopyAgeHours)}>
                        {`${health.backup.lastOffhostCopyAgeHours} saat əvvəl`}
                      </StatusPill>
                    ) : (
                      health.backup.lastOffhostResult ? (
                        <StatusPill tone="bad">uğursuz ({health.backup.lastOffhostResult})</StatusPill>
                      ) : (
                        <StatusPill tone="unknown">sübut yoxdur</StatusPill>
                      )
                    )}
                  </li>

                  <li className="pt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-neutral-dark/80">
                      Son bərpa testi: {health.backup.lastRestoreTestAt ? when(health.backup.lastRestoreTestAt) : 'hələ edilməyib'}
                    </span>
                    {health.backup.lastRestoreTestResult === 'PASSED' && (health.backup.lastRestoreTestAgeHours ?? 9999) <= RESTORE_TEST_MAX_DAYS * 24 ? (
                      <StatusPill tone="ok">PASSED</StatusPill>
                    ) : health.backup.lastRestoreTestResult === 'PASSED' ? (
                      <StatusPill tone="warn">köhnəlib (8 gündən çox)</StatusPill>
                    ) : health.backup.lastRestoreTestResult ? (
                      <StatusPill tone="bad">{health.backup.lastRestoreTestResult}</StatusPill>
                    ) : (
                      <StatusPill tone="unknown">sübut yoxdur</StatusPill>
                    )}
                  </li>

                  {health.backup.lastBackupFailureAt && (
                    <li className="pt-2 flex items-start gap-2 text-red-700 bg-red-50 p-2.5 rounded-xl border border-red-200">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div className="text-xs">
                        <span className="font-bold">Xəta ({when(health.backup.lastBackupFailureAt)}):</span> {health.backup.lastBackupError}
                      </div>
                    </li>
                  )}
                </ul>
              ) : (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-900 flex items-start gap-2.5">
                  <AlertCircle className="h-5 w-5 shrink-0 text-red-700 mt-0.5" />
                  <p className="leading-relaxed">
                    <span className="inline-block mr-1.5"><StatusPill tone="unknown">Məlum deyil</StatusPill></span>
                    {health.backup?.reason ?? 'Status sübutu gəlmədi'}. Ehtiyat nüsxənin vəziyyəti bilinmədikdə “yaxşı” sayılmır.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
