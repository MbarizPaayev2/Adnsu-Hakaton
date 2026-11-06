import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { AnySessionGuard } from './any-session.guard';
import { UploadAccessService } from './upload-access.service';
import { LocalStorageService } from '../resumes/local-storage.service';

@Module({
  controllers: [UploadsController],
  providers: [AnySessionGuard, UploadAccessService, LocalStorageService],
})
export class UploadsModule {}
