import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NotificationsService } from './notifications.service';

@Processor('digest-daily')
export class DigestDailyProcessor extends WorkerHost {
  constructor(private notificationsService: NotificationsService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    console.log(`Processing digest-daily task`);
    try {
      await this.notificationsService.runDailyDigest();
      console.log(`Successfully completed daily digest task`);
    } catch (error) {
      console.error(`Error executing daily digest task`, error);
      throw error;
    }
  }
}
