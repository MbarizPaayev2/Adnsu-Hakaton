import { BadRequestException, Body, Controller, Get, Header, Param, Patch, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { GetUser } from '../auth/get-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ResumesService } from '../resumes/resumes.service';
import { ApproveTailoredDto } from '../resumes/dto/approve-tailored.dto';
import { TailorReviewDto } from '../resumes/dto/tailor-review.dto';
import { DocumentAllowanceService } from './document-allowance.service';
import { DocumentsService } from './documents.service';
import { DOCUMENT_KINDS, GenerateDocumentsDto, QuoteDocumentsDto, RegenerateDocumentDto } from './documents.dto';

/**
 * The candidate's generated documents (CV, concise resume, motivation letter). Every route is owner-only: another candidate's id answers 404.
 * Only generate/regenerate use the monthly allowance; quote, list, detail, review, approve and preview are free.
 */
@Controller('documents')
@UseGuards(SessionAuthGuard)
export class DocumentsController {
  constructor(private documents: DocumentsService, private allowance: DocumentAllowanceService, private resumes: ResumesService) {}

  @Get('allowance')
  allowanceView(@GetUser('id') userId: string) {
    return this.allowance.view(userId);
  }

  /** The match a saved posting is written against (created hidden and unscored when the posting never reached the recommendation threshold). */
  @Post('saved-job-match')
  savedJobMatch(@GetUser('id') userId: string, @Body() body: { ref?: string }) {
    return this.documents.matchForSavedJob(userId, String(body?.ref ?? ''));
  }

  @Post('quote')
  quote(@GetUser('id') userId: string, @Body() body: QuoteDocumentsDto) {
    return this.documents.quote(userId, body);
  }

  @Post('generate')
  async generate(@GetUser('id') userId: string, @Body() body: GenerateDocumentsDto) {
    const result = await this.documents.generate(userId, body);
    return {
      bundleId: result.bundleId,
      created: result.created,
      unitsReserved: result.units,
      documents: result.documents.map((d) => this.documents.summary(d)),
      allowance: await this.allowance.view(userId),
    };
  }

  @Get('letter-answers')
  letterAnswers(@GetUser('id') userId: string) {
    return this.documents.latestReusableLetterAnswers(userId);
  }

  @Get()
  list(@GetUser('id') userId: string, @Query('matchId') matchId?: string, @Query('kind') kind?: string) {
    if (kind && !(DOCUMENT_KINDS as readonly string[]).includes(kind)) throw new BadRequestException('Naməlum sənəd növü');
    return this.documents.list(userId, { matchId: matchId || undefined, kind: kind as any });
  }

  @Get(':id')
  detail(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.resumes.getTailoredResume(userId, id);
  }

  @Patch(':id/review')
  review(@GetUser('id') userId: string, @Param('id') id: string, @Body() body: TailorReviewDto) {
    return this.resumes.updateTailoredContent(userId, id, body as Record<string, unknown>);
  }

  @Post(':id/approve')
  approve(@GetUser('id') userId: string, @Param('id') id: string, @Body() body?: ApproveTailoredDto) {
    return this.resumes.approveTailoredResume(userId, id, body);
  }

  @Post(':id/regenerate')
  async regenerate(@GetUser('id') userId: string, @Param('id') id: string, @Body() body: RegenerateDocumentDto) {
    const result = await this.documents.regenerate(userId, id, body);
    return { bundleId: result.bundleId, created: result.created, unitsReserved: result.units, documents: result.documents.map((d) => this.documents.summary(d)), allowance: await this.allowance.view(userId) };
  }

  /** The PDF as it is now: the approved file once approved, otherwise the draft rendered by the same code that renders the approved file. */
  @Get(':id/preview')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async preview(@GetUser('id') userId: string, @Param('id') id: string) {
    const { bytes, approved } = await this.resumes.previewPdf(userId, id);
    return new StreamableFile(bytes, { type: 'application/pdf', disposition: `inline; filename="${approved ? 'document' : 'draft'}.pdf"` });
  }
}
