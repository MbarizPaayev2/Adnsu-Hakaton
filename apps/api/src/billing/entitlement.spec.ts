import { effectivePlan, RENEWAL_GRACE_MS, subscriptionPlan } from './entitlement';

const now = new Date('2026-10-01T12:00:00Z');
const sub = (status: string, plan: any = 'STANDARD', currentPeriodEnd: Date | null = null) => ({ plan, status, currentPeriodEnd });

describe('entitlement', () => {
  it('grants the paid plan only while the provider says active', () => {
    expect(subscriptionPlan(sub('active'), now)).toBe('STANDARD');
    for (const status of ['pending', 'on_hold', 'past_due', 'paused', 'failed', 'expired', 'cancelled', 'canceled']) {
      expect(subscriptionPlan(sub(status), now)).toBe('FREE');
    }
  });

  it('keeps access through a short grace after the period end, then drops it', () => {
    const end = new Date(now.getTime() - RENEWAL_GRACE_MS + 60_000);
    expect(subscriptionPlan(sub('active', 'BASIC', end), now)).toBe('BASIC');
    const lapsed = new Date(now.getTime() - RENEWAL_GRACE_MS - 60_000);
    expect(subscriptionPlan(sub('active', 'BASIC', lapsed), now)).toBe('FREE');
  });

  it('treats a missing subscription as FREE', () => {
    expect(subscriptionPlan(null, now)).toBe('FREE');
    expect(effectivePlan(undefined, now)).toBe('FREE');
  });

  it('lets an active operator override win over a lapsed subscription, and ignores expired or revoked ones', () => {
    const later = new Date(now.getTime() + 86_400_000);
    expect(effectivePlan({ subscription: sub('on_hold'), planOverrides: [{ plan: 'Limitsiz', expiresAt: later, revokedAt: null }] }, now)).toBe('Limitsiz');
    expect(effectivePlan({ subscription: sub('active', 'BASIC'), planOverrides: [{ plan: 'Limitsiz', expiresAt: now, revokedAt: null }] }, now)).toBe('BASIC');
    expect(effectivePlan({ subscription: sub('active', 'BASIC'), planOverrides: [{ plan: 'Limitsiz', expiresAt: later, revokedAt: now }] }, now)).toBe('BASIC');
  });

  it('adds sponsored access without summing quotas and never downgrades a personal paid plan', () => {
    const later = new Date(now.getTime() + 86_400_000);
    const sponsoredPlus = { plan: 'PLUS' as const, expiresAt: later, revokedAt: null, academySeatGrantId: 'seat_1' };
    const sponsoredPremium = { ...sponsoredPlus, plan: 'PREMIUM' as const, academySeatGrantId: 'seat_2' };
    expect(effectivePlan({ subscription: sub('on_hold'), planOverrides: [sponsoredPlus] }, now)).toBe('PLUS');
    expect(effectivePlan({ subscription: sub('active', 'PREMIUM'), planOverrides: [sponsoredPlus] }, now)).toBe('PREMIUM');
    expect(effectivePlan({ subscription: sub('active', 'PLUS'), planOverrides: [sponsoredPremium] }, now)).toBe('PREMIUM');
    expect(effectivePlan({ subscription: sub('active', 'PREMIUM'), planOverrides: [
      sponsoredPremium,
      { plan: 'Limitsiz' as const, expiresAt: later, revokedAt: null },
    ] }, now)).toBe('Limitsiz');
  });

  it('ignores expired or revoked academy sponsorships', () => {
    expect(effectivePlan({ subscription: sub('on_hold'), planOverrides: [
      { plan: 'PREMIUM', expiresAt: now, revokedAt: null, academySeatGrantId: 'expired' },
      { plan: 'PLUS', expiresAt: new Date(now.getTime() + 60_000), revokedAt: now, academySeatGrantId: 'revoked' },
    ] }, now)).toBe('FREE');
  });
});
