import { Controller, Post, Body, Get, Req, UseGuards, HttpCode, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthService } from './admin-auth.service';
import { AdminAccountService } from './admin-account.service';
import { AdminSessionGuard } from './admin-session.guard';
import { GetAdminUser } from './get-admin-user.decorator';
import { LoginAdminDto } from './dto/login-admin.dto';
import { MfaLoginDto, SetupDto } from './dto/admin-security.dto';
import { AdminPermission } from './permissions';

const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private adminAuthService: AdminAuthService, private account: AdminAccountService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  async login(@Body() dto: LoginAdminDto, @Req() request: any) {
    return this.adminAuthService.login(dto.email, dto.password, request.headers['user-agent']);
  }

  /** Second step for operators with MFA: a TOTP or recovery code. */
  @Post('mfa')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  async mfa(@Body() dto: MfaLoginDto, @Req() request: any) {
    return this.adminAuthService.verifyMfa(dto.challengeToken, dto.code, request.headers['user-agent']);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() request: any) {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: true };
    }
    return this.adminAuthService.logout(authHeader.split(' ')[1]);
  }

  @Get('me')
  @UseGuards(AdminSessionGuard)
  @AdminPermission('self')
  getMe(@GetAdminUser('id') adminUserId: string) {
    return this.account.me(adminUserId);
  }

  /** Public: what a single-use setup/recovery link is for (never the token itself). */
  @Get('setup')
  @Throttle(AUTH_THROTTLE)
  describeSetup(@Query('token') token: string) {
    return this.adminAuthService.describeSetup(token);
  }

  @Post('setup')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  completeSetup(@Body() dto: SetupDto) {
    return this.adminAuthService.completeSetup(dto.token, dto.password, dto.name);
  }
}
