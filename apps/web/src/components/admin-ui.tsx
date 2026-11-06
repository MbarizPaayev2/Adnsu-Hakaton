'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Inbox, Loader2 } from 'lucide-react';

/** Calls the admin cookie proxy; throws the server's own message (Azerbaijani) on failure. */
// Responses are JSON of many shapes; callers that need types pass T.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function adminCall<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message || `Xəta (${res.status})`) as Error & { status?: number; reason?: string };
    error.status = res.status;
    error.reason = data.reason;
    throw error;
  }
  return data as T;
}

export const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleString('az-AZ') : '—');

export const CARD = 'product-card rounded-2xl bg-surface border border-outline-variant shadow-xs';
export const INPUT = 'rounded-xl border border-neutral-dark/20 bg-background-warm/30 py-2 px-3 text-sm text-neutral-dark placeholder:text-neutral-dark/40 focus:ring-2 focus:ring-primary focus:border-transparent transition-all outline-hidden';
export const PRIMARY = 'product-action rounded-full bg-primary py-2.5 px-5 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50 transition-all cursor-pointer min-h-11 inline-flex items-center justify-center';
export const SECONDARY = 'rounded-full border border-neutral-dark/20 bg-background py-2.5 px-4 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all cursor-pointer min-h-11 inline-flex items-center justify-center';
export const DANGER_BTN = 'rounded-full bg-red-600 py-2.5 px-5 text-sm font-semibold text-white shadow-xs hover:bg-red-700 disabled:opacity-50 transition-all cursor-pointer min-h-11 inline-flex items-center justify-center';

export function Notices({ notice, error, onClearError }: { notice?: string; error?: string; onClearError?: () => void }) {
  return (
    <div className="space-y-2">
      {notice && (
        <div role="status" className="rounded-xl bg-green-50 border border-green-200/80 p-3.5 text-sm text-green-900 flex items-start gap-2.5 animate-in fade-in duration-200">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-green-700" aria-hidden="true" />
          <p className="font-medium leading-snug">{notice}</p>
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 border border-red-200/80 p-3.5 text-sm text-red-900 flex items-start justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-700" aria-hidden="true" />
            <p className="font-medium leading-snug">{error}</p>
          </div>
          {onClearError && (
            <button
              onClick={onClearError}
              aria-label="Bildirişi bağla"
              className="text-xs font-semibold text-red-700 hover:bg-red-100/60 min-h-11 min-w-11 px-3 py-2 rounded-xl inline-flex items-center justify-center transition-colors"
            >
              Bağla
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Səhifələr" className="flex items-center justify-between gap-3 p-4 text-sm border-t border-neutral-dark/5">
      <span className="text-xs text-neutral-dark/60 font-medium">
        Səhifə {page} / {totalPages}
      </span>
      <div className="flex items-center gap-2">
        <button
          className="min-h-11 px-4 rounded-xl border border-neutral-dark/20 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Əvvəlki səhifə"
        >
          Əvvəlki
        </button>
        <button
          className="min-h-11 px-4 rounded-xl border border-neutral-dark/20 text-xs font-semibold text-neutral-dark hover:bg-neutral-dark/5 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Növbəti səhifə"
        >
          Növbəti
        </button>
      </div>
    </nav>
  );
}

/**
 * Confirmation for a consequential action. With `requireReason` the reason
 * is mandatory and passed to `onConfirm` (the server stores it in the audit log).
 *
 * Implements accessible focus containment, Shift+Tab wrapping, focus restoration
 * to the invoking element upon close, and non-destructive initial focus (Cancel or Reason).
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  requireReason,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  requireReason?: boolean;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Focus restoration & body scroll lock
  useEffect(() => {
    triggerRef.current = (document.activeElement as HTMLElement) || null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
      const trigger = triggerRef.current;
      if (trigger && trigger !== document.body && document.contains(trigger)) {
        trigger.focus();
        return;
      }
      // The trigger is gone (e.g. its row changed after the action): move focus to the page heading rather than losing it to <body>.
      const heading = document.querySelector<HTMLElement>('main h1, h1');
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus();
      }
    };
  }, []);

  // Keyboard containment (Tab & Shift+Tab) + Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        if (!dialogRef.current) return;
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  // While a request is running every control is disabled: keep focus inside the dialog instead of dropping it to <body>.
  useEffect(() => {
    if (busy) dialogRef.current?.focus();
  }, [busy]);

  // Initial focus: Cancel or required reason field
  useEffect(() => {
    if (requireReason) {
      reasonRef.current?.focus();
    } else {
      cancelButtonRef.current?.focus();
    }
  }, [requireReason]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-dark/50 backdrop-blur-xs p-4 animate-in fade-in duration-150 motion-reduce:animate-none motion-reduce:transition-none"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        tabIndex={-1}
        className="bg-background rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl border border-neutral-dark/10 animate-in zoom-in-95 duration-150 motion-reduce:animate-none motion-reduce:transition-none outline-hidden"
      >
        <div className="space-y-1.5">
          <h2 id="confirm-title" className="font-serif text-lg font-bold text-neutral-dark">
            {title}
          </h2>
          <p className="text-sm text-neutral-dark/75 leading-relaxed break-words">
            {description}
          </p>
        </div>

        {requireReason && (
          <div>
            <label htmlFor="confirm-reason" className="block text-xs font-semibold text-neutral-dark/80 mb-1.5">
              Səbəb <span className="text-neutral-dark/50 font-normal">(audit jurnalına yazılır, məcburidir)</span>
            </label>
            <textarea
              id="confirm-reason"
              ref={reasonRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={300}
              disabled={busy}
              placeholder="Səbəbi daxil edin..."
              className={`${INPUT} w-full disabled:opacity-50`}
            />
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-700" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <button
            ref={cancelButtonRef}
            onClick={onClose}
            disabled={busy}
            type="button"
            className="rounded-xl border border-neutral-dark/20 px-4 py-2.5 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 disabled:opacity-50 min-h-11 transition-colors"
          >
            İmtina
          </button>
          <button
            disabled={busy || (requireReason && !reason.trim())}
            type="button"
            className={`rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 min-h-11 inline-flex items-center justify-center gap-2 shadow-xs transition-colors ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary-hover'
            }`}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await onConfirm(reason.trim());
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Xəta baş verdi.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            <span>{busy ? 'Gözləyin...' : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export type StatusTone = 'ok' | 'warn' | 'bad' | 'muted' | 'unknown';

export function StatusPill({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  const tones: Record<StatusTone, string> = {
    ok: 'bg-green-50 text-green-800 border-green-200',
    warn: 'bg-amber-50 text-amber-900 border-amber-200',
    bad: 'bg-red-50 text-red-800 border-red-200',
    unknown: 'bg-neutral-100 text-neutral-700 border-neutral-300',
    muted: 'bg-neutral-50 text-neutral-600 border-neutral-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function AdminEmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="h-12 w-12 rounded-2xl bg-neutral-dark/5 flex items-center justify-center mb-3 text-neutral-dark/40">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="font-serif text-base font-bold text-neutral-dark">{title}</h3>
      {description && <p className="text-xs text-neutral-dark/65 max-w-sm mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function AdminLoadingState({ message = 'Yüklənir...' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center py-12 px-4 gap-2 text-sm text-neutral-dark/65">
      <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
