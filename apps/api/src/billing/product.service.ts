import { Injectable } from '@nestjs/common';
import { PRODUCT_SPEC, PRODUCT_SPEC_VERSION, type FeatureGrant, type OfferSpec } from '@aise/shared-types';
import type { SubscriptionPlan } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { activePlanOverrides, effectivePlan } from './entitlement';
import { effectiveGrant, loadProductConfig, type ProductConfig } from './product-config';
import { UsageService } from './usage.service';
import { allowanceUsage, periodFor } from '../documents/allowance-ledger';
import { EMAIL_FEATURE, HOLDING_STATES } from '../email-applications/email-allowance.constants';
import { EMPLOYER_PLANS, loadEmployerPlansConfig } from '../employer-plans/employer-plans.config';

export const PLAN_TO_OFFER: Record<SubscriptionPlan, string> = {
  FREE: 'free',
  PREMIUM: 'premium',
  PLUS: 'plus',
  BASIC: 'legacy_basic',
  STANDARD: 'legacy_standard',
  Limitsiz: 'legacy_limitsiz',
};

export interface EffectiveFeature extends FeatureGrant {
  used?: number;
  remaining?: number | null;
  /** documents.generations only: running generations that already hold a unit, and when the allowance resets. */
  reserved?: number;
  periodKey?: string;
  resetsAt?: string;
}

/**
 * Reads the product spec (packages/shared-types) with the operator's configuration applied. It is the only place that turns a plan into
 * feature grants; it does not bill, notify or store anything of its own (billing.service.ts owns checkout and the webhook, usage.service.ts
 * the counters).
 */
@Injectable()
export class ProductService {
  private readonly config: ProductConfig;

  constructor(private prisma: PrismaService, private usage: UsageService) {
    this.config = loadProductConfig();
  }

  offerForPlan(plan: SubscriptionPlan): OfferSpec {
    return PRODUCT_SPEC.candidate.offers[PLAN_TO_OFFER[plan]];
  }

  /** The grant (with configured limit) a plan has for one feature; undefined when the offer does not define it. */
  grantFor(plan: SubscriptionPlan, feature: string): FeatureGrant | undefined {
    return effectiveGrant(this.offerForPlan(plan), feature, this.config);
  }

