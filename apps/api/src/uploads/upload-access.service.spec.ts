import { UploadAccessService, type UploadPrincipal } from './upload-access.service';

describe('UploadAccessService', () => {
  const prisma = {
    resume: { findFirst: jest.fn() },
    profile: { findFirst: jest.fn() },
    applicationFile: { findFirst: jest.fn() },
    applicationAnswer: { findFirst: jest.fn() },
    externalApplication: { findFirst: jest.fn() },
    company: { findFirst: jest.fn() },
  };
  const service = new UploadAccessService(prisma as never);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('allows an admin to read any stored file', async () => {
    await expect(service.canRead({ kind: 'admin' }, 'a.pdf')).resolves.toBe(true);
    expect(prisma.resume.findFirst).not.toHaveBeenCalled();
  });

  it('allows a user only when the file belongs to their resume', async () => {
    prisma.resume.findFirst.mockResolvedValue({ id: 'r1' });
    prisma.profile.findFirst.mockResolvedValue(null);
    prisma.applicationFile.findFirst.mockResolvedValue(null);
    prisma.applicationAnswer.findFirst.mockResolvedValue(null);
    prisma.externalApplication.findFirst.mockResolvedValue(null);

    const principal: UploadPrincipal = { kind: 'user', userId: 'u1' };
    await expect(service.canRead(principal, 'mine.pdf')).resolves.toBe(true);
    expect(prisma.resume.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', fileUrl: '/uploads/mine.pdf' },
    });
  });

  it('denies a user when no owned row references the file', async () => {
    prisma.resume.findFirst.mockResolvedValue(null);
    prisma.profile.findFirst.mockResolvedValue(null);
    prisma.applicationFile.findFirst.mockResolvedValue(null);
    prisma.applicationAnswer.findFirst.mockResolvedValue(null);
    prisma.externalApplication.findFirst.mockResolvedValue(null);

    await expect(
      service.canRead({ kind: 'user', userId: 'u2' }, 'other.pdf'),
    ).resolves.toBe(false);
  });
});
