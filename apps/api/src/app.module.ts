import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { throttleOptions } from './common/throttle-options';
import { InstitutionsModule } from './institutions/institutions.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { ProfilesModule } from './profiles/profiles.module';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_RETENTION } from './common/queue-retention';
import { JobsModule } from './jobs/jobs.module';
import { MatchingModule } from './matching/matching.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ResumesModule } from './resumes/resumes.module';
import { BillingModule } from './billing/billing.module';
import { SavedModule } from './saved/saved.module';
import { AlertsModule } from './alerts/alerts.module';
import { TelegramModule } from './telegram/telegram.module';
import { TimelineModule } from './application-timeline/timeline.module';
import { AccountsModule } from './accounts/accounts.module';
import { HealthModule } from './health/health.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { GlorriScraperModule } from './scrapers/glorri/glorri-scraper.module';

import { BusinessModule } from './business/business.module';
import { CompaniesModule } from './companies/companies.module';
import { ObservedCompaniesModule } from './observed-companies/observed-companies.module';
import { VacanciesModule } from './vacancies/vacancies.module';
import { JobApplicationsModule } from './job-applications/job-applications.module';
import { AdminModule } from './admin/admin.module';
import { ExternalApplyModule } from './external-apply/external-apply.module';
import { VolunteeringModule } from './volunteering/volunteering.module';
import { UploadsModule } from './uploads/uploads.module';
import { EmailApplicationsModule } from './email-applications/email-applications.module';
import { AgentModule } from './browser-agent/agent.module';
import { AcademyModule } from './academy/academy.module';
import { CandidateOutcomesModule } from './candidate-outcomes/candidate-outcomes.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
      // Bounded by default so Redis cannot grow without limit. Failed jobs
      // stay 14 days for diagnosis and operator retry (/admin/operations);
      // a job's own options still win.
      defaultJobOptions: QUEUE_RETENTION,
    }),
    // Global default rate limit (per IP). Auth endpoints apply a much
    // tighter override via @Throttle to blunt credential-stuffing/brute force.
    ThrottlerModule.forRoot(throttleOptions),
    DatabaseModule,
    HealthModule,
    AuthModule,
    ProfilesModule,
    JobsModule,
    MatchingModule,
    NotificationsModule,
    ResumesModule,
    BillingModule,
    SavedModule,
    AlertsModule,
    TelegramModule,
    TimelineModule,
    AccountsModule,
    DashboardModule,
    GlorriScraperModule,
    BusinessModule,
    CompaniesModule,
    ObservedCompaniesModule,
    VacanciesModule,
    JobApplicationsModule,
    AdminModule,
    ExternalApplyModule,
    VolunteeringModule,
    UploadsModule,
    EmailApplicationsModule,
    AgentModule,
    InstitutionsModule,
    AcademyModule,
    CandidateOutcomesModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
