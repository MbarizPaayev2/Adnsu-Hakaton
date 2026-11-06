import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ExternalApplyService } from './external-apply.service';
import { PrismaService } from '../database/database.service';
import { LocalStorageService } from '../resumes/local-storage.service';
import { ApplyWorkerClient, ApplyWorkerError } from './apply-worker.client';
import { PostHogService } from '../common/posthog.service';
import { ExternalDestination, ExternalDestinationRegistry, GLORRI_DESTINATION, noticeFingerprint } from './destinations';
import { FeatureFlagsService } from '../operations/feature-flags.service';

// Unit coverage of the gate/consent checks and the worker-reply → state
// mapping. Database concurrency (claims, replays, races) is covered against
// real Postgres in test/external-apply.e2e-spec.ts.

const NOTICE = { url: 'https://jobs.glorri.com/privacy', version: 'fixture-1', declarationText: 'Sintetik bəyanat' };
const FIXTURE: ExternalDestination = {
  ...GLORRI_DESTINATION,
  notice: NOTICE,
  receipt: { textPattern: /Müraciət nömrəsi:\s*([A-Z0-9-]+)/, rejectionPattern: /Müraciətiniz qəbul edilmədi/ },
};
class FixtureRegistry extends ExternalDestinationRegistry {
  protected readonly destinations = [FIXTURE];
}
const NOTICE_HASH = noticeFingerprint(NOTICE.declarationText, NOTICE.url);
const APPLY_URL = 'https://jobs.glorri.com/vacancies/acme/backend-dev/apply';
const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const SHA = 'c'.repeat(64);

const JOB = { id: 'job-1', status: 'ACTIVE', deadline: null, externalId: 'glorri:1', url: 'https://jobs.glorri.com/vacancies/acme/backend-dev', rawPayload: { slug: 'backend-dev', company: { slug: 'acme' } } };
const APP = {
  id: 'ext-1', matchId: 'match-1', userId: 'user-1', status: 'READY_FOR_REVIEW', applyUrl: APPLY_URL,
  destinationKey: 'glorri', destinationHost: 'jobs.glorri.com', reviewVersion: 3, otpAttempts: 0, dryRun: false,
  cvSnapshotUrl: '/uploads/snap.docx', cvSnapshotSha256: SHA, idDocumentSnapshotUrl: null,
  sessionExpiresAt: new Date(Date.now() + 600_000),
};
const CONSENT = {
  id: 'consent-1', userId: 'user-1', jobId: 'job-1', destinationHost: 'jobs.glorri.com', applyUrl: APPLY_URL,
  noticeHash: NOTICE_HASH, noticeVersion: NOTICE.version, revokedAt: null,
  approvedDocuments: [{ kind: 'CV', sha256: SHA }], disclosure: { fields: {}, motivationLetter: 'x'.repeat(30) },
};

