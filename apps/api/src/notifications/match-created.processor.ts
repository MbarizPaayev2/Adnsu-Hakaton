import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NotificationsService } from './notifications.service';

@Processor('match-created')
export class MatchCreatedProcessor extends WorkerHost {
  constructor(private notificationsService: NotificationsService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { matchId, userId } = job.data;
    console.log(`Processing match-created task for Match: ${matchId}`);
    try {
      await this.notificationsService.handleMatchCreated(matchId, userId);
      console.log(`Successfully processed match-created task for Match: ${matchId}`);
    } catch (error) {
      console.error(`Error processing match-created task for Match: ${matchId}`, error);
      throw error;
    }
  }
}
