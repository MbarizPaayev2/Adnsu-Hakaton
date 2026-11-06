'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminHeader, ROLE_LABELS, useAdminMe, type AdminMe } from '@/components/admin-header';
import {
  AdminEmptyState,
  AdminLoadingState,
  CARD,
  INPUT,
  Notices,
  PRIMARY,
  StatusPill,
  when,
} from '@/components/admin-ui';
import { AlertCircle, AlertTriangle, KeyRound, Mail, RefreshCw, Send, Shield, ShieldCheck, UserCheck, UserCog, Users } from 'lucide-react';

type Role = AdminMe['role'];

interface Operator {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  disabledAt: string | null;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface Invitation {
  id: string;
  kind: 'INVITE' | 'RESET';
  email: string;
  role: Role;
  expiresAt: string;
  deliveryStatus: string;
}

const ROLES: Role[] = ['SUPPORT', 'ADMIN', 'SUPER_ADMIN'];

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  SUPER_ADMIN: 'Bütün sistemə tam giriş, operatorların idarəsi, istisnalar və silmə hüququ.',
  ADMIN: 'Gündəlik moderasiya, şirkət və elan təsdiqi, əməliyyatların və növbələrin idarəsi.',
  SUPPORT: 'Yalnız məlumatların oxunması və baxış; dəyişiklik və silmə hüququ yoxdur.',
};

