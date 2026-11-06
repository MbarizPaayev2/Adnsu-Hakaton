import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { TimelineService } from './timeline.service';

@Controller('applications')
@UseGuards(SessionAuthGuard)
export class TimelineController {
  constructor(private timeline: TimelineService) {}

  /** All of the caller's applications (e-mail, native, external) as stages with the evidence behind each. */
  @Get('timeline') list(@GetUser('id') userId: string) { return this.timeline.timeline(userId); }

  /** Candidate-entered outcome for a native or external application (e-mail applications use PATCH /email-applications/:id/status). */
  @Post(':channel/:id/outcome') report(@GetUser('id') userId: string, @Param('channel') channel: string, @Param('id') id: string, @Body() body: any) { return this.timeline.reportOutcome(userId, channel, id, body); }
}
