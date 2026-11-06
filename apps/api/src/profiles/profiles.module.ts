import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProfilesService } from './profiles.service';
import { ProfilesController } from './profiles.controller';
import { AuthModule } from '../auth/auth.module';
import { ResumesModule } from '../resumes/resumes.module';
import { CareerModule } from '../career/career.module';

@Module({
  imports: [
    AuthModule,
    ResumesModule, // LocalStorageService (ID-document upload)
    CareerModule,
    BullModule.registerQueue({ name: 'profile-onboarded' }),
  ],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
