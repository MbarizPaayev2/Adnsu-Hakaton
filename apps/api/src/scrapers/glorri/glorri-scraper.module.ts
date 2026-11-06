import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GlorriScraperService } from './glorri-scraper.service';
import { GlorriScraperProcessor } from './glorri-scraper.processor';
import { JobsModule } from '../../jobs/jobs.module';
import { PostHogService } from '../../common/posthog.service';
import { FeatureFlagsService } from '../../operations/feature-flags.service';

@Module({
  imports: [
    JobsModule,
    BullModule.registerQueue({
      name: 'glorri-scrape',
    }),
  ],
  providers: [GlorriScraperService, GlorriScraperProcessor, PostHogService, FeatureFlagsService],
  exports: [GlorriScraperService],
})
export class GlorriScraperModule {}
