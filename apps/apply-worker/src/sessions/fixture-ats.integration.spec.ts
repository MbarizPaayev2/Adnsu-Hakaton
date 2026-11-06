import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { chromium, type Browser } from 'playwright';
import { BrowserSessionManagerService } from './browser-session-manager.service';
import { SessionsService } from './sessions.service';
import { noticeFingerprint } from './adapters/glorri-apply.adapter';
import {
  FixtureAts,
  FIXTURE_DECLARATION,
  FIXTURE_OTP,
  FIXTURE_POLICY_URL,
  FIXTURE_RECEIPT_PATH,
  FIXTURE_RECEIPT_PATTERN,
  FIXTURE_REJECTION_PATTERN,
  routeDestinationToFixture,
} from '../../test/support/fixture-ats';

// The REAL worker (SessionsService + Glorri adapter + headless Chromium)
// against the local fixture ATS. Only the destination host is routed to the
// fixture (test seam `prepareContext`); the allowlist is the production one.
// Synthetic documents only; nothing leaves the machine.

const MAC_CFT = `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CHROME = process.env.CHROMIUM_PATH || (existsSync(MAC_CFT) ? MAC_CFT : '/opt/pw-browsers/chromium');
const AUTHORITY = { noticeHash: noticeFingerprint(FIXTURE_DECLARATION, FIXTURE_POLICY_URL), noticeVersion: 'fixture-1' };
const url = (slug: string) => `https://jobs.glorri.com/vacancies/fixture/${slug}/apply`;
const ids = Array.from({ length: 40 }, (_, i) => `${String(i + 1).padStart(8, '0')}-1111-4111-8111-111111111111`);
let idSeq = 0;
const attempt = () => ids[idSeq++];

jest.setTimeout(60_000);

