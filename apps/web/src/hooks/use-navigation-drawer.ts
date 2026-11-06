'use client';

import { useEffect, useRef, useState } from 'react';

/** Shared candidate/employer mobile drawer keyboard and scroll behaviour. */
export function useNavigationDrawer() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
      if (event.key !== 'Tab') return;
      const controls = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]');
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
      trigger?.focus();
    };
  }, [mobileMenuOpen]);

  return { mobileMenuOpen, setMobileMenuOpen, triggerRef, drawerRef };
}
