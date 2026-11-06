import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { EmailApplicationsService } from './email-applications.service';
import { EmailAutomationService } from './email-automation.service';
import { ApproveDto, AutomationDto, ConfirmReplyDto, PrepareEmailApplicationDto, RetryUncertainDto, UpdateDraftDto, UpdateRecruitmentDto } from './dto';

/** Candidate-facing e-mail applications. Every route is scoped to the signed-in candidate. */
@Controller('email-applications')
@UseGuards(SessionAuthGuard)
export class EmailApplicationsController {
  constructor(private readonly service: EmailApplicationsService, private readonly automation: EmailAutomationService) {}

  @Get('capabilities')
  capabilities(@GetUser('id') userId: string) { return this.service.capabilities(userId); }

  @Get('allowance')
  allowance(@GetUser('id') userId: string) { return this.service.allowanceFor(userId); }

  @Get('settings')
  settings(@GetUser('id') userId: string) { return this.service.settings(userId); }

  @Post('settings/pause') @HttpCode(200)
  pause(@GetUser('id') userId: string) { return this.service.pause(userId); }

  @Post('settings/resume') @HttpCode(200)
  resume(@GetUser('id') userId: string) { return this.service.resume(userId); }

  @Post('settings/cancel-pending') @HttpCode(200)
  cancelPending(@GetUser('id') userId: string) { return this.service.cancelPending(userId); }

  @Post('settings/revoke-consent') @HttpCode(200)
  revokeConsent(@GetUser('id') userId: string) { return this.service.revokeConsent(userId); }

  @Get('automation')
  automationSettings(@GetUser('id') userId: string) { return this.automation.get(userId); }

  @Put('automation')
  saveAutomation(@GetUser('id') userId: string, @Body() dto: AutomationDto) { return this.automation.save(userId, dto); }

  @Post('automation/disable') @HttpCode(200)
  disableAutomation(@GetUser('id') userId: string) { return this.automation.disable(userId); }

  @Post('automation/review/stop') @HttpCode(200)
  stopReviewQueue(@GetUser('id') userId: string) { return this.automation.stopReviewQueue(userId); }

  @Get('eligibility/:jobId')
  eligibility(@GetUser('id') userId: string, @Param('jobId') jobId: string) { return this.service.eligibility(userId, jobId); }

  @Post('prepare') @HttpCode(200)
  prepare(@GetUser('id') userId: string, @Body() dto: PrepareEmailApplicationDto) { return this.service.prepare(userId, dto.jobId, { resumeId: dto.resumeId, letterId: dto.letterId }); }

  @Get()
  list(@GetUser('id') userId: string) { return this.service.list(userId); }

  @Get(':id')
  get(@GetUser('id') userId: string, @Param('id') id: string) { return this.service.get(userId, id); }

  @Patch(':id/draft')
  updateDraft(@GetUser('id') userId: string, @Param('id') id: string, @Body() dto: UpdateDraftDto) { return this.service.updateDraft(userId, id, dto); }

  @Post(':id/approve') @HttpCode(200)
  approve(@GetUser('id') userId: string, @Param('id') id: string, @Body() dto: ApproveDto) { return this.service.approve(userId, id, dto); }

  @Post(':id/cancel') @HttpCode(200)
  cancel(@GetUser('id') userId: string, @Param('id') id: string) { return this.service.cancel(userId, id); }

  @Post(':id/retry') @HttpCode(200)
  retry(@GetUser('id') userId: string, @Param('id') id: string, @Body() dto: RetryUncertainDto) { return this.service.retryUncertain(userId, id, dto); }

  @Patch(':id/status')
  status(@GetUser('id') userId: string, @Param('id') id: string, @Body() dto: UpdateRecruitmentDto) { return this.service.updateRecruitment(userId, id, dto); }

  @Post(':id/replies/:replyId') @HttpCode(200)
  confirmReply(@GetUser('id') userId: string, @Param('id') id: string, @Param('replyId') replyId: string, @Body() dto: ConfirmReplyDto) { return this.service.confirmReplySuggestion(userId, id, replyId, dto); }

  /** The candidate's own copy of the document that was (or will be) attached. */
  @Get(':id/cv')
  async cv(@GetUser('id') userId: string, @Param('id') id: string, @Res() res: Response) {
    this.sendFile(res, await this.service.cvDownload(userId, id, 'cv'));
  }

  /** The candidate's own copy of the motivation letter that was (or will be) attached. */
  @Get(':id/letter')
  async letter(@GetUser('id') userId: string, @Param('id') id: string, @Res() res: Response) {
    this.sendFile(res, await this.service.cvDownload(userId, id, 'letter'));
  }

  private sendFile(res: Response, file: { bytes: Buffer; fileName: string; mimeType: string }) {
    res.set({ 'Content-Type': file.mimeType, 'Content-Disposition': `attachment; filename="${file.fileName}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(file.bytes);
  }
}
