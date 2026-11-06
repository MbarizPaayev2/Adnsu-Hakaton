'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AdminHeader, useAdminMe } from '@/components/admin-header';
import { adminCall, CARD, ConfirmDialog, Notices, StatusPill, when } from '@/components/admin-ui';

interface Health {
  config: { enabled: boolean; transport: 'sink' | 'live'; realRecipientsAuthorized: boolean; recipientAllowlistSize: number; automationAvailable: boolean; inboundEnabled: boolean; limits: { perUserPerDay: number; globalPerDay: number; perRecipientPerDay: number; maxAttempts: number } };
  flags: { key: string; label: string; paused: boolean; reason: string | null; updatedAt: string | null }[];
  queue: { queued: number; sending: number; staleSending: number; oldestQueuedAgeMinutes: number | null; held: Record<string, number> };
  states: { total: Record<string, number>; changedLast24h: Record<string, number> };
  delivery7d: { providerAccepted: number; delivered: number; bounced: number; complained: number; deliveredPercent: number | null; bouncedPercent: number | null; complainedPercent: number | null; note: string };
  sendingToday: { attempts: number; globalLimit: number };
  attemptFailures24h: Record<string, number>;
  suppressedAddresses: number;
  uncertain: { id: string; since: string | null; ageMinutes: number | null; reason: string | null; attempts: number; jobTitle: string; jobCompany: string; recipientDomain: string; candidate: string }[];
}
interface Funnel { windowDays: number; stages: { stage: string; count: number | null; note?: string; ofWhichAutomatic?: number }[] }

const STAGE_LABELS: Record<string, string> = { viewed: 'Baxılıb', prepared: 'Hazırlanıb', approved: 'Təsdiqlənib', provider_accepted: 'E-poçt xidməti qəbul edib', delivered: 'Qəbuledicinin serveri qəbul edib', replied: 'Cavab', interview: 'Müsahibə', offer: 'Təklif', hired: 'İşə qəbul' };
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

