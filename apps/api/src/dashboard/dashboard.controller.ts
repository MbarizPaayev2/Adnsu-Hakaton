import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';

@Controller('dashboard')
@UseGuards(SessionAuthGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('summary')
  async getSummary(@GetUser('id') userId: string) {
    return this.dashboardService.getSummary(userId);
  }
}
