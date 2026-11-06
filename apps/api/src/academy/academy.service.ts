import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/database.service';
import { CreateAcademyDto, UpdateAcademyDto } from './dto/create-academy.dto';
import { CreateCohortDto, UpdateCohortDto } from './dto/cohort.dto';
import { InviteStaffDto, InviteStudentsDto, AcceptInvitationDto, ConsentScopeDto } from './dto/invitation.dto';
import { AcademyRole, ConsentScope, EnrollmentStatus, CohortStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { AcademyCohortKpisResponse, AcademyCohortReport, AcademyKpisResponse, AcademyMetric, AcademyReportingWindow } from '@aise/shared-types';

export const MIN_COHORT_AGGREGATION_THRESHOLD = 5;

function metric(
  value: number | null,
  contributors: number,
  denominator: number,
  unit: AcademyMetric['unit'],
  definition: string,
  provenance: string[],
): AcademyMetric {
  if (denominator === 0) {
    return { value: null, status: 'NOT_YET_REPORTED', unit, denominator: { value: null, unit: 'students', label: 'Razılıq vermiş, müşahidə dövründə uyğun iştirakçılar' }, definition, provenance };
  }
  if (denominator < MIN_COHORT_AGGREGATION_THRESHOLD || (contributors > 0 && contributors < MIN_COHORT_AGGREGATION_THRESHOLD)) {
    return { value: null, status: 'SUPPRESSED', unit, denominator: { value: null, unit: 'students', label: 'Razılıq vermiş, müşahidə dövründə uyğun iştirakçılar' }, definition, provenance };
  }
  if (contributors === 0 || value === null) {
    return { value: null, status: 'NOT_YET_REPORTED', unit, denominator: { value: denominator, unit: 'students', label: 'Razılıq vermiş, müşahidə dövründə uyğun iştirakçılar' }, definition, provenance };
  }
  return { value, status: 'MEASURED', unit, denominator: { value: denominator, unit: 'students', label: 'Razılıq vermiş, müşahidə dövründə uyğun iştirakçılar' }, definition, provenance };
}

interface ConfirmedApplicationEvidence {
  sourceId: string;
  userId: string;
  postingRef: string | null;
  channel: 'native' | 'external' | 'email' | 'browserAgent';
  confirmedAt: Date;
  provenance: 'AISE_APPLICATION' | 'PORTAL_SUBMITTED' | 'EMAIL_DELIVERED' | 'AGENT_SUBMITTED';
}

type CohortKpis = AcademyCohortKpisResponse;

@Injectable()
export class AcademyService {
  constructor(private prisma: PrismaService) {}

  // ── Workspace & Member Management ──────────────────────────────────────────

  async createAcademy(userId: string, dto: CreateAcademyDto) {
    const existing = await this.prisma.academy.findUnique({
      where: { slug: dto.slug.toLowerCase().trim() },
    });
    if (existing) {
      throw new ConflictException('Bu identifikator (slug) artıq istifadə olunur');
    }

    return this.prisma.$transaction(async (tx) => {
      const academy = await tx.academy.create({
        data: {
          name: dto.name.trim(),
          slug: dto.slug.toLowerCase().trim(),
          contactEmail: dto.contactEmail.toLowerCase().trim(),
          website: dto.website?.trim() || null,
        },
      });

      await tx.academyMember.create({
        data: {
          academyId: academy.id,
          userId,
          role: AcademyRole.OWNER,
        },
      });

      return academy;
    });
  }

  async listUserAcademies(userId: string) {
    const memberships = await this.prisma.academyMember.findMany({
      where: { userId },
      include: {
        academy: {
          include: {
            _count: {
              select: {
                cohorts: true,
                enrollments: true,
                members: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return memberships.map((m) => ({
      ...m.academy,
      myRole: m.role,
      joinedAt: m.createdAt,
    }));
  }

  async getAcademy(academyId: string) {
    const academy = await this.prisma.academy.findUnique({
      where: { id: academyId },
      include: {
        _count: {
          select: {
            cohorts: true,
            enrollments: true,
            members: true,
          },
        },
      },
    });

    if (!academy || academy.status !== 'ACTIVE') {
      throw new NotFoundException('Akademiya tapılmadı');
    }

    return academy;
  }

  async updateAcademy(academyId: string, dto: UpdateAcademyDto) {
    await this.getAcademy(academyId);

    return this.prisma.academy.update({
      where: { id: academyId },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.contactEmail ? { contactEmail: dto.contactEmail.toLowerCase().trim() } : {}),
        ...(dto.website !== undefined ? { website: dto.website?.trim() || null } : {}),
      },
    });
  }

  async listMembers(academyId: string) {
    return this.prisma.academyMember.findMany({
      where: { academyId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async inviteStaff(academyId: string, inviterUserId: string, dto: InviteStaffDto) {
    const email = dto.email.toLowerCase().trim();

    // Check if user is already an active member
    const existingMember = await this.prisma.academyMember.findFirst({
      where: {
        academyId,
        user: { email },
      },
    });
    if (existingMember) {
      throw new ConflictException('Bu istifadəçi artıq akademiya komandasındadır');
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 86_400_000); // 7 days

    return this.prisma.academyStaffInvitation.create({
      data: {
        academyId,
        email,
        role: dto.role as AcademyRole,
        token,
        expiresAt,
      },
    });
  }

  async acceptStaffInvitation(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, emailVerified: true },
    });
    if (!user || !user.email) {
      throw new NotFoundException('İstifadəçi hesabı tapılmadı');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException('Dəvəti qəbul etmək üçün əvvəlcə e-poçt ünvanınızı təsdiqləyin (EMAIL_NOT_VERIFIED)');
    }

    const invitation = await this.prisma.academyStaffInvitation.findUnique({
      where: { token },
    });
    if (!invitation) {
      throw new NotFoundException('Dəvət tapılmadı');
    }

    if (user.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) {
      throw new ForbiddenException('Bu dəvət başqa e-poçt ünvanına göndərilib');
    }

    if (invitation.acceptedAt) {
      throw new BadRequestException('Bu dəvət artıq qəbul edilib');
    }

    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Dəvətin vaxtı bitib');
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.academyStaffInvitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now },
      });

      if (updateResult.count === 0) {
        throw new BadRequestException('Bu dəvət artıq qəbul edilib və ya vaxtı bitib');
      }

      return tx.academyMember.upsert({
        where: {
          academyId_userId: {
            academyId: invitation.academyId,
            userId,
          },
        },
        create: {
          academyId: invitation.academyId,
          userId,
          role: invitation.role,
        },
        update: {
          role: invitation.role,
        },
      });
    });
  }

  async removeMember(academyId: string, memberId: string, actorUserId?: string) {
    const targetMember = await this.prisma.academyMember.findUnique({
      where: { id: memberId },
    });
    if (!targetMember || targetMember.academyId !== academyId) {
      throw new NotFoundException('Üzv tapılmadı');
    }

    if (targetMember.role === AcademyRole.OWNER) {
      const ownerCount = await this.prisma.academyMember.count({
        where: { academyId, role: AcademyRole.OWNER },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException('Akademiyanın yeganə sahibini silmək mümkün deyil');
      }
    }

    await this.prisma.academyMember.delete({
      where: { id: memberId },
    });

    return { success: true, message: 'Üzv akademiyadan çıxarıldı' };
  }

  // ── Cohort Management ──────────────────────────────────────────────────────

  async listCohorts(academyId: string) {
    return this.prisma.academyCohort.findMany({
      where: { academyId },
      include: {
        _count: {
          select: {
            enrollments: true,
          },
        },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  async createCohort(academyId: string, dto: CreateCohortDto) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (start >= end) {
      throw new BadRequestException('Başlama tarixi bitmə tarixindən əvvəl olmalıdır');
    }

    const slug = dto.slug.toLowerCase().trim();
    const existing = await this.prisma.academyCohort.findUnique({
      where: {
        academyId_slug: {
          academyId,
          slug,
        },
      },
    });
    if (existing) {
      throw new ConflictException('Bu kohort identifikatoru (slug) artıq mövcuddur');
    }

    return this.prisma.academyCohort.create({
      data: {
        academyId,
        name: dto.name.trim(),
        slug,
        description: dto.description?.trim() || null,
        startDate: start,
        endDate: end,
      },
    });
  }

  async getCohort(academyId: string, cohortId: string) {
    const cohort = await this.prisma.academyCohort.findFirst({
      where: { id: cohortId, academyId },
      include: {
        _count: {
          select: {
            enrollments: true,
          },
        },
      },
    });

    if (!cohort) {
      throw new NotFoundException('Kohort tapılmadı');
    }

    return cohort;
  }

  async updateCohort(academyId: string, cohortId: string, dto: UpdateCohortDto) {
    const cohort = await this.getCohort(academyId, cohortId);

    const start = dto.startDate ? new Date(dto.startDate) : cohort.startDate;
    const end = dto.endDate ? new Date(dto.endDate) : cohort.endDate;
    if (start >= end) {
      throw new BadRequestException('Başlama tarixi bitmə tarixindən əvvəl olmalıdır');
    }

    return this.prisma.academyCohort.update({
      where: { id: cohortId },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.startDate ? { startDate: start } : {}),
        ...(dto.endDate ? { endDate: end } : {}),
        ...(dto.status ? { status: dto.status as CohortStatus } : {}),
      },
    });
  }

  // ── Student Invitations & Roster ───────────────────────────────────────────

  async inviteStudents(academyId: string, cohortId: string, dto: InviteStudentsDto) {
    await this.getCohort(academyId, cohortId);

    const distinctEmails = [...new Set(dto.emails.map((e) => e.toLowerCase().trim()))];
    const invitations: Array<{ email: string; inviteToken: string; expiresAt: Date; disposition: 'CREATED' | 'RENEWED' }> = [];
    const skipped: Array<{ email: string; reason: 'ALREADY_ACTIVE' | 'WITHDRAWN' | 'GRADUATED' }> = [];
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14-day validity

    for (const email of distinctEmails) {
      const inviteToken = crypto.randomBytes(24).toString('hex');
      const existing = await this.prisma.academyEnrollment.findUnique({
        where: {
          cohortId_invitedEmail: {
            cohortId,
            invitedEmail: email,
          },
        },
      });

      let enrollment: any;
      let disposition: 'CREATED' | 'RENEWED' | null = null;
      if (!existing) {
        enrollment = await this.prisma.academyEnrollment.create({
          data: {
            academyId,
            cohortId,
            invitedEmail: email,
            inviteToken,
            expiresAt,
            status: EnrollmentStatus.INVITED,
          },
        });
        disposition = 'CREATED';
      } else if (existing.status === EnrollmentStatus.INVITED) {
        // Re-inviting an existing invitation (e.g. expired or re-sent) returns a fresh, valid token and 14-day expiry
        enrollment = await this.prisma.academyEnrollment.update({
          where: { id: existing.id },
          data: {
            inviteToken,
            expiresAt,
          },
        });
        disposition = 'RENEWED';
      } else {
        // Active, withdrawn, or graduated students are preserved without resetting active status or reviving withdrawn records
        enrollment = existing;
        skipped.push({
          email,
          reason: existing.status === EnrollmentStatus.WITHDRAWN ? 'WITHDRAWN'
            : existing.status === EnrollmentStatus.GRADUATED ? 'GRADUATED' : 'ALREADY_ACTIVE',
        });
      }

      if (disposition && enrollment?.inviteToken && enrollment?.expiresAt) {
        invitations.push({ email, inviteToken: enrollment.inviteToken, expiresAt: enrollment.expiresAt, disposition });
      }
    }

    return {
      invitedCount: invitations.length,
      createdCount: invitations.filter((item) => item.disposition === 'CREATED').length,
      renewedCount: invitations.filter((item) => item.disposition === 'RENEWED').length,
      skippedCount: skipped.length,
      delivery: 'MANUAL_LINKS' as const,
      invitations,
      skipped,
    };
  }

  async listCohortStudents(academyId: string, cohortId: string) {
    await this.getCohort(academyId, cohortId);

    const enrollments = await this.prisma.academyEnrollment.findMany({
      where: { academyId, cohortId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
          },
        },
        consents: {
          orderBy: { grantedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Privacy rule: Default academy access to anonymous aggregate reporting.
    // Expose student identity fields (name, email) ONLY under active, explicit IDENTIFIABLE_ROSTER consent.
    // Under AGGREGATE_ONLY, pending, or revoked consent, identity fields are strictly withheld (null).
    // Private candidate documents (CV text, phone, letters, private notes) are unconditionally never exposed.
    return enrollments.map((e) => {
      const consent = e.consents?.[0];
      const consentActive = !!consent && !consent.revokedAt;
      const isIdentifiable = consentActive && (consent.scope === ConsentScope.IDENTIFIABLE_ROSTER || consent.scope === ConsentScope.SHARED_DOCUMENTS);
      return {
        id: e.id,
        status: e.status,
        joinedAt: e.joinedAt,
        withdrawnAt: e.withdrawnAt,
        expiresAt: e.expiresAt,
        hasAccount: !!e.userId,
        consentActive,
        consentStatus: consent?.revokedAt
          ? 'REVOKED'
          : consent
            ? 'ACTIVE'
            : 'NONE',
        consentScope: consent?.scope || null,
        consentGrantedAt: consent?.grantedAt || null,
        identityExposed: isIdentifiable,
        // Identity exposed ONLY under active IDENTIFIABLE_ROSTER consent; null under AGGREGATE_ONLY
        studentName: isIdentifiable ? (e.user?.name || null) : null,
        invitedEmail: isIdentifiable ? (e.user?.email || e.invitedEmail) : null,
      };
    });
  }

  async withdrawStudent(academyId: string, cohortId: string, enrollmentId: string) {
    const enrollment = await this.prisma.academyEnrollment.findFirst({
      where: { id: enrollmentId, academyId, cohortId },
    });
    if (!enrollment) {
      throw new NotFoundException('Qeydiyyat tapılmadı');
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      // Revoke any active consent immediately
      await tx.academyConsent.updateMany({
        where: { enrollmentId, revokedAt: null },
        data: { revokedAt: now },
      });

      return tx.academyEnrollment.update({
        where: { id: enrollmentId },
        data: {
          status: EnrollmentStatus.WITHDRAWN,
          withdrawnAt: now,
        },
      });
    });
  }

  // ── Student Join & Consent Endpoints ───────────────────────────────────────

  async getInvitationByToken(token: string) {
    const enrollment = await this.prisma.academyEnrollment.findUnique({
      where: { inviteToken: token },
      include: {
        academy: {
          select: {
            name: true,
            slug: true,
            contactEmail: true,
            website: true,
          },
        },
        cohort: {
          select: {
            name: true,
            slug: true,
            description: true,
            startDate: true,
            endDate: true,
          },
        },
      },
    });

    if (!enrollment || enrollment.status === EnrollmentStatus.WITHDRAWN) {
      throw new NotFoundException('Dəvət tapılmadı və ya artıq ləğv edilib');
    }

    if (enrollment.expiresAt && enrollment.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Dəvətin vaxtı bitib');
    }

    return {
      token: enrollment.inviteToken,
      invitedEmail: enrollment.invitedEmail,
      expiresAt: enrollment.expiresAt,
      status: enrollment.status,
      academy: enrollment.academy,
      cohort: enrollment.cohort,
      consentExplanation: {
        title: 'Akademiyanın görəcəyi məlumatlar və razılıq seçimləri',
        defaultScope: 'AGGREGATE_ONLY',
        visibleItems: [
          'Kohort üzrə ümumi aqreqat statistikaya anonim daxil edilmə (hazırlanmış sənəd və müraciət sayı).',
          'Bildirilmiş nəticələr üzrə anonim ümumiləşdirilmiş hesabatlar (müsahibə, təklif, işə başlama).',
        ],
        hiddenItems: [
          'Defolt olaraq: Adınız və e-poçtunuz heç vaxt kohort siyahısında göstərilmir (tam anonim qalır).',
          'Şəxsi CV fayllarınız və generasiya edilmiş motivasiya məktublarının tam mətnləri.',
          'Telefon nömrəniz, işəgötürənlərlə yazışmalar və fərdi müraciət qeydləriniz.',
        ],
        optionalRosterNote: 'Yalnız ayrıca "IDENTIFIABLE_ROSTER" razılığı verdiyiniz halda mentorlar ad və e-poçtunuzu kohort siyahısında fərdi irəliləyişi izləmək üçün görə bilər.',
        revocationNote: 'Razılığı istənilən vaxt profil ayarlarınızdan bir kliklə ləğv edə bilərsiniz. Ləğv edildikdə bütün məlumatlar dərhal gizlədilir.',
      },
    };
  }

  async acceptInvitation(userId: string, token: string, dto: AcceptInvitationDto = { scope: ConsentScopeDto.AGGREGATE_ONLY }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, emailVerified: true },
    });
    if (!user || !user.email) {
      throw new NotFoundException('İstifadəçi hesabı tapılmadı');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException('Dəvəti qəbul etmək üçün əvvəlcə e-poçt ünvanınızı təsdiqləyin (EMAIL_NOT_VERIFIED)');
    }

    const enrollment = await this.prisma.academyEnrollment.findUnique({
      where: { inviteToken: token },
    });

    if (!enrollment || enrollment.status === EnrollmentStatus.WITHDRAWN) {
      throw new NotFoundException('Dəvət tapılmadı və ya etibarsızdır');
    }

    if (enrollment.expiresAt && enrollment.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Dəvətin vaxtı bitib');
    }

    if (user.email.trim().toLowerCase() !== enrollment.invitedEmail.trim().toLowerCase()) {
      throw new ForbiddenException('Bu dəvət başqa e-poçt ünvanına göndərilib');
    }

    if (enrollment.status === EnrollmentStatus.ACTIVE && enrollment.userId) {
      throw new BadRequestException('Bu dəvət artıq qəbul edilib');
    }

    const now = new Date();
    const chosenScope =
      dto?.scope === 'IDENTIFIABLE_ROSTER'
        ? ConsentScope.IDENTIFIABLE_ROSTER
        : ConsentScope.AGGREGATE_ONLY;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const alreadyEnrolled = await tx.academyEnrollment.findFirst({
          where: {
            cohortId: enrollment.cohortId,
            userId,
            status: EnrollmentStatus.ACTIVE,
          },
          select: { id: true },
        });
        if (alreadyEnrolled) {
          throw new ConflictException('Bu tələbə artıq bu kohortda qeydiyyatdadır');
        }

      const updateResult = await tx.academyEnrollment.updateMany({
        where: {
          id: enrollment.id,
          status: EnrollmentStatus.INVITED,
          userId: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        data: {
          userId,
          status: EnrollmentStatus.ACTIVE,
          joinedAt: now,
        },
      });

      if (updateResult.count === 0) {
        throw new BadRequestException('Bu dəvət artıq qəbul edilib və ya etibarsızdır');
      }

      await tx.academyConsent.create({
        data: {
          enrollmentId: enrollment.id,
          userId,
          academyId: enrollment.academyId,
          scope: chosenScope,
          consentTextVersion: 'v1.1',
          grantedAt: now,
        },
      });

        return {
          id: enrollment.id,
          academyId: enrollment.academyId,
          cohortId: enrollment.cohortId,
          status: EnrollmentStatus.ACTIVE,
          joinedAt: now,
          userId,
          scope: chosenScope,
        };
      });
    } catch (error) {
      // A unique cohort/user constraint is the final guard against concurrent acceptance
      // of two invitations for the same person.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('Bu tələbə artıq bu kohortda qeydiyyatdadır');
      }
      throw error;
    }
  }

  async acceptEnrollment(userId: string, token: string, dto: AcceptInvitationDto = { scope: ConsentScopeDto.AGGREGATE_ONLY }) {
    return this.acceptInvitation(userId, token, dto);
  }

  async revokeConsent(userId: string, enrollmentId: string) {
    const enrollment = await this.prisma.academyEnrollment.findFirst({
      where: { id: enrollmentId, userId },
    });
    if (!enrollment) {
      throw new NotFoundException('Qeydiyyat tapılmadı');
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.academyConsent.updateMany({
        where: { enrollmentId, userId, revokedAt: null },
        data: { revokedAt: now },
      });

      return tx.academyEnrollment.update({
        where: { id: enrollmentId },
        data: {
          status: EnrollmentStatus.WITHDRAWN,
          withdrawnAt: now,
        },
      });
    });
  }

  async getMyEnrollments(userId: string) {
    const enrollments = await this.prisma.academyEnrollment.findMany({
      where: { userId },
      include: {
        academy: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        cohort: {
          select: {
            id: true,
            name: true,
            slug: true,
            startDate: true,
            endDate: true,
            status: true,
          },
        },
        consents: {
          orderBy: { grantedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return enrollments.map((e) => ({
      id: e.id,
      academy: e.academy,
      cohort: e.cohort,
      status: e.status,
      joinedAt: e.joinedAt,
      withdrawnAt: e.withdrawnAt,
      consentActive: !e.consents[0]?.revokedAt,
      consentScope: e.consents[0]?.scope || null,
    }));
  }

  // ── KPI Analytics Engine ───────────────────────────────────────────────────

  async getCohortKpis(academyId: string, cohortId: string, asOf = new Date()): Promise<CohortKpis> {
    const cohort = await this.getCohort(academyId, cohortId);

    // Active and graduated students remain eligible during the outcome follow-up window.
    const enrollments = await this.prisma.academyEnrollment.findMany({
      where: {
        academyId,
        cohortId,
        status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.GRADUATED] },
        userId: { not: null },
        consents: {
          some: {
            revokedAt: null,
          },
        },
      },
      select: {
        userId: true,
        joinedAt: true,
      },
    });

    const enrolledTotal = await this.prisma.academyEnrollment.count({
      where: { academyId, cohortId },
    });

    // Count distinct people, never invitation rows, in cohort size and privacy denominators.
    const activeUserIds = [...new Set(
      enrollments
        .map((e) => e.userId)
        .filter((id): id is string => typeof id === 'string'),
    )];

    const observationEnd = new Date(Math.max(
      cohort.startDate.getTime(),
      Math.min(asOf.getTime(), cohort.endDate.getTime() + 90 * 24 * 60 * 60 * 1000),
    ));
    const dateRange = {
      start: cohort.startDate.toISOString().slice(0, 10),
      end: observationEnd.toISOString().slice(0, 10),
    };
    const reportingPeriod = `${dateRange.start} – ${dateRange.end}`;
    const reportingWindow: AcademyReportingWindow = {
      training: { start: cohort.startDate.toISOString(), end: cohort.endDate.toISOString() },
      observation: { start: cohort.startDate.toISOString(), end: observationEnd.toISOString() },
      asOf: asOf.toISOString(),
      preEnrollmentActivity: 'EXCLUDED',
    };

    if (activeUserIds.length === 0) {
      return {
        reportingWindow,
        metrics: {
          eligibleStudents: metric(null, 0, 0, 'students', 'Razılığı aktiv olan, kohorta qoşulmuş tələbələr.', []),
          applicants: metric(null, 0, 0, 'students', 'Müşahidə dövründə təsdiqlənmiş müraciəti olan unikal tələbələr.', []),
          submittedApplications: metric(null, 0, 0, 'applications', 'Təsdiqlənmiş müraciət hadisələri; kanallar üzrə mənbə qeydləri.', []),
          preparedStudents: metric(null, 0, 0, 'students', 'Ən azı bir sənəd hazırlayan unikal tələbələr.', []),
          interviewedStudents: metric(null, 0, 0, 'students', 'Müsahibə bildirmiş unikal tələbələr.', []),
          studentsWithOffers: metric(null, 0, 0, 'students', 'İş təklifi alan unikal tələbələr.', []),
          acceptedOffers: metric(null, 0, 0, 'students', 'Təklifi qəbul edən unikal tələbələr.', []),
          studentsStartedWork: metric(null, 0, 0, 'students', 'Faktiki işə başlayan unikal tələbələr.', []),
          medianDaysToFirstApplication: metric(null, 0, 0, 'days', 'Kohortaya qoşulduqdan sonra ilk təsdiqlənmiş müraciətə qədər median gün.', []),
        },
        dateRange,
        reportingPeriod,
        cohortId: cohort.id,
        cohortName: cohort.name,
        enrolledTotal: null,
        activeConsented: null,
        minAggregationThreshold: MIN_COHORT_AGGREGATION_THRESHOLD,
        isSuppressed: false,
        suppressionReason: null,
        dataCompleteness: {
          studentsWithReportedOutcomes: null,
          completenessPct: null,
          status: 'NOT_YET_REPORTED',
          definition: 'Nəticə barədə ən az bir məlumat daxil edən tələbələrin payı (cavabsızlıq rədd və ya işə qəbul kimi qəbul edilmir). Məxrəc: razılıq vermiş aktiv tələbələr.',
        },
        preparation: {
          activeStudents: null,
          totalDocumentsPrepared: null,
          status: 'NOT_YET_REPORTED',
          definition: 'Kohort müddətində ən az bir CV və ya motivasiya məktubu hazırlayan tələbələr. Məxrəc: razılıq vermiş aktiv tələbələr.',
        },
        applications: {
          totalSubmitted: null,
          distinctStudentsApplied: null,
          status: 'NOT_YET_REPORTED',
          byChannel: { native: null, external: null, email: null, browserAgent: null, manualTracker: null },
          definition: 'Bütün kanallar (AISE, xarici portallar, e-poçt və brauzer köməkçisi) üzrə göndərilən təsdiqlənmiş müraciət hadisələri.',
        },
        funnel: {
          applied: null,
          distinctApplied: null,
          interviews: {
            count: null,
            distinctStudents: null,
            totalEvents: null,
            employerConfirmed: null,
            candidateReported: null,
            status: 'NOT_YET_REPORTED',
            ratePct: null,
            definition: 'Müsahibə mərhələsinə keçən unikal tələbələr. Məxrəc: razılıq vermiş aktiv tələbələr.',
          },
          offersReceived: {
            count: null,
            distinctStudents: null,
            totalEvents: null,
            status: 'NOT_YET_REPORTED',
            ratePct: null,
            definition: 'İş təklifi alan unikal tələbələr. Məxrəc: razılıq vermiş aktiv tələbələr.',
          },
          offersAccepted: {
            count: null,
            distinctStudents: null,
            totalEvents: null,
            status: 'NOT_YET_REPORTED',
            ratePct: null,
            definition: 'Təklifi qəbul edən unikal tələbələr (hələ işə başlamamış ola bilər). Məxrəc: razılıq vermiş aktiv tələbələr.',
          },
          jobStarted: {
            count: null,
            distinctStudents: null,
            totalEvents: null,
            status: 'NOT_YET_REPORTED',
            employerConfirmed: null,
            candidateReported: null,
            ratePct: null,
            definition: 'Faktiki işə başlayan unikal tələbələr (qəbul olunmuş təklifdən ayrı hesablanır). Məxrəc: razılıq vermiş aktiv tələbələr.',
          },
          offers: { count: null, status: 'NOT_YET_REPORTED', employerConfirmed: null, candidateReported: null, ratePct: null, definition: 'Təsdiqlənmiş və ya bildirilmiş iş təklifləri.' },
          hires: { count: null, status: 'NOT_YET_REPORTED', employerConfirmed: null, candidateReported: null, ratePct: null, definition: 'Faktiki işə başlayan tələbələr.' },
        },
        timeToFirstApplicationDays: {
          medianDays: null,
          definition: 'Kohortun başlanmasından tələbənin ilk müraciətinə qədər olan orta gün sayı.',
          status: 'NOT_YET_REPORTED',
        },
      };
    }

    const start = cohort.startDate;
    const end = observationEnd;
    const enrollmentStart = new Map(enrollments.map((enrollment) => [
      enrollment.userId!,
      new Date(Math.max(start.getTime(), enrollment.joinedAt?.getTime() ?? start.getTime())),
    ]));
    const inObservation = (userId: string, timestamp: Date | null | undefined) => {
      const since = enrollmentStart.get(userId);
      return Boolean(timestamp && since && timestamp >= since && timestamp <= end);
    };

    // 1. Preparation Activity: Resumes & Letters created
    const resumeRows = await this.prisma.resume.findMany({
      where: {
        userId: { in: activeUserIds },
        createdAt: { gte: start, lte: end },
      },
      select: { userId: true, createdAt: true },
    });
    const resumes = resumeRows.filter((resume) => inObservation(resume.userId, resume.createdAt));
    const distinctPreparedStudents = new Set(resumes.map((r) => r.userId)).size;

    // 2. Applications by channel (Only actual confirmed submitted applications; tracker overlays excluded)
    const [nativeApps, externalApps, emailApps, agentApps] = await Promise.all([
      this.prisma.application.findMany({
        where: { userId: { in: activeUserIds }, createdAt: { gte: start, lte: end } },
        select: { id: true, userId: true, vacancyId: true, createdAt: true },
      }),
      this.prisma.externalApplication.findMany({
        where: {
          userId: { in: activeUserIds },
          status: 'SUBMITTED',
          submittedAt: { gte: start, lte: end },
        },
        select: { id: true, userId: true, matchId: true, submittedAt: true },
      }),
      this.prisma.emailApplication.findMany({
        where: {
          userId: { in: activeUserIds },
          deliveryState: 'DELIVERED',
          deliveredAt: { gte: start, lte: end },
        },
        select: { id: true, userId: true, jobId: true, jobUrl: true, deliveredAt: true },
      }),
      this.prisma.agentApplication.findMany({
        where: {
          userId: { in: activeUserIds },
          state: 'SUBMITTED',
          submittedAt: { gte: start, lte: end },
        },
        select: { id: true, userId: true, jobId: true, submittedAt: true },
      }),
    ]);

    // Read projection over existing ledgers; tracker overlays and unconfirmed states are excluded.
    const applicationEvidence: ConfirmedApplicationEvidence[] = [
      ...nativeApps.filter((a) => inObservation(a.userId, a.createdAt)).map((a) => ({ sourceId: a.id, userId: a.userId, postingRef: `vacancy:${a.vacancyId}`, channel: 'native' as const, confirmedAt: a.createdAt, provenance: 'AISE_APPLICATION' as const })),
      ...externalApps.filter((a) => inObservation(a.userId, a.submittedAt)).map((a) => ({ sourceId: a.id, userId: a.userId, postingRef: `external-match:${a.matchId}`, channel: 'external' as const, confirmedAt: a.submittedAt!, provenance: 'PORTAL_SUBMITTED' as const })),
      ...emailApps.filter((a) => inObservation(a.userId, a.deliveredAt)).map((a) => ({ sourceId: a.id, userId: a.userId, postingRef: a.jobId ? `job:${a.jobId}` : a.jobUrl || null, channel: 'email' as const, confirmedAt: a.deliveredAt!, provenance: 'EMAIL_DELIVERED' as const })),
      ...agentApps.filter((a) => inObservation(a.userId, a.submittedAt)).map((a) => ({ sourceId: a.id, userId: a.userId, postingRef: `job:${a.jobId}`, channel: 'browserAgent' as const, confirmedAt: a.submittedAt!, provenance: 'AGENT_SUBMITTED' as const })),
    ];
    const eventsByChannel = {
      native: applicationEvidence.filter((a) => a.channel === 'native'),
      external: applicationEvidence.filter((a) => a.channel === 'external'),
      email: applicationEvidence.filter((a) => a.channel === 'email'),
      browserAgent: applicationEvidence.filter((a) => a.channel === 'browserAgent'),
    };
    const totalSubmitted = applicationEvidence.length;
    const allApplyingStudents = new Set(applicationEvidence.map((application) => application.userId));

    // 3. Outcomes: Query CandidateOutcome (with explicit sharing consent, active enrollment, not withdrawn) and legacy ApplicationOutcomeEvent
    const [candidateOutcomeRows, legacyOutcomeRows] = await Promise.all([
      (this.prisma as any).candidateOutcome?.findMany
        ? (this.prisma as any).candidateOutcome.findMany({
            where: {
              userId: { in: activeUserIds },
              shareWithAcademy: true,
              withdrawnAt: null,
              occurredAt: { gte: start, lte: end },
            },
            select: {
              id: true,
              userId: true,
              outcomeType: true,
              verificationStatus: true,
              occurredAt: true,
              applicationId: true,
            },
          })
        : Promise.resolve([]),
      this.prisma.applicationOutcomeEvent.findMany({
        where: {
          userId: { in: activeUserIds },
          occurredAt: { gte: start, lte: end },
        },
        select: { id: true, outcome: true, evidence: true, userId: true, applicationId: true, occurredAt: true, channel: true },
      }),
    ]);
    const candidateOutcomes = candidateOutcomeRows.filter((outcome: any) => inObservation(outcome.userId, outcome.occurredAt));
    const legacyOutcomeEvents = legacyOutcomeRows.filter((outcome: any) => inObservation(outcome.userId, outcome.occurredAt));

    // Stable source references preserve provenance while avoiding double-counting the same
    // candidate outcome in the legacy table and the current outcome table.
    const outcomeEvents = (types: string[], legacyType: string) => {
      const rows = [
        ...candidateOutcomes.filter((o: any) => types.includes(o.outcomeType)).map((o: any, index: number) => ({
          userId: o.userId, applicationId: o.applicationId ?? null, sourceId: `candidate:${o.id ?? index}`,
          evidence: 'CANDIDATE_REPORTED' as const,
        })),
        ...legacyOutcomeEvents.filter((o) => o.outcome === legacyType).map((o: any, index: number) => ({
          userId: o.userId, applicationId: o.applicationId ?? null, sourceId: `legacy:${o.id ?? index}`,
          evidence: o.evidence === 'EMPLOYER_CONFIRMED' ? 'EMPLOYER_CONFIRMED' as const : 'CANDIDATE_REPORTED' as const,
        })),
      ];
      const unique = new Map<string, (typeof rows)[number]>();
      for (const row of rows) unique.set(row.applicationId ? `${row.userId}:${legacyType}:${row.applicationId}` : row.sourceId, row);
      return [...unique.values()];
    };
    const interviewEvents = outcomeEvents(['INTERVIEW'], 'INTERVIEW');
    const offerReceivedEvents = outcomeEvents(['OFFER_RECEIVED'], 'OFFER');
    const offerAcceptedEvents = outcomeEvents(['OFFER_ACCEPTED'], '__NO_LEGACY_ACCEPTED__');
    const jobStartedEvents = outcomeEvents(['JOB_STARTED'], 'HIRED');
    const interviewUsers = new Set(interviewEvents.map((event) => event.userId));
    const interviewEventCount = interviewEvents.length;
    const offerReceivedUsers = new Set(offerReceivedEvents.map((event) => event.userId));
    const offerReceivedEventCount = offerReceivedEvents.length;
    const offerAcceptedUsers = new Set(offerAcceptedEvents.map((event) => event.userId));
    const offerAcceptedEventCount = offerAcceptedEvents.length;
    const jobStartedUsers = new Set(jobStartedEvents.map((event) => event.userId));
    const jobStartedEventCount = jobStartedEvents.length;

    const interviewEmployerConfirmed = interviewEvents.filter((event) => event.evidence === 'EMPLOYER_CONFIRMED').length;
    const interviewCandidateReported = interviewEventCount - interviewEmployerConfirmed;

    const jobStartedEmployerConfirmed = jobStartedEvents.filter((event) => event.evidence === 'EMPLOYER_CONFIRMED').length;
    const jobStartedCandidateReported = jobStartedEventCount - jobStartedEmployerConfirmed;

    // Data completeness
    const studentsWithReportedOutcomes = new Set([
      ...candidateOutcomes.map((o: any) => o.userId),
      ...legacyOutcomeEvents.map((o) => o.userId),
    ]).size;
    const completenessPct =
      activeUserIds.length > 0
        ? Math.round((studentsWithReportedOutcomes / activeUserIds.length) * 100)
        : 0;

    // 4. Time to first application
    const firstAppDays: number[] = [];
    const firstConfirmedAt = new Map<string, number>();
    for (const evidence of applicationEvidence) {
      const current = firstConfirmedAt.get(evidence.userId);
      if (current === undefined || evidence.confirmedAt.getTime() < current) {
        firstConfirmedAt.set(evidence.userId, evidence.confirmedAt.getTime());
      }
    }
    for (const uId of activeUserIds) {
      const earliest = firstConfirmedAt.get(uId);
      if (earliest !== undefined) {
        const joinedAt = enrollmentStart.get(uId) ?? start;
        const days = Math.max(0, Math.round((earliest - joinedAt.getTime()) / (1000 * 86400)));
        firstAppDays.push(days);
      }
    }

    firstAppDays.sort((a, b) => a - b);
    let medianDays: number | null = null;
    if (firstAppDays.length > 0) {
      const mid = Math.floor(firstAppDays.length / 2);
      medianDays =
        firstAppDays.length % 2 === 0
          ? Math.round((firstAppDays[mid - 1] + firstAppDays[mid]) / 2)
          : firstAppDays[mid];
    }

    const cohortSize = activeUserIds.length;
    const isCohortTooSmall = cohortSize > 0 && cohortSize < MIN_COHORT_AGGREGATION_THRESHOLD;

    // Evaluates privacy suppression for sensitive metrics based on distinct contributing students (k-anonymity N=5)
    const evaluateSensitiveMetric = (distinctContributors: number) => {
      if (isCohortTooSmall || (distinctContributors > 0 && distinctContributors < MIN_COHORT_AGGREGATION_THRESHOLD)) {
        return { isSuppressed: true, status: 'INSUFFICIENT_DATA' as const };
      }
      if (distinctContributors === 0) {
        return { isSuppressed: false, status: 'NOT_YET_REPORTED' as const };
      }
      return { isSuppressed: false, status: 'MEASURED' as const };
    };

    const interviewPrivacy = evaluateSensitiveMetric(interviewUsers.size);
    const offerReceivedPrivacy = evaluateSensitiveMetric(offerReceivedUsers.size);
    const offerAcceptedPrivacy = evaluateSensitiveMetric(offerAcceptedUsers.size);
    const jobStartedPrivacy = evaluateSensitiveMetric(jobStartedUsers.size);
    const timeToAppPrivacy = evaluateSensitiveMetric(firstAppDays.length);
    const completenessPrivacy = evaluateSensitiveMetric(studentsWithReportedOutcomes);
    const applicationPrivacy = evaluateSensitiveMetric(allApplyingStudents.size);
    const preparationPrivacy = evaluateSensitiveMetric(distinctPreparedStudents);
    const hasMeasuredValue = (status: 'MEASURED' | 'NOT_YET_REPORTED' | 'INSUFFICIENT_DATA') => status === 'MEASURED';
    const channelPrivacy = Object.fromEntries(Object.entries(eventsByChannel).map(([channel, rows]) => [
      channel,
      evaluateSensitiveMetric(new Set(rows.map((row) => row.userId)).size),
    ])) as Record<keyof typeof eventsByChannel, ReturnType<typeof evaluateSensitiveMetric>>;

    const metrics: AcademyCohortReport['metrics'] = {
      eligibleStudents: metric(cohortSize, cohortSize, cohortSize, 'students', 'Kohorta qoşulmuş və razılığı aktiv olan unikal tələbələr; dəvətlər daxil deyil.', ['AcademyEnrollment', 'AcademyConsent']),
      applicants: metric(allApplyingStudents.size, allApplyingStudents.size, cohortSize, 'students', 'Müşahidə dövründə ən azı bir təsdiqlənmiş müraciəti olan unikal tələbələr.', ['Application', 'ExternalApplication.submittedAt', 'EmailApplication.deliveredAt', 'AgentApplication.submittedAt']),
      submittedApplications: metric(totalSubmitted, allApplyingStudents.size, cohortSize, 'applications', 'Təsdiqlənmiş göndəriş hadisələri; tracker qeydləri və hazırlıq mərhələləri çıxarılıb.', ['Application', 'ExternalApplication.submittedAt', 'EmailApplication.deliveredAt', 'AgentApplication.submittedAt']),
      preparedStudents: metric(distinctPreparedStudents, distinctPreparedStudents, cohortSize, 'students', 'Müşahidə dövründə CV və ya motivasiya məktubu yaradan unikal tələbələr.', ['Resume.createdAt']),
      interviewedStudents: metric(interviewUsers.size, interviewUsers.size, cohortSize, 'students', 'Müsahibə mərhələsi barədə paylaşılmış unikal tələbələr.', ['CandidateOutcome', 'ApplicationOutcomeEvent']),
      studentsWithOffers: metric(offerReceivedUsers.size, offerReceivedUsers.size, cohortSize, 'students', 'İş təklifi aldığını bildirən unikal tələbələr; qəbul və işə başlama ayrıdır.', ['CandidateOutcome', 'ApplicationOutcomeEvent']),
      acceptedOffers: metric(offerAcceptedUsers.size, offerAcceptedUsers.size, cohortSize, 'students', 'Təklifi qəbul etdiyini bildirən unikal tələbələr.', ['CandidateOutcome']),
      studentsStartedWork: metric(jobStartedUsers.size, jobStartedUsers.size, cohortSize, 'students', 'Faktiki işə başladığını bildirən unikal tələbələr.', ['CandidateOutcome', 'ApplicationOutcomeEvent']),
      medianDaysToFirstApplication: metric(medianDays, firstAppDays.length, cohortSize, 'days', 'Kohortaya qoşulduqdan ilk təsdiqlənmiş müraciətədək median gün; yalnız müraciət edənlərdən hesablanır.', ['Application.createdAt', 'ExternalApplication.submittedAt', 'EmailApplication.deliveredAt', 'AgentApplication.submittedAt']),
    };

    const isSuppressed =
      isCohortTooSmall ||
      applicationPrivacy.isSuppressed ||
      preparationPrivacy.isSuppressed ||
      Object.values(channelPrivacy).some((privacy) => privacy.isSuppressed) ||
      interviewPrivacy.isSuppressed ||
      offerReceivedPrivacy.isSuppressed ||
      offerAcceptedPrivacy.isSuppressed ||
      jobStartedPrivacy.isSuppressed ||
      timeToAppPrivacy.isSuppressed ||
      completenessPrivacy.isSuppressed;

    let suppressionReason: string | null = null;
    if (isCohortTooSmall) {
      suppressionReason = `Fərdi tələbə nəticələrinin aşkar edilməsinin qarşısını almaq üçün müsahibə, təklif və işə qəbul statistikası ən azı ${MIN_COHORT_AGGREGATION_THRESHOLD} aktiv razılıqlı tələbə olduqda göstərilir. Hazırkı qrup ölçüsü (${cohortSize} tələbə) fərdi nəticələrin aşkar edilməməsi üçün kifayət deyil.`;
    } else if (isSuppressed) {
      suppressionReason = `Məxfilik üçün az sayda iştirakçıya aid göstəricilər gizlədilir. Bu minimum hədd anonimliyə zəmanət vermir.`;
    }

    return {
      reportingWindow,
      metrics,
      dateRange,
      reportingPeriod,
      cohortId: cohort.id,
      cohortName: cohort.name,
      enrolledTotal: cohortSize >= MIN_COHORT_AGGREGATION_THRESHOLD ? enrolledTotal : null,
      activeConsented: cohortSize >= MIN_COHORT_AGGREGATION_THRESHOLD ? cohortSize : null,
      minAggregationThreshold: MIN_COHORT_AGGREGATION_THRESHOLD,
      isSuppressed,
      suppressionReason,
      dataCompleteness: {
        studentsWithReportedOutcomes: hasMeasuredValue(completenessPrivacy.status) ? studentsWithReportedOutcomes : null,
        completenessPct: completenessPrivacy.status === 'MEASURED' ? completenessPct : null,
        status: completenessPrivacy.status,
        definition: completenessPrivacy.status === 'INSUFFICIENT_DATA'
          ? `Tələbə məxfiliyini qorumaq üçün nəticələr ən azı ${MIN_COHORT_AGGREGATION_THRESHOLD} fərqli tələbə töhfə verdikdə göstərilir. 5-dən az tələbənin nəticə bildirdiyi halda fərdi nəticələrin aşkar edilməməsi üçün məlumat dolğunluğu gizlədilir.`
          : 'Nəticə barədə ən az bir məlumat daxil edən tələbələrin payı (cavabsızlıq rədd və ya işə qəbul kimi qəbul edilmir). Məxrəc: razılıq vermiş aktiv tələbələr.',
      },
      preparation: {
        activeStudents: hasMeasuredValue(preparationPrivacy.status) ? distinctPreparedStudents : null,
        totalDocumentsPrepared: hasMeasuredValue(preparationPrivacy.status) ? resumes.length : null,
        status: preparationPrivacy.status,
        definition: 'Kohort müddətində ən az bir CV və ya motivasiya məktubu hazırlayan tələbələr. Məxrəc: razılıq vermiş aktiv tələbələr.',
      },
      applications: {
        totalSubmitted: hasMeasuredValue(applicationPrivacy.status) ? totalSubmitted : null,
        distinctStudentsApplied: hasMeasuredValue(applicationPrivacy.status) ? allApplyingStudents.size : null,
        status: applicationPrivacy.status,
        byChannel: {
          native: hasMeasuredValue(channelPrivacy.native.status) ? eventsByChannel.native.length : null,
          external: hasMeasuredValue(channelPrivacy.external.status) ? eventsByChannel.external.length : null,
          email: hasMeasuredValue(channelPrivacy.email.status) ? eventsByChannel.email.length : null,
          browserAgent: hasMeasuredValue(channelPrivacy.browserAgent.status) ? eventsByChannel.browserAgent.length : null,
          manualTracker: 0,
        },
        definition: 'Bütün dəstəklənən kanallar (AISE daxili, xarici portallar, e-poçt və brauzer köməkçisi) üzrə təsdiqlənmiş müraciət hadisələrinin ümumi sayı. Hər bir kanal üzrə faktiki göndərilən hadisələr hesablanır; unikal tələbə sayı isə distinctStudentsApplied göstəricisində ayrıca əks etdirilir. Qaralamalar və izləyici qeydləri təkrar hesablanmır.',
      },
      funnel: {
        applied: hasMeasuredValue(applicationPrivacy.status) ? totalSubmitted : null,
        distinctApplied: hasMeasuredValue(applicationPrivacy.status) ? allApplyingStudents.size : null,
        interviews: {
          count: hasMeasuredValue(interviewPrivacy.status) ? interviewEventCount : null,
          distinctStudents: hasMeasuredValue(interviewPrivacy.status) ? interviewUsers.size : null,
          totalEvents: hasMeasuredValue(interviewPrivacy.status) ? interviewEventCount : null,
          employerConfirmed: hasMeasuredValue(interviewPrivacy.status) ? interviewEmployerConfirmed : null,
          candidateReported: hasMeasuredValue(interviewPrivacy.status) ? interviewCandidateReported : null,
          status: interviewPrivacy.status,
          ratePct: interviewPrivacy.status === 'MEASURED' && cohortSize > 0 ? Math.round((interviewUsers.size / cohortSize) * 100) : null,
          definition: 'Müsahibə mərhələsinə keçən unikal tələbələr. Məxrəc: razılıq vermiş aktiv tələbələr.',
        },
        offersReceived: {
          count: hasMeasuredValue(offerReceivedPrivacy.status) ? offerReceivedEventCount : null,
          distinctStudents: hasMeasuredValue(offerReceivedPrivacy.status) ? offerReceivedUsers.size : null,
          totalEvents: hasMeasuredValue(offerReceivedPrivacy.status) ? offerReceivedEventCount : null,
          status: offerReceivedPrivacy.status,
          ratePct: offerReceivedPrivacy.status === 'MEASURED' && cohortSize > 0 ? Math.round((offerReceivedUsers.size / cohortSize) * 100) : null,
          definition: 'İş təklifi alan unikal tələbələr. Məxrəc: razılıq vermiş aktiv tələbələr.',
        },
        offersAccepted: {
          count: hasMeasuredValue(offerAcceptedPrivacy.status) ? offerAcceptedEventCount : null,
          distinctStudents: hasMeasuredValue(offerAcceptedPrivacy.status) ? offerAcceptedUsers.size : null,
          totalEvents: hasMeasuredValue(offerAcceptedPrivacy.status) ? offerAcceptedEventCount : null,
          status: offerAcceptedPrivacy.status,
          ratePct: offerAcceptedPrivacy.status === 'MEASURED' && cohortSize > 0 ? Math.round((offerAcceptedUsers.size / cohortSize) * 100) : null,
          definition: 'Təklifi qəbul edən unikal tələbələr (hələ işə başlamamış ola bilər). Məxrəc: razılıq vermiş aktiv tələbələr.',
        },
        jobStarted: {
          count: hasMeasuredValue(jobStartedPrivacy.status) ? jobStartedEventCount : null,
          distinctStudents: hasMeasuredValue(jobStartedPrivacy.status) ? jobStartedUsers.size : null,
          totalEvents: hasMeasuredValue(jobStartedPrivacy.status) ? jobStartedEventCount : null,
          status: jobStartedPrivacy.status,
          employerConfirmed: hasMeasuredValue(jobStartedPrivacy.status) ? jobStartedEmployerConfirmed : null,
          candidateReported: hasMeasuredValue(jobStartedPrivacy.status) ? jobStartedCandidateReported : null,
          ratePct: jobStartedPrivacy.status === 'MEASURED' && cohortSize > 0 ? Math.round((jobStartedUsers.size / cohortSize) * 100) : null,
          definition: 'Faktiki işə başlayan unikal tələbələr (qəbul olunmuş təklifdən ayrı hesablanır). Məxrəc: razılıq vermiş aktiv tələbələr.',
        },
        offers: {
          count: hasMeasuredValue(offerReceivedPrivacy.status) ? offerReceivedEventCount : null,
          employerConfirmed: hasMeasuredValue(offerReceivedPrivacy.status) ? 0 : null,
          candidateReported: hasMeasuredValue(offerReceivedPrivacy.status) ? offerReceivedEventCount : null,
          status: offerReceivedPrivacy.status,
          ratePct: offerReceivedPrivacy.status === 'MEASURED' && cohortSize > 0 ? Math.round((offerReceivedUsers.size / cohortSize) * 100) : null,
          definition: 'Təsdiqlənmiş və ya bildirilmiş iş təklifləri.',
        },
        hires: {
          count: hasMeasuredValue(jobStartedPrivacy.status) ? jobStartedEventCount : null,
          status: jobStartedPrivacy.status,
          employerConfirmed: hasMeasuredValue(jobStartedPrivacy.status) ? jobStartedEmployerConfirmed : null,
          candidateReported: hasMeasuredValue(jobStartedPrivacy.status) ? jobStartedCandidateReported : null,
          ratePct: jobStartedPrivacy.status === 'MEASURED' && cohortSize > 0 ? Math.round((jobStartedUsers.size / cohortSize) * 100) : null,
          definition: 'Faktiki işə başlayan tələbələr (süni təxminlər aparılmır).',
        },
      },
      timeToFirstApplicationDays: {
        medianDays: timeToAppPrivacy.status === 'MEASURED' ? medianDays : null,
          definition: 'Kohortaya qoşulduqdan ilk təsdiqlənmiş müraciətədək median gün.',
        status: timeToAppPrivacy.status,
      },
    };
  }

  async getAcademyKpis(academyId: string): Promise<AcademyKpisResponse> {
    // This endpoint intentionally returns no per-cohort outcome metrics. Returning multiple
    // overlapping cohort reports together can enable differencing even if each report is safe alone.
    const cohorts = await this.prisma.academyCohort.findMany({
      where: { academyId },
      select: { id: true, name: true, startDate: true, endDate: true },
      orderBy: { startDate: 'desc' },
    });
    return {
      academyId,
      cohortCount: cohorts.length,
      aggregate: {
        status: 'SUPPRESSED' as const,
        values: null,
        definition: 'Akademiya üzrə yekun göstəricilər kohortlararası təkrarları və məxfilik hədlərini təhlükəsiz uzlaşdıran hesablanma hazır olana qədər göstərilmir.',
      },
      cohorts: cohorts.map((cohort) => ({
        id: cohort.id,
        name: cohort.name,
        trainingStart: cohort.startDate.toISOString(),
        trainingEnd: cohort.endDate.toISOString(),
      })),
    };
  }
}
