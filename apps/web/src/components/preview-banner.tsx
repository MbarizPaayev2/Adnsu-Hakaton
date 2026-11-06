'use client';

import React, { useEffect, useState } from 'react';
import { isLocalQaHost } from '@/lib/retention/contract';

/**
 * Shown only on a local host when the preview launcher sets NEXT_PUBLIC_PREVIEW_BANNER. It states which parts of the local preview are stand-ins
 * so nobody reads a preview result as evidence about the live product. It can never appear on a public host or in a production build.
 */
export function previewBannerVisible(host: string): boolean {
  return process.env.NEXT_PUBLIC_PREVIEW_BANNER === 'synthetic' && isLocalQaHost(host) && process.env.NODE_ENV !== 'production';
}

export function PreviewBanner() {
  const [visible, setVisible] = useState(false);
  useEffect(() => setVisible(previewBannerVisible(window.location.hostname)), []);
  if (!visible) return null;
  const control = process.env.NEXT_PUBLIC_PREVIEW_CONTROL_URL;
  return (
    <div role="note" aria-label="Preview notice" data-testid="preview-banner" className="w-full border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs leading-snug text-amber-950">
      <strong>Lokal sınaq mühiti (sintetik məlumat).</strong>{' '}
      Sənədlər deterministik saxta generatorla (dil modeli deyil), uyğunluq balları isə sınaq alqoritmi ilə hesablanır; e-poçtlar heç yerə göndərilmir, ödəniş söndürülüb.
      Nəticələr real xidmətin keyfiyyətini göstərmir.
      {control ? <> <a className="underline" href={control} target="_blank" rel="noreferrer">Yönətmə səhifəsi (tutulan e-poçtlar)</a></> : null}
    </div>
  );
}