describe('real Chromium worker against the local fixture ATS', () => {
  const fixture = new FixtureAts();
  const env = { ...process.env };
  let dir: string;
  let cv: Buffer;
  let idPhoto: Buffer;
  let manager: BrowserSessionManagerService;
  let service: SessionsService;
  let launched: Browser[];
  let data: Record<string, string>;

  beforeAll(async () => {
    if (!existsSync(CHROME)) throw new Error(`Chromium not found at ${CHROME}; set CHROMIUM_PATH (no download is performed)`);
    await fixture.start();
    dir = mkdtempSync(join(tmpdir(), 'aise-fixture-docs-'));
    cv = Buffer.from('%PDF-1.4\nSYNTHETIC CV — no real person\n%%EOF\n');
    idPhoto = Buffer.from('\x89PNG\r\n\x1a\nSYNTHETIC ID IMAGE');
    writeFileSync(join(dir, 'cv.pdf'), cv);
    writeFileSync(join(dir, 'id.png'), idPhoto);
    data = {
      firstName: 'Sintetik', lastName: 'Namizəd', email: 'synthetic@example.com', phone: '+994500000000', address: 'Sintetik küçə 1',
      citizenship: 'Azərbaycan', dob: '05/05/1995', salary: '2000', netGross: 'Net', currency: 'AZN',
      resumeFilePath: join(dir, 'cv.pdf'), idPhotoFilePath: join(dir, 'id.png'), motivationLetter: 'Sintetik motivasiya məktubu.',
    };
  });

  afterAll(async () => {
    await fixture.stop();
    rmSync(dir, { recursive: true, force: true });
    process.env = { ...env };
  });

  beforeEach(() => {
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'true';
    process.env.EXTERNAL_APPLY_ACTION_TIMEOUT_MS = '3000';
    process.env.EXTERNAL_APPLY_SEND_OBSERVE_MS = '8000';
    delete process.env.EXTERNAL_APPLY_MAX_SESSIONS;
    delete process.env.EXTERNAL_APPLY_SESSION_TTL_MS;
    manager = new BrowserSessionManagerService();
    service = new SessionsService(manager);
    launched = [];
    service.launchBrowser = async () => {
      const browser = await chromium.launch({ headless: true, executablePath: CHROME });
      launched.push(browser);
      return browser;
    };
    service.prepareContext = routeDestinationToFixture(fixture.origin);
  });

  afterEach(async () => {
    await manager.onModuleDestroy();
    // Cleanup on every path: no browser outlives its session.
    expect(launched.filter((b) => b.isConnected())).toHaveLength(0);
  });

  const fill = (slug: string, app = slug) => service.launchAndFill(app, url(slug), data, AUTHORITY);

  it('normal: fills to review without sending, then one confirm yields an observed receipt', async () => {
    const filled = await fill('normal-1');
    expect(filled.status).toBe('READY_FOR_REVIEW');
    expect(Object.values(filled.previewData ?? {})).toContain('Müraciətinizi yoxlayın');
    expect(fixture.of('normal-1')).toMatchObject({ clicks: 0, submissions: [] });

    const sent = await service.confirmSubmit('normal-1', attempt(), false);
    expect(sent.outcome).toBe('SENT_OBSERVED');
    expect(new URL(sent.observation!.url).pathname).toMatch(FIXTURE_RECEIPT_PATH);
    expect(FIXTURE_RECEIPT_PATTERN.exec(sent.observation!.text)?.[1]).toBe(fixture.of('normal-1').receipts[0]);
    const [submission] = fixture.of('normal-1').submissions;
    expect(fixture.of('normal-1').clicks).toBe(1);
    expect(submission.fields).toMatchObject({ firstName: 'Sintetik', email: 'synthetic@example.com', citizenship: 'Azərbaycan', currency: 'AZN', isDataPrivacyAccepted: 'on', motivation: 'Sintetik motivasiya məktubu.' });
    expect(submission.files).toEqual([
      { field: 'cv', size: cv.length, sha256: createHash('sha256').update(cv).digest('hex') },
      { field: 'idPhoto', size: idPhoto.length, sha256: createHash('sha256').update(idPhoto).digest('hex') },
    ]);
    expect(manager.listLiveIds()).toEqual([]);
  });

  it('dry run reaches the final control and never activates it', async () => {
    expect((await fill('normal-2')).status).toBe('READY_FOR_REVIEW');
    await expect(service.confirmSubmit('normal-2', attempt(), true)).resolves.toMatchObject({ outcome: 'DRY_RUN_COMPLETE' });
    expect(fixture.of('normal-2')).toMatchObject({ clicks: 0, submissions: [] });
    expect(manager.listLiveIds()).toEqual([]);
  });

  it('required screening questions are asked, never guessed, and the declaration is not one of them', async () => {
    const filled = await fill('questions-1');
    expect(filled.status).toBe('NEEDS_INPUT');
    expect(filled.missingFields!.map((f) => [f.fieldKey, f.label])).toEqual([
      ['questions.0.answer', 'Sürücülük vəsiqəniz var?'],
      ['questions.1.answer', 'Növbəli işə hazırsınız?'],
    ]);
    expect(fixture.of('questions-1').clicks).toBe(0);
    const answered = await service.applyAnswers('questions-1', [
      { fieldKey: 'questions.0.answer', value: 'Xeyr' },
      { fieldKey: 'questions.1.answer', value: 'Bəli' },
    ]);
    expect(answered.status).toBe('READY_FOR_REVIEW');
    const sent = await service.confirmSubmit('questions-1', attempt(), false);
    expect(sent.outcome).toBe('SENT_OBSERVED');
    expect(fixture.of('questions-1').submissions[0].fields).toMatchObject({ 'questions.0.answer': 'Xeyr', 'questions.1.answer': 'Bəli' });
  });

  it('a changed privacy notice stops the fill without ticking it', async () => {
    await expect(fill('notice-changed-1')).resolves.toMatchObject({ status: 'FAILED', code: 'NOTICE_CHANGED' });
    expect(manager.listLiveIds()).toEqual([]);
    expect(fixture.of('notice-changed-1')).toMatchObject({ clicks: 0, submissions: [] });
  });

  it('an upload refused by the destination fails the fill', async () => {
    await expect(fill('upload-error-1')).resolves.toMatchObject({ status: 'FAILED', code: 'UPLOAD_FAILED' });
    expect(fixture.of('upload-error-1').submissions).toEqual([]);
  });

  it('OTP: a wrong code keeps the session for another try, the correct one completes', async () => {
    await fill('otp-1');
    await expect(service.confirmSubmit('otp-1', attempt(), false)).resolves.toMatchObject({ outcome: 'AWAITING_OTP' });
    await expect(service.submitOtp('otp-1', attempt(), '000000')).resolves.toMatchObject({ outcome: 'OTP_INVALID' });
    expect(manager.listLiveIds()).toEqual(['otp-1']);
    const ok = await service.submitOtp('otp-1', attempt(), FIXTURE_OTP);
    expect(ok.outcome).toBe('SENT_OBSERVED');
    expect(FIXTURE_RECEIPT_PATTERN.test(ok.observation!.text)).toBe(true);
    expect(fixture.of('otp-1')).toMatchObject({ clicks: 1, otpAttempts: 2 });
    expect(fixture.of('otp-1').submissions).toHaveLength(1);
    expect(manager.listLiveIds()).toEqual([]);
  });

  it('OTP: an expired code is reported as not accepted and the session is kept', async () => {
    await fill('otp-expired-1');
    await service.confirmSubmit('otp-expired-1', attempt(), false);
    await expect(service.submitOtp('otp-expired-1', attempt(), FIXTURE_OTP)).resolves.toMatchObject({ outcome: 'OTP_INVALID' });
    expect(manager.listLiveIds()).toEqual(['otp-expired-1']);
  });

  it('a visible refusal is reported with what the page showed (apps/api decides whether it is documented)', async () => {
    await fill('reject-1');
    const sent = await service.confirmSubmit('reject-1', attempt(), false);
    expect(['SENT_OBSERVED', 'REJECTED']).toContain(sent.outcome);
    expect(sent.observation!.text).toMatch(FIXTURE_REJECTION_PATTERN);
  });

  it('a delayed response is waited for, so the receipt is observed', async () => {
    await fill('slow-1');
    const started = Date.now();
    const sent = await service.confirmSubmit('slow-1', attempt(), false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(3000);
    expect(FIXTURE_RECEIPT_PATTERN.test(sent.observation!.text)).toBe(true);
  });

  it('a changed form (renamed fields) fails the fill within the action timeout', async () => {
    const started = Date.now();
    await expect(fill('changed-dom-1')).resolves.toMatchObject({ status: 'FAILED', code: 'FILL_ERROR' });
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it('a renamed final control means the review step was not reached', async () => {
    await expect(fill('changed-confirm-1')).resolves.toMatchObject({ status: 'FAILED', code: 'REVIEW_NOT_REACHED' });
  });

  it('an unexpected navigation after the send is observed as-is, without a receipt', async () => {
    await fill('navigate-1');
    const sent = await service.confirmSubmit('navigate-1', attempt(), false);
    expect(sent.outcome).toBe('SENT_OBSERVED');
    expect(new URL(sent.observation!.url).pathname).toBe('/login');
    expect(FIXTURE_RECEIPT_PATTERN.test(sent.observation!.text)).toBe(false);
  });

  it('a visible CAPTCHA stops the preparation; an invisible badge does not', async () => {
    await expect(fill('captcha-1')).resolves.toMatchObject({ status: 'FAILED', code: 'MANUAL_INTERVENTION_REQUIRED' });
    expect(fixture.of('captcha-1').clicks).toBe(0);
    await expect(fill('invisible-captcha-1')).resolves.toMatchObject({ status: 'READY_FOR_REVIEW' });
  });

  it('a CAPTCHA raised by the final click is reported with its reason, never passed', async () => {
    await fill('captcha-after-1');
    const sent = await service.confirmSubmit('captcha-after-1', attempt(), false);
    expect(sent).toMatchObject({ outcome: 'SENT_OBSERVED', code: 'MANUAL_INTERVENTION_REQUIRED' });
    expect(fixture.of('captcha-after-1')).toMatchObject({ clicks: 1, submissions: [] });
  });

  it('an alert already on the page is not mistaken for a refused upload', async () => {
    await expect(fill('standing-alert-1')).resolves.toMatchObject({ status: 'READY_FOR_REVIEW' });
  });

  it('an ambiguous network outcome (connection dropped after the destination got it) is observed without a receipt', async () => {
    await fill('hang-1');
    const sent = await service.confirmSubmit('hang-1', attempt(), false);
    expect(sent.outcome).toBe('SENT_OBSERVED');
    expect(FIXTURE_RECEIPT_PATTERN.test(sent.observation?.text ?? '')).toBe(false);
    expect(fixture.of('hang-1').submissions).toHaveLength(1);
  });

  it('two concurrent confirms on one session activate the final control once', async () => {
    await fill('slow-2');
    const results = await Promise.allSettled([
      service.confirmSubmit('slow-2', attempt(), false),
      service.confirmSubmit('slow-2', attempt(), false),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: expect.any(ConflictException) });
    expect(fixture.of('slow-2')).toMatchObject({ clicks: 1 });
    expect(fixture.of('slow-2').submissions).toHaveLength(1);
  });

  it('low capacity refuses a second session, and the slot returns when the first is released', async () => {
    process.env.EXTERNAL_APPLY_MAX_SESSIONS = '1';
    await fill('normal-3');
    await expect(fill('normal-4')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await service.cancel('normal-3');
    await expect(fill('normal-4')).resolves.toMatchObject({ status: 'READY_FOR_REVIEW' });
  });

  it('a browser that cannot be created fails the fill and releases its slot', async () => {
    process.env.EXTERNAL_APPLY_MAX_SESSIONS = '1';
    service.launchBrowser = async () => { throw new Error('browser executable missing'); };
    await expect(fill('normal-5')).resolves.toEqual({ status: 'FAILED', code: 'FILL_ERROR' });
    expect(manager.canAcquire()).toBe(true);
  });

  it('an expired session is swept and a later confirm reports it as not sent', async () => {
    process.env.EXTERNAL_APPLY_SESSION_TTL_MS = '200';
    await fill('normal-6');
    await new Promise((r) => setTimeout(r, 300));
    await expect(manager.sweepExpired()).resolves.toEqual(['normal-6']);
    await expect(service.confirmSubmit('normal-6', attempt(), false)).resolves.toMatchObject({ outcome: 'NOT_SENT', code: 'SESSION_NOT_FOUND' });
    expect(fixture.of('normal-6')).toMatchObject({ clicks: 0, submissions: [] });
  });
});
