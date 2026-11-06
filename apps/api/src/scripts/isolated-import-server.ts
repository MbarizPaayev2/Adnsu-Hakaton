import { NestFactory } from '@nestjs/core';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/database.service';
import { JobsController } from '../jobs/jobs.controller';
import { JobsService } from '../jobs/jobs.service';
import { JobSourceService } from '../jobs/job-source.service';
import { ApiKeyGuard } from '../jobs/api-key.guard';

@Module({
  controllers: [JobsController],
  providers: [
    PrismaService,
    JobsService,
    JobSourceService,
    ApiKeyGuard,
    {
      provide: ConfigService,
      useValue: {
        get: (key: string) =>
          key === 'SCRAPER_SERVICE_TOKEN'
            ? (process.env.SCRAPER_SERVICE_TOKEN || 'isolated-growth-token')
            : undefined,
      },
    },
    { provide: 'BullQueue_job-ingested', useValue: { add: async () => ({}) } },
    { provide: 'BullQueue_new-job-alert', useValue: { add: async () => ({}) } },
  ],
})
class IsolatedServerModule {}

async function bootstrap() {
  const port = parseInt(process.env.PORT || '4098', 10);
  const app = await NestFactory.create(IsolatedServerModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(port, '127.0.0.1');
  console.log(`Isolated import server listening on http://127.0.0.1:${port}`);
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('Failed to start isolated import server:', err);
    process.exit(1);
  });
}
