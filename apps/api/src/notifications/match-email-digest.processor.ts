import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NotificationsService } from './notifications.service';

@Processor('match-email-digest')
export class MatchEmailDigestProcessor extends WorkerHost {
  constructor(private notificationsService: NotificationsService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { userId } = job.data;
    console.log(`Processing match-email-digest flush for user: ${userId}`);
    try {
      await this.notificationsService.sendMatchEmailDigest(userId);
    } catch (error) {
      console.error(`Error processing match-email-digest flush for user: ${userId}`, error);
      throw error;
    }
  }
}
