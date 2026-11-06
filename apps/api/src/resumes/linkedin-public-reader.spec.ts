import { BadRequestException, NotFoundException } from '@nestjs/common';
import { fetchLinkedInViaPublicReader, readPublicLinkedInProfile } from './linkedin-public-reader';
import { MAX_RESPONSE_BYTES } from './linkedin-url-extract';

const URL = 'https://www.linkedin.com/in/ada-synthetic';
const html = (slug = 'ada-synthetic') => `<title>Ada Synthetic - Data Analyst | LinkedIn</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Person', name: 'Ada Synthetic', url: `https://www.linkedin.com/in/${slug}`, description: 'Confirmed public profile with experience in SQL reporting.', worksFor: [{ name: 'Example Company' }] })}</script>`;
const reader = (overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({ data: { url: URL, httpStatus: 200, html: html(), ...overrides } }), { headers: { 'Content-Type': 'application/json' } });

describe('optional public LinkedIn reader', () => {
  let fetchMock: jest.SpyInstance;
  const originalFlag = process.env.LINKEDIN_PUBLIC_READER_ENABLED;
  beforeEach(() => { delete process.env.LINKEDIN_PUBLIC_READER_ENABLED; fetchMock = jest.spyOn(global, 'fetch'); });
  afterEach(() => { fetchMock.mockRestore(); jest.useRealTimers(); if (originalFlag === undefined) delete process.env.LINKEDIN_PUBLIC_READER_ENABLED; else process.env.LINKEDIN_PUBLIC_READER_ENABLED = originalFlag; });

  it.each([false, undefined, 'true'])('does not contact the reader without literal consent (%s)', async (consent) => {
    fetchMock.mockResolvedValue(new Response('', { status: 403 }));
    await expect(readPublicLinkedInProfile(URL, consent as boolean)).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(URL);
  });

  it('uses direct profile access when it works, even with consent', async () => {
    fetchMock.mockResolvedValue(new Response(html(), { headers: { 'Content-Type': 'text/html' } }));
    const result = await readPublicLinkedInProfile(URL, true);
    expect(result.method).toBe('direct');
    expect(result.profile.name).toBe('Ada Synthetic');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recovers a restricted profile with identity-verified HTML, not an article title or Markdown', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 })).mockResolvedValueOnce(reader({ title: 'An unrelated shared article', content: 'Do not import this content' }));
    const result = await readPublicLinkedInProfile(URL, true);
    expect(result.method).toBe('public_reader');
    expect(result.profile.name).toBe('Ada Synthetic');
    expect(result.profile.roles[0].company).toBe('Example Company');
    const [target, options] = fetchMock.mock.calls[1];
    expect(target).toBe(`https://r.jina.ai/${URL}`);
    expect(options.redirect).toBe('error');
    expect(options.headers).toEqual({ Accept: 'application/json', 'X-Respond-With': 'html', DNT: '1' });
    expect(options.body).toBeUndefined();
  });

  it('does not recover a missing profile from possibly stale provider data', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    await expect(readPublicLinkedInProfile(URL, true)).rejects.toBeInstanceOf(NotFoundException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('respects the operator kill switch despite user consent', async () => {
    process.env.LINKEDIN_PUBLIC_READER_ENABLED = 'false';
    fetchMock.mockResolvedValue(new Response('', { status: 403 }));
    await expect(readPublicLinkedInProfile(URL, true)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { url: 'https://www.linkedin.com/in/another-person' },
    { url: 'http://127.0.0.1/in/ada-synthetic' },
    { html: html('another-person') },
    { html: '<title>Ada Synthetic | LinkedIn</title><ul class="experience__list"><li class="experience-item"><span class="experience-item__title">Analyst</span></li></ul>' },
    { html: '<title>Sign In | LinkedIn</title>' },
    { httpStatus: 403 },
    { html: undefined, content: 'Markdown with an apparent name and roles' },
  ])('rejects unverifiable reader output: %j', async (data) => {
    fetchMock.mockResolvedValue(reader(data));
    await expect(fetchLinkedInViaPublicReader(URL)).rejects.toThrow('Alternativ oxuma xidməti');
  });

  it('rejects invalid targets before making any external request', async () => {
    await expect(fetchLinkedInViaPublicReader('https://169.254.169.254/in/test')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds response streaming, cancels oversized data and aborts the request', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1)); },
      cancel() { cancelled = true; },
    });
    fetchMock.mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    await expect(fetchLinkedInViaPublicReader(URL)).rejects.toThrow('Alternativ oxuma xidməti');
    expect(cancelled).toBe(true);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('aborts a stalled reader after 15 seconds without retries', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const rejected = expect(fetchLinkedInViaPublicReader(URL)).rejects.toThrow('Alternativ oxuma xidməti');
    await jest.advanceTimersByTimeAsync(15_001);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancels rate-limit responses and does not retry them', async () => {
    let cancelled = false;
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 429 }));
    await expect(fetchLinkedInViaPublicReader(URL)).rejects.toThrow('Alternativ oxuma xidməti');
    expect(cancelled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
