import { Controller, Post, Body, Get, UseGuards, Headers, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BusinessAuthService } from './business-auth.service';
import { RegisterBusinessDto } from './dto/register-business.dto';
import { LoginBusinessDto } from './dto/login-business.dto';
import { BusinessAuthGuard } from './business-auth.guard';
import { GetBusiness } from './get-business.decorator';
// Shape-identical to the User-side auth DTOs (a token, or an email, or a
// token+password) — reused rather than duplicated.
import { VerifyEmailDto } from '../auth/dto/verify-email.dto';
import { ResendVerificationDto } from '../auth/dto/resend-verification.dto';
import { ForgotPasswordDto } from '../auth/dto/forgot-password.dto';
import { ResetPasswordDto } from '../auth/dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const EMAIL_TRIGGER_THROTTLE = { default: { limit: 3, ttl: 60_000 } };

@Controller('business/auth')
export class BusinessAuthController {
  constructor(private readonly businessAuthService: BusinessAuthService) {}

  @Post('register')
  @Throttle(AUTH_THROTTLE)
  async register(@Body() dto: RegisterBusinessDto) {
    return this.businessAuthService.register(dto.email, dto.password, dto.companyName);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  async login(@Body() dto: LoginBusinessDto) {
    return this.businessAuthService.login(dto.email, dto.password);
  }

  @Post('verify-email')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.businessAuthService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @HttpCode(200)
  @Throttle(EMAIL_TRIGGER_THROTTLE)
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.businessAuthService.resendVerification(dto.email);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Throttle(EMAIL_TRIGGER_THROTTLE)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.businessAuthService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.businessAuthService.resetPassword(dto.token, dto.password);
  }

  @Post('change-password')
  @UseGuards(BusinessAuthGuard)
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  async changePassword(
    @GetBusiness('id') businessId: string,
    @Headers('authorization') auth: string,
    @Body() dto: ChangePasswordDto,
  ) {
    const currentSessionToken = auth.replace('Bearer ', '');
    return this.businessAuthService.changePassword(businessId, currentSessionToken, dto.currentPassword, dto.newPassword);
  }

  @Post('logout')
  @UseGuards(BusinessAuthGuard)
  @HttpCode(200)
  async logout(@Headers('authorization') auth: string) {
    const token = auth.replace('Bearer ', '');
    return this.businessAuthService.logout(token);
  }

  @Get('me')
  @UseGuards(BusinessAuthGuard)
  getMe(@GetBusiness() business: any) {
    return business;
  }
}
