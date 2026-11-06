import React from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Info, Loader2 } from 'lucide-react';

/**
 * Shared candidate-facing building blocks. One look for buttons, cards, badges and the four page states (loading, empty, error, success),
 * so a page reads the same wherever it is opened. The styles live in globals.css (`.ui-*`); these wrappers only pick the class and the
 * accessible role. Business logic stays in the pages.
 */

export type Tone = 'neutral' | 'progress' | 'good' | 'warn' | 'bad';

export const BUTTON = {
  primary: 'ui-btn ui-btn-primary',
  secondary: 'ui-btn ui-btn-secondary',
  quiet: 'ui-btn ui-btn-quiet',
  danger: 'ui-btn ui-btn-danger',
} as const;
export const CARD = 'ui-card';
export const INPUT = 'ui-input';

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={`ui-badge ui-badge-${tone} ${className}`}>{children}</span>;
}

export function PageHeader({ title, intro, actions, eyebrow }: { title: React.ReactNode; intro?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <header className="ui-page-header">
      <div className="min-w-0">
        {eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}
        <h1 className="ui-page-title">{title}</h1>
        {intro && <p className="ui-page-intro">{intro}</p>}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </header>
  );
}

export function SectionHeader({ id, title, description, action }: { id?: string; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="ui-section-header">
      <div className="min-w-0">
        <h2 id={id} className="ui-section-title">{title}</h2>
        {description && <p className="ui-section-description">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Yüklənir…' }: { label?: string }) {
  return (
    <div role="status" className="ui-state">
      <Loader2 className="h-5 w-5 animate-spin text-secondary" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="ui-empty">
      {icon && <div className="ui-empty-icon" aria-hidden="true">{icon}</div>}
      <p className="ui-empty-title">{title}</p>
      {children && <div className="ui-empty-text">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}

/** One inline message. `error` is announced immediately (role=alert); the others politely (role=status). */
export function Notice({ tone = 'info', title, children, action, className = '' }: { tone?: 'info' | 'success' | 'warn' | 'error'; title?: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`ui-notice ui-notice-${tone} ${className}`}>
      <Icon className="ui-notice-icon" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

/** A failed load the candidate can recover from: says what did not load and offers a retry that keeps the current address. */
export function ErrorState({ title, children, retryHref, onRetry }: { title: string; children?: React.ReactNode; retryHref?: string; onRetry?: () => void }) {
  return (
    <Notice tone="error" title={title} action={onRetry ? <button type="button" className={BUTTON.secondary} onClick={onRetry}>Yenidən cəhd et</button> : retryHref ? <Link href={retryHref} className={BUTTON.secondary}>Yenidən yüklə</Link> : undefined}>
      {children}
    </Notice>
  );
}

export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="ui-field">
      <label htmlFor={id} className="ui-label">{label}</label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="ui-hint">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="ui-error">{error}</p>}
    </div>
  );
}
