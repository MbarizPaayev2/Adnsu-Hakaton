import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

// Azerbaijan has no daylight saving time since 2016: Baku is UTC+4 all year, so a month boundary is a fixed offset from UTC.
const BAKU_OFFSET_MS = 4 * 60 * 60 * 1000;

/** How long an accepted-but-unfinished generation holds its unit. Longer than the stale-draft window (15 minutes), so a lost worker is refunded first. */
export const RESERVATION_TTL_MS = 20 * 60 * 1000;

export interface AllowancePeriod {
  /** The account period, e.g. "2026-10": the calendar month in Baku. Every account resets at the same moment. */
  key: string;
  startsAt: Date;
  /** When the allowance resets: midnight at the start of the next month in Baku. */
  resetsAt: Date;
}

export function periodFor(now = new Date()): AllowancePeriod {
  const baku = new Date(now.getTime() + BAKU_OFFSET_MS);
  const y = baku.getUTCFullYear();
  const m = baku.getUTCMonth();
  return {
    key: `${y}-${String(m + 1).padStart(2, '0')}`,
    startsAt: new Date(Date.UTC(y, m, 1) - BAKU_OFFSET_MS),
    resetsAt: new Date(Date.UTC(y, m + 1, 1) - BAKU_OFFSET_MS),
  };
}

export interface AllowanceUsage {
  period: AllowancePeriod;
  /** Successfully generated documents this period. */
  committed: number;
  /** Accepted generations still running (unexpired). They count against the limit so concurrent requests cannot overshoot it. */
  reserved: number;
}

/** What the ledger holds for one account in the period containing `now`. Expired reservations are not counted (they are refunded by the next sweep). */
export async function allowanceUsage(db: Db, userId: string, now = new Date()): Promise<AllowanceUsage> {
  const period = periodFor(now);
  const rows = await db.documentCharge.groupBy({
    by: ['status'],
    where: {
      userId,
      periodKey: period.key,
      OR: [{ status: 'COMMITTED' }, { status: 'RESERVED', expiresAt: { gt: now } }],
    },
    _sum: { units: true },
  });
  const sum = (status: string) => rows.find((r) => r.status === status)?._sum.units ?? 0;
  return { period, committed: sum('COMMITTED'), reserved: sum('RESERVED') };
}
