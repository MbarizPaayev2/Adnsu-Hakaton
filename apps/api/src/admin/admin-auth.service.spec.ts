import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AdminAuthService } from './admin-auth.service';
import { PrismaService } from '../database/database.service';

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  let prisma: any;
  const base = { id: 'admin_1', email: 'a@b.com', name: null, role: 'ADMIN', createdAt: new Date(), disabledAt: null, mfaEnabledAt: null, mfaSecretEnc: null, mfaRecoveryCodeHashes: [], mfaLastUsedStep: null };

  beforeEach(async () => {
    prisma = {
      adminUser: { findFirst: jest.fn(), update: jest.fn().mockImplementation(({ where }) => ({ ...base, id: where.id })) },
      adminSession: { create: jest.fn().mockResolvedValue({}), delete: jest.fn() },
      adminLoginChallenge: { deleteMany: jest.fn(), create: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminAuthService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<AdminAuthService>(AdminAuthService);
  });

  it('rejects an unknown email, a wrong password and a disabled operator alike', async () => {
    const hashedPassword = await bcrypt.hash('correct-password-1', 4);
    prisma.adminUser.findFirst.mockResolvedValueOnce(null);
    await expect(service.login('nobody@b.com', 'x')).rejects.toThrow(UnauthorizedException);
    prisma.adminUser.findFirst.mockResolvedValueOnce({ ...base, hashedPassword });
    await expect(service.login('a@b.com', 'wrong')).rejects.toThrow(UnauthorizedException);
    prisma.adminUser.findFirst.mockResolvedValueOnce({ ...base, hashedPassword, disabledAt: new Date() });
    await expect(service.login('a@b.com', 'correct-password-1')).rejects.toThrow(UnauthorizedException);
    expect(prisma.adminSession.create).not.toHaveBeenCalled();
  });

  it('issues a session without secrets when MFA is not enrolled', async () => {
    const hashedPassword = await bcrypt.hash('correct-password-1', 4);
    prisma.adminUser.findFirst.mockResolvedValue({ ...base, hashedPassword });
    const result: any = await service.login('A@B.com', 'correct-password-1');
    expect(prisma.adminSession.create).toHaveBeenCalledWith({ data: expect.objectContaining({ adminUserId: 'admin_1', mfaVerified: false }) });
    expect(result.sessionToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.adminUser).toMatchObject({ id: 'admin_1', role: 'ADMIN', mfaEnabled: false });
    expect(JSON.stringify(result)).not.toMatch(/hashedPassword|mfaSecret|RecoveryCode/);
  });

  it('returns only a short-lived challenge (no session) when MFA is enrolled', async () => {
    const hashedPassword = await bcrypt.hash('correct-password-1', 4);
    prisma.adminUser.findFirst.mockResolvedValue({ ...base, hashedPassword, mfaEnabledAt: new Date(), mfaSecretEnc: 'v1.x.y.z' });
    const result: any = await service.login('a@b.com', 'correct-password-1');
    expect(result).toEqual({ mfaRequired: true, challengeToken: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(prisma.adminSession.create).not.toHaveBeenCalled();
    expect(prisma.adminLoginChallenge.create).toHaveBeenCalledWith({ data: expect.not.objectContaining({ challengeToken: expect.anything() }) });
  });

  it('logout never throws when the session is already gone', async () => {
    prisma.adminSession.delete.mockRejectedValue(new Error('not found'));
    await expect(service.logout('some-token')).resolves.toEqual({ success: true });
  });
});
