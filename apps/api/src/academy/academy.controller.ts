import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AcademyService } from './academy.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { AcademyTenantGuard } from './guards/academy-tenant.guard';
import { AcademyRoles } from './decorators/academy-roles.decorator';
import { AcademyRole } from '@prisma/client';
import { CreateAcademyDto, UpdateAcademyDto } from './dto/create-academy.dto';
import { CreateCohortDto, UpdateCohortDto } from './dto/cohort.dto';
import {
  InviteStaffDto,
  InviteStudentsDto,
  AcceptInvitationDto,
} from './dto/invitation.dto';
import { AcademySponsorshipService } from './sponsorship.service';

@Controller('academies')
export class AcademyController {
  constructor(private academyService: AcademyService, private sponsorshipService: AcademySponsorshipService) {}

  // ── Student-Facing Endpoints ───────────────────────────────────────────────

  @Get('invitations/:token')
  async getInvitation(@Param('token') token: string) {
    return this.academyService.getInvitationByToken(token);
  }

  @Post('invitations/:token/accept')
  @UseGuards(SessionAuthGuard)
  async acceptInvitation(
    @GetUser('id') userId: string,
    @Param('token') token: string,
    @Body() dto: AcceptInvitationDto,
  ) {
    return this.academyService.acceptInvitation(userId, token, dto);
  }

  @Post('staff-invitations/:token/accept')
  @UseGuards(SessionAuthGuard)
  async acceptStaffInvitation(
    @GetUser('id') userId: string,
    @Param('token') token: string,
  ) {
    return this.academyService.acceptStaffInvitation(userId, token);
  }

  @Post('enrollments/:enrollmentId/revoke')
  @UseGuards(SessionAuthGuard)
  async revokeConsent(
    @GetUser('id') userId: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.academyService.revokeConsent(userId, enrollmentId);
  }

  @Get('my-enrollments')
  @UseGuards(SessionAuthGuard)
  async getMyEnrollments(@GetUser('id') userId: string) {
    return this.academyService.getMyEnrollments(userId);
  }

  // ── Workspace & Member Endpoints ───────────────────────────────────────────

  @Post()
  @UseGuards(SessionAuthGuard)
  async createAcademy(
    @GetUser('id') userId: string,
    @Body() dto: CreateAcademyDto,
  ) {
    return this.academyService.createAcademy(userId, dto);
  }

  @Get()
  @UseGuards(SessionAuthGuard)
  async listUserAcademies(@GetUser('id') userId: string) {
    return this.academyService.listUserAcademies(userId);
  }

  @Get(':academyId')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  async getAcademy(@Param('academyId') academyId: string) {
    return this.academyService.getAcademy(academyId);
  }

  /** Cohort-staff view is aggregate seat utilization only; it contains no student identities. */
  @Get(':academyId/sponsorship')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  async getSponsorshipUsage(@Param('academyId') academyId: string) {
    return this.sponsorshipService.overview(academyId);
  }

  @Patch(':academyId')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  @AcademyRoles(AcademyRole.OWNER, AcademyRole.ADMIN)
  async updateAcademy(
    @Param('academyId') academyId: string,
    @Body() dto: UpdateAcademyDto,
  ) {
    return this.academyService.updateAcademy(academyId, dto);
  }

  @Get(':academyId/members')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  async listMembers(@Param('academyId') academyId: string) {
    return this.academyService.listMembers(academyId);
  }

  @Post(':academyId/members/invite')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  @AcademyRoles(AcademyRole.OWNER, AcademyRole.ADMIN)
  async inviteStaff(
    @Param('academyId') academyId: string,
    @GetUser('id') inviterUserId: string,
    @Body() dto: InviteStaffDto,
  ) {
    return this.academyService.inviteStaff(academyId, inviterUserId, dto);
  }

  @Delete(':academyId/members/:memberId')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  @AcademyRoles(AcademyRole.OWNER)
  async removeMember(
    @Param('academyId') academyId: string,
    @Param('memberId') memberId: string,
    @GetUser('id') actorUserId: string,
  ) {
    return this.academyService.removeMember(academyId, memberId, actorUserId);
  }

  // ── Cohort Endpoints ───────────────────────────────────────────────────────

  @Get(':academyId/cohorts')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  async listCohorts(@Param('academyId') academyId: string) {
    return this.academyService.listCohorts(academyId);
  }

  @Post(':academyId/cohorts')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  @AcademyRoles(AcademyRole.OWNER, AcademyRole.ADMIN)
  async createCohort(
    @Param('academyId') academyId: string,
    @Body() dto: CreateCohortDto,
  ) {
    return this.academyService.createCohort(academyId, dto);
  }

  @Get(':academyId/cohorts/:cohortId')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  async getCohort(
    @Param('academyId') academyId: string,
    @Param('cohortId') cohortId: string,
  ) {
    return this.academyService.getCohort(academyId, cohortId);
  }

  @Patch(':academyId/cohorts/:cohortId')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  @AcademyRoles(AcademyRole.OWNER, AcademyRole.ADMIN)
  async updateCohort(
    @Param('academyId') academyId: string,
    @Param('cohortId') cohortId: string,
    @Body() dto: UpdateCohortDto,
  ) {
    return this.academyService.updateCohort(academyId, cohortId, dto);
  }

  // ── Cohort Students & Invitations ──────────────────────────────────────────

  @Post(':academyId/cohorts/:cohortId/invitations')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  @AcademyRoles(AcademyRole.OWNER, AcademyRole.ADMIN, AcademyRole.COACH)
  async inviteStudents(
    @Param('academyId') academyId: string,
    @Param('cohortId') cohortId: string,
    @Body() dto: InviteStudentsDto,
  ) {
    return this.academyService.inviteStudents(academyId, cohortId, dto);
  }

  @Get(':academyId/cohorts/:cohortId/students')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  async listCohortStudents(
    @Param('academyId') academyId: string,
    @Param('cohortId') cohortId: string,
  ) {
    return this.academyService.listCohortStudents(academyId, cohortId);
  }

  @Delete(':academyId/cohorts/:cohortId/students/:enrollmentId')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  @AcademyRoles(AcademyRole.OWNER, AcademyRole.ADMIN)
  async withdrawStudent(
    @Param('academyId') academyId: string,
    @Param('cohortId') cohortId: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.academyService.withdrawStudent(academyId, cohortId, enrollmentId);
  }

  // ── KPI Endpoints ──────────────────────────────────────────────────────────

  @Get(':academyId/cohorts/:cohortId/kpis')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  async getCohortKpis(
    @Param('academyId') academyId: string,
    @Param('cohortId') cohortId: string,
  ) {
    return this.academyService.getCohortKpis(academyId, cohortId);
  }

  @Get(':academyId/kpis')
  @UseGuards(SessionAuthGuard, AcademyTenantGuard)
  async getAcademyKpis(@Param('academyId') academyId: string) {
    return this.academyService.getAcademyKpis(academyId);
  }
}
