/**
 * Parse the first http(s) href out of generated auth HTML.
 * Callers must not log the returned token.
 */
export function extractAuthLink(html: string): { pathname: string; token: string; origin: string } {
  const match = html.match(/href="(https?:[^"]+)"/i);
  if (!match) {
    throw new Error('Email HTML did not contain a verification or reset link');
  }
  const url = new URL(match[1]);
  const token = url.searchParams.get('token') ?? '';
  if (!token) {
    throw new Error('Auth link is missing a token query parameter');
  }
  return { pathname: url.pathname, token, origin: url.origin };
}
