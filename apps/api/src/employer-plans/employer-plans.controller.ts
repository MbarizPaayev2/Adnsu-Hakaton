import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { BusinessAuthGuard } from '../business/business-auth.guard';
import { GetBusiness } from '../business/get-business.decorator';
import { EmployerPlansService } from './employer-plans.service';

class SingleCheckoutDto {
  // A client-generated key: pressing the button twice, or retrying after an unknown answer, returns the same purchase.
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,80}$/) idempotencyKey!: string;
  @IsOptional() @IsString() @Length(1, 40) vacancyId?: string;
}

const THROTTLE = { default: { limit: 20, ttl: 60_000 } };

@Controller('business/plans')
@UseGuards(BusinessAuthGuard)
export class EmployerPlansController {
  constructor(private readonly plans: EmployerPlansService) {}

  @Get()
  overview(@GetBusiness() business: any) { return this.plans.overview(business.company.id); }

  @Post('checkout/single') @HttpCode(200) @Throttle(THROTTLE)
  single(@GetBusiness() business: any, @Body() dto: SingleCheckoutDto) { return this.plans.startSingleCheckout(business, dto.idempotencyKey, dto.vacancyId); }

  @Post('checkout/business') @HttpCode(200) @Throttle(THROTTLE)
  businessCheckout(@GetBusiness() business: any) { return this.plans.startBusinessCheckout(business); }

  @Post('portal') @HttpCode(200) @Throttle(THROTTLE)
  portal(@GetBusiness() business: any) { return this.plans.portalSession(business.company.id); }

  @Post('vacancies/:id/submit') @HttpCode(200)
  submit(@GetBusiness() business: any, @Param('id') id: string) { return this.plans.submitForReview(business.company.id, id); }

  @Post('vacancies/:id/publish') @HttpCode(200) @Throttle(THROTTLE)
  publish(@GetBusiness() business: any, @Param('id') id: string) { return this.plans.publish(business.company.id, id); }

  @Post('vacancies/:id/extend') @HttpCode(200) @Throttle(THROTTLE)
  extend(@GetBusiness() business: any, @Param('id') id: string) { return this.plans.extend(business.company.id, id); }

  @Post('vacancies/:id/reconfirm') @HttpCode(200)
  reconfirm(@GetBusiness() business: any, @Param('id') id: string) { return this.plans.reconfirm(business.company.id, id); }
}
