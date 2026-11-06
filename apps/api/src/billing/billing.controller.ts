import { Controller, Get, Post, Body, Req, Headers, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BillingService } from './billing.service';
import { ProductService } from './product.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

// Both endpoints below call Dodo Payments' real API in production (not mock
// mode) — tighter than the app-wide default so they can't be hammered into
// spamming Dodo checkout/portal sessions.
const BILLING_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller()
export class BillingController {
  constructor(private billingService: BillingService, private productService: ProductService) {}

  @Get('billing/plans')
  getPlans() {
    return this.billingService.getPlans();
  }

  /** Effective product catalogue (spec + operator configuration). Public: prices are null and `purchasable` false until configured. */
  @Get('billing/catalogue')
  getCatalogue() {
    const plans = this.billingService.getPlans();
    const planOf: Record<string, string> = { PREMIUM: 'premium', PLUS: 'plus' };
    return this.productService.catalogue((priceKey) => !!planOf[priceKey] && !!plans.find((p) => p.id === planOf[priceKey] && (p as { purchasable?: boolean }).purchasable) && this.billingService.paymentsEnabled());
  }

  /** What this account may do now, with metered usage. The server is the authority; clients only display it. */
  @Get('billing/entitlements')
  @UseGuards(SessionAuthGuard)
  getEntitlements(@GetUser('id') userId: string) {
    return this.productService.entitlementsFor(userId);
  }

  @Get('billing/status')
  getStatus() {
    return this.billingService.getStatus();
  }

  @Get('billing/subscription')
  @UseGuards(SessionAuthGuard)
  async getSubscription(@GetUser('id') userId: string) {
    return this.billingService.getSubscription(userId);
  }

  @Post('billing/checkout-session')
  @UseGuards(SessionAuthGuard)
  @Throttle(BILLING_THROTTLE)
  async createCheckoutSession(
    @GetUser('id') userId: string,
    @Body() body: CreateCheckoutSessionDto,
  ) {
    return this.billingService.createCheckoutSession(userId, body.planId);
  }

  @Post('billing/portal-session')
  @UseGuards(SessionAuthGuard)
  @Throttle(BILLING_THROTTLE)
  async createPortalSession(@GetUser('id') userId: string) {
    return this.billingService.createPortalSession(userId);
  }

  @Post('webhooks/dodo')
  async handleWebhook(
    @Req() req: any,
    @Headers('webhook-id') webhookId: string,
    @Headers('webhook-signature') webhookSignature: string,
    @Headers('webhook-timestamp') webhookTimestamp: string,
  ) {
    // req.body is a raw Buffer here — see the express.raw() middleware scoped to
    // this route in main.ts, required for Dodo's Standard-Webhooks signature
    // verification to work against the exact bytes Dodo signed (re-serialized
    // JSON won't byte-match).
    return this.billingService.handleWebhook(req.body, { webhookId, webhookSignature, webhookTimestamp });
  }
}
