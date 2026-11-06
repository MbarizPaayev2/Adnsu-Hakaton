import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EmployerPlansService } from '../employer-plans/employer-plans.service';
import { AdminService } from './admin.service';
import { PrismaService } from '../database/database.service';
import { PostHogService } from '../common/posthog.service';
import { LocalStorageService } from '../resumes/local-storage.service';
import { AccountDeletionService } from '../accounts/account-deletion.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: any;
  let accountDeletion: { deleteUser: jest.Mock };

  beforeEach(async () => {
    prisma = {
      company: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
      },
      subscription: {
        upsert: jest.fn(),
      },
      vacancy: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      adminUser: { findFirst: jest.fn().mockResolvedValue(null) },
      application: { findMany: jest.fn().mockResolvedValue([]) },
      applicationAnswer: { deleteMany: jest.fn() },
      business: { delete: jest.fn() },
      $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
      adminAuditLog: {
        create: jest.fn(),
      },
    };

    accountDeletion = { deleteUser: jest.fn().mockResolvedValue({ success: true, leftoverFiles: 0 }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: PostHogService, useValue: { capture: jest.fn() } },
        { provide: AccountDeletionService, useValue: accountDeletion },
        { provide: EmployerPlansService, useValue: { moderate: jest.fn(), cancelBusinessForDeletion: jest.fn() } },
        { provide: LocalStorageService, useValue: { deleteFile: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listCompanies', () => {
    // The admin businesses table renders `company.email`; Company has no such
    // column, so it must come from the owning Business login.
    it('returns the owning business login email and no nested business object', async () => {
      prisma.company.findMany.mockResolvedValue([
        { id: 'co_1', name: 'Acme', status: 'PENDING', business: { email: 'owner@example.com' } },
      ]);
      prisma.company.count.mockResolvedValue(1);

      const result = await service.listCompanies(1, 20, 'PENDING');

      expect(prisma.company.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { status: 'PENDING' },
        include: { business: { select: { email: true } } },
      }));
      expect(result.data).toEqual([{ id: 'co_1', name: 'Acme', status: 'PENDING', email: 'owner@example.com' }]);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('listUsers', () => {
    it('paginates and searches by email/name', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.listUsers(1, 10, 'elvin');

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { email: { contains: 'elvin', mode: 'insensitive' } },
              { name: { contains: 'elvin', mode: 'insensitive' } },
            ],
          },
        }),
      );
      expect(result).toEqual({ data: [{ id: 'user-1' }], meta: { total: 1, page: 1, limit: 10, totalPages: 1 } });
    });
  });

  describe('getUser', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUser('user-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('never returns the hashed password', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com', hashedPassword: 'secret-hash' });

      const result = await service.getUser('user-1');

      expect(result).not.toHaveProperty('hashedPassword');
    });
  });


  describe('deleteUser', () => {
    // The behaviour lives in AccountDeletionService (see its spec); operators
    // go through exactly the same path as self-service deletion.
    it('delegates to the shared deletion path as an audited admin action', async () => {
      prisma.user.findUnique.mockResolvedValue({ email: 'someone@example.com' });
      const result = await service.deleteUser('user-1', 'admin-1');
      expect(accountDeletion.deleteUser).toHaveBeenCalledWith('user-1', { kind: 'admin', adminUserId: 'admin-1' });
      expect(result).toEqual({ success: true, leftoverFiles: 0 });
    });

    it('refuses the founder address and an address that belongs to an active operator', async () => {
      prisma.user.findUnique.mockResolvedValue({ email: 'CEO@aisehr.com' });
      await expect(service.deleteUser('user-1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
      prisma.user.findUnique.mockResolvedValue({ email: 'ops@example.com' });
      prisma.adminUser.findFirst.mockResolvedValue({ id: 'op-1' });
      await expect(service.deleteUser('user-2', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
      expect(accountDeletion.deleteUser).not.toHaveBeenCalled();
    });
  });

  describe('deleteCompany', () => {
    const company = { id: 'co-1', name: 'Test MMC', logo: null, businessId: 'b-1', business: { email: 'hr@test.az' }, _count: { vacancies: 2 } };
    let plans: { cancelBusinessForDeletion: jest.Mock };
    beforeEach(() => { plans = (service as any).employerPlans; });

    it('stops billing first, removes answers then the business, and audits the counts without the candidates\' accounts', async () => {
      prisma.company.findUnique.mockResolvedValue(company);
      prisma.application.findMany.mockResolvedValue([{ files: [{ fileUrl: '/uploads/a.pdf' }], answers: [{ fileUrl: null }] }]);
      const order: string[] = [];
      plans.cancelBusinessForDeletion.mockImplementation(async () => { order.push('billing'); });
      prisma.applicationAnswer.deleteMany.mockImplementation(async () => { order.push('answers'); });
      prisma.business.delete.mockImplementation(async () => { order.push('business'); });
      const result = await service.deleteCompany('co-1', 'admin-1', 'Saxta');
      expect(order).toEqual(['billing', 'answers', 'business']);
      expect(result).toEqual({ deleted: true, vacancies: 2, applications: 1 });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'COMPANY_DELETED', targetId: 'co-1', metadata: expect.objectContaining({ vacancies: 2, applications: 1, reason: 'Saxta' }) }) });
    });

    it('deletes nothing when billing cannot be stopped, and refuses an operator-owned employer', async () => {
      prisma.company.findUnique.mockResolvedValue(company);
      plans.cancelBusinessForDeletion.mockRejectedValue(new Error('provider unavailable'));
      await expect(service.deleteCompany('co-1', 'admin-1')).rejects.toThrow('provider unavailable');
      expect(prisma.business.delete).not.toHaveBeenCalled();
      plans.cancelBusinessForDeletion.mockReset();
      prisma.adminUser.findFirst.mockResolvedValue({ id: 'op-1' });
      await expect(service.deleteCompany('co-1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('removeVacancy', () => {
    it('marks the vacancy deleted, keeps its applications and records who, why and the previous state', async () => {
      prisma.vacancy.findUnique.mockResolvedValue({ id: 'v-1', status: 'ACTIVE', title: 'QA', companyId: 'co-1' });
      await service.removeVacancy('v-1', 'Saxta elan', 'admin-1');
      expect(prisma.vacancy.update).toHaveBeenCalledWith({ where: { id: 'v-1' }, data: { status: 'DELETED' } });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'VACANCY_REMOVED', metadata: expect.objectContaining({ previousStatus: 'ACTIVE', reason: 'Saxta elan' }) }) });
    });
    it('says so when it is already removed', async () => {
      prisma.vacancy.findUnique.mockResolvedValue({ id: 'v-1', status: 'DELETED', title: 'QA', companyId: 'co-1' });
      await expect(service.removeVacancy('v-1', 'x y z', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
