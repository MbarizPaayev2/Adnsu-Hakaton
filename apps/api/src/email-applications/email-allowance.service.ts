import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PRODUCT_SPEC } from '@aise/shared-types';
import type { Prisma } from '@prisma/client';
import { EMAIL_FEATURE, HOLDING_STATES } from './email-allowance.constants';
import { PrismaService } from '../database/database.service';
import { activePlanOverrides, effectivePlan } from '../billing/entitlement';
import { effectiveGrant, loadProductConfig, type ProductConfig } from '../billing/product-config';
import { PLAN_TO_OFFER } from '../billing/product.service';
import { periodFor, type AllowancePeriod } from '../documents/allowance-ledger';

export { EMAIL_FEATURE, HOLDING_STATES };

export interface EmailAllowanceView {
  plan: string;
  /** null = no monthly cap (legacy plans); only the daily protection applies. */
  limit: number | null;
  used: number;
  remaining: number | null;
  period: string;
  resetsAt: string;
}

export class EmailAllowanceError extends HttpException {
  constructor(readonly details: { limit: number; used: number; plan: string; resetsAt: string }) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: 'EMAIL_ALLOWANCE_EXHAUSTED',
        message: `Bu ayın e-poçt müraciət limiti (${details.limit}) çatılıb. Limit ${details.resetsAt.slice(0, 10)} tarixində yenilənir və ya daha yüksək plana keçə bilərsiniz. (EMAIL_ALLOWANCE_EXHAUSTED)`,
        ...details,
        remaining: 0,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Monthly e-mail application allowance. Derived from the application rows themselves (no separate counter that could drift): a row holds a unit
 * while its state is in HOLDING_STATES and it was approved inside the current Baku calendar month. A retry, a replay of an approval and a resolved
 * UNCERTAIN outcome all touch the same row, so none of them can take a second unit; a definitive failure releases the unit at once.
 */
@Injectable()
export class EmailAllowanceService {
  private readonly config: ProductConfig = loadProductConfig();

  constructor(private prisma: PrismaService) {}

  private async plan(db: Prisma.TransactionClient | PrismaService, userId: string, now: Date) {
    const user = await db.user.findUnique({ where: { id: userId }, include: { subscription: true, planOverrides: activePlanOverrides(now) } });
    return effectivePlan(user, now);
  }

  private limitFor(plan: string): number | null {
    const offer = PRODUCT_SPEC.candidate.offers[PLAN_TO_OFFER[plan as keyof typeof PLAN_TO_OFFER]];
    const grant = offer ? effectiveGrant(offer, EMAIL_FEATURE, this.config) : undefined;
    if (!grant || !grant.enabled) return 0;
    return grant.limit ?? null;
  }

  private async usedIn(db: Prisma.TransactionClient | PrismaService, userId: string, period: AllowancePeriod) {
    return db.emailApplication.count({
      where: { userId, deliveryState: { in: [...HOLDING_STATES] }, approvedAt: { gte: period.startsAt, lt: period.resetsAt } },
    });
  }

  async view(userId: string, now = new Date(), db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<EmailAllowanceView> {
    const period = periodFor(now);
    const plan = await this.plan(db, userId, now);
    const limit = this.limitFor(plan);
    const used = await this.usedIn(db, userId, period);
    return { plan, limit, used, remaining: limit == null ? null : Math.max(0, limit - used), period: period.key, resetsAt: period.resetsAt.toISOString() };
  }

  /** Throws EmailAllowanceError when the account has no unit left. Run it under the account's advisory lock when it must be exact (approval). */
  async assertAvailable(userId: string, now = new Date(), db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<EmailAllowanceView> {
    const view = await this.view(userId, now, db);
    if (view.limit != null && view.used >= view.limit) throw new EmailAllowanceError({ limit: view.limit, used: view.used, plan: view.plan, resetsAt: view.resetsAt });
    return view;
  }
}
