import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { VacanciesController } from './vacancies.controller';
import { VacanciesService } from './vacancies.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'job-ingested' }, { name: 'new-job-alert' })],
  controllers: [VacanciesController],
  providers: [VacanciesService],
  exports: [VacanciesService],
})
export class VacanciesModule {}
