import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InstitutionEnquiryDto } from './institution-enquiry.dto';
import { InstitutionsService } from './institutions.service';

@Controller('institutions')
export class InstitutionsController {
  constructor(private institutions: InstitutionsService) {}

  /** Public pilot enquiry form. Rate-limited; stores the enquiry and notifies the team. */
  @Post('enquiries')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  enquire(@Body() body: InstitutionEnquiryDto) {
    return this.institutions.enquire(body);
  }
}
