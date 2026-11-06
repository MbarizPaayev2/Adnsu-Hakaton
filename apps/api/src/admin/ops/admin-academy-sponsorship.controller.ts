import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsDateString, IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import type { SubscriptionPlan } from '@prisma/client';
import { AcademySponsorshipService } from '../../academy/sponsorship.service';
import { AdminSessionGuard } from '../admin-session.guard';
import { GetAdminUser } from '../get-admin-user.decorator';
import { AdminPermission } from '../permissions';

class ProvisionSponsorshipDto {
  @IsIn(['PLUS', 'PREMIUM'])
  plan: SubscriptionPlan;

  @IsInt()
  @Min(1)
  @Max(500)
  seatCapacity: number;

  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;
}

class GrantSeatDto {
  @IsString()
  @MaxLength(100)
  userId: string;
}

@Controller('admin/academies')
@UseGuards(AdminSessionGuard)
export class AdminAcademySponsorshipController {
  constructor(private readonly sponsorship: AcademySponsorshipService) {}

  @Post(':academyId/sponsorship')
  @AdminPermission('academy.sponsorship')
  provision(@Param('academyId') academyId: string, @GetAdminUser('id') actorId: string, @Body() dto: ProvisionSponsorshipDto) {
    return this.sponsorship.provision(academyId, actorId, { plan: dto.plan, seatCapacity: dto.seatCapacity, startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt) });
  }

  @Get(':academyId/sponsorship')
  @AdminPermission('users.read')
  overview(@Param('academyId') academyId: string) {
    return this.sponsorship.overview(academyId);
  }

  @Post(':academyId/sponsorship/grants')
  @AdminPermission('academy.sponsorship')
  grant(@Param('academyId') academyId: string, @GetAdminUser('id') actorId: string, @Body() dto: GrantSeatDto) {
    return this.sponsorship.grant(academyId, actorId, dto.userId);
  }

  @Delete(':academyId/sponsorship/grants/:grantId')
  @AdminPermission('academy.sponsorship')
  revoke(@Param('academyId') academyId: string, @Param('grantId') grantId: string, @GetAdminUser('id') actorId: string) {
    return this.sponsorship.revoke(academyId, grantId, actorId);
  }
}
