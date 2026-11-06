import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AlertsService } from './alerts.service';

@Processor('new-job-alert')
export class NewJobAlertProcessor extends WorkerHost {
  constructor(private alerts: AlertsService) { super(); }
  async process(job: Job<{ jobId?: string; vacancyId?: string }>) { return job.data.vacancyId ? this.alerts.fanOutNewVacancy(job.data.vacancyId) : this.alerts.fanOutNewJob(job.data.jobId!); }
}

@Processor('alert-dispatch')
export class AlertDispatchProcessor extends WorkerHost {
  constructor(private alerts: AlertsService) { super(); }
  async process(job: Job<{ userId?: string; mode?: 'instant' | 'daily'; channel?: 'EMAIL' | 'TELEGRAM' }>) {
    if (job.name === 'daily-alert-digest') return this.alerts.runDailyDigest();
    const { userId, mode = 'daily', channel = 'EMAIL' } = job.data;
    return channel === 'TELEGRAM' ? this.alerts.dispatchTelegram(userId!, mode) : this.alerts.dispatchEmail(userId!, mode);
  }
}
