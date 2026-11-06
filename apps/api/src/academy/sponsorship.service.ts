import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AcademySeatGrantStatus, AcademySponsorshipStatus, EnrollmentStatus, SubscriptionPlan } from '@prisma/client';
import { PrismaService } from '../database/database.service';

const SPONSOR_PLANS = new Set<SubscriptionPlan>(['PLUS', 'PREMIUM']);

@Injectable()
export class AcademySponsorshipService {
  constructor(private readonly prisma: PrismaService) {}

  async provision(academyId: string, actorId: string, input: { plan: SubscriptionPlan; seatCapacity: number; startsAt: Date; endsAt: Date }) {
    if (!SPONSOR_PLANS.has(input.plan)) throw new BadRequestException('Pilot sponsor planı Plus və ya Premium olmalıdır');
    if (!Number.isInteger(input.seatCapacity) || input.seatCapacity < 1 || input.seatCapacity > 500) throw new BadRequestException('Oturacaq sayı 1–500 aralığında olmalıdır');
    if (input.endsAt <= input.startsAt) throw new BadRequestException('Bitmə tarixi başlanğıcdan sonra olmalıdır');
    const academy = await this.prisma.academy.findUnique({ where: { id: academyId }, select: { id: true, status: true } });
    if (!academy || academy.status !== 'ACTIVE') throw new NotFoundException('Aktiv akademiya tapılmadı');
    const now = new Date();
    if (input.startsAt > now || input.endsAt <= now) throw new BadRequestException('Pilot proqramı bu gün aktiv edilməli və gələcək tarixdə bitməlidir');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.academySponsorship.create({
          data: { academyId, createdById: actorId, plan: input.plan, seatCapacity: input.seatCapacity, startsAt: input.startsAt, endsAt: input.endsAt, status: AcademySponsorshipStatus.ACTIVE },
        });
        await tx.adminAuditLog.create({ data: { adminUserId: actorId, action: 'academy_sponsorship_provisioned', targetType: 'AcademySponsorship', targetId: created.id, metadata: { academyId, plan: input.plan, seatCapacity: input.seatCapacity, startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString() } } });
        return created;
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') throw new ConflictException('Bu akademiya üçün pilot sponsor proqramı artıq mövcuddur');
      throw error;
    }
  }

  async overview(academyId: string) {
    const program = await this.prisma.academySponsorship.findUnique({ where: { academyId }, include: { academy: { select: { name: true } } } });
    if (!program) throw new NotFoundException('Sponsor proqramı tapılmadı');
    const now = new Date();
    const usedSeats = await this.prisma.academySeatGrant.count({ where: { sponsorshipId: program.id, status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now }, revokedAt: null } });
    const status = program.endsAt <= now ? AcademySponsorshipStatus.ENDED : program.status;
    return { id: program.id, academyId, academyName: program.academy.name, plan: program.plan, status, startsAt: program.startsAt, endsAt: program.endsAt, seatCapacity: program.seatCapacity, usedSeats, availableSeats: Math.max(0, program.seatCapacity - usedSeats) };
  }

  async grant(academyId: string, actorId: string, userId: string) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      // Serialize all seat claims for this academy before checking capacity.
      const programs = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AcademySponsorship" WHERE "academyId" = ${academyId} FOR UPDATE`;
      const programId = programs[0]?.id;
      if (!programId) throw new NotFoundException('Sponsor proqramı tapılmadı');
      const program = await tx.academySponsorship.findUnique({ where: { id: programId }, include: { academy: { select: { status: true } } } });
      if (!program || program.status !== 'ACTIVE' || program.academy.status !== 'ACTIVE' || program.startsAt > now || program.endsAt <= now) throw new ConflictException('Sponsor proqramı hazırda aktiv deyil');

      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, emailVerified: true } });
      if (!user || !user.emailVerified) throw new BadRequestException('Yalnız e-poçtu təsdiqlənmiş hesab sponsor yeri ala bilər');
      const enrollment = await tx.academyEnrollment.findFirst({ where: { academyId, userId, status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.GRADUATED] } }, select: { id: true } });
      if (!enrollment) throw new BadRequestException('Tələbənin bu akademiyada aktiv və ya məzun kohort üzvlüyü olmalıdır');

      const existing = await tx.academySeatGrant.findFirst({ where: { academyId, userId, status: AcademySeatGrantStatus.ACTIVE, endsAt: { gt: now }, revokedAt: null } });
      if (existing) return { grant: existing, alreadyGranted: true };
      const used = await tx.academySeatGrant.count({ where: { sponsorshipId: program.id, status: AcademySeatGrantStatus.ACTIVE, startsAt: { lte: now }, endsAt: { gt: now }, revokedAt: null } });
      if (used >= program.seatCapacity) throw new ConflictException('Sponsor yerləri tükənib');

      const grant = await tx.academySeatGrant.create({ data: { academyId, sponsorshipId: program.id, userId, plan: program.plan, startsAt: now, endsAt: program.endsAt, grantedById: actorId } });
      await tx.planOverride.create({ data: { userId, plan: program.plan, reason: `academy sponsorship:${academyId}`, expiresAt: program.endsAt, createdById: actorId, academySeatGrantId: grant.id } });
      await tx.adminAuditLog.create({ data: { adminUserId: actorId, action: 'academy_sponsorship_seat_granted', targetType: 'AcademySeatGrant', targetId: grant.id, metadata: { academyId, sponsorshipId: program.id, userId, plan: program.plan, endsAt: program.endsAt.toISOString() } } });
      return { grant, alreadyGranted: false };
    });
  }

  async revoke(academyId: string, grantId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.academySeatGrant.findFirst({ where: { id: grantId, academyId, status: AcademySeatGrantStatus.ACTIVE } });
      if (!grant) throw new NotFoundException('Aktiv sponsor yeri tapılmadı');
      const revokedAt = new Date();
      const result = await tx.academySeatGrant.updateMany({ where: { id: grantId, status: AcademySeatGrantStatus.ACTIVE }, data: { status: AcademySeatGrantStatus.REVOKED, revokedAt, revokedById: actorId } });
      if (result.count !== 1) throw new ConflictException('Sponsor yeri artıq dəyişdirilib');
      await tx.planOverride.updateMany({ where: { academySeatGrantId: grantId, revokedAt: null }, data: { revokedAt, revokedById: actorId } });
      await tx.adminAuditLog.create({ data: { adminUserId: actorId, action: 'academy_sponsorship_seat_revoked', targetType: 'AcademySeatGrant', targetId: grantId, metadata: { academyId } } });
      return { revoked: true };
    });
  }

}
