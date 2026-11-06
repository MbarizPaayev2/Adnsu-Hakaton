import { Module } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { JobMatchingService } from './job-matching.service';
import { MatchingController } from './matching.controller';
import { JobIngestedProcessor } from './job-ingested.processor';
import { ProfileOnboardedProcessor } from './profile-onboarded.processor';
import { ProfileRescoreProcessor } from './profile-rescore.processor';
import { MatchSelectionProcessor } from './match-selection.processor';
import { RESCORE_QUEUE } from './rescore';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { PostHogService } from '../common/posthog.service';

@Module({
  imports: [
    AuthModule,
    JobsModule,
    BullModule.registerQueue(
      { name: 'job-ingested' },
      { name: 'match-created' },
      { name: 'profile-onboarded' },
      { name: RESCORE_QUEUE },
      { name: 'match-selection' },
    ),
  ],
  controllers: [MatchingController],
  providers: [MatchingService, JobMatchingService, JobIngestedProcessor, ProfileOnboardedProcessor, ProfileRescoreProcessor, MatchSelectionProcessor, PostHogService],
  exports: [MatchingService, JobMatchingService],
})
export class MatchingModule {}
