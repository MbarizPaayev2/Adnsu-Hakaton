import { AcademyService } from './academy.service';
import { AcademyTenantGuard } from './guards/academy-tenant.guard';
import { Reflector } from '@nestjs/core';
import { AcademyRole, CohortStatus, ConsentScope, EnrollmentStatus } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('Academy Multi-Tenant Isolation & Adversarial Security Suite', () => {
  let service: AcademyService;
  let guard: AcademyTenantGuard;
  let reflector: Reflector;
  let prisma: any;

  // Synthetic Fixtures for TWO independent academies
  const academyHolberton = {
    id: 'acad_holberton',
    name: 'Holberton School Baku',
    slug: 'holberton-baku',
    status: 'ACTIVE',
  };

  const academyCode = {
    id: 'acad_code_academy',
    name: 'Code Academy Azerbaijan',
    slug: 'code-academy-az',
    status: 'ACTIVE',
  };

  const cohortHolbertonSE = {
    id: 'coh_holberton_se',
    academyId: academyHolberton.id,
    name: 'Software Engineering 2026',
    slug: 'se-2026',
    startDate: new Date('2026-09-01'),
    endDate: new Date('2027-03-01'),
    status: CohortStatus.ACTIVE,
  };

  const cohortCodeFullStack = {
    id: 'coh_code_fs',
    academyId: academyCode.id,
    name: 'Full Stack Web 2026',
    slug: 'fs-2026',
    startDate: new Date('2026-10-01'),
    endDate: new Date('2027-04-01'),
    status: CohortStatus.ACTIVE,
  };

  beforeEach(() => {
    reflector = new Reflector();
    prisma = {
      $transaction: jest.fn((cb) => cb(prisma)),
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 'user_wrong') return Promise.resolve({ id: 'user_wrong', email: 'wrong@test.az', emailVerified: new Date() });
          if (where.id === 'user_unverified') return Promise.resolve({ id: 'user_unverified', email: 'coach@test.az', emailVerified: null });
          if (where.id === 'user_student_unverified') return Promise.resolve({ id: 'user_student_unverified', email: 'student@test.az', emailVerified: null });
          if (where.id === 'user_late') return Promise.resolve({ id: 'user_late', email: 'late@test.az', emailVerified: new Date() });
          if (where.id === 'user_replay') return Promise.resolve({ id: 'user_replay', email: 'used@test.az', emailVerified: new Date() });
          if (where.id === 'user_hacker') return Promise.resolve({ id: 'user_hacker', email: 'hacker@test.az', emailVerified: new Date() });
          if (where.id === 'user_coach') return Promise.resolve({ id: 'user_coach', email: 'coach@test.az', emailVerified: new Date() });
          if (where.id === 'user_student') return Promise.resolve({ id: 'user_student', email: 'student@test.az', emailVerified: new Date() });
          return Promise.resolve({ id: where.id, email: 'user@test.az', emailVerified: new Date() });
        }),
      },
      academy: {
        findUnique: jest.fn(),
      },
      academyMember: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
        upsert: jest.fn(),
      },
      academyCohort: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      academyEnrollment: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      academyConsent: {
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      academyStaffInvitation: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      candidateOutcome: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      resume: { findMany: jest.fn().mockResolvedValue([]) },
      application: { findMany: jest.fn().mockResolvedValue([]) },
      externalApplication: { findMany: jest.fn().mockResolvedValue([]) },
      emailApplication: { findMany: jest.fn().mockResolvedValue([]) },
      agentApplication: { findMany: jest.fn().mockResolvedValue([]) },
      applicationTrackerRecord: { findMany: jest.fn().mockResolvedValue([]) },
      applicationOutcomeEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };

    service = new AcademyService(prisma);
    guard = new AcademyTenantGuard(reflector, prisma);
  });

  const mockContext = (user: any, params: any = {}, headers: any = {}) => ({
    switchToHttp: () => ({ getRequest: () => ({ user, params, headers }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any);

  describe('Adversarial Cross-Academy Access Rejection', () => {
    it('blocks Holberton staff from reading Code Academy workspace via tenant guard', async () => {
      // Holberton owner tries to access Code Academy
      prisma.academyMember.findUnique.mockResolvedValue(null);
      const context = mockContext({ id: 'user_holberton_owner' }, { academyId: academyCode.id });

      await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
    });

    it('blocks Holberton staff from querying Code Academy cohorts via Service', async () => {
      // findFirst enforces where: { id: cohortId, academyId }
      prisma.academyCohort.findFirst.mockResolvedValue(null);

      await expect(
        service.getCohort(academyHolberton.id, cohortCodeFullStack.id),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.academyCohort.findFirst).toHaveBeenCalledWith({
        where: { id: cohortCodeFullStack.id, academyId: academyHolberton.id },
        include: expect.any(Object),
      });
    });

    it('blocks Holberton staff from inviting students into Code Academy cohort', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue(null);

      await expect(
        service.inviteStudents(academyHolberton.id, cohortCodeFullStack.id, {
          emails: ['attacker@test.az'],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('blocks Holberton staff from accessing Code Academy student rosters', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue(null);

      await expect(
        service.listCohortStudents(academyHolberton.id, cohortCodeFullStack.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('blocks Holberton staff from reading Code Academy KPIs', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue(null);

      await expect(
        service.getCohortKpis(academyHolberton.id, cohortCodeFullStack.id),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Role-Based Authorization Boundaries', () => {
    it('prevents COACH role from inviting staff or performing owner actions', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AcademyRole.OWNER, AcademyRole.ADMIN]);

      prisma.academyMember.findUnique.mockResolvedValue({
        id: 'mem_coach',
        academyId: academyHolberton.id,
        userId: 'user_coach',
        role: AcademyRole.COACH,
        academy: academyHolberton,
      });

      const context = mockContext({ id: 'user_coach' }, { academyId: academyHolberton.id });
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('allows ADMIN role to manage cohorts and invite students', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AcademyRole.OWNER, AcademyRole.ADMIN]);

      prisma.academyMember.findUnique.mockResolvedValue({
        id: 'mem_admin',
        academyId: academyHolberton.id,
        userId: 'user_admin',
        role: AcademyRole.ADMIN,
        academy: academyHolberton,
      });

      const context = mockContext({ id: 'user_admin' }, { academyId: academyHolberton.id });
      expect(await guard.canActivate(context)).toBe(true);
    });
  });

  describe('Consent Revocation & Student Privacy Enactment', () => {
    it('immediately hides individual records when student revokes consent', async () => {
      prisma.academyEnrollment.findFirst.mockResolvedValue({
        id: 'enr_student_1',
        academyId: academyHolberton.id,
        userId: 'user_student_1',
      });
      prisma.academyEnrollment.update.mockResolvedValue({
        id: 'enr_student_1',
        status: EnrollmentStatus.WITHDRAWN,
      });

      await service.revokeConsent('user_student_1', 'enr_student_1');

      // Both consent and enrollment status are revoked/withdrawn in transaction
      expect(prisma.academyConsent.updateMany).toHaveBeenCalledWith({
        where: { enrollmentId: 'enr_student_1', userId: 'user_student_1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.academyEnrollment.update).toHaveBeenCalledWith({
        where: { id: 'enr_student_1' },
        data: expect.objectContaining({ status: EnrollmentStatus.WITHDRAWN }),
      });
    });

    it('excludes revoked students from active KPI calculation denominator', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue(cohortHolbertonSE);
      // Prisma query for active students filters revokedAt: null
      prisma.academyEnrollment.findMany.mockImplementation((q) => {
        if (q.where?.consents?.some?.revokedAt === null) {
          // Only student 1 has active consent; student 2 revoked
          return Promise.resolve([{ userId: 'user_active_student', joinedAt: new Date() }]);
        }
        return Promise.resolve([]);
      });
      prisma.academyEnrollment.count.mockResolvedValue(2); // total enrolled 2, active consented 1

      const kpis = await service.getCohortKpis(academyHolberton.id, cohortHolbertonSE.id);

      expect(kpis.enrolledTotal).toBeNull();
      expect(kpis.activeConsented).toBeNull();
    });

    it('ensures revoked consent completely removes candidate-reported outcomes from future cohort reports', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue(cohortHolbertonSE);
      // Keep outcome timestamps inside the observation cutoff. Using separate
      // new Date() calls here made the outcome land a few milliseconds after
      // the service's default asOf during slower/full-suite runs.
      const joinedAt = new Date('2026-10-01T09:00:00.000Z');
      const occurredAt = new Date('2026-10-15T09:00:00.000Z');
      prisma.academyEnrollment.findMany.mockImplementation((q) => {
        if (q.where?.consents?.some?.revokedAt === null) {
          // Student 2 revoked consent; 5 other students remain active (so cohort >= threshold 5)
          return Promise.resolve([
            { userId: 'user_consented_student_1', joinedAt },
            { userId: 'user_consented_student_3', joinedAt },
            { userId: 'user_consented_student_4', joinedAt },
            { userId: 'user_consented_student_5', joinedAt },
            { userId: 'user_consented_student_6', joinedAt },
          ]);
        }
        return Promise.resolve([]);
      });
      prisma.academyEnrollment.count.mockResolvedValue(6);

      // 5 active consented students have interviews; Student 2 (revoked) has an offer and hire
      prisma.candidateOutcome.findMany.mockImplementation((q: any) => {
        const userIds = q.where?.userId?.in || [];
        const outcomes = [];
        for (const uid of [
          'user_consented_student_1',
          'user_consented_student_3',
          'user_consented_student_4',
          'user_consented_student_5',
          'user_consented_student_6',
        ]) {
          if (userIds.includes(uid)) {
            outcomes.push({
              id: `o_${uid}`,
              userId: uid,
              outcomeType: 'INTERVIEW',
              stage: 'INTERVIEWS',
              verificationStatus: 'STUDENT_ATTESTED',
              occurredAt,
              shareWithAcademy: true,
            });
          }
        }
        return Promise.resolve(outcomes);
      });

      const kpis = await service.getCohortKpis(academyHolberton.id, cohortHolbertonSE.id, new Date('2026-10-27T18:00:00.000Z'));

      expect(kpis.activeConsented).toBe(5);
      expect(kpis.isSuppressed).toBe(false);

      // All 5 active students' interviews are measured (k-anonymity met)
      expect(kpis.funnel.interviews.count).toBe(5);
      expect(kpis.funnel.interviews.status).toBe('MEASURED');
      // Student 2 (revoked) offer and hire are completely excluded
      expect(kpis.funnel.offers.count).toBeNull();
      expect(kpis.funnel.hires.count).toBeNull();
      expect(kpis.funnel.hires.status).toBe('NOT_YET_REPORTED');
    });
  });

  describe('Expired, Replayed & Concurrent Invitations', () => {
    it('rejects expired staff invitation tokens', async () => {
      prisma.academyStaffInvitation.findUnique.mockResolvedValue({
        id: 'inv_expired',
        academyId: academyHolberton.id,
        email: 'late@test.az',
        role: AcademyRole.COACH,
        token: 'tok_expired',
        expiresAt: new Date(Date.now() - 86_400_000), // expired yesterday
        acceptedAt: null,
      });

      await expect(
        service.acceptStaffInvitation('user_late', 'tok_expired'),
      ).rejects.toThrow('Dəvətin vaxtı bitib');
    });

    it('rejects already accepted staff invitation tokens', async () => {
      prisma.academyStaffInvitation.findUnique.mockResolvedValue({
        id: 'inv_accepted',
        academyId: academyHolberton.id,
        email: 'used@test.az',
        role: AcademyRole.COACH,
        token: 'tok_replayed',
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: new Date(Date.now() - 3600_000), // already accepted an hour ago
      });

      await expect(
        service.acceptStaffInvitation('user_replay', 'tok_replayed'),
      ).rejects.toThrow('Bu dəvət artıq qəbul edilib');
    });

    it('rejects staff invitation if authenticated user has unverified email', async () => {
      prisma.academyStaffInvitation.findUnique.mockResolvedValue({
        id: 'inv_staff_unverified',
        academyId: academyHolberton.id,
        email: 'coach@test.az',
        role: AcademyRole.COACH,
        token: 'tok_staff_unverified',
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: null,
      });

      await expect(
        service.acceptStaffInvitation('user_unverified', 'tok_staff_unverified'),
      ).rejects.toThrow('Dəvəti qəbul etmək üçün əvvəlcə e-poçt ünvanınızı təsdiqləyin');
    });

    it('rejects staff invitation if authenticated user email does not match invitation email', async () => {
      prisma.academyStaffInvitation.findUnique.mockResolvedValue({
        id: 'inv_staff_wrong',
        academyId: academyHolberton.id,
        email: 'coach@test.az',
        role: AcademyRole.COACH,
        token: 'tok_staff_wrong',
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: null,
      });

      await expect(
        service.acceptStaffInvitation('user_wrong', 'tok_staff_wrong'),
      ).rejects.toThrow('Bu dəvət başqa e-poçt ünvanına göndərilib');
    });

    it('accepts staff invitation case-insensitively when emails match', async () => {
      prisma.academyStaffInvitation.findUnique.mockResolvedValue({
        id: 'inv_staff_case',
        academyId: academyHolberton.id,
        email: 'COACH@TEST.AZ', // uppercase in invitation
        role: AcademyRole.COACH,
        token: 'tok_staff_case',
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: null,
      });
      prisma.academyStaffInvitation.updateMany.mockResolvedValue({ count: 1 });
      prisma.academyMember.upsert.mockResolvedValue({
        id: 'mem_1',
        academyId: academyHolberton.id,
        userId: 'user_coach',
        role: AcademyRole.COACH,
      });

      const res = await service.acceptStaffInvitation('user_coach', 'tok_staff_case');
      expect(res.role).toBe(AcademyRole.COACH);
      expect(prisma.academyStaffInvitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'inv_staff_case', acceptedAt: null }),
        }),
      );
    });

    it('rejects simultaneous/concurrent staff acceptance attempts when updateMany yields count 0', async () => {
      prisma.academyStaffInvitation.findUnique.mockResolvedValue({
        id: 'inv_staff_concurrent',
        academyId: academyHolberton.id,
        email: 'coach@test.az',
        role: AcademyRole.COACH,
        token: 'tok_staff_concurrent',
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: null,
      });
      // Simulate race condition where another concurrent transaction won the updateMany
      prisma.academyStaffInvitation.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.acceptStaffInvitation('user_coach', 'tok_staff_concurrent'),
      ).rejects.toThrow('Bu dəvət artıq qəbul edilib və ya vaxtı bitib');
    });

    it('rejects replaying an already accepted student enrollment invitation', async () => {
      prisma.academyEnrollment.findUnique.mockResolvedValue({
        id: 'enr_used',
        academyId: academyHolberton.id,
        cohortId: cohortHolbertonSE.id,
        invitedEmail: 'hacker@test.az',
        status: EnrollmentStatus.ACTIVE,
        userId: 'user_already_enrolled',
        inviteToken: 'tok_student_replay',
      });

      await expect(
        service.acceptEnrollment('user_hacker', 'tok_student_replay'),
      ).rejects.toThrow('Bu dəvət artıq qəbul edilib');
    });

    it('rejects student invitation if authenticated user has unverified email', async () => {
      prisma.academyEnrollment.findUnique.mockResolvedValue({
        id: 'enr_unverified',
        academyId: academyHolberton.id,
        cohortId: cohortHolbertonSE.id,
        invitedEmail: 'student@test.az',
        status: EnrollmentStatus.INVITED,
        inviteToken: 'tok_student_unverified',
      });

      await expect(
        service.acceptInvitation('user_student_unverified', 'tok_student_unverified'),
      ).rejects.toThrow('Dəvəti qəbul etmək üçün əvvəlcə e-poçt ünvanınızı təsdiqləyin');
    });

    it('rejects student invitation if authenticated user email does not match invited email', async () => {
      prisma.academyEnrollment.findUnique.mockResolvedValue({
        id: 'enr_wrong_email',
        academyId: academyHolberton.id,
        cohortId: cohortHolbertonSE.id,
        invitedEmail: 'student@test.az',
        status: EnrollmentStatus.INVITED,
        inviteToken: 'tok_student_wrong',
      });

      await expect(
        service.acceptInvitation('user_wrong', 'tok_student_wrong'),
      ).rejects.toThrow('Bu dəvət başqa e-poçt ünvanına göndərilib');
    });

    it('accepts student invitation case-insensitively when emails match', async () => {
      prisma.academyEnrollment.findUnique.mockResolvedValue({
        id: 'enr_case',
        academyId: academyHolberton.id,
        cohortId: cohortHolbertonSE.id,
        invitedEmail: 'STUDENT@TEST.AZ', // uppercase in enrollment
        status: EnrollmentStatus.INVITED,
        inviteToken: 'tok_student_case',
      });
      prisma.academyEnrollment.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.acceptInvitation('user_student', 'tok_student_case', { scope: ConsentScope.AGGREGATE_ONLY as any });
      expect(res.status).toBe(EnrollmentStatus.ACTIVE);
      expect(prisma.academyEnrollment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'enr_case', status: EnrollmentStatus.INVITED, userId: null }),
        }),
      );
    });

    it('simulates rejection of concurrent student acceptance attempts when updateMany yields count 0 (see real PostgreSQL integration test for live race check)', async () => {
      prisma.academyEnrollment.findUnique.mockResolvedValue({
        id: 'enr_concurrent',
        academyId: academyHolberton.id,
        cohortId: cohortHolbertonSE.id,
        invitedEmail: 'student@test.az',
        status: EnrollmentStatus.INVITED,
        inviteToken: 'tok_student_concurrent',
      });
      // Simulate simultaneous acceptance where another thread updated the row first
      prisma.academyEnrollment.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.acceptInvitation('user_student', 'tok_student_concurrent'),
      ).rejects.toThrow('Bu dəvət artıq qəbul edilib və ya etibarsızdır');
    });

    it('rejects student invitation lookup by token when expired', async () => {
      prisma.academyEnrollment.findUnique.mockResolvedValue({
        id: 'enr_expired',
        academyId: academyHolberton.id,
        cohortId: cohortHolbertonSE.id,
        invitedEmail: 'student@test.az',
        status: EnrollmentStatus.INVITED,
        inviteToken: 'tok_expired_student',
        expiresAt: new Date(Date.now() - 3600_000), // 1 hour ago
      });

      await expect(
        service.getInvitationByToken('tok_expired_student'),
      ).rejects.toThrow('Dəvətin vaxtı bitib');
    });

    it('rejects student invitation acceptance when expired', async () => {
      prisma.academyEnrollment.findUnique.mockResolvedValue({
        id: 'enr_expired_accept',
        academyId: academyHolberton.id,
        cohortId: cohortHolbertonSE.id,
        invitedEmail: 'student@test.az',
        status: EnrollmentStatus.INVITED,
        inviteToken: 'tok_expired_accept',
        expiresAt: new Date(Date.now() - 3600_000), // 1 hour ago
      });

      await expect(
        service.acceptInvitation('user_student', 'tok_expired_accept'),
      ).rejects.toThrow('Dəvətin vaxtı bitib');
    });
  });

  describe('Member Removal & Destruction Safety', () => {
    it('allows OWNER to remove another member from the academy', async () => {
      prisma.academyMember.findUnique.mockResolvedValue({
        id: 'mem_coach',
        academyId: academyHolberton.id,
        userId: 'user_coach',
        role: AcademyRole.COACH,
      });
      prisma.academyMember.delete.mockResolvedValue({});

      const res = await service.removeMember(academyHolberton.id, 'mem_coach');
      expect(res.success).toBe(true);
      expect(prisma.academyMember.delete).toHaveBeenCalledWith({ where: { id: 'mem_coach' } });
    });

    it('prevents removing the sole remaining OWNER of an academy', async () => {
      prisma.academyMember.findUnique.mockResolvedValue({
        id: 'mem_sole_owner',
        academyId: academyHolberton.id,
        userId: 'user_owner',
        role: AcademyRole.OWNER,
      });
      prisma.academyMember.count.mockResolvedValue(1); // only 1 owner left

      await expect(
        service.removeMember(academyHolberton.id, 'mem_sole_owner'),
      ).rejects.toThrow('Akademiyanın yeganə sahibini silmək mümkün deyil');
    });
  });

  describe('Student Privacy Barrier & Protected Roster Inspection', () => {
    it('exposes student identity strictly under active IDENTIFIABLE_ROSTER consent, while omitting private CV, letters, phone, and notes', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue(cohortHolbertonSE);
      prisma.academyEnrollment.findMany.mockResolvedValue([
        {
          id: 'enr_nihad',
          invitedEmail: 'nihad@test.az',
          status: EnrollmentStatus.ACTIVE,
          joinedAt: new Date('2026-10-01'),
          withdrawnAt: null,
          user: {
            id: 'user_nihad',
            name: 'Nihad Əliyev',
            email: 'nihad@test.az',
            // Simulated private DB fields that must NEVER leak to the academy roster
            profile: { phone: '+994501234567', privateNotes: 'Salary goal: 3000' },
            resumes: [{ text: 'Secret resume content with confidential past employers' }],
          },
          consents: [{ scope: ConsentScope.IDENTIFIABLE_ROSTER, revokedAt: null }],
        },
      ]);

      const roster = await service.listCohortStudents(academyHolberton.id, cohortHolbertonSE.id);

      expect(roster.length).toBe(1);
      const studentItem = roster[0] as any;

      // Identity fields exposed because consent is IDENTIFIABLE_ROSTER
      expect(studentItem.id).toBe('enr_nihad');
      expect(studentItem.invitedEmail).toBe('nihad@test.az');
      expect(studentItem.status).toBe(EnrollmentStatus.ACTIVE);
      expect(studentItem.studentName).toBe('Nihad Əliyev');
      expect(studentItem.consentActive).toBe(true);
      expect(studentItem.identityExposed).toBe(true);
      expect(studentItem.consentScope).toBe(ConsentScope.IDENTIFIABLE_ROSTER);

      // Strict Privacy Safeguard: Private details MUST NOT be exposed
      expect(studentItem.phone).toBeUndefined();
      expect(studentItem.privateNotes).toBeUndefined();
      expect(studentItem.resumes).toBeUndefined();
      expect(studentItem.resumeText).toBeUndefined();
      expect(studentItem.coverLetters).toBeUndefined();
      expect(studentItem.notes).toBeUndefined();
      expect(studentItem.profile).toBeUndefined();
    });

    it('strictly masks student identity under AGGREGATE_ONLY consent (studentName: null, invitedEmail: null, identityExposed: false)', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue(cohortHolbertonSE);
      prisma.academyEnrollment.findMany.mockResolvedValue([
        {
          id: 'enr_anon',
          invitedEmail: 'anon@test.az',
          status: EnrollmentStatus.ACTIVE,
          joinedAt: new Date('2026-10-01'),
          withdrawnAt: null,
          user: {
            id: 'user_anon',
            name: 'Gizli Tələbə',
            email: 'anon@test.az',
          },
          consents: [{ scope: ConsentScope.AGGREGATE_ONLY, revokedAt: null }],
        },
      ]);

      const roster = await service.listCohortStudents(academyHolberton.id, cohortHolbertonSE.id);

      expect(roster.length).toBe(1);
      const studentItem = roster[0] as any;

      // Identity fields strictly withheld under AGGREGATE_ONLY
      expect(studentItem.id).toBe('enr_anon');
      expect(studentItem.studentName).toBeNull();
      expect(studentItem.invitedEmail).toBeNull();
      expect(studentItem.identityExposed).toBe(false);
      expect(studentItem.consentActive).toBe(true);
      expect(studentItem.consentScope).toBe(ConsentScope.AGGREGATE_ONLY);
    });

    it('withholds/masks student name and email when student has not granted active consent (e.g. status NONE)', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue(cohortHolbertonSE);
      prisma.academyEnrollment.findMany.mockResolvedValue([
        {
          id: 'enr_pending',
          invitedEmail: 'pending_student@test.az',
          status: EnrollmentStatus.INVITED,
          joinedAt: null,
          withdrawnAt: null,
          user: null,
          consents: [], // No consent granted
        },
      ]);

      const roster = await service.listCohortStudents(academyHolberton.id, cohortHolbertonSE.id);

      expect(roster.length).toBe(1);
      const studentItem = roster[0];

      expect(studentItem.consentActive).toBe(false);
      expect(studentItem.consentStatus).toBe('NONE');
      // Identity fields must be withheld (null) without active consent
      expect(studentItem.studentName).toBeNull();
      expect(studentItem.invitedEmail).toBeNull();
    });

    it('withholds/masks student name and email when student has revoked consent (status REVOKED)', async () => {
      prisma.academyCohort.findFirst.mockResolvedValue(cohortHolbertonSE);
      prisma.academyEnrollment.findMany.mockResolvedValue([
        {
          id: 'enr_revoked',
          invitedEmail: 'revoked_student@test.az',
          status: EnrollmentStatus.ACTIVE,
          joinedAt: new Date('2026-10-01'),
          withdrawnAt: null,
          user: {
            id: 'u_revoked',
            name: 'Aygün M.',
            email: 'revoked_student@test.az',
          },
          consents: [
            {
              scope: ConsentScope.AGGREGATE_ONLY,
              revokedAt: new Date('2026-10-15'), // Revoked!
            },
          ],
        },
      ]);

      const roster = await service.listCohortStudents(academyHolberton.id, cohortHolbertonSE.id);

      expect(roster.length).toBe(1);
      const studentItem = roster[0];

      expect(studentItem.consentActive).toBe(false);
      expect(studentItem.consentStatus).toBe('REVOKED');
      // Identity fields must be withheld (null) when consent is revoked
      expect(studentItem.studentName).toBeNull();
      expect(studentItem.invitedEmail).toBeNull();
    });
  });
});