describe('ExternalApplyService', () => {
  const env = { ...process.env };
  let service: ExternalApplyService;
  let prisma: any;
  let tx: any;
  let worker: Record<string, jest.Mock>;
  let storage: Record<string, jest.Mock>;
  let app: any;
  let consent: any;
  let flags: { isPaused: jest.Mock };

  beforeEach(async () => {
    process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'true';
    process.env.EXTERNAL_APPLY_PILOT_USER_IDS = 'user-1';
    delete process.env.ENABLE_SANDBOX;
    app = { ...APP };
    flags = { isPaused: jest.fn().mockResolvedValue(false) };
    consent = { ...CONSENT };
    worker = {
      createSession: jest.fn(), submitAnswers: jest.fn(), confirmSubmit: jest.fn(), submitOtp: jest.fn(),
      getScreenshot: jest.fn(), deleteSession: jest.fn().mockResolvedValue({ ok: true }), listLiveIds: jest.fn(),
    };
    storage = { sha256: jest.fn().mockResolvedValue(SHA), copyFile: jest.fn(), deleteFile: jest.fn(), uploadBuffer: jest.fn(), resolveForRead: jest.fn() };
    tx = {
      $queryRaw: jest.fn(),
      externalApplication: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      externalApplicationAttempt: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((fn: any) => fn(tx)),
      match: { findUnique: jest.fn().mockResolvedValue({ id: 'match-1', userId: 'user-1', job: JOB }), findMany: jest.fn(), update: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'c@example.com', subscription: { plan: 'Limitsiz', status: 'active', currentPeriodEnd: null } }) },
      externalApplication: {
        findUnique: jest.fn(async () => app),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      externalApplicationConsent: { findFirst: jest.fn(async () => consent), updateMany: jest.fn() },
      externalApplicationAnswer: { findMany: jest.fn().mockResolvedValue([]) },
      externalApplicationAttempt: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        ExternalApplyService,
        { provide: PrismaService, useValue: prisma },
        { provide: LocalStorageService, useValue: storage },
        { provide: ApplyWorkerClient, useValue: worker },
        { provide: PostHogService, useValue: { capture: jest.fn() } },
        { provide: ExternalDestinationRegistry, useValue: new FixtureRegistry() },
        { provide: FeatureFlagsService, useValue: flags },
        { provide: getQueueToken('external-apply'), useValue: { add: jest.fn() } },
      ],
    }).compile();
    service = module.get(ExternalApplyService);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  const confirm = (over: Record<string, unknown> = {}) =>
    service.confirmSubmit('ext-1', 'user-1', { attemptId: ATTEMPT, reviewVersion: 3, ...over } as any);
  /** The state the settle step wrote (the last row update for this attempt). */
  const settled = () => {
    const call = prisma.externalApplication.updateMany.mock.calls.find((c: any[]) => c[0].where.activeAttemptId === ATTEMPT);
    return call?.[1] ?? call?.[0].data;
  };
  const attemptRecord = () => prisma.externalApplicationAttempt.update.mock.calls[0]?.[0].data;

  describe('listMine', () => {
    it("shows a receipt reference only for a validated receipt, scoped to the candidate, without cancelled rows", async () => {
      prisma.externalApplication.findMany.mockResolvedValue([
        { id: 'a', status: 'SUBMITTED', receiptReference: 'FX-1', destinationKey: 'glorri', dryRun: false, createdAt: new Date(), submittedAt: new Date(), match: { id: 'm1', job: JOB } },
        { id: 'b', status: 'DELIVERY_UNCONFIRMED', receiptReference: 'LEAKED', destinationKey: 'glorri', dryRun: false, createdAt: new Date(), submittedAt: null, match: { id: 'm2', job: JOB } },
      ]);
      const rows = await service.listMine('user-1');
      const where = prisma.externalApplication.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ userId: 'user-1', status: { not: 'CANCELLED' } });
      expect(rows[0]).toMatchObject({ id: 'a', receiptConfirmed: true, receiptReference: 'FX-1', matchId: 'm1' });
      expect(rows[1]).toMatchObject({ id: 'b', receiptConfirmed: false, receiptReference: null });
      expect(rows[0]).not.toHaveProperty('cvSnapshotUrl');
    });
  });

  describe('gates and authority at final submit', () => {
    it.each([
      ['operator paused submissions', () => { flags.isPaused.mockResolvedValue(true); }, ForbiddenException, 'OPERATOR_PAUSED'],
      ['live gate off', () => { process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'false'; }, ForbiddenException, 'LIVE_GATE_OFF'],
      ['not a pilot user', () => { process.env.EXTERNAL_APPLY_PILOT_USER_IDS = ''; }, ForbiddenException, 'NOT_PILOT'],
      ['plan downgraded', () => { prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'c@example.com', subscription: { plan: 'FREE' } }); }, ForbiddenException, 'PLAN_REQUIRED'],
      ['vacancy closed', () => { prisma.match.findUnique.mockResolvedValue({ id: 'match-1', userId: 'user-1', job: { ...JOB, status: 'CLOSED' } }); }, BadRequestException, 'NOT_ACTIONABLE'],
      ['consent absent', () => { consent = null; }, ConflictException, 'CONSENT_MISSING'],
      ['consent revoked', () => { consent = { ...CONSENT, revokedAt: new Date() }; }, ConflictException, 'CONSENT_REVOKED'],
      ['consent for another vacancy', () => { consent = { ...CONSENT, jobId: 'job-2' }; }, ConflictException, 'CONSENT_MISSING'],
      ['notice changed since consent', () => { consent = { ...CONSENT, noticeHash: 'd'.repeat(64) }; }, ConflictException, 'NOTICE_CHANGED'],
      ['destination changed since consent', () => { consent = { ...CONSENT, applyUrl: 'https://jobs.glorri.az/vacancies/acme/backend-dev/apply' }; }, ConflictException, 'DESTINATION_CHANGED'],
      ['destination host not allowlisted', () => { app = { ...APP, destinationHost: 'evil.example', applyUrl: 'https://evil.example/vacancies/a/b/apply' }; }, BadRequestException, 'DESTINATION_NOT_ALLOWED'],
    ])('refuses (%s) before persisting an attempt or contacting the worker', async (_label, arrange, type, reason) => {
      arrange();
      const error = await confirm().catch((e) => e);
      expect(error).toBeInstanceOf(type);
      expect(error.getResponse()).toMatchObject({ reason });
      expect(tx.externalApplicationAttempt.create).not.toHaveBeenCalled();
      expect(worker.confirmSubmit).not.toHaveBeenCalled();
    });

    it("hides another user's application", async () => {
      app = { ...APP, userId: 'user-2' };
      await expect(confirm()).rejects.toBeInstanceOf(NotFoundException);
      expect(worker.confirmSubmit).not.toHaveBeenCalled();
    });

    it('refuses a confirm for a review version the candidate did not see', async () => {
      const error = await confirm({ reviewVersion: 2 }).catch((e) => e);
      expect(error.getResponse()).toMatchObject({ reason: 'REVIEW_CHANGED' });
      expect(worker.confirmSubmit).not.toHaveBeenCalled();
    });

    it('expires a session whose TTL has passed instead of sending', async () => {
      app = { ...APP, sessionExpiresAt: new Date(Date.now() - 1000) };
      const error = await confirm().catch((e) => e);
      expect(error.getResponse()).toMatchObject({ reason: 'SESSION_EXPIRED' });
      expect(prisma.externalApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) }));
      expect(worker.confirmSubmit).not.toHaveBeenCalled();
    });

    it('refuses when the approved CV snapshot no longer has the approved bytes', async () => {
      storage.sha256.mockResolvedValue('e'.repeat(64));
      await expect(confirm()).rejects.toBeInstanceOf(ConflictException);
      expect(worker.confirmSubmit).not.toHaveBeenCalled();
    });

    it('refuses a dry run when the sandbox is off rather than sending for real', async () => {
      await expect(confirm({ dryRun: true })).rejects.toBeInstanceOf(BadRequestException);
      expect(worker.confirmSubmit).not.toHaveBeenCalled();
    });

    it('enforces the daily send limit inside the claim transaction', async () => {
      tx.externalApplicationAttempt.count.mockResolvedValue(5);
      await expect(confirm()).rejects.toMatchObject({ status: 429 });
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.externalApplicationAttempt.create).not.toHaveBeenCalled();
      expect(worker.confirmSubmit).not.toHaveBeenCalled();
    });

    it('persists the attempt before the worker is contacted', async () => {
      const order: string[] = [];
      tx.externalApplicationAttempt.create.mockImplementation(async () => { order.push('persist'); });
      worker.confirmSubmit.mockImplementation(async () => { order.push('worker'); return { attemptId: ATTEMPT, outcome: 'SENT_OBSERVED' }; });
      await confirm();
      expect(order).toEqual(['persist', 'worker']);
      expect(tx.externalApplicationAttempt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: ATTEMPT, status: 'IN_FLIGHT', kind: 'CONFIRM' }) });
    });
  });

  describe('worker reply → truthful state', () => {
    const receiptPage = { url: 'https://jobs.glorri.com/done', text: 'Müraciət nömrəsi: GL-2026-0001' };
    it.each([
      ['validated receipt', { attemptId: ATTEMPT, outcome: 'SENT_OBSERVED', observation: receiptPage }, 'SUBMITTED', 'RECEIPT_CONFIRMED'],
      ['observed page without a receipt', { attemptId: ATTEMPT, outcome: 'SENT_OBSERVED', observation: { url: receiptPage.url, text: 'Təşəkkürlər' } }, 'DELIVERY_UNCONFIRMED', 'NO_RECEIPT_EVIDENCE'],
      ['receipt text on a foreign host', { attemptId: ATTEMPT, outcome: 'SENT_OBSERVED', observation: { ...receiptPage, url: 'https://evil.example/done' } }, 'DELIVERY_UNCONFIRMED', 'NO_RECEIPT_EVIDENCE'],
      ['forged "RECEIVED" outcome', { attemptId: ATTEMPT, outcome: 'RECEIVED', observation: receiptPage }, 'DELIVERY_UNCONFIRMED', 'MALFORMED_WORKER_RESPONSE'],
      ['reply for another attempt', { attemptId: '22222222-2222-4222-8222-222222222222', outcome: 'SENT_OBSERVED', observation: receiptPage }, 'DELIVERY_UNCONFIRMED', 'MALFORMED_WORKER_RESPONSE'],
      ['error text after activation', { attemptId: ATTEMPT, outcome: 'REJECTED', code: 'DESTINATION_ERROR_TEXT' }, 'DELIVERY_UNCONFIRMED', 'DESTINATION_ERROR_OBSERVED'],
      ['undocumented error page', { attemptId: ATTEMPT, outcome: 'REJECTED', observation: { url: receiptPage.url, text: 'Xəta baş verdi' } }, 'DELIVERY_UNCONFIRMED', 'DESTINATION_ERROR_OBSERVED'],
      ['documented refusal on a foreign host', { attemptId: ATTEMPT, outcome: 'REJECTED', observation: { url: 'https://evil.example/x', text: 'Müraciətiniz qəbul edilmədi' } }, 'DELIVERY_UNCONFIRMED', 'DESTINATION_ERROR_OBSERVED'],
      ['documented refusal observed as a plain page', { attemptId: ATTEMPT, outcome: 'SENT_OBSERVED', observation: { url: receiptPage.url, text: 'Müraciətiniz qəbul edilmədi' } }, 'FAILED', 'DESTINATION_REJECTED'],
      ['documented refusal', { attemptId: ATTEMPT, outcome: 'REJECTED', observation: { url: receiptPage.url, text: 'Müraciətiniz qəbul edilmədi: vakansiya bağlanıb' } }, 'FAILED', 'DESTINATION_REJECTED'],
      ['CAPTCHA raised by the click', { attemptId: ATTEMPT, outcome: 'SENT_OBSERVED', code: 'MANUAL_INTERVENTION_REQUIRED', observation: { url: receiptPage.url, text: 'Mən robot deyiləm' } }, 'DELIVERY_UNCONFIRMED', 'CHALLENGE_AFTER_SEND'],
      ['CAPTCHA before activation', { attemptId: ATTEMPT, outcome: 'NOT_SENT', code: 'MANUAL_INTERVENTION_REQUIRED' }, 'FAILED', 'MANUAL_INTERVENTION_REQUIRED'],
      ['OTP requested', { attemptId: ATTEMPT, outcome: 'AWAITING_OTP' }, 'AWAITING_OTP', 'OTP_REQUIRED'],
      ['worker gate off', { attemptId: ATTEMPT, outcome: 'NOT_SENT', code: 'WORKER_GATE_OFF' }, 'READY_FOR_REVIEW', 'WORKER_GATE_OFF'],
      ['answers still being written', { attemptId: ATTEMPT, outcome: 'NOT_SENT', code: 'SESSION_BUSY' }, 'READY_FOR_REVIEW', 'SESSION_BUSY'],
      ['worker lost the session', { attemptId: ATTEMPT, outcome: 'NOT_SENT', code: 'SESSION_NOT_FOUND' }, 'EXPIRED', 'SESSION_NOT_FOUND'],
      ['control missing', { attemptId: ATTEMPT, outcome: 'NOT_SENT', code: 'CONFIRM_CONTROL_MISSING' }, 'FAILED', 'CONFIRM_CONTROL_MISSING'],
      ['dry-run outcome on a real send', { attemptId: ATTEMPT, outcome: 'DRY_RUN_COMPLETE' }, 'DELIVERY_UNCONFIRMED', 'INCONSISTENT_WORKER_OUTCOME'],
    ])('%s', async (_label, reply, status, reason) => {
      worker.confirmSubmit.mockResolvedValue(reply);
      await confirm();
      expect(settled()).toMatchObject({ status, stateReason: reason });
      if (status === 'SUBMITTED') {
        expect(settled()).toMatchObject({ receiptReference: 'GL-2026-0001', receiptEvidence: { method: 'receipt-contract', urlPath: '/done' } });
        expect(JSON.stringify(settled())).not.toContain('Müraciət nömrəsi');
        expect(prisma.match.update).toHaveBeenCalledWith({ where: { id: 'match-1' }, data: { status: 'APPLIED' } });
      } else {
        expect(settled().receiptReference).toBeUndefined();
        expect(prisma.match.update).not.toHaveBeenCalled();
      }
    });

    it.each([
      ['timeout / reset (may have been sent)', new ApplyWorkerError('UNKNOWN', 'confirm-submit'), 'DELIVERY_UNCONFIRMED', 'UNCONFIRMED'],
      ['worker 500 after its handler ran', new ApplyWorkerError('HTTP', 'confirm-submit', 500), 'DELIVERY_UNCONFIRMED', 'UNCONFIRMED'],
      ['worker 409 (attempt already in flight or spent)', new ApplyWorkerError('HTTP', 'confirm-submit', 409), 'DELIVERY_UNCONFIRMED', 'UNCONFIRMED'],
      ['proxy 504', new ApplyWorkerError('HTTP', 'confirm-submit', 504), 'DELIVERY_UNCONFIRMED', 'UNCONFIRMED'],
      ['proxy 408', new ApplyWorkerError('HTTP', 'confirm-submit', 408), 'DELIVERY_UNCONFIRMED', 'UNCONFIRMED'],
      ['connection refused (never delivered)', new ApplyWorkerError('NOT_DELIVERED', 'confirm-submit'), 'READY_FOR_REVIEW', 'NOT_SENT'],
      ['worker auth/validation refusal', new ApplyWorkerError('HTTP', 'confirm-submit', 401), 'READY_FOR_REVIEW', 'NOT_SENT'],
      ['worker 404 session', new ApplyWorkerError('HTTP', 'confirm-submit', 404), 'EXPIRED', 'NOT_SENT'],
    ])('%s', async (_label, error, status, attemptStatus) => {
      worker.confirmSubmit.mockRejectedValue(error);
      await confirm();
      expect(settled()).toMatchObject({ status });
      expect(attemptRecord()).toMatchObject({ status: attemptStatus });
      expect(worker.confirmSubmit).toHaveBeenCalledTimes(1);
    });

    it('treats a dry run that reports a live outcome as a violation, never as success', async () => {
      process.env.ENABLE_SANDBOX = 'true';
      worker.confirmSubmit.mockResolvedValue({ attemptId: ATTEMPT, outcome: 'SENT_OBSERVED', observation: receiptPage });
      await confirm({ dryRun: true });
      expect(settled()).toMatchObject({ status: 'DELIVERY_UNCONFIRMED', stateReason: 'DRY_RUN_VIOLATION' });
    });

    it('records a completed rehearsal as a dry run only', async () => {
      process.env.ENABLE_SANDBOX = 'true';
      worker.confirmSubmit.mockResolvedValue({ attemptId: ATTEMPT, outcome: 'DRY_RUN_COMPLETE' });
      await confirm({ dryRun: true });
      expect(worker.confirmSubmit).toHaveBeenCalledWith('ext-1', { attemptId: ATTEMPT, dryRun: true });
      expect(settled()).toMatchObject({ status: 'SUBMITTED_DRY_RUN' });
      // A rehearsal does not count against the daily real-send limit.
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('OTP', () => {
    const otp = (code = '123456') => service.submitOtp('ext-1', 'user-1', { attemptId: ATTEMPT, code });
    beforeEach(() => {
      app = { ...APP, status: 'AWAITING_OTP' };
    });

    it('never forwards an OTP for a dry-run application', async () => {
      app = { ...app, dryRun: true };
      await expect(otp()).rejects.toBeInstanceOf(ConflictException);
      expect(worker.submitOtp).not.toHaveBeenCalled();
    });

    it('stops when the live gate was switched off after the code was requested', async () => {
      process.env.EXTERNAL_APPLY_LIVE_ENABLED = 'false';
      await expect(otp()).rejects.toBeInstanceOf(ForbiddenException);
      expect(worker.submitOtp).not.toHaveBeenCalled();
    });

    it('keeps an invalid code retryable and ends after the attempt limit', async () => {
      worker.submitOtp.mockResolvedValue({ attemptId: ATTEMPT, outcome: 'OTP_INVALID' });
      await otp('000000');
      expect(settled()).toMatchObject({ status: 'AWAITING_OTP', stateReason: 'OTP_INVALID' });
      prisma.externalApplication.updateMany.mockClear();
      app = { ...app, otpAttempts: 4 };
      await otp('000001');
      expect(settled()).toMatchObject({ status: 'FAILED', stateReason: 'OTP_ATTEMPTS_EXHAUSTED' });
    });

    it('marks an OTP timeout as unconfirmed', async () => {
      worker.submitOtp.mockRejectedValue(new ApplyWorkerError('UNKNOWN', 'otp'));
      await otp();
      expect(settled()).toMatchObject({ status: 'DELIVERY_UNCONFIRMED' });
    });
  });

  describe('capabilities', () => {
    it('offers Glorri only as assisted apply while its notice is not captured', async () => {
      const module = await Test.createTestingModule({
        providers: [
          ExternalApplyService,
          { provide: PrismaService, useValue: prisma },
          { provide: LocalStorageService, useValue: storage },
          { provide: ApplyWorkerClient, useValue: worker },
          { provide: PostHogService, useValue: { capture: jest.fn() } },
          ExternalDestinationRegistry,
          { provide: FeatureFlagsService, useValue: flags },
        { provide: getQueueToken('external-apply'), useValue: { add: jest.fn() } },
        ],
      }).compile();
      prisma.match.findMany.mockResolvedValue([{ id: 'match-1', userId: 'user-1', job: JOB }]);
      await expect(module.get(ExternalApplyService).capabilities('user-1', ['match-1'])).resolves.toEqual({
        'match-1': {
          available: false,
          reason: 'NOTICE_NOT_CAPTURED',
          message: expect.stringContaining('Mənbə saytda'),
          // What Glorri itself can do, and where to apply yourself instead.
          destination: {
            key: 'glorri', displayName: 'Glorri (jobs.glorri)', preparation: 'NOTICE_NOT_CAPTURED',
            receipt: 'NOT_VERIFIABLE', rejection: 'NOT_DETECTABLE', identityDocumentRequired: true,
          },
          applyYourselfUrl: 'https://jobs.glorri.com/vacancies/acme/backend-dev',
        },
      });
    });

    it('never offers an apply-yourself link off the destination or over http', async () => {
      prisma.externalApplication.findMany.mockResolvedValue([]);
      for (const url of ['http://jobs.glorri.com/vacancies/acme/x', 'https://evil.example/vacancies/acme/x', 'javascript:alert(1)', null]) {
        prisma.match.findMany.mockResolvedValue([{ id: 'match-1', userId: 'user-1', job: { ...JOB, url } }]);
        const caps = await service.capabilities('user-1', ['match-1']);
        expect(caps['match-1'].applyYourselfUrl).toBeNull();
        expect(caps['match-1'].destination?.key).toBe('glorri');
      }
    });

    it('says nothing about destinations for a posting no destination handles', async () => {
      prisma.externalApplication.findMany.mockResolvedValue([]);
      prisma.match.findMany.mockResolvedValue([{ id: 'match-1', userId: 'user-1', job: { ...JOB, externalId: 'aise:native-1' } }]);
      const caps = await service.capabilities('user-1', ['match-1']);
      expect(caps['match-1']).toMatchObject({ available: false, reason: 'UNSUPPORTED_SOURCE' });
      expect(caps['match-1'].destination).toBeUndefined();
      expect(caps['match-1'].applyYourselfUrl).toBeUndefined();
    });

    it('treats an application cancelled while awaiting its OTP as possibly sent', async () => {
      prisma.match.findMany.mockResolvedValue([{ id: 'match-1', userId: 'user-1', job: JOB }]);
      prisma.externalApplication.findMany.mockResolvedValue([{ id: 'ext-1', matchId: 'match-1', status: 'CANCELLED', stateReason: 'CANCELLED_AFTER_SEND_PENDING_OTP' }]);
      await expect(service.capabilities('user-1', ['match-1'])).resolves.toMatchObject({ 'match-1': { available: false, reason: 'ALREADY_SENT' } });
    });

    it('reports an earlier possibly-sent application instead of offering another', async () => {
      prisma.match.findMany.mockResolvedValue([{ id: 'match-1', userId: 'user-1', job: JOB }]);
      prisma.externalApplication.findMany.mockResolvedValue([{ id: 'ext-1', matchId: 'match-1', status: 'DELIVERY_UNCONFIRMED' }]);
      await expect(service.capabilities('user-1', ['match-1'])).resolves.toMatchObject({
        'match-1': { available: false, reason: 'ALREADY_SENT', applicationStatus: 'DELIVERY_UNCONFIRMED' },
      });
    });
  });
});
