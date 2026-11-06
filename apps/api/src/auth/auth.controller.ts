import { Controller, Get, Post, Patch, Body, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SessionAuthGuard } from './session-auth.guard';
import { GetUser } from './get-user.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { GoogleSignInDto } from './dto/google-sign-in.dto';
import { GoogleIdentityService } from './google-identity.service';

// Tighter than the app-wide default — these are the credential-stuffing /
// brute-force / registration-spam targets.
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

// Resending/requesting triggers an outbound email per call — much tighter so
// this can't be used to spam an inbox or as a cheap enumeration oracle.
const EMAIL_TRIGGER_THROTTLE = { default: { limit: 3, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService, private google: GoogleIdentityService) {}

  /** Which sign-in methods this deployment offers, so the UI never shows a dead button. */
  @Get('providers')
  providers() { return { google: this.google.enabled() }; }

  @Post('google')
  @Throttle(AUTH_THROTTLE)
  async googleSignIn(@Body() body: GoogleSignInDto) {
    return this.authService.googleSignIn(body.idToken, body.acceptTerms);
  }

  @Post('register')
  @Throttle(AUTH_THROTTLE)
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body.email, body.password, body.acceptTerms, body.name);
  }

  @Post('login')
  @Throttle(AUTH_THROTTLE)
  async login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password);
  }

  @Post('verify-email')
  @Throttle(AUTH_THROTTLE)
  async verifyEmail(@Body() body: VerifyEmailDto) {
    return this.authService.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @Throttle(EMAIL_TRIGGER_THROTTLE)
  async resendVerification(@Body() body: ResendVerificationDto) {
    return this.authService.resendVerification(body.email);
  }

  @Post('forgot-password')
  @Throttle(EMAIL_TRIGGER_THROTTLE)
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body.email);
  }

  @Post('reset-password')
  @Throttle(AUTH_THROTTLE)
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.token, body.password);
  }

  @Post('logout')
  async logout(@Req() request: any) {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: true }; // Consider success if no session token sent
    }
    const sessionToken = authHeader.split(' ')[1];
    return this.authService.logout(sessionToken);
  }

  @Patch('password')
  @UseGuards(SessionAuthGuard)
  @Throttle(AUTH_THROTTLE)
  async changePassword(
    @GetUser('id') userId: string,
    @Req() request: any,
    @Body() body: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      userId,
      request.session.sessionToken,
      body.currentPassword,
      body.newPassword,
    );
  }

  // DELETE /auth/account lives in accounts/accounts.controller.ts.
}
