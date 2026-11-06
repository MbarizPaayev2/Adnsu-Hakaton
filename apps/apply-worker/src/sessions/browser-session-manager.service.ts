import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { PrivacyAuthority } from './adapters/glorri-apply.types';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  expiresAt: number;
  otpAttempts: number;
  authority: PrivacyAuthority;
  /** Attempt currently driving the page; a second one is refused. */
  inFlightAttemptId?: string;
  /** Candidate answers are being written to the page; no send meanwhile. */
  editing: boolean;
  /** Set the moment the final control is activated; it is never activated twice. */
  finalActivated: boolean;
  awaitingOtp: boolean;
}

const DEFAULT_MAX_SESSIONS = 10;
const DEFAULT_TTL_MS = 20 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * In-process singleton holding all live Playwright browser/context/page state
 * for in-flight glorri.az apply sessions. This service is only ever meant to
 * run as a single process - the Map below is not shared across replicas.
 */
@Injectable()
export class BrowserSessionManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserSessionManagerService.name);
  private readonly sessions = new Map<string, BrowserSession>();
  // Slots taken by browsers still launching, counted against capacity so
  // concurrent creates cannot overshoot it.
  private reserved = 0;
  // Applications whose browser is still launching/filling, so a second
  // create for the same application cannot start a parallel browser.
  private readonly pending = new Set<string>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor() {
    // Sweeps automatically, not just reactively via GET /sessions -
    // reconciliation from apps/api may be slow or down, but expired browser
    // sessions still need to be closed to avoid zombie Chromium processes.
    this.sweepTimer = setInterval(() => {
      this.sweepExpired().catch((err) =>
        this.logger.error(`sweepExpired failed: ${err instanceof Error ? err.message : err}`),
      );
    }, SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  private get maxSessions(): number {
    const raw = process.env.EXTERNAL_APPLY_MAX_SESSIONS;
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_SESSIONS;
  }

  private get ttlMs(): number {
    const raw = process.env.EXTERNAL_APPLY_SESSION_TTL_MS;
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MS;
  }

  canAcquire(): boolean {
    return this.sessions.size + this.reserved < this.maxSessions;
  }

  /**
   * Reserves a capacity slot for one application before launching its
   * browser; pair with release(). Refuses when the application already has a
   * live or launching session ('DUPLICATE') or capacity is exhausted ('FULL').
   */
  reserve(applicationId: string): 'OK' | 'DUPLICATE' | 'FULL' {
    if (this.sessions.has(applicationId) || this.pending.has(applicationId)) return 'DUPLICATE';
    if (!this.canAcquire()) return 'FULL';
    this.reserved += 1;
    this.pending.add(applicationId);
    return 'OK';
  }

  release(applicationId: string): void {
    if (this.pending.delete(applicationId)) this.reserved = Math.max(0, this.reserved - 1);
  }

  has(applicationId: string): boolean {
    return this.sessions.has(applicationId) || this.pending.has(applicationId);
  }

  create(
    applicationId: string,
    browser: Browser,
    context: BrowserContext,
    page: Page,
    authority: PrivacyAuthority,
  ): BrowserSession {
    const session: BrowserSession = {
      browser,
      context,
      page,
      expiresAt: Date.now() + this.ttlMs,
      otpAttempts: 0,
      authority,
      finalActivated: false,
      awaitingOtp: false,
      editing: false,
    };
    this.sessions.set(applicationId, session);
    return session;
  }

  get(applicationId: string): BrowserSession | undefined {
    return this.sessions.get(applicationId);
  }

  touch(applicationId: string): void {
    const session = this.sessions.get(applicationId);
    if (session) {
      session.expiresAt = Date.now() + this.ttlMs;
    }
  }

  async dispose(applicationId: string): Promise<void> {
    const session = this.sessions.get(applicationId);
    if (!session) return;
    this.sessions.delete(applicationId);
    try {
      await session.browser.close();
    } catch (err) {
      // Already-closed browsers throwing shouldn't crash the caller.
      this.logger.warn(
        `Error closing browser for session ${applicationId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async sweepExpired(): Promise<string[]> {
    const now = Date.now();
    // A session with an attempt in flight is never swept from under it.
    const expiredIds = Array.from(this.sessions.entries())
      .filter(([, session]) => session.expiresAt <= now && !session.inFlightAttemptId && !session.editing)
      .map(([id]) => id);

    for (const id of expiredIds) {
      await this.dispose(id);
    }

    if (expiredIds.length) {
      this.logger.log(`Swept ${expiredIds.length} expired session(s): ${expiredIds.join(', ')}`);
    }
    return expiredIds;
  }

  listLiveIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.sweepTimer);
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.dispose(id)));
  }
}
