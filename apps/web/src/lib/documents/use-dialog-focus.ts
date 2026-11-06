import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus handling: when the dialog opens, focus moves INTO it (the first control, or the dialog itself); Tab and Shift+Tab cycle inside it and a
 * focus that somehow lands outside is brought back; Escape closes it; and when it closes, focus returns to what opened it.
 */
export function useDialogFocus(isOpen: boolean, dialogRef: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : true));

    // After the dialog has rendered its content.
    const frame = requestAnimationFrame(() => {
      const first = focusables()[0];
      if (first) first.focus();
      else dialogRef.current?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && !!dialogRef.current?.contains(active);
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? items[items.length - 1] : items[0]).focus();
      } else if (e.shiftKey && active === items[0]) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && active === items[items.length - 1]) {
        e.preventDefault();
        items[0].focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Node | null;
      if (target && dialogRef.current && !dialogRef.current.contains(target)) focusables()[0]?.focus();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      // Back to whatever opened the dialog (if it is still on the page).
      if (opener && document.contains(opener)) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}
