import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ResumesService } from './resumes.service';
import { ResumesController } from './resumes.controller';
import { LocalStorageService } from './local-storage.service';
import { AuthModule } from '../auth/auth.module';
import { ResumeTailorModule } from './tailor/resume-tailor.module';
import { BillingModule } from '../billing/billing.module';
import { CareerModule } from '../career/career.module';
import { DocumentAllowanceModule } from '../documents/document-allowance.module';
import { DocumentsController } from '../documents/documents.controller';
import { DocumentsService } from '../documents/documents.service';

@Module({
  imports: [
    AuthModule,
    BillingModule,
    CareerModule,
    DocumentAllowanceModule,
    ResumeTailorModule,
    BullModule.registerQueue({
      name: 'resume-tailor',
    }),
  ],
  controllers: [ResumesController, DocumentsController],
  providers: [ResumesService, DocumentsService, LocalStorageService],
  exports: [ResumesService, DocumentsService, LocalStorageService],
})
export class ResumesModule {}
