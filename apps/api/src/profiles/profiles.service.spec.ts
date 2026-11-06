import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { PrismaService } from '../database/database.service';
import { LocalStorageService } from '../resumes/local-storage.service';

describe('ProfilesService', () => {
  let service: ProfilesService;
  let prisma: { profile: Record<string, jest.Mock>; $transaction: jest.Mock };
  let profileOnboardedQueue: { add: jest.Mock };

  beforeEach(async () => {
    prisma = {
      profile: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    };
    profileOnboardedQueue = { add: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfilesService,
        { provide: PrismaService, useValue: prisma },
        { provide: LocalStorageService, useValue: {} },
        { provide: getQueueToken('profile-onboarded'), useValue: profileOnboardedQueue },
      ],
    }).compile();

    service = module.get<ProfilesService>(ProfilesService);
  });

  describe('updateProfile', () => {
    function savedProfile(onboardingCompletedAt: Date | null) {
      const tx = {
        user: { update: jest.fn() },
        profile: {
          upsert: jest.fn().mockResolvedValue({ id: 'profile_1' }),
          findUnique: jest.fn().mockResolvedValue({ id: 'profile_1', onboardingCompletedAt }),
        },
        experience: { deleteMany: jest.fn(), createMany: jest.fn() },
        education: { deleteMany: jest.fn(), createMany: jest.fn() },
      };
      prisma.$transaction.mockImplementation((work: (t: typeof tx) => unknown) => work(tx));
    }

    it('re-scores matches after a saved change to an onboarded profile', async () => {
      savedProfile(new Date('2026-09-01'));
      await service.updateProfile('user_1', { headline: 'NestJS backend mühəndisi' });
      expect(profileOnboardedQueue.add).toHaveBeenCalledWith(
        'run-for-profile',
        { userId: 'user_1' },
        expect.objectContaining({ removeOnComplete: true }),
      );
    });

    it('leaves the first matching pass to onboarding completion', async () => {
      savedProfile(null);
      await service.updateProfile('user_1', { headline: 'NestJS' });
      expect(profileOnboardedQueue.add).not.toHaveBeenCalled();
    });

    it('still returns the saved profile when enqueueing the re-match fails', async () => {
      savedProfile(new Date('2026-09-01'));
      profileOnboardedQueue.add.mockRejectedValue(new Error('redis down'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await expect(service.updateProfile('user_1', { headline: 'NestJS' })).resolves.toEqual(
        expect.objectContaining({ id: 'profile_1', matchingQueued: false }),
      );
    });
  });

  describe('completeOnboarding', () => {
    it('rejects a user with no profile yet', async () => {
      prisma.profile.findUnique.mockResolvedValue(null);
      await expect(service.completeOnboarding('user_1')).rejects.toThrow(NotFoundException);
      expect(profileOnboardedQueue.add).not.toHaveBeenCalled();
    });

    it('marks onboarding complete and enqueues a matching pass on first completion', async () => {
      prisma.profile.findUnique.mockResolvedValue({ id: 'profile_1', onboardingCompletedAt: null });
      prisma.profile.update.mockResolvedValue({ id: 'profile_1', onboardingCompletedAt: new Date() });

      await service.completeOnboarding('user_1');

      expect(prisma.profile.update).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
        data: { onboardingCompletedAt: expect.any(Date) },
      });
      expect(profileOnboardedQueue.add).toHaveBeenCalledWith(
        'run-for-profile',
        { userId: 'user_1' },
        expect.objectContaining({ removeOnComplete: true }),
      );
    });

    it('is idempotent: does not re-update or re-enqueue once already completed', async () => {
      const existing = { id: 'profile_1', onboardingCompletedAt: new Date('2026-01-01') };
      prisma.profile.findUnique.mockResolvedValue(existing);

      const result = await service.completeOnboarding('user_1');
      expect(result).toBe(existing);
      expect(prisma.profile.update).not.toHaveBeenCalled();
      expect(profileOnboardedQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('addBulkConfirmedSkills', () => {
    it('adds multiple skills de-duplicating canonical synonyms and triggers update once', async () => {
      prisma.profile.findUnique.mockResolvedValue({ id: 'profile_1', skills: ['SQL'] });
      jest.spyOn(service, 'updateProfile').mockResolvedValue({ id: 'profile_1', matchingQueued: true } as any);

      const result = await service.addBulkConfirmedSkills('user_1', ['Power BI', 'sql', 'Python', 'power-bi']);

      expect(result.addedCount).toBe(2);
      expect(result.addedSkills).toContain('Power BI');
      expect(result.addedSkills).toContain('Python');
      // sql and duplicate power-bi were not re-added
      expect(result.skills).toEqual(['SQL', 'Power BI', 'Python']);
      expect(service.updateProfile).toHaveBeenCalledWith('user_1', {
        skills: ['SQL', 'Power BI', 'Python'],
      });
      expect(result.matchingQueued).toBe(true);
    });

    it('returns addedCount 0 and does not call updateProfile if all skills already exist', async () => {
      prisma.profile.findUnique.mockResolvedValue({ id: 'profile_1', skills: ['SQL', 'Python'] });
      jest.spyOn(service, 'updateProfile').mockResolvedValue({ id: 'profile_1' } as any);

      const result = await service.addBulkConfirmedSkills('user_1', ['sql', 'Python']);

      expect(result.addedCount).toBe(0);
      expect(result.addedSkills).toEqual([]);
      expect(service.updateProfile).not.toHaveBeenCalled();
    });

    it('rejects an empty skills array with BadRequestException', async () => {
      await expect(service.addBulkConfirmedSkills('user_1', [])).rejects.toThrow('Ən azı bir bacarıq təqdim olunmalıdır');
    });
  });
});
