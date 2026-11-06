import { Injectable, Logger, NotFoundException, ConflictException, ForbiddenException, BadRequestException, Optional } from '@nestjs/common';
import { TimelineService } from '../application-timeline/timeline.service';
import { PrismaService } from '../database/database.service';
import { PostHogService } from '../common/posthog.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { LocalStorageService } from '../resumes/local-storage.service';
import { EmailService } from '../common/email.service';

@Injectable()
export class JobApplicationsService {
  private readonly logger = new Logger(JobApplicationsService.name);

  constructor(
    private prisma: PrismaService,
    private postHogService: PostHogService,
    private storageService: LocalStorageService,
    // The employer's own status change is the only source of employer-confirmed outcome evidence (application-timeline/).
    @Optional() private timeline?: TimelineService,
    @Optional() private emailService?: EmailService,
  ) {}

  async apply(userId: string, vacancyId: string, dto: CreateApplicationDto, uploadedFiles: any[]) {
    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id: vacancyId },
      include: { company: true, questions: true, applicationDestination: { select: { email: true } } }
    });

    if (!vacancy) {
      throw new NotFoundException('Vakansiya tapılmadı');
    }

    if (vacancy.status !== 'ACTIVE' || vacancy.company.status !== 'APPROVED') {
      throw new BadRequestException('Vakansiya aktiv deyil və ya şirkət hələ təsdiqlənməyib');
    }

    if (vacancy.deadline && new Date(vacancy.deadline) < new Date()) {
      throw new BadRequestException('Müraciət qəbulu üçün son tarix bitib');
    }

    // A trial, single-listing or Business period that has run out stops NEW applications at once, even before the sweeper marks the listing expired.
    // Applications already received stay where they are.
    if (vacancy.expiresAt && new Date(vacancy.expiresAt) <= new Date()) {
      throw new BadRequestException('Bu elanın yayım müddəti bitib');
    }

    // Every answered question must actually belong to this vacancy — otherwise
    // the FK on ApplicationAnswer.question (onDelete: Restrict) throws an
    // unhandled 500 instead of a clean, expected 400.
    const validQuestionIds = new Set(vacancy.questions.map((q) => q.id));
    const invalidAnswer = dto.answers?.find((a) => !validQuestionIds.has(a.questionId));
    if (invalidAnswer) {
      throw new BadRequestException('Cavablardan biri bu vakansiyaya aid olmayan suala aiddir');
    }

    const uploadedFileQuestionIds = new Set(uploadedFiles.map((file) => file.fieldName));
    const invalidFileQuestion = vacancy.questions.find(
      (question) => uploadedFileQuestionIds.has(question.id) && question.type !== 'FILE_UPLOAD',
    );
    if (invalidFileQuestion) {
      throw new BadRequestException('Fayl yalnız fayl yükləmə tipli suala əlavə edilə bilər');
    }

    // Enforce the business's own `required` flags. Only the apply form checked
    // these, so a request sent straight to the API — or any future client that
    // forgets — could file an application with the mandatory questions blank,
    // making the toggle meaningless to the business that set it.
    //
    // Checking `value` covers every question type: the form resolves a
    // FILE_UPLOAD answer by uploading the file first and storing the returned
    // URL as that answer's value, so a required file shows up here the same
    // way a required text answer does.
    const answersByQuestion = new Map(
      (dto.answers ?? []).map((a) => [a.questionId, a.value]),
    );
    const missing = vacancy.questions.filter((q) => {
      if (!q.required) return false;
      if (q.type === 'FILE_UPLOAD') return !uploadedFileQuestionIds.has(q.id);
      const value = answersByQuestion.get(q.id);
      return value === undefined || value === null || String(value).trim() === '';
    });
    if (missing.length > 0) {
      throw new BadRequestException(
        `Məcburi suallar cavablandırılmayıb: ${missing.map((q) => q.label).join(', ')}`,
      );
    }

    // The application gets its own copy of the base CV. The base file stays
    // mutable (replace/delete), the copy is never touched by resume operations,
    // so a submitted application always points at the exact bytes it was sent
    // with — without any in-process lock between apply and replacement.
    //
    // Every native application carries a CV the candidate owns and has
    // accepted: the READY base CV, or a READY tailored CV they reviewed.
    // Someone else's CV id is indistinguishable from a missing one (404).
    const selectedResume = await this.prisma.resume.findFirst({
      where: dto.resumeId
        ? { id: dto.resumeId, userId }
        : { userId, isBase: true, status: 'READY', fileUrl: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (dto.resumeId && !selectedResume) throw new NotFoundException('CV tapılmadı');
    if (!selectedResume) {
      throw new BadRequestException('Müraciət üçün əvvəlcə CV yükləyin.');
    }
    if (selectedResume.status !== 'READY' || !selectedResume.fileUrl ||
      (!selectedResume.isBase && !selectedResume.reviewedAt)) {
      throw new BadRequestException('Bu CV təsdiqlənməyib və göndərilə bilməz');
    }
    const resumeSnapshotUrl = await this.snapshotSelectedResume(userId, selectedResume.id, selectedResume.fileUrl);
    const applicationFiles = [
      {
        fieldName: 'resume',
        fileUrl: resumeSnapshotUrl,
        originalName: 'CV',
        mimeType: resumeSnapshotUrl.endsWith('.docx')
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/pdf',
      },
      ...uploadedFiles,
    ];

    // Check if user already applied to this vacancy
    const existing = await this.prisma.application.findUnique({
      where: { vacancyId_userId: { vacancyId, userId } },
      include: { files: true, answers: true },
    });

    let application;
    if (existing) {
      if (existing.status === 'REVIEWING' || existing.status === 'INTERVIEW' || existing.status === 'HIRED') {
        await this.storageService.deleteFile(resumeSnapshotUrl).catch(() => undefined);
        throw new ConflictException('Müraciətiniz hazırda baxılma və ya müsahibə mərhələsindədir');
      }

      // Re-application is allowed for REJECTED and unreviewed APPLIED applications
      for (const f of existing.files) {
        if (f.fileUrl && f.fileUrl !== resumeSnapshotUrl) {
          await this.storageService.deleteFile(f.fileUrl).catch(() => undefined);
        }
      }
      for (const a of existing.answers) {
        if (a.fileUrl) {
          await this.storageService.deleteFile(a.fileUrl).catch(() => undefined);
        }
      }

      await this.prisma.applicationAnswer.deleteMany({ where: { applicationId: existing.id } });
      await this.prisma.applicationFile.deleteMany({ where: { applicationId: existing.id } });

      try {
        application = await this.prisma.application.update({
          where: { id: existing.id },
          data: {
            status: 'APPLIED',
            answers: {
              create: dto.answers?.map(a => ({
                questionId: a.questionId,
                value: a.value,
                fileUrl: uploadedFiles.find((file) => file.fieldName === a.questionId)?.fileUrl,
              })) || []
            },
            files: {
              create: applicationFiles
            }
          },
          include: { answers: true, files: true }
        });
      } catch (e: any) {
        await this.storageService.deleteFile(resumeSnapshotUrl).catch(() => undefined);
        if (e.code === 'P2003') {
          throw new ConflictException('Vakansiyanın sualları müraciətiniz hazırlanarkən dəyişdirildi. Səhifəni yeniləyib yenidən cəhd edin.');
        }
        throw e;
      }
    } else {
      try {
        application = await this.prisma.application.create({
          data: {
            vacancyId,
            userId,
            answers: {
              create: dto.answers?.map(a => ({
                questionId: a.questionId,
                value: a.value,
                fileUrl: uploadedFiles.find((file) => file.fieldName === a.questionId)?.fileUrl,
              })) || []
            },
            files: {
              create: applicationFiles
            }
          },
          include: { answers: true, files: true }
        });
      } catch (e: any) {
        await this.storageService.deleteFile(resumeSnapshotUrl).catch(() => undefined);
        if (e.code === 'P2002') {
          throw new ConflictException('Siz artıq bu vakansiyaya müraciət etmisiniz');
        }
        // The employer replaced the questions after this request validated its answers but before the insert: the answers point at questions
        // that no longer exist. Nothing was filed; ask the candidate to reload instead of reporting a server error.
        if (e.code === 'P2003') {
          throw new ConflictException('Vakansiyanın sualları müraciətiniz hazırlanarkən dəyişdirildi. Səhifəni yeniləyib yenidən cəhd edin.');
        }
        throw e;
      }
    }

    // Best-effort analytics: a failure here must not report a committed
    // application as failed or trigger attachment cleanup.
    try {
      this.postHogService.capture(userId, 'application_submitted', { vacancyId, applicationId: application.id });
    } catch (error) {
      this.logger.warn(
        `application_submitted analitikası göndərilmədi: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await this.notifyEmployer(vacancy, application.id);
    return application;
  }

  /**
   * Tells the employer's chosen address that a new application is waiting. A link into the AISE inbox only: no CV, no contact details travel by
   * e-mail. Best effort: a failure never turns a committed application into an error.
   */
  private async notifyEmployer(vacancy: { id: string; title: string; applicationDestination?: { email: string } | null }, applicationId: string) {
    const to = vacancy.applicationDestination?.email;
    if (!to || !this.emailService) return;
    try {
      const base = (process.env.FRONTEND_URL || 'https://aisehr.com').replace(/\/$/, '');
      const title = vacancy.title.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
      await this.emailService.send(
        to,
        `AISE: "${vacancy.title.slice(0, 80)}" vakansiyasına yeni müraciət`,
        `<p>"${title}" vakansiyanıza yeni müraciət daxil oldu.</p><p><a href="${base}/business/applications">Müraciətə AISE panelində baxın</a></p><p style="color:#555;font-size:12px">Bu bildirişdə namizədin sənədləri və ya əlaqə məlumatları yoxdur; onlar yalnız hesabınızda görünür. Bildiriş ünvanını vakansiyanın redaktə səhifəsindən dəyişə bilərsiniz.</p>`,
      );
    } catch (error) {
      this.logger.warn(`Employer notification for application ${applicationId} was not sent: ${error instanceof Error ? error.name : 'error'}`);
    }
  }

  private async snapshotSelectedResume(userId: string, resumeId: string, fileUrl: string): Promise<string> {
    try {
      return await this.storageService.copyFile(fileUrl);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      // The file vanished after we read the row: either a concurrent
      // replace/delete (the row moved on) or a base row whose file was lost.
      const current = await this.prisma.resume.findFirst({ where: { id: resumeId, userId, fileUrl } });
      if (current) {
        throw new BadRequestException('CV faylı tapılmadı. CV-nizi yenidən yükləyin və müraciət edin.');
      }
      throw new ConflictException('CV-niz bu anda dəyişdirildi. Yoxlayın və yenidən müraciət edin.');
    }
  }

  async findCandidateApplications(userId: string) {
    return this.prisma.application.findMany({
      where: { userId },
      include: {
        vacancy: {
          include: { company: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findCandidateApplicationDetail(id: string, userId: string) {
    const app = await this.prisma.application.findFirst({
      where: { id, userId },
      include: {
        vacancy: {
          include: {
            company: true,
            questions: true
          }
        },
        answers: true,
        files: true
      }
    });

    if (!app) throw new NotFoundException('Müraciət tapılmadı');
    return app;
  }

  async findEmployerApplications(companyId: string, vacancyId?: string, status?: string) {
    const applications = await this.prisma.application.findMany({
      where: {
        vacancy: { companyId },
        ...(vacancyId ? { vacancyId } : {}),
        ...(status ? { status: status as any } : {})
      },
      include: {
        user: {
          select: { name: true, email: true }
        },
        vacancy: {
          select: { title: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return applications.map((app) => ({
      id: app.id,
      candidateName: app.user.name || app.user.email,
      vacancyTitle: app.vacancy.title,
      status: app.status,
      createdAt: app.createdAt,
    }));
  }

  async findEmployerApplicationDetail(id: string, companyId: string) {
    const app = await this.prisma.application.findFirst({
      where: { id, vacancy: { companyId } },
      include: {
        user: {
          select: {
            name: true,
            email: true,
            profile: {
              include: { experiences: { orderBy: { startDate: 'desc' } } },
            },
          },
        },
        vacancy: { select: { title: true } },
        answers: { include: { question: true } },
        files: true
      }
    });

    if (!app) throw new NotFoundException('Müraciət tapılmadı');

    return {
      id: app.id,
      status: app.status,
      createdAt: app.createdAt,
      vacancyTitle: app.vacancy.title,
      candidateName: app.user.name || app.user.email,
      candidateEmail: app.user.email,
      candidatePhone: app.user.profile?.phone ?? null,
      resumeUrl: app.files.find((file) => file.fieldName === 'resume')?.fileUrl ?? null,
      experiences: (app.user.profile?.experiences ?? []).map((exp) => ({
        title: exp.title,
        company: exp.company,
        startDate: exp.startDate,
        endDate: exp.endDate,
        description: exp.description,
      })),
      answers: app.answers.map((a) => ({
        questionLabel: a.question.label,
        value: a.value,
        fileUrl: a.fileUrl,
      })),
    };
  }

  async updateStatus(id: string, companyId: string, status: any) {
    const app = await this.prisma.application.findFirst({
      where: { id, vacancy: { companyId } }
    });

    if (!app) throw new NotFoundException('Müraciət tapılmadı');

    const updated = await this.prisma.application.update({
      where: { id },
      data: { status }
    });
    await this.timeline?.recordEmployerStatus({ id: app.id, userId: app.userId }, status);
    return updated;
  }
}
