import { ConflictException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AccountDeletionService } from './account-deletion.service';

describe('AccountDeletionService', () => {
  let prisma: any;
  let storage: { deleteFile: jest.Mock; fileExists: jest.Mock };
  let billing: { cancelForDeletion: jest.Mock };
  let worker: { deleteSession: jest.Mock };
  let service: AccountDeletionService;
  const order: string[] = [];

  const fullUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'gone@example.com',
    subscription: { dodoSubscriptionId: 'sub_1', status: 'active' },
    resumes: [{ fileUrl: '/uploads/resume-1.pdf' }, { fileUrl: null }],
    profile: { idDocumentUrl: '/uploads/id.png' },
    applications: [
      { files: [{ fileUrl: '/uploads/cv-copy.pdf' }, { fileUrl: '/uploads/portfolio.pdf' }], answers: [{ fileUrl: '/uploads/portfolio.pdf' }, { fileUrl: null }] },
    ],
    externalApplications: [
      { id: 'ext-1', status: 'READY_FOR_REVIEW', reviewScreenshotUrl: '/uploads/review.png', cvSnapshotUrl: '/uploads/ext-cv.docx', idDocumentSnapshotUrl: '/uploads/ext-id.png' },
      { id: 'ext-2', status: 'SUBMITTED', reviewScreenshotUrl: null, cvSnapshotUrl: null, idDocumentSnapshotUrl: null },
    ],
    ...overrides,
  });

  beforeEach(() => {
    order.length = 0;
    const tx = {
      $queryRaw: jest.fn(async () => []),
      user: { delete: jest.fn(async () => { order.push('db'); }) },
      adminAuditLog: { create: jest.fn() },
    };
    prisma = {
      user: { findUnique: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      tx,
    };
    storage = { deleteFile: jest.fn(async () => { order.push('file'); }), fileExists: jest.fn().mockReturnValue(false) };
    billing = { cancelForDeletion: jest.fn(async () => { order.push('billing'); }) };
    worker = { deleteSession: jest.fn().mockResolvedValue({ ok: true }) };
    service = new AccountDeletionService(prisma, storage as any, billing as any, worker as any, { capture: jest.fn() } as any);
  });

  it('stops billing, closes live sessions, deletes rows, then removes every stored file once', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUser());
    const result = await service.deleteUser('user-1', { kind: 'admin', adminUserId: 'admin-1' });

    expect(result).toEqual({ success: true, leftoverFiles: 0, unconfirmedEmailApplications: 0 });
    expect(order[0]).toBe('billing');
    expect(order[1]).toBe('db');
    expect(order.slice(2).every((step) => step === 'file')).toBe(true);
    expect(worker.deleteSession).toHaveBeenCalledTimes(1);
    expect(worker.deleteSession).toHaveBeenCalledWith('ext-1');
    for (const url of ['/uploads/resume-1.pdf', '/uploads/id.png', '/uploads/cv-copy.pdf', '/uploads/portfolio.pdf', '/uploads/review.png', '/uploads/ext-cv.docx', '/uploads/ext-id.png']) {
      expect(storage.deleteFile).toHaveBeenCalledWith(url);
    }
    expect(storage.deleteFile).toHaveBeenCalledTimes(7);
    expect(prisma.tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'USER_DELETED', targetType: 'User', targetId: 'user-1', metadata: { email: 'g***@example.com', files: 7 } }),
    });
  });

  it('removes the private copies of CVs that were e-mailed to employers, and refuses while one is being handed to the provider', async () => {
    storage.deletePrivate = jest.fn(async () => { order.push('private'); });
    prisma.user.findUnique.mockResolvedValue(fullUser({ emailApplications: [{ deliveryState: 'DELIVERED', cvSnapshotUrl: 'private/email-applications/a.pdf' }, { deliveryState: 'CANCELLED', cvSnapshotUrl: null }] }));
    await service.deleteUser('user-1', { kind: 'self' });
    expect(storage.deletePrivate).toHaveBeenCalledTimes(1);
    expect(storage.deletePrivate).toHaveBeenCalledWith('private/email-applications/a.pdf');
    expect(order.indexOf('private')).toBeGreaterThan(order.indexOf('db'));

    prisma.$transaction.mockClear();
    prisma.user.findUnique.mockResolvedValue(fullUser({ emailApplications: [{ deliveryState: 'SENDING', cvSnapshotUrl: 'private/email-applications/b.pdf' }] }));
    await expect(service.deleteUser('user-1', { kind: 'self' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes no operator audit entry for self-service deletion', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUser());
    await service.deleteUser('user-1', { kind: 'self' });
    expect(prisma.tx.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('deletes nothing when billing cannot be stopped', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUser());
    billing.cancelForDeletion.mockRejectedValue(new ServiceUnavailableException());
    await expect(service.deleteUser('user-1', { kind: 'self' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('refuses while an external application is being sent', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUser({ externalApplications: [{ id: 'ext-9', status: 'SUBMITTING' }] }));
    await expect(service.deleteUser('user-1', { kind: 'self' })).rejects.toBeInstanceOf(ConflictException);
    expect(billing.cancelForDeletion).not.toHaveBeenCalled();
  });

  it('still reports success, with a count, when stored files survive', async () => {
    prisma.user.findUnique.mockResolvedValue(fullUser());
    storage.deleteFile.mockRejectedValueOnce(new Error('disk error'));
    storage.fileExists.mockImplementation((url: string) => url === '/uploads/id.png');
    const result = await service.deleteUser('user-1', { kind: 'self' });
    expect(result).toEqual({ success: true, leftoverFiles: 1, unconfirmedEmailApplications: 0 });
  });

  it('checks the password before anything else', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ hashedPassword: await bcrypt.hash('right-password', 4) });
    await expect(service.deleteOwnAccount('user-1', 'wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(billing.cancelForDeletion).not.toHaveBeenCalled();
  });

  it('404s for an unknown account', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.deleteUser('nope', { kind: 'self' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
