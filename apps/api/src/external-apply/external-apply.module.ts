import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ExternalApplyController } from './external-apply.controller';
import { ExternalApplyService } from './external-apply.service';
import { ExternalApplyProcessor } from './external-apply.processor';
import { ExternalApplySweepProcessor } from './external-apply-sweep.processor';
import { ApplyWorkerClient } from './apply-worker.client';
import { ExternalDestinationRegistry } from './destinations';
import { FeatureFlagsService } from '../operations/feature-flags.service';
import { AuthModule } from '../auth/auth.module';
import { ResumesModule } from '../resumes/resumes.module';
import { PostHogService } from '../common/posthog.service';

// DatabaseModule is @Global() (see database/database.module.ts) so
// PrismaService is already available here without importing it explicitly.
@Module({
  imports: [
    AuthModule,
    ResumesModule, // for LocalStorageService (review screenshots)
    BullModule.registerQueue({ name: 'external-apply' }, { name: 'external-apply-sweep' }),
  ],
  controllers: [ExternalApplyController],
  providers: [ExternalApplyService, ExternalApplyProcessor, ExternalApplySweepProcessor, ApplyWorkerClient, ExternalDestinationRegistry, FeatureFlagsService, PostHogService],
  exports: [ExternalApplyService],
})
export class ExternalApplyModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExternalApplyModule.name);

  constructor(@InjectQueue('external-apply-sweep') private sweepQueue: Queue) {}

  async onApplicationBootstrap() {
    // Schedule repeatable job to expire stale in-flight applications every 2
    // minutes (see ExternalApplyService.reconcile).
    await this.sweepQueue
      .add(
        'external-apply-sweep-job',
        {},
        {
          repeat: { pattern: '*/2 * * * *' },
          removeOnComplete: true,
        },
      )
      .catch((err) => this.logger.error('Failed to register repeatable external-apply-sweep job', err));
    this.logger.log('[CRON EXTERNAL-APPLY] Repeatable sweep job registered successfully');
  }
}
