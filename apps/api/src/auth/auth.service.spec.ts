import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { GoogleIdentityService } from './google-identity.service';
import { AuthService } from './auth.service';
import { PrismaService } from '../database/database.service';
import { EmailDeliveryError, EmailService } from '../common/email.service';
import { PostHogService } from '../common/posthog.service';
import { VerificationTokenPurpose } from '@prisma/client';
import { LocalStorageService } from '../resumes/local-storage.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: Record<string, jest.Mock>;
    session: Record<string, jest.Mock>;
    verificationToken: Record<string, jest.Mock>;
  };
  let emailService: { send: jest.Mock };
  let postHogService: { capture: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      session: { create: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
      verificationToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };
    postHogService = { capture: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: GoogleIdentityService, useValue: { verify: jest.fn(), enabled: () => false } },
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
        { provide: PostHogService, useValue: postHogService },
        { provide: LocalStorageService, useValue: { deleteFile: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('creates a user, issues a verification token, and sends an email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'user_1', email: 'a@b.com' });
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.verificationToken.create.mockResolvedValue({});

      const result = await service.register('a@b.com', 'password123');

      expect(prisma.user.create).toHaveBeenCalled();
      expect(prisma.verificationToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user_1', purpose: VerificationTokenPurpose.EMAIL_VERIFY }),
        }),
      );
      expect(emailService.send).toHaveBeenCalledWith('a@b.com', expect.any(String), expect.any(String));
      expect(result).toEqual({ email: 'a@b.com', message: expect.any(String) });
    });

    it('does not create a duplicate account and returns the same generic response for an existing email', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'a@b.com', emailVerified: new Date() });

      const result = await service.register('a@b.com', 'password123');

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
      expect(result).toEqual({ email: 'a@b.com', message: expect.any(String) });
    });

    it('resends a verification email for an existing but unverified account, without creating a duplicate', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'a@b.com', emailVerified: null });
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.verificationToken.create.mockResolvedValue({});

      const result = await service.register('a@b.com', 'password123');

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.verificationToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'existing', purpose: VerificationTokenPurpose.EMAIL_VERIFY }),
        }),
      );
      expect(emailService.send).toHaveBeenCalledWith('a@b.com', expect.any(String), expect.any(String));
      expect(result).toEqual({ email: 'a@b.com', message: expect.any(String) });
    });

    it('rejects missing credentials', async () => {
      await expect(service.register('', '')).rejects.toThrow(BadRequestException);
    });
  });

  describe('login', () => {
    const password = 'password123';
    let hashedPassword: string;

    beforeAll(async () => {
      hashedPassword = await bcrypt.hash(password, 4);
    });

    it('rejects an unverified user even with correct credentials', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'a@b.com',
        hashedPassword,
        emailVerified: null,
      });

      await expect(service.login('a@b.com', password)).rejects.toThrow(ForbiddenException);
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('rejects wrong credentials', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'a@b.com',
        hashedPassword,
        emailVerified: new Date(),
      });

      await expect(service.login('a@b.com', 'wrong-password')).rejects.toThrow(UnauthorizedException);
    });

    it('issues a session for a verified user with correct credentials', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'a@b.com',
        hashedPassword,
        emailVerified: new Date(),
      });
      prisma.session.create.mockResolvedValue({});

      const result = await service.login('a@b.com', password);

      expect(prisma.session.create).toHaveBeenCalled();
      expect(result.sessionToken).toEqual(expect.any(String));
      expect((result.user as any).hashedPassword).toBeUndefined();
    });
  });

  describe('verifyEmail', () => {
    it('marks the user verified and consumes the token', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue({
        id: 'tok_1',
        userId: 'user_1',
        purpose: VerificationTokenPurpose.EMAIL_VERIFY,
        expires: new Date(Date.now() + 1000),
      });

      const result = await service.verifyEmail('good-token');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user_1' },
        data: { emailVerified: expect.any(Date) },
      });
      expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user_1', purpose: VerificationTokenPurpose.EMAIL_VERIFY },
      });
      expect(result.success).toBe(true);
    });

    it('rejects an unknown token', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue(null);
      await expect(service.verifyEmail('bad-token')).rejects.toThrow(BadRequestException);
    });

    it('rejects a token issued for a different purpose (password reset)', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue({
        id: 'tok_1',
        userId: 'user_1',
        purpose: VerificationTokenPurpose.PASSWORD_RESET,
        expires: new Date(Date.now() + 1000),
      });
      await expect(service.verifyEmail('reset-token')).rejects.toThrow(BadRequestException);
    });

    it('rejects and cleans up an expired token', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue({
        id: 'tok_1',
        userId: 'user_1',
        purpose: VerificationTokenPurpose.EMAIL_VERIFY,
        expires: new Date(Date.now() - 1000),
      });
      prisma.verificationToken.delete.mockResolvedValue({});

      await expect(service.verifyEmail('expired-token')).rejects.toThrow(BadRequestException);
      expect(prisma.verificationToken.delete).toHaveBeenCalledWith({ where: { id: 'tok_1' } });
    });
  });

  describe('resendVerification', () => {
    it('returns the generic response without sending an email for an unknown address', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.resendVerification('nobody@b.com');
      expect(emailService.send).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('returns the same generic response without sending an email for an already-verified address', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com', emailVerified: new Date() });
      const result = await service.resendVerification('a@b.com');
      expect(emailService.send).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('issues a new token and sends an email for an unverified address', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com', emailVerified: null });
      const result = await service.resendVerification('a@b.com');
      expect(emailService.send).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('still returns the generic response when provider delivery fails, so the status cannot be used to enumerate accounts', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'user_1', email: 'a@b.com', emailVerified: null })
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
    it('forgotPassword returns the generic response without sending an email for an unknown address', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.forgotPassword('nobody@b.com');
      expect(emailService.send).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('forgotPassword issues a PASSWORD_RESET token for a known address', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user_1', email: 'a@b.com' });
      await service.forgotPassword('a@b.com');
      expect(prisma.verificationToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user_1', purpose: VerificationTokenPurpose.PASSWORD_RESET }),
        }),
      );
      expect(emailService.send).toHaveBeenCalled();
    });

    it('resetPassword rejects a token issued for a different purpose (email verify)', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue({
        id: 'tok_1',
        userId: 'user_1',
        purpose: VerificationTokenPurpose.EMAIL_VERIFY,
        expires: new Date(Date.now() + 1000),
      });
      await expect(service.resetPassword('verify-token', 'newpassword123')).rejects.toThrow(BadRequestException);
    });

    it('resetPassword updates the password and signs the user out everywhere', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue({
        id: 'tok_1',
        userId: 'user_1',
        purpose: VerificationTokenPurpose.PASSWORD_RESET,
        expires: new Date(Date.now() + 1000),
      });

      const result = await service.resetPassword('good-token', 'newpassword123');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user_1' },
        data: { hashedPassword: expect.any(String) },
      });
      expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user_1', purpose: VerificationTokenPurpose.PASSWORD_RESET },
      });
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user_1' } });
      expect(result.success).toBe(true);
    });
  });
});
