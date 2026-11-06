import { Injectable, BadRequestException, ConflictException, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { EmployerPlansService } from '../employer-plans/employer-plans.service';
import { PrismaService } from '../database/database.service';
import DodoPayments from 'dodopayments';
import { Webhook, WebhookVerificationError } from 'standardwebhooks';
import { PLAN_MATCH_QUOTAS, PLAN_DAILY_MATCH_QUOTAS, PLAN_WEEKLY_MATCH_QUOTAS, matchDayStart, matchWeekStart, PLAN_PRICES_AZN } from '@aise/shared-types';
import type { SubscriptionPlan } from '@aise/shared-types';
import { PostHogService } from '../common/posthog.service';
import { TERMINAL_STATUSES, effectivePlan, activePlanOverrides } from './entitlement';
import { generationDisabled } from '../documents/document-allowance.service';
import { loadEmailApplyConfig } from '../email-applications/email-apply.config';
import { loadProductConfig } from './product-config';
import { CHECKOUT_PRESENTATION } from './checkout-presentation';

export type PayablePlanId = 'basic' | 'standard' | 'unlimited' | 'premium' | 'plus';
export type PlanId = 'free' | PayablePlanId;

// Prisma's SubscriptionPlan enum spells the top tier "Limitsiz" (Azerbaijani
// for "unlimited") while every other internal plan id is a plain lowercase
// English word — this is the one place that mismatch has to be bridged.
// (Keeping plan ids uniformly lowercase here, unlike the enum, also fixes a
// real bug the old Paddle code had: it stored this plan's id as 'Limitsiz'
// — mixed case — while createCheckoutSession compared against
// `planId.toLowerCase()`, so the top-tier plan's checkout could never match.)
const PLAN_ID_TO_DB: Record<PlanId, SubscriptionPlan> = {
  free: 'FREE',
  basic: 'BASIC',
  standard: 'STANDARD',
  unlimited: 'Limitsiz',
  premium: 'PREMIUM',
  plus: 'PLUS',
};

// Subscription status strings Dodo's webhook events use verbatim on `data.status`.
type DodoSubscriptionStatus =
  | 'pending' | 'active' | 'on_hold' | 'paused' | 'cancelled' | 'failed' | 'expired' | 'past_due';

// How long an unpaid checkout session may be handed out again to the same account and plan (see createCheckoutSession).
const CHECKOUT_REUSE_MS = 90_000;

@Injectable()
export class BillingService {
  private recentCheckouts = new Map<string, { url: string; at: number }>();
  private dodo: DodoPayments;
  private isMock = true;
  // Prices and costly quotas come from PRODUCT_CONFIG_JSON (product-config.ts); an unset price keeps that offer unpurchasable.
  private productConfig = loadProductConfig();

  constructor(
    private prisma: PrismaService,
    private postHogService: PostHogService,
    // Employer products (docs/employer-plans-2026-10-11.md) share this webhook endpoint but never the candidate subscription state.
    @Optional() private employerPlans?: EmployerPlansService,
  ) {
    const apiKey = process.env.DODO_PAYMENTS_API_KEY || 'mock_dodo_api_key_aise';
    this.isMock = apiKey.includes('mock');
    this.dodo = new DodoPayments({
      bearerToken: apiKey,
      environment: process.env.DODO_ENV === 'live_mode' ? 'live_mode' : 'test_mode',
    });

    this.assertRealCheckoutIsConfigured();
  }

  /**
   * Fails startup when a real API key is present but the rest of the Dodo
   * configuration is missing.
   *
   * This exists because the product-id lookups below fall back to
   * 'mock_basic'/'mock_standard'/'mock_unlimited'. Those defaults are
   * deliberate for local dev, where `isMock` short-circuits before any
   * network call — but with a real key they are sent to Dodo verbatim, which
   * answers `422 INVALID_REQUEST_PARAMETERS: Product mock_basic does not
   * exist`. That surfaced only as a failed purchase at the end of the
   * checkout flow, with the cause invisible from the error the user saw.
   *
   * The same trap applies to DODO_ENV: the SDK is constructed in 'test_mode'
   * unless it is exactly 'live_mode', so a live key with DODO_ENV unset
   * authenticates against the test endpoint and every call 401s.
   *
   * Refusing to boot is the right response. A server that starts and then
   * fails every payment is worse than one that says why it cannot start.
   */
  private assertRealCheckoutIsConfigured() {
    if (this.isMock) return;

    const missing: string[] = [];

    if (process.env.DODO_ENV !== 'live_mode' && process.env.DODO_ENV !== 'test_mode') {
      missing.push("DODO_ENV (must be 'live_mode' or 'test_mode')");
    }

    for (const key of [
      'DODO_PRODUCT_ID_BASIC',
      'DODO_PRODUCT_ID_STANDARD',
      'DODO_PRODUCT_ID_UNLIMITED',
    ]) {
      const value = process.env[key];
      if (!value || value.startsWith('mock_')) missing.push(key);
    }

    // Only an operator-configured price makes a provider product mandatory at startup; the approved list prices alone do not (a plan with no
    // provider product is simply listed as not purchasable), so a deployment that has not created the new products still boots.
    for (const [priceKey, envKey] of [['PREMIUM', 'DODO_PRODUCT_ID_PREMIUM'], ['PLUS', 'DODO_PRODUCT_ID_PLUS']] as const) {
      if (this.productConfig.prices[priceKey] != null) {
        const value = process.env[envKey];
        if (!value || value.startsWith('mock_')) missing.push(`${envKey} (a ${priceKey} price is configured)`);
      }
    }

    if (missing.length) {
      throw new Error(
        'DODO_PAYMENTS_API_KEY is set to a real key, but the checkout ' +
          `configuration is incomplete: ${missing.join(', ')}. ` +
          'Product ids come from the Dodo dashboard and look like ' +
          '"pdt_...". Refusing to start rather than failing every purchase ' +
          'at the end of checkout.',
      );
    }
  }

  getPlans() {
    return [
      {
        id: 'free' as const,
        name: 'Free',
        price: PLAN_PRICES_AZN.FREE,
        currency: 'AZN',
        matchesPerMonth: PLAN_MATCH_QUOTAS.FREE,
        matchesPerWeek: 3,
        features: [
          'Ayda 3 iş uyğunluğu',
          'Hər uyğunluq üçün CV fərdiləşdirilməsi daxildir',
        ],
      },
      {
        id: 'basic' as const,
        purchasable: false, // retired: kept only so existing subscribers' events still resolve; never offered for a new checkout
        name: 'Basic',
        price: PLAN_PRICES_AZN.BASIC,
        currency: 'AZN',
        matchesPerMonth: PLAN_MATCH_QUOTAS.BASIC,
        dodoProductId: process.env.DODO_PRODUCT_ID_BASIC || 'mock_basic',
        features: [
          'Ayda 10 iş uyğunluğu',
          'Hər uyğunluq üçün CV fərdiləşdirilməsi daxildir',
          'Gündəlik e-poçt xülasələri',
        ],
      },
      {
        id: 'standard' as const,
        purchasable: false, // retired: kept only so existing subscribers' events still resolve; never offered for a new checkout
        name: 'Standard',
        price: PLAN_PRICES_AZN.STANDARD,
        currency: 'AZN',
        matchesPerMonth: PLAN_MATCH_QUOTAS.STANDARD,
        dodoProductId: process.env.DODO_PRODUCT_ID_STANDARD || 'mock_standard',
        features: [
          'Ayda 30 iş uyğunluğu',
          'Hər uyğunluq üçün CV fərdiləşdirilməsi daxildir',
          'Gündəlik e-poçt xülasələri',
        ],
      },
      {
        id: 'unlimited' as const,
        purchasable: false, // retired: kept only so existing subscribers' events still resolve; never offered for a new checkout
        name: 'Limitsiz',
        price: PLAN_PRICES_AZN.Limitsiz,
        currency: 'AZN',
        matchesPerMonth: null,
        dodoProductId: process.env.DODO_PRODUCT_ID_UNLIMITED || 'mock_unlimited',
        features: [
          'Sonsuz iş uyğunluğu',
          'Hər uyğunluq üçün CV fərdiləşdirilməsi daxildir',
          'Gündəlik e-poçt xülasələri',
          'Fərqli rollar üçün çoxlu əsas CV-lər',
        ],
      },
      this.plusPlan(),
      this.premiumPlan(),
    ];
  }

  /**
   * The two approved candidate offers (product-spec.ts "plus" 8 AZN, "premium" 50 AZN). A plan is listed with its approved price but is only
   * purchasable when a provider product is configured for it (DODO_PRODUCT_ID_PLUS / _PREMIUM, or the mock id in local development); an operator
   * price override in PRODUCT_CONFIG_JSON wins over the approved price. Payments stay off until PAYMENTS_ENABLED (see paymentsEnabled()).
   */
  private newOffer(id: 'plus' | 'premium', name: string, envKey: string, priceKey: 'PLUS' | 'PREMIUM', features: string[]) {
    const price = this.productConfig.prices[priceKey] ?? PLAN_PRICES_AZN[priceKey];
    const productId = process.env[envKey] || (this.isMock ? `mock_${id}` : undefined);
    const purchasable = price != null && !!productId;
    return {
      id,
      name,
      price,
      currency: 'AZN',
      purchasable,
      matchesPerMonth: PLAN_MATCH_QUOTAS[priceKey],
      matchesPerDay: PLAN_DAILY_MATCH_QUOTAS[priceKey],
      matchResetTimezone: 'Asia/Baku',
      ...(purchasable ? { dodoProductId: productId as string } : {}),
      features,
    };
  }

  private premiumPlan() {
    return this.newOffer('premium', 'Premium', 'DODO_PRODUCT_ID_PREMIUM', 'PREMIUM', [
      'Gündə 5 yeni fərdi iş tövsiyəsinə qədər',
      'Aylıq limitsiz sənəd yaratma (CV, resume və motivasiya məktubu; şəffaf təhlükəsizlik qorumaları ilə)',
      'Brauzer köməkçisi: ayda 50 müraciətə qədər, hər birini siz təsdiqləyirsiniz',
      'Əlavə CV versiyaları',
      'Genişləndirilmiş üstünlüklər və məhdud ani bildirişlər',
    ]);
  }

  private plusPlan() {
    return this.newOffer('plus', 'Plus', 'DODO_PRODUCT_ID_PLUS', 'PLUS', [
      'Gündə 1 yeni fərdi iş tövsiyəsinə qədər',
      'Ayda 30 sənəd yaratma (CV, resume və motivasiya məktubu birlikdə hesablanır)',
      'Əlavə CV versiyaları',
      'Genişləndirilmiş üstünlüklər və məhdud ani bildirişlər',
    ]);
  }

  /**
   * Purchasing is opt-in. A real provider key alone never opens checkout:
   * production already holds a Dodo key while the paid lifecycle is still
   * unverified, so only an explicit PAYMENTS_ENABLED=true switches it on.
   * The mock key exists for local development; in production it would let
   * people "buy" a plan that nothing ever grants, so it never enables
   * purchasing there, even when asked to.
   */
  paymentsEnabled(): boolean {
    const flag = process.env.PAYMENTS_ENABLED;
    if (flag === 'false') return false;
    if (this.isMock) return process.env.NODE_ENV !== 'production';
    return flag === 'true';
  }

  getStatus() {
    return {
      paymentsEnabled: this.paymentsEnabled(),
      mode: this.isMock ? 'mock' : process.env.DODO_ENV === 'live_mode' ? 'live' : 'test',
      // Public, so the site never promises what this deployment has switched off.
      documentGenerationEnabled: !generationDisabled(),
      emailApplicationsEnabled: loadEmailApplyConfig().enabled,
      // Whether the public pages may present rule-based sending (no per-application approval) as offered. Running the feature is not
      // enough: it also needs EMAIL_APPLY_AUTOMATION_PUBLISHED=true, set only once it has been verified in this deployment.
      emailAutomationEnabled: loadEmailApplyConfig().enabled && loadEmailApplyConfig().automationEnabled && process.env.EMAIL_APPLY_AUTOMATION_PUBLISHED === 'true',
    };
  }

  async getSubscription(userId: string) {
    const now = new Date();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true, planOverrides: activePlanOverrides(now) },
    });
    const sub = user?.subscription;
    const override = user?.planOverrides?.find((item) => !item.academySeatGrantId);
    const plan = effectivePlan(user, now);
    const sponsoredGrants = await this.prisma.academySeatGrant.findMany({
      where: { userId, status: 'ACTIVE', revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
      include: { academy: { select: { name: true } } },
    });
    const planRank: Record<string, number> = { FREE: 0, BASIC: 1, PLUS: 2, STANDARD: 3, PREMIUM: 4, Limitsiz: 5 };
    const sponsoredGrant = sponsoredGrants.sort((a, b) => (planRank[b.plan] - planRank[a.plan]) || (a.endsAt.getTime() - b.endsAt.getTime()))[0];
    const dailyLimit = PLAN_DAILY_MATCH_QUOTAS[plan];
    const weeklyLimit = PLAN_WEEKLY_MATCH_QUOTAS[plan];
    const dayStart = matchDayStart();
    const matchesUsedToday = dailyLimit === undefined ? 0 : await this.prisma.match.count({
      where: { userId, createdAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } },
    });
    return {
      // What the account is entitled to now — the value every gate uses.
      plan: effectivePlan(user),
      // What the provider contract says, shown for transparency.
      subscriptionPlan: sub?.plan ?? 'FREE',
      status: sub?.status ?? 'active',
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      matchesUsedThisPeriod: sub?.matchesUsedThisPeriod ?? 0,
      matchesPerDay: dailyLimit ?? null,
      matchesUsedToday,
      matchesPerWeek: weeklyLimit ?? null,
      matchesUsedThisWeek: weeklyLimit === undefined ? 0 : await this.prisma.match.count({ where: { userId, createdAt: { gte: matchWeekStart(), lt: new Date(matchWeekStart().getTime() + 7 * 86_400_000) } } }),
      matchQuotaResetsAt: dailyLimit === undefined ? null : new Date(dayStart.getTime() + 86_400_000),
      providerManaged: !!sub?.dodoSubscriptionId,
      override: override ? { plan: override.plan, expiresAt: override.expiresAt } : null,
      sponsoredAccess: sponsoredGrant ? {
        academyName: sponsoredGrant.academy.name,
        plan: sponsoredGrant.plan,
        expiresAt: sponsoredGrant.endsAt,
        matchesPerDay: dailyLimit ?? null,
        matchesRemainingToday: dailyLimit === undefined ? null : Math.max(0, dailyLimit - matchesUsedToday),
      } : null,
    };
  }

  // Dodo's hosted checkout has no client-side overlay to wire up — creating
  // the session server-side and handing back its checkout_url is the whole
  // integration; the frontend just does a full-page redirect to it (see
  // apps/web's /checkout page).
  async createCheckoutSession(userId: string, planId: string) {
    const plans = this.getPlans();
    const plan = plans.find((p) => p.id === planId.toLowerCase());

    // Only the two approved offers can be bought; the retired Basic/Standard/Limitsiz products must never open a new checkout, whatever the client sends.
    if (plan && plan.id !== 'free' && plan.id !== 'plus' && plan.id !== 'premium') {
      throw new BadRequestException('Ödəniş üçün seçilən plan yanlışdır');
    }
    if ((plan?.id === 'premium' || plan?.id === 'plus') && !(plan as { purchasable?: boolean }).purchasable) {
      throw new ServiceUnavailableException('Bu plan hələ satışda deyil');
    }
    if (!plan || plan.id === 'free' || !('dodoProductId' in plan) || !plan.dodoProductId) {
      throw new BadRequestException('Ödəniş üçün seçilən plan yanlışdır');
    }
    if (!this.paymentsEnabled()) {
      throw new ServiceUnavailableException('Ödənişlər hazırda aktiv deyil');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user) {
      throw new NotFoundException('İstifadəçi tapılmadı');
    }

    // Buying what the account already has would open a second subscription at the provider. The plan page is the place to change plans.
    if (user.subscription && user.subscription.plan === PLAN_ID_TO_DB[plan.id] && user.subscription.status === 'active' && !!user.subscription.dodoSubscriptionId) {
      throw new ConflictException('Bu plan artıq aktivdir');
    }

    // A double click, a React remount or a quick reload must not open several provider sessions for the same intent: a session created for this
    // account and plan a moment ago is returned again. It is the same unpaid session, so reuse can never turn into a second charge.
    const reuseKey = `${userId}:${plan.id}`;
    const recent = this.recentCheckouts.get(reuseKey);
    if (recent && Date.now() - recent.at < CHECKOUT_REUSE_MS) return { url: recent.url };

    this.postHogService.capture(userId, 'checkout_initiated', { plan: plan.id, mock: this.isMock });

    if (this.isMock) {
      // Local development only (see paymentsEnabled). Nothing is granted: the
      // return page asks the API for the plan, exactly as after a real payment.
      console.log(`[DODO MOCK] Creating checkout for user: ${userId}, plan: ${planId}`);
      const successUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?checkout=success&mock=1`;
      return { url: successUrl };
    }

    try {
      const session = await this.dodo.checkoutSessions.create({
        product_cart: [{ product_id: plan.dodoProductId, quantity: 1 }],
        customer: user.subscription?.dodoCustomerId
          ? { customer_id: user.subscription.dodoCustomerId }
          : { email: user.email, name: user.name || undefined },
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?checkout=success`,
        // Metadata rides along for observability only — the plan actually
        // granted is resolved from the webhook's own product_id (see
        // resolvePlanFromProductId), never trusted from here. Nothing stops
        // a client from tampering with a client-visible value before it's
        // even sent, so this must never be the source of truth for billing.
        metadata: { userId, plan: PLAN_ID_TO_DB[plan.id] },
        ...CHECKOUT_PRESENTATION,
      });

      if (!session.checkout_url) {
        throw new BadRequestException('Dodo Payments checkout sessiyası yaradıla bilmədi');
      }
      this.recentCheckouts.set(reuseKey, { url: session.checkout_url, at: Date.now() });
      return { url: session.checkout_url };
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Dodo Payments checkout sessiyası yaradıla bilmədi');
    }
  }

  async createPortalSession(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user || !user.subscription) {
      throw new BadRequestException('Aktiv abunəlik tapılmadı');
    }

    if (this.isMock) {
      // Mock mode never talks to Dodo, so a real dodoCustomerId isn't required
      // (e.g. seeded/dev users on a paid plan that never went through real checkout).
      console.log(`[DODO MOCK] Creating customer portal session for user: ${userId}`);
      const portalUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/settings?portal=mock_success`;
      return { url: portalUrl };
    }

    if (!user.subscription.dodoCustomerId) {
      throw new BadRequestException('Aktiv Dodo Payments abunəliyi tapılmadı');
    }

    try {
      const session = await this.dodo.customers.customerPortal.create(user.subscription.dodoCustomerId, {
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/settings`,
      });
      return { url: session.link };
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Dodo Payments portalı yaradıla bilmədi');
    }
  }

  /**
   * Stops billing before an account is deleted. Checks the live status first,
   * because a cancellation webhook or a manual provider-side cancellation may
   * have raced the request. A subscription the provider no longer knows is
   * equally "nothing left to stop"; any other failure throws so the account
   * is not deleted while a card may still be charged.
   */
  async cancelForDeletion(subscription: { dodoSubscriptionId: string | null; status: string } | null | undefined) {
    if (this.isMock || !subscription?.dodoSubscriptionId || TERMINAL_STATUSES.has(subscription.status)) return;
    try {
      const remote = await this.dodo.subscriptions.retrieve(subscription.dodoSubscriptionId);
      if (!TERMINAL_STATUSES.has(remote.status)) {
        await this.dodo.subscriptions.update(subscription.dodoSubscriptionId, { status: 'cancelled' });
      }
    } catch (error: any) {
      if (error?.status === 404) return;
      throw new ServiceUnavailableException(
        'Aktiv abunəliyiniz ləğv edilə bilmədi. Hesabı silmədən əvvəl bir az sonra yenidən cəhd edin və ya bizimlə əlaqə saxlayın.',
      );
    }
  }

  // The only source of truth for "which plan was actually paid for" — maps
  // Dodo's product id (from the webhook's own payload, never from
  // client-suppliable metadata) back to one of our plan tiers.
  private resolvePlanFromProductId(productId: string | undefined): PayablePlanId | null {
    if (!productId) return null;
    const plan = this.getPlans().find((p) => 'dodoProductId' in p && p.dodoProductId === productId);
    return plan && plan.id !== 'free' ? (plan.id as PayablePlanId) : null;
  }

  async handleWebhook(
    rawBody: Buffer,
    headers: { webhookId: string; webhookSignature: string; webhookTimestamp: string },
  ) {
    if (this.isMock) {
      console.log(`[DODO WEBHOOK MOCK] Received mock webhook trigger`);
      return { received: true };
    }

    const webhookKey = process.env.DODO_WEBHOOK_KEY || '';
    if (!webhookKey) {
      // Fail closed rather than let verification run against an empty key —
      // a misconfigured prod deploy (real DODO_PAYMENTS_API_KEY, forgotten
      // DODO_WEBHOOK_KEY) would otherwise accept any request as a genuine
      // event, letting anyone POST a forged subscription.active and grant
      // themselves any plan for free.
      throw new BadRequestException('Webhook Error: DODO_WEBHOOK_KEY is not configured');
    }

    let payload: any;
    try {
      const webhook = new Webhook(webhookKey);
      payload = await webhook.verify(rawBody.toString('utf8'), {
        'webhook-id': headers.webhookId,
        'webhook-signature': headers.webhookSignature,
        'webhook-timestamp': headers.webhookTimestamp,
      });
    } catch (err: any) {
      const message = err instanceof WebhookVerificationError ? err.message : String(err?.message || err);
      throw new BadRequestException(`Webhook Error: ${message}`);
    }

    const type = String(payload?.type || 'unknown');
    const subscriptionId: string | undefined = payload?.data?.subscription_id || undefined;
    console.log(`[DODO WEBHOOK] Event type: ${type}`);

    // Durable de-duplication by delivery id. A delivery that was processed is
    // acknowledged unchanged; one that failed earlier is processed again.
    await this.prisma.billingWebhookEvent.upsert({
      where: { id: headers.webhookId },
      create: { id: headers.webhookId, type, subscriptionId },
      update: {},
    });
    const seen = await this.prisma.billingWebhookEvent.findUnique({ where: { id: headers.webhookId } });
    if (seen?.processedAt) return { received: true, duplicate: true };

    let outcome = 'ignored';
    const employerOutcome = this.employerPlans ? await this.employerPlans.handleProviderEvent(type, payload.data) : null;
    if (employerOutcome) {
      outcome = employerOutcome;
    } else if (type.startsWith('subscription.') && subscriptionId) {
      outcome = await this.syncSubscription(subscriptionId, payload.data?.metadata?.userId);
    }
    await this.prisma.billingWebhookEvent.updateMany({
      where: { id: headers.webhookId, processedAt: null },
      data: { processedAt: new Date(), outcome },
    });
    return { received: true };
  }

  /**
   * Applies the provider's CURRENT state of a subscription, whatever event
   * announced the change. Events can arrive late, twice or out of order; the
   * subscription the provider returns now cannot. If the provider cannot be
   * reached this throws, the delivery stays unprocessed and Dodo retries it.
   */
  async syncSubscription(subscriptionId: string, hintedUserId?: string): Promise<string> {
    let state: any;
    try {
      state = await this.dodo.subscriptions.retrieve(subscriptionId);
    } catch (err: any) {
      if (err?.status === 404) {
        console.error(`[DODO WEBHOOK] Subscription ${subscriptionId} is unknown to the provider — nothing applied.`);
        return 'unknown_subscription';
      }
      throw new ServiceUnavailableException('Ödəniş provayderi hazırda cavab vermir');
    }

    // Our own metadata, set server-side when the checkout was created.
    const userId = (state?.metadata?.userId as string | undefined) || hintedUserId;
    let existing =
      (await this.prisma.subscription.findFirst({ where: { dodoSubscriptionId: subscriptionId } })) ||
      (userId ? await this.prisma.subscription.findUnique({ where: { userId } }) : null);
    if (!existing && userId && (await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
      // The account exists but has no subscription row (every registration path creates one; this guards a row lost or never written). A verified
      // payment must not be acknowledged and then forgotten: create the FREE row, then apply the provider's state exactly as for any account.
      // Upsert on the unique user id, so a concurrent delivery cannot create a second row.
      existing = await this.prisma.subscription.upsert({ where: { userId }, create: { userId, plan: 'FREE', status: 'active' }, update: {} });
      console.warn(`[DODO WEBHOOK] Account ${userId} had no subscription row; created one before applying ${subscriptionId}.`);
    }
    if (!existing) {
      console.error(`[DODO WEBHOOK] Subscription ${subscriptionId} does not map to an AISE account — nothing applied.`);
      return 'unmapped';
    }

    const status = String(state.status || 'pending') as DodoSubscriptionStatus;
    // A user who bought again keeps the newer contract: an older subscription's
    // late events never overwrite it, unless the older one is the active one.
    if (existing.dodoSubscriptionId && existing.dodoSubscriptionId !== subscriptionId && status !== 'active') {
      return 'stale_subscription';
    }

    const planId = this.resolvePlanFromProductId(state.product_id);
    if (!planId && status === 'active') {
      // Paying for Basic while claiming metadata.plan = 'Limitsiz' must never
      // grant anything — the plan comes only from the product actually bought.
      console.error(
        `[DODO WEBHOOK] Subscription ${subscriptionId} references an unrecognized product ${state.product_id} — refusing to grant a plan from unverified data.`,
      );
      return 'unknown_product';
    }

    const terminal = TERMINAL_STATUSES.has(status);
    const plan: SubscriptionPlan = terminal || !planId ? 'FREE' : PLAN_ID_TO_DB[planId];
    await this.prisma.subscription.update({
      where: { id: existing.id },
      data: {
        dodoCustomerId: state.customer?.customer_id || existing.dodoCustomerId,
        dodoSubscriptionId: subscriptionId,
        plan,
        status,
        currentPeriodEnd: terminal ? null : state.next_billing_date ? new Date(state.next_billing_date) : existing.currentPeriodEnd,
        cancelAtPeriodEnd: !!state.cancel_at_next_billing_date,
        providerSyncedAt: new Date(),
      },
    });
    if (existing.plan !== plan || existing.status !== status) {
      this.postHogService.capture(existing.userId, 'subscription_synced', { plan, status });
    }
    return `synced:${status}`;
  }
}
