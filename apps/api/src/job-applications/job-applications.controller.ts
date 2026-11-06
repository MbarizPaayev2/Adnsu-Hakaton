import { Controller, Get, Post, Body, Patch, Param, UseGuards, UseInterceptors, UploadedFiles, Query, BadRequestException } from '@nestjs/common';
import { JobApplicationsService } from './job-applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationStatusDto } from './dto/update-status.dto';
import { BusinessAuthGuard } from '../business/business-auth.guard';
import { GetBusiness } from '../business/get-business.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { FilesInterceptor } from '@nestjs/platform-express';
import { DOCUMENT_MIME_TYPES, LocalStorageService } from '../resumes/local-storage.service';

@Controller()
export class JobApplicationsController {
  constructor(
    private readonly jobApplicationsService: JobApplicationsService,
    private readonly localStorageService: LocalStorageService
  ) {}

  private parseApplicationBody(body: any): CreateApplicationDto {
    const parseArray = (value: unknown, field: string): unknown[] => {
      if (value === undefined || value === null || value === '') return [];
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // The common error below gives the caller a stable 400 response.
        }
      }
      throw new BadRequestException(`${field} massivi yanlışdır`);
    };

    const answers = parseArray(body?.answers, 'answers');
    const fileQuestionIds = parseArray(body?.fileQuestionIds, 'fileQuestionIds');

    if (
      (body?.resumeId !== undefined && typeof body.resumeId !== 'string') ||
      answers.some(
        (answer) =>
          !answer ||
          typeof answer !== 'object' ||
          typeof (answer as any).questionId !== 'string' ||
          ((answer as any).value !== undefined && typeof (answer as any).value !== 'string'),
      ) ||
      fileQuestionIds.some((id) => typeof id !== 'string')
    ) {
      throw new BadRequestException('Müraciət cavablarının formatı yanlışdır');
    }

    return {
      resumeId: typeof body?.resumeId === 'string' ? body.resumeId : undefined,
      answers: answers as CreateApplicationDto['answers'],
      fileQuestionIds: fileQuestionIds as string[],
    };
  }

  @Post('vacancies/:id/apply')
  @UseGuards(SessionAuthGuard)
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
      fileFilter: (_req, file, callback) => {
        if (!DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
          callback(new BadRequestException('Yalnız PDF və DOCX faylları qəbul edilir'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async apply(
    @GetUser('id') userId: string,
    @Param('id') vacancyId: string,
    @Body() rawBody: any,
    @UploadedFiles() files: Express.Multer.File[]
  ) {
    const createApplicationDto = this.parseApplicationBody(rawBody);
    const uploadedFiles = [];
    try {
      if ((createApplicationDto.fileQuestionIds?.length ?? 0) !== (files?.length ?? 0)) {
        throw new BadRequestException('Yüklənən fayllar suallarla uyğun gəlmir');
      }

      for (const [index, file] of (files ?? []).entries()) {
        const questionId = createApplicationDto.fileQuestionIds![index];
        const fileUrl = await this.localStorageService.uploadBuffer(file.buffer, file.mimetype);
        uploadedFiles.push({
          fieldName: questionId,
          fileUrl,
          originalName: file.originalname,
          mimeType: file.mimetype,
        });
        createApplicationDto.answers = [
          ...(createApplicationDto.answers ?? []).filter((answer) => answer.questionId !== questionId),
          { questionId, value: fileUrl },
        ];
      }

      return await this.jobApplicationsService.apply(userId, vacancyId, createApplicationDto, uploadedFiles);
    } catch (error) {
      await Promise.all(uploadedFiles.map((file) => this.localStorageService.deleteFile(file.fileUrl)));
      throw error;
    }
  }

  @Get('dashboard/applications')
  @UseGuards(SessionAuthGuard)
  async getOwnApplications(@GetUser('id') userId: string) {
    return this.jobApplicationsService.findCandidateApplications(userId);
  }

  @Get('dashboard/applications/:id')
  @UseGuards(SessionAuthGuard)
  async getOwnApplicationDetail(
    @GetUser('id') userId: string,
    @Param('id') id: string
  ) {
    return this.jobApplicationsService.findCandidateApplicationDetail(id, userId);
  }

  @Get('business/applications')
  @UseGuards(BusinessAuthGuard)
  async getEmployerApplications(
    @GetBusiness() business: any,
    @Query('vacancyId') vacancyId?: string,
    @Query('status') status?: string
  ) {
    return this.jobApplicationsService.findEmployerApplications(business.company.id, vacancyId, status);
  }

  @Get('business/applications/:id')
  @UseGuards(BusinessAuthGuard)
  async getEmployerApplicationDetail(
    @GetBusiness() business: any,
    @Param('id') id: string
  ) {
    return this.jobApplicationsService.findEmployerApplicationDetail(id, business.company.id);
  }

  @Patch('business/applications/:id/status')
  @UseGuards(BusinessAuthGuard)
  async updateApplicationStatus(
    @GetBusiness() business: any,
    @Param('id') id: string,
    @Body() dto: UpdateApplicationStatusDto
  ) {
    return this.jobApplicationsService.updateStatus(id, business.company.id, dto.status);
  }
}
