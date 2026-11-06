import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ResumesService } from './resumes.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { TailorResumeDto } from './dto/tailor-resume.dto';
import { UpdateResumeDto } from './dto/update-resume.dto';
import { TailorReviewDto } from './dto/tailor-review.dto';
import { ApproveTailoredDto } from './dto/approve-tailored.dto';
import { DOCUMENT_MIME_TYPES as ALLOWED_RESUME_MIME_TYPES } from './local-storage.service';

@Controller('resumes')
@UseGuards(SessionAuthGuard)
export class ResumesController {
  constructor(private resumesService: ResumesService) {}

  @Get()
  async getResumes(@GetUser('id') userId: string) {
    return this.resumesService.getResumes(userId);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_RESUME_MIME_TYPES.includes(file.mimetype)) {
          callback(new BadRequestException('Yalnız PDF və DOCX faylları qəbul edilir'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async uploadBaseResume(
    @GetUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Fayl tələb olunur (form-data sahə adı: file, PDF və ya DOCX, maks. 10MB)');
    }
    return this.resumesService.uploadBaseResume(userId, file);
  }

  /**
   * Text copied from a LinkedIn profile (or a public LinkedIn profile URL) through the same reviewed import pipeline as an uploaded file.
   * Nothing is saved: the structured result is returned for the candidate to review and merge.
   */
  @Post('import-text')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async importText(@GetUser('id') userId: string, @Body() body: { text?: string; allowPublicReader?: boolean }) {
    return this.resumesService.parseImportedText(userId, String(body?.text ?? ''), body?.allowPublicReader === true);
  }

  /**
   * Public LinkedIn profile URL read for review and merging. Nothing is saved:
   * the candidate reviews the result before saving.
   */
  @Post('import-url')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async importUrl(@GetUser('id') userId: string, @Body() body: { url?: string; allowPublicReader?: boolean }) {
    return this.resumesService.parseImportedUrl(userId, String(body?.url ?? ''), body?.allowPublicReader === true);
  }

  /**
   * A LinkedIn "Save to PDF" export (or another CV) read for review and merging only. Unlike POST /resumes it stores nothing and never replaces the
   * candidate's base CV file; the candidate reviews the result and saves the profile as usual.
   */
  @Post('import-file')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        if (file.mimetype !== 'application/pdf') {
          callback(new BadRequestException('LinkedIn idxalı üçün PDF faylı yükləyin'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async importFile(@GetUser('id') userId: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Fayl tələb olunur (PDF, maks. 10MB)');
    return this.resumesService.parseImportedFile(userId, file);
  }

  @Delete(':id')
  async deleteResume(
    @GetUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.resumesService.deleteResume(userId, id);
  }

  @Post('tailor')
  async createTailoredResume(
    @GetUser('id') userId: string,
    @Body() body: TailorResumeDto,
  ) {
    return this.resumesService.createTailoredResume(userId, body);
  }

  // Tailored CV review: owner-only (another candidate's id answers 404).
  @Get(':id')
  async getTailoredResume(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.resumesService.getTailoredResume(userId, id);
  }

  @Patch(':id/review')
  async reviewTailoredResume(@GetUser('id') userId: string, @Param('id') id: string, @Body() body: TailorReviewDto) {
    return this.resumesService.updateTailoredContent(userId, id, body as Record<string, unknown>);
  }

  // Asks again for the Azerbaijani translation of text that is still English in a draft. Bounded: it is a provider call.
  @Post(':id/translate')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async retranslateTailoredResume(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.resumesService.retranslateTailored(userId, id);
  }

  @Post(':id/approve')
  async approveTailoredResume(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body() body?: ApproveTailoredDto,
  ) {
    return this.resumesService.approveTailoredResume(userId, id, body);
  }

  @Patch(':id')
  async updateResume(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: UpdateResumeDto,
  ) {
    return this.resumesService.updateResumeContent(userId, id, body.parsedContent);
  }
}
