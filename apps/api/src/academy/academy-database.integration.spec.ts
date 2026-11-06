import { PrismaClient, AcademyRole, CohortStatus, CandidateOutcomeType, OutcomeVerificationStatus } from '@prisma/client';
import { AcademyService } from './academy.service';
import { AccountDeletionService } from '../accounts/account-deletion.service';

describe('Academy Real Database Integration Test', () => {
  let prisma: PrismaClient;
  let service: AcademyService;
  let accountDeletionService: AccountDeletionService;
  let testAcademyId: string;
  let testCohortId: string;
  let testOwnerUserId: string;
  let testStudent1UserId: string;
  let testStudent2UserId: string;
  let enrollment1Id: string;
  let enrollment2Id: string;
  let outcomeId: string;
  const extraUserIds: string[] = [];

  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@localhost:5433/aise?schema=public';

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: dbUrl } },
    });
    try {
      await prisma.$connect();
    } catch (e) {
      console.warn('Postgres connection skipped for integration test:', e);
      return;
    }

    service = new AcademyService(prisma as any);
    accountDeletionService = new AccountDeletionService(
      prisma as any,
      { deletePrivate: jest.fn().mockResolvedValue(undefined), deleteFile: jest.fn().mockResolvedValue(undefined), fileExists: jest.fn().mockReturnValue(false) } as any,
      { cancelForDeletion: jest.fn().mockResolvedValue(undefined) } as any,
      { deleteSession: jest.fn().mockResolvedValue(undefined) } as any,
      { capture: jest.fn() } as any,
    );

    // Create synthetic users
    const stamp = Date.now();
    const owner = await prisma.user.create({
      data: {
        email: `synth-owner-${stamp}@integration.test`,
        name: 'Synthetic Owner',
        hashedPassword: 'hash',
      },
    });
    testOwnerUserId = owner.id;

    const student1 = await prisma.user.create({
      data: {
        email: `synth-stud1-${stamp}@integration.test`,
        name: 'Synthetic Student 1',
        hashedPassword: 'hash',
        emailVerified: new Date(),
      },
    });
    testStudent1UserId = student1.id;

    const student2 = await prisma.user.create({
      data: {
        email: `synth-stud2-${stamp}@integration.test`,
        name: 'Synthetic Student 2',
        hashedPassword: 'hash',
        emailVerified: new Date(),
      },
    });
    testStudent2UserId = student2.id;

    // Create synthetic academy
    const academy = await service.createAcademy(testOwnerUserId, {
      name: `Synthetic Academy ${stamp}`,
      slug: `synth-acad-${stamp}`,
      contactEmail: `contact-${stamp}@integration.test`,
    });
    testAcademyId = academy.id;

    // Create synthetic cohort
    const cohort = await service.createCohort(testAcademyId, {
      name: 'Batch 2026',
      slug: 'batch-2026',
      startDate: new Date('2026-01-01').toISOString(),
      endDate: new Date('2026-12-31').toISOString(),
    });
    testCohortId = cohort.id;
  });

  afterAll(async () => {
    try {
      if (testAcademyId) {
        await prisma.academy.delete({ where: { id: testAcademyId } }).catch(() => {});
      }
      if (testOwnerUserId) {
        await prisma.user.delete({ where: { id: testOwnerUserId } }).catch(() => {});
      }
      if (testStudent1UserId) {
        await prisma.user.delete({ where: { id: testStudent1UserId } }).catch(() => {});
      }
      if (testStudent2UserId) {
        await prisma.user.delete({ where: { id: testStudent2UserId } }).catch(() => {});
      }
      for (const uid of extraUserIds) {
        await prisma.user.delete({ where: { id: uid } }).catch(() => {});
      }
      await prisma.$disconnect();
    } catch {}
  });

  it('exercises real PostgreSQL transactions: invites, accepts, computes KPIs, and revokes consent cleanly', async () => {
    if (!testAcademyId) return; // Skip if DB unreachable

    // 1. Invite 2 students with their verified accounts
    const student1 = await prisma.user.findUniqueOrThrow({ where: { id: testStudent1UserId } });
    const student2 = await prisma.user.findUniqueOrThrow({ where: { id: testStudent2UserId } });

    const invited = await service.inviteStudents(testAcademyId, testCohortId, {
      emails: [student1.email, student2.email],
    });
    expect(invited.invitedCount).toBe(2);
    const token1 = invited.invitations[0].inviteToken;
    const token2 = invited.invitations[1].inviteToken;
    enrollment1Id = (await prisma.academyEnrollment.findUnique({ where: { cohortId_invitedEmail: { cohortId: testCohortId, invitedEmail: student1.email } } })).id;
    enrollment2Id = (await prisma.academyEnrollment.findUnique({ where: { cohortId_invitedEmail: { cohortId: testCohortId, invitedEmail: student2.email } } })).id;

    // 2. Reject acceptance if wrong account attempts to accept token1
    await expect(
      service.acceptEnrollment(testStudent2UserId, token1, { scope: 'AGGREGATE_ONLY' }),
    ).rejects.toThrow('Bu dəvət başqa e-poçt ünvanına göndərilib');

    // 3. Student 1 accepts invitation with explicit IDENTIFIABLE_ROSTER consent
    const accepted = await service.acceptEnrollment(testStudent1UserId, token1, {
      scope: 'IDENTIFIABLE_ROSTER' as any,
    });
    expect(accepted.status).toBe('ACTIVE');
    expect(accepted.userId).toBe(testStudent1UserId);

    // Student 2 accepts invitation with default AGGREGATE_ONLY consent
    const accepted2 = await service.acceptEnrollment(testStudent2UserId, token2, {
      scope: 'AGGREGATE_ONLY' as any,
    });
    expect(accepted2.status).toBe('ACTIVE');
    expect(accepted2.userId).toBe(testStudent2UserId);

    // 4. Verify Roster Privacy against live database:
    // Student 1 (active IDENTIFIABLE_ROSTER consent) has identity exposed.
    // Student 2 (active AGGREGATE_ONLY consent) has identity strictly withheld (null).
    const liveRosterInitial = await service.listCohortStudents(testAcademyId, testCohortId);
    const r1 = liveRosterInitial.find((r) => r.id === enrollment1Id)!;
    const r2 = liveRosterInitial.find((r) => r.id === enrollment2Id)!;
    expect(r1.studentName).toBe('Synthetic Student 1');
    expect(r1.invitedEmail).toBe(student1.email);
    expect(r1.identityExposed).toBe(true);
    expect(r1.consentScope).toBe('IDENTIFIABLE_ROSTER');

    expect(r2.studentName).toBeNull();
    expect(r2.invitedEmail).toBeNull();
    expect(r2.identityExposed).toBe(false);
    expect(r2.consentScope).toBe('AGGREGATE_ONLY');

    // 5. Student 1 reports an outcome (JOB_STARTED) with shareWithAcademy=true
    const outcome = await prisma.candidateOutcome.create({
      data: {
        userId: testStudent1UserId,
        outcomeType: CandidateOutcomeType.JOB_STARTED,
        // Report after enrollment so it is within the explicitly documented observation window.
        occurredAt: new Date(),
        jobTitle: 'Junior Backend Developer',
        companyName: 'Integration Corp',
        verificationStatus: OutcomeVerificationStatus.STUDENT_ATTESTED,
        shareWithAcademy: true,
      },
    });
    outcomeId = outcome.id;

    // 6. Query Cohort KPIs against live PostgreSQL database with 2 students
    // Because activeConsented = 2 < MIN_COHORT_AGGREGATION_THRESHOLD (5), outcome funnel metrics are suppressed (k-anonymity)
    const kpisSuppressed = await service.getCohortKpis(testAcademyId, testCohortId);
    expect(kpisSuppressed.enrolledTotal).toBeNull();
    expect(kpisSuppressed.activeConsented).toBeNull();
    expect(kpisSuppressed.isSuppressed).toBe(true);
    expect(kpisSuppressed.minAggregationThreshold).toBe(5);
    expect(kpisSuppressed.funnel.jobStarted.status).toBe('INSUFFICIENT_DATA');
    expect(kpisSuppressed.funnel.jobStarted.count).toBeNull();
    expect(kpisSuppressed.funnel.jobStarted.distinctStudents).toBeNull();

    // Enroll 3 more students to meet the minimum aggregation threshold (5 active consented students)
    const stampExtra = Date.now();
    for (let i = 3; i <= 5; i++) {
      const email = `synth-stud${i}-${stampExtra}@integration.test`;
      const extraStudent = await prisma.user.create({
        data: {
          email,
          name: `Synthetic Student ${i}`,
          hashedPassword: 'hash',
          emailVerified: new Date(),
        },
      });
      extraUserIds.push(extraStudent.id);
      const inv = await service.inviteStudents(testAcademyId, testCohortId, { emails: [email] });
      await service.acceptEnrollment(extraStudent.id, inv.invitations[0].inviteToken, {
        scope: 'AGGREGATE_ONLY' as any,
      });
    }

    // Now activeConsented = 5 >= MIN_COHORT_AGGREGATION_THRESHOLD (5)
    // Scenario: 5 enrolled / 1 outcome (Student 1) -> JOB_STARTED remains suppressed (INSUFFICIENT_DATA)
    const kpis1Contributor = await service.getCohortKpis(testAcademyId, testCohortId);
    expect(kpis1Contributor.enrolledTotal).toBe(5);
    expect(kpis1Contributor.activeConsented).toBe(5);
    expect(kpis1Contributor.isSuppressed).toBe(true);
    expect(kpis1Contributor.funnel.jobStarted.distinctStudents).toBeNull();
    expect(kpis1Contributor.funnel.jobStarted.count).toBeNull();
    expect(kpis1Contributor.funnel.jobStarted.status).toBe('INSUFFICIENT_DATA');
    expect(kpis1Contributor.dataCompleteness.studentsWithReportedOutcomes).toBeNull();
    expect(kpis1Contributor.dataCompleteness.completenessPct).toBeNull();
    expect(kpis1Contributor.dataCompleteness.status).toBe('INSUFFICIENT_DATA');

    // Create outcomes for the remaining 4 students so distinct contributors = 5 >= 5
    const remainingStudentIds = [testStudent2UserId, ...extraUserIds];
    for (const uid of remainingStudentIds) {
      await prisma.candidateOutcome.create({
        data: {
          userId: uid,
          outcomeType: CandidateOutcomeType.JOB_STARTED,
          occurredAt: new Date(),
          jobTitle: 'Junior Developer',
          companyName: 'Integration Corp',
          verificationStatus: OutcomeVerificationStatus.STUDENT_ATTESTED,
          shareWithAcademy: true,
        },
      });
    }

    // Now activeConsented = 5 and distinct contributors = 5 >= 5
    // Scenario: 5 enrolled / 5 contributors -> Outcome metrics become unsuppressed (MEASURED)
    const kpisUnsuppressed = await service.getCohortKpis(testAcademyId, testCohortId);
    expect(kpisUnsuppressed.enrolledTotal).toBe(5);
    expect(kpisUnsuppressed.activeConsented).toBe(5);
    expect(kpisUnsuppressed.isSuppressed).toBe(false);
    expect(kpisUnsuppressed.funnel.jobStarted.distinctStudents).toBe(5);
    expect(kpisUnsuppressed.funnel.jobStarted.count).toBe(5);
    expect(kpisUnsuppressed.funnel.jobStarted.status).toBe('MEASURED');
    expect(kpisUnsuppressed.dataCompleteness.studentsWithReportedOutcomes).toBe(5);
    expect(kpisUnsuppressed.dataCompleteness.completenessPct).toBe(100);
    expect(kpisUnsuppressed.dataCompleteness.status).toBe('MEASURED');

    // 7. Student 1 revokes consent
    await service.revokeConsent(testStudent1UserId, enrollment1Id);

    // 8. Query Cohort KPIs again: activeConsented drops to 4 (< 5), so outcomes are suppressed again
    const kpisAfterRevoke = await service.getCohortKpis(testAcademyId, testCohortId);
    expect(kpisAfterRevoke.enrolledTotal).toBeNull();
    expect(kpisAfterRevoke.activeConsented).toBeNull();
    expect(kpisAfterRevoke.isSuppressed).toBe(true);
    expect(kpisAfterRevoke.funnel.jobStarted.distinctStudents).toBeNull();
    expect(kpisAfterRevoke.funnel.jobStarted.status).toBe('INSUFFICIENT_DATA');
    expect(kpisAfterRevoke.dataCompleteness.studentsWithReportedOutcomes).toBeNull();
    expect(kpisAfterRevoke.dataCompleteness.completenessPct).toBeNull();

    // 9. Verify live roster after revocation: Student 1's identity is now masked!
    const liveRosterAfterRevoke = await service.listCohortStudents(testAcademyId, testCohortId);
    const r1After = liveRosterAfterRevoke.find((r) => r.id === enrollment1Id)!;
    expect(r1After.studentName).toBeNull();
    expect(r1After.invitedEmail).toBeNull();
    expect(r1After.consentStatus).toBe('REVOKED');
  });

  it('reports post-training job starts for graduated students inside the bounded observation window, then excludes revoked consent', async () => {
    if (!testAcademyId) return;

    const now = new Date();
    const trainingStart = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);
    const trainingEnd = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const cohort = await service.createCohort(testAcademyId, {
      name: `Synthetic completed cohort ${Date.now()}`,
      slug: `completed-${Date.now()}`,
      startDate: trainingStart.toISOString(),
      endDate: trainingEnd.toISOString(),
    });
    const students: Array<{ id: string; enrollmentId: string }> = [];
    const stamp = Date.now();

    for (let i = 0; i < 5; i++) {
      const user = await prisma.user.create({
        data: { email: `synth-grad-${i}-${stamp}@integration.test`, name: `Synthetic Graduate ${i}`, hashedPassword: 'hash', emailVerified: new Date() },
      });
      extraUserIds.push(user.id);
      const invitation = await service.inviteStudents(testAcademyId, cohort.id, { emails: [user.email] });
      await service.acceptEnrollment(user.id, invitation.invitations[0].inviteToken, { scope: 'AGGREGATE_ONLY' as any });
      const enrollment = await prisma.academyEnrollment.findUniqueOrThrow({ where: { cohortId_invitedEmail: { cohortId: cohort.id, invitedEmail: user.email } } });
      await prisma.academyEnrollment.update({ where: { id: enrollment.id }, data: { status: 'GRADUATED', joinedAt: trainingStart } });
      students.push({ id: user.id, enrollmentId: enrollment.id });
      await prisma.candidateOutcome.create({
        data: {
          userId: user.id,
          outcomeType: CandidateOutcomeType.JOB_STARTED,
          occurredAt: now,
          jobTitle: 'Synthetic role',
          companyName: 'Synthetic employer',
          verificationStatus: OutcomeVerificationStatus.STUDENT_ATTESTED,
          shareWithAcademy: true,
        },
      });
    }

    const report = await service.getCohortKpis(testAcademyId, cohort.id, now);
    expect(report.reportingWindow.training.end).toBe(trainingEnd.toISOString());
    expect(report.reportingWindow.observation.end).toBe(now.toISOString());
    expect(report.reportingWindow.preEnrollmentActivity).toBe('EXCLUDED');
    expect(report.metrics.studentsStartedWork).toMatchObject({ value: 5, status: 'MEASURED', unit: 'students' });
    expect(report.metrics.studentsStartedWork.provenance).toContain('CandidateOutcome');

    await service.revokeConsent(students[0].id, students[0].enrollmentId);
    const afterRevocation = await service.getCohortKpis(testAcademyId, cohort.id, now);
    expect(afterRevocation.metrics.studentsStartedWork).toMatchObject({ value: null, status: 'SUPPRESSED' });
    expect(afterRevocation.activeConsented).toBeNull();
  });

  it('concurrent staff invitation acceptance against live PostgreSQL: exactly 1 succeeds and concurrent attempts reject with BadRequestException', async () => {
    if (!testAcademyId) return;

    const stamp = Date.now();
    const coachUser = await prisma.user.create({
      data: {
        email: `synth-coach-${stamp}@integration.test`,
        name: 'Synthetic Coach',
        hashedPassword: 'hash',
        emailVerified: new Date(),
      },
    });

    try {
      const invite = await service.inviteStaff(testAcademyId, testOwnerUserId, {
        email: coachUser.email,
        role: 'COACH' as any,
      });

      // Execute concurrent acceptance calls in parallel
      const [res1, res2] = await Promise.allSettled([
        service.acceptStaffInvitation(coachUser.id, invite.token),
        service.acceptStaffInvitation(coachUser.id, invite.token),
      ]);

      const fulfilled = [res1, res2].filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect(fulfilled[0].value.role).toBe(AcademyRole.COACH);
      expect(rejected[0].reason.message).toMatch(/artıq qəbul edilib/);
    } finally {
      await prisma.user.delete({ where: { id: coachUser.id } }).catch(() => {});
    }
  });

  it('concurrent student invitation acceptance against live PostgreSQL: exactly 1 succeeds and concurrent attempts reject with BadRequestException', async () => {
    if (!testAcademyId) return;

    const stamp = Date.now();
    const studentUser = await prisma.user.create({
      data: {
        email: `synth-race-${stamp}@integration.test`,
        name: 'Synthetic Race Student',
        hashedPassword: 'hash',
        emailVerified: new Date(),
      },
    });

    try {
      const invite = await service.inviteStudents(testAcademyId, testCohortId, {
        emails: [studentUser.email],
      });
      const token = invite.invitations[0].inviteToken;

      // Execute simultaneous student acceptances against live PostgreSQL
      const [s1, s2] = await Promise.allSettled([
        service.acceptEnrollment(studentUser.id, token, { scope: 'IDENTIFIABLE_ROSTER' as any }),
        service.acceptEnrollment(studentUser.id, token, { scope: 'IDENTIFIABLE_ROSTER' as any }),
      ]);

      const fulfilled = [s1, s2].filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
      const rejected = [s1, s2].filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect(fulfilled[0].value.status).toBe('ACTIVE');
      expect(rejected[0].reason.message).toMatch(/artıq qəbul edilib və ya etibarsızdır/);
    } finally {
      await prisma.user.delete({ where: { id: studentUser.id } }).catch(() => {});
    }
  });

  it('account deletion against live PostgreSQL: scrubs enrolled PII, sets WITHDRAWN, unlinks user, and masks identity', async () => {
    if (!testAcademyId) return;

    const stamp = Date.now();
    const delStudent = await prisma.user.create({
      data: {
        email: `synth-del-${stamp}@integration.test`,
        name: 'Synthetic Delete Student',
        hashedPassword: 'hash',
        emailVerified: new Date(),
      },
    });

    try {
      // 1. Invite and accept with IDENTIFIABLE_ROSTER consent
      const inv = await service.inviteStudents(testAcademyId, testCohortId, {
        emails: [delStudent.email],
      });
      const enrId = (await prisma.academyEnrollment.findUnique({ where: { cohortId_invitedEmail: { cohortId: testCohortId, invitedEmail: delStudent.email } } })).id;
      const tok = inv.invitations[0].inviteToken;

      await service.acceptEnrollment(delStudent.id, tok, { scope: 'IDENTIFIABLE_ROSTER' as any });

      // 2. Roster shows identity before deletion
      const rosterBefore = await service.listCohortStudents(testAcademyId, testCohortId);
      const studentBefore = rosterBefore.find((r) => r.id === enrId)!;
      expect(studentBefore.studentName).toBe('Synthetic Delete Student');
      expect(studentBefore.invitedEmail).toBe(delStudent.email);
      expect(studentBefore.identityExposed).toBe(true);

      // 3. User deletes account
      const delResult = await accountDeletionService.deleteUser(delStudent.id, { kind: 'self' });
      expect(delResult.success).toBe(true);

      // 4. Verify user record is permanently removed from database
      const userAfter = await prisma.user.findUnique({ where: { id: delStudent.id } });
      expect(userAfter).toBeNull();

      // 5. Verify AcademyEnrollment row is anonymized:
      // userId is null, invitedEmail is scrubbed to @anonymized.invalid, status is WITHDRAWN, withdrawnAt is stamped
      const enrollmentAfter = await prisma.academyEnrollment.findUniqueOrThrow({ where: { id: enrId } });
      expect(enrollmentAfter.userId).toBeNull();
      expect(enrollmentAfter.invitedEmail).toBe(`deleted-student-${enrId.slice(0, 12)}@anonymized.invalid`);
      expect(enrollmentAfter.status).toBe('WITHDRAWN');
      expect(enrollmentAfter.withdrawnAt).not.toBeNull();

      // 6. Verify subsequent listCohortStudents masks identity completely and exposes zero PII
      const rosterAfter = await service.listCohortStudents(testAcademyId, testCohortId);
      const studentAfter = rosterAfter.find((r) => r.id === enrId)!;
      expect(studentAfter.studentName).toBeNull();
      expect(studentAfter.invitedEmail).toBeNull();
      expect(studentAfter.identityExposed).toBe(false);
      expect(studentAfter.consentActive).toBe(false);
    } finally {
      await prisma.user.delete({ where: { id: delStudent.id } }).catch(() => {});
    }
  });
});
