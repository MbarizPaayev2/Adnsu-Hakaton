import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ResumesModule } from '../resumes/resumes.module';
import { ApplyWorkerClient } from '../external-apply/apply-worker.client';
import { PostHogService } from '../common/posthog.service';
import { AccountDeletionService } from './account-deletion.service';
import { AccountsController } from './accounts.controller';

@Module({
  imports: [AuthModule, BillingModule, ResumesModule],
  controllers: [AccountsController],
  providers: [AccountDeletionService, ApplyWorkerClient, PostHogService],
  exports: [AccountDeletionService],
})
export class AccountsModule {}
