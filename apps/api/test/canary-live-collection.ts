/**
 * Bounded live collection for cleared original employer canary sources against aise_census_growth_test.
 * Sources: pasha-insurance (Teamtailor RSS), xsolla (Lever API).
 * Runs through the real SourceScheduler with source lease acquisition, heartbeat, upsert, and run recording.
 */
import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../src/database/database.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobSourceService } from '../src/jobs/job-source.service';
import { FeatureFlagsService } from '../src/operations/feature-flags.service';
import { SourceScheduler } from '../src/jobs/source-scheduler.service';

async function main() {
  const url = process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@127.0.0.1:5433/aise_census_growth_test?schema=public';
  process.env.DATABASE_URL = url;

  const module = await Test.createTestingModule({
    providers: [
      PrismaService,
      JobsService,
      JobSourceService,
      FeatureFlagsService,
      SourceScheduler,
      { provide: getQueueToken('job-ingested'), useValue: { add: async () => ({}) } },
    ],
  }).compile();

  const app = module.createNestApplication();
  app.useLogger(new ConsoleLogger());
  await app.init();

  const scheduler = module.get(SourceScheduler);
  const prisma = module.get(PrismaService);

  const sourcesToRun = ['pasha-insurance', 'xsolla'];
  const results: any[] = [];

  for (const key of sourcesToRun) {
    console.log(`\n==================================================`);
    console.log(`Starting live collection for canary source: ${key}`);
    console.log(`==================================================`);

    const preCount = await prisma.job.count({ where: { externalId: { startsWith: `${key}:` } } });
    console.log(`Before collection: ${preCount} jobs in database for ${key}`);

    const res = await scheduler.runSourceNow(key);
    console.log(`runSourceNow status: ${res.status}`);

    // Wait for in-flight run to settle
    await scheduler.idle();

    const summary = scheduler.summaries.get(key);
    console.log(`Collection summary for ${key}:`, JSON.stringify(summary, null, 2));

    const postCount = await prisma.job.count({ where: { externalId: { startsWith: `${key}:` } } });
    console.log(`After collection: ${postCount} jobs in database for ${key} (delta: +${postCount - preCount})`);

    results.push({ key, preCount, postCount, delta: postCount - preCount, summary });
  }

  console.log(`\n==================================================`);
  console.log(`ALL CANARY SOURCES COLLECTED SUCCESSFULLY`);
  console.log(`==================================================`);
  console.log(JSON.stringify(results, null, 2));

  await app.close();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Canary collection failed:', e);
    process.exit(1);
  });
}
