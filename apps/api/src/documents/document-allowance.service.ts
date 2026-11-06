import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/database.service';
import { ProductService } from '../billing/product.service';
import { activePlanOverrides, effectivePlan } from '../billing/entitlement';
import { allowanceUsage, RESERVATION_TTL_MS } from './allowance-ledger';

export const DOCUMENT_FEATURE = 'documents.generations';

export type AllowanceRefusal = 'ALLOWANCE_EXHAUSTED' | 'CONCURRENCY_LIMIT' | 'HOURLY_LIMIT' | 'GENERATION_UNAVAILABLE';

/** Document generation is switched off by the operator (`DOCUMENT_GENERATION_ENABLED=false`) until the real provider has been evaluated. Unset means on. */
export const generationDisabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.DOCUMENT_GENERATION_ENABLED?.trim().toLowerCase() === 'false';

/** Refusal with a stable code and the numbers the UI needs; never contains document content. */
export class AllowanceError extends HttpException {
  constructor(readonly code: AllowanceRefusal, readonly details: Record<string, unknown>, message: string) {
    const status = code === 'ALLOWANCE_EXHAUSTED' ? HttpStatus.PAYMENT_REQUIRED : code === 'GENERATION_UNAVAILABLE' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.TOO_MANY_REQUESTS;
    super({ statusCode: status, code, message, ...details }, status);
  }
}

export interface AllowanceView {
  plan: string;
  /** null = no monthly cap (Premium and legacy plans); only the protections below apply. */
  limit: number | null;
  used: number;
  reserved: number;
  /** null when there is no cap. Counts running generations, which are refunded if they fail. */
  remaining: number | null;
  period: string;
  resetsAt: string;
  protections: { concurrent?: number; perHour?: number } | null;
  /** What each action costs, so the UI states it before the candidate generates. */
  costs: { perDocument: 1; cvAndLetter: 2 };
  /** false while the operator has switched generation off: the UI says so instead of offering it. */
  generationAvailable: boolean;
}

/** Reasons that are the platform's failure (they refund the unit and do not count towards the hourly protection). */
export const SYSTEM_REASON = 'system:';

/**
 * The monthly document allowance as a ledger (DocumentCharge). A unit is RESERVED in the same transaction that accepts a generation request,
 * COMMITTED in the same transaction that stores the generated draft, and REFUNDED when generation fails, is abandoned or its reservation expires.
 * Everything that reads the limit and writes a reservation runs under one per-account advisory lock, so concurrent requests, retries and several
 * API processes can never exceed the limit. Editing, reviewing, previewing, downloading and exporting an existing document never touch the ledger.
 */
@Injectable()
export class DocumentAllowanceService {
  private readonly logger = new Logger(DocumentAllowanceService.name);

  constructor(private prisma: PrismaService, private product: ProductService) {}

