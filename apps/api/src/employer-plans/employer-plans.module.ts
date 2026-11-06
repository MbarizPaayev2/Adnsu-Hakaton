import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EmployerPlansService } from './employer-plans.service';
import { EmployerPlansController } from './employer-plans.controller';
import { loadEmployerPlansConfig } from './employer-plans.config';

@Processor('employer-plans-sweep')
export class EmployerPlansSweepProcessor extends WorkerHost {
  constructor(private plans: EmployerPlansService) { super(); }
  async process() { return this.plans.sweep(); }
}

@Module({
  imports: [BullModule.registerQueue({ name: 'job-ingested' }, { name: 'new-job-alert' }, { name: 'employer-plans-sweep' })],
  controllers: [EmployerPlansController],
  providers: [EmployerPlansService, EmployerPlansSweepProcessor],
  exports: [EmployerPlansService],
})
export class EmployerPlansModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmployerPlansModule.name);
  constructor(@InjectQueue('employer-plans-sweep') private sweepQueue: Queue) {}

  async onApplicationBootstrap() {
    if (!loadEmployerPlansConfig().gated) return;
    await this.sweepQueue
      .add('employer-plans-sweep-job', {}, { repeat: { pattern: '*/5 * * * *' }, removeOnComplete: true, removeOnFail: true })
      .catch((err) => this.logger.error('Failed to register the employer plans sweep', err));
  }
}
