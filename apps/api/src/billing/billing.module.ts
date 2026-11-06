import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { AuthModule } from '../auth/auth.module';
import { PostHogService } from '../common/posthog.service';
import { ProductService } from './product.service';
import { UsageService } from './usage.service';
import { EmployerPlansModule } from '../employer-plans/employer-plans.module';

@Module({
  imports: [AuthModule, EmployerPlansModule],
  controllers: [BillingController],
  providers: [BillingService, ProductService, UsageService, PostHogService],
  exports: [BillingService, ProductService, UsageService],
})
export class BillingModule {}
