import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/database.service';
import { ReportCandidateOutcomeDto, UpdateCandidateOutcomeDto } from './dto/candidate-outcome.dto';
import { OutcomeVerificationStatus } from '@prisma/client';

@Injectable()
export class CandidateOutcomesService {
  constructor(private readonly prisma: PrismaService) {}

  async reportOutcome(userId: string, dto: ReportCandidateOutcomeDto) {
    if ((dto as any).verificationStatus === OutcomeVerificationStatus.EMPLOYER_CONFIRMED) {
      throw new ForbiddenException('Namizəd öz nəticəsini işəgötürən tərəfindən təsdiqlənmiş (EMPLOYER_CONFIRMED) statusuna yüksəldə bilməz');
    }

    const occurredAt = new Date(dto.occurredAt);
    const now = new Date();
    // Allow up to 1 minute clock drift, but not future dates
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > now.getTime() + 60_000) {
      throw new BadRequestException('Nəticə tarixi gələcəkdə ola bilməz');
    }

    const verificationStatus =
      dto.verificationStatus === OutcomeVerificationStatus.UNVERIFIED
        ? OutcomeVerificationStatus.UNVERIFIED
        : OutcomeVerificationStatus.STUDENT_ATTESTED;

    const created = await this.prisma.candidateOutcome.create({
      data: {
        userId,
        outcomeType: dto.outcomeType,
        occurredAt,
        jobTitle: dto.jobTitle?.trim() || null,
        companyName: dto.companyName?.trim() || null,
        channel: dto.channel?.trim() || null,
        applicationId: dto.applicationId?.trim() || null,
        verificationStatus,
        note: dto.note?.trim() || null,
        shareWithAcademy: dto.shareWithAcademy === true,
      },
    });

    return {
      id: created.id,
      outcomeType: created.outcomeType,
      occurredAt: created.occurredAt,
      verificationStatus: created.verificationStatus,
      provenance: 'CANDIDATE_REPORTED',
      shareWithAcademy: created.shareWithAcademy,
      withdrawnAt: created.withdrawnAt,
      createdAt: created.createdAt,
    };
  }

  async listOutcomes(userId: string) {
    const outcomes = await this.prisma.candidateOutcome.findMany({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
    });

    return outcomes.map((o) => ({
      id: o.id,
      outcomeType: o.outcomeType,
      occurredAt: o.occurredAt,
      jobTitle: o.jobTitle,
      companyName: o.companyName,
      channel: o.channel,
      applicationId: o.applicationId,
      verificationStatus: o.verificationStatus,
      provenance: 'CANDIDATE_REPORTED',
      note: o.note,
      shareWithAcademy: o.shareWithAcademy,
      withdrawnAt: o.withdrawnAt,
      isWithdrawn: !!o.withdrawnAt,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));
  }

  async getOutcome(userId: string, id: string) {
    const outcome = await this.prisma.candidateOutcome.findFirst({
      where: { id, userId },
    });
    if (!outcome) {
      throw new NotFoundException('Qeyd olunmuş nəticə tapılmadı');
    }

    return {
      id: outcome.id,
      outcomeType: outcome.outcomeType,
      occurredAt: outcome.occurredAt,
      jobTitle: outcome.jobTitle,
      companyName: outcome.companyName,
      channel: outcome.channel,
      applicationId: outcome.applicationId,
      verificationStatus: outcome.verificationStatus,
      provenance: 'CANDIDATE_REPORTED',
      note: outcome.note,
      shareWithAcademy: outcome.shareWithAcademy,
      withdrawnAt: outcome.withdrawnAt,
      isWithdrawn: !!outcome.withdrawnAt,
      createdAt: outcome.createdAt,
      updatedAt: outcome.updatedAt,
    };
  }

  async updateOutcome(userId: string, id: string, dto: UpdateCandidateOutcomeDto) {
    const existing = await this.prisma.candidateOutcome.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException('Qeyd olunmuş nəticə tapılmadı');
    }

    const data: any = {};

    if (dto.outcomeType) {
      data.outcomeType = dto.outcomeType;
    }
    if (dto.occurredAt) {
      const date = new Date(dto.occurredAt);
      const now = new Date();
      if (Number.isNaN(date.getTime()) || date.getTime() > now.getTime() + 60_000) {
        throw new BadRequestException('Nəticə tarixi gələcəkdə ola bilməz');
      }
      data.occurredAt = date;
    }
    if (dto.jobTitle !== undefined) {
      data.jobTitle = dto.jobTitle?.trim() || null;
    }
    if (dto.companyName !== undefined) {
      data.companyName = dto.companyName?.trim() || null;
    }
    if ((dto as any).verificationStatus === OutcomeVerificationStatus.EMPLOYER_CONFIRMED) {
      throw new ForbiddenException('Namizəd öz nəticəsini işəgötürən tərəfindən təsdiqlənmiş (EMPLOYER_CONFIRMED) statusuna yüksəldə bilməz');
    }
    if (dto.verificationStatus !== undefined) {
      if (dto.verificationStatus === OutcomeVerificationStatus.UNVERIFIED || dto.verificationStatus === OutcomeVerificationStatus.STUDENT_ATTESTED) {
        data.verificationStatus = dto.verificationStatus;
      }
    }
    if (dto.note !== undefined) {
      data.note = dto.note?.trim() || null;
    }
    if (dto.shareWithAcademy !== undefined) {
      data.shareWithAcademy = dto.shareWithAcademy;
    }
    if (dto.withdrawn !== undefined) {
      data.withdrawnAt = dto.withdrawn ? new Date() : null;
    }

    const updated = await this.prisma.candidateOutcome.update({
      where: { id },
      data,
    });

    return {
      id: updated.id,
      outcomeType: updated.outcomeType,
      occurredAt: updated.occurredAt,
      verificationStatus: updated.verificationStatus,
      provenance: 'CANDIDATE_REPORTED',
      shareWithAcademy: updated.shareWithAcademy,
      withdrawnAt: updated.withdrawnAt,
      isWithdrawn: !!updated.withdrawnAt,
      updatedAt: updated.updatedAt,
    };
  }

  async withdrawOutcome(userId: string, id: string) {
    const existing = await this.prisma.candidateOutcome.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException('Qeyd olunmuş nəticə tapılmadı');
    }

    const updated = await this.prisma.candidateOutcome.update({
      where: { id },
      data: { withdrawnAt: new Date() },
    });

    return {
      id: updated.id,
      withdrawnAt: updated.withdrawnAt,
      message: 'Nəticə namizəd tərəfindən geri çağırıldı',
    };
  }

  async deleteOutcome(userId: string, id: string) {
    const existing = await this.prisma.candidateOutcome.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException('Qeyd olunmuş nəticə tapılmadı');
    }

    await this.prisma.candidateOutcome.delete({
      where: { id },
    });

    return { success: true, message: 'Nəticə qeydi silindi' };
  }
}
