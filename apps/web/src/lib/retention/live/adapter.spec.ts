import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { createLiveApi } from './adapter';
import { RetentionError } from '../contract';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const routes = (map: Record<string, (init?: RequestInit) => Response>) =>
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const key = `${init?.method || 'GET'} ${path}`;
    const hit = map[key];
    if (!hit) throw new Error(`unexpected request ${key}`);
    return hit(init);
  });
const calls = () => apiFetch.mock.calls.map(([p, i]) => `${(i as RequestInit | undefined)?.method || 'GET'} ${p}`);

beforeEach(() => {
  apiFetch.mockReset();
});

describe('live retention adapter', () => {
  it('reports what the backend cannot do instead of faking it', () => {
    expect(createLiveApi().capabilities).toEqual({ weeklyDigest: false, perSearchFrequency: false });
  });

  it('follows by stable company id and keeps same-named employers apart', async () => {
    routes({
      'GET /companies': () => json([
        { id: 'c2', name: 'Eyni Ad', status: 'APPROVED', _count: { vacancies: 1 } },
        { id: 'c1', name: 'Eyni Ad', status: 'APPROVED', _count: { vacancies: 4 } },
      ]),
      'PUT /company-follows': (i) => { expect(JSON.parse(String(i?.body))).toEqual({ companyId: 'c1' }); return json({ ok: true }); },
    });
    const api = createLiveApi();
    const list = await api.listCompanies();
    expect(list.map((c) => c.key).sort()).toEqual(['company:c1', 'company:c2']);
    expect(list.find((c) => c.id === 'c1')?.openVacancies).toBe(4);
    await api.setFollowed('company:c1', true);
    expect(calls()).toContain('PUT /company-follows');
  });

  it('follows observed companies by name and verifies that the API returns the requested key', async () => {
    routes({
      'PUT /company-follows': (init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ company: 'Baker Tilly Azerbaijan' });
        return json({ id: 'f1', companyKey: 'baker tilly azerbaijan', created: true });
      },
      'GET /company-follows': () => json([{ id: 'f1', companyKey: 'baker tilly azerbaijan' }]),
      'DELETE /company-follows/f1': () => json({ removed: true }),
    });
    const api = createLiveApi();
    await api.setFollowed('baker tilly azerbaijan', true, 'Baker Tilly Azerbaijan');
    expect(await api.listFollowed()).toEqual(['baker tilly azerbaijan']);
    await api.setFollowed('baker tilly azerbaijan', false, 'Baker Tilly Azerbaijan');
    expect(calls()).toEqual(['PUT /company-follows', 'GET /company-follows', 'GET /company-follows', 'DELETE /company-follows/f1']);
  });

  it('removes and rejects a follow if the server normalizes it to another company key', async () => {
    routes({
      'PUT /company-follows': () => json({ id: 'f2', companyKey: 'wrong company', created: true }),
      'DELETE /company-follows/f2': () => json({ removed: true }),
    });
    await expect(createLiveApi().setFollowed('baker tilly azerbaijan', true, 'Other Name')).rejects.toMatchObject({ code: 'FAILED' });
    expect(calls()).toEqual(['PUT /company-follows', 'DELETE /company-follows/f2']);
  });

  it('still refuses an observed key without a display name', async () => {
    await expect(createLiveApi().setFollowed('acme', true)).rejects.toBeInstanceOf(RetentionError);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('a missing vacancy count is unknown, not zero', async () => {
    routes({ 'GET /companies': () => json([{ id: 'c1', name: 'A', status: 'APPROVED' }]) });
    expect((await createLiveApi().listCompanies())[0].openVacancies).toBeNull();
  });

  it('maps API errors: 401 session, 404 not found, 503 unavailable, network failure', async () => {
    const api = createLiveApi();
    routes({ 'GET /saved-jobs': () => json({ message: 'x' }, 401) });
    await expect(api.listSavedJobs()).rejects.toMatchObject({ code: 'SIGNED_OUT' });
    routes({ 'POST /telegram/link-token': () => json({ message: 'Telegram aktiv deyil' }, 503) });
    await expect(api.startTelegramLink()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    routes({ 'DELETE /saved-jobs/job%3Ax': () => json({ message: 'yox' }, 404) });
    await expect(api.unsaveJob('job:x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    apiFetch.mockRejectedValue(new Error('offline'));
    await expect(api.listSavedJobs()).rejects.toMatchObject({ code: 'FAILED' });
  });

  const prefs = (over: Record<string, unknown> = {}) => ({
    emailEnabled: true, matchInApp: true, newJobInApp: true, matchEmail: true, newJobEmail: 'DAILY', quietStartMinute: null, quietEndMinute: null, pausedUntil: null,
    instant: { available: false, dailyLimit: null }, ...over,
  });

  it('shows Telegram as unavailable when the server says it is not configured', async () => {
    routes({ 'GET /notification-preferences': () => json(prefs()), 'GET /telegram': () => json({ enabled: false, status: 'DISABLED' }) });
    expect((await createLiveApi().getPreferences()).telegram).toBe('unavailable');
  });

  it('shows Telegram as unavailable when the status request itself fails', async () => {
    routes({ 'GET /notification-preferences': () => json(prefs()), 'GET /telegram': () => json({}, 500) });
    expect((await createLiveApi().getPreferences()).telegram).toBe('unavailable');
  });

  it('sends only what changed and refuses the weekly digest the backend does not have', async () => {
    let put: unknown;
    routes({
      'GET /notification-preferences': () => json(prefs()),
      'GET /telegram': () => json({ enabled: false }),
      'PUT /notification-preferences': (i) => { put = JSON.parse(String(i?.body)); return json({}); },
    });
    const api = createLiveApi();
    const before = await api.getPreferences();
    await api.updatePreferences({ ...before, quietHours: { enabled: true, from: '22:30', to: '07:00' } });
    expect(put).toEqual({ quietStartMinute: 1350, quietEndMinute: 420 });
    await expect(api.updatePreferences({ ...before, frequency: 'weekly' })).rejects.toBeInstanceOf(RetentionError);
  });

  it('catalogue: no price invented, premium not purchasable without server price and enabled payments, planned features labelled', async () => {
    routes({
      'GET /billing/catalogue': () => json({
        candidate: { offers: [
          { id: 'free', label: 'Free', price: 0, features: { 'saved.jobs': { enabled: true, limit: 200, period: 'lifetime' } } },
          { id: 'premium', label: 'Premium', price: null, purchasable: true, features: { 'tailored.cover_letter': { enabled: true, availability: 'planned', costly: true, limit: 20, period: 'month' } } },
        ] },
        employer: { offers: [{ id: 'single_job', label: 'Single job' }], addons: [] },
        positioning: {},
      }),
      'GET /billing/status': () => json({ paymentsEnabled: false }),
    });
    const cat = await createLiveApi().getCatalogue();
    expect(cat.candidate.premium.priceAzn).toBeNull();
    expect(cat.candidate.premium.purchasable).toBe(false);
    expect(cat.candidate.premium.includes.join(' ')).toContain('hazırlanır');
    expect(cat.candidate.premium.allowances).toEqual([]);
    expect(cat.candidate.free.allowances).toEqual([{ label: 'Elanları yadda saxlama', value: '200 ümumi' }]);
    expect(cat.employer.every((e) => e.available === false)).toBe(true);
    expect(cat.paymentsEnabled).toBe(false);
  });

  it('catalogue: purchasable only with a server price AND payments enabled; a failed status request means not enabled', async () => {
    const catalogue = { candidate: { offers: [{ id: 'free', label: 'Free', features: {} }, { id: 'premium', label: 'Premium', price: 12, purchasable: true, features: {} }] }, employer: { offers: [], addons: [] } };
    routes({ 'GET /billing/catalogue': () => json(catalogue), 'GET /billing/status': () => json({ paymentsEnabled: true }) });
    expect((await createLiveApi().getCatalogue()).candidate.premium.purchasable).toBe(true);
    routes({ 'GET /billing/catalogue': () => json(catalogue), 'GET /billing/status': () => json({}, 500) });
    const off = await createLiveApi().getCatalogue();
    expect(off.paymentsEnabled).toBe(false);
    expect(off.candidate.premium.purchasable).toBe(false);
  });
});


it('saved searches load without depending on notification settings or Telegram', async () => {
  routes({ 'GET /saved-searches': () => json([{ id: 's', name: 'Analyst', criteria: {}, alertsEnabled: true, updatedAt: '2026-10-13' }]) });
  expect(await createLiveApi().listSearches()).toHaveLength(1);
  expect(calls()).toEqual(['GET /saved-searches']);
});
it('retries a temporary gateway failure once for saved jobs, never a write', async () => {
  apiFetch.mockResolvedValueOnce(json({}, 502)).mockResolvedValueOnce(json([]));
  expect(await createLiveApi().listSavedJobs()).toEqual([]);
  expect(apiFetch).toHaveBeenCalledTimes(2);
  apiFetch.mockReset().mockResolvedValue(json({}, 502));
  await expect(createLiveApi().unsaveJob('imported:j')).rejects.toBeInstanceOf(RetentionError);
  expect(apiFetch).toHaveBeenCalledTimes(1);

});

describe('saved-job lookups', () => {
  it('one saved-jobs lookup serves every save button on a page', async () => {
    routes({
      'GET /saved-jobs': () => json([{ ref: 'imported:1', title: 'A', company: 'B', state: 'open', savedAt: '2026-10-17' }]),
      'PUT /saved-jobs/imported%3A2': () => json({ ok: true }),
    });
    const api = createLiveApi();
    const keys = Array.from({ length: 24 }, (_, n) => `imported:${n}`);
    const saved = await Promise.all(keys.map((k) => api.isJobSaved(k)));
    expect(saved.filter(Boolean)).toHaveLength(1);
    await api.saveJob({ key: 'imported:2', title: 'C', company: 'D', location: null, deadline: null });
    expect(await api.isJobSaved('imported:2')).toBe(true);
    expect(calls().filter((c) => c === 'GET /saved-jobs')).toHaveLength(1);
  });

  it('a failed lookup is not remembered', async () => {
    let n = 0;
    routes({ 'GET /saved-jobs': () => (++n === 1 ? json({ message: 'x' }, 500) : json([])) });
    const api = createLiveApi();
    await expect(api.isJobSaved('imported:1')).rejects.toBeInstanceOf(RetentionError);
    expect(await api.isJobSaved('imported:1')).toBe(false);
  });

  it('reports rate limiting and sign-out as such, with the message to show', async () => {
    routes({ 'GET /saved-jobs': () => json({ message: 'Qısa müddətdə çox sorğu göndərildi. 12 saniyə sonra yenidən cəhd edin.' }, 429) });
    await expect(createLiveApi().listSavedJobs()).rejects.toMatchObject({ code: 'RATE_LIMITED', message: expect.stringContaining('12 saniyə') });
    expect(calls()).toEqual(['GET /saved-jobs']);
    routes({ 'GET /saved-searches': () => json({ message: 'no' }, 401) });
    await expect(createLiveApi().listSearches()).rejects.toMatchObject({ code: 'SIGNED_OUT' });
  });
});
