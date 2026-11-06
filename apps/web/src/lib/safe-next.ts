/** Only a site-relative jobs or dashboard path is honoured after sign-in; anything else goes to the dashboard. */
export function safeNextPath(next: string | null): string {
  return next && /^\/(jobs|dashboard)(\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._~%-]+)*$/.test(next) ? next : '/dashboard';
}
