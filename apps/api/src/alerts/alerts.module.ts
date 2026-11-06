import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { EmailModule } from '../common/email.module';
import { JobsModule } from '../jobs/jobs.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertDispatchProcessor, NewJobAlertProcessor } from './alerts.processors';
import { PreferencesService } from './preferences.service';

@Module({
  imports: [AuthModule, BillingModule, EmailModule, JobsModule, BullModule.registerQueue({ name: 'new-job-alert' }, { name: 'alert-dispatch' })],
  controllers: [AlertsController],
  providers: [AlertsService, PreferencesService, NewJobAlertProcessor, AlertDispatchProcessor],
  exports: [AlertsService, PreferencesService],
})
export class AlertsModule {}
