import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { MatchCreatedProcessor } from './match-created.processor';
import { MatchEmailDigestProcessor } from './match-email-digest.processor';
import { DigestDailyProcessor } from './digest-daily.processor';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../common/email.module';
import { PostHogService } from '../common/posthog.service';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [
    AuthModule,
    EmailModule,
    AlertsModule,
    BullModule.registerQueue(
      { name: 'match-created' },
      { name: 'match-email-digest' },
      { name: 'digest-daily' },
    ),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    PostHogService,
    MatchCreatedProcessor,
    MatchEmailDigestProcessor,
    DigestDailyProcessor,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
