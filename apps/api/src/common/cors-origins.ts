/** The two public AISE hosts belong to the same application. Never allow arbitrary subdomains. */
export function frontendOrigins(configured = 'http://localhost:3000'): string[] {
  const url = new URL(configured);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid FRONTEND_URL');
  const origins = [url.origin];
  if (url.protocol === 'https:' && !url.port && ['aisehr.com', 'www.aisehr.com'].includes(url.hostname)) {
    origins.push('https://aisehr.com', 'https://www.aisehr.com');
  }
  return [...new Set(origins)];
}
