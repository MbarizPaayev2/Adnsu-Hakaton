import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ExternalApplyService } from './external-apply.service';

interface ExternalApplyJobData {
  applicationId: string;
}

// The only queued/retryable step in this feature: reaching the external
// site's own review screen is safe and side-effect-free. Confirm-submit and
// OTP are deliberately NEVER run from a job — see external-apply.service.ts.
@Processor('external-apply')
export class ExternalApplyProcessor extends WorkerHost {
  private readonly logger = new Logger(ExternalApplyProcessor.name);

  constructor(private service: ExternalApplyService) {
    super();
  }

  async process(job: Job<ExternalApplyJobData, any, string>): Promise<any> {
    const { applicationId } = job.data;
    this.logger.log(`Processing external-apply fill for ExternalApplication ID: ${applicationId}`);
    try {
      await this.service.runFill(applicationId);
      this.logger.log(`Completed external-apply fill for ExternalApplication ID: ${applicationId}`);
    } catch (error) {
      this.logger.error(`Error running external-apply fill for ExternalApplication ID: ${applicationId}`, error as Error);
      throw error;
    }
  }
}
