import type { PlanOverride, Subscription, SubscriptionPlan } from '@prisma/client';

/**
 * The one place that decides which plan a user is entitled to right now.
 * An operator's active, unexpired, unrevoked plan override wins; otherwise the
 * payment provider's subscription applies. Feature gates must call this, never
 * read Subscription.plan directly.
 */
export function activePlanOverrides(now = new Date()) {
  // Put unlinked operator overrides first so they retain precedence even when a
  // user has many concurrent sponsored seats; newest operator override wins.
  return {
    where: { revokedAt: null, expiresAt: { gt: now } },
    orderBy: [
      { academySeatGrantId: { sort: 'asc' as const, nulls: 'first' as const } },
      { createdAt: 'desc' as const },
    ],
    take: 20,
  };
}

const PLAN_RANK: Record<SubscriptionPlan, number> = {
  FREE: 0, BASIC: 1, PLUS: 2, STANDARD: 3, PREMIUM: 4, Limitsiz: 5,
};

export function effectivePlan(
  user: { subscription?: Pick<Subscription, 'plan' | 'status' | 'currentPeriodEnd'> | null; planOverrides?: (Pick<PlanOverride, 'plan' | 'expiresAt' | 'revokedAt'> & { academySeatGrantId?: string | null })[] } | null | undefined,
  now = new Date(),
): SubscriptionPlan {
  const active = user?.planOverrides?.filter((o) => !o.revokedAt && o.expiresAt > now) ?? [];
  const operatorOverride = active.find((override) => !override.academySeatGrantId);
  if (operatorOverride) return operatorOverride.plan;

  const personalPlan = subscriptionPlan(user?.subscription, now);
  const sponsoredPlan = active
    .filter((override) => override.academySeatGrantId)
    .reduce<SubscriptionPlan>((best, override) => PLAN_RANK[override.plan] > PLAN_RANK[best] ? override.plan : best, 'FREE');
  // Sponsorship adds access up to the best eligible plan; quotas are never summed.
  return PLAN_RANK[sponsoredPlan] > PLAN_RANK[personalPlan] ? sponsoredPlan : personalPlan;
}

// Provider statuses (Dodo's own spelling) that still pay for the plan. Anything
// else — pending, on_hold, past_due, paused, failed, expired, cancelled and the
// legacy 'canceled' — means the payment is not current, so the plan is FREE.
export const ENTITLED_STATUSES = new Set(['active']);
// Statuses after which the provider will never bill again.
export const TERMINAL_STATUSES = new Set(['cancelled', 'canceled', 'expired', 'failed']);
// A renewal the provider has not reported yet does not cut access at once.
export const RENEWAL_GRACE_MS = 3 * 86_400_000;

/** Provider entitlement only (see billing.service.ts for how statuses are written). */
export function subscriptionPlan(subscription: Pick<Subscription, 'plan' | 'status' | 'currentPeriodEnd'> | null | undefined, now = new Date()): SubscriptionPlan {
  if (!subscription || subscription.plan === 'FREE') return 'FREE';
  if (!ENTITLED_STATUSES.has(subscription.status)) return 'FREE';
  if (subscription.currentPeriodEnd && subscription.currentPeriodEnd.getTime() + RENEWAL_GRACE_MS < now.getTime()) return 'FREE';
  return subscription.plan;
}
