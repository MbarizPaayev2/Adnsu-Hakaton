import { Controller, Delete, Get, HttpCode, Post, Req, Headers, NotFoundException, UnauthorizedException, UseGuards, Body } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { TelegramService } from './telegram.service';
import { secretMatches, telegramConfig } from './telegram.config';

@Controller()
export class TelegramController {
  constructor(private telegram: TelegramService) {}

  @Get('telegram') @UseGuards(SessionAuthGuard)
  status(@GetUser('id') userId: string) { return this.telegram.status(userId); }

  /** 503 while the adapter is disabled. The deep link opens the bot with a single-use token; nothing is sent from here. */
  @Post('telegram/link-token') @UseGuards(SessionAuthGuard) @HttpCode(200)
  linkToken(@GetUser('id') userId: string) { return this.telegram.createLinkToken(userId); }

  @Post('telegram/pause') @UseGuards(SessionAuthGuard) @HttpCode(200)
  pause(@GetUser('id') userId: string) { return this.telegram.setPaused(userId, true); }

  @Post('telegram/resume') @UseGuards(SessionAuthGuard) @HttpCode(200)
  resume(@GetUser('id') userId: string) { return this.telegram.setPaused(userId, false); }

  @Delete('telegram') @UseGuards(SessionAuthGuard) @HttpCode(200)
  disconnect(@GetUser('id') userId: string) { return this.telegram.disconnect(userId); }

  /** Telegram's webhook: authenticated by X-Telegram-Bot-Api-Secret-Token; 404 while disabled so it reveals nothing. */
  @Post('webhooks/telegram') @HttpCode(200)
  async webhook(@Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() body: unknown) {
    const cfg = telegramConfig();
    if (!cfg.enabled) throw new NotFoundException();
    if (!secretMatches(secret, cfg.secret)) throw new UnauthorizedException();
    return this.telegram.handleUpdate(body);
  }
}
