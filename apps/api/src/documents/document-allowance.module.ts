import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { DocumentAllowanceService } from './document-allowance.service';

@Module({ imports: [BillingModule], providers: [DocumentAllowanceService], exports: [DocumentAllowanceService] })
export class DocumentAllowanceModule {}
