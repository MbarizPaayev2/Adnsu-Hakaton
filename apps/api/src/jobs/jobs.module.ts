import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { BullModule } from '@nestjs/bullmq';
import { JobCatalogueController } from './job-catalogue.controller';
import { JobCatalogueService } from './job-catalogue.service';
import { JobSourceService } from './job-source.service';
import { SourceScheduler } from './source-scheduler.service';
import { SourceScheduleProcessor, SourceScheduleRegistrar } from './source-schedule.processor';
import { FeatureFlagsService } from '../operations/feature-flags.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'job-ingested',
    }),
    BullModule.registerQueue({ name: 'source-schedule' }),
    BullModule.registerQueue({ name: 'new-job-alert' }),
  ],
  controllers: [JobsController, JobCatalogueController],
  providers: [JobsService, JobCatalogueService, JobSourceService, FeatureFlagsService, SourceScheduler, SourceScheduleProcessor, SourceScheduleRegistrar],
  exports: [JobsService, JobCatalogueService, JobSourceService, SourceScheduler],
})
export class JobsModule {}
