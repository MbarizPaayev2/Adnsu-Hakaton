import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { VacanciesService } from './vacancies.service';
import { PrismaService } from '../database/database.service';

describe('VacanciesService', () => {
  let service: VacanciesService;
  let prisma: any;
  let tx: any;

  beforeEach(async () => {
    tx = {
      application: { count: jest.fn().mockResolvedValue(0) },
      applicationQuestion: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      vacancy: { update: jest.fn().mockResolvedValue({ id: 'vac_1', questions: [] }) },
    };
    prisma = {
      vacancy: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((fn: (client: any) => unknown) => fn(tx)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VacanciesService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('job-ingested'), useValue: { add: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get<VacanciesService>(VacanciesService);
  });

  describe('public listing and detail exclude expired vacancies', () => {
    const expectActionable = (where: any) => {
      expect(where).toEqual(expect.objectContaining({
        status: 'ACTIVE',
        company: { status: 'APPROVED' },
        AND: [
          { OR: [{ deadline: null }, { deadline: { gt: expect.any(Date) } }] },
          // An employer plan period that has run out is closed to everyone, even before the sweeper has marked the listing.
          { OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
        ],
      }));
      expect(Math.abs(where.AND[0].OR[1].deadline.gt.getTime() - Date.now())).toBeLessThan(5_000);
      expect(Math.abs(where.AND[1].OR[1].expiresAt.gt.getTime() - Date.now())).toBeLessThan(5_000);
    };

    it('lists and counts only open vacancies with the same filter', async () => {
      await service.findAllPublic(1, 20);

      expectActionable(prisma.vacancy.findMany.mock.calls[0][0].where);
      expectActionable(prisma.vacancy.count.mock.calls[0][0].where);
    });

    it('treats an expired vacancy detail as not found and does not count a view', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(service.findOnePublic('vac_expired')).rejects.toThrow(NotFoundException);
      expectActionable(prisma.vacancy.findFirst.mock.calls[0][0].where);
      expect(prisma.vacancy.update).not.toHaveBeenCalled();
    });
  });

  describe('editing questions', () => {
    const questions = [{ label: 'Yeni', type: 'SHORT_TEXT', required: true, order: 0 }] as any;

    beforeEach(() => {
      prisma.vacancy.findFirst.mockResolvedValue({ id: 'vac_1', companyId: 'co_1', questions: [] });
    });

    it('replaces questions while the vacancy has no applications', async () => {
      await service.update('vac_1', 'co_1', { questions } as any);

      expect(tx.application.count).toHaveBeenCalledWith({ where: { vacancyId: 'vac_1' } });
      expect(tx.applicationQuestion.deleteMany).toHaveBeenCalledWith({ where: { vacancyId: 'vac_1' } });
      expect(tx.vacancy.update).toHaveBeenCalled();
    });

    it('refuses with 409 once applications exist, leaving questions untouched', async () => {
      tx.application.count.mockResolvedValue(1);

      await expect(service.update('vac_1', 'co_1', { questions } as any)).rejects.toThrow(ConflictException);
      expect(tx.applicationQuestion.deleteMany).not.toHaveBeenCalled();
      expect(tx.vacancy.update).not.toHaveBeenCalled();
    });

    it('maps an answer FK violation from a concurrent submission to the same 409', async () => {
      tx.applicationQuestion.deleteMany.mockRejectedValue({ code: 'P2003' });

      await expect(service.update('vac_1', 'co_1', { questions } as any)).rejects.toThrow(ConflictException);
    });

    it('rethrows other database failures unchanged', async () => {
      const failure = new Error('connection lost');
      tx.applicationQuestion.deleteMany.mockRejectedValue(failure);

      await expect(service.update('vac_1', 'co_1', { questions } as any)).rejects.toBe(failure);
    });

    it('still allows non-question edits after applications exist', async () => {
      tx.application.count.mockResolvedValue(3);
      prisma.vacancy.update.mockResolvedValue({ id: 'vac_1', title: 'Yeni ad' });

      await expect(service.update('vac_1', 'co_1', { title: 'Yeni ad' } as any)).resolves.toEqual({ id: 'vac_1', title: 'Yeni ad' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not reveal another company\'s vacancy', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(service.update('vac_1', 'co_other', { questions } as any)).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
