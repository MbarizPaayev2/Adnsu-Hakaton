import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { VolunteeringService } from './volunteering.service';
import { PrismaService } from '../database/database.service';
import { PostHogService } from '../common/posthog.service';

describe('VolunteeringService', () => {
  let service: VolunteeringService;
  let prisma: {
    volunteerOpportunity: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    notification: Record<string, jest.Mock>;
  };
  let postHogService: { capture: jest.Mock };

  const APPROVED_BUSINESS = { id: 'biz_1', company: { id: 'company_1', name: 'Acme', status: 'APPROVED' } };

  beforeEach(async () => {
    prisma = {
      volunteerOpportunity: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      notification: { createMany: jest.fn() },
    };
    postHogService = { capture: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VolunteeringService,
        { provide: PrismaService, useValue: prisma },
        { provide: PostHogService, useValue: postHogService },
      ],
    }).compile();

    service = module.get<VolunteeringService>(VolunteeringService);
  });

  describe('create', () => {
    it('rejects when the company is not approved', async () => {
      await expect(
        service.create({ id: 'biz_1', company: { id: 'company_1', status: 'PENDING' } }, {
          title: 'Beach cleanup',
          description: 'Help clean the beach',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.volunteerOpportunity.create).not.toHaveBeenCalled();
    });

    it('creates the opportunity and notifies every opted-in user, without emailing anyone', async () => {
      prisma.volunteerOpportunity.create.mockResolvedValue({ id: 'opp_1', title: 'Beach cleanup' });
      prisma.user.findMany.mockResolvedValue([{ id: 'user_1' }, { id: 'user_2' }]);

      const result = await service.create(APPROVED_BUSINESS, {
        title: 'Beach cleanup',
        description: 'Help clean the beach',
      });

      expect(prisma.volunteerOpportunity.create).toHaveBeenCalledWith({
        data: { companyId: 'company_1', title: 'Beach cleanup', description: 'Help clean the beach', location: undefined },
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { profile: { volunteerOpportunitiesOptIn: true } },
        select: { id: true },
      });
      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ userId: 'user_1', type: 'VOLUNTEER_OPPORTUNITY' }),
          expect.objectContaining({ userId: 'user_2', type: 'VOLUNTEER_OPPORTUNITY' }),
        ],
      });
      expect(result).toEqual({ id: 'opp_1', title: 'Beach cleanup' });
    });

    it('does not write any notifications when nobody has opted in', async () => {
      prisma.volunteerOpportunity.create.mockResolvedValue({ id: 'opp_1', title: 'Beach cleanup' });
      prisma.user.findMany.mockResolvedValue([]);

      await service.create(APPROVED_BUSINESS, { title: 'Beach cleanup', description: 'Help clean the beach' });

      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('rejects an opportunity belonging to another company', async () => {
      prisma.volunteerOpportunity.findFirst.mockResolvedValue(null);
      await expect(service.updateStatus('opp_1', 'company_1', 'CLOSED')).rejects.toThrow(NotFoundException);
      expect(prisma.volunteerOpportunity.update).not.toHaveBeenCalled();
    });

    it('updates the status for the owning company', async () => {
      prisma.volunteerOpportunity.findFirst.mockResolvedValue({ id: 'opp_1', companyId: 'company_1' });
      prisma.volunteerOpportunity.update.mockResolvedValue({ id: 'opp_1', status: 'CLOSED' });

      const result = await service.updateStatus('opp_1', 'company_1', 'CLOSED');

      expect(prisma.volunteerOpportunity.update).toHaveBeenCalledWith({
        where: { id: 'opp_1' },
        data: { status: 'CLOSED' },
      });
      expect(result.status).toBe('CLOSED');
    });
  });
});
