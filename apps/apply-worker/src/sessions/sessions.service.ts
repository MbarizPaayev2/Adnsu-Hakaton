import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { chromium } from 'playwright';
import { BrowserSessionManagerService } from './browser-session-manager.service';
import {
  applyAnswers as adapterApplyAnswers,
  captureScreenshot as adapterCaptureScreenshot,
  confirmSubmit as adapterConfirmSubmit,
  fillApplication,
  isAllowedApplyUrl,
  submitOtp as adapterSubmitOtp,
} from './adapters/glorri-apply.adapter';
import { ConfirmResult, FillResult, GlorriFillData, OtpResult, PrivacyAuthority } from './adapters/glorri-apply.types';

type Launcher = () => Promise<import('playwright').Browser>;
type ContextSetup = (context: import('playwright').BrowserContext) => Promise<void>;

const COMPLETED_ATTEMPTS_KEPT = 500;

function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  // Results of finished attempts, so a retried HTTP request with the same
  // attempt id gets the same answer instead of a second activation.
  private readonly completed = new Map<string, { applicationId: string; result: ConfirmResult | OtpResult }>();
  // Overridable in tests; production always launches headless Chromium.
  launchBrowser: Launcher = () => chromium.launch({ headless: true });
  // Test seam, never set in production: lets a test serve the allowlisted
  // destination host from a local fixture (context.route). The allowlist
  // check above still runs on the real URL first.
  prepareContext: ContextSetup = async () => undefined;

  constructor(private readonly sessionManager: BrowserSessionManagerService) {}

  private liveSendsEnabled(): boolean {
    return process.env.EXTERNAL_APPLY_LIVE_ENABLED === 'true';
  }

  async launchAndFill(
    applicationId: string,
    applyUrl: string,
    fillData: GlorriFillData,
    authority: PrivacyAuthority,
  ): Promise<FillResult> {
    if (!isAllowedApplyUrl(applyUrl)) {
      throw new BadRequestException('Destination is not allowlisted');
    }
    const reservation = this.sessionManager.reserve(applicationId);
    if (reservation === 'DUPLICATE') {
      throw new ConflictException('A session already exists for this application');
    }
    if (reservation === 'FULL') {
      throw new ServiceUnavailableException('apply-worker is at capacity; try again shortly.');
    }

    let browser: import('playwright').Browser | undefined;
    let registered = false;
    try {
      browser = await this.launchBrowser();
      const context = await browser.newContext();
      await this.prepareContext(context);
      const page = await context.newPage();
      // Bounded waits: a changed form must fail the fill, not hold a slot for
      // Playwright's 30 s default on every missing field.
      page.setDefaultTimeout(envInt('EXTERNAL_APPLY_ACTION_TIMEOUT_MS', 10_000));
      const result = await fillApplication(page, applyUrl, fillData, authority);
      if (result.status !== 'FAILED') {
        this.sessionManager.create(applicationId, browser, context, page, authority);
        registered = true;
      }
      return result;
    } catch (err) {
      this.logger.warn(`Fill for ${applicationId} failed: ${err instanceof Error ? err.message : err}`);
      return { status: 'FAILED', code: 'FILL_ERROR' };
    } finally {
      this.sessionManager.release(applicationId);
      if (browser && !registered) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  private requireSession(applicationId: string) {
    const session = this.sessionManager.get(applicationId);
    if (!session) {
      throw new NotFoundException(`No live apply session for application ${applicationId}`);
    }
    return session;
  }

  async applyAnswers(
    applicationId: string,
    updates: { fieldKey: string; value: string }[],
    motivationLetter?: string,
  ): Promise<FillResult> {
    const session = this.requireSession(applicationId);
    if (session.finalActivated || session.inFlightAttemptId || session.editing) {
      throw new ConflictException('The application can no longer be edited');
    }
    session.editing = true;
    this.sessionManager.touch(applicationId);
    try {
      return await adapterApplyAnswers(session.page, updates, motivationLetter, session.authority);
    } finally {
      session.editing = false;
    }
  }

  private remember(attemptId: string, applicationId: string, result: ConfirmResult | OtpResult) {
    this.completed.set(attemptId, { applicationId, result });
    if (this.completed.size > COMPLETED_ATTEMPTS_KEPT) {
      this.completed.delete(this.completed.keys().next().value!);
    }
  }

  private replayed(attemptId: string, applicationId: string) {
    const done = this.completed.get(attemptId);
    if (!done) return undefined;
    if (done.applicationId !== applicationId) throw new ConflictException('Attempt id belongs to another application');
    return done.result;
  }

  /**
   * The final send for one candidate-initiated attempt. At most one attempt
   * drives a session at a time, and the final control is activated at most
   * once per session.
   */
  async confirmSubmit(applicationId: string, attemptId: string, dryRun: boolean): Promise<ConfirmResult & { attemptId: string }> {
    const previous = this.replayed(attemptId, applicationId);
    if (previous) return { attemptId, ...(previous as ConfirmResult) };
    const session = this.sessionManager.get(applicationId);
    if (!session) return { attemptId, outcome: 'NOT_SENT', code: 'SESSION_NOT_FOUND' };
    if (session.inFlightAttemptId) throw new ConflictException('Another attempt is in progress');
    if (session.finalActivated) throw new ConflictException('This application was already sent from this session');
    // Answers are still being written: nothing was activated, the candidate
    // can confirm again once the page has settled.
    if (session.editing) return { attemptId, outcome: 'NOT_SENT', code: 'SESSION_BUSY' };
    if (!dryRun && !this.liveSendsEnabled()) {
      return { attemptId, outcome: 'NOT_SENT', code: 'WORKER_GATE_OFF' };
    }

    session.inFlightAttemptId = attemptId;
    // Spent before the adapter runs, so no path (including an exception
    // thrown mid-click) can leave a session that would activate it again.
    if (!dryRun) session.finalActivated = true;
    this.sessionManager.touch(applicationId);
    let result: ConfirmResult;
    try {
      result = await adapterConfirmSubmit(session.page, dryRun);
    } catch (err) {
      this.logger.warn(`Confirm for ${applicationId} threw: ${err instanceof Error ? err.message : err}`);
      // Whether the control was activated is unknown: never report NOT_SENT.
      result = dryRun ? { outcome: 'NOT_SENT', code: 'WORKER_ERROR_BEFORE_SEND' } : { outcome: 'SENT_OBSERVED', code: 'WORKER_EXCEPTION' };
    } finally {
      session.inFlightAttemptId = undefined;
    }
    if (!dryRun && result.outcome === 'NOT_SENT') session.finalActivated = false;
    session.awaitingOtp = result.outcome === 'AWAITING_OTP';
    this.remember(attemptId, applicationId, result);

    // Keep the session only when the candidate still has something to do on
    // it: an OTP, or a send the worker refused before activating anything.
    const keep = result.outcome === 'AWAITING_OTP'
      || (result.outcome === 'NOT_SENT' && (result.code === 'WORKER_GATE_OFF' || result.code === 'SESSION_BUSY'));
    if (!keep) await this.sessionManager.dispose(applicationId);
    return { attemptId, ...result };
  }

  /** Submits one candidate-supplied OTP. An invalid code keeps the session for another try. */
  async submitOtp(applicationId: string, attemptId: string, code: string): Promise<OtpResult & { attemptId: string }> {
    const previous = this.replayed(attemptId, applicationId);
    if (previous) return { attemptId, ...(previous as OtpResult) };
    const session = this.sessionManager.get(applicationId);
    if (!session) return { attemptId, outcome: 'NOT_SENT', code: 'SESSION_NOT_FOUND' };
    if (!session.awaitingOtp || !session.finalActivated) return { attemptId, outcome: 'NOT_SENT', code: 'NOT_AWAITING_OTP' };
    if (session.inFlightAttemptId) throw new ConflictException('Another attempt is in progress');
    if (!this.liveSendsEnabled()) return { attemptId, outcome: 'NOT_SENT', code: 'WORKER_GATE_OFF' };

    session.inFlightAttemptId = attemptId;
    session.otpAttempts += 1;
    this.sessionManager.touch(applicationId);
    let result: OtpResult;
    try {
      result = await adapterSubmitOtp(session.page, code);
    } catch (err) {
      this.logger.warn(`OTP for ${applicationId} threw: ${err instanceof Error ? err.message : err}`);
      result = { outcome: 'SENT_OBSERVED', code: 'WORKER_EXCEPTION' };
    } finally {
      session.inFlightAttemptId = undefined;
    }
    this.remember(attemptId, applicationId, result);
    if (result.outcome !== 'OTP_INVALID' && !(result.outcome === 'NOT_SENT' && result.code === 'OTP_FIELD_MISSING')) {
      session.awaitingOtp = false;
      await this.sessionManager.dispose(applicationId);
    }
    return { attemptId, ...result };
  }

  async takeScreenshot(applicationId: string): Promise<Buffer> {
    const session = this.requireSession(applicationId);
    return adapterCaptureScreenshot(session.page);
  }

  async cancel(applicationId: string): Promise<void> {
    const session = this.sessionManager.get(applicationId);
    // Never pull the page out from under an in-flight send.
    if (session?.inFlightAttemptId) throw new ConflictException('An attempt is in progress');
    await this.sessionManager.dispose(applicationId);
  }

  listLiveIds(): string[] {
    return this.sessionManager.listLiveIds();
  }
}
