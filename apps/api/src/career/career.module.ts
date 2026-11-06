import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CareerEntriesController } from './career-entries.controller';
import { CareerEntriesService } from './career-entries.service';

@Module({ imports: [AuthModule], controllers: [CareerEntriesController], providers: [CareerEntriesService], exports: [CareerEntriesService] })
export class CareerModule {}
