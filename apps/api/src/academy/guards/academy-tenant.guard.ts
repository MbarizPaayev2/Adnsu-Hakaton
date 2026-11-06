import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../database/database.service';
import { ACADEMY_ROLES_KEY } from '../decorators/academy-roles.decorator';
import { AcademyRole } from '@prisma/client';

@Injectable()
export class AcademyTenantGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || !user.id) {
      throw new ForbiddenException('İstifadəçi identifikasiya olunmayıb');
    }

    const academyId = request.params?.academyId || request.headers?.['x-academy-id'];
    if (!academyId || typeof academyId !== 'string') {
      throw new NotFoundException('Akademiya göstərilməyib');
    }

    const member = await this.prisma.academyMember.findUnique({
      where: {
        academyId_userId: {
          academyId,
          userId: user.id,
        },
      },
      include: {
        academy: true,
      },
    });

    if (!member || member.academy.status !== 'ACTIVE') {
      // Do not disclose whether the academy exists to unauthorized callers
      throw new NotFoundException('Akademiya tapılmadı');
    }

    const requiredRoles = this.reflector.getAllAndOverride<AcademyRole[]>(ACADEMY_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRoles && requiredRoles.length > 0) {
      if (!requiredRoles.includes(member.role)) {
        throw new ForbiddenException('Bu əməliyyat üçün səlahiyyətiniz çatmır');
      }
    }

    request.academy = member.academy;
    request.academyMember = member;
    return true;
  }
}
