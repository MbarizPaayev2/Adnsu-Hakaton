import { Module } from '@nestjs/common';
import { LocalStorageService } from '../resumes/local-storage.service';
import { ObservedCompaniesController } from './observed-companies.controller';
import { ObservedCompaniesService } from './observed-companies.service';

@Module({ controllers: [ObservedCompaniesController], providers: [ObservedCompaniesService, LocalStorageService], exports: [ObservedCompaniesService] })
export class ObservedCompaniesModule {}
