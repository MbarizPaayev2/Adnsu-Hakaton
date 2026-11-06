import { describe, expect, it } from 'vitest';
import { rejectCrossSite } from './admin-origin';

const req = (method: string, headers: Record<string, string>) => new Request('http://admin.test/api/admin/x', { method, headers });

describe('rejectCrossSite', () => {
  it('lets reads and same-site writes through', () => {
    expect(rejectCrossSite(req('GET', { origin: 'https://evil.example', host: 'aisehr.com' }))).toBeNull();
    expect(rejectCrossSite(req('POST', { origin: 'https://aisehr.com', host: 'aisehr.com' }))).toBeNull();
    expect(rejectCrossSite(req('POST', { origin: 'https://aisehr.com', host: 'internal:3000', 'x-forwarded-host': 'aisehr.com' }))).toBeNull();
    expect(rejectCrossSite(req('POST', { host: 'aisehr.com' }))).toBeNull();
  });

  it('refuses a state-changing request from another site', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
      const res = rejectCrossSite(req(method, { origin: 'https://evil.example', host: 'aisehr.com' }));
      expect(res?.status).toBe(403);
    }
    expect(rejectCrossSite(req('POST', { origin: 'null', host: 'aisehr.com' }))?.status).toBe(403);
  });
});
