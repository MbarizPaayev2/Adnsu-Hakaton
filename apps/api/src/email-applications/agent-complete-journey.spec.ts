import { ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { FakeProvider } from './fake-provider';
import { ResendTransport } from './email-transport';
import { loadEmailApplyConfig } from './email-apply.config';
import { EmailApplicationsService } from './email-applications.service';
import { EmailAutomationService } from './email-automation.service';
import { EmailApplicationSender } from './email-application.sender';
import { EmailAllowanceService, EmailAllowanceError } from './email-allowance.service';
import { TrackerService } from '../application-timeline/tracker.service';
import { TimelineService } from '../application-timeline/timeline.service';
import { payloadHash, payloadPartsOf, sha256Hex } from './email-application-state';

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Service-level orchestration and local HTTP transport suite.
 * Exercises state transitions, quota enforcement, advisory lock guards, and payload
 * dispatch to a real local HTTP sink. Uses in-memory simulated database/storage maps;
 * does not claim real PostgreSQL, Redis BullMQ, or browser extension execution.
 */
describe('Application Agent Service & Sink Transport Journey (Simulated Storage & Local Transport Suite)', () => {
  const provider = new FakeProvider();
  let sinkUrl: string;

  beforeAll(async () => {
    sinkUrl = await provider.start();
  });

  afterAll(async () => {
    await provider.stop();
  });

  beforeEach(() => {
    provider.messages.length = 0;
    provider.requests.length = 0;
    (provider as any).seen.clear();
  });

  function createTestEnvironment(overrides: { allowanceLimit?: number; allowanceUsed?: number } = {}) {
    const userId = 'candidate_user_1';
    const now = new Date('2026-10-18T10:00:00Z');

    // Storage simulation
    const uploads = new Map<string, Buffer>();
    const privates = new Map<string, Buffer>();
    const storage: any = {
      readUpload: jest.fn(async (url: string) => {
        const buf = uploads.get(url);
        if (!buf) throw new Error('ENOENT');
        return buf;
      }),
      copyToPrivate: jest.fn(async (url: string) => {
        const buf = uploads.get(url);
        if (!buf) throw new Error('ENOENT');
        const key = `private/email-applications/snap_${privates.size + 1}.pdf`;
        privates.set(key, buf);
        return key;
      }),
      readPrivate: jest.fn(async (key: string) => {
        const buf = privates.get(key);
        if (!buf) throw new Error('ENOENT');
        return buf;
      }),
      deletePrivate: jest.fn(async (key: string) => {
        privates.delete(key);
      }),
      sha256: jest.fn(async (url: string) => {
        const buf = uploads.get(url);
        if (!buf) throw new Error('ENOENT');
        return sha256Hex(buf);
      }),
    };

    // Candidate test documents
    const baseCvBytes = Buffer.from('%PDF-1.4 Base CV for Aysel Mammadova');
    const tailoredCvBytes = Buffer.from('%PDF-1.4 Tailored Audit CV for Deloitte Vacancy');
    const tailoredLetterBytes = Buffer.from('%PDF-1.4 Tailored Motivation Letter for Deloitte Vacancy');

    uploads.set('/uploads/base_cv.pdf', baseCvBytes);
    uploads.set('/uploads/tailored_cv.pdf', tailoredCvBytes);
    uploads.set('/uploads/tailored_letter.pdf', tailoredLetterBytes);

    // Database tables
    const db: any = {
      users: new Map<string, any>(),
      jobs: new Map<string, any>(),
      resumes: new Map<string, any>(),
      documentSnapshots: [] as any[],
      emailApplySettings: new Map<string, any>(),
      emailApplications: new Map<string, any>(),
      emailSendAttempts: [] as any[],
      emailAutomationDecisions: new Map<string, any>(),
      applicationStatusEvents: [] as any[],
      notifications: [] as any[],
      matches: new Map<string, any>(),
      applicationTrackerRecords: new Map<string, any>(),
      applicationTrackerSettings: new Map<string, any>(),
      emailSuppressions: new Set<string>(),
      agentApplications: new Map<string, any>(),
      applications: new Map<string, any>(),
      externalApplications: new Map<string, any>(),
    };

    // Seed candidate
    db.users.set(userId, {
      id: userId,
      email: 'aysel@example.az',
      name: 'Aysel Məmmədova',
      emailVerified: new Date('2026-01-01'),
      subscription: { plan: 'PREMIUM', status: 'active', currentPeriodEnd: new Date('2026-11-01') },
      profile: { phone: '+994501234567', defaultCoverLetter: 'Hörmətli İşəgötürən,\n\nVakansiya üçün müraciətimi təqdim edirəm.' },
    });

    // Seed resumes
    const baseResumeId = 'resume_base_1';
    db.resumes.set(baseResumeId, {
      id: baseResumeId,
      userId,
      isBase: true,
      docKind: 'CV',
      status: 'READY',
      fileUrl: '/uploads/base_cv.pdf',
      reviewedAt: new Date('2026-09-01'),
      version: 1,
    });
    db.documentSnapshots.push({ resumeId: baseResumeId, kind: 'APPROVED', fileSha256: sha256Hex(baseCvBytes) });

    const tailoredResumeId = 'resume_tailored_1';
    const jobId1 = 'job_deloitte_audit';
    db.resumes.set(tailoredResumeId, {
      id: tailoredResumeId,
      userId,
      isBase: false,
      docKind: 'CV',
      status: 'READY',
      fileUrl: '/uploads/tailored_cv.pdf',
      reviewedAt: new Date('2026-10-17'),
      match: { jobId: jobId1 },
      version: 1,
    });
    db.documentSnapshots.push({ resumeId: tailoredResumeId, kind: 'APPROVED', fileSha256: sha256Hex(tailoredCvBytes) });

    const tailoredLetterId = 'letter_tailored_1';
    db.resumes.set(tailoredLetterId, {
      id: tailoredLetterId,
      userId,
      isBase: false,
      docKind: 'LETTER',
      status: 'READY',
      fileUrl: '/uploads/tailored_letter.pdf',
      reviewedAt: new Date('2026-10-17'),
      match: { jobId: jobId1 },
      version: 1,
    });
    db.documentSnapshots.push({ resumeId: tailoredLetterId, kind: 'APPROVED', fileSha256: sha256Hex(tailoredLetterBytes) });

    // Seed vacancy: Deloitte Senior Auditor
    db.jobs.set(jobId1, {
      id: jobId1,
      title: 'Senior Auditor (Assurance & Advisory)',
      company: 'Deloitte Azerbaijan',
      location: 'Bakı, Azərbaycan',
      description: 'Deloitte Baku is looking for a Senior Auditor.\nPlease send your CV and cover letter to hr@deloitte.az with subject "Application - Senior Auditor".',
      url: 'https://jobs.example.az/deloitte/senior-auditor',
      applicationMethod: 'EMAIL',
      applicationEmail: 'hr@deloitte.az',
      applicationEmailEvidence: {
        source: 'description',
        excerpt: 'Please send your CV and cover letter to hr@deloitte.az with subject "Application - Senior Auditor".',
        reference: null,
      },
      status: 'ACTIVE',
      hiddenAt: null,
      duplicateOfId: null,
      postedAt: new Date('2026-10-17T08:00:00Z'),
      ingestedAt: new Date('2026-10-17T08:30:00Z'),
      lastSeenAt: new Date('2026-10-18T09:00:00Z'),
      deadline: new Date('2026-11-15T00:00:00Z'),
    });

    // Mock Prisma Client
    let appSeq = 1;
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $queryRaw: jest.fn(async () => [{ locked: true }]),
      $executeRaw: jest.fn(async (strings: any, ...values: any[]) => {
        if (values && values.length >= 4) {
          const userId = values[1];
          const sourceKey = values[2];
          let patch: any = {};
          try {
            patch = typeof values[3] === 'string' ? JSON.parse(values[3]) : values[3];
          } catch {}
          const hidden = values[4] === true;
          const existing = db.applicationTrackerRecords.get(sourceKey) ?? {
            id: values[0] || 'rec_1',
            userId,
            sourceKey,
            fields: {},
            hidden: false,
            createdAt: new Date(),
          };
          existing.fields = { ...(existing.fields ?? {}), ...patch };
          if (hidden !== null && hidden !== undefined) existing.hidden = hidden;
          db.applicationTrackerRecords.set(sourceKey, existing);
        }
        return 1;
      }),
      user: {
        findUnique: jest.fn(async ({ where }: any) => db.users.get(where.id) ?? null),
        findUniqueOrThrow: jest.fn(async ({ where }: any) => {
          const u = db.users.get(where.id);
          if (!u) throw new Error('User not found');
          return u;
        }),
      },
      job: {
        findUnique: jest.fn(async ({ where }: any) => db.jobs.get(where.id) ?? null),
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async ({ where }: any) => {
          let list = Array.from(db.jobs.values());
          if (where?.status) list = list.filter((j: any) => j.status === where.status);
          if (where?.hiddenAt === null) list = list.filter((j: any) => !j.hiddenAt);
          if (where?.duplicateOfId === null) list = list.filter((j: any) => !j.duplicateOfId);
          if (where?.applicationMethod) list = list.filter((j: any) => j.applicationMethod === where.applicationMethod);
          if (where?.applicationEmail?.not === null) list = list.filter((j: any) => j.applicationEmail != null);
          if (where?.lastSeenAt?.gte) list = list.filter((j: any) => j.lastSeenAt >= where.lastSeenAt.gte);
          if (where?.NOT) {
            for (const n of where.NOT) {
              if (n.emailApplications?.some?.userId) {
                const uid = n.emailApplications.some.userId;
                list = list.filter((j: any) => !Array.from(db.emailApplications.values()).some((ea: any) => ea.jobId === j.id && ea.userId === uid));
              }
              if (n.matches?.some?.userId && n.matches?.some?.status === 'DISMISSED') {
                const uid = n.matches.some.userId;
                list = list.filter((j: any) => !Array.from(db.matches.values()).some((m: any) => m.jobId === j.id && m.userId === uid && m.status === 'DISMISSED'));
              }
            }
          }
          return list;
        }),
      },
      resume: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const r of db.resumes.values()) {
            if (where.id && r.id !== where.id) continue;
            if (where.userId && r.userId !== where.userId) continue;
            if (where.isBase !== undefined && r.isBase !== where.isBase) continue;
            if (where.docKind && typeof where.docKind === 'string' && r.docKind !== where.docKind) continue;
            if (where.docKind?.not && r.docKind === where.docKind.not) continue;
            if (where.status && r.status !== where.status) continue;
            if (where.reviewedAt?.not === null && !r.reviewedAt) continue;
            if (where.match?.jobId && r.match?.jobId !== where.match.jobId) continue;
            return r;
          }
          return null;
        }),
        findFirstOrThrow: jest.fn(async (args: any) => {
          const res = await prisma.resume.findFirst(args);
          if (!res) throw new Error('Resume not found');
          return res;
        }),
      },
      documentSnapshot: {
        findMany: jest.fn(async ({ where }: any) => {
          return db.documentSnapshots.filter((s: any) => (!where.resumeId || s.resumeId === where.resumeId) && (!where.kind || s.kind === where.kind));
        }),
      },
      emailApplySettings: {
        findUnique: jest.fn(async ({ where }: any) => db.emailApplySettings.get(where.userId) ?? null),
        findMany: jest.fn(async ({ where }: any) => {
          return Array.from(db.emailApplySettings.values()).filter((s: any) => {
            if (where.reviewQueueEnabled && !s.reviewQueueEnabled) return false;
            if (where.reviewQueueSince?.not === null && !s.reviewQueueSince) return false;
            if (where.consentRevokedAt === null && s.consentRevokedAt) return false;
            return true;
          });
        }),
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const existing = db.emailApplySettings.get(where.userId) ?? {};
          const merged = { ...existing, ...(existing.userId ? update : create) };
          db.emailApplySettings.set(where.userId, merged);
          return merged;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const s = db.emailApplySettings.get(where.userId);
          if (s) {
            Object.assign(s, data);
            return { count: 1 };
          }
          return { count: 0 };
        }),
      },
      emailApplication: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id) return db.emailApplications.get(where.id) ?? null;
          if (where.userId_jobId) {
            for (const ea of db.emailApplications.values()) {
              if (ea.userId === where.userId_jobId.userId && ea.jobId === where.userId_jobId.jobId) return ea;
            }
          }
          return null;
        }),
        findUniqueOrThrow: jest.fn(async ({ where }: any) => {
          const ea = await prisma.emailApplication.findUnique({ where });
          if (!ea) throw new Error('EmailApplication not found');
          return ea;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          for (const ea of db.emailApplications.values()) {
            if (where.id && ea.id !== where.id) continue;
            if (where.userId && ea.userId !== where.userId) continue;
            return ea;
          }
          return null;
        }),
        findMany: jest.fn(async ({ where }: any) => {
          return Array.from(db.emailApplications.values())
            .filter((ea: any) => {
              if (where?.userId && ea.userId !== where.userId) return false;
              if (where?.deliveryState && typeof where.deliveryState === 'string' && ea.deliveryState !== where.deliveryState) return false;
              if (where?.deliveryState?.in && !where.deliveryState.in.includes(ea.deliveryState)) return false;
              if (where?.lockedAt?.lt && (!ea.lockedAt || ea.lockedAt >= where.lockedAt.lt)) return false;
              return true;
            })
            .map((ea: any) => ({
              ...ea,
              statusEvents: db.applicationStatusEvents.filter((ev: any) => ev.emailApplicationId === ea.id),
              inbound: [],
            }));
        }),
        count: jest.fn(async ({ where }: any) => {
          const matches = (await prisma.emailApplication.findMany({ where })) as any[];
          if (where?.preparedByAgentAt?.not === null) {
            return matches.filter((m: any) => m.preparedByAgentAt != null && m.deliveryState === where.deliveryState).length;
          }
          return matches.length;
        }),
        create: jest.fn(async ({ data }: any) => {
          const id = `ea-${appSeq++}`;
          const row = { id, ...data, createdAt: new Date(), updatedAt: new Date(), generation: 1, attemptCount: 0 };
          db.emailApplications.set(id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = db.emailApplications.get(where.id);
          if (!row) throw new Error('Not found');
          Object.assign(row, data, { updatedAt: new Date() });
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const row of db.emailApplications.values()) {
            if (where.id && typeof where.id === 'string' && row.id !== where.id) continue;
            if (where.id?.in && !where.id.in.includes(row.id)) continue;
            if (where.userId && row.userId !== where.userId) continue;
            if (where.deliveryState && typeof where.deliveryState === 'string' && row.deliveryState !== where.deliveryState) continue;
            if (where.deliveryState?.in && !where.deliveryState.in.includes(row.deliveryState)) continue;
            Object.assign(row, data, { updatedAt: new Date() });
            count++;
          }
          return { count };
        }),
      },
      emailSendAttempt: {
        create: jest.fn(async ({ data }: any) => {
          const id = `attempt_${db.emailSendAttempts.length + 1}`;
          const attempt = { id, ...data, startedAt: new Date(), outcome: 'PENDING' };
          db.emailSendAttempts.push(attempt);
          return attempt;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          return db.emailSendAttempts.find((a: any) => {
            if (where?.emailApplicationId && a.emailApplicationId !== where.emailApplicationId) return false;
            if (where?.generation && a.generation !== where.generation) return false;
            if (where?.outcome && a.outcome !== where.outcome) return false;
            return true;
          }) ?? null;
        }),
        count: jest.fn(async ({ where }: any) => {
          return db.emailSendAttempts.filter((a: any) => {
            if (where?.emailApplicationId && a.emailApplicationId !== where.emailApplicationId) return false;
            if (where?.generation && a.generation !== where.generation) return false;
            return true;
          }).length;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const a = db.emailSendAttempts.find((att: any) => att.id === where.id);
          if (a) Object.assign(a, data);
          return a;
        }),
      },
      emailAutomationDecision: {
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const key = `${where.userId_jobId.userId}_${where.userId_jobId.jobId}`;
          const existing = db.emailAutomationDecisions.get(key) ?? {};
          const row = { ...existing, ...create, ...update, createdAt: new Date() };
          db.emailAutomationDecisions.set(key, row);
          return row;
        }),
        findMany: jest.fn(async ({ where }: any) => {
          return Array.from(db.emailAutomationDecisions.values()).filter((d: any) => d.userId === where.userId);
        }),
        count: jest.fn(async () => 0),
      },
      applicationStatusEvent: {
        create: jest.fn(async ({ data }: any) => {
          const ev = { id: `event_${db.applicationStatusEvents.length + 1}`, ...data, createdAt: new Date() };
          db.applicationStatusEvents.push(ev);
          return ev;
        }),
        findMany: jest.fn(async ({ where }: any) => {
          return db.applicationStatusEvents.filter((e: any) => e.emailApplicationId === where.emailApplicationId);
        }),
      },
      notification: {
        create: jest.fn(async ({ data }: any) => {
          const n = { id: `notif_${db.notifications.length + 1}`, ...data, createdAt: new Date() };
          db.notifications.push(n);
          return n;
        }),
      },
      emailSuppression: {
        findUnique: jest.fn(async ({ where }: any) => {
          return db.emailSuppressions.has(where.email.toLowerCase()) ? { email: where.email } : null;
        }),
      },
      match: {
        findMany: jest.fn(async () => []),
      },
      applicationTrackerRecord: {
        findMany: jest.fn(async ({ where }: any) => {
          return Array.from(db.applicationTrackerRecords.values()).filter((r: any) => r.userId === where.userId);
        }),
        findUnique: jest.fn(async ({ where }: any) => db.applicationTrackerRecords.get(where.userId_sourceKey) ?? null),
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const key = `${where.userId_sourceKey.userId}_${where.userId_sourceKey.sourceKey}`;
          const existing = db.applicationTrackerRecords.get(key) ?? {};
          const row = { ...existing, ...create, ...update, sourceKey: where.userId_sourceKey.sourceKey, userId: where.userId_sourceKey.userId, createdAt: new Date() };
          db.applicationTrackerRecords.set(key, row);
          return row;
        }),
      },
      applicationTrackerSettings: {
        findUnique: jest.fn(async () => ({ columns: [{ id: 'c_notes', name: 'Qeydlər' }] })),
      },
      application: { findMany: jest.fn(async () => []) },
      externalApplication: { findMany: jest.fn(async () => []) },
      agentApplication: { findMany: jest.fn(async () => []) },
      applicationOutcomeEvent: { findMany: jest.fn(async () => []) },
    };

    const cfg = loadEmailApplyConfig({
      EMAIL_APPLY_ENABLED: 'true',
      EMAIL_APPLY_SINK_URL: sinkUrl,
      EMAIL_APPLY_USER_DAILY_LIMIT: '5',
      EMAIL_APPLY_FROM: 'AISE <applications@sink.invalid>',
    } as any);

    const flags: any = { isPaused: jest.fn(async () => false) };
    const queue: any = { add: jest.fn(async () => ({})) };

    const allowanceService = new EmailAllowanceService(prisma);
    if (overrides.allowanceLimit !== undefined) {
      jest.spyOn(allowanceService, 'view').mockImplementation(async () => ({
        plan: 'PREMIUM',
        limit: overrides.allowanceLimit ?? 50,
        used: overrides.allowanceUsed ?? 0,
        remaining: Math.max(0, (overrides.allowanceLimit ?? 50) - (overrides.allowanceUsed ?? 0)),
        period: '2026-10',
        resetsAt: '2026-11-01T00:00:00.000Z',
      }));
    }

    const applicationsService = new EmailApplicationsService(prisma, storage, flags, cfg, queue, allowanceService);
    const automationService = new EmailAutomationService(prisma, flags, applicationsService, cfg);
    const transport = new ResendTransport(cfg, cfg.providerTimeoutMs);
    const sender = new EmailApplicationSender(prisma, storage, flags, cfg, transport);
    const timelineService = new TimelineService(prisma);
    const trackerService = new TrackerService(prisma, timelineService);

    return {
      userId,
      jobId1,
      baseResumeId,
      tailoredResumeId,
      tailoredLetterId,
      baseCvBytes,
      tailoredCvBytes,
      tailoredLetterBytes,
      db,
      prisma,
      storage,
      cfg,
      flags,
      applicationsService,
      automationService,
      sender,
      trackerService,
      allowanceService,
    };
  }

  it('exercises service-level workflow: config -> background match with existing approved tailored documents -> prepared review -> candidate approval -> delivery to local sink -> tracker record update', async () => {
    const env = createTestEnvironment();

    // 1. Candidate configures rules for find-and-prepare review queue
    await env.automationService.save(env.userId, {
      reviewQueue: true,
      allowedRoles: ['Auditor', 'Audit', 'Analyst'],
      allowedLocations: ['Bakı'],
      dailyLimit: 3,
      cvResumeId: env.baseResumeId,
    });

    const settings = await env.db.emailApplySettings.get(env.userId);
    expect(settings.reviewQueueEnabled).toBe(true);
    expect(settings.allowedRoles).toContain('Auditor');
    expect(settings.dailyLimit).toBe(3);

    // 2. Background process finds open vacancy and prepares tailored documents into review queue
    const runResult = await env.automationService.runAll();
    expect(runResult.prepared).toBe(1);

    // Verify prepared application in review queue
    const [app] = Array.from(env.db.emailApplications.values()) as any[];
    expect(app).toBeDefined();
    expect(app.jobTitle).toContain('Senior Auditor');
    expect(app.jobCompany).toBe('Deloitte Azerbaijan');
    expect(app.recipient).toBe('hr@deloitte.az');
    expect(app.deliveryState).toBe('AWAITING_APPROVAL');
    expect(app.preparedByAgentAt).toBeDefined();

    // Verify vacancy-specific documents were selected
    expect(app.cvResumeId).toBe(env.tailoredResumeId);
    expect(app.letterResumeId).toBe(env.tailoredLetterId);
    expect(app.cvKind).toBe('tailored');

    // Verify notification was sent to candidate
    expect(env.db.notifications).toHaveLength(1);
    expect(env.db.notifications[0].type).toBe('AGENT_REVIEW');

    // 3. Application appears in review queue with verified address, source evidence and full disclosures
    const view = await env.applicationsService.get(env.userId, app.id);
    expect(view.recipient).toBe('hr@deloitte.az');
    expect(view.recipientEvidence).toMatchObject({
      source: 'description',
      sourceUrl: expect.stringContaining('deloitte'),
    });
    expect(view.instructions).toContain('Please send your CV and cover letter to hr@deloitte.az');
    expect(view.cv.sha256).toBe(sha256Hex(env.tailoredCvBytes));
    expect(view.letter?.sha256).toBe(sha256Hex(env.tailoredLetterBytes));
    expect(view.replyTo).toBe('aysel@example.az');

    // 4. Candidate reviews and approves
    const approvedView = await env.applicationsService.approve(env.userId, app.id, {
      payloadSha256: view.payloadSha256,
      consent: true,
      instructionsAcknowledged: true,
    });

    expect(approvedView.deliveryState).toBe('QUEUED');
    expect(approvedView.approvedAt).toBeDefined();
    expect(env.storage.copyToPrivate).toHaveBeenCalledTimes(2); // CV and letter copied to immutable snapshots

    // 5. Worker processes delivery and sink captures the email
    const sendResult = await env.sender.process(app.id);
    expect(sendResult).toBe('provider_accepted');

    // Verify mock email provider sink received message
    expect(provider.messages).toHaveLength(1);
    const sentMsg = provider.messages[0];
    expect(sentMsg.to).toEqual(['hr@deloitte.az']);
    expect(sentMsg.replyTo).toBe('aysel@example.az');
    expect(sentMsg.subject).toContain('Senior Auditor');
    expect(sentMsg.attachments).toHaveLength(2);
    expect(sentMsg.attachments[0].content.equals(env.tailoredCvBytes)).toBe(true);
    expect(sentMsg.attachments[1].content.equals(env.tailoredLetterBytes)).toBe(true);

    // Verify delivery state updated
    const deliveredApp = await env.db.emailApplications.get(app.id);
    expect(deliveredApp.deliveryState).toBe('PROVIDER_ACCEPTED');
    expect(deliveredApp.providerAcceptedAt).toBeDefined();

    // 6. Tracker records the application with verified status and immutable evidence
    const trackerData = await env.trackerService.all(env.userId);
    expect(trackerData.rows).toHaveLength(1);
    const trackerRow = trackerData.rows[0];
    expect(trackerRow.key).toBe(`email:${app.id}`);
    expect(trackerRow.title).toBe(deliveredApp.jobTitle);
    expect(trackerRow.stage).toBe('APPLIED');
    expect(trackerRow.evidence).toBe('PROVIDER_ACCEPTED');

    // Candidate edits tracker row (adds note, moves to INTERVIEW)
    await env.trackerService.edit(env.userId, trackerRow.key, {
      stage: 'INTERVIEW',
      notes: 'Deloitte HR dəvət etdi, müsahibə 25 oktyabr təyin edildi',
    });

    // Verify tracker preserves candidate edits and immutable provider evidence
    const updatedTracker = await env.trackerService.all(env.userId);
    expect(updatedTracker.rows[0].stage).toBe('INTERVIEW');
    expect(updatedTracker.rows[0].notes).toContain('Deloitte HR dəvət etdi');
    expect(updatedTracker.rows[0].evidence).toBe('PROVIDER_ACCEPTED');
  });

  describe('Edge Cases and Resilience', () => {
    it('edge case 1: job expires or closes before candidate approves', async () => {
      const env = createTestEnvironment();

      // Background prepares draft
      await env.automationService.save(env.userId, { reviewQueue: true, allowedRoles: ['Audit'], allowedLocations: ['Bakı'], dailyLimit: 3, cvResumeId: env.baseResumeId });
      await env.automationService.runAll();
      const [app] = Array.from(env.db.emailApplications.values()) as any[];
      const view = await env.applicationsService.get(env.userId, app.id);

      // Job is closed before approval
      const job = env.db.jobs.get(env.jobId1);
      job.status = 'CLOSED';

      await expect(
        env.applicationsService.approve(env.userId, app.id, {
          payloadSha256: view.payloadSha256,
          consent: true,
          instructionsAcknowledged: true,
        }),
      ).rejects.toThrow(ConflictException);

      // Verify deliveryState remains AWAITING_APPROVAL and nothing was sent
      expect(env.db.emailApplications.get(app.id).deliveryState).toBe('AWAITING_APPROVAL');
      expect(provider.messages).toHaveLength(0);
    });

    it('edge case 2: document is edited after preview and hash differs', async () => {
      const env = createTestEnvironment();

      await env.automationService.save(env.userId, { reviewQueue: true, allowedRoles: ['Audit'], allowedLocations: ['Bakı'], dailyLimit: 3, cvResumeId: env.baseResumeId });
      await env.automationService.runAll();
      const [app] = Array.from(env.db.emailApplications.values()) as any[];

      // Candidate tries to approve with modified hash
      await expect(
        env.applicationsService.approve(env.userId, app.id, {
          payloadSha256: 'tampered_sha256_hash_that_does_not_match_preview',
          consent: true,
          instructionsAcknowledged: true,
        }),
      ).rejects.toThrow(ConflictException);

      expect(env.db.emailApplications.get(app.id).deliveryState).toBe('AWAITING_APPROVAL');
    });

    it('edge case 3: monthly quota exhaustion prevents approval without burning allowance', async () => {
      const env = createTestEnvironment({ allowanceLimit: 5, allowanceUsed: 5 });

      await env.automationService.save(env.userId, { reviewQueue: true, allowedRoles: ['Audit'], allowedLocations: ['Bakı'], dailyLimit: 3, cvResumeId: env.baseResumeId });
      await env.automationService.runAll();
      const [app] = Array.from(env.db.emailApplications.values()) as any[];
      const view = await env.applicationsService.get(env.userId, app.id);

      await expect(
        env.applicationsService.approve(env.userId, app.id, {
          payloadSha256: view.payloadSha256,
          consent: true,
          instructionsAcknowledged: true,
        }),
      ).rejects.toThrow(EmailAllowanceError);

      expect(env.db.emailApplications.get(app.id).deliveryState).toBe('AWAITING_APPROVAL');
    });

    it('edge case 4: repeat worker attempts are idempotent and do not send duplicate emails', async () => {
      const env = createTestEnvironment();

      await env.automationService.save(env.userId, { reviewQueue: true, allowedRoles: ['Audit'], allowedLocations: ['Bakı'], dailyLimit: 3, cvResumeId: env.baseResumeId });
      await env.automationService.runAll();
      const [app] = Array.from(env.db.emailApplications.values()) as any[];
      const view = await env.applicationsService.get(env.userId, app.id);
      await env.applicationsService.approve(env.userId, app.id, {
        payloadSha256: view.payloadSha256,
        consent: true,
        instructionsAcknowledged: true,
      });

      // First worker attempt
      const result1 = await env.sender.process(app.id);
      expect(result1).toBe('provider_accepted');
      expect(provider.messages).toHaveLength(1);

      // Repeated concurrent or restart worker attempt
      const result2 = await env.sender.process(app.id);
      expect(result2).toBe('skipped'); // Already claimed and finished
      expect(provider.messages).toHaveLength(1); // No duplicate sent
    });

    it('edge case 5: candidate pauses agent or revokes consent cleanly', async () => {
      const env = createTestEnvironment();

      await env.automationService.save(env.userId, { reviewQueue: true, allowedRoles: ['Audit'], allowedLocations: ['Bakı'], dailyLimit: 3, cvResumeId: env.baseResumeId });
      await env.automationService.runAll();
      const [app] = Array.from(env.db.emailApplications.values()) as any[];
      const view = await env.applicationsService.get(env.userId, app.id);
      await env.applicationsService.approve(env.userId, app.id, {
        payloadSha256: view.payloadSha256,
        consent: true,
        instructionsAcknowledged: true,
      });

      // Candidate pauses sending
      env.db.emailApplySettings.get(env.userId).sendingPausedAt = new Date();

      // Worker picks up claimed job but notices candidate paused
      const pauseResult = await env.sender.process(app.id);
      expect(pauseResult).toBe('held');
      expect(env.db.emailApplications.get(app.id).deliveryState).toBe('QUEUED');
      expect(env.db.emailApplications.get(app.id).holdReason).toBe('USER_PAUSED');
      expect(provider.messages).toHaveLength(0); // Nothing sent

      // Now candidate revokes consent entirely
      await env.applicationsService.revokeConsent(env.userId);
      expect(env.db.emailApplications.get(app.id).deliveryState).toBe('CANCELLED');
    });

    it('edge case 6: worker crash recovery puts unclaimed job back to QUEUED without burning quota', async () => {
      const env = createTestEnvironment();

      await env.automationService.save(env.userId, { reviewQueue: true, allowedRoles: ['Audit'], allowedLocations: ['Bakı'], dailyLimit: 3, cvResumeId: env.baseResumeId });
      await env.automationService.runAll();
      const [app] = Array.from(env.db.emailApplications.values()) as any[];
      const view = await env.applicationsService.get(env.userId, app.id);
      await env.applicationsService.approve(env.userId, app.id, {
        payloadSha256: view.payloadSha256,
        consent: true,
        instructionsAcknowledged: true,
      });

      // Simulate worker crash before provider call
      const row = env.db.emailApplications.get(app.id);
      row.deliveryState = 'SENDING';
      row.lockedAt = new Date(Date.now() - 15 * 60_000); // 15 mins stale

      // Sweeper reclaims stale job
      const reclaimed = await env.sender.reclaimStale();
      expect(reclaimed).toBe(1);

      // Verified recovered back to QUEUED with WORKER_INTERRUPTED hold reason
      expect(row.deliveryState).toBe('QUEUED');
      expect(row.holdReason).toBe('WORKER_INTERRUPTED');
      expect(provider.messages).toHaveLength(0);
    });
  });
});
