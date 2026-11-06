import { Module } from '@nestjs/common';
import { VolunteeringService } from './volunteering.service';
import { VolunteeringController } from './volunteering.controller';
import { PostHogService } from '../common/posthog.service';

@Module({
  controllers: [VolunteeringController],
  providers: [VolunteeringService, PostHogService],
  exports: [VolunteeringService],
})
export class VolunteeringModule {}
