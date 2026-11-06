import { UnauthorizedException } from '@nestjs/common';
import { SessionAuthGuard } from './session-auth.guard';

/** Companion to business-auth.guard.spec.ts — same hash-stripping contract. */
describe('SessionAuthGuard', () => {
  function makeContext(authorization?: string) {
    const request: any = { headers: authorization ? { authorization } : {} };
    return {
      request,
      context: { switchToHttp: () => ({ getRequest: () => request }) } as any,
    };
  }

  function makeGuard(session: unknown) {
    const prisma: any = {
      session: {
        findUnique: jest.fn().mockResolvedValue(session),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    return { guard: new SessionAuthGuard(prisma), prisma };
  }

  it('never attaches hashedPassword to the request', async () => {
    const { guard } = makeGuard({
      id: 'sess_1',
      expires: new Date(Date.now() + 60_000),
      user: {
        id: 'user_1',
        email: 'user@example.com',
        hashedPassword: '$2b$10$notarealhash',
        subscription: { plan: 'FREE' },
      },
    });

    const { request, context } = makeContext('Bearer tok_1');
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect('hashedPassword' in request.user).toBe(false);
    expect(request.user.id).toBe('user_1');
    expect(request.user.subscription).toEqual({ plan: 'FREE' });
    // request.session is still the full session record handlers expect.
    expect(request.session.id).toBe('sess_1');
  });

  it('rejects a missing authorization header', async () => {
    const { guard } = makeGuard(null);
    await expect(
      guard.canActivate(makeContext().context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('deletes and rejects an expired session', async () => {
    const { guard, prisma } = makeGuard({
      id: 'sess_old',
      expires: new Date(Date.now() - 60_000),
      user: { id: 'user_1', hashedPassword: 'x' },
    });

    await expect(
      guard.canActivate(makeContext('Bearer stale').context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.session.delete).toHaveBeenCalledWith({
      where: { id: 'sess_old' },
    });
  });
});
