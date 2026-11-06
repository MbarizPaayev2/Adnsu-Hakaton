import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentAvailability } from './document-availability';
afterEach(() => vi.unstubAllGlobals());
describe('public document availability', () => {
  it.each([true, false])('uses the server flag %s without caching a rollout state', async (flag) => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ documentGenerationEnabled: flag }) });
    vi.stubGlobal('fetch', fetcher);
    expect(await documentAvailability()).toBe(flag);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/billing/status'), expect.objectContaining({ cache: 'no-store' }));
  });
  it.each([{}, null, { documentGenerationEnabled: 'true' }])('rejects malformed or absent capabilities %j', async data => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
    expect(await documentAvailability()).toBeNull();
  });
  it('does not claim availability on server or network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await documentAvailability()).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unreachable')));
    expect(await documentAvailability()).toBeNull();
  });
});
