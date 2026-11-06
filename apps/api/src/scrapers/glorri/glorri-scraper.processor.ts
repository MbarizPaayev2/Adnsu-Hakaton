import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { GlorriScraperService } from './glorri-scraper.service';
import { FeatureFlagsService } from '../../operations/feature-flags.service';

// One worker per queue processes one run at a time, so scheduled and
// operator-requested imports never overlap in a process.
@Processor('glorri-scrape')
export class GlorriScraperProcessor extends WorkerHost {
  constructor(private glorriScraperService: GlorriScraperService, private flags: FeatureFlagsService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    // The same switch that stops the schedule from being registered also stops a run that is already queued (a repeat
    // job left in Redis by an earlier start): without this, merely booting the app against a shared Redis scraped glorri.az.
    if (process.env.GLORRI_SCRAPER_ENABLED === 'false') return { skipped: 'DISABLED' };
    if (await this.flags.isPaused('import.glorri')) {
      console.log('glorri-scrape skipped: paused by an operator');
      return { skipped: 'PAUSED' };
    }
    console.log('Processing glorri-scrape task');
    try {
      const result = await this.glorriScraperService.runScrape();
      console.log(`Successfully completed glorri-scrape task: ${result.ingested}/${result.scanned} jobs ingested`);
    } catch (error) {
      console.error('Error executing glorri-scrape task', error);
      throw error;
    }
  }
}
