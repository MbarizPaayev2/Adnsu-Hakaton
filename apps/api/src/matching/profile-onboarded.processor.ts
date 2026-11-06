import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MatchingService } from './matching.service';

// Runs once per user, right after they finish onboarding (see
// ProfilesService.completeOnboarding) — scores their new profile against
// every vacancy already in the database, not just ones ingested afterward.
@Processor('profile-onboarded')
export class ProfileOnboardedProcessor extends WorkerHost {
  constructor(private matchingService: MatchingService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { userId } = job.data;
    console.log(`Processing profile-onboarded BullMQ task for User ID: ${userId}`);
    try {
      await this.matchingService.runMatchingForProfile(userId);
      console.log(`Successfully completed onboarding matching pass for User ID: ${userId}`);
    } catch (error) {
      console.error(`Error processing onboarding matching pass for User ID: ${userId}`, error);
      throw error;
    }
  }
}
