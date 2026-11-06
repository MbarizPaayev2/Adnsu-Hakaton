import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/database.service';

/** How long a lease lives without a heartbeat. A holder renews well inside this; a dead holder's lease is simply allowed to expire. */
export const LEASE_TTL_MS = 45 * 60_000;

export type LeaseHolder = 'scheduler' | 'operator' | 'cli';

/** The holder lost its lease (it expired and someone else took it, or it was recovered): the run must stop and must not record a result as if it still owned the source. */
export class LeaseLostError extends Error {
  constructor(readonly source: string) { super(`Lease for source ${source} was lost`); }
}

/**
 * ONE lease per source, taken by the scheduled processor, an operator's run-now and the manual import CLI alike, so no two of them can collect the same
 * source at once. The lease carries a secret owner token: only the holder can renew or release it, and the import routes check it, so an import that did
 * not take the lease cannot write (see JobsController).
 */
@Injectable()
export class SourceLeaseService {
  constructor(private prisma: PrismaService) {}

  /** Takes the lease if nobody holds a live one. Returns the owner token, or null when another holder has it. */
  async acquire(key: string, holder: LeaseHolder, now = new Date(), ttlMs = LEASE_TTL_MS): Promise<string | null> {
    const token = `${holder}:${randomBytes(16).toString('hex')}`;
    const won = await this.prisma.jobSource.updateMany({
      where: { key, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: new Date(now.getTime() + ttlMs), leaseOwner: token, leaseHeartbeatAt: now },
    });
    return won.count ? token : null;
  }

  /** Extends the lease while the token is still the owner (even just after expiry, as long as nobody took it over). False means the lease is lost. */
  async renew(key: string, token: string, now = new Date(), ttlMs = LEASE_TTL_MS): Promise<boolean> {
    const { count } = await this.prisma.jobSource.updateMany({ where: { key, leaseOwner: token }, data: { leaseUntil: new Date(now.getTime() + ttlMs), leaseHeartbeatAt: now } });
    return count > 0;
  }

  /** Releases the lease only if the token still owns it. */
  async release(key: string, token: string): Promise<boolean> {
    const { count } = await this.prisma.jobSource.updateMany({ where: { key, leaseOwner: token }, data: { leaseUntil: null, leaseOwner: null, leaseHeartbeatAt: null } });
    return count > 0;
  }

  /** Whether `token` owns a live (unexpired) lease on the source right now. */
  async holds(key: string, token: string | undefined, now = new Date()): Promise<boolean> {
    if (!token) return false;
    const row = await this.prisma.jobSource.findUnique({ where: { key }, select: { leaseOwner: true, leaseUntil: true } });
    return !!row && row.leaseOwner === token && !!row.leaseUntil && row.leaseUntil > now;
  }

  /**
   * Whether `token` is still the recorded owner (expired or not): nobody has taken the source over. A run whose lease merely lapsed while nobody else
   * took it may still finish and record; one that was taken over may not.
   */
  async owns(key: string, token: string): Promise<boolean> {
    const row = await this.prisma.jobSource.findUnique({ where: { key }, select: { leaseOwner: true } });
    return !!row && row.leaseOwner === token;
  }

  /** Who holds the source, for operators: the kind of holder only, never the token. */
  async describe(key: string, now = new Date()): Promise<{ holder: LeaseHolder | 'unknown'; until: Date } | null> {
    const row = await this.prisma.jobSource.findUnique({ where: { key }, select: { leaseOwner: true, leaseUntil: true } });
    if (!row?.leaseUntil || row.leaseUntil <= now) return null;
    const kind = row.leaseOwner?.split(':')[0];
    return { holder: kind === 'scheduler' || kind === 'operator' || kind === 'cli' ? kind : 'unknown', until: row.leaseUntil };
  }
}
