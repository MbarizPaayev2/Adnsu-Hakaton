import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ResumesModule } from '../resumes/resumes.module';
import { BillingModule } from '../billing/billing.module';
import { FeatureFlagsService } from '../operations/feature-flags.service';
import { AGENT_CONFIG, loadAgentConfig } from './agent.config';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { AgentExtController, DeviceAuthGuard } from './agent-ext.controller';

@Module({
  imports: [AuthModule, ResumesModule, BillingModule],
  controllers: [AgentController, AgentExtController],
  providers: [{ provide: AGENT_CONFIG, useFactory: () => loadAgentConfig() }, AgentService, DeviceAuthGuard, FeatureFlagsService],
  exports: [AgentService],
})
export class AgentModule {}
