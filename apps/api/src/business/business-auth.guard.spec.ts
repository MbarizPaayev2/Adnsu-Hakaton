import { UnauthorizedException } from '@nestjs/common';
import { BusinessAuthGuard } from './business-auth.guard';

/**
 * Regression cover for the guards attaching the bcrypt hash to the request.
 *
 * GET /business/auth/me returns @GetBusiness() verbatim, so a hash left on
 * request.business was serialized straight to the browser. Nothing in the
 * suite caught it, hence this test.
 */
describe('BusinessAuthGuard', () => {
  const futureExpiry = new Date(Date.now() + 60_000);

  function makeContext(authorization?: string) {
    const request: any = { headers: authorization ? { authorization } : {} };
    return {
      request,
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
      } as any,
    };
  }

  function makeGuard(session: unknown) {
    const prisma: any = {
      businessSession: { findUnique: jest.fn().mockResolvedValue(session) },
    };
    return { guard: new BusinessAuthGuard(prisma), prisma };
  }

  it('never attaches hashedPassword to the request', async () => {
    const { guard } = makeGuard({
      id: 'sess_1',
      expires: futureExpiry,
      business: {
        id: 'biz_1',
        email: 'hr@techcorp.com',
        hashedPassword: '$2b$10$notarealhash',
        emailVerified: new Date(),
        company: { id: 'co_1', name: 'Tech Corp' },
      },
    });

    const { request, context } = makeContext('Bearer tok_1');
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.business).toBeDefined();
    expect('hashedPassword' in request.business).toBe(false);
    // The fields handlers actually rely on must survive the strip.
    expect(request.business.id).toBe('biz_1');
    expect(request.business.email).toBe('hr@techcorp.com');
    expect(request.business.company).toEqual({ id: 'co_1', name: 'Tech Corp' });
  });

  it('rejects a missing or malformed authorization header', async () => {
    const { guard } = makeGuard(null);

    await expect(
      guard.canActivate(makeContext().context),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      guard.canActivate(makeContext('tok_without_bearer').context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown or expired session', async () => {
    const unknown = makeGuard(null);
    await expect(
      unknown.guard.canActivate(makeContext('Bearer nope').context),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const expired = makeGuard({
      id: 'sess_2',
      expires: new Date(Date.now() - 60_000),
      business: { id: 'biz_1', hashedPassword: 'x' },
    });
    await expect(
      expired.guard.canActivate(makeContext('Bearer stale').context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
