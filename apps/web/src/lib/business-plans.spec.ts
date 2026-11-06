import { afterEach, describe, expect, it, vi } from 'vitest';
import { callPlans, daysLeft, nextAction, nextPublicationText, newIdempotencyKey, type PlansOverview, type PlanVacancy } from './business-plans';

const overview = (patch: Partial<PlansOverview> = {}): PlansOverview => ({
  gated: true,
  checkoutAvailable: true,
  prices: { singleAzn: 20, singleDays: 30, businessAznPerMonth: 100, trialDays: 14 },
  trial: { available: true, used: false, startedAt: null, endsAt: null },
  credits: { available: 0 },
  business: { active: false, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
  nextPublication: 'TRIAL',
  ...patch,
});
const vacancy = (patch: Partial<PlanVacancy> = {}): PlanVacancy => ({ id: 'v1', title: 'Mühasib', status: 'DRAFT', ...patch });
const NOW = Date.parse('2026-10-11T10:00:00Z');
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

describe('employer plan wording', () => {
  it('says exactly what the next publication will use', () => {
    expect(nextPublicationText(overview())).toMatch(/Ödənişsiz 14 günlük sınaq.*Kart tələb olunmur/);
    expect(nextPublicationText(overview({ nextPublication: 'CREDIT', credits: { available: 1 } }))).toMatch(/Tək vakansiya krediti.*30 gün/);
    expect(nextPublicationText(overview({ nextPublication: 'BUSINESS' }))).toMatch(/Biznes/);
    expect(nextPublicationText(overview({ nextPublication: 'NONE' }))).toMatch(/20 AZN/);
  });

  it('counts days left without going negative', () => {
    expect(daysLeft(inDays(3), NOW)).toBe(3);
    expect(daysLeft(inDays(-2), NOW)).toBe(0);
    expect(daysLeft(null, NOW)).toBeNull();
  });
});

describe('next action per vacancy state', () => {
  it('moves draft → review without spending anything, and shows the reason of a rejection', () => {
    expect(nextAction(vacancy({ status: 'DRAFT' }), overview(), NOW)).toMatchObject({ kind: 'submit' });
    expect(nextAction(vacancy({ status: 'DRAFT' }), overview(), NOW).cost).toBeUndefined();
    expect(nextAction(vacancy({ status: 'PENDING_REVIEW' }), overview(), NOW)).toMatchObject({ kind: 'none' });
    const rejected = nextAction(vacancy({ status: 'REJECTED', moderationNote: 'Təsvir qısadır' }), overview(), NOW);
    expect(rejected).toMatchObject({ kind: 'submit' });
    expect(rejected.hint).toContain('Təsvir qısadır');
  });

  it('offers publication with its cost when entitled, and plan purchase when not', () => {
    const entitled = nextAction(vacancy({ status: 'APPROVED' }), overview(), NOW);
    expect(entitled).toMatchObject({ kind: 'publish' });
    expect(entitled.cost).toMatch(/sınaq/);
    const none = nextAction(vacancy({ status: 'APPROVED' }), overview({ nextPublication: 'NONE', trial: { available: false, used: true, startedAt: null, endsAt: null } }), NOW);
    expect(none).toMatchObject({ kind: 'buy' });
  });

  it('offers a paid extension only near the end, and only explicitly', () => {
    const far = nextAction(vacancy({ status: 'ACTIVE', publicationPlan: 'SINGLE', expiresAt: inDays(20) }), overview(), NOW);
    expect(far.kind).toBe('none');
    const nearNoCredit = nextAction(vacancy({ status: 'ACTIVE', publicationPlan: 'SINGLE', expiresAt: inDays(3) }), overview({ nextPublication: 'NONE' }), NOW);
    expect(nearNoCredit).toMatchObject({ kind: 'buy' });
    expect(nearNoCredit.hint).toMatch(/Avtomatik yenilənmə yoxdur/);
    expect(nearNoCredit.label).toMatch(/30 gün — 20 AZN/);
    const trialNear = nextAction(vacancy({ status: 'ACTIVE', publicationPlan: 'TRIAL', expiresAt: inDays(3) }), overview({ nextPublication: 'NONE' }), NOW);
    expect(trialNear.label).toMatch(/^Sınaq bitəndən sonra davam etmək üçün/);
    const nearCredit = nextAction(vacancy({ status: 'ACTIVE', publicationPlan: 'SINGLE', expiresAt: inDays(3) }), overview({ credits: { available: 1 }, nextPublication: 'CREDIT' }), NOW);
    expect(nearCredit).toMatchObject({ kind: 'extend' });
    expect(nearCredit.cost).toMatch(/kredit/);
  });

  it('asks Business listings to be reconfirmed, at no charge', () => {
    const a = nextAction(vacancy({ status: 'ACTIVE', publicationPlan: 'BUSINESS', expiresAt: inDays(5) }), overview({ nextPublication: 'BUSINESS' }), NOW);
    expect(a).toMatchObject({ kind: 'reconfirm' });
    expect(a.hint).toMatch(/əlavə ödəniş yoxdur/);
  });

  it('explains every expiry reason and keeps the data promise', () => {
    for (const [reason, text] of [['TRIAL_ENDED', /sınaq/i], ['DURATION', /30 günlük/], ['SUBSCRIPTION_LAPSED', /abunəliyi/i]] as const) {
      const a = nextAction(vacancy({ status: 'EXPIRED', expiryReason: reason }), overview({ nextPublication: 'NONE' }), NOW);
      expect(a.hint).toMatch(text);
      expect(a.hint).toMatch(/saxlanılıb/);
    }
    expect(nextAction(vacancy({ status: 'EXPIRED', expiryReason: 'DEADLINE' }), overview(), NOW)).toMatchObject({ kind: 'edit' });
  });
});

describe('callPlans', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the server data on success and its own plain message on refusal', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'v1', status: 'ACTIVE' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ statusCode: 403, message: { code: 'ENTITLEMENT_REQUIRED', message: 'Yayımlamaq üçün plan lazımdır' } }), { status: 403 })));
    const ok = await callPlans('/vacancies/v1/publish', { method: 'POST' });
    expect(ok).toMatchObject({ ok: true, data: { status: 'ACTIVE' } });
    const refused = await callPlans('/vacancies/v1/publish', { method: 'POST' });
    expect(refused).toMatchObject({ ok: false, status: 403, message: 'Yayımlamaq üçün plan lazımdır' });
  });

  it('never throws on a network failure and says so', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const r = await callPlans('');
    expect(r).toMatchObject({ ok: false, status: 0 });
    expect(r.message).toMatch(/Şəbəkə/);
  });

  it('generates idempotency keys the server accepts', () => {
    expect(newIdempotencyKey()).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});
