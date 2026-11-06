import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ExternalApplyService } from './external-apply.service';

@Processor('external-apply-sweep')
export class ExternalApplySweepProcessor extends WorkerHost {
  private readonly logger = new Logger(ExternalApplySweepProcessor.name);

  constructor(private service: ExternalApplyService) {
    super();
  }

  async process(_job: Job<any, any, string>): Promise<any> {
    try {
      await this.service.reconcile();
    } catch (error) {
      this.logger.error('Error running external-apply reconcile sweep', error as Error);
      throw error;
    }
  }
}
