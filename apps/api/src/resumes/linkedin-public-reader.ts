import { BadRequestException } from '@nestjs/common';
import type { LinkedInProfile } from './linkedin-import';
import { fetchLinkedInProfileHtml, MAX_RESPONSE_BYTES, parseLinkedInPublicHtml, readStreamWithByteLimit, validateLinkedInProfileUrl } from './linkedin-url-extract';

const READER_TIMEOUT_MS = 15_000;
const READER_FAILURE = 'Alternativ oxuma xidməti profili təsdiqləyə bilmədi. Yenidən cəhd edə, LinkedIn PDF-i yükləyə və ya profil mətnini yapışdıra bilərsiniz.';

/** Public profile URL only, after explicit per-request consent. Never forwards cookies, files or account/profile data. */
export async function fetchLinkedInViaPublicReader(profileUrl: string): Promise<LinkedInProfile> {
  const validated = validateLinkedInProfileUrl(profileUrl);
  if (!validated.valid || !validated.normalizedUrl) throw new BadRequestException(validated.error);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READER_TIMEOUT_MS);
  try {
    const response = await fetch(`https://r.jina.ai/${validated.normalizedUrl}`, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', 'X-Respond-With': 'html', DNT: '1' },
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel().catch(() => {});
      throw new BadRequestException(READER_FAILURE);
    }
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => {});
      controller.abort();
      throw new BadRequestException(READER_FAILURE);
    }
    const text = await readStreamWithByteLimit(response.body, MAX_RESPONSE_BYTES, controller);
    const result = JSON.parse(text);
    const data = result?.data;
    const returnedUrl = validateLinkedInProfileUrl(data?.url);
    if (data?.httpStatus !== 200 || !returnedUrl.valid || returnedUrl.username !== validated.username ||
      typeof data.html !== 'string' || !data.html.trim() || Buffer.byteLength(data.html, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new BadRequestException(READER_FAILURE);
    }
    // Reader titles/Markdown may describe a shared article. Only identity-verified profile HTML is usable.
    return parseLinkedInPublicHtml(data.html, validated.normalizedUrl, { requireExactIdentity: true });
  } catch {
    // Do not log returned profile content, the supplied URL or provider response bodies.
    throw new BadRequestException(READER_FAILURE);
  } finally {
    clearTimeout(timer);
  }
}

export async function readPublicLinkedInProfile(profileUrl: string, allowPublicReader = false): Promise<{ profile: LinkedInProfile; method: 'direct' | 'public_reader' }> {
  const validated = validateLinkedInProfileUrl(profileUrl);
  if (!validated.valid || !validated.normalizedUrl) throw new BadRequestException(validated.error);
  try {
    const html = await fetchLinkedInProfileHtml(validated.normalizedUrl);
    return { profile: parseLinkedInPublicHtml(html, validated.normalizedUrl), method: 'direct' };
  } catch (error) {
    // Never silently send a URL to a third party, retry an explicitly missing profile or hide programming errors.
    if (allowPublicReader !== true || process.env.LINKEDIN_PUBLIC_READER_ENABLED === 'false' || !(error instanceof BadRequestException)) throw error;
    return { profile: await fetchLinkedInViaPublicReader(validated.normalizedUrl), method: 'public_reader' };
  }
}
