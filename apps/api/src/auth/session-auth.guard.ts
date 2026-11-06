import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../database/database.service';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Yanlış və ya mövcud olmayan icazə başlığı');
    }

    const sessionToken = authHeader.split(' ')[1];

    const session = await this.prisma.session.findUnique({
      where: { sessionToken },
      include: {
        user: {
          include: {
            subscription: true,
          },
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException('Etibarsız sessiya');
    }

    if (new Date() > session.expires) {
      // Clean up expired session
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      throw new UnauthorizedException('Sessiyanın müddəti bitib');
    }

    // Same hash-stripping as the business and admin guards. No handler
    // currently returns @GetUser() verbatim, but the record is one `return`
    // away from being serialized, and password verification always re-reads
    // the user from the DB.
    if (session.user.suspendedAt) {
      await this.prisma.session.deleteMany({ where: { userId: session.userId } }).catch(() => {});
      throw new UnauthorizedException('Hesabınız müvəqqəti dayandırılıb. Dəstək ilə əlaqə saxlayın.');
    }

    const { hashedPassword: _, ...user } = session.user;
    request.user = user;
    request.session = session;

    return true;
  }
}
