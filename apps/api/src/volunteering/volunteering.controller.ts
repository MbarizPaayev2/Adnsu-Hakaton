import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { VolunteeringService } from './volunteering.service';
import { CreateVolunteerOpportunityDto } from './dto/create-volunteer-opportunity.dto';
import { UpdateVolunteerOpportunityStatusDto } from './dto/update-volunteer-opportunity-status.dto';
import { BusinessAuthGuard } from '../business/business-auth.guard';
import { GetBusiness } from '../business/get-business.decorator';

@Controller()
export class VolunteeringController {
  constructor(private readonly volunteeringService: VolunteeringService) {}

  @Get('volunteer-opportunities')
  async findAllPublic() {
    return this.volunteeringService.findAllPublic();
  }

  @Post('business/volunteer-opportunities')
  @UseGuards(BusinessAuthGuard)
  async create(@GetBusiness() business: any, @Body() dto: CreateVolunteerOpportunityDto) {
    return this.volunteeringService.create(business, dto);
  }

  @Get('business/volunteer-opportunities')
  @UseGuards(BusinessAuthGuard)
  async findAllOwn(@GetBusiness() business: any) {
    return this.volunteeringService.findAllOwn(business.company.id);
  }

  @Patch('business/volunteer-opportunities/:id/status')
  @UseGuards(BusinessAuthGuard)
  async updateStatus(
    @GetBusiness() business: any,
    @Param('id') id: string,
    @Body() dto: UpdateVolunteerOpportunityStatusDto,
  ) {
    return this.volunteeringService.updateStatus(id, business.company.id, dto.status);
  }
}
