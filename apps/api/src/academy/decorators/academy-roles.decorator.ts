import { SetMetadata } from '@nestjs/common';
import { AcademyRole } from '@prisma/client';

export const ACADEMY_ROLES_KEY = 'academy_roles';
export const AcademyRoles = (...roles: AcademyRole[]) => SetMetadata(ACADEMY_ROLES_KEY, roles);
