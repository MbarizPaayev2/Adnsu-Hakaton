import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { WorkerTokenGuard } from '../auth/worker-token.guard';
import { ConfirmSubmitDto } from './dto/confirm-submit.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { SubmitOtpDto } from './dto/submit-otp.dto';
import { UpdateAnswersDto } from './dto/update-answers.dto';
import { SessionsService } from './sessions.service';

// Every route below requires a valid APPLY_WORKER_TOKEN bearer token (see
// WorkerTokenGuard) - this service holds real user PII and is never meant to
// be reachable except from apps/api's backend.
@UseGuards(WorkerTokenGuard)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  create(@Body() dto: CreateSessionDto) {
    return this.sessionsService.launchAndFill(dto.applicationId, dto.applyUrl, dto.fillData, dto.privacyAuthority);
  }

  @Patch(':id/answers')
  updateAnswers(@Param('id') id: string, @Body() dto: UpdateAnswersDto) {
    return this.sessionsService.applyAnswers(id, dto.answers, dto.motivationLetter);
  }

  // The real "final send". Only ever invoked for one candidate-initiated
  // attempt that apps/api has already claimed and persisted - never chained
  // after /sessions, never retried automatically, never from a cron/queue.
  // A repeated attemptId returns the first result instead of sending again.
  @Post(':id/confirm-submit')
  @HttpCode(200)
  confirmSubmit(@Param('id') id: string, @Body() dto: ConfirmSubmitDto) {
    return this.sessionsService.confirmSubmit(id, dto.attemptId, dto.dryRun);
  }

  // Submits one OTP code for one candidate-initiated attempt.
  @Post(':id/otp')
  @HttpCode(200)
  submitOtp(@Param('id') id: string, @Body() dto: SubmitOtpDto) {
    return this.sessionsService.submitOtp(id, dto.attemptId, dto.code);
  }

  @Get(':id/screenshot')
  async screenshot(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.sessionsService.takeScreenshot(id);
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  }

  @Delete(':id')
  async cancel(@Param('id') id: string) {
    await this.sessionsService.cancel(id);
    return { ok: true };
  }

  // Backs apps/api's reconciliation polling.
  @Get()
  list() {
    return { liveIds: this.sessionsService.listLiveIds() };
  }
}
