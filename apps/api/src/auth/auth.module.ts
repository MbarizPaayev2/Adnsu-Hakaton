import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleIdentityService } from './google-identity.service';
import { SessionAuthGuard } from './session-auth.guard';
import { EmailModule } from '../common/email.module';
import { PostHogService } from '../common/posthog.service';
import { LocalStorageService } from '../resumes/local-storage.service';

@Module({
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [AuthService, GoogleIdentityService, SessionAuthGuard, PostHogService, LocalStorageService],
  exports: [AuthService, GoogleIdentityService, SessionAuthGuard],
})
export class AuthModule {}
