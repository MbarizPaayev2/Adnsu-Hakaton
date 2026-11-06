// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = { get: vi.fn() };
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));

const API = 'http://api.test';
let GET: typeof import('./route').GET;
let PATCH: typeof import('./route').PATCH;
let POST: typeof import('./route').POST;
const fetchMock = vi.fn();

const call = (handler: typeof GET, url: string, path: string[], init?: RequestInit) =>
  handler(new NextRequest(`http://web.test${url}`, init as any), { params: Promise.resolve({ path }) });

beforeEach(async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', API);
  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  ({ GET, PATCH, POST } = await import('./route'));
  cookieStore.get.mockReturnValue({ value: 'biz-token' });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('employer attachment proxy (/api/business/uploads/:filename)', () => {
  it('forwards to the authorized /uploads route with the cookie token and returns the exact bytes', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x10]);
    fetchMock.mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-disposition': 'inline; filename="cv.docx"' },
    }));

    const res = await call(GET, '/api/business/uploads/abc-123.docx?x=1', ['uploads', 'abc-123.docx']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/uploads/abc-123.docx`); // query string is not forwarded
    expect(init.method).toBe('GET');
    expect(init.headers.get('Authorization')).toBe('Bearer biz-token');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(res.headers.get('content-type')).toContain('wordprocessingml');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="cv.docx"');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    [401, 'expired session'],
    [403, 'another company\'s attachment'],
    [404, 'missing file'],
  ])('passes through %i (%s) without leaking content', async (status) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'no' }), { status, headers: { 'content-type': 'application/json' } }));

    const res = await call(GET, '/api/business/uploads/a.pdf', ['uploads', 'a.pdf']);

    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 401 without calling the API when there is no business cookie', async () => {
    cookieStore.get.mockReturnValue(undefined);

    const res = await call(GET, '/api/business/uploads/a.pdf', ['uploads', 'a.pdf']);

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['nested path', ['uploads', 'a', 'b.pdf']],
    ['missing filename', ['uploads']],
    ['dot-dot filename', ['uploads', '..']],
    ['hidden/dot-leading filename', ['uploads', '.env']],
    ['encoded slash', ['uploads', '..%2Fadmin']],
    ['space or other characters', ['uploads', 'a b.pdf']],
  ])('rejects a %s with 400 and never calls the API', async (_label, path) => {
    const res = await call(GET, '/api/business/uploads/x', path);

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses non-GET methods on attachments', async () => {
    const res = await call(POST, '/api/business/uploads/a.pdf', ['uploads', 'a.pdf'], { method: 'POST', body: 'x' });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses dot segments on ordinary business routes so the token stays under /business', async () => {
    const res = await call(GET, '/api/business/x', ['applications', '..', '..', 'admin', 'companies']);

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ordinary business routes', () => {
  it('forwards method, JSON body and query string under /business', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'REVIEWING' }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const res = await call(PATCH, '/api/business/applications/app_1/status?v=2', ['applications', 'app_1', 'status'], {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'REVIEWING' }),
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/business/applications/app_1/status?v=2`);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe('{"status":"REVIEWING"}');
    expect(init.headers.get('Content-Type')).toBe('application/json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'REVIEWING' });
  });
});
