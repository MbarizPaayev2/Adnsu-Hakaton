import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AdminSessionGuard } from '../admin-session.guard';
import { GetAdminUser } from '../get-admin-user.decorator';
import { AdminPermission } from '../permissions';
import type { AdminRole } from '@prisma/client';
import { AdminOpsService } from './admin-ops.service';
import { AdminRecommendationsService } from './admin-recommendations.service';

class ReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

class FeatureDto extends ReasonDto {
  @IsBoolean()
  paused: boolean;
}

class PlanOverrideDto {
  @IsIn(['FREE', 'BASIC', 'STANDARD', 'Limitsiz'])
  plan: 'FREE' | 'BASIC' | 'STANDARD' | 'Limitsiz';

  @IsString()
  @MaxLength(300)
  reason: string;

  @IsInt()
  @Min(1)
  @Max(365)
  days: number;
}

@Controller('admin')
@UseGuards(AdminSessionGuard)
export class AdminOpsController {
  constructor(private ops: AdminOpsService, private recommendations: AdminRecommendationsService) {}

  @Get('ops/overview')
  @AdminPermission('ops.read')
  overview() {
    return this.ops.overview();
  }

  /** Recommended actions: observed conditions with freshness, severity, a next step, a page/runbook and the permission the action needs. Read-only. */
  @Get('ops/recommendations')
  @AdminPermission('ops.read')
  recommended(@GetAdminUser('role') role: AdminRole) {
    return this.recommendations.build(role);
  }

  /** Model usage and document timing over the last `days` (default 30): measured counts, a lower-bound cost estimate and what is unknown. */
  @Get('ops/ai-usage')
  @AdminPermission('ops.read')
  aiUsage(@Query('days') days?: string) {
    return this.ops.aiUsage(Number(days) || 30);
  }

  @Get('ops/health')
  @AdminPermission('ops.read')
  health() {
    return this.ops.health();
  }

  @Get('ops/imports')
  @AdminPermission('ops.read')
  imports() {
    return this.ops.imports();
  }

  @Post('ops/imports/glorri')
  @HttpCode(200)
  @AdminPermission('ops.control')
  requestImport(@GetAdminUser('id') actor: string) {
    return this.ops.requestImport(actor);
  }

  @Get('ops/queues')
  @AdminPermission('ops.read')
  queues() {
    return this.ops.failedJobs();
  }

  @Post('ops/queues/:queue/jobs/:jobId/retry')
  @HttpCode(200)
  @AdminPermission('ops.control')
  retry(@GetAdminUser('id') actor: string, @Param('queue') queue: string, @Param('jobId') jobId: string) {
    return this.ops.retry(actor, queue, jobId);
  }

  @Put('ops/features/:key')
  @AdminPermission('ops.control')
  setFeature(@GetAdminUser('id') actor: string, @Param('key') key: string, @Body() dto: FeatureDto) {
    return this.ops.setFeature(actor, key, dto.paused, dto.reason);
  }

  @Get('listings')
  @AdminPermission('listings.read')
  listings(@Query('q') q?: string, @Query('status') status?: string, @Query('hidden') hidden?: string, @Query('page') page?: string) {
    return this.ops.listings({ q, status, hidden, page: Number(page) });
  }

  @Post('listings/:id/hide')
  @HttpCode(200)
  @AdminPermission('listings.moderate')
  hide(@GetAdminUser('id') actor: string, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.ops.setListingHidden(actor, id, true, dto.reason);
  }

  @Post('listings/:id/restore')
  @HttpCode(200)
  @AdminPermission('listings.moderate')
  restore(@GetAdminUser('id') actor: string, @Param('id') id: string) {
    return this.ops.setListingHidden(actor, id, false);
  }

  @Get('applications')
  @AdminPermission('applications.read')
  applications(@Query('kind') kind = 'native', @Query('status') status?: string, @Query('page') page?: string) {
    return this.ops.applications(kind === 'external' ? 'external' : 'native', status, Number(page));
  }

  @Post('users/:id/suspend')
  @HttpCode(200)
  @AdminPermission('users.suspend')
  suspendUser(@GetAdminUser('id') actor: string, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.ops.setUserSuspended(actor, id, true, dto.reason);
  }

  @Post('users/:id/restore')
  @HttpCode(200)
  @AdminPermission('users.suspend')
  restoreUser(@GetAdminUser('id') actor: string, @Param('id') id: string) {
    return this.ops.setUserSuspended(actor, id, false);
  }

  @Post('companies/:id/suspend')
  @HttpCode(200)
  @AdminPermission('companies.moderate')
  suspendCompany(@GetAdminUser('id') actor: string, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.ops.setCompanySuspended(actor, id, true, dto.reason);
  }

  @Post('companies/:id/restore')
  @HttpCode(200)
  @AdminPermission('companies.moderate')
  restoreCompany(@GetAdminUser('id') actor: string, @Param('id') id: string) {
    return this.ops.setCompanySuspended(actor, id, false);
  }

  @Get('users/:id/plan-overrides')
  @AdminPermission('users.read')
  planOverrides(@Param('id') id: string) {
    return this.ops.planOverrides(id);
  }

  @Post('users/:id/plan-overrides')
  @AdminPermission('users.plan')
  grant(@GetAdminUser('id') actor: string, @Param('id') id: string, @Body() dto: PlanOverrideDto) {
    return this.ops.grantPlanOverride(actor, id, dto.plan, dto.reason, dto.days);
  }

  @Delete('users/:id/plan-overrides/:overrideId')
  @AdminPermission('users.plan')
  revoke(@GetAdminUser('id') actor: string, @Param('id') id: string, @Param('overrideId') overrideId: string) {
    return this.ops.revokePlanOverride(actor, id, overrideId);
  }

  @Get('audit')
  @AdminPermission('audit.read')
  audit(@Query('action') action?: string, @Query('targetType') targetType?: string, @Query('actor') actor?: string, @Query('page') page?: string) {
    return this.ops.auditLog({ action, targetType, actor, page: Number(page) });
  }
}
