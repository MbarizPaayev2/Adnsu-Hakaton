import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { PreferencesService } from './preferences.service';

@Controller()
export class AlertsController {
  constructor(private prefs: PreferencesService) {}

  @Get('notification-preferences') @UseGuards(SessionAuthGuard)
  get(@GetUser('id') userId: string) { return this.prefs.view(userId); }

  @Put('notification-preferences') @UseGuards(SessionAuthGuard)
  update(@GetUser('id') userId: string, @Body() body: Record<string, unknown>) { return this.prefs.update(userId, body ?? {}); }

  /** Public, idempotent. A valid signed token unsubscribes the account from non-essential e-mail; anything else is a 400 that reveals nothing. */
  @Get('notifications/unsubscribe')
  async unsubscribeLink(@Query('token') token: string) {
    if (!(await this.prefs.unsubscribeWithToken(token))) throw new BadRequestException('Bağlantı yanlışdır');
    return { unsubscribed: true };
  }

  /** RFC 8058 one-click (List-Unsubscribe-Post). */
  @Post('notifications/unsubscribe') @HttpCode(200)
  async unsubscribeOneClick(@Query('token') token: string) {
    if (!(await this.prefs.unsubscribeWithToken(token))) throw new BadRequestException('Bağlantı yanlışdır');
    return { unsubscribed: true };
  }
}
