import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ResumeTailorService } from './resume-tailor.service';
import { ResumeTailorProcessor } from './resume-tailor.processor';
import { LocalStorageService } from '../local-storage.service';
import { CareerModule } from '../../career/career.module';
import { DocumentAllowanceModule } from '../../documents/document-allowance.module';

@Module({
  imports: [
    CareerModule,
    DocumentAllowanceModule,
    BullModule.registerQueue({
      name: 'resume-tailor',
    }),
  ],
  providers: [ResumeTailorService, ResumeTailorProcessor, LocalStorageService],
  exports: [ResumeTailorService],
})
export class ResumeTailorModule {}
