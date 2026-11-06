'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { NOTICE_EVENT, type AppNotice } from '@/lib/notify';

/** Shows the latest global notice (see lib/notify.ts). Notices with a link stay longer so there is time to tap it, but never follow the
 *  candidate to another page, where they would cover that page's own bottom actions. */
export function NoticeHost() {
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pathname = usePathname();
  const shownOn = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onNotice = (event: Event) => {
      const detail = (event as CustomEvent<AppNotice>).detail;
      if (!detail?.text) return;
      shownOn.current = window.location.pathname;
      setNotice(detail);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setNotice(null), detail.href ? 90_000 : 12_000);
    };
    window.addEventListener(NOTICE_EVENT, onNotice);
    return () => {
      window.removeEventListener(NOTICE_EVENT, onNotice);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (shownOn.current !== null && pathname !== shownOn.current) { setNotice(null); shownOn.current = null; }
  }, [pathname]);

  // While a notice is up, the page gets room under it so the last buttons can still be scrolled into view and tapped.
  useEffect(() => {
    if (!notice || !box.current) return;
    const body = document.body;
    const before = body.style.paddingBottom;
    body.style.paddingBottom = `${box.current.offsetHeight + 24}px`;
    return () => { body.style.paddingBottom = before; };
  }, [notice]);

  if (!notice) return null;
  const error = notice.tone === 'error';
  return (
    <div
      ref={box}
      role={error ? 'alert' : 'status'}
      className={`fixed inset-x-3 bottom-3 z-[1100] mx-auto max-w-md rounded-xl border p-4 text-sm shadow-lg ${
        error ? 'border-red-200 bg-red-50 text-red-900' : 'border-neutral-dark/15 bg-background text-neutral-dark'
      }`}
    >
      <p>{notice.text}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {notice.href && (
          <a href={notice.href} target="_blank" rel="noopener noreferrer" download={notice.download} className="min-h-11 inline-flex items-center rounded-full bg-accent px-4 py-2 font-medium text-white">
            {notice.hrefLabel ?? 'Aç'}
          </a>
        )}
        <button type="button" onClick={() => setNotice(null)} className="min-h-11 rounded-full px-3 py-2 text-sm underline">Bağla</button>
      </div>
    </div>
  );
}