async function call(path: string, method = 'POST', body?: unknown) {
  const res = await fetch(`/api/admin/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(
      Array.isArray(data.message) ? data.message.join(', ') : data.message || 'Xəta baş verdi.'
    ) as Error & { reason?: string };
    error.reason = data.reason;
    throw error;
  }
  return data;
}

export default function AdminOperatorsPage() {
  const me = useAdminMe();
  const [operators, setOperators] = useState<Operator[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'mfa' | 'forbidden' | 'error'>('loading');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('SUPPORT');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadState('loading');
      const data = await call('operators', 'GET');
      setOperators(data.operators || []);
      setInvitations(data.invitations || []);
      setLoadState('ready');
    } catch (err: unknown) {
      const reason = (err as { reason?: string }).reason;
      setLoadState(reason === 'MFA_REQUIRED' ? 'mfa' : /icazəniz/.test((err as Error).message) ? 'forbidden' : 'error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (message: string, fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Xəta baş verdi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background-warm flex flex-col">
      <AdminHeader me={me} />

      <main className="flex-1 p-4 sm:p-6 md:p-10 w-full max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl md:text-3xl font-bold text-neutral-dark">Operatorlar</h1>
            <p className="text-xs sm:text-sm text-neutral-dark/65 mt-1">Admin paneli istifadəçiləri, rolları və dəvətlər. Hər dəyişiklik audit jurnalına yazılır.</p>
          </div>
          {loadState === 'ready' && (
            <button
              onClick={() => load()}
              disabled={busy}
              className="rounded-xl border border-neutral-dark/20 bg-background px-4 py-2 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 min-h-11 inline-flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Yenilə</span>
            </button>
          )}
        </div>

        {loadState === 'loading' && <AdminLoadingState message="Operatorlar siyahısı yüklənir..." />}

        {loadState === 'mfa' && (
          <div role="alert" className="rounded-2xl bg-amber-50 border border-amber-200/80 p-5 text-sm text-amber-900 flex items-start gap-3 shadow-xs">
            <ShieldCheck className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-base">İki mərhələli təsdiq tələb olunur</p>
              <p className="text-xs leading-relaxed text-amber-800">
                Operatorları idarə etmək üçün iki mərhələli təsdiq tələb olunur. <Link href="/admin/account" className="font-semibold underline hover:text-amber-950">Hesabım</Link> bölməsində aktivləşdirin və ya kodla yenidən daxil olun.
              </p>
            </div>
          </div>
        )}

        {loadState === 'forbidden' && (
          <div role="alert" className="rounded-2xl bg-red-50 border border-red-200/80 p-5 text-sm text-red-800 flex items-start gap-3 shadow-xs">
            <AlertCircle className="h-5 w-5 text-red-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">İcazə yoxdur</p>
              <p className="text-xs text-red-700 mt-0.5">Bu bölmə yalnız super-admin üçündür.</p>
            </div>
          </div>
        )}

        {loadState === 'error' && (
          <div role="alert" className="rounded-2xl bg-red-50 border border-red-200/80 p-5 text-sm text-red-800 flex items-start gap-3 shadow-xs">
            <AlertCircle className="h-5 w-5 text-red-700 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="font-semibold">Siyahı yüklənmədi.</p>
              <button
                className="px-3 py-1.5 rounded-lg border border-red-300 text-xs font-semibold text-red-800 hover:bg-red-100 transition-colors"
                onClick={load}
              >
                Yenidən cəhd et
              </button>
            </div>
          </div>
        )}

        <Notices notice={notice} error={error} onClearError={() => setError('')} />

        {loadState === 'ready' && (
          <>
            {/* Role Definitions Guide Card */}
            <section className={`${CARD} p-5 space-y-3`} aria-label="Rollar bələdçisi">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-dark/60 flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span>Rollar və icazə səviyyələri</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-3 text-xs">
                {ROLES.map((r) => (
                  <div key={r} className="p-3 rounded-xl bg-neutral-dark/[0.02] border border-neutral-dark/5 space-y-1">
                    <p className="font-semibold text-neutral-dark">{ROLE_LABELS[r]}</p>
                    <p className="text-neutral-dark/65 leading-relaxed">{ROLE_DESCRIPTIONS[r]}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Invite Form */}
            <section className={`${CARD} p-5 sm:p-6 space-y-4`} aria-labelledby="invite-title">
              <h2 id="invite-title" className="font-serif text-lg font-bold text-neutral-dark">
                Operator dəvət et
              </h2>
              <form
                className="flex flex-wrap gap-3 items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(
                    `${inviteEmail} ünvanına dəvət göndərildi (72 saat etibarlıdır).`,
                    async () => {
                      await call('operators/invitations', 'POST', { email: inviteEmail, role: inviteRole });
                      setInviteEmail('');
                    },
                    inviteRole === 'SUPER_ADMIN' ? 'Super-admin rolu tam idarəetmə verir. Davam edilsin?' : undefined
                  );
                }}
              >
                <div className="flex-1 min-w-[220px]">
                  <label htmlFor="invite-email" className="block text-xs font-semibold text-neutral-dark/80 mb-1">
                    E-poçt
                  </label>
                  <input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className={`${INPUT} w-full min-h-11`}
                    placeholder="operator@company.az"
                    required
                  />
                </div>
                <div className="w-full sm:w-auto min-w-[160px]">
                  <label htmlFor="invite-role" className="block text-xs font-semibold text-neutral-dark/80 mb-1">
                    Rol
                  </label>
                  <select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as Role)}
                    className={`${INPUT} w-full min-h-11`}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <button disabled={busy} className={`${PRIMARY}`}>
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  <span>Dəvət göndər</span>
                </button>
              </form>

              {invitations.length > 0 && (
                <div className="pt-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-dark/60 mb-2">
                    Açıq keçidlər və dəvətlər
                  </h3>
                  <ul className="divide-y divide-neutral-dark/5 text-sm" aria-label="Açıq keçidlər">
                    {invitations.map((inv) => (
                      <li key={inv.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="text-neutral-dark">
                          <strong>{inv.kind === 'INVITE' ? 'Dəvət' : 'Şifrə bərpası'}:</strong>{' '}
                          <span className="font-mono">{inv.email}</span> · {ROLE_LABELS[inv.role]} · {when(inv.expiresAt)} tarixinədək
                        </span>
                        <div className="flex items-center gap-2">
                          {inv.kind === 'INVITE' && (
                            <button
                              className="min-h-11 inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold hover:bg-neutral-dark/5 text-primary transition-colors border border-neutral-dark/15"
                              disabled={busy}
                              onClick={() =>
                                act('Yeni dəvət keçidi göndərildi.', () => call(`operators/invitations/${inv.id}/resend`))
                              }
                            >
                              Yenidən göndər
                            </button>
                          )}
                          <button
                            className="min-h-11 inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold hover:bg-neutral-dark/5 text-red-700 transition-colors border border-red-200"
                            disabled={busy}
                            onClick={() => act('Keçid ləğv edildi.', () => call(`operators/invitations/${inv.id}`, 'DELETE'))}
                          >
                            Ləğv et
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* Operators Table */}
            <section className={`${CARD} overflow-hidden`} aria-label="Operatorlar siyahısı">
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-dark/[0.03] text-left text-xs uppercase tracking-wider text-neutral-dark/60 border-b border-neutral-dark/5">
                    <tr>
                      <th scope="col" className="p-4 font-semibold">Operator</th>
                      <th scope="col" className="p-4 font-semibold">Rol</th>
                      <th scope="col" className="p-4 font-semibold">İki mərhələli</th>
                      <th scope="col" className="p-4 font-semibold">Son giriş</th>
                      <th scope="col" className="p-4 font-semibold text-right">Əməliyyatlar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-dark/5">
                    {operators.map((op) => {
                      const self = op.id === me?.id;
                      return (
                        <tr key={op.id} className={`hover:bg-neutral-dark/[0.02] transition-colors ${op.disabledAt ? 'opacity-60 bg-neutral-dark/[0.02]' : ''}`}>
                          <td className="p-4 max-w-xs">
                            <p className="font-semibold text-neutral-dark break-all">
                              {op.email}{self ? ' (siz)' : ''}
                            </p>
                            <p className="text-xs text-neutral-dark/60 mt-0.5 truncate">
                              {op.name ? `${op.name} · ` : ''}
                              {op.disabledAt ? (
                                <span className="text-red-700 font-medium">deaktiv: {when(op.disabledAt)}</span>
                              ) : (
                                `qeydiyyat: ${when(op.createdAt)}`
                              )}
                            </p>
                          </td>
                          <td className="p-4 whitespace-nowrap">
                            <label className="sr-only" htmlFor={`role-${op.id}`}>
                              {op.email} rolu
                            </label>
                            <select
                              id={`role-${op.id}`}
                              value={op.role}
                              disabled={busy || !!op.disabledAt || self}
                              className={`${INPUT} min-h-10 text-xs py-1.5`}
                              onChange={(e) => {
                                const role = e.target.value as Role;
                                act(
                                  `${op.email}: rol dəyişdi (${ROLE_LABELS[role]}).`,
                                  () => call(`operators/${op.id}/role`, 'PATCH', { role }),
                                  `${op.email} rolunu "${ROLE_LABELS[role]}" etmək istəyirsiniz?`
                                );
                              }}
                            >
                              {ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {ROLE_LABELS[r]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-4 whitespace-nowrap">
                            {op.mfaEnabled ? (
                              <StatusPill tone="ok">Aktiv</StatusPill>
                            ) : (
                              <StatusPill tone="warn">Yox</StatusPill>
                            )}
                          </td>
                          <td className="p-4 text-xs text-neutral-dark/65 whitespace-nowrap font-mono">
                            {when(op.lastLoginAt)}
                          </td>
                          <td className="p-4 text-right whitespace-nowrap">
                            {!self && (
                              <div className="flex flex-wrap items-center justify-end gap-2 text-xs font-semibold">
                                {op.disabledAt ? (
                                  <button
                                    disabled={busy}
                                    className="min-h-11 px-3 py-2 rounded-xl border border-neutral-dark/20 text-primary hover:bg-neutral-dark/5 transition-colors inline-flex items-center justify-center"
                                    onClick={() => act(`${op.email} aktivləşdirildi.`, () => call(`operators/${op.id}/enable`))}
                                  >
                                    Aktivləşdir
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      disabled={busy}
                                      className="min-h-11 px-3 py-2 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 transition-colors inline-flex items-center justify-center"
                                      onClick={() =>
                                        act(
                                          `${op.email} deaktiv edildi; sessiyaları bağlandı.`,
                                          () => call(`operators/${op.id}/disable`, 'POST', {}),
                                          `${op.email} deaktiv edilsin? Bütün sessiyaları dərhal bağlanacaq.`
                                        )
                                      }
                                    >
                                      Deaktiv et
                                    </button>
                                    <button
                                      disabled={busy}
                                      className="min-h-11 px-3 py-2 rounded-xl border border-neutral-dark/20 text-neutral-dark hover:bg-neutral-dark/5 transition-colors inline-flex items-center justify-center"
                                      onClick={() => act('Sessiyalar bağlandı.', () => call(`operators/${op.id}/sessions/revoke`))}
                                    >
                                      Sessiyaları bağla
                                    </button>
                                    <button
                                      disabled={busy}
                                      className="min-h-11 px-3 py-2 rounded-xl border border-neutral-dark/20 text-neutral-dark hover:bg-neutral-dark/5 transition-colors inline-flex items-center justify-center"
                                      onClick={() =>
                                        act('Şifrə bərpası keçidi göndərildi (2 saat).', () => call(`operators/${op.id}/reset-link`))
                                      }
                                    >
                                      Şifrə bərpası
                                    </button>
                                    {op.mfaEnabled && (
                                      <button
                                        disabled={busy}
                                        className="min-h-11 px-3 py-2 rounded-xl border border-neutral-dark/20 text-neutral-dark hover:bg-neutral-dark/5 transition-colors inline-flex items-center justify-center"
                                        onClick={() =>
                                          act(
                                            'İki mərhələli təsdiq sıfırlandı; operator yenidən quraşdırmalıdır.',
                                            () => call(`operators/${op.id}/mfa/reset`),
                                            `${op.email} üçün iki mərhələli təsdiq sıfırlansın? Yalnız autentifikatorunu itirdiyi təsdiqləndikdə edin.`
                                          )
                                        }
                                      >
                                        MFA sıfırla
                                      </button>
                                    )}
                                  </>
                                )}
                                <button
                                  disabled={busy}
                                  className="min-h-11 px-3 py-2 rounded-xl bg-red-700 text-white hover:bg-red-800 transition-colors inline-flex items-center justify-center"
                                  onClick={() =>
                                    act(
                                      `${op.email} operator hesabı silindi.`,
                                      () => call(`operators/${op.id}/remove`, 'POST', {}),
                                      `${op.email} operator hesabı birdəfəlik silinsin? Sessiyalar bağlanacaq, hesab geri qaytarılmayacaq (audit yazıları qalır).`
                                    )
                                  }
                                >
                                  Sil
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