  /** The grant this account has right now for one feature (plan resolved server-side). */
  async grantForUser(userId: string, feature: string, now = new Date()): Promise<FeatureGrant | undefined> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { subscription: true, planOverrides: activePlanOverrides(now) } });
    return this.grantFor(effectivePlan(user, now), feature);
  }

  /** Operator override first, then the approved list price of the offer that owns the key; null when neither exists. */
  priceOf(priceKey: string): number | null {
    if (priceKey in this.config.prices) return this.config.prices[priceKey];
    for (const o of [...Object.values(PRODUCT_SPEC.candidate.offers), ...Object.values(PRODUCT_SPEC.employer.offers)]) if (o.priceKey === priceKey && o.defaultPrice != null) return o.defaultPrice;
    return null;
  }

  /** Public catalogue: effective numbers for every offer. Prices are null when unset, and then `purchasable` is false. */
  catalogue(purchasable: (priceKey: string) => boolean = () => false) {
    const render = (o: OfferSpec) => ({
      id: o.id,
      label: o.label,
      plan: o.plan ?? null,
      legacy: !!o.legacy,
      price: o.priceKey ? this.priceOf(o.priceKey) : null,
      currency: 'AZN',
      purchasable: o.priceKey ? purchasable(o.priceKey) : false,
      features: Object.fromEntries(Object.keys(o.features).map((f) => [f, effectiveGrant(o, f, this.config)])),
    });
    return {
      specVersion: PRODUCT_SPEC_VERSION,
      status: PRODUCT_SPEC.status,
      positioning: PRODUCT_SPEC.positioning,
      candidate: { offers: Object.values(PRODUCT_SPEC.candidate.offers).map(render), never: PRODUCT_SPEC.candidate.never },
      employer: {
        // Whether plans are switched on in this deployment, and the fixed durations the copy may state. Prices come from `offers`.
        plans: { enabled: loadEmployerPlansConfig().gated, trialDays: EMPLOYER_PLANS.trial.days, singleDays: EMPLOYER_PLANS.single.days, businessReconfirmDays: EMPLOYER_PLANS.business.reconfirmDays },
        // Employer plans are sold through /business/plans (company-owned). They are purchasable only when employer billing is enabled AND the
        // provider product exists in this deployment; the free trial is never a purchase.
        offers: Object.values(PRODUCT_SPEC.employer.offers).map((o) => {
          const employer = loadEmployerPlansConfig();
          const productId = o.id === 'single_job' ? employer.singleProductId : o.id === 'business' ? employer.businessProductId : undefined;
          const purchasable = employer.gated && employer.checkoutEnabled && process.env.PAYMENTS_ENABLED === 'true' && !!productId;
          return { ...render(o), purchasable, ...(purchasable ? {} : { unavailableReason: o.id === 'starter_trial' ? 'free: started by publishing the first vacancy' : o.id === 'enterprise' ? 'by agreement' : 'employer billing is not enabled' }) };
        }),
        addons: [{ ...PRODUCT_SPEC.employer.addons.promoted_listing, price: this.priceOf(PRODUCT_SPEC.employer.addons.promoted_listing.priceKey), purchasable: false }],
        invariants: PRODUCT_SPEC.employer.invariants,
      },
    };
  }

  /** What this account is entitled to now, with metered usage. Server-side authority: the UI only displays it. */
  async entitlementsFor(userId: string, now = new Date()) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { subscription: true, planOverrides: activePlanOverrides(now) } });
    const plan = effectivePlan(user, now);
    const offer = this.offerForPlan(plan);
    const features: Record<string, EffectiveFeature> = {};
    for (const key of Object.keys(offer.features)) {
      const grant = effectiveGrant(offer, key, this.config)!;
      const out: EffectiveFeature = { ...grant };
      if (key === 'documents.generations' && grant.enabled) {
        // The document allowance is a ledger (reserve/commit/refund), not a counter: used = generated documents, reserved = running ones.
        const usage = await allowanceUsage(this.prisma, userId, now);
        out.used = usage.committed;
        out.reserved = usage.reserved;
        out.remaining = grant.limit == null ? null : Math.max(0, grant.limit - usage.committed - usage.reserved);
        out.periodKey = usage.period.key;
        out.resetsAt = usage.period.resetsAt.toISOString();
      } else if (key === EMAIL_FEATURE && grant.enabled) {
        // Derived from the application rows: a unit is held from approval until the send definitively fails.
        const period = periodFor(now);
        out.used = await this.prisma.emailApplication.count({ where: { userId, deliveryState: { in: [...HOLDING_STATES] }, approvedAt: { gte: period.startsAt, lt: period.resetsAt } } });
        out.remaining = grant.limit == null ? null : Math.max(0, grant.limit - out.used);
        out.periodKey = period.key;
        out.resetsAt = period.resetsAt.toISOString();
      } else if (key === 'browser.applications' && grant.enabled) {
        // Derived from the application rows: one unit per application whose submission was permitted in the period (retries of one application are one unit).
        const period = periodFor(now);
        out.used = await this.prisma.agentApplication.count({ where: { userId, permitIssuedAt: { gte: period.startsAt, lt: period.resetsAt } } });
        out.remaining = grant.limit == null ? null : Math.max(0, grant.limit - out.used);
        out.periodKey = period.key;
        out.resetsAt = period.resetsAt.toISOString();
      } else if (grant.enabled && grant.costly && (grant.period === 'month' || grant.period === 'day')) {
        out.used = await this.usage.usedIn(userId, key, grant.period, now);
        out.remaining = grant.limit == null ? null : Math.max(0, grant.limit - out.used);
      }
      features[key] = out;
    }
    return { specVersion: PRODUCT_SPEC_VERSION, plan, offer: offer.id, legacy: !!offer.legacy, features };
  }
}
