import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EmailApplicationSender } from './email-application.sender';
import { EmailApplicationMaintenance } from './email-application.maintenance';

@Processor('email-application')
export class EmailApplicationProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailApplicationProcessor.name);
  constructor(private sender: EmailApplicationSender) { super(); }

  async process(job: Job<{ id: string }, unknown, string>) {
    const result = await this.sender.process(job.data.id);
    this.logger.log(`application ${job.data.id}: ${result}`);
    return result;
  }
}

@Processor('email-application-sweep')
export class EmailApplicationSweepProcessor extends WorkerHost {
  constructor(private maintenance: EmailApplicationMaintenance) { super(); }
  async process() { return this.maintenance.sweep(); }
}
