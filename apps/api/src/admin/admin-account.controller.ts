import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminSessionGuard } from './admin-session.guard';
import { AdminAccountService } from './admin-account.service';
import { GetAdminUser } from './get-admin-user.decorator';
import { AdminPermission } from './permissions';
import { ChangePasswordDto, DisableMfaDto, MfaCodeDto } from './dto/admin-security.dto';

const SENSITIVE_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('admin/account')
@UseGuards(AdminSessionGuard)
@AdminPermission('self')
export class AdminAccountController {
  constructor(private account: AdminAccountService) {}

  @Post('password')
  @HttpCode(200)
  @Throttle(SENSITIVE_THROTTLE)
  changePassword(@GetAdminUser('id') id: string, @Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.account.changePassword(id, req.adminSession.id, dto.currentPassword, dto.newPassword, dto.code);
  }

  @Get('sessions')
  sessions(@GetAdminUser('id') id: string, @Req() req: any) {
    return this.account.listSessions(id, req.adminSession.id);
  }

  @Delete('sessions/:sessionId')
  revokeSession(@GetAdminUser('id') id: string, @Param('sessionId') sessionId: string) {
    return this.account.revokeSession(id, sessionId);
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  revokeOthers(@GetAdminUser('id') id: string, @Req() req: any) {
    return this.account.revokeOtherSessions(id, req.adminSession.id);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @Throttle(SENSITIVE_THROTTLE)
  startMfa(@GetAdminUser('id') id: string) {
    return this.account.startMfa(id);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  @Throttle(SENSITIVE_THROTTLE)
  enableMfa(@GetAdminUser('id') id: string, @Req() req: any, @Body() dto: MfaCodeDto) {
    return this.account.enableMfa(id, req.adminSession.id, dto.code);
  }

  @Post('mfa/recovery-codes')
  @HttpCode(200)
  @Throttle(SENSITIVE_THROTTLE)
  regenerate(@GetAdminUser('id') id: string, @Body() dto: MfaCodeDto) {
    return this.account.regenerateRecoveryCodes(id, dto.code);
  }

  @Post('mfa/disable')
  @HttpCode(200)
  @Throttle(SENSITIVE_THROTTLE)
  disableMfa(@GetAdminUser('id') id: string, @Body() dto: DisableMfaDto) {
    return this.account.disableMfa(id, dto.password, dto.code);
  }
}
