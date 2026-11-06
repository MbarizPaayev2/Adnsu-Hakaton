import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/database.service';

export function periodStart(period: 'day' | 'month', now = new Date()): Date {
  return period === 'day'
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Atomic, bounded usage counters for costly features. A limit of null counts without bounding. */
@Injectable()
export class UsageService {
  constructor(private prisma: PrismaService) {}

  async usedIn(userId: string, key: string, period: 'day' | 'month', now = new Date()): Promise<number> {
    const row = await this.prisma.usageCounter.findUnique({ where: { userId_key_periodStart: { userId, key, periodStart: periodStart(period, now) } } });
    return row?.used ?? 0;
  }

  /**
   * Consumes one unit unless the limit is reached. The check and the increment are one SQL statement, so concurrent requests can never
   * exceed the limit. Returns whether the unit was granted.
   */
  async consume(userId: string, key: string, period: 'day' | 'month', limit: number | null, now = new Date()): Promise<boolean> {
    if (limit === 0) return false;
    const start = periodStart(period, now);
    const rows = await this.prisma.$queryRaw<{ used: number }[]>`
      INSERT INTO "UsageCounter" ("id", "userId", "key", "periodStart", "used", "updatedAt")
      VALUES (${randomUUID()}, ${userId}, ${key}, ${start}, 1, now())
      ON CONFLICT ("userId", "key", "periodStart")
      DO UPDATE SET "used" = "UsageCounter"."used" + 1, "updatedAt" = now()
      WHERE ${limit}::int IS NULL OR "UsageCounter"."used" < ${limit}::int
      RETURNING "used"`;
    return rows.length > 0;
  }

  /** Counts a unit without ever refusing (shadow metering while a limit is not enforced). Failures never break the caller. */
  async record(userId: string, key: string, period: 'day' | 'month', now = new Date()): Promise<void> {
    await this.consume(userId, key, period, null, now).catch(() => undefined);
  }
}
