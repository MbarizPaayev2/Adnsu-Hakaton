import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SourceScheduler } from './source-scheduler.service';

@Processor('source-schedule')
export class SourceScheduleProcessor extends WorkerHost {
  constructor(private scheduler: SourceScheduler) { super(); }
  async process() { return this.scheduler.tick(); }
}

/** The cron pattern of the repeating tick: every ten minutes unless a deployment sets `SOURCE_SCHEDULE_TICK_PATTERN` to every N minutes (1-59). Anything else is ignored. */
export function tickPattern(value = process.env.SOURCE_SCHEDULE_TICK_PATTERN): string {
  return value && /^\*\/([1-9]|[1-5]\d) \* \* \* \*$/.test(value.trim()) ? value.trim() : '*/10 * * * *';
}

/**
 * Registers the repeating tick only when the deployment enables the scheduler.
 * Cleans up existing repeatable jobs on bootstrap to ensure strict idempotency across API restarts.
 */
@Injectable()
export class SourceScheduleRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(SourceScheduleRegistrar.name);
  constructor(@InjectQueue('source-schedule') private queue: Queue) {}

  async onApplicationBootstrap() {
    try {
      const repeatableJobs = await this.queue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        if (job.name === 'source-schedule-tick' || job.key.includes('source-schedule-tick')) {
          await this.queue.removeRepeatableByKey(job.key);
        }
      }
    } catch (err) {
      this.logger.warn(`Could not inspect repeatable jobs in source-schedule queue: ${err instanceof Error ? err.message : err}`);
    }

    if (!SourceScheduler.enabled()) {
      this.logger.log('Source schedule disabled (SOURCE_SCHEDULE_ENABLED !== true); no repeatable jobs registered');
      return;
    }

    await this.queue.add('source-schedule-tick', {}, { repeat: { pattern: tickPattern() }, removeOnComplete: true, removeOnFail: true })
      .catch((error) => this.logger.error('Failed to register the source schedule', error));
    this.logger.log(`Source scheduler registered repeating tick ${tickPattern()}`);
  }
}
