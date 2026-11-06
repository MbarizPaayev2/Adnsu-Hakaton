import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSessionMock = vi.fn();
const getServerSessionMock = vi.fn();

vi.mock('next-auth/react', () => ({
  getSession: getSessionMock,
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/app/api/auth/[...nextauth]/route', () => ({
  authOptions: {},
}));

describe('apiFetch', () => {
  const originalWindow = globalThis.window;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    getServerSessionMock.mockReset();
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    // Restore whichever environment (browser vs server) the test switched to.
    if (originalWindow === undefined) {
      // @ts-expect-error - deleting jsdom's window to simulate a server context
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
    vi.unstubAllGlobals();
  });

  it('attaches Authorization from getSession when running in the browser', async () => {
    getSessionMock.mockResolvedValue({ sessionToken: 'browser-token' });

    const { apiFetch } = await import('./api');
    await apiFetch('/foo');

    expect(getSessionMock).toHaveBeenCalled();
    expect(getServerSessionMock).not.toHaveBeenCalled();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:4000/foo');
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer browser-token');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('attaches Authorization from getServerSession when window is undefined (server context)', async () => {
    // @ts-expect-error - simulate a server (non-browser) environment
    delete globalThis.window;
    getServerSessionMock.mockResolvedValue({ sessionToken: 'server-token' });

    const { apiFetch } = await import('./api');
    await apiFetch('/foo');

    expect(getServerSessionMock).toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer server-token');
  });

  it('omits Authorization entirely when there is no session', async () => {
    getSessionMock.mockResolvedValue(null);

    const { apiFetch } = await import('./api');
    await apiFetch('/foo');

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.has('Authorization')).toBe(false);
  });

  it('does not default Content-Type when the body is FormData', async () => {
    getSessionMock.mockResolvedValue(null);

    const { apiFetch } = await import('./api');
    const formData = new FormData();
    formData.append('file', 'contents');
    await apiFetch('/upload', { method: 'POST', body: formData });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('preserves an explicitly-set Content-Type instead of overwriting it', async () => {
    getSessionMock.mockResolvedValue(null);

    const { apiFetch } = await import('./api');
    await apiFetch('/foo', { headers: { 'Content-Type': 'text/plain' } });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Content-Type')).toBe('text/plain');
  });
});
