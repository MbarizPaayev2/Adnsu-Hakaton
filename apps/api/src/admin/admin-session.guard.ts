import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/database.service';
import { ADMIN_PERMISSION_KEY, AdminPermissionName, needsMfaSession, roleCan } from './permissions';

// Per-operator sessions against AdminUser/AdminSession (same shape as
// SessionAuthGuard and BusinessAuthGuard), plus the permission matrix in
// permissions.ts. The role is read from the database on every request, so a
// role change or disable takes effect immediately.
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(private prisma: PrismaService, private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Yanlış və ya mövcud olmayan icazə başlığı');
    }

    const sessionToken = authHeader.split(' ')[1];

    const session = await this.prisma.adminSession.findUnique({
      where: { sessionToken },
      include: { adminUser: true },
    });

    if (!session) {
      throw new UnauthorizedException('Etibarsız sessiya');
    }

    if (new Date() > session.expires) {
      await this.prisma.adminSession.delete({ where: { id: session.id } }).catch(() => {});
      throw new UnauthorizedException('Sessiyanın müddəti bitib');
    }

    if (session.adminUser.disabledAt) {
      await this.prisma.adminSession.deleteMany({ where: { adminUserId: session.adminUserId } }).catch(() => {});
      throw new UnauthorizedException('Hesab deaktiv edilib');
    }

    // Default deny: a route without a declared permission is not reachable.
    const permission = this.reflector.getAllAndOverride<AdminPermissionName | undefined>(ADMIN_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission || !roleCan(session.adminUser.role, permission)) {
      throw new ForbiddenException('Bu əməliyyat üçün icazəniz yoxdur');
    }
    if (needsMfaSession(permission) && !session.mfaVerified) {
      throw new ForbiddenException({
        message: 'Bu əməliyyat üçün iki mərhələli təsdiqlə daxil olmalısınız.',
        reason: 'MFA_REQUIRED',
      });
    }

    if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.adminSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
    }

    const { hashedPassword: _, mfaSecretEnc: _s, mfaRecoveryCodeHashes: _r, mfaLastUsedStep: _l, ...adminUser } = session.adminUser;
    request.adminUser = adminUser;
    request.adminSession = { id: session.id, mfaVerified: session.mfaVerified };

    return true;
  }
}
