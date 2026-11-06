import { Module } from '@nestjs/common';
import { AcademyController } from './academy.controller';
import { AcademyService } from './academy.service';
import { AcademyTenantGuard } from './guards/academy-tenant.guard';
import { DatabaseModule } from '../database/database.module';
import { AcademySponsorshipService } from './sponsorship.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AcademyController],
  providers: [AcademyService, AcademyTenantGuard, AcademySponsorshipService],
  exports: [AcademyService, AcademySponsorshipService],
})
export class AcademyModule {}
