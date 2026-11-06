import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MatchingService } from './matching.service';

@Processor('job-ingested')
export class JobIngestedProcessor extends WorkerHost {
  constructor(private matchingService: MatchingService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    // Shared queue for both posting kinds: ingest paths enqueue { jobId } or
    // { vacancyId } and the matching direction is dispatched here.
    const { jobId, vacancyId } = job.data;
    if (vacancyId) {
      console.log(`Processing job-ingested BullMQ task for Vacancy ID: ${vacancyId}`);
      try {
        await this.matchingService.runVacancyMatching(vacancyId);
        console.log(`Successfully completed matching process for Vacancy ID: ${vacancyId}`);
      } catch (error) {
        console.error(`Error processing matching for Vacancy ID: ${vacancyId}`, error);
        throw error;
      }
      return;
    }
    console.log(`Processing job-ingested BullMQ task for Job ID: ${jobId}`);
    try {
      await this.matchingService.runMatching(jobId);
      console.log(`Successfully completed matching process for Job ID: ${jobId}`);
    } catch (error) {
      console.error(`Error processing matching for Job ID: ${jobId}`, error);
      throw error;
    }
  }
}
