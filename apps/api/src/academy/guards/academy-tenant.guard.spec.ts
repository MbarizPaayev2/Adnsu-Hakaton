import { AcademyTenantGuard } from './academy-tenant.guard';
import { Reflector } from '@nestjs/core';
import { AcademyRole } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('AcademyTenantGuard', () => {
  let guard: AcademyTenantGuard;
  let reflector: Reflector;
  let prisma: any;

  beforeEach(() => {
    reflector = new Reflector();
    prisma = {
      academyMember: {
        findUnique: jest.fn(),
      },
    };
    guard = new AcademyTenantGuard(reflector, prisma);
  });

  const createMockContext = (user: any, params: any = {}, headers: any = {}) => {
    const request = { user, params, headers };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  };

  it('rejects unauthenticated requests with 403', async () => {
    const context = createMockContext(null, { academyId: 'acad_1' });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejects requests without academyId with 404', async () => {
    const context = createMockContext({ id: 'user_1' }, {});
    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
  });

  it('rejects access if user is not a member of the requested academy (404, does not leak existence)', async () => {
    prisma.academyMember.findUnique.mockResolvedValue(null);
    const context = createMockContext({ id: 'user_intruder' }, { academyId: 'acad_target' });

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
    expect(prisma.academyMember.findUnique).toHaveBeenCalledWith({
      where: {
        academyId_userId: {
          academyId: 'acad_target',
          userId: 'user_intruder',
        },
      },
      include: { academy: true },
    });
  });

  it('rejects access if academy status is not ACTIVE', async () => {
    prisma.academyMember.findUnique.mockResolvedValue({
      id: 'mem_1',
      academyId: 'acad_1',
      userId: 'user_1',
      role: AcademyRole.OWNER,
      academy: { id: 'acad_1', status: 'SUSPENDED' },
    });
    const context = createMockContext({ id: 'user_1' }, { academyId: 'acad_1' });

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
  });

  it('attaches academy and member to request for valid active membership', async () => {
    const member = {
      id: 'mem_1',
      academyId: 'acad_1',
      userId: 'user_1',
      role: AcademyRole.ADMIN,
      academy: { id: 'acad_1', name: 'Code Academy', status: 'ACTIVE' },
    };
    prisma.academyMember.findUnique.mockResolvedValue(member);
    const context = createMockContext({ id: 'user_1' }, { academyId: 'acad_1' });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);

    const req = context.switchToHttp().getRequest();
    expect(req.academy).toEqual(member.academy);
    expect(req.academyMember).toEqual(member);
  });

  it('enforces role restrictions when @AcademyRoles is specified', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AcademyRole.OWNER]);

    const member = {
      id: 'mem_coach',
      academyId: 'acad_1',
      userId: 'user_coach',
      role: AcademyRole.COACH,
      academy: { id: 'acad_1', name: 'Code Academy', status: 'ACTIVE' },
    };
    prisma.academyMember.findUnique.mockResolvedValue(member);
    const context = createMockContext({ id: 'user_coach' }, { academyId: 'acad_1' });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('allows access when user role matches @AcademyRoles', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AcademyRole.OWNER, AcademyRole.ADMIN]);

    const member = {
      id: 'mem_admin',
      academyId: 'acad_1',
      userId: 'user_admin',
      role: AcademyRole.ADMIN,
      academy: { id: 'acad_1', name: 'Code Academy', status: 'ACTIVE' },
    };
    prisma.academyMember.findUnique.mockResolvedValue(member);
    const context = createMockContext({ id: 'user_admin' }, { academyId: 'acad_1' });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });
});
