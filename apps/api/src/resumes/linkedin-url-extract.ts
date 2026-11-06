import { BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import type { LinkedInProfile, LinkedInRole, LinkedInSchool } from './linkedin-import';

const logger = new Logger('LinkedInUrlExtract');

/**
 * Validates a LinkedIn profile URL and guards against SSRF, credential embedding, non-standard ports, and malformed URLs.
 */
export function validateLinkedInProfileUrl(urlString: string): { valid: boolean; normalizedUrl?: string; username?: string; error?: string } {
  const trimmed = String(urlString ?? '').trim();
  if (!trimmed) {
    return { valid: false, error: 'LinkedIn URL tələb olunur' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`);
  } catch {
    return { valid: false, error: 'Keçid formatı düzgün deyil' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, error: 'Yalnız HTTPS keçidləri dəstəklənir' };
  }

  // Reject embedded credentials (e.g. https://user:pass@linkedin.com/...)
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Keçiddə istifadəçi adı və ya şifrə ola bilməz' };
  }

  // Reject non-standard ports (must be default 443 / 80 or empty)
  if (parsed.port && parsed.port !== '443' && parsed.port !== '80') {
    return { valid: false, error: 'Keçiddə qeyri-standart port istifadə edilə bilməz' };
  }

  // SSRF protection: Hostname must strictly be linkedin.com or a valid subdomain
  const host = parsed.hostname.toLowerCase();
  const isLinkedInHost = /^(?:[a-zA-Z0-9-]+\.)*linkedin\.com$/.test(host);
  if (!isLinkedInHost || host.includes('localhost') || /^(\d+\.){3}\d+$/.test(host) || host.includes(':')) {
    return { valid: false, error: 'Yalnız rəsmi LinkedIn profil keçidləri qəbul edilir' };
  }

  // Path must match /in/<username>
  const match = parsed.pathname.match(/^\/in\/([^\/?#]+)\/?$/i);
  if (!match) {
    return { valid: false, error: 'LinkedIn profil keçidi formatı: https://www.linkedin.com/in/ad-soyad' };
  }

  let username: string;
  try {
    username = decodeURIComponent(match[1]);
  } catch {
    return { valid: false, error: 'LinkedIn keçidində kodlaşdırma xətası var (malformed encoding)' };
  }

  // Reject path separators that might have been percent-encoded (%2F, %5C)
  if (username.includes('/') || username.includes('\\')) {
    return { valid: false, error: 'LinkedIn profil keçidində qeyri-qanuni simvollar (yol ayırıcısı) ola bilməz' };
  }

  const cleanUsername = username.trim().toLowerCase();
  if (!cleanUsername || /\s/.test(cleanUsername) || cleanUsername.length > 100) {
    return { valid: false, error: 'LinkedIn profil keçidi formatı: https://www.linkedin.com/in/ad-soyad' };
  }

  return {
    valid: true,
    normalizedUrl: `https://www.linkedin.com/in/${encodeURIComponent(cleanUsername)}`,
    username: cleanUsername,
  };
}

/**
 * Normalizes and extracts the exact decoded slug from any candidate URL or path string.
 */
export function extractLinkedInProfileSlug(rawUrlOrPath: string | null | undefined): string | null {
  if (!rawUrlOrPath || typeof rawUrlOrPath !== 'string') return null;
  const trimmed = rawUrlOrPath.trim();
  if (!trimmed) return null;
  let pathname = '';
  try {
    const parsed = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`);
    if (parsed.host && !/^(?:[a-zA-Z0-9-]+\.)*linkedin\.com$/.test(parsed.hostname.toLowerCase())) {
      return null;
    }
    pathname = parsed.pathname;
  } catch {
    pathname = trimmed;
  }
  const match = pathname.match(/(?:^|\/)in\/([^\/?#]+)(?:\/|$)/i);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match[1]).trim().toLowerCase();
    if (!decoded || decoded.includes('/') || decoded.includes('\\') || /\s/.test(decoded) || decoded.length > 100) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Collects all normalized LinkedIn profile slugs declared on a Person object (url, @id, sameAs).
 */
export function getPersonSlugs(person: any): string[] {
  if (!person || typeof person !== 'object') return [];
  const rawEntries: string[] = [];
  if (typeof person.url === 'string') rawEntries.push(person.url);
  if (typeof person['@id'] === 'string') rawEntries.push(person['@id']);
  if (Array.isArray(person.sameAs)) {
    for (const item of person.sameAs) {
      if (typeof item === 'string') rawEntries.push(item);
    }
  } else if (typeof person.sameAs === 'string') {
    rawEntries.push(person.sameAs);
  }
  const slugs: string[] = [];
  for (const raw of rawEntries) {
    const slug = extractLinkedInProfileSlug(raw);
    if (slug && !slugs.includes(slug)) {
      slugs.push(slug);
    }
  }
  return slugs;
}

export function isLinkedInAuthwall(html: string): boolean {
  if (!html) return false;
  return (
    /window\.location\.href\s*=\s*['"][^'"]*\/authwall/i.test(html) ||
    /action=["'][^'"]*\/authwall/i.test(html) ||
    /<title>[^<]*Sign In[^<]*<\/title>/i.test(html) ||
    /<title>[^<]*Log In[^<]*<\/title>/i.test(html) ||
    html.includes('data-section="authwall"')
  );
}

function decodeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extracts inner text between <tag ...> and </tag>, quote-safe for attributes containing '>' (like Tailwind selectors). */
function extractTagContent(html: string, tagName: string): string[] {
  const results: string[] = [];
  const openRe = new RegExp(`<${tagName}\\b`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(html)) !== null) {
    const startIdx = match.index;
    let realTagEnd = -1;
    let inQuote: string | null = null;
    for (let i = startIdx + tagName.length + 1; i < html.length; i++) {
      const char = html[i];
      if (inQuote) {
        if (char === inQuote) inQuote = null;
      } else {
        if (char === '"' || char === "'") inQuote = char;
        else if (char === '>') { realTagEnd = i; break; }
      }
    }
    if (realTagEnd === -1) break;
    const closeTag = `</${tagName}>`;
    const closeIdx = html.toLowerCase().indexOf(closeTag, realTagEnd);
    if (closeIdx !== -1) {
      results.push(html.slice(realTagEnd + 1, closeIdx));
    }
  }
  return results;
}

export function parseLinkedInPublicHtml(html: string, profileUrl: string, options: { requireExactIdentity?: boolean } = {}): LinkedInProfile {
  if (isLinkedInAuthwall(html)) {
    throw new BadRequestException(
      'LinkedIn bu profilin ictimai baxışına giriş tələb edir. Profil məlumatlarınızı daxil etmək üçün profil mətnini kopyalayıb yapışdırın və ya LinkedIn menyusundan "Save to PDF" faylını yükləyin.',
    );
  }

  const urlCheck = validateLinkedInProfileUrl(profileUrl);
  const targetUsername = urlCheck.username?.toLowerCase() || '';

  // 1. JSON-LD parsing: find the Person that corresponds to the profile subject
  let personLd: any = null;
  const jsonLdMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  const candidatePersons: any[] = [];

  for (const m of jsonLdMatches) {
    try {
      const data = JSON.parse(m[1]);
      if (data?.['@type'] === 'Person') candidatePersons.push(data);
      if (Array.isArray(data?.['@graph'])) {
        for (const g of data['@graph']) {
          if (g?.['@type'] === 'Person') candidatePersons.push(g);
        }
      }
    } catch {
      // ignore malformed json-ld scripts
    }
  }

  // Disambiguate Person: match by exact normalized target slug in url, @id or sameAs
  if (candidatePersons.length > 0 && targetUsername) {
    const matchingPerson = candidatePersons.find((p) => getPersonSlugs(p).includes(targetUsername));
    if (matchingPerson) {
      personLd = matchingPerson;
    } else {
      // Never use a known-mismatching person as the subject.
      // Only if candidatePersons contains exactly one Person and that person declares NO identifying slug at all,
      // can it be considered the subject. If any Person has a conflicting slug or multiple unrelated persons exist,
      // personLd remains null to prevent contaminating the profile with another person's data.
      if (candidatePersons.length === 1 && getPersonSlugs(candidatePersons[0]).length === 0) {
        personLd = candidatePersons[0];
      } else {
        personLd = null;
      }
    }
  }

  if (options.requireExactIdentity && (!personLd || !getPersonSlugs(personLd).includes(targetUsername))) {
    throw new BadRequestException('Oxunan səhifədə istənilən LinkedIn profilinin kimliyi təsdiqlənmədi. PDF və ya profil mətni ilə davam edin.');
  }

  // 2. Name, Headline, Location, Summary
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const rawTitle = titleMatch ? titleMatch[1].replace(/\s*\|\s*LinkedIn\s*$/i, '').trim() : '';
  const name = personLd?.name || (rawTitle.includes('-') ? rawTitle.split('-')[0].trim() : rawTitle);
  const headline =
    (rawTitle.includes('-') ? rawTitle.split('-').slice(1).join('-').trim() : '') ||
    (Array.isArray(personLd?.jobTitle) ? personLd.jobTitle.join(', ') : personLd?.jobTitle) ||
    personLd?.disambiguatingDescription ||
    '';
  const location = personLd?.address?.addressLocality || '';
  const summary = personLd?.description || '';

  // 3. Work Experience items
  const roles: LinkedInRole[] = [];
  const expMatch = html.match(/<ul class="experience__list">([\s\S]*?)<\/ul>/i);
  if (expMatch) {
    const itemMatches = [...expMatch[1].matchAll(/<li[^>]*class="[^"]*experience-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)];
    for (const item of itemMatches) {
      const content = item[1];
      const titleM = content.match(/<span class="experience-item__title">([^<]+)<\/span>/i);
      const companyM = content.match(/<span class="experience-item__subtitle">([^<]+)<\/span>/i);
      const dateM = content.match(/<span class="date-range[^"]*">([\s\S]*?)<\/span>/i);
      const descM =
        content.match(/<p class="show-more-less-text__text--more[^"]*">([\s\S]*?)<\/p>/i) ||
        content.match(/<div class="experience-item__description[^"]*">([\s\S]*?)<\/div>/i);

      const title = decodeHtml(titleM ? titleM[1] : '');
      const company = decodeHtml(companyM ? companyM[1] : '');
      const rawDate = decodeHtml(dateM ? dateM[1] : '');
      const cleanDate = rawDate.replace(/\s+\d+\s*(?:years?|yrs?|months?|mos?|il|ay).*/i, '').trim();
      const description = decodeHtml(descM ? descM[1] : '');

      if (title || company) {
        roles.push({
          title: title || 'Position',
          company: company || 'Company',
          location: '',
          dates: cleanDate,
          description,
          source: profileUrl,
          uncertain: cleanDate ? [] : ['dates'],
        });
      }
    }
  }

  // Fallback to JSON-LD worksFor if no HTML experience items were found
  if (roles.length === 0 && Array.isArray(personLd?.worksFor)) {
    for (const org of personLd.worksFor) {
      const companyName = org?.name ? decodeHtml(org.name) : '';
      if (companyName) {
        roles.push({
          title: headline || 'Role',
          company: companyName,
          location: '',
          dates: '',
          description: '',
          source: profileUrl,
          uncertain: ['dates'],
        });
      }
    }
  }

  // 4. Education items
  const schools: LinkedInSchool[] = [];
  const eduMatch = html.match(/<ul class="education__list">([\s\S]*?)<\/ul>/i);
  if (eduMatch) {
    const itemMatches = [...eduMatch[1].matchAll(/<li[^>]*class="[^"]*education__list-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)];
    for (const item of itemMatches) {
      const content = item[1];
      const schoolM =
        content.match(/<a[^>]*data-tracking-control-name="public_profile_school"[^>]*>([^<]+)<\/a>/i) ||
        content.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      const degreeM = extractTagContent(content, 'h4')[0];
      const dateM = content.match(/<span class="date-range[^"]*">([\s\S]*?)<\/span>/i);

      const institution = decodeHtml(schoolM ? schoolM[1] : '');
      let detail = decodeHtml(degreeM || '');
      if (detail === '-') detail = '';
      const dates = decodeHtml(dateM ? dateM[1] : '');

      if (institution) {
        schools.push({
          institution,
          detail,
          dates,
          source: profileUrl,
          uncertain: dates ? [] : ['dates'],
        });
      }
    }
  }

  // Fallback to JSON-LD alumniOf if no HTML education items were found
  if (schools.length === 0 && Array.isArray(personLd?.alumniOf)) {
    for (const sch of personLd.alumniOf) {
      const schoolName = sch?.name ? decodeHtml(sch.name) : '';
      if (schoolName) {
        schools.push({
          institution: schoolName,
          detail: '',
          dates: '',
          source: profileUrl,
          uncertain: ['dates'],
        });
      }
    }
  }

  // Incomplete profile check: ensure there is real substantive data, never an empty profile stub
  const hasSubstantialData = roles.length > 0 || schools.length > 0 || (summary && summary.length > 20);
  if (!name || !hasSubstantialData) {
    throw new BadRequestException(
      'LinkedIn profilində təcrübə və ya təhsil məlumatları ictimai görünmür. Profilinizi tam oxumaq üçün profil mətnini kopyalayıb yapışdırın və ya "Save to PDF" faylını yükləyin.',
    );
  }

  return {
    name,
    headline,
    location,
    summary,
    roles,
    schools,
    skills: [],
    languages: [],
    certifications: [],
    awards: [],
    other: {},
    contact: [profileUrl],
  };
}

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MiB = 2,097,152 bytes

/**
 * Reads a decoded body stream with an exact byte limit.
 * Cancels the reader and aborts the controller immediately upon exceeding maxBytes,
 * before consuming or buffering further body content.
 */
export async function readStreamWithByteLimit(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  controller?: AbortController,
): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel('Exceeded maximum response size of 2MiB').catch(() => {});
          controller?.abort();
          throw new BadRequestException('LinkedIn səhifəsi çox böyükdür (maksimum 2MB).');
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const totalBuffer = Buffer.concat(chunks);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(totalBuffer);
}

export async function fetchLinkedInProfileHtml(profileUrl: string): Promise<string> {
  let currentUrl = profileUrl;
  const maxRedirects = 3;
  let redirects = 0;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    while (redirects <= maxRedirects) {
      const validated = validateLinkedInProfileUrl(currentUrl);
      if (!validated.valid || !validated.normalizedUrl) {
        throw new BadRequestException(validated.error || 'LinkedIn URL düzgün deyil');
      }

      const response = await fetch(validated.normalizedUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,az;q=0.8',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
        redirect: 'manual',
      });

      // Handle redirect status (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        // Cancel redirect response body immediately so connection is released and not buffered
        await response.body?.cancel().catch(() => {});
        redirects++;
        const locationHeader = response.headers.get('location');
        if (!locationHeader) {
          throw new BadRequestException('LinkedIn yönləndirmə ünvanı təqdim etmədi.');
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(locationHeader, validated.normalizedUrl);
        } catch {
          throw new BadRequestException('LinkedIn yönləndirmə formatı düzgün deyil.');
        }

        // Detect if redirect points to authwall / login
        if (nextUrl.pathname.includes('/authwall') || nextUrl.pathname.includes('/login')) {
          throw new BadRequestException(
            'LinkedIn bu profilin ictimai baxışına giriş tələb edir. Profil məlumatlarınızı daxil etmək üçün profil mətnini kopyalayıb yapışdırın və ya LinkedIn menyusundan "Save to PDF" faylını yükləyin.',
          );
        }

        // Validate that redirect destination is strictly an allowed LinkedIn URL
        const redirectCheck = validateLinkedInProfileUrl(nextUrl.toString());
        if (!redirectCheck.valid || !redirectCheck.normalizedUrl) {
          throw new BadRequestException('LinkedIn yönləndirməsi icazə verilən ünvandan kənara çıxdı.');
        }

        currentUrl = redirectCheck.normalizedUrl;
        continue;
      }

      if (response.status === 404) {
        await response.body?.cancel().catch(() => {});
        throw new NotFoundException('LinkedIn profili tapılmadı. Keçidin düzgünlüyünü yoxlayın.');
      }

      if ([401, 403, 429, 999].includes(response.status)) {
        await response.body?.cancel().catch(() => {});
        throw new BadRequestException(
          'LinkedIn birbaşa keçidlə oxunmanı müvəqqəti məhdudlaşdırdı. Zəhmət olmasa profil mətnini kopyalayın və ya PDF yükləyin.',
        );
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new BadRequestException(`LinkedIn səhifəsi cavab vermədi (HTTP ${response.status}).`);
      }

      // Check Content-Type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        await response.body?.cancel().catch(() => {});
        throw new BadRequestException('LinkedIn səhifəsindən gözlənilməyən məzmun növü alındı.');
      }

      // Check Content-Length if present
      const contentLengthHeader = response.headers.get('content-length');
      if (contentLengthHeader) {
        const contentLength = Number(contentLengthHeader);
        if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
          await response.body?.cancel().catch(() => {});
          controller.abort();
          throw new BadRequestException('LinkedIn səhifəsi çox böyükdür (maksimum 2MB).');
        }
      }

      let html = '';
      if (response.body && typeof (response.body as any).getReader === 'function') {
        html = await readStreamWithByteLimit(response.body, MAX_RESPONSE_BYTES, controller);
      } else if (typeof (response as any).text === 'function') {
        html = await response.text();
        if (Buffer.byteLength(html, 'utf8') > MAX_RESPONSE_BYTES) {
          controller.abort();
          throw new BadRequestException('LinkedIn səhifəsi çox böyükdür (maksimum 2MB).');
        }
      }

      return html;
    }

    throw new BadRequestException('LinkedIn yönləndirmələrinin sayı həddi aşdı.');
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof NotFoundException) {
      throw error;
    }
    if ((error as any)?.name === 'AbortError') {
      throw new BadRequestException('LinkedIn səhifəsinin cavab vermə vaxtı bitdi (10 saniyə). Zəhmət olmasa yenidən cəhd edin və ya PDF yükləyin.');
    }
    // Profile URLs identify people, and fetch error messages may repeat the target URL.
    // Keep operational logs content-free; return actionable guidance to the caller instead.
    const failureKind = error instanceof Error ? error.name : 'unknown';
    logger.warn(`LinkedIn profile request failed (${failureKind})`);
    throw new BadRequestException('LinkedIn profili oxuna bilmədi. Zəhmət olmasa profil mətnini kopyalayıb yapışdırın və ya PDF yükləyin.');
  } finally {
    clearTimeout(timeout);
  }
}
