import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { CareerEntriesService } from './career-entries.service';
import { CreateCareerEntryDto, ReviewCareerEntriesDto, UpdateCareerEntryDto } from './career-entries.dto';

/** Career evidence beyond jobs and degrees. Owner-only; nothing here sends or publishes anything. */
@Controller('profile/career-entries')
@UseGuards(SessionAuthGuard)
export class CareerEntriesController {
  constructor(private entries: CareerEntriesService) {}

  @Get() list(@GetUser('id') userId: string, @Query('status') status?: string, @Query('kind') kind?: string) {
    return this.entries.list(userId, { status: ['SUGGESTED', 'CONFIRMED', 'HIDDEN'].includes(status ?? '') ? status : undefined, kind });
  }
  @Post() create(@GetUser('id') userId: string, @Body() dto: CreateCareerEntryDto) { return this.entries.create(userId, dto); }
  @Post('review') review(@GetUser('id') userId: string, @Body() dto: ReviewCareerEntriesDto) { return this.entries.review(userId, dto); }
  @Patch(':id') update(@GetUser('id') userId: string, @Param('id') id: string, @Body() dto: UpdateCareerEntryDto) { return this.entries.update(userId, id, dto); }
  @Post(':id/confirm') confirm(@GetUser('id') userId: string, @Param('id') id: string) { return this.entries.confirm(userId, id); }
  @Post(':id/hide') hide(@GetUser('id') userId: string, @Param('id') id: string) { return this.entries.hide(userId, id); }
  @Post(':id/restore') restore(@GetUser('id') userId: string, @Param('id') id: string) { return this.entries.restore(userId, id); }
  @Delete(':id') remove(@GetUser('id') userId: string, @Param('id') id: string) { return this.entries.remove(userId, id); }
}
