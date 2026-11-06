import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { BusinessAuthService } from './business-auth.service';
import { PrismaService } from '../database/database.service';
import { EmailDeliveryError, EmailService } from '../common/email.service';
import { PostHogService } from '../common/posthog.service';
import { BusinessVerificationTokenPurpose } from '@prisma/client';

describe('BusinessAuthService', () => {
  let service: BusinessAuthService;
  let prisma: {
    business: Record<string, jest.Mock>;
    businessSession: Record<string, jest.Mock>;
    businessVerificationToken: Record<string, jest.Mock>;
  };
  let emailService: { send: jest.Mock };

  beforeEach(async () => {
    prisma = {
      business: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      businessSession: { create: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
      businessVerificationToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
        { provide: PostHogService, useValue: { capture: jest.fn() } },
      ],
    }).compile();

    service = module.get<BusinessAuthService>(BusinessAuthService);
  });

  describe('register', () => {
    it('creates a business+company, issues a verification token, and sends an email', async () => {
      prisma.business.findUnique.mockResolvedValue(null);
      prisma.business.create.mockResolvedValue({ id: 'biz_1', email: 'a@b.com' });
      prisma.businessVerificationToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.businessVerificationToken.create.mockResolvedValue({});

      const result = await service.register('a@b.com', 'password123', 'Acme Inc');

      expect(prisma.business.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'a@b.com', company: { create: { name: 'Acme Inc', status: 'PENDING' } } }),
        }),
      );
      expect(prisma.businessVerificationToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ businessId: 'biz_1', purpose: BusinessVerificationTokenPurpose.EMAIL_VERIFY }),
        }),
      );
      expect(emailService.send).toHaveBeenCalled();
      expect(result).toEqual({ email: 'a@b.com', message: expect.any(String) });
    });

    it('does not create a duplicate account for an existing email', async () => {
      prisma.business.findUnique.mockResolvedValue({ id: 'existing', email: 'a@b.com' });

      const result = await service.register('a@b.com', 'password123', 'Acme Inc');

      expect(prisma.business.create).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
      expect(result).toEqual({ email: 'a@b.com', message: expect.any(String) });
    });

    it('rejects missing fields', async () => {
      await expect(service.register('', '', '')).rejects.toThrow(BadRequestException);
    });
  });

  describe('login', () => {
    const password = 'password123';
    let hashedPassword: string;

    beforeAll(async () => {
      hashedPassword = await bcrypt.hash(password, 4);
    });

    it('rejects an unverified business even with correct credentials', async () => {
      prisma.business.findUnique.mockResolvedValue({
        id: 'biz_1',
        email: 'a@b.com',
        hashedPassword,
        emailVerified: null,
      });

      await expect(service.login('a@b.com', password)).rejects.toThrow(ForbiddenException);
      expect(prisma.businessSession.create).not.toHaveBeenCalled();
    });

    it('rejects wrong credentials', async () => {
      prisma.business.findUnique.mockResolvedValue({
        id: 'biz_1',
        email: 'a@b.com',
        hashedPassword,
        emailVerified: new Date(),
      });

      await expect(service.login('a@b.com', 'wrong-password')).rejects.toThrow(UnauthorizedException);
    });

    it('issues a session for a verified business with correct credentials', async () => {
      prisma.business.findUnique.mockResolvedValue({
        id: 'biz_1',
        email: 'a@b.com',
        hashedPassword,
        emailVerified: new Date(),
      });
      prisma.businessSession.create.mockResolvedValue({});

      const result = await service.login('a@b.com', password);

      expect(prisma.businessSession.create).toHaveBeenCalled();
      expect(result.sessionToken).toEqual(expect.any(String));
      expect((result.business as any).hashedPassword).toBeUndefined();
    });
  });

  describe('verifyEmail', () => {
    it('marks the business verified and consumes the token', async () => {
      prisma.businessVerificationToken.findUnique.mockResolvedValue({
        id: 'tok_1',
        businessId: 'biz_1',
        purpose: BusinessVerificationTokenPurpose.EMAIL_VERIFY,
        expires: new Date(Date.now() + 1000),
      });

      const result = await service.verifyEmail('good-token');

      expect(prisma.business.update).toHaveBeenCalledWith({
        where: { id: 'biz_1' },
        data: { emailVerified: expect.any(Date) },
      });
      expect(result.success).toBe(true);
    });

    it('rejects an unknown token', async () => {
      prisma.businessVerificationToken.findUnique.mockResolvedValue(null);
      await expect(service.verifyEmail('bad-token')).rejects.toThrow(BadRequestException);
    });
  });

  describe('resendVerification', () => {
    it('returns the same generic response for unknown addresses and for provider delivery failures', async () => {
      prisma.business.findUnique
        .mockResolvedValueOnce({ id: 'biz_1', email: 'a@b.com', emailVerified: null })
        .mockResolvedValueOnce(null);
      emailService.send.mockRejectedValue(new EmailDeliveryError('provider_error'));

      const failed = await service.resendVerification('a@b.com');
      const unknown = await service.resendVerification('nobody@b.com');

      expect(failed).toEqual(unknown);
      expect(failed.success).toBe(true);
      expect(emailService.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('forgotPassword / resetPassword', () => {
    it('forgotPassword issues a PASSWORD_RESET token for a known address', async () => {
      prisma.business.findUnique.mockResolvedValue({ id: 'biz_1', email: 'a@b.com' });
      await service.forgotPassword('a@b.com');
      expect(prisma.businessVerificationToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ businessId: 'biz_1', purpose: BusinessVerificationTokenPurpose.PASSWORD_RESET }),
        }),
      );
      expect(emailService.send).toHaveBeenCalled();
    });

    it('resetPassword updates the password and signs the business out everywhere', async () => {
      prisma.businessVerificationToken.findUnique.mockResolvedValue({
        id: 'tok_1',
        businessId: 'biz_1',
        purpose: BusinessVerificationTokenPurpose.PASSWORD_RESET,
        expires: new Date(Date.now() + 1000),
      });

      const result = await service.resetPassword('good-token', 'newpassword123');

      expect(prisma.business.update).toHaveBeenCalledWith({
        where: { id: 'biz_1' },
        data: { hashedPassword: expect.any(String) },
      });
      expect(prisma.businessSession.deleteMany).toHaveBeenCalledWith({ where: { businessId: 'biz_1' } });
      expect(result.success).toBe(true);
    });
  });

  describe('changePassword', () => {
    const password = 'current-password123';
    let hashedPassword: string;

    beforeAll(async () => {
      hashedPassword = await bcrypt.hash(password, 4);
    });

    it('rejects a wrong current password', async () => {
      prisma.business.findUnique.mockResolvedValue({ id: 'biz_1', hashedPassword });
      await expect(
        service.changePassword('biz_1', 'session_tok', 'wrong-password', 'newpassword123'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.business.update).not.toHaveBeenCalled();
    });

    it('updates the password when the current one is correct, and signs out every other session', async () => {
      prisma.business.findUnique.mockResolvedValue({ id: 'biz_1', hashedPassword });
      const result = await service.changePassword('biz_1', 'session_tok', password, 'newpassword123');

      expect(prisma.business.update).toHaveBeenCalledWith({
        where: { id: 'biz_1' },
        data: { hashedPassword: expect.any(String) },
      });
      expect(prisma.businessSession.deleteMany).toHaveBeenCalledWith({
        where: { businessId: 'biz_1', sessionToken: { not: 'session_tok' } },
      });
      expect(result.success).toBe(true);
    });
  });
});
