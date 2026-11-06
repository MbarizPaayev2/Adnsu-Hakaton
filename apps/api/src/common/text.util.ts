export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Strips CR/LF so untrusted text can't be used for email header injection.
export function sanitizeHeaderValue(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]{2,8};/gi, ' ');
}

export function stripHtml(text: string | null | undefined): string {
  if (!text) return '';
  let t = unescapeHtml(String(text));
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/p\s*>/gi, '\n');
  t = t.replace(/<\/li\s*>/gi, '\n');
  t = t.replace(/<li[^>]*>/gi, '- ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t.trim();
}
