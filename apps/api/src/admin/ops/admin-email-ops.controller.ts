import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';
import { AdminSessionGuard } from '../admin-session.guard';
import { GetAdminUser } from '../get-admin-user.decorator';
import { AdminPermission } from '../permissions';
import { AdminEmailOpsService } from './admin-email-ops.service';

class ScheduleDto {
  @IsOptional() @IsBoolean() scheduled?: boolean;
  @IsOptional() @IsBoolean() paused?: boolean;
  @IsOptional() @IsInt() intervalMinutes?: number;
}

class RecoverDto {
  @IsOptional() @IsBoolean() run?: boolean;
}

class PauseSchedulerDto {
  @IsBoolean() paused!: boolean;
  @IsOptional() @IsString() reason?: string;
}

@Controller('admin')
@UseGuards(AdminSessionGuard)
export class AdminEmailOpsController {
  constructor(private ops: AdminEmailOpsService) {}

  @Get('ops/sources')
  @AdminPermission('ops.read')
  sources() { return this.ops.sources(); }

  @Put('ops/sources/:key/schedule')
  @AdminPermission('ops.control')
  schedule(@GetAdminUser('id') actor: string, @Param('key') key: string, @Body() dto: ScheduleDto) { return this.ops.updateSchedule(actor, key, dto); }

  @Post('ops/sources/:key/run-now')
  @HttpCode(202) // accepted: the run happens in the background
  @AdminPermission('ops.control')
  runNow(@GetAdminUser('id') actor: string, @Param('key') key: string) { return this.ops.runNow(actor, key); }

  @Post('ops/sources/:key/recover')
  @HttpCode(200)
  @AdminPermission('ops.control')
  recover(@GetAdminUser('id') actor: string, @Param('key') key: string, @Body() dto: RecoverDto) { return this.ops.recoverSource(actor, key, dto.run === true); }

  @Put('ops/scheduler/pause')
  @AdminPermission('ops.control')
  setGlobalPause(@GetAdminUser('id') actor: string, @Body() dto: PauseSchedulerDto) {
    return this.ops.setGlobalSchedulerPause(actor, dto.paused, dto.reason);
  }

  @Get('ops/email')
  @AdminPermission('ops.read')
  health() { return this.ops.emailHealth(); }

  @Get('ops/email/funnel')
  @AdminPermission('ops.read')
  funnel(@Query('days') days?: string) { return this.ops.funnel(Number(days) || 30); }

  @Get('email-applications/:id')
  @AdminPermission('applications.read')
  detail(@GetAdminUser('id') actor: string, @Param('id') id: string) { return this.ops.detail(actor, id); }
}
