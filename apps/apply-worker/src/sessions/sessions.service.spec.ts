import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { BrowserSessionManagerService } from './browser-session-manager.service';
import { SessionsService } from './sessions.service';
import * as adapter from './adapters/glorri-apply.adapter';

jest.mock('./adapters/glorri-apply.adapter', () => {
  const actual = jest.requireActual('./adapters/glorri-apply.adapter');
  return {
    ...actual,
    fillApplication: jest.fn(),
    applyAnswers: jest.fn(),
    confirmSubmit: jest.fn(),
    submitOtp: jest.fn(),
    captureScreenshot: jest.fn(),
  };
});

const APPLY_URL = 'https://jobs.glorri.com/vacancies/acme/backend-dev/apply';
const AUTHORITY = { noticeHash: 'a'.repeat(64), noticeVersion: 'fixture-1' };
const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const mocked = adapter as jest.Mocked<typeof adapter>;

function fakeBrowser() {
  const page = { setDefaultTimeout: jest.fn() };
  const browser = { newContext: jest.fn(async () => ({ newPage: async () => page })), close: jest.fn(async () => undefined) };
  return browser as any;
}

describe('SessionsService (worker attempt coordination)', () => {
  let manager: BrowserSessionManagerService;
  let service: SessionsService;
  let browsers: any[];
  const realGate = process.env.EXTERNAL_APPLY_LIVE_ENABLED;
  const realMax = process.env.EXTERNAL_APPLY_MAX_SESSIONS;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'true';
    delete process.env.EXTERNAL_APPLY_MAX_SESSIONS;
    manager = new BrowserSessionManagerService();
    service = new SessionsService(manager);
    browsers = [];
    service.launchBrowser = async () => {
      const b = fakeBrowser();
      browsers.push(b);
      return b;
    };
    mocked.fillApplication.mockResolvedValue({ status: 'READY_FOR_REVIEW', missingFields: [] });
  });

  afterEach(async () => {
    await manager.onModuleDestroy();
    if (realGate === undefined) delete process.env.EXTERNAL_APPLY_LIVE_ENABLED;
    else process.env.EXTERNAL_APPLY_LIVE_ENABLED = realGate;
    if (realMax === undefined) delete process.env.EXTERNAL_APPLY_MAX_SESSIONS;
    else process.env.EXTERNAL_APPLY_MAX_SESSIONS = realMax;
  });

  const ready = () => service.launchAndFill('app-1', APPLY_URL, {}, AUTHORITY);

  it('never opens a destination outside its own allowlist', async () => {
    for (const url of ['https://evil.example/vacancies/a/b/apply', 'http://jobs.glorri.com/vacancies/a/b/apply', `${APPLY_URL}?next=x`]) {
      await expect(service.launchAndFill('app-x', url, {}, AUTHORITY)).rejects.toThrow(BadRequestException);
    }
    expect(browsers).toHaveLength(0);
  });

  it('passes the recorded authority to the fill and keeps the browser only for a usable result', async () => {
    await ready();
    expect(mocked.fillApplication).toHaveBeenCalledWith(expect.anything(), APPLY_URL, {}, AUTHORITY);
    expect(manager.listLiveIds()).toEqual(['app-1']);

    mocked.fillApplication.mockResolvedValue({ status: 'FAILED', code: 'NOTICE_CHANGED' });
    await expect(service.launchAndFill('app-2', APPLY_URL, {}, AUTHORITY)).resolves.toEqual({ status: 'FAILED', code: 'NOTICE_CHANGED' });
    expect(browsers[1].close).toHaveBeenCalled();

    mocked.fillApplication.mockRejectedValue(new Error('page crashed'));
    await expect(service.launchAndFill('app-3', APPLY_URL, {}, AUTHORITY)).resolves.toMatchObject({ status: 'FAILED', code: 'FILL_ERROR' });
    expect(browsers[2].close).toHaveBeenCalled();
    expect(manager.listLiveIds()).toEqual(['app-1']);
  });

  it('reserves capacity before launching so concurrent fills cannot overshoot it', async () => {
    process.env.EXTERNAL_APPLY_MAX_SESSIONS = '1';
    let release!: () => void;
    service.launchBrowser = () => new Promise((resolve) => { release = () => resolve(fakeBrowser()); });
    const first = service.launchAndFill('app-1', APPLY_URL, {}, AUTHORITY);
    await expect(service.launchAndFill('app-2', APPLY_URL, {}, AUTHORITY)).rejects.toThrow(ServiceUnavailableException);
    release();
    await first;
    expect(manager.listLiveIds()).toEqual(['app-1']);
  });

  it('replays a repeated attempt id and activates the final control at most once', async () => {
    await ready();
    mocked.confirmSubmit.mockResolvedValue({ outcome: 'SENT_OBSERVED', observation: { url: APPLY_URL, text: 'ok' } });
    const first = await service.confirmSubmit('app-1', A1, false);
    const again = await service.confirmSubmit('app-1', A1, false);
    expect(first).toEqual(again);
    expect(first).toMatchObject({ attemptId: A1, outcome: 'SENT_OBSERVED' });
    expect(mocked.confirmSubmit).toHaveBeenCalledTimes(1);
    // The session is gone after a send; a new attempt cannot send again.
    await expect(service.confirmSubmit('app-1', A2, false)).resolves.toEqual({ attemptId: A2, outcome: 'NOT_SENT', code: 'SESSION_NOT_FOUND' });
    expect(mocked.confirmSubmit).toHaveBeenCalledTimes(1);
  });

  it('refuses a second attempt while one is in flight', async () => {
    await ready();
    let finish!: (v: any) => void;
    mocked.confirmSubmit.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = service.confirmSubmit('app-1', A1, false);
    await new Promise((r) => setImmediate(r));
    await expect(service.confirmSubmit('app-1', A2, false)).rejects.toThrow(ConflictException);
    await expect(service.cancel('app-1')).rejects.toThrow(ConflictException);
    finish({ outcome: 'AWAITING_OTP' });
    await expect(first).resolves.toMatchObject({ outcome: 'AWAITING_OTP' });
    // The OTP stage keeps the session, but the final control is spent.
    await expect(service.confirmSubmit('app-1', A2, false)).rejects.toThrow(ConflictException);
    expect(mocked.confirmSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not send while its own live gate is off, and keeps the session for later', async () => {
    await ready();
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'false';
    await expect(service.confirmSubmit('app-1', A1, false)).resolves.toEqual({ attemptId: A1, outcome: 'NOT_SENT', code: 'WORKER_GATE_OFF' });
    expect(mocked.confirmSubmit).not.toHaveBeenCalled();
    expect(manager.listLiveIds()).toEqual(['app-1']);
  });

  it('runs a dry run without the live gate, and never leaves a session that could later send', async () => {
    await ready();
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'false';
    mocked.confirmSubmit.mockResolvedValue({ outcome: 'DRY_RUN_COMPLETE' });
    await expect(service.confirmSubmit('app-1', A1, true)).resolves.toMatchObject({ outcome: 'DRY_RUN_COMPLETE' });
    expect(mocked.confirmSubmit).toHaveBeenCalledWith(expect.anything(), true);
    expect(manager.listLiveIds()).toEqual([]);
    await expect(service.submitOtp('app-1', A2, '123456')).resolves.toMatchObject({ outcome: 'NOT_SENT', code: 'SESSION_NOT_FOUND' });
    expect(mocked.submitOtp).not.toHaveBeenCalled();
  });

  it('keeps the session after an invalid OTP and closes it after an accepted one', async () => {
    await ready();
    mocked.confirmSubmit.mockResolvedValue({ outcome: 'AWAITING_OTP' });
    await service.confirmSubmit('app-1', A1, false);
    mocked.submitOtp.mockResolvedValueOnce({ outcome: 'OTP_INVALID' });
    await expect(service.submitOtp('app-1', A2, '000000')).resolves.toMatchObject({ outcome: 'OTP_INVALID' });
    expect(manager.listLiveIds()).toEqual(['app-1']);
    mocked.submitOtp.mockResolvedValueOnce({ outcome: 'SENT_OBSERVED' });
    const A3 = '33333333-3333-4333-8333-333333333333';
    await expect(service.submitOtp('app-1', A3, '123456')).resolves.toMatchObject({ outcome: 'SENT_OBSERVED' });
    expect(manager.listLiveIds()).toEqual([]);
  });

  it('refuses OTP before the final control was activated', async () => {
    await ready();
    await expect(service.submitOtp('app-1', A1, '123456')).resolves.toMatchObject({ outcome: 'NOT_SENT', code: 'NOT_AWAITING_OTP' });
    expect(mocked.submitOtp).not.toHaveBeenCalled();
  });

  it('refuses a second create for the same application while the first browser is still launching', async () => {
    let release!: () => void;
    service.launchBrowser = () => new Promise((resolve) => {
      release = () => {
        const b = fakeBrowser();
        browsers.push(b);
        resolve(b);
      };
    });
    const first = service.launchAndFill('app-1', APPLY_URL, {}, AUTHORITY);
    await expect(service.launchAndFill('app-1', APPLY_URL, {}, AUTHORITY)).rejects.toThrow(ConflictException);
    release();
    await first;
    expect(browsers).toHaveLength(1);
    expect(manager.listLiveIds()).toEqual(['app-1']);
    // The slot of a failed launch is returned.
    service.launchBrowser = async () => { throw new Error('no chromium'); };
    await expect(service.launchAndFill('app-2', APPLY_URL, {}, AUTHORITY)).resolves.toMatchObject({ status: 'FAILED' });
    expect(manager.canAcquire()).toBe(true);
    expect(manager.has('app-2')).toBe(false);
  });

  it('reports an exception during a live send as possibly sent, and never activates again', async () => {
    await ready();
    mocked.confirmSubmit.mockRejectedValueOnce(new Error('target closed'));
    await expect(service.confirmSubmit('app-1', A1, false)).resolves.toEqual({ attemptId: A1, outcome: 'SENT_OBSERVED', code: 'WORKER_EXCEPTION' });
    expect(manager.listLiveIds()).toEqual([]);
    await expect(service.confirmSubmit('app-1', A1, false)).resolves.toMatchObject({ outcome: 'SENT_OBSERVED' });
    expect(mocked.confirmSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not send while candidate answers are still being written to the page', async () => {
    await ready();
    let finish!: (v: any) => void;
    mocked.applyAnswers.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const editing = service.applyAnswers('app-1', [{ fieldKey: 'questions.0.answer', value: 'Bəli' }]);
    await new Promise((r) => setImmediate(r));
    await expect(service.confirmSubmit('app-1', A1, false)).resolves.toEqual({ attemptId: A1, outcome: 'NOT_SENT', code: 'SESSION_BUSY' });
    await expect(service.applyAnswers('app-1', [])).rejects.toThrow(ConflictException);
    finish({ status: 'READY_FOR_REVIEW', missingFields: [] });
    await editing;
    expect(mocked.confirmSubmit).not.toHaveBeenCalled();
    expect(manager.listLiveIds()).toEqual(['app-1']);
    mocked.confirmSubmit.mockResolvedValue({ outcome: 'SENT_OBSERVED' });
    await expect(service.confirmSubmit('app-1', A2, false)).resolves.toMatchObject({ outcome: 'SENT_OBSERVED' });
  });

  it('stops an OTP when the live gate is switched off mid-session, keeping the session', async () => {
    await ready();
    mocked.confirmSubmit.mockResolvedValue({ outcome: 'AWAITING_OTP' });
    await service.confirmSubmit('app-1', A1, false);
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'false';
    await expect(service.submitOtp('app-1', A2, '123456')).resolves.toEqual({ attemptId: A2, outcome: 'NOT_SENT', code: 'WORKER_GATE_OFF' });
    expect(mocked.submitOtp).not.toHaveBeenCalled();
    expect(manager.listLiveIds()).toEqual(['app-1']);
  });

  it('never sweeps a session that has an attempt in flight', async () => {
    process.env.EXTERNAL_APPLY_SESSION_TTL_MS = '1';
    try {
      await ready();
      let finish!: (v: any) => void;
      mocked.confirmSubmit.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
      const sending = service.confirmSubmit('app-1', A1, false);
      await new Promise((r) => setTimeout(r, 5));
      await expect(manager.sweepExpired()).resolves.toEqual([]);
      finish({ outcome: 'SENT_OBSERVED' });
      await sending;
      expect(browsers[0].close).toHaveBeenCalled();
    } finally {
      delete process.env.EXTERNAL_APPLY_SESSION_TTL_MS;
    }
  });

  it('does not let an attempt id be replayed against another application', async () => {
    await ready();
    mocked.confirmSubmit.mockResolvedValue({ outcome: 'REJECTED' });
    await service.confirmSubmit('app-1', A1, false);
    await expect(service.confirmSubmit('app-2', A1, false)).rejects.toThrow(ConflictException);
  });
});
