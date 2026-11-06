import { FAILED_JOB_RETENTION } from '../common/queue-retention';
import { Injectable, NotFoundException, ForbiddenException, ConflictException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../database/database.service';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { UpdateVacancyDto } from './dto/update-vacancy.dto';
import { PUBLIC_COMPANY_SELECT } from '../companies/companies.service';
import { loadEmployerPlansConfig } from '../employer-plans/employer-plans.config';

@Injectable()
export class VacanciesService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('job-ingested') private jobQueue: Queue,
    // New-vacancy alerts fan out from here (alerts/alerts.service.ts); optional so callers without alerts need no queue.
    @Optional() @InjectQueue('new-job-alert') private alertQueue?: Queue,
  ) {}

  private async announce(vacancyId: string, stamp: number) {
    await this.alertQueue?.add('fan-out', { vacancyId }, { jobId: `alert-vacancy-${vacancyId}-${stamp}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { age: 86_400, count: 10000 }, removeOnFail: { age: 86_400, count: 10000 } }).catch(() => undefined);
  }

  async findAllPublic(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const now = new Date();
    const actionable = {
      status: 'ACTIVE' as const,
      company: { status: 'APPROVED' as const },
      AND: [{ OR: [{ deadline: null }, { deadline: { gt: now } }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    };
    
    const [items, total] = await Promise.all([
      this.prisma.vacancy.findMany({
        where: actionable,
        include: { company: { select: PUBLIC_COMPANY_SELECT } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.vacancy.count({
        where: actionable,
      })
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async findOnePublic(id: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: {
        id,
        status: 'ACTIVE',
        company: { status: 'APPROVED' },
        AND: [{ OR: [{ deadline: null }, { deadline: { gt: new Date() } }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      },
      include: {
        company: { select: PUBLIC_COMPANY_SELECT },
        questions: {
          include: { options: true },
          orderBy: { order: 'asc' }
        }
      }
    });

    if (!vacancy) {
      throw new NotFoundException('Vakansiya tapılmadı');
    }

    await this.prisma.vacancy.update({
      where: { id },
      data: { views: { increment: 1 } }
    });

    return vacancy;
  }

  async create(business: any, createVacancyDto: CreateVacancyDto) {
    if (business.company.status !== 'APPROVED') {
      throw new ForbiddenException('Vakansiya yaratmaq üçün şirkət təsdiqlənmiş olmalıdır');
    }

    const { questions, applicationEmail, ...vacancyData } = createVacancyDto;
    const destination = typeof applicationEmail === 'string' && applicationEmail.trim() ? applicationEmail.trim().toLowerCase() : null;

    // Under employer plans a new vacancy is a draft: it needs moderation and an entitlement before it can be public. With plans off, behaviour is unchanged.
    const gated = loadEmployerPlansConfig().gated;
    const vacancy = await this.prisma.vacancy.create({
      data: {
        ...vacancyData,
        ...(gated ? { status: 'DRAFT' as const } : {}),
        companyId: business.company.id,
        ...(destination ? { applicationDestination: { create: { email: destination } } } : {}),
        questions: {
          create: questions?.map(q => ({
            label: q.label,
            type: q.type,
            required: q.required,
            order: q.order,
            options: {
              create: q.options?.map(o => ({
                label: o.label,
                order: o.order
              })) || []
            }
          })) || []
        }
      },
      include: {
        questions: { include: { options: true } }
      }
    });

    // New ACTIVE vacancies score against every profile through the same
    // matching pipeline as scraped jobs (see JobIngestedProcessor: the
    // shared 'job-ingested' queue dispatches on { vacancyId }).
    if (vacancy.status === 'ACTIVE') {
      await this.jobQueue.add('process-match', { vacancyId: vacancy.id }, {
        removeOnComplete: true,
        removeOnFail: FAILED_JOB_RETENTION,
      }).catch((err) => console.error(`Failed to enqueue matching for vacancy ${vacancy.id}`, err));
      await this.announce(vacancy.id, vacancy.createdAt.getTime());
    }

    return vacancy;
  }

  async findAllOwn(companyId: string) {
    return this.prisma.vacancy.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { applications: true } },
        applicationDestination: { select: { email: true } },
      }
    });
  }

  async findOneOwn(id: string, companyId: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { id, companyId },
      include: {
        questions: {
          include: { options: true },
          orderBy: { order: 'asc' }
        },
        // The edit screen needs a real number to decide whether questions can still change; a failed side request must never read as zero.
        _count: { select: { applications: true } },
        applicationDestination: { select: { email: true } },
      }
    });

    if (!vacancy) {
      throw new NotFoundException('Vakansiya tapılmadı');
    }

    return vacancy;
  }

  async update(id: string, companyId: string, updateVacancyDto: UpdateVacancyDto) {
    const vacancy = await this.findOneOwn(id, companyId);
    const { questions, applicationEmail, ...vacancyData } = updateVacancyDto;
    const destination = applicationEmail === undefined ? undefined : typeof applicationEmail === 'string' && applicationEmail.trim() ? applicationEmail.trim().toLowerCase() : null;
    // An approved-but-unpublished vacancy that changes its text goes back to draft: the approval covered the text that was reviewed, not a later rewrite.
    if (loadEmployerPlansConfig().gated && vacancy.status === 'APPROVED' && ['title', 'description', 'requirements', 'responsibilities'].some((k) => (vacancyData as any)[k] !== undefined && (vacancyData as any)[k] !== (vacancy as any)[k])) {
      (vacancyData as any).status = 'DRAFT';
      (vacancyData as any).moderatedAt = null;
    }

    if (questions) {
      // Answers retain a reference to their original question. Replacing it
      // after submissions would either break that history or fail with a FK 500.
      // An application landing between the count and the delete trips the
      // answer→question FK (Restrict); that is the same conflict.
      const locked = new ConflictException('Müraciətlər olan vakansiyanın sualları dəyişdirilə bilməz');
      return this.prisma.$transaction(async (tx) => {
        if (await tx.application.count({ where: { vacancyId: vacancy.id } })) throw locked;
        await tx.applicationQuestion.deleteMany({
          where: { vacancyId: vacancy.id }
        });
        await this.setDestination(tx, vacancy.id, destination);

        return tx.vacancy.update({
          where: { id: vacancy.id },
          data: {
            ...vacancyData,
            questions: {
              create: questions.map((q: any) => ({
                label: q.label,
                type: q.type,
                required: q.required,
                order: q.order,
                options: {
                  create: q.options?.map((o: any) => ({
                    label: o.label,
                    order: o.order
                  })) || []
                }
              }))
            }
          },
          include: {
            questions: { include: { options: true } }
          }
        });
      }).catch((error: any) => {
        throw error?.code === 'P2003' ? locked : error;
      });
    }

    if (destination === undefined) {
      return this.prisma.vacancy.update({ where: { id: vacancy.id }, data: vacancyData });
    }
    return this.prisma.$transaction(async (tx) => {
      await this.setDestination(tx, vacancy.id, destination);
      return tx.vacancy.update({ where: { id: vacancy.id }, data: vacancyData, include: { applicationDestination: { select: { email: true } } } });
    });
  }

  /** undefined = leave as is; null = remove; a string = replace. */
  private async setDestination(tx: { vacancyApplicationDestination: PrismaService['vacancyApplicationDestination'] }, vacancyId: string, destination: string | null | undefined) {
    if (destination === undefined) return;
    if (destination === null) {
      await tx.vacancyApplicationDestination.deleteMany({ where: { vacancyId } });
      return;
    }
    await tx.vacancyApplicationDestination.upsert({ where: { vacancyId }, create: { vacancyId, email: destination }, update: { email: destination } });
  }

  async updateStatus(id: string, companyId: string, status: any) {
    const vacancy = await this.findOneOwn(id, companyId);

    if (loadEmployerPlansConfig().gated) {
      // Under employer plans only publication (entitlement, moderation, expiry) can make a vacancy public. Pausing a published listing is free;
      // resuming one is allowed only while its paid or trial period is still running. Deleting is always allowed.
      if (status === 'ACTIVE') {
        if (vacancy.status !== 'PAUSED' || !vacancy.publishedAt || !vacancy.expiresAt || vacancy.expiresAt <= new Date()) {
          throw new ConflictException('Vakansiyanı yayımlamaq üçün "Yayımla" əməliyyatından istifadə edin');
        }
      } else if (status === 'PAUSED' && vacancy.status !== 'ACTIVE') {
        throw new ConflictException('Yalnız aktiv vakansiya fasilədə saxlanıla bilər');
      }
    }
    const updated = await this.prisma.vacancy.update({
      where: { id: vacancy.id },
      data: { status }
    });

    // Re-activated vacancies become matchable again — existing matches are
    // re-scored in place (no duplicates, no re-notify), new ones are created.
    if (status === 'ACTIVE' && vacancy.status !== 'ACTIVE') {
      await this.jobQueue.add('process-match', { vacancyId: vacancy.id }, {
        removeOnComplete: true,
        removeOnFail: FAILED_JOB_RETENTION,
      }).catch((err) => console.error(`Failed to enqueue matching for vacancy ${vacancy.id}`, err));
      await this.announce(vacancy.id, updated.updatedAt.getTime());
    }

    return updated;
  }
}