export default function AdminEmailPage() {
  const me = useAdminMe();
  const canControl = !!me?.permissions.includes('ops.control');
  const [health, setHealth] = useState<Health | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pausing, setPausing] = useState<Health['flags'][number] | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, f] = await Promise.all([adminCall<Health>('ops/email'), adminCall<Funnel>('ops/email/funnel?days=30')]);
      setHealth(h); setFunnel(f);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />
      <main className="flex-1 p-6 md:p-10 w-full max-w-6xl mx-auto space-y-6">
        <h1 className="font-serif text-2xl font-bold text-neutral-dark">E-poçt müraciətləri</h1>
        <Notices notice={notice} error={error} />
        {health && (
          <>
            <section className={`${CARD} p-6 space-y-3`} aria-labelledby="mode-title">
              <h2 id="mode-title" className="font-serif text-lg font-bold">Rejim və dayandırma</h2>
              <p className="text-sm">
                {health.config.enabled ? <StatusPill tone="ok">Aktiv</StatusPill> : <StatusPill tone="muted">Söndürülüb</StatusPill>}{' '}
                {health.config.transport === 'sink' ? <StatusPill tone="warn">Sınaq qutusu (heç nə göndərilmir)</StatusPill> : <StatusPill tone="bad">Canlı göndəriş</StatusPill>}{' '}
                {health.config.transport === 'live' && (health.config.realRecipientsAuthorized ? <StatusPill tone="bad">Real alıcılara icazə var</StatusPill> : <StatusPill tone="warn">Yalnız icazə siyahısı ({health.config.recipientAllowlistSize})</StatusPill>)}
              </p>
              <p className="text-xs text-neutral-dark/65">Limitlər: istifadəçi/gün {health.config.limits.perUserPerDay}, ümumi/gün {health.config.limits.globalPerDay}, alıcı/gün {health.config.limits.perRecipientPerDay}, maksimum cəhd {health.config.limits.maxAttempts}. Bugünkü cəhdlər: {health.sendingToday.attempts}/{health.sendingToday.globalLimit}.</p>
              <ul className="divide-y divide-neutral-dark/5">
                {health.flags.map((f) => (
                  <li key={f.key} className="py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                    <div><p className="font-medium">{f.label}</p><p className="text-xs text-neutral-dark/60">{f.paused ? `Dayandırılıb${f.reason ? `: ${f.reason}` : ''} · ${when(f.updatedAt)}` : 'İşləyir'}</p></div>
                    <span className="flex items-center gap-2">
                      {f.paused ? <StatusPill tone="warn">Dayandırılıb</StatusPill> : <StatusPill tone="ok">İşləyir</StatusPill>}
                      {canControl && (f.paused
                        ? <button className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold text-primary hover:bg-neutral-dark/5 border border-primary/20 transition-colors" onClick={async () => { try { await adminCall(`ops/features/${f.key}`, 'PUT', { paused: false }); setNotice(`${f.label}: davam etdirildi.`); await load(); } catch (e) { setError((e as Error).message); } }}>Davam etdir</button>
                        : <button className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 border border-red-200 transition-colors" onClick={() => setPausing(f)}>Təcili dayandır</button>)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className={`${CARD} p-6 space-y-3`} aria-labelledby="queue-title">
              <h2 id="queue-title" className="font-serif text-lg font-bold">Növbə</h2>
              <dl className="grid gap-3 sm:grid-cols-4 text-sm">
                <div><dt className="text-xs text-neutral-dark/60">Növbədə</dt><dd className="text-xl font-semibold">{health.queue.queued}</dd></div>
                <div><dt className="text-xs text-neutral-dark/60">Göndərilir</dt><dd className="text-xl font-semibold">{health.queue.sending}</dd></div>
                <div><dt className="text-xs text-neutral-dark/60">Ən köhnə (dəq)</dt><dd className="text-xl font-semibold">{health.queue.oldestQueuedAgeMinutes ?? '—'}</dd></div>
                <div><dt className="text-xs text-neutral-dark/60">İlişmiş göndəriş</dt><dd className={`text-xl font-semibold ${health.queue.staleSending ? 'text-red-700' : ''}`}>{health.queue.staleSending}</dd></div>
              </dl>
              {Object.keys(health.queue.held).length > 0 && <p className="text-xs text-neutral-dark/70">Gözləmə səbəbləri: {Object.entries(health.queue.held).map(([k, v]) => `${k} ${v}`).join(', ')}</p>}
              <p className="text-xs text-neutral-dark/70">Vəziyyətlər: {Object.entries(health.states.total).map(([k, v]) => `${k} ${v}`).join(', ') || 'hələ yoxdur'}</p>
            </section>

            <section className={`${CARD} p-6 space-y-3`} aria-labelledby="delivery-title">
              <h2 id="delivery-title" className="font-serif text-lg font-bold">Çatdırılma (son 7 gün, cəmi)</h2>
              <dl className="grid gap-3 sm:grid-cols-4 text-sm">
                <div><dt className="text-xs text-neutral-dark/60">Xidmət qəbul etdi</dt><dd className="text-xl font-semibold">{health.delivery7d.providerAccepted}</dd></div>
                <div><dt className="text-xs text-neutral-dark/60">Qəbuledici serveri qəbul etdi</dt><dd className="text-xl font-semibold">{health.delivery7d.delivered} <span className="text-sm font-normal">({pct(health.delivery7d.deliveredPercent)})</span></dd></div>
                <div><dt className="text-xs text-neutral-dark/60">Qaytarıldı</dt><dd className="text-xl font-semibold">{health.delivery7d.bounced} <span className="text-sm font-normal">({pct(health.delivery7d.bouncedPercent)})</span></dd></div>
                <div><dt className="text-xs text-neutral-dark/60">Şikayət</dt><dd className="text-xl font-semibold">{health.delivery7d.complained} <span className="text-sm font-normal">({pct(health.delivery7d.complainedPercent)})</span></dd></div>
              </dl>
              <p className="text-xs text-neutral-dark/65">{health.delivery7d.note} Bloklanmış ünvanlar: {health.suppressedAddresses}.</p>
              {Object.keys(health.attemptFailures24h).length > 0 && <p className="text-xs text-neutral-dark/70">Son 24 saatda cəhd xətaları: {Object.entries(health.attemptFailures24h).map(([k, v]) => `${k} ${v}`).join(', ')}</p>}
            </section>

            <section className={`${CARD} p-6 space-y-3`} aria-labelledby="uncertain-title">
              <h2 id="uncertain-title" className="font-serif text-lg font-bold">Nəticəsi bəlli olmayan göndərişlər</h2>
              <p className="text-xs text-neutral-dark/65">Bunlar heç vaxt avtomatik təkrarlanmır. Qərarı namizəd verir; operator yalnız vəziyyəti görür. Məktub və CV operatorlara açıq deyil.</p>
              {health.uncertain.length === 0 ? <p className="text-sm text-neutral-dark/60">Yoxdur.</p> : (
                <ul className="divide-y divide-neutral-dark/5 text-sm">
                  {health.uncertain.map((u) => <li key={u.id} className="py-2 flex flex-wrap justify-between gap-2"><span>{u.jobTitle} · {u.jobCompany} → {u.recipientDomain} · {u.candidate}</span><span className="text-xs text-neutral-dark/60">{u.ageMinutes ?? '?'} dəq · {u.reason} · cəhd {u.attempts}</span></li>)}
                </ul>
              )}
            </section>
          </>
        )}
        {funnel && (
          <section className={`${CARD} p-6 space-y-3`} aria-labelledby="funnel-title">
            <h2 id="funnel-title" className="font-serif text-lg font-bold">Gedişat (son {funnel.windowDays} gün, şəxsi məlumatsız)</h2>
            <ol className="grid gap-2 sm:grid-cols-3 text-sm">
              {funnel.stages.map((s) => <li key={s.stage} className="rounded-xl border border-neutral-dark/10 p-3"><p className="text-xs text-neutral-dark/60">{STAGE_LABELS[s.stage] ?? s.stage}</p><p className="text-xl font-semibold">{s.count ?? '—'}</p>{s.note && <p className="text-xs text-neutral-dark/60">{s.note}</p>}{s.ofWhichAutomatic !== undefined && <p className="text-xs text-neutral-dark/60">avtomatik: {s.ofWhichAutomatic}</p>}</li>)}
            </ol>
          </section>
        )}
      </main>
      {pausing && (
        <ConfirmDialog
          title={`${pausing.label}: dayandırılsın?`}
          description="Dayandırma serverdə dərhal bütün istifadəçilər üçün qüvvəyə minir. Növbədəkilər itmir, gözləyir. Audit jurnalına yazılır."
          confirmLabel="Dayandır" requireReason danger onClose={() => setPausing(null)}
          onConfirm={async (reason) => { await adminCall(`ops/features/${pausing.key}`, 'PUT', { paused: true, reason }); setNotice(`${pausing.label}: dayandırıldı.`); await load(); }}
        />
      )}
    </div>
  );
}
