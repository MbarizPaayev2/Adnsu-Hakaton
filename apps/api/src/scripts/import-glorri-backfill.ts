import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { JobsService } from '../jobs/jobs.service';
import { mapGlorriJobToIngestPayload } from '../scrapers/glorri/glorri-mapping.util';
import { GlorriJobRecord } from '../scrapers/glorri/glorri-scraper.types';

const DATA_FILE = path.join(__dirname, '../../prisma/seed-data/glorri_jobs_detail.json');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const jobsService = app.get(JobsService);

  console.log('--- BACKFILLING GLORRI.AZ JOBS ---');

  const records: GlorriJobRecord[] = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  console.log(`Loaded ${records.length} record(s) from ${DATA_FILE}`);

  let ingested = 0;
  for (const record of records) {
    await jobsService.ingestJob(mapGlorriJobToIngestPayload(record));
    ingested++;
    if (ingested % 100 === 0) console.log(`  ${ingested}/${records.length} ingested...`);
  }

  console.log(`Backfill complete: ${ingested}/${records.length} jobs ingested.`);

  await app.close();
}

bootstrap();
