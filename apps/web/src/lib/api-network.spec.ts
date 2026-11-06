import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth/react', () => ({ getSession: vi.fn(async () => null) }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

describe('apiFetch network failures', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("replaces the browser's 'Failed to fetch' with a plain Azerbaijani message", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { apiFetch, ApiNetworkError } = await import('./api');
    const err = await apiFetch('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiNetworkError);
    expect(err.message).toBe('AISE ilə əlaqə qurulmadı. İnternet bağlantınızı yoxlayıb yenidən cəhd edin.');
  });

  it("lets a caller's own abort through unchanged", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); }));
    const { apiFetch } = await import('./api');
    await expect(apiFetch('/x')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
