import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../database/database.service';

@Injectable()
export class BusinessAuthGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Yanlış və ya mövcud olmayan icazə başlığı');
    }

    const token = authHeader.replace('Bearer ', '');

    const session = await this.prisma.businessSession.findUnique({
      where: { sessionToken: token },
      include: {
        business: {
          include: { company: true }
        }
      },
    });

    if (!session || session.expires < new Date()) {
      throw new UnauthorizedException('Sessiya etibarsızdır və ya vaxtı bitib');
    }

    // Strip the bcrypt hash before the record reaches any handler. GET
    // /business/auth/me returns @GetBusiness() verbatim, so without this the
    // hash was serialized straight to the browser. Matches what
    // admin/admin-session.guard.ts already does; changePassword re-reads the
    // business from the DB, so nothing downstream needs the hash here.
    const { hashedPassword: _, ...business } = session.business;
    request.business = business;
    
    return true;
  }
}
