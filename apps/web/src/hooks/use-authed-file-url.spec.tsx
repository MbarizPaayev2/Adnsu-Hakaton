import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAuthedFileUrl } from './use-authed-file-url';

const { fetchAuthedFileUrl } = vi.hoisted(() => ({ fetchAuthedFileUrl: vi.fn() }));
vi.mock('@/lib/api', () => ({ fetchAuthedFileUrl }));

describe('useAuthedFileUrl', () => {
  it('drops the previous image as soon as the file changes, before the new one has loaded', async () => {
    let resolveSecond!: (v: string) => void;
    fetchAuthedFileUrl.mockResolvedValueOnce('blob:first').mockReturnValueOnce(new Promise((r) => { resolveSecond = r; }));
    vi.stubGlobal('URL', { ...URL, revokeObjectURL: vi.fn() });
    const { result, rerender } = renderHook(({ url }) => useAuthedFileUrl(url), { initialProps: { url: '/uploads/before.png' } });
    await act(async () => {});
    expect(result.current).toBe('blob:first');
    rerender({ url: '/uploads/after.png' });
    expect(result.current).toBeNull();
    await act(async () => { resolveSecond('blob:second'); });
    expect(result.current).toBe('blob:second');
    vi.unstubAllGlobals();
  });
});
