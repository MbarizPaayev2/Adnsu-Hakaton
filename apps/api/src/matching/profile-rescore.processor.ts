import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MatchingService } from './matching.service';
import { RESCORE_QUEUE, type RescoreJobData } from './rescore';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Serial by construction: worker concurrency 1 here, global concurrency 1 on the
// queue (set when a rollout is enqueued), and each job holds its slot for at least
// the rollout's spacing so the shared scorer handles one profile at a time.
@Processor(RESCORE_QUEUE, { concurrency: 1 })
export class ProfileRescoreProcessor extends WorkerHost {
  constructor(private matchingService: MatchingService) {
    super();
  }

  async process(job: Job<RescoreJobData>): Promise<void> {
    const { userId, rollout, silent, spacingMs } = job.data;
    const started = Date.now();
    await this.matchingService.runMatchingForProfile(userId, silent ? { silentRollout: rollout } : {});
    const remaining = spacingMs - (Date.now() - started);
    if (remaining > 0) await sleep(remaining);
  }
}
