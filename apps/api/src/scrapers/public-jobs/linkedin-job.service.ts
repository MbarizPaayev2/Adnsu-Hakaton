import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';
import {
  parseLinkedInJobDetail,
  validateLinkedInJobUrl,
  type LinkedInListingEntry,
} from './linkedin-job.parser';

export const MAX_JOB_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export class LinkedInAccessReviewRequiredError extends Error {
  readonly code = 'ACCESS_REVIEW_PENDING';
  constructor() {
    super('LinkedIn avtomatik oxunuşu üçün açıq icazə və şərtlərin yoxlanışı tələb olunur. Vakansiya mətnini yapışdırın.');
    this.name = 'LinkedInAccessReviewRequiredError';
  }
}

export class LinkedInPublicAccessUnavailableError extends Error {
  readonly code = 'AUTHWALL_OR_LOGIN_REQUIRED';
  constructor(message = 'LinkedIn bu vakansiyanın oxunmasını məhdudlaşdırdı. Vakansiyanın mətnini birbaşa yapışdırın.') {
    super(message);
    this.name = 'LinkedInPublicAccessUnavailableError';
  }
}

export interface LinkedInJobExtractionResult {
  job: IngestJobDto;
  method: 'direct';
}

/**
 * Reads stream with byte limit to prevent unbounded memory growth.
 */
async function readStream(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  controller: AbortController,
): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalLength += value.length;
        if (totalLength > limit) {
          controller.abort();
          throw new BadRequestException('Məzmun ölçüsü icazə verilən həddi aşdı');
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

/**
 * Reads public job pages directly. A block, authwall or rate limit ends the
 * attempt; it is never routed through a third-party reader to evade the site's
 * access controls. The user can paste the vacancy text instead.
 */
export async function fetchLinkedInJobHtml(
  jobUrl: string,
): Promise<{ html: string; method: 'direct' }> {
  const validated = validateLinkedInJobUrl(jobUrl);
  if (!validated.valid || !validated.normalizedUrl) {
    throw new BadRequestException(validated.error || 'LinkedIn URL düzgün deyil');
  }

  // LinkedIn's current robots.txt and User Agreement do not authorize automated
  // collection. This kill switch stays off unless a documented permission review
  // explicitly approves automated URL reads. Candidate paste parsing remains available.
  if (process.env.LINKEDIN_URL_READ_APPROVED !== 'true') throw new LinkedInAccessReviewRequiredError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let currentUrl = validated.normalizedUrl;
  let redirects = 0;
  const maxRedirects = 3;

  try {
    while (redirects <= maxRedirects) {
      const response = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'az,en-US;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
        redirect: 'manual',
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        try { await response.body?.cancel(); } catch {}
        redirects++;
        const location = response.headers.get('location');
        if (!location) throw new BadRequestException('LinkedIn yönləndirmə ünvanı təqdim etmədi');

        const nextUrl = new URL(location, currentUrl);
        if (nextUrl.pathname.includes('/authwall') || nextUrl.pathname.includes('/login') || nextUrl.pathname.includes('/checkpoint')) {
          throw new LinkedInPublicAccessUnavailableError();
        }

        const nextCheck = validateLinkedInJobUrl(nextUrl.toString());
        if (!nextCheck.valid || !nextCheck.normalizedUrl) {
          throw new BadRequestException('LinkedIn yönləndirməsi icazə verilən ünvandan kənara çıxdı');
        }
        currentUrl = nextCheck.normalizedUrl;
        continue;
      }

      if (response.status === 404) {
        try { await response.body?.cancel(); } catch {}
        throw new NotFoundException('LinkedIn vakansiyası tapılmadı (HTTP 404)');
      }

      if ([401, 403, 429, 999].includes(response.status)) {
        try { await response.body?.cancel(); } catch {}
        throw new LinkedInPublicAccessUnavailableError(`LinkedIn sorğunu məhdudlaşdırdı (HTTP ${response.status}). Vakansiya mətnini birbaşa yapışdırın.`);
      }

      if (!response.ok) {
        try { await response.body?.cancel(); } catch {}
        throw new BadRequestException(`LinkedIn səhifəsi cavab vermədi (HTTP ${response.status})`);
      }

      const html = await readStream(response.body, MAX_JOB_RESPONSE_BYTES, controller);
      return { html, method: 'direct' };
    }

    throw new BadRequestException('Həddindən artıq yönləndirmə aşkarlandı');
  } catch (error) {
    if (error instanceof NotFoundException) throw error;
    if (error instanceof BadRequestException) throw error;
    if (error instanceof LinkedInPublicAccessUnavailableError) throw error;
    if (error instanceof LinkedInAccessReviewRequiredError) throw error;
    throw new BadRequestException(error instanceof Error ? error.message : 'LinkedIn vakansiya məlumatı oxuna bilmədi');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * High-level service function to extract a complete IngestJobDto from any public LinkedIn vacancy URL.
 */
export async function extractLinkedInJob(
  url: string,
  options: { fetchedAt?: Date; listingEntry?: LinkedInListingEntry } = {},
): Promise<LinkedInJobExtractionResult> {
  const fetchedAt = options.fetchedAt ?? new Date();
  const { html, method } = await fetchLinkedInJobHtml(url);
  const job = parseLinkedInJobDetail(html, url, fetchedAt, options.listingEntry);
  return { job, method };
}
