import { Module } from '@nestjs/common';
import { BusinessAuthController } from './business-auth.controller';
import { BusinessAuthService } from './business-auth.service';
import { EmailModule } from '../common/email.module';
import { PostHogService } from '../common/posthog.service';

@Module({
  imports: [EmailModule],
  controllers: [BusinessAuthController],
  providers: [BusinessAuthService, PostHogService],
  exports: [BusinessAuthService],
})
export class BusinessModule {}
