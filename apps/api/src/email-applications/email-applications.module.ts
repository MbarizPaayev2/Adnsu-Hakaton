import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AuthModule } from '../auth/auth.module';
import { ResumesModule } from '../resumes/resumes.module';
import { FeatureFlagsService } from '../operations/feature-flags.service';
import { EMAIL_APPLY_CONFIG, EMAIL_TRANSPORT } from './email-apply.tokens';
import { emailApplyConfigProblems, loadEmailApplyConfig, type EmailApplyConfig } from './email-apply.config';
import { ResendTransport } from './email-transport';
import { EmailApplicationsService } from './email-applications.service';
import { EmailApplicationsController } from './email-applications.controller';
import { ResendWebhookController } from './resend-webhook.controller';
import { EmailApplicationSender } from './email-application.sender';
import { EmailApplicationMaintenance } from './email-application.maintenance';
import { EmailApplicationProcessor, EmailApplicationSweepProcessor } from './email-application.processor';
import { DeliveryEvidenceService } from './delivery-evidence.service';
import { InboundReplyService } from './inbound-reply.service';
import { EmailAutomationService } from './email-automation.service';
import { EmailAllowanceService } from './email-allowance.service';

@Module({
  imports: [AuthModule, ResumesModule, BullModule.registerQueue({ name: 'email-application' }, { name: 'email-application-sweep' })],
  controllers: [EmailApplicationsController, ResendWebhookController],
  providers: [
    {
      provide: EMAIL_APPLY_CONFIG,
      useFactory: (): EmailApplyConfig => {
        const cfg = loadEmailApplyConfig();
        const problems = emailApplyConfigProblems(cfg);
        // An unsafe live configuration stops the process instead of sending with a half-checked setup.
        if (problems.length) throw new Error(`E-mail application configuration is unsafe: ${problems.join('; ')}`);
        return cfg;
      },
    },
    { provide: EMAIL_TRANSPORT, inject: [EMAIL_APPLY_CONFIG], useFactory: (cfg: EmailApplyConfig) => new ResendTransport(cfg, cfg.providerTimeoutMs) },
    FeatureFlagsService,
    EmailApplicationsService,
    EmailAllowanceService,
    EmailApplicationSender,
    EmailApplicationMaintenance,
    DeliveryEvidenceService,
    InboundReplyService,
    EmailAutomationService,
    EmailApplicationProcessor,
    EmailApplicationSweepProcessor,
  ],
  exports: [EmailApplicationsService, DeliveryEvidenceService, EMAIL_APPLY_CONFIG],
})
export class EmailApplicationsModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailApplicationsModule.name);
  constructor(@InjectQueue('email-application-sweep') private sweepQueue: Queue) {}

  async onApplicationBootstrap() {
    if (!loadEmailApplyConfig().enabled) return;
    await this.sweepQueue
      .add('email-application-sweep-job', {}, { repeat: { pattern: '* * * * *' }, removeOnComplete: true, removeOnFail: true })
      .catch((err) => this.logger.error('Failed to register the e-mail application sweep', err));
  }
}
