/**
 * A small global notice channel, so an action that cannot start (a failed download, a blocked pop-up) says so on every screen instead of doing nothing.
 * `href` carries a link the person can tap when the browser would not start the action itself (typical on phones).
 */
export type AppNotice = { tone: 'info' | 'error'; text: string; href?: string; hrefLabel?: string; download?: string };
export const NOTICE_EVENT = 'aise:notice';

export function notify(notice: AppNotice): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AppNotice>(NOTICE_EVENT, { detail: notice }));
}

/** A phone or tablet: touch is the main input and the screen is narrow. Used only to decide whether to offer a tap-to-open link after a download. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse || (navigator.maxTouchPoints > 0 && window.innerWidth <= 900);
}
