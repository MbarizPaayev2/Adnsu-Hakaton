import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AlertsModule } from '../alerts/alerts.module';
import { TelegramClient } from './telegram.client';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

@Module({ imports: [AuthModule, AlertsModule], controllers: [TelegramController], providers: [TelegramService, TelegramClient], exports: [TelegramService] })
export class TelegramModule {}
