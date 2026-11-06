import { Module } from '@nestjs/common';
import { BrowserSessionManagerService } from './browser-session-manager.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [SessionsController],
  providers: [SessionsService, BrowserSessionManagerService],
})
export class SessionsModule {}
