import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/database.service';
import { PostHogService } from '../common/posthog.service';
import { PUBLIC_COMPANY_SELECT } from '../companies/companies.service';
import { CreateVolunteerOpportunityDto } from './dto/create-volunteer-opportunity.dto';

@Injectable()
export class VolunteeringService {
  constructor(
    private prisma: PrismaService,
    private postHogService: PostHogService,
  ) {}

  // Public, unauthenticated browsing — same posture as GET /vacancies (only
  // ACTIVE listings from APPROVED companies, public-safe company fields only).
  async findAllPublic() {
    return this.prisma.volunteerOpportunity.findMany({
      where: { status: 'ACTIVE', company: { status: 'APPROVED' } },
      include: { company: { select: PUBLIC_COMPANY_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllOwn(companyId: string) {
    return this.prisma.volunteerOpportunity.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async findOneOwn(id: string, companyId: string) {
    const opportunity = await this.prisma.volunteerOpportunity.findFirst({
      where: { id, companyId },
    });

    if (!opportunity) {
      throw new NotFoundException('Könüllülük fürsəti tapılmadı');
    }

    return opportunity;
  }

  // Free by design: no plan/billing check for the business, no CV/skill
  // matching, no application-quota interaction — entirely separate pipeline
  // from Vacancy/Match. Still gated on company approval, same anti-spam
  // posture as real vacancy postings.
  async create(business: any, dto: CreateVolunteerOpportunityDto) {
    if (business.company.status !== 'APPROVED') {
      throw new ForbiddenException('Könüllülük fürsəti yaratmaq üçün şirkət təsdiqlənmiş olmalıdır');
    }

    const opportunity = await this.prisma.volunteerOpportunity.create({
      data: {
        companyId: business.company.id,
        title: dto.title,
        description: dto.description,
        location: dto.location,
      },
    });

    await this.notifyOptedInUsers(opportunity.id, opportunity.title, business.company.name);

    this.postHogService.capture(business.id, 'volunteer_opportunity_posted', {
      opportunityId: opportunity.id,
      companyId: business.company.id,
    });

    return opportunity;
  }

  async updateStatus(id: string, companyId: string, status: 'ACTIVE' | 'CLOSED') {
    const opportunity = await this.findOneOwn(id, companyId);

    return this.prisma.volunteerOpportunity.update({
      where: { id: opportunity.id },
      data: { status },
    });
  }

  // In-app notification only — explicitly no email, no CV/skill matching, no
  // quota interaction, and free on every plan. Every opted-in user gets one
  // regardless of subscription tier.
  private async notifyOptedInUsers(opportunityId: string, title: string, companyName: string) {
    const interestedUsers = await this.prisma.user.findMany({
      where: { profile: { volunteerOpportunitiesOptIn: true } },
      select: { id: true },
    });

    if (!interestedUsers.length) return;

    await this.prisma.notification.createMany({
      data: interestedUsers.map((u) => ({
        userId: u.id,
        type: 'VOLUNTEER_OPPORTUNITY' as const,
        message: `Yeni gənclər üçün könüllülük fürsəti: ${title} (${companyName})`,
        payload: { opportunityId, title, companyName },
      })),
    });
  }
}
