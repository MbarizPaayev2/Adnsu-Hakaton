import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CandidateOutcomesService } from './candidate-outcomes.service';
import { CandidateOutcomeType, OutcomeVerificationStatus } from '@prisma/client';

describe('CandidateOutcomesService', () => {
  let service: CandidateOutcomesService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      candidateOutcome: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new CandidateOutcomesService(prisma);
  });

  describe('reportOutcome', () => {
    it('creates a candidate-reported outcome with student-attested verification defaulting shareWithAcademy to false (strict opt-in)', async () => {
      const now = new Date();
      prisma.candidateOutcome.create.mockResolvedValue({
        id: 'out-1',
        userId: 'u1',
        outcomeType: CandidateOutcomeType.OFFER_RECEIVED,
        occurredAt: now,
        verificationStatus: OutcomeVerificationStatus.STUDENT_ATTESTED,
        shareWithAcademy: false,
        withdrawnAt: null,
        createdAt: now,
      });

      const res = await service.reportOutcome('u1', {
        outcomeType: CandidateOutcomeType.OFFER_RECEIVED,
        occurredAt: now.toISOString(),
        jobTitle: 'Junior Frontend Developer',
        companyName: 'PASHA Bank',
      });

      expect(res.id).toBe('out-1');
      expect(res.provenance).toBe('CANDIDATE_REPORTED');
      expect(res.verificationStatus).toBe(OutcomeVerificationStatus.STUDENT_ATTESTED);
      expect(res.shareWithAcademy).toBe(false);
      expect(prisma.candidateOutcome.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            outcomeType: CandidateOutcomeType.OFFER_RECEIVED,
            jobTitle: 'Junior Frontend Developer',
            companyName: 'PASHA Bank',
            verificationStatus: OutcomeVerificationStatus.STUDENT_ATTESTED,
            shareWithAcademy: false,
          }),
        }),
      );
    });

    it('persists shareWithAcademy: true when candidate affirmatively opts in', async () => {
      const now = new Date();
      prisma.candidateOutcome.create.mockResolvedValue({
        id: 'out-optin',
        userId: 'u1',
        outcomeType: CandidateOutcomeType.JOB_STARTED,
        occurredAt: now,
        verificationStatus: OutcomeVerificationStatus.STUDENT_ATTESTED,
        shareWithAcademy: true,
        withdrawnAt: null,
        createdAt: now,
      });

      const res = await service.reportOutcome('u1', {
        outcomeType: CandidateOutcomeType.JOB_STARTED,
        occurredAt: now.toISOString(),
        jobTitle: 'Junior Developer',
        companyName: 'PASHA Bank',
        shareWithAcademy: true,
      });

      expect(res.shareWithAcademy).toBe(true);
      expect(prisma.candidateOutcome.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shareWithAcademy: true,
          }),
        }),
      );
    });

    it('rejects candidate attempts to create outcomes with EMPLOYER_CONFIRMED status', async () => {
      await expect(
        service.reportOutcome('u1', {
          outcomeType: CandidateOutcomeType.JOB_STARTED,
          occurredAt: new Date().toISOString(),
          jobTitle: 'Lead Engineer',
          verificationStatus: OutcomeVerificationStatus.EMPLOYER_CONFIRMED as any,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.candidateOutcome.create).not.toHaveBeenCalled();
    });

    it('allows candidate to create unverified outcomes when explicitly requested', async () => {
      const now = new Date();
      prisma.candidateOutcome.create.mockResolvedValue({
        id: 'out-unverified',
        userId: 'u1',
        outcomeType: CandidateOutcomeType.INTERVIEW,
        occurredAt: now,
        verificationStatus: OutcomeVerificationStatus.UNVERIFIED,
        shareWithAcademy: true,
        withdrawnAt: null,
        createdAt: now,
      });

      const res = await service.reportOutcome('u1', {
        outcomeType: CandidateOutcomeType.INTERVIEW,
        occurredAt: now.toISOString(),
        verificationStatus: OutcomeVerificationStatus.UNVERIFIED,
      });

      expect(res.verificationStatus).toBe(OutcomeVerificationStatus.UNVERIFIED);
      expect(prisma.candidateOutcome.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            verificationStatus: OutcomeVerificationStatus.UNVERIFIED,
          }),
        }),
      );
    });

    it('rejects outcome dates set in the future', async () => {
      const futureDate = new Date(Date.now() + 86_400_000 * 2).toISOString();
      await expect(
        service.reportOutcome('u1', {
          outcomeType: CandidateOutcomeType.INTERVIEW,
          occurredAt: futureDate,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('supports separating offer accepted from job actually started', async () => {
      const now = new Date();
      prisma.candidateOutcome.create.mockResolvedValue({
        id: 'out-2',
        userId: 'u1',
        outcomeType: CandidateOutcomeType.JOB_STARTED,
        occurredAt: now,
        verificationStatus: OutcomeVerificationStatus.STUDENT_ATTESTED,
        shareWithAcademy: true,
        withdrawnAt: null,
        createdAt: now,
      });

      const res = await service.reportOutcome('u1', {
        outcomeType: CandidateOutcomeType.JOB_STARTED,
        occurredAt: now.toISOString(),
        jobTitle: 'Data Analyst',
      });

      expect(res.outcomeType).toBe(CandidateOutcomeType.JOB_STARTED);
    });
  });

  describe('updateOutcome & withdrawOutcome', () => {
    it('allows candidate to edit an existing outcome', async () => {
      prisma.candidateOutcome.findFirst.mockResolvedValue({
        id: 'out-1',
        userId: 'u1',
      });
      prisma.candidateOutcome.update.mockResolvedValue({
        id: 'out-1',
        outcomeType: CandidateOutcomeType.OFFER_ACCEPTED,
        occurredAt: new Date(),
        verificationStatus: OutcomeVerificationStatus.STUDENT_ATTESTED,
        shareWithAcademy: false,
        withdrawnAt: null,
        updatedAt: new Date(),
      });

      const res = await service.updateOutcome('u1', 'out-1', {
        outcomeType: CandidateOutcomeType.OFFER_ACCEPTED,
        shareWithAcademy: false,
      });

      expect(res.shareWithAcademy).toBe(false);
      expect(res.outcomeType).toBe(CandidateOutcomeType.OFFER_ACCEPTED);
    });

    it('rejects candidate attempts to promote outcomes to EMPLOYER_CONFIRMED', async () => {
      prisma.candidateOutcome.findFirst.mockResolvedValue({
        id: 'out-1',
        userId: 'u1',
      });

      await expect(
        service.updateOutcome('u1', 'out-1', {
          verificationStatus: OutcomeVerificationStatus.EMPLOYER_CONFIRMED as any,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.candidateOutcome.update).not.toHaveBeenCalled();
    });

    it('allows candidate to withdraw an outcome (e.g. retracted offer)', async () => {
      prisma.candidateOutcome.findFirst.mockResolvedValue({
        id: 'out-1',
        userId: 'u1',
      });
      prisma.candidateOutcome.update.mockResolvedValue({
        id: 'out-1',
        withdrawnAt: new Date(),
      });

      const res = await service.withdrawOutcome('u1', 'out-1');
      expect(res.withdrawnAt).toBeDefined();
    });

    it('throws NotFoundException if user tries to update another candidate outcome', async () => {
      prisma.candidateOutcome.findFirst.mockResolvedValue(null);
      await expect(
        service.updateOutcome('u2', 'out-1', { jobTitle: 'Hacker' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteOutcome', () => {
    it('allows candidate to permanently remove a reported outcome', async () => {
      prisma.candidateOutcome.findFirst.mockResolvedValue({
        id: 'out-1',
        userId: 'u1',
      });
      prisma.candidateOutcome.delete.mockResolvedValue({});

      const res = await service.deleteOutcome('u1', 'out-1');
      expect(res.success).toBe(true);
      expect(prisma.candidateOutcome.delete).toHaveBeenCalledWith({ where: { id: 'out-1' } });
    });
  });
});
