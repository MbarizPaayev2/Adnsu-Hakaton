import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../database/database.service';
import type { UploadPrincipal } from './upload-access.service';

@Injectable()
export class AnySessionGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Yanlış və ya mövcud olmayan icazə başlığı');
    }

    const token = authHeader.slice('Bearer '.length);
    const now = new Date();

    const [userSession, businessSession, adminSession] = await Promise.all([
      this.prisma.session.findUnique({ where: { sessionToken: token } }),
      this.prisma.businessSession.findUnique({ where: { sessionToken: token } }),
      this.prisma.adminSession.findUnique({ where: { sessionToken: token } }),
    ]);

    let principal: UploadPrincipal | null = null;
    if (adminSession && adminSession.expires > now) {
      principal = { kind: 'admin' };
    } else if (userSession && userSession.expires > now) {
      principal = { kind: 'user', userId: userSession.userId };
    } else if (businessSession && businessSession.expires > now) {
      principal = { kind: 'business', businessId: businessSession.businessId };
    }

    if (!principal) {
      throw new UnauthorizedException('Sessiya etibarsızdır və ya vaxtı bitib');
    }

    request.uploadPrincipal = principal;
    return true;
  }
}
