import { Controller, Get, Patch, Post, Param, Body, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { SetReadDto } from './dto/set-read.dto';

@Controller('notifications')
@UseGuards(SessionAuthGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  async getNotifications(@GetUser('id') userId: string) {
    return this.notificationsService.getNotifications(userId);
  }

  @Patch(':id')
  async setRead(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: SetReadDto,
  ) {
    return this.notificationsService.setRead(userId, id, body.read ?? true);
  }

  @Patch(':id/read')
  async markAsRead(
    @GetUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.notificationsService.setRead(userId, id, true);
  }

  @Post('mark-all-read')
  async markAllRead(@GetUser('id') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }
}
