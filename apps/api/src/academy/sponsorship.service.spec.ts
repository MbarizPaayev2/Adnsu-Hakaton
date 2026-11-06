import { BadRequestException, ConflictException } from '@nestjs/common';
import { AcademySponsorshipService } from './sponsorship.service';

describe('AcademySponsorshipService', () => {
  const now = new Date('2026-10-26T10:00:00.000Z');
  let prisma: any;
  let service: AcademySponsorshipService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    prisma = {
      academy: { findUnique: jest.fn().mockResolvedValue({ id: 'academy-1', status: 'ACTIVE' }) },
      academySponsorship: { create: jest.fn().mockResolvedValue({ id: 'sponsor-1' }), findUnique: jest.fn() },
      academySeatGrant: { count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((fn) => fn(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'sponsor-1' }]),
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', emailVerified: now }) },
      academyEnrollment: { findFirst: jest.fn().mockResolvedValue({ id: 'enrollment-1' }) },
      planOverride: { create: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    service = new AcademySponsorshipService(prisma);
  });

  afterEach(() => jest.useRealTimers());

  it('rejects unsupported plans, invalid capacity and non-active date ranges', async () => {
    const base = { seatCapacity: 5, startsAt: new Date('2026-10-01'), endsAt: new Date('2027-01-01') };
    await expect(service.provision('academy-1', 'operator-1', { ...base, plan: 'STANDARD' as never })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.provision('academy-1', 'operator-1', { ...base, plan: 'PLUS', seatCapacity: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.provision('academy-1', 'operator-1', { ...base, plan: 'PLUS', startsAt: new Date('2026-11-01') })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('provisions only an operator-audited active Plus/Premium pilot without changing consumer subscriptions', async () => {
    const endsAt = new Date('2027-01-01');
    const result = await service.provision('academy-1', 'operator-1', { plan: 'PLUS', seatCapacity: 30, startsAt: new Date('2026-10-01'), endsAt });
    expect(result.id).toBe('sponsor-1');
    expect(prisma.academySponsorship.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE', plan: 'PLUS', seatCapacity: 30 }) }));
    expect(prisma.adminAuditLog.create).toHaveBeenCalled();
  });

  it('is idempotent for a student already sponsored by the academy and creates no second plan override', async () => {
    prisma.academySponsorship.findUnique.mockResolvedValue({ id: 'sponsor-1', status: 'ACTIVE', startsAt: new Date('2026-10-01'), endsAt: new Date('2027-01-01'), seatCapacity: 30, plan: 'PLUS', academy: { status: 'ACTIVE' } });
    prisma.academySeatGrant.findFirst.mockResolvedValue({ id: 'existing-seat', userId: 'user-1' });
    const result = await service.grant('academy-1', 'operator-1', 'user-1');
    expect(result).toEqual({ grant: expect.objectContaining({ id: 'existing-seat' }), alreadyGranted: true });
    expect(prisma.academySeatGrant.create).not.toHaveBeenCalled();
    expect(prisma.planOverride.create).not.toHaveBeenCalled();
  });

  it('rejects an unverified or unenrolled account before creating a seat', async () => {
    prisma.academySponsorship.findUnique.mockResolvedValue({ id: 'sponsor-1', status: 'ACTIVE', startsAt: new Date('2026-10-01'), endsAt: new Date('2027-01-01'), seatCapacity: 30, plan: 'PLUS', academy: { status: 'ACTIVE' } });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', emailVerified: null });
    await expect(service.grant('academy-1', 'operator-1', 'user-1')).rejects.toThrow('e-poçtu təsdiqlənmiş');
    expect(prisma.academySeatGrant.create).not.toHaveBeenCalled();
  });

  it('revokes seat and linked plan override atomically while keeping application/account data untouched', async () => {
    prisma.academySeatGrant.findFirst.mockResolvedValue({ id: 'seat-1', academyId: 'academy-1', userId: 'user-1' });
    expect(await service.revoke('academy-1', 'seat-1', 'operator-1')).toEqual({ revoked: true });
    expect(prisma.academySeatGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'seat-1', status: 'ACTIVE' } }));
    expect(prisma.planOverride.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { academySeatGrantId: 'seat-1', revokedAt: null } }));
  });

  it('rejects attempts to consume a full seat capacity', async () => {
    prisma.academySponsorship.findUnique.mockResolvedValue({ id: 'sponsor-1', status: 'ACTIVE', startsAt: new Date('2026-10-01'), endsAt: new Date('2027-01-01'), seatCapacity: 1, plan: 'PLUS', academy: { status: 'ACTIVE' } });
    prisma.academySeatGrant.findFirst.mockResolvedValue(null);
    prisma.academySeatGrant.count.mockResolvedValue(1);
    await expect(service.grant('academy-1', 'operator-1', 'user-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.academySeatGrant.create).not.toHaveBeenCalled();
  });
});