  async view(userId: string, now = new Date()): Promise<AllowanceView> {
    await this.sweep(userId, now);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { subscription: true, planOverrides: activePlanOverrides(now) } });
    const plan = effectivePlan(user, now);
    const grant = this.product.grantFor(plan, DOCUMENT_FEATURE);
    const usage = await allowanceUsage(this.prisma, userId, now);
    const limit = grant?.enabled ? grant.limit ?? null : 0;
    return {
      plan,
      limit,
      used: usage.committed,
      reserved: usage.reserved,
      remaining: limit == null ? null : Math.max(0, limit - usage.committed - usage.reserved),
      period: usage.period.key,
      resetsAt: usage.period.resetsAt.toISOString(),
      protections: grant?.protections ?? null,
      costs: { perDocument: 1, cvAndLetter: 2 },
      generationAvailable: !generationDisabled(),
    };
  }

  /** Decides whether `units` more generations may start now, without writing anything. Returns the refusal (not thrown) or null. */
  private async evaluate(db: Prisma.TransactionClient | PrismaService, userId: string, units: number, now: Date) {
    const user = await db.user.findUnique({ where: { id: userId }, include: { subscription: true, planOverrides: activePlanOverrides(now) } });
    const plan = effectivePlan(user, now);
    const grant = this.product.grantFor(plan, DOCUMENT_FEATURE);
    const limit = grant?.enabled ? grant.limit ?? null : 0;
    const usage = await allowanceUsage(db, userId, now);
    let refusal: AllowanceError | null = null;
    if (generationDisabled()) {
      refusal = new AllowanceError('GENERATION_UNAVAILABLE', {}, 'Sənəd hazırlama hələ təsdiqlənməyib və hazırda əlçatan deyil. Mövcud sənədləri redaktə etmək, yükləmək və təsdiqləmək mümkündür.');
    }
    if (!refusal && limit != null && usage.committed + usage.reserved + units > limit) {
      refusal = new AllowanceError(
        'ALLOWANCE_EXHAUSTED',
        { limit, used: usage.committed, reserved: usage.reserved, remaining: Math.max(0, limit - usage.committed - usage.reserved), requested: units, resetsAt: usage.period.resetsAt.toISOString() },
        limit === 0 ? 'Bu plan sənəd yaratmağı əhatə etmir.' : `Aylıq sənəd limiti (${limit}) çatılıb və ya bu sorğu onu aşar. Limit ${usage.period.resetsAt.toISOString()} tarixində yenilənir.`,
      );
    }
    const protections = grant?.protections;
    if (!refusal && protections?.concurrent != null && usage.reserved + units > protections.concurrent) {
      refusal = new AllowanceError('CONCURRENCY_LIMIT', { concurrent: protections.concurrent, running: usage.reserved, requested: units }, `Eyni anda ən çox ${protections.concurrent} sənəd hazırlana bilər. Biri bitəndən sonra yenidən cəhd edin.`);
    }
    if (!refusal && protections?.perHour != null) {
      const started = await db.documentCharge.aggregate({
        _sum: { units: true },
        where: { userId, reservedAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) }, NOT: { status: 'REFUNDED', reason: { startsWith: SYSTEM_REASON } } },
      });
      if ((started._sum.units ?? 0) + units > protections.perHour) {
        refusal = new AllowanceError('HOURLY_LIMIT', { perHour: protections.perHour, startedLastHour: started._sum.units ?? 0, requested: units }, `Saatda ən çox ${protections.perHour} sənəd hazırlana bilər. Bir az sonra yenidən cəhd edin.`);
      }
    }
    return { refusal, usage };
  }

  /** For the quote endpoint: whether the account could start `units` generations right now (nothing is reserved). */
  async check(userId: string, units: number, now = new Date()): Promise<{ affordable: boolean; refusal: { code: AllowanceRefusal; [k: string]: unknown } | null }> {
    await this.sweep(userId, now);
    const { refusal } = await this.evaluate(this.prisma, userId, units, now);
    return { affordable: !refusal, refusal: refusal ? ({ code: refusal.code, ...refusal.details } as any) : null };
  }

  /**
   * Reserves one unit per document inside the caller's transaction (which must already hold the account's advisory lock — use `lock`).
   * Throws AllowanceError, rolling the whole request back, when the account cannot afford all `resumeIds` or a protection applies.
   * Charges are keyed by resume id (unique), so a repeated reservation for the same document cannot double-charge.
   */
  async reserve(tx: Prisma.TransactionClient, userId: string, resumeIds: string[], now = new Date()): Promise<void> {
    const units = resumeIds.length;
    if (!units) return;
    await this.sweepIn(tx, userId, now);
    const { refusal, usage } = await this.evaluate(tx, userId, units, now);
    if (refusal) throw refusal;
    const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
    await tx.documentCharge.createMany({ data: resumeIds.map((resumeId) => ({ userId, resumeId, periodKey: usage.period.key, units: 1, status: 'RESERVED' as const, expiresAt, reservedAt: now })) });
  }

  /** The per-account lock every reservation and lazy sweep runs under. Taken after the caller's own locks. */
  async lock(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`doc-allowance:${userId}`}))`;
  }

  /** Marks the unit consumed because its document now exists. Call in the transaction that stores the draft. Safe to repeat; a no-op for documents that predate the ledger. */
  async commit(tx: Prisma.TransactionClient, resumeId: string, now = new Date()): Promise<void> {
    await tx.documentCharge.updateMany({ where: { resumeId, NOT: { status: 'COMMITTED' } }, data: { status: 'COMMITTED', settledAt: now, reason: null } });
  }

  /** Returns the unit of a generation that did not produce a document. Idempotent; never touches a COMMITTED unit. */
  async refund(db: Prisma.TransactionClient | PrismaService, resumeId: string, reason: string, now = new Date()): Promise<boolean> {
    const { count } = await db.documentCharge.updateMany({ where: { resumeId, status: 'RESERVED' }, data: { status: 'REFUNDED', settledAt: now, reason } });
    return count > 0;
  }

  /**
   * Refunds reservations that can no longer produce a document: their draft failed or was removed, or the reservation expired. Lazy (runs on every read
   * and reservation), so no timer is needed and nothing stays stranded.
   */
  async sweep(userId: string, now = new Date()): Promise<number> {
    return this.sweepIn(this.prisma, userId, now);
  }

  private async sweepIn(db: Prisma.TransactionClient | PrismaService, userId: string, now: Date): Promise<number> {
    let refunded = 0;
    const data = (reason: string) => ({ status: 'REFUNDED' as const, settledAt: now, reason });
    refunded += (await db.documentCharge.updateMany({ where: { userId, status: 'RESERVED', resume: { is: { status: 'FAILED' } } }, data: data(`${SYSTEM_REASON}generation_failed`) })).count;
    refunded += (await db.documentCharge.updateMany({ where: { userId, status: 'RESERVED', resumeId: null }, data: data(`${SYSTEM_REASON}document_removed`) })).count;
    refunded += (await db.documentCharge.updateMany({ where: { userId, status: 'RESERVED', expiresAt: { lte: now } }, data: data(`${SYSTEM_REASON}reservation_expired`) })).count;
    if (refunded) this.logger.log(`document allowance: refunded ${refunded} stranded reservation(s)`);
    return refunded;
  }

  /** Aggregate for operators: reservations the sweep would still have to refund (should be zero in a healthy system). */
  async strandedCount(now = new Date()): Promise<number> {
    return this.prisma.documentCharge.count({ where: { status: 'RESERVED', expiresAt: { lte: now } } });
  }
}
