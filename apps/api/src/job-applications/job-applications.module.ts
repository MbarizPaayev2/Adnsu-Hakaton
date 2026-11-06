import { Module } from '@nestjs/common';
import { JobApplicationsController } from './job-applications.controller';
import { JobApplicationsService } from './job-applications.service';
import { ResumesModule } from '../resumes/resumes.module';
import { PostHogService } from '../common/posthog.service';
import { TimelineModule } from '../application-timeline/timeline.module';

@Module({
  imports: [ResumesModule, TimelineModule],
  controllers: [JobApplicationsController],
  providers: [JobApplicationsService, PostHogService],
  exports: [JobApplicationsService],
})
export class JobApplicationsModule {}
