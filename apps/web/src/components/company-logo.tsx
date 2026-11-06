'use client';

import React, { useState } from 'react';
import { useAuthedFileUrl } from '@/hooks/use-authed-file-url';
import { initialsOf } from '@/lib/retention/companies';

export interface CompanyLogoProps {
  src?: string | null;
  alt: string;
  name?: string;
  className?: string;
  fallback?: React.ReactNode;
}

/**
 * A company's logo is an /uploads/... reference, which requires a session.
 * Reusable across all pages, with automatic fallback to clean monogram initials
 * if the image is missing, fails to load, or cannot be authenticated.
 */
export function CompanyLogo({ src, alt, name, className, fallback }: CompanyLogoProps) {
  const [failed, setFailed] = useState(false);
  const objectUrl = useAuthedFileUrl(src);

  // If no source is given, or if image load errored, render fallback immediately
  if (!src || failed) {
    if (fallback) return <>{fallback}</>;
    const displayName = name || alt || 'Şirkət';
    return (
      <span
        role="img"
        aria-label={`${displayName} (loqo yoxdur)`}
        className={`${className || 'h-10 w-10'} inline-flex shrink-0 items-center justify-center rounded-xl border border-neutral-dark/10 bg-neutral-100 text-xs font-bold tracking-wide text-primary select-none`}
      >
        {initialsOf(displayName)}
      </span>
    );
  }

  // Loading state while fetching authenticated blob
  if (!objectUrl) {
    return <div className={`${className || 'h-10 w-10'} bg-neutral-dark/5 animate-pulse rounded-xl`} aria-hidden="true" />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={objectUrl}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
