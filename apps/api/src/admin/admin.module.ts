import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminSessionGuard } from './admin-session.guard';
import { AdminAccountController } from './admin-account.controller';
import { AdminAccountService } from './admin-account.service';
import { AdminOperatorsController } from './admin-operators.controller';
import { AdminOperatorsService } from './admin-operators.service';
import { BullModule } from '@nestjs/bullmq';
import { AdminOpsController } from './ops/admin-ops.controller';
import { AdminOpsService } from './ops/admin-ops.service';
import { FeatureFlagsService } from '../operations/feature-flags.service';
import { PostHogService } from '../common/posthog.service';
import { ResumesModule } from '../resumes/resumes.module';
import { AccountsModule } from '../accounts/accounts.module';
import { EmailApplicationsModule } from '../email-applications/email-applications.module';
import { JobsModule } from '../jobs/jobs.module';
import { EmployerPlansModule } from '../employer-plans/employer-plans.module';
import { AdminEmailOpsController } from './ops/admin-email-ops.controller';
import { AdminEmailOpsService } from './ops/admin-email-ops.service';
import { AdminRecommendationsService } from './ops/admin-recommendations.service';
import { AdminAcademySponsorshipController } from './ops/admin-academy-sponsorship.controller';
import { AcademyModule } from '../academy/academy.module';

@Module({
  imports: [
    ResumesModule,
    AccountsModule, // the shared account-deletion path
    EmailApplicationsModule, // delivery configuration for operator views
    JobsModule,
    EmployerPlansModule,
    AcademyModule,
    BullModule.registerQueue(
      { name: 'job-ingested' }, { name: 'profile-onboarded' }, { name: 'resume-tailor' },
      { name: 'match-created' }, { name: 'glorri-scrape' }, { name: 'external-apply' },
    ),
  ],
  controllers: [AdminController, AdminAuthController, AdminAccountController, AdminOperatorsController, AdminOpsController, AdminEmailOpsController, AdminAcademySponsorshipController],
  providers: [
    AdminService,
    AdminAuthService,
    AdminSessionGuard,
    AdminAccountService,
    AdminOperatorsService,
    AdminOpsService,
    AdminEmailOpsService,
    AdminRecommendationsService,
    FeatureFlagsService,
    PostHogService,
  ],
  exports: [AdminService],
})
export class AdminModule {}
