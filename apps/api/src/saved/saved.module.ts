import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { SavedController } from './saved.controller';
import { SavedService } from './saved.service';

@Module({ imports: [AuthModule, BillingModule], controllers: [SavedController], providers: [SavedService], exports: [SavedService] })
export class SavedModule {}
