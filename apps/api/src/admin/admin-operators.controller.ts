import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminSessionGuard } from './admin-session.guard';
import { AdminOperatorsService } from './admin-operators.service';
import { GetAdminUser } from './get-admin-user.decorator';
import { AdminPermission } from './permissions';
import { ChangeRoleDto, DisableOperatorDto, InviteOperatorDto } from './dto/admin-security.dto';

@Controller('admin/operators')
@UseGuards(AdminSessionGuard)
@AdminPermission('operators.manage')
export class AdminOperatorsController {
  constructor(private operators: AdminOperatorsService) {}

  @Get()
  list() {
    return this.operators.list();
  }

  @Post('invitations')
  invite(@GetAdminUser('id') actorId: string, @Body() dto: InviteOperatorDto) {
    return this.operators.invite(actorId, dto.email, dto.role);
  }

  @Post('invitations/:id/resend')
  @HttpCode(200)
  resend(@GetAdminUser('id') actorId: string, @Param('id') id: string) {
    return this.operators.resendInvitation(actorId, id);
  }

  @Delete('invitations/:id')
  revokeInvitation(@GetAdminUser('id') actorId: string, @Param('id') id: string) {
    return this.operators.revokeInvitation(actorId, id);
  }

  @Patch(':id/role')
  changeRole(@GetAdminUser('id') actorId: string, @Param('id') id: string, @Body() dto: ChangeRoleDto) {
    return this.operators.changeRole(actorId, id, dto.role);
  }

  @Post(':id/disable')
  @HttpCode(200)
  disable(@GetAdminUser('id') actorId: string, @Param('id') id: string, @Body() dto: DisableOperatorDto) {
    return this.operators.disable(actorId, id, dto.reason);
  }

  @Post(':id/remove')
  @HttpCode(200)
  remove(@GetAdminUser('id') actorId: string, @Param('id') id: string, @Body() dto: DisableOperatorDto) {
    return this.operators.remove(actorId, id, dto.reason);
  }

  @Post(':id/enable')
  @HttpCode(200)
  enable(@GetAdminUser('id') actorId: string, @Param('id') id: string) {
    return this.operators.enable(actorId, id);
  }

  @Post(':id/sessions/revoke')
  @HttpCode(200)
  revokeSessions(@GetAdminUser('id') actorId: string, @Param('id') id: string) {
    return this.operators.revokeSessions(actorId, id);
  }

  @Post(':id/reset-link')
  @HttpCode(200)
  resetLink(@GetAdminUser('id') actorId: string, @Param('id') id: string) {
    return this.operators.sendResetLink(actorId, id);
  }

  @Post(':id/mfa/reset')
  @HttpCode(200)
  resetMfa(@GetAdminUser('id') actorId: string, @Param('id') id: string) {
    return this.operators.resetMfa(actorId, id);
  }
}
