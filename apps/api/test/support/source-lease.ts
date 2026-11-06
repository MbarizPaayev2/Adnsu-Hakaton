import { SourceLeaseService } from '../../src/jobs/source-lease.service';

/**
 * Importing into a reviewed collector's source now requires that source's lease (the one the scheduler, run-now and the CLI take). Tests that drive the
 * guarded import routes for such a source hold it like a real importer: take it once, send its token, release it at the end. The test database is
 * the test's own, so a lease left behind by an aborted run is cleared first.
 */
export class TestLeases {
  private tokens = new Map<string, string>();
  private service: SourceLeaseService;
  constructor(private prisma: any) { this.service = new SourceLeaseService(prisma); }

  async take(...keys: string[]) {
    for (const key of keys) {
      await this.prisma.jobSource.updateMany({ where: { key }, data: { leaseUntil: null, leaseOwner: null, leaseHeartbeatAt: null } });
      const token = await this.service.acquire(key, 'cli');
      if (!token) throw new Error(`could not take the lease for ${key}`);
      this.tokens.set(key, token);
    }
  }
  /** The token for a source key or an externalId ("work:slug"). */
  of(keyOrExternalId: string): string {
    const key = keyOrExternalId.split(':')[0];
    const token = this.tokens.get(key);
    if (!token) throw new Error(`no lease held for ${key}`);
    return token;
  }
  /** The token if this key is held, else undefined (for sources that are not lease-managed). */
  maybe(keyOrExternalId: string): string | undefined { return this.tokens.get(keyOrExternalId.split(':')[0]); }
  async releaseAll() {
    for (const [key, token] of this.tokens) await this.service.release(key, token).catch(() => undefined);
    this.tokens.clear();
  }
}
