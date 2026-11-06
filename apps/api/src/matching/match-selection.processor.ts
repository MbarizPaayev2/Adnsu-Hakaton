import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { MatchingService } from './matching.service';

/** Plan quotas are allocated from the candidate pool after the collection window closes. */
@Processor('match-selection')
export class MatchSelectionProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(MatchSelectionProcessor.name);

  constructor(
    private readonly matching: MatchingService,
    @InjectQueue('match-selection') private readonly selectionQueue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    // Plus/Premium slots: daily after the Baku collection day closes.
    await this.selectionQueue.add('select-daily', { cadence: 'daily' }, {
      repeat: { pattern: '5 0 * * *', tz: 'Asia/Baku' },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
    }).catch((error) => this.logger.error(`Could not register daily ranked matching: ${error?.message}`));
    // Free slots: three strongest matches from the week, Monday after the Baku week boundary.
    await this.selectionQueue.add('select-weekly', { cadence: 'weekly' }, {
      repeat: { pattern: '10 0 * * 1', tz: 'Asia/Baku' },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
    }).catch((error) => this.logger.error(`Could not register weekly ranked matching: ${error?.message}`));
  }

  async process(job: Job<any, any, string>): Promise<void> {
    const cadence = job.data?.cadence;
    if (cadence !== 'daily' && cadence !== 'weekly') throw new Error('Invalid ranked matching cadence');
    await this.matching.publishRankedRecommendations(cadence);
  }
}
