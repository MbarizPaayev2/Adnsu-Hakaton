'use client';

import { useEffect, useState } from 'react';
import { fetchAuthedFileUrl } from '@/lib/api';

/**
 * Renders an authenticated /uploads/... image via a plain <img>: fetches the
 * bytes with the current session and returns an object URL, since /uploads
 * now requires a session that a bare <img src> can't carry itself. Returns
 * null while loading, on fetch failure, or when `url` is empty — callers
 * should render their existing empty/fallback state for null.
 */
export function useAuthedFileUrl(url: string | null | undefined): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setObjectUrl(null);
      return;
    }

    // A new file replaces the old one: never keep showing the previous
    // image (its object URL is revoked below) while the new one loads.
    setObjectUrl(null);
    let cancelled = false;
    let created: string | null = null;

    fetchAuthedFileUrl(url).then((result) => {
      if (cancelled) {
        if (result) URL.revokeObjectURL(result);
        return;
      }
      created = result;
      setObjectUrl(result);
    });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  return objectUrl;
}
