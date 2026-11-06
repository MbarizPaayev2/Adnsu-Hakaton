import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/database.service';
import { UpdateCompanyDto } from './dto/update-company.dto';

// Fields safe to expose to unauthenticated public callers — deliberately
// excludes `businessId` (internal FK to the login credential) and
// `rejectionReason` (internal moderation note, meaningless/leaky publicly).
export const PUBLIC_COMPANY_SELECT = {
  id: true,
  name: true,
  logo: true,
  description: true,
  website: true,
  industry: true,
  location: true,
  size: true,
  foundedYear: true,
  contactEmail: true,
  contactPhone: true,
  socialLinks: true,
  status: true,
  createdAt: true,
} as const;

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

  async findAllApproved() {
    return this.prisma.company.findMany({
      where: { status: 'APPROVED' },
      select: {
        ...PUBLIC_COMPANY_SELECT,
        _count: {
          select: { vacancies: { where: { status: 'ACTIVE', AND: [{ OR: [{ deadline: null }, { deadline: { gt: new Date() } }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }] } } },
        },
      },
    });
  }

  async findOneApproved(id: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, status: 'APPROVED' },
      select: {
        ...PUBLIC_COMPANY_SELECT,
        vacancies: {
          // Only vacancies a candidate can still apply to: an expired deadline is not an open vacancy.
          where: { status: 'ACTIVE', AND: [{ OR: [{ deadline: null }, { deadline: { gt: new Date() } }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }] },
        },
      },
    });

    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı və ya təsdiqlənməyib');
    }

    return company;
  }

  async findOne(id: string, businessId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
    });

    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı');
    }

    if (company.businessId !== businessId) {
      throw new ForbiddenException('Bu şirkətə giriş səlahiyyətiniz yoxdur');
    }

    return company;
  }

  async update(id: string, businessId: string, updateCompanyDto: UpdateCompanyDto) {
    const company = await this.findOne(id, businessId);

    // Ensure we are not accidentally overriding businessId
    const { ...updateData } = updateCompanyDto as any;

    return this.prisma.company.update({
      where: { id: company.id },
      data: updateData,
    });
  }
}
