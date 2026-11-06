'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Bell, Check, Eye, EyeOff, BellOff, Settings2 } from 'lucide-react';
import { formatDateTime } from "@/lib/format";
import { NotificationPreferencesView } from '@/components/retention/notification-preferences-view';

interface Notification {
  id: string;
  message: string;
  read: boolean;
  createdAt: string;
  payload?: { matchId?: string; [key: string]: any };
}

/** New-posting alerts carry `ref: 'native:<id>' | 'imported:<id>'`; the link is built only from that exact shape. */
function postingHref(payload: Record<string, unknown> | null | undefined): string | null {
  const ref = payload?.ref;
  if (typeof ref !== 'string') return null;
  const m = /^(native|imported):([A-Za-z0-9_-]{1,64})$/.exec(ref);
  return m ? `/jobs/${m[1]}/${m[2]}` : null;
}

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<'inbox' | 'preferences'>('inbox');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = async () => {
    try {
      const res = await apiFetch('/notifications');
      if (!res.ok) throw new Error('Bildirişlər yüklənə bilmədi');
      const data = await res.json();
      setNotifications(data);
    } catch (err: any) {
      setError(err.message || 'Bildirişləri yükləyərkən xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleToggleRead = async (id: string, currentRead: boolean) => {
    try {
      const res = await apiFetch(`/notifications/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ read: !currentRead }),
      });

      if (!res.ok) throw new Error('Bildiriş yenilənə bilmədi');

      // Update state locally
      setNotifications(
        notifications.map((n) =>
          n.id === id ? { ...n, read: !currentRead } : n
        )
      );
    } catch (err: any) {
      setError(err.message || 'Xəta baş verdi.');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await apiFetch('/notifications/mark-all-read', {
        method: 'POST',
      });

      if (!res.ok) throw new Error('Hamısı oxunmuş kimi qeyd edilə bilmədi');

      // Update state locally
      setNotifications(
        notifications.map((n) => ({ ...n, read: true }))
      );
    } catch (err: any) {
      setError(err.message || 'Xəta baş verdi.');
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-neutral-dark/65">Bildirişlər yüklənir...</p>
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-neutral-dark/10 pb-5">
        <div>
          <h1 className="font-serif text-3xl font-bold text-neutral-dark">Bildirişlər</h1>
          <p className="text-xs sm:text-sm text-neutral-dark/60 mt-1">Gələn bildirişlərə baxın və göndəriş kanallarını idarə edin</p>
        </div>

        {activeTab === 'inbox' && unreadCount > 0 && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-primary text-primary px-4 py-2 text-xs font-bold hover:bg-primary/5 transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
          >
            <Check className="h-4 w-4" /> Hamısını oxunmuş kimi qeyd et
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-outline-variant gap-4" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'inbox'}
          onClick={() => setActiveTab('inbox')}
          className={`flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden ${
            activeTab === 'inbox'
              ? 'border-primary text-primary'
              : 'border-transparent text-on-surface-variant hover:text-on-background'
          }`}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          <span>Gələnlər</span>
          {unreadCount > 0 && (
            <span className="rounded-full bg-highlight px-2 py-0.5 text-xs font-bold text-primary">
              {unreadCount}
            </span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'preferences'}
          onClick={() => setActiveTab('preferences')}
          className={`flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden ${
            activeTab === 'preferences'
              ? 'border-primary text-primary'
              : 'border-transparent text-on-surface-variant hover:text-on-background'
          }`}
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" />
          <span>Bildiriş parametrləri</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-100 flex items-center justify-between gap-3" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-700 hover:text-red-900 text-xs font-semibold underline shrink-0 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden">Bağla</button>
        </div>
      )}

      {activeTab === 'preferences' ? (
        <NotificationPreferencesView />
      ) : (
        notifications.length === 0 ? (
          <div className="text-center py-16 bg-background rounded-2xl border border-neutral-dark/5 shadow-xs">
            <BellOff className="mx-auto h-12 w-12 text-neutral-dark/30 mb-2" />
            <p className="text-sm font-semibold text-neutral-dark">Hələ heç bir bildiriş yoxdur.</p>
            <p className="text-xs text-neutral-dark/50 mt-1">Bütün bildirişləri oxumusunuz!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`flex items-start justify-between gap-4 rounded-xl border p-4 transition-all ${
                  n.read
                    ? 'bg-background border-neutral-dark/5 opacity-75'
                    : 'bg-primary/5 border-primary/20 ring-1 ring-primary/5'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`rounded-lg p-2 shrink-0 ${n.read ? 'bg-neutral-dark/5 text-neutral-dark/45' : 'bg-primary/10 text-primary'}`}>
                    <Bell className="h-4 w-4" />
                  </div>
                  <div className="space-y-1.5 min-w-0">
                    <p className={`text-xs md:text-sm text-neutral-dark leading-relaxed ${n.read ? 'font-medium' : 'font-semibold'}`}>
                      {n.message}
                    </p>
                    <p className="text-[10px] text-neutral-dark/50">
                      {formatDateTime(n.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {(n as { type?: string }).type === 'AGENT_REVIEW' ? (
                    <Link
                      href="/dashboard/applications"
                      className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl p-2 text-neutral-dark hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                      title="Təsdiq gözləyən müraciətlərə bax"
                      aria-label="Təsdiq gözləyən müraciətlərə bax"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                  ) : postingHref(n.payload) ? (
                    <Link
                      href={postingHref(n.payload) as string}
                      className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl p-2 text-neutral-dark hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                      title="Elana bax"
                      aria-label="Elana bax"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                  ) : n.payload?.matchId ? (
                    <Link
                      href={`/dashboard/matches?id=${n.payload.matchId}`}
                      className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl p-2 text-neutral-dark hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                      title="Uyğunluğa bax və CV-ni fərdiləşdir"
                      aria-label="Uyğunluğa bax və CV-ni fərdiləşdir"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                  ) : n.message.includes('uyğunluq') || n.message.includes('vakansiya') || n.message.includes('match') ? (
                    <Link
                      href="/dashboard/matches"
                      className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl p-2 text-neutral-dark hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                      title="Uyğunluğa bax"
                      aria-label="Uyğunluğa bax"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => handleToggleRead(n.id, n.read)}
                    className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl p-2 text-neutral-dark hover:bg-neutral-dark/5 transition-all focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-hidden"
                    title={n.read ? 'Oxunmamış kimi qeyd et' : 'Oxunmuş kimi qeyd et'}
                    aria-label={n.read ? 'Oxunmamış kimi qeyd et' : 'Oxunmuş kimi qeyd et'}
                  >
                    {n.read ? <EyeOff className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
