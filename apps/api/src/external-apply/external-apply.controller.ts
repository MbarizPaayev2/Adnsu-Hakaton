import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ExternalApplyService } from './external-apply.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { CreateExternalApplicationDto } from './dto/create-external-application.dto';
import { SubmitAnswersDto } from './dto/submit-answers.dto';
import { ConfirmSubmitDto } from './dto/confirm-submit.dto';
import { SubmitOtpDto } from './dto/submit-otp.dto';
import { GrantConsentDto } from './dto/grant-consent.dto';

@Controller('external-applications')
@UseGuards(SessionAuthGuard)
export class ExternalApplyController {
  constructor(private externalApplyService: ExternalApplyService) {}

  @Post()
  async create(@GetUser('id') userId: string, @Body() dto: CreateExternalApplicationDto) {
    return this.externalApplyService.create(userId, dto.matchId);
  }

  /** Server-side answer to "may this match show an automated-apply action?". */
  @Get('capabilities')
  async capabilities(@GetUser('id') userId: string, @Query('matchIds') matchIds?: string) {
    const ids = (matchIds || '').split(',').map((id) => id.trim()).filter(Boolean);
    if (!ids.length || ids.length > 100) throw new BadRequestException('matchIds 1-100 id tələb edir');
    return this.externalApplyService.capabilities(userId, ids);
  }

  // Declared before ':id' so 'mine' is not read as an id.
  @Get('mine')
  async listMine(@GetUser('id') userId: string) {
    return this.externalApplyService.listMine(userId);
  }

  @Get(':id')
  async findById(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.externalApplyService.findById(id, userId);
  }

  @Get()
  async findByMatch(@GetUser('id') userId: string, @Query('matchId') matchId?: string) {
    if (!matchId) {
      throw new BadRequestException('matchId query parametri tələb olunur');
    }
    return this.externalApplyService.findByMatch(matchId, userId);
  }

  /** Destination, recipient notice, exact fields and documents — shown before anything is sent. */
  @Get(':id/preparation')
  async preparation(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.externalApplyService.getPreparation(id, userId);
  }

  @Post(':id/consent')
  @HttpCode(200)
  async grantConsent(@GetUser('id') userId: string, @Param('id') id: string, @Body() dto: GrantConsentDto) {
    return this.externalApplyService.grantConsent(id, userId, dto);
  }

  @Patch(':id/answers')
  async submitAnswers(@GetUser('id') userId: string, @Param('id') id: string, @Body() dto: SubmitAnswersDto) {
    return this.externalApplyService.submitAnswers(id, userId, dto);
  }

  @Post(':id/confirm-submit')
  @HttpCode(200)
  async confirmSubmit(@GetUser('id') userId: string, @Param('id') id: string, @Body() dto: ConfirmSubmitDto) {
    return this.externalApplyService.confirmSubmit(id, userId, dto);
  }

  @Post(':id/otp')
  @HttpCode(200)
  async submitOtp(@GetUser('id') userId: string, @Param('id') id: string, @Body() dto: SubmitOtpDto) {
    return this.externalApplyService.submitOtp(id, userId, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.externalApplyService.cancel(id, userId);
  }
}
