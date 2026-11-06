import { AcademyService } from './academy.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AcademyRole, CohortStatus, ConsentScope, EnrollmentStatus } from '@prisma/client';

describe('AcademyService', () => {
  let service: AcademyService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((cb) => cb(prisma)),
      academy: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      academyMember: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
      },
      academyStaffInvitation: {
        create: jest.fn(),
      },
      academyCohort: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u_new', email: 'valid@test.az', emailVerified: new Date() }),
      },
      academyEnrollment: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      academyConsent: {
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      resume: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      application: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      externalApplication: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      emailApplication: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      agentApplication: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      applicationTrackerRecord: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      applicationOutcomeEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      candidateOutcome: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new AcademyService(prisma);
  });

  describe('Workspace & Membership', () => {
    it('creates an academy and sets creator as OWNER in transaction', async () => {
      prisma.academy.findUnique.mockResolvedValue(null);
      prisma.academy.create.mockResolvedValue({
        id: 'acad_1',
        name: 'Holberton Baku',
        slug: 'holberton-baku',
        contactEmail: 'career@holberton.az',
      });
      prisma.academyMember.create.mockResolvedValue({
        id: 'mem_1',
        academyId: 'acad_1',
        userId: 'user_founder',
        role: AcademyRole.OWNER,
      });

      const result = await service.createAcademy('user_founder', {
        name: 'Holberton Baku',
        slug: 'holberton-baku',
        contactEmail: 'career@holberton.az',
      });

      expect(result.id).toBe('acad_1');
      expect(prisma.academy.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ slug: 'holberton-baku' }),
      });
      expect(prisma.academyMember.create).toHaveBeenCalledWith({
        data: {
          academyId: 'acad_1',
          userId: 'user_founder',
          role: AcademyRole.OWNER,
        },
      });
    });

    it('rejects duplicate slug with 409 Conflict', async () => {
      prisma.academy.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createAcademy('user_1', {
          name: 'Code Academy',
          slug: 'code-academy',
          contactEmail: 'info@code.az',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('invites a staff member with explicit role and 7-day expiration', async () => {
      prisma.academyMember.findFirst.mockResolvedValue(null);
      prisma.academyStaffInvitation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'inv_1', ...data }));

      const inv = await service.inviteStaff('acad_1', 'user_owner', {
        email: 'coach@holberton.az',
        role: AcademyRole.COACH as any,
      });

      expect(inv.email).toBe('coach@holberton.az');
      expect(inv.role).toBe(AcademyRole.COACH);
      expect(inv.token).toBeDefined();
      expect(inv.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
    });

    it('rejects removing the sole owner of an academy', async () => {
      prisma.academyMember.findUnique.mockResolvedValue({
        id: 'mem_owner',
        academyId: 'acad_1',
        role: AcademyRole.OWNER,
      });
      prisma.academyMember.count.mockResolvedValue(1);

      await expect(service.removeMember('acad_1', 'mem_owner', 'user_owner')).rejects.toThrow(BadRequestException);
    });
  });

  describe('Cohorts & Student Invitations', () => {
    it('creates a cohort ensuring startDate precedes endDate', async () => {
      prisma.academyCohort.findUnique.mockResolvedValue(null);
      prisma.academyCohort.create.mockImplementation(({ data }) => Promise.resolve({ id: 'coh_1', ...data }));

      const cohort = await service.createCohort('acad_1', {
        name: 'Cohort 12 Software Engineering',
        slug: 'cohort-12-se',
        startDate: '2026-10-01T00:00:00Z',
        endDate: '2027-04-01T00:00:00Z',
      });

      expect(cohort.id).toBe('coh_1');
      expect(cohort.slug).toBe('cohort-12-se');
    });

    it('rejects cohort with startDate >= endDate', async () => {
      await expect(
        service.createCohort('acad_1', {
          name: 'Invalid Cohort',
          slug: 'invalid',
          startDate: '2027-01-01T00:00:00Z',
          endDate: '2026-01-01T00:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('invites students and creates enrollment tokens', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue({ id: 'coh_1', academyId: 'acad_1' });
      prisma.academyEnrollment.findUnique.mockResolvedValue(null);
      prisma.academyEnrollment.create.mockImplementation(({ data }) => Promise.resolve({ id: 'enr_' + Math.random(), ...data }));

      const result = await service.inviteStudents('acad_1', 'coh_1', {
        emails: ['student1@test.az', 'student2@test.az'],
      });

      expect(result.createdCount).toBe(2);
      expect(result.delivery).toBe('MANUAL_LINKS');
      expect(result.invitations).toHaveLength(2);
      expect(prisma.academyEnrollment.create).toHaveBeenCalledTimes(2);
    });

    it('re-inviting an expired invitation returns a fresh token and 14-day expiry', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue({ id: 'coh_1', academyId: 'acad_1' });
      const oldExpiry = new Date(Date.now() - 86400000); // expired yesterday
      prisma.academyEnrollment.findUnique.mockResolvedValue({
        id: 'enr_expired',
        cohortId: 'coh_1',
        invitedEmail: 'expired@test.az',
        inviteToken: 'old_token_123',
        status: EnrollmentStatus.INVITED,
        expiresAt: oldExpiry,
      });
      prisma.academyEnrollment.update.mockImplementation(({ data }) => Promise.resolve({
        id: 'enr_expired',
        cohortId: 'coh_1',
        invitedEmail: 'expired@test.az',
        status: EnrollmentStatus.INVITED,
        inviteToken: data.inviteToken,
        expiresAt: data.expiresAt,
      }));

      const result = await service.inviteStudents('acad_1', 'coh_1', {
        emails: ['expired@test.az'],
      });

      expect(result.renewedCount).toBe(1);
      expect(prisma.academyEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'enr_expired' },
        data: {
          inviteToken: expect.any(String),
          expiresAt: expect.any(Date),
        },
      });
      expect(result.invitations[0].inviteToken).not.toBe('old_token_123');
      expect(result.invitations[0].expiresAt.getTime()).toBeGreaterThan(Date.now() + 13 * 86400000);
    });

    it('re-inviting an active student preserves active enrollment and does not overwrite token/status', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue({ id: 'coh_1', academyId: 'acad_1' });
      const activeEnrollment = {
        id: 'enr_active',
        cohortId: 'coh_1',
        invitedEmail: 'active@test.az',
        userId: 'u_active',
        status: EnrollmentStatus.ACTIVE,
        joinedAt: new Date('2026-10-15'),
        inviteToken: 'original_token',
      };
      prisma.academyEnrollment.findUnique.mockResolvedValue(activeEnrollment);

      const result = await service.inviteStudents('acad_1', 'coh_1', {
        emails: ['active@test.az'],
      });

      expect(result.skippedCount).toBe(1);
      expect(prisma.academyEnrollment.update).not.toHaveBeenCalled();
      expect(prisma.academyEnrollment.create).not.toHaveBeenCalled();
      expect(result.skipped[0].reason).toBe('ALREADY_ACTIVE');
    });

    it('re-inviting a withdrawn student preserves withdrawn status and does not revive them', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue({ id: 'coh_1', academyId: 'acad_1' });
      const withdrawnEnrollment = {
        id: 'enr_withdrawn',
        cohortId: 'coh_1',
        invitedEmail: 'withdrawn@test.az',
        status: EnrollmentStatus.WITHDRAWN,
        withdrawnAt: new Date('2026-10-18'),
      };
      prisma.academyEnrollment.findUnique.mockResolvedValue(withdrawnEnrollment);

      const result = await service.inviteStudents('acad_1', 'coh_1', {
        emails: ['withdrawn@test.az'],
      });

      expect(result.skippedCount).toBe(1);
      expect(prisma.academyEnrollment.update).not.toHaveBeenCalled();
      expect(prisma.academyEnrollment.create).not.toHaveBeenCalled();
      expect(result.skipped[0].reason).toBe('WITHDRAWN');
    });

    it('lists cohort students preserving privacy by default (masks identity under AGGREGATE_ONLY, exposes under IDENTIFIABLE_ROSTER)', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue({ id: 'coh_1', academyId: 'acad_1' });
      prisma.academyEnrollment.findMany.mockResolvedValue([
        {
          id: 'enr_1',
          invitedEmail: 'student1@test.az',
          status: EnrollmentStatus.ACTIVE,
          joinedAt: new Date('2026-10-15'),
          withdrawnAt: null,
          userId: 'u_student_1',
          user: { name: 'Aysel Q.', email: 'student1@test.az' },
          consents: [{ scope: ConsentScope.AGGREGATE_ONLY, grantedAt: new Date('2026-10-15'), revokedAt: null }],
        },
        {
          id: 'enr_2',
          invitedEmail: 'student2@test.az',
          status: EnrollmentStatus.ACTIVE,
          joinedAt: new Date('2026-10-16'),
          withdrawnAt: null,
          userId: 'u_student_2',
          user: { name: 'Tural M.', email: 'student2@test.az' },
          consents: [{ scope: ConsentScope.IDENTIFIABLE_ROSTER, grantedAt: new Date('2026-10-16'), revokedAt: null }],
        },
      ]);

      const list = await service.listCohortStudents('acad_1', 'coh_1');
      expect(list.length).toBe(2);

      // Student 1 (AGGREGATE_ONLY): identity is masked as null
      expect(list[0].studentName).toBeNull();
      expect(list[0].invitedEmail).toBeNull();
      expect(list[0].identityExposed).toBe(false);
      expect(list[0].consentStatus).toBe('ACTIVE');
      expect((list[0] as any).resumes).toBeUndefined();
      expect((list[0] as any).phone).toBeUndefined();

      // Student 2 (IDENTIFIABLE_ROSTER): identity is exposed
      expect(list[1].studentName).toBe('Tural M.');
      expect(list[1].invitedEmail).toBe('student2@test.az');
      expect(list[1].identityExposed).toBe(true);
      expect(list[1].consentStatus).toBe('ACTIVE');
      expect((list[1] as any).resumes).toBeUndefined();
      expect((list[1] as any).phone).toBeUndefined();
    });
  });

  describe('Student Invitation Acceptance & Consent Revocation', () => {
    it('accepts invitation and grants versioned consent', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u_new',
        email: 'valid@test.az',
        emailVerified: new Date(),
      });
      prisma.academyEnrollment.findUnique.mockResolvedValue({
        id: 'enr_1',
        academyId: 'acad_1',
        cohortId: 'coh_1',
        invitedEmail: 'valid@test.az',
        status: EnrollmentStatus.INVITED,
      });

      await service.acceptInvitation('u_new', 'tok_valid', { scope: ConsentScope.AGGREGATE_ONLY as any });

      expect(prisma.academyEnrollment.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'enr_1', status: EnrollmentStatus.INVITED, userId: null }),
        data: expect.objectContaining({ userId: 'u_new', status: EnrollmentStatus.ACTIVE }),
      });
      expect(prisma.academyConsent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          enrollmentId: 'enr_1',
          userId: 'u_new',
          academyId: 'acad_1',
          scope: ConsentScope.AGGREGATE_ONLY,
          consentTextVersion: 'v1.1',
        }),
      });
    });

    it('revoking consent sets enrollment to WITHDRAWN and revokes consent timestamp', async () => {
      prisma.academyEnrollment.findFirst.mockResolvedValue({
        id: 'enr_1',
        userId: 'u_student',
      });
      prisma.academyEnrollment.update.mockResolvedValue({
        id: 'enr_1',
        status: EnrollmentStatus.WITHDRAWN,
      });

      await service.revokeConsent('u_student', 'enr_1');

      expect(prisma.academyConsent.updateMany).toHaveBeenCalledWith({
        where: { enrollmentId: 'enr_1', userId: 'u_student', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.academyEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'enr_1' },
        data: expect.objectContaining({ status: EnrollmentStatus.WITHDRAWN }),
      });
    });
  });

  describe('Cohort KPI Engine', () => {
    it('returns empty KPIs with NOT_YET_REPORTED status when no active consented students exist', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue({
        id: 'coh_1',
        name: 'Cohort 1',
        startDate: new Date('2026-10-01'),
        endDate: new Date('2027-04-01'),
      });
      prisma.academyEnrollment.findMany.mockResolvedValue([]);
      prisma.academyEnrollment.count.mockResolvedValue(10);

      const kpis = await service.getCohortKpis('acad_1', 'coh_1');

      expect(kpis.enrolledTotal).toBeNull();
      expect(kpis.activeConsented).toBeNull();
      expect(kpis.funnel.hires.status).toBe('NOT_YET_REPORTED');
      expect(kpis.timeToFirstApplicationDays.status).toBe('NOT_YET_REPORTED');
      expect(kpis.funnel.hires.count).toBeNull();
    });

    it('suppresses sensitive outcome metrics with INSUFFICIENT_DATA when 5 students are enrolled but fewer than 5 contribute to the metric (5 enrolled / 1 outcome)', async () => {
      const start = new Date('2026-10-01');
      const end = new Date('2027-04-01');
      prisma.academyCohort.findFirst.mockResolvedValue({
        id: 'coh_1',
        name: 'Cohort 1',
        startDate: start,
        endDate: end,
      });
      prisma.academyEnrollment.findMany.mockResolvedValue([
        { userId: 'u1', joinedAt: start },
        { userId: 'u2', joinedAt: start },
        { userId: 'u3', joinedAt: start },
        { userId: 'u4', joinedAt: start },
        { userId: 'u5', joinedAt: start },
      ]);
      prisma.academyEnrollment.count.mockResolvedValue(5);

      // Student 1 prepared 2 CVs, Student 2 prepared 1
      prisma.resume.findMany.mockResolvedValue([
        { userId: 'u1', createdAt: new Date('2026-10-02') },
        { userId: 'u1', createdAt: new Date('2026-10-03') },
        { userId: 'u2', createdAt: new Date('2026-10-04') },
      ]);

      // Applications: u1 and u2 (2 distinct applicants, 3 total submitted)
      prisma.application.findMany.mockResolvedValue([{ id: 'app1', userId: 'u1', vacancyId: 'v1', createdAt: new Date('2026-10-05') }]);
      prisma.externalApplication.findMany.mockResolvedValue([{ id: 'ext1', userId: 'u2', matchId: 'm1', submittedAt: new Date('2026-10-10') }]);
      prisma.emailApplication.findMany.mockResolvedValue([{ id: 'mail1', userId: 'u1', jobUrl: 'https://example.test/job', deliveredAt: new Date('2026-10-12') }]);
      prisma.agentApplication.findMany.mockResolvedValue([]);
      prisma.applicationTrackerRecord.findMany.mockResolvedValue([]);

      // Outcomes: Only 1 student (u1) has an Interview and a Hire
      prisma.candidateOutcome.findMany.mockResolvedValue([
        { id: 'o1', userId: 'u1', outcomeType: 'JOB_STARTED', verificationStatus: 'STUDENT_ATTESTED', shareWithAcademy: true, occurredAt: new Date('2026-10-20') },
      ]);
      prisma.applicationOutcomeEvent.findMany.mockResolvedValue([
        { userId: 'u1', outcome: 'INTERVIEW', evidence: 'EMPLOYER_CONFIRMED', occurredAt: new Date('2026-10-15') },
      ]);

      const kpis = await service.getCohortKpis('acad_1', 'coh_1');

      expect(kpis.activeConsented).toBe(5);
      expect(kpis.isSuppressed).toBe(true);
      expect(kpis.minAggregationThreshold).toBe(5);
      expect(kpis.suppressionReason).toContain('anonimliyə zəmanət vermir');

      // Every sensitive detail is suppressed when its contributor count is below threshold.
      expect(kpis.preparation.activeStudents).toBeNull();
      expect(kpis.preparation.totalDocumentsPrepared).toBeNull();
      expect(kpis.applications.totalSubmitted).toBeNull();
      expect(kpis.applications.distinctStudentsApplied).toBeNull();

      // Sensitive metrics with < 5 contributors are null with an explicit suppression status.
      expect(kpis.funnel.interviews.status).toBe('INSUFFICIENT_DATA');
      expect(kpis.funnel.interviews.count).toBeNull();
      expect(kpis.funnel.interviews.distinctStudents).toBeNull();
      expect(kpis.funnel.interviews.totalEvents).toBeNull();
      expect(kpis.funnel.interviews.employerConfirmed).toBeNull();
      expect(kpis.funnel.interviews.candidateReported).toBeNull();
      expect(kpis.funnel.interviews.ratePct).toBeNull();

      expect(kpis.funnel.hires.status).toBe('INSUFFICIENT_DATA');
      expect(kpis.funnel.hires.count).toBeNull();
      expect(kpis.funnel.hires.employerConfirmed).toBeNull();
      expect(kpis.funnel.hires.candidateReported).toBeNull();
      expect(kpis.funnel.hires.ratePct).toBeNull();

      expect(kpis.funnel.jobStarted.status).toBe('INSUFFICIENT_DATA');
      expect(kpis.funnel.jobStarted.count).toBeNull();
      expect(kpis.funnel.jobStarted.distinctStudents).toBeNull();
      expect(kpis.funnel.jobStarted.totalEvents).toBeNull();

      // Time to first application is suppressed because only 2 distinct applicants (< 5 threshold)
      expect(kpis.timeToFirstApplicationDays.status).toBe('INSUFFICIENT_DATA');
      expect(kpis.timeToFirstApplicationDays.medianDays).toBeNull();

      // Data completeness is suppressed because only 1 student reported outcomes (< 5 threshold)
      expect(kpis.dataCompleteness.status).toBe('INSUFFICIENT_DATA');
      expect(kpis.dataCompleteness.studentsWithReportedOutcomes).toBeNull();
      expect(kpis.dataCompleteness.completenessPct).toBeNull();
    });

    it('reports visible MEASURED metrics when 5 students are enrolled and at least 5 distinct students contribute to each metric (5 enrolled / 5 contributors)', async () => {
      const start = new Date('2026-10-01');
      const end = new Date('2027-04-01');
      prisma.academyCohort.findFirst.mockResolvedValue({
        id: 'coh_measured',
        name: 'Cohort Measured',
        startDate: start,
        endDate: end,
      });
      prisma.academyEnrollment.findMany.mockResolvedValue([
        { userId: 'u1', joinedAt: start },
        { userId: 'u2', joinedAt: start },
        { userId: 'u3', joinedAt: start },
        { userId: 'u4', joinedAt: start },
        { userId: 'u5', joinedAt: start },
      ]);
      prisma.academyEnrollment.count.mockResolvedValue(5);

      // All 5 students prepare documents
      prisma.resume.findMany.mockResolvedValue([
        { userId: 'u1', createdAt: new Date('2026-10-02') },
        { userId: 'u2', createdAt: new Date('2026-10-02') },
        { userId: 'u3', createdAt: new Date('2026-10-02') },
        { userId: 'u4', createdAt: new Date('2026-10-02') },
        { userId: 'u5', createdAt: new Date('2026-10-02') },
      ]);

      // All 5 students apply (staggered dates)
      prisma.application.findMany.mockResolvedValue([
        { id: 'app1', userId: 'u1', vacancyId: 'v1', createdAt: new Date('2026-10-05') }, // 4 days
        { id: 'app5', userId: 'u5', vacancyId: 'v5', createdAt: new Date('2026-10-09') }, // 8 days
      ]);
      prisma.externalApplication.findMany.mockResolvedValue([
        { id: 'ext2', userId: 'u2', matchId: 'm2', submittedAt: new Date('2026-10-06') }, // 5 days
      ]);
      prisma.emailApplication.findMany.mockResolvedValue([
        { userId: 'u3', deliveredAt: new Date('2026-10-07') }, // 6 days
      ]);
      prisma.agentApplication.findMany.mockResolvedValue([
        { id: 'agent4', userId: 'u4', jobId: 'j4', submittedAt: new Date('2026-10-08') }, // 7 days
      ]);
      prisma.applicationTrackerRecord.findMany.mockResolvedValue([]);

      // All 5 students have reported interviews and hires
      prisma.candidateOutcome.findMany.mockResolvedValue([
        { id: 'o1', userId: 'u1', outcomeType: 'JOB_STARTED', verificationStatus: 'STUDENT_ATTESTED', shareWithAcademy: true, occurredAt: new Date('2026-10-20') },
        { id: 'o2', userId: 'u2', outcomeType: 'JOB_STARTED', verificationStatus: 'STUDENT_ATTESTED', shareWithAcademy: true, occurredAt: new Date('2026-10-21') },
        { id: 'o3', userId: 'u3', outcomeType: 'JOB_STARTED', verificationStatus: 'STUDENT_ATTESTED', shareWithAcademy: true, occurredAt: new Date('2026-10-22') },
        { id: 'o4', userId: 'u4', outcomeType: 'JOB_STARTED', verificationStatus: 'STUDENT_ATTESTED', shareWithAcademy: true, occurredAt: new Date('2026-10-23') },
        { id: 'o5', userId: 'u5', outcomeType: 'JOB_STARTED', verificationStatus: 'STUDENT_ATTESTED', shareWithAcademy: true, occurredAt: new Date('2026-10-24') },
      ]);
      prisma.applicationOutcomeEvent.findMany.mockResolvedValue([
        { userId: 'u1', outcome: 'INTERVIEW', evidence: 'EMPLOYER_CONFIRMED', occurredAt: new Date('2026-10-15') },
        { userId: 'u2', outcome: 'INTERVIEW', evidence: 'EMPLOYER_CONFIRMED', occurredAt: new Date('2026-10-16') },
        { userId: 'u3', outcome: 'INTERVIEW', evidence: 'EMPLOYER_CONFIRMED', occurredAt: new Date('2026-10-17') },
        { userId: 'u4', outcome: 'INTERVIEW', evidence: 'CANDIDATE_REPORTED', occurredAt: new Date('2026-10-18') },
        { userId: 'u5', outcome: 'INTERVIEW', evidence: 'CANDIDATE_REPORTED', occurredAt: new Date('2026-10-19') },
      ]);

      const kpis = await service.getCohortKpis('acad_1', 'coh_measured');

      expect(kpis.activeConsented).toBe(5);
      expect(kpis.isSuppressed).toBe(true); // Channel-level splits each have fewer than five contributors.
      expect(kpis.suppressionReason).toContain('anonimliyə zəmanət vermir');

      expect(kpis.preparation.activeStudents).toBe(5);
      expect(kpis.preparation.totalDocumentsPrepared).toBe(5);
      expect(kpis.applications.totalSubmitted).toBe(5);
      expect(kpis.applications.distinctStudentsApplied).toBe(5);

      // Sensitive metrics are MEASURED because distinct contributors = 5 >= 5
      expect(kpis.funnel.interviews.status).toBe('MEASURED');
      expect(kpis.funnel.interviews.count).toBe(5);
      expect(kpis.funnel.interviews.distinctStudents).toBe(5);
      expect(kpis.funnel.interviews.ratePct).toBe(100);
      expect(kpis.funnel.interviews.employerConfirmed).toBe(3);
      expect(kpis.funnel.interviews.candidateReported).toBe(2);

      expect(kpis.funnel.jobStarted.status).toBe('MEASURED');
      expect(kpis.funnel.jobStarted.count).toBe(5);
      expect(kpis.funnel.jobStarted.distinctStudents).toBe(5);
      expect(kpis.funnel.jobStarted.ratePct).toBe(100);
      expect(kpis.funnel.hires.status).toBe('MEASURED');
      expect(kpis.funnel.hires.count).toBe(5);
      expect(kpis.funnel.hires.ratePct).toBe(100);

      // Time to first application: [4, 5, 6, 7, 8] -> median = 6 days
      expect(kpis.timeToFirstApplicationDays.status).toBe('MEASURED');
      expect(kpis.timeToFirstApplicationDays.medianDays).toBe(6);

      // Data completeness: 5 / 5 = 100%
      expect(kpis.dataCompleteness.status).toBe('MEASURED');
      expect(kpis.dataCompleteness.studentsWithReportedOutcomes).toBe(5);
      expect(kpis.dataCompleteness.completenessPct).toBe(100);
    });

    it('includes graduated students in the bounded post-training observation window and excludes pre-enrollment activity', async () => {
      const trainingStart = new Date('2026-01-01T00:00:00.000Z');
      const trainingEnd = new Date('2026-01-31T00:00:00.000Z');
      const asOf = new Date('2026-05-15T00:00:00.000Z');
      prisma.academyCohort.findFirst.mockResolvedValue({
        id: 'coh_graduates', name: 'Graduates', startDate: trainingStart, endDate: trainingEnd,
      });
      prisma.academyEnrollment.findMany.mockResolvedValue([
        { userId: 'u1', joinedAt: trainingStart },
        { userId: 'u2', joinedAt: trainingStart },
        { userId: 'u3', joinedAt: trainingStart },
        { userId: 'u4', joinedAt: trainingStart },
        { userId: 'u5', joinedAt: new Date('2026-03-01T00:00:00.000Z'), status: EnrollmentStatus.GRADUATED },
      ]);
      prisma.academyEnrollment.count.mockResolvedValue(5);
      prisma.resume.findMany.mockResolvedValue([]);
      prisma.application.findMany.mockResolvedValue([]);
      const graduatedSubmittedAt = new Date('2026-04-15T00:00:00.000Z');
      prisma.externalApplication.findMany.mockResolvedValue([
        { id: 'late-create', userId: 'u1', matchId: 'm1', submittedAt: new Date('2026-02-01T00:00:00.000Z') },
        // This row was created before the actual submission; use submittedAt, not createdAt.
        { id: 'graduate-app', userId: 'u5', matchId: 'm5', submittedAt: graduatedSubmittedAt },
      ]);
      prisma.emailApplication.findMany.mockResolvedValue([]);
      prisma.agentApplication.findMany.mockResolvedValue([]);
      prisma.candidateOutcome.findMany.mockResolvedValue([
        { id: 'before-join', userId: 'u5', outcomeType: 'JOB_STARTED', occurredAt: new Date('2026-02-15T00:00:00.000Z') },
        { id: 'after-training', userId: 'u5', outcomeType: 'JOB_STARTED', occurredAt: new Date('2026-03-15T00:00:00.000Z') },
      ]);
      prisma.applicationOutcomeEvent.findMany.mockResolvedValue([]);

      const report = await service.getCohortKpis('acad_1', 'coh_graduates', asOf);

      expect(prisma.academyEnrollment.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.GRADUATED] } }),
      }));
      expect(report.reportingWindow.training).toEqual({ start: trainingStart.toISOString(), end: trainingEnd.toISOString() });
      expect(report.reportingWindow.observation.end).toBe('2026-05-01T00:00:00.000Z');
      expect(report.reportingWindow.asOf).toBe(asOf.toISOString());
      expect(report.reportingWindow.preEnrollmentActivity).toBe('EXCLUDED');
      expect(report.metrics.applicants.status).toBe('SUPPRESSED'); // One contributor is never exposed as a count.
      expect(report.metrics.applicants.value).toBeNull();
      expect(report.metrics.studentsStartedWork.value).toBeNull();
      expect(report.metrics.studentsStartedWork.status).toBe('SUPPRESSED');
    });

    it('prevents cross-metric inference: ensures related metrics cannot be subtracted to deduce a suppressed outcome', async () => {
      const start = new Date('2026-10-01');
      const end = new Date('2027-04-01');
      prisma.academyCohort.findFirst.mockResolvedValue({
        id: 'coh_inference',
        name: 'Inference Test Cohort',
        startDate: start,
        endDate: end,
      });
      prisma.academyEnrollment.findMany.mockResolvedValue([
        { userId: 'u1', joinedAt: start },
        { userId: 'u2', joinedAt: start },
        { userId: 'u3', joinedAt: start },
        { userId: 'u4', joinedAt: start },
        { userId: 'u5', joinedAt: start },
      ]);
      prisma.academyEnrollment.count.mockResolvedValue(5);
      prisma.resume.findMany.mockResolvedValue([]);
      prisma.application.findMany.mockResolvedValue([]);
      prisma.externalApplication.findMany.mockResolvedValue([]);
      prisma.emailApplication.findMany.mockResolvedValue([]);
      prisma.agentApplication.findMany.mockResolvedValue([]);

      // Single student u1 has 1 candidate-reported interview
      prisma.candidateOutcome.findMany.mockResolvedValue([
        { id: 'o1', userId: 'u1', outcomeType: 'INTERVIEW', verificationStatus: 'STUDENT_ATTESTED', shareWithAcademy: true, occurredAt: new Date('2026-10-20') },
      ]);
      prisma.applicationOutcomeEvent.findMany.mockResolvedValue([]);

      const kpis = await service.getCohortKpis('acad_1', 'coh_inference');

      // 1. Data completeness cross-metric inference protection:
      // If dataCompleteness leaked studentsWithReportedOutcomes = 1 while offers/hires were 0,
      // an observer could deduce (1 - 0 - 0 = 1 interview).
      // With thresholding, dataCompleteness is suppressed to INSUFFICIENT_DATA and count = 0.
      expect(kpis.dataCompleteness.status).toBe('INSUFFICIENT_DATA');
      expect(kpis.dataCompleteness.studentsWithReportedOutcomes).toBeNull();
      expect(kpis.dataCompleteness.completenessPct).toBeNull();

      // 2. Confirmation split subtraction protection:
      // In funnel.interviews, totalEvents, employerConfirmed, and candidateReported are all zeroed out
      // so subtracting totalEvents - employerConfirmed cannot yield candidateReported = 1.
      expect(kpis.funnel.interviews.totalEvents).toBeNull();
      expect(kpis.funnel.interviews.employerConfirmed).toBeNull();
      expect(kpis.funnel.interviews.candidateReported).toBeNull();
      expect(kpis.funnel.interviews.count).toBeNull();
      expect(kpis.funnel.interviews.status).toBe('INSUFFICIENT_DATA');

      // 3. Across funnel stages:
      // offers and hires are NOT_YET_REPORTED (0 contributors)
      expect(kpis.funnel.offersReceived.status).toBe('NOT_YET_REPORTED');
      expect(kpis.funnel.jobStarted.status).toBe('NOT_YET_REPORTED');

      // 4. Academy-level roll-up protection: never combine per-cohort reports in this endpoint,
      // since overlapping reports can be differenced even when each is individually suppressed.
      prisma.academyCohort.findMany.mockResolvedValue([{ id: 'coh_inference', name: 'Inference Test Cohort', startDate: new Date('2026-01-01'), endDate: new Date('2026-06-01') }]);
      prisma.academyCohort.findFirst.mockClear();
      const academyKpis = await service.getAcademyKpis('acad_1');
      expect(academyKpis.aggregate.status).toBe('SUPPRESSED');
      expect(academyKpis.aggregate.values).toBeNull();
      expect(academyKpis.cohorts).toEqual([{ id: 'coh_inference', name: 'Inference Test Cohort', trainingStart: '2026-01-01T00:00:00.000Z', trainingEnd: '2026-06-01T00:00:00.000Z' }]);
      expect(prisma.academyCohort.findFirst).not.toHaveBeenCalled();
    });

    it('suppresses sensitive outcome metrics with INSUFFICIENT_DATA when activeConsented < 5 (k-anonymity threshold)', async () => {
      const start = new Date('2026-10-01');
      const end = new Date('2027-04-01');
      prisma.academyCohort.findFirst.mockResolvedValue({
        id: 'coh_suppressed',
        name: 'Small Cohort',
        startDate: start,
        endDate: end,
      });
      // 3 active students (< 5)
      prisma.academyEnrollment.findMany.mockResolvedValue([
        { userId: 'u1', joinedAt: start },
        { userId: 'u2', joinedAt: start },
        { userId: 'u3', joinedAt: start },
      ]);
      prisma.academyEnrollment.count.mockResolvedValue(3);

      prisma.resume.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.application.findMany.mockResolvedValue([{ userId: 'u1', createdAt: new Date('2026-10-05') }]);
      prisma.candidateOutcome.findMany.mockResolvedValue([
        { userId: 'u1', stage: 'JOB_STARTED', verificationStatus: 'STUDENT_ATTESTED', shareWithAcademy: true, createdAt: new Date('2026-10-20') },
      ]);
      prisma.applicationOutcomeEvent.findMany.mockResolvedValue([
        { outcome: 'INTERVIEW', evidence: 'EMPLOYER_CONFIRMED' },
      ]);

      const kpis = await service.getCohortKpis('acad_1', 'coh_suppressed');

      expect(kpis.activeConsented).toBeNull();
      expect(kpis.isSuppressed).toBe(true);
      expect(kpis.minAggregationThreshold).toBe(5);
      expect(kpis.suppressionReason).toContain('aşkar edilməsinin qarşısını almaq');

      // Suppression applies to preparation, applications, splits, and outcomes alike.
      expect(kpis.preparation.totalDocumentsPrepared).toBeNull();
      expect(kpis.applications.totalSubmitted).toBeNull();
      expect(kpis.applications.distinctStudentsApplied).toBeNull();

      // Sensitive funnel outcomes are suppressed to 0 with INSUFFICIENT_DATA status
      expect(kpis.funnel.interviews.status).toBe('INSUFFICIENT_DATA');
      expect(kpis.funnel.interviews.count).toBeNull();
      expect(kpis.funnel.hires.status).toBe('INSUFFICIENT_DATA');
      expect(kpis.funnel.hires.count).toBeNull();
      expect(kpis.funnel.hires.ratePct).toBeNull();
      expect(kpis.timeToFirstApplicationDays.status).toBe('INSUFFICIENT_DATA');
      expect(kpis.timeToFirstApplicationDays.medianDays).toBeNull();
    });

    it('counts confirmed submission events across multiple channels for the same vacancy and separates student count from event count', async () => {
      const start = new Date('2026-10-01');
      const end = new Date('2027-04-01');
      prisma.academyCohort.findFirst.mockResolvedValue({
        id: 'coh_multi_channel',
        name: 'Multi Channel Cohort',
        startDate: start,
        endDate: end,
      });
      // 5 students so outcomes are not suppressed
      prisma.academyEnrollment.findMany.mockResolvedValue([
        { userId: 'u1', joinedAt: start },
        { userId: 'u2', joinedAt: start },
        { userId: 'u3', joinedAt: start },
        { userId: 'u4', joinedAt: start },
        { userId: 'u5', joinedAt: start },
      ]);
      prisma.academyEnrollment.count.mockResolvedValue(5);
      prisma.resume.findMany.mockResolvedValue([]);

      // u1 submitted to same vacancy via native application and email application
      prisma.application.findMany.mockResolvedValue([
        { id: 'app_1', userId: 'u1', vacancyId: 'vac_common_1', createdAt: new Date('2026-10-05') },
      ]);
      prisma.externalApplication.findMany.mockImplementation((args: any) =>
        Promise.resolve([
          { id: 'ext_1', userId: 'u2', status: 'SUBMITTED', submittedAt: new Date('2026-10-06'), createdAt: new Date('2026-10-06') },
        ]),
      );
      prisma.emailApplication.findMany.mockImplementation((args: any) =>
        Promise.resolve([
          // u1 also sent an email application to the same employer/opportunity
          { id: 'em_1', userId: 'u1', deliveryState: 'DELIVERED', deliveredAt: new Date('2026-10-07') },
        ]),
      );
      prisma.agentApplication.findMany.mockImplementation((args: any) => Promise.resolve([]));
      prisma.candidateOutcome.findMany.mockResolvedValue([]);
      prisma.applicationOutcomeEvent.findMany.mockResolvedValue([]);

      const kpis = await service.getCohortKpis('acad_1', 'coh_multi_channel');

      // Each confirmed submission event is counted in totalSubmitted (1 native + 1 external + 1 email = 3)
      // The three event details come from only two contributors in a five person cohort,
      // so the full and channel-level values must be hidden rather than rendered as zero.
      expect(kpis.applications.status).toBe('INSUFFICIENT_DATA');
      expect(kpis.applications.byChannel.native).toBeNull();
      expect(kpis.applications.byChannel.external).toBeNull();
      expect(kpis.applications.byChannel.email).toBeNull();
      expect(kpis.applications.totalSubmitted).toBeNull();
      expect(kpis.metrics.applicants.status).toBe('SUPPRESSED');
      expect(kpis.metrics.applicants.value).toBeNull();
    });

    it('correctly counts only submitted applications, strictly excluding drafts, failed/cancelled items, unconfirmed deliveries, agent dry runs, and ApplicationTrackerRecord overlays', async () => {
      const start = new Date('2026-10-01');
      const end = new Date('2027-04-01');
      prisma.academyCohort.findFirst.mockResolvedValue({
        id: 'coh_kpi_filter',
        name: 'Cohort Filter Test',
        startDate: start,
        endDate: end,
      });
      prisma.academyEnrollment.findMany.mockResolvedValue([
        { userId: 'u1', joinedAt: start },
        { userId: 'u2', joinedAt: start },
        { userId: 'u3', joinedAt: start },
      ]);
      prisma.academyEnrollment.count.mockResolvedValue(3);
      prisma.resume.findMany.mockResolvedValue([]);

      // 1. Native applications (only submitted count)
      prisma.application.findMany.mockResolvedValue([
        { userId: 'u1', createdAt: new Date('2026-10-05') },
        { userId: 'u2', createdAt: new Date('2026-10-06') },
      ]);

      // 2. External applications: fixture contains SUBMITTED, DRAFT, SUBMITTED_DRY_RUN, FAILED, CANCELLED, AWAITING_OTP, DELIVERY_UNCONFIRMED
      const rawExternalApps = [
        { id: 'ext_1', userId: 'u1', status: 'SUBMITTED', submittedAt: new Date('2026-10-07'), createdAt: new Date('2026-10-07') },
        { id: 'ext_2', userId: 'u1', status: 'DRAFT', submittedAt: null, createdAt: new Date('2026-10-07') },
        { id: 'ext_3', userId: 'u2', status: 'SUBMITTED_DRY_RUN', submittedAt: new Date('2026-10-08'), createdAt: new Date('2026-10-08') },
        { id: 'ext_4', userId: 'u2', status: 'FAILED', submittedAt: null, createdAt: new Date('2026-10-08') },
        { id: 'ext_5', userId: 'u3', status: 'CANCELLED', submittedAt: null, createdAt: new Date('2026-10-09') },
        { id: 'ext_6', userId: 'u3', status: 'AWAITING_OTP', submittedAt: null, createdAt: new Date('2026-10-09') },
        { id: 'ext_7', userId: 'u3', status: 'DELIVERY_UNCONFIRMED', submittedAt: null, createdAt: new Date('2026-10-09') },
      ];
      prisma.externalApplication.findMany.mockImplementation((args: any) => {
        // Enforce the query where condition: status must be SUBMITTED
        expect(args.where.status).toBe('SUBMITTED');
        return Promise.resolve(rawExternalApps.filter((a) => a.status === args.where.status));
      });

      // 3. Email applications: fixture contains DELIVERED, DRAFT, AWAITING_APPROVAL, QUEUED, PROVIDER_ACCEPTED, BOUNCED, FAILED
      const rawEmailApps = [
        { id: 'em_1', userId: 'u2', deliveryState: 'DELIVERED', deliveredAt: new Date('2026-10-10') },
        { id: 'em_2', userId: 'u1', deliveryState: 'DRAFT', deliveredAt: null },
        { id: 'em_3', userId: 'u1', deliveryState: 'AWAITING_APPROVAL', deliveredAt: null },
        { id: 'em_4', userId: 'u1', deliveryState: 'QUEUED', deliveredAt: null },
        { id: 'em_5', userId: 'u2', deliveryState: 'PROVIDER_ACCEPTED', deliveredAt: null },
        { id: 'em_6', userId: 'u3', deliveryState: 'BOUNCED', deliveredAt: null },
        { id: 'em_7', userId: 'u3', deliveryState: 'FAILED', deliveredAt: null },
      ];
      prisma.emailApplication.findMany.mockImplementation((args: any) => {
        // Enforce the query where condition: deliveryState must be DELIVERED
        expect(args.where.deliveryState).toBe('DELIVERED');
        return Promise.resolve(rawEmailApps.filter((e) => e.deliveryState === args.where.deliveryState));
      });

      // 4. Agent applications: fixture contains SUBMITTED, QUEUED, CANCELLED, FAILED
      const rawAgentApps = [
        { id: 'ag_1', userId: 'u3', state: 'SUBMITTED', submittedAt: new Date('2026-10-12'), createdAt: new Date('2026-10-12') },
        { id: 'ag_2', userId: 'u1', state: 'QUEUED', submittedAt: null, createdAt: new Date('2026-10-12') },
        { id: 'ag_3', userId: 'u2', state: 'CANCELLED', submittedAt: null, createdAt: new Date('2026-10-12') },
        { id: 'ag_4', userId: 'u2', state: 'FAILED', submittedAt: null, createdAt: new Date('2026-10-12') },
      ];
      prisma.agentApplication.findMany.mockImplementation((args: any) => {
        // Enforce the query where condition: state must be SUBMITTED
        expect(args.where.state).toBe('SUBMITTED');
        return Promise.resolve(rawAgentApps.filter((a) => a.state === args.where.state));
      });

      // 5. ApplicationTrackerRecord overlays: should never be queried or added to count
      const trackerFindSpy = jest.fn();
      (prisma as any).applicationTrackerRecord = { findMany: trackerFindSpy };

      prisma.candidateOutcome.findMany.mockResolvedValue([]);
      prisma.applicationOutcomeEvent.findMany.mockResolvedValue([]);

      const kpis = await service.getCohortKpis('acad_1', 'coh_kpi_filter');

      // Verify channel breakdown:
      expect(kpis.applications.status).toBe('INSUFFICIENT_DATA');
      expect(kpis.applications.byChannel.native).toBeNull();
      expect(kpis.applications.byChannel.external).toBeNull(); // ext_1 only (SUBMITTED), suppressed
      expect(kpis.applications.byChannel.email).toBeNull(); // em_1 only (DELIVERED), suppressed
      expect(kpis.applications.byChannel.browserAgent).toBeNull(); // ag_1 only (SUBMITTED), suppressed
      expect(kpis.applications.byChannel.manualTracker).toBe(0); // tracker overlays excluded

      // Tracker overlay model was not queried
      expect(trackerFindSpy).not.toHaveBeenCalled();

      // Total submitted: 2 + 1 + 1 + 1 = 5
      expect(kpis.applications.totalSubmitted).toBeNull();

      // Distinct students applied: u1 (native, external), u2 (native, email), u3 (agent) = 3 unique students
      expect(kpis.applications.distinctStudentsApplied).toBeNull();
    });
  });
});
