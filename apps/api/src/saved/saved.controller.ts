import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { SavedService } from './saved.service';

@Controller()
@UseGuards(SessionAuthGuard)
export class SavedController {
  constructor(private saved: SavedService) {}

  @Get('saved-jobs') listJobs(@GetUser('id') userId: string) { return this.saved.listJobs(userId); }
  /** ref = "imported:<id>" or "native:<id>" (the catalogue's `kind` and `id`). Idempotent. */
  @Put('saved-jobs/:ref') saveJob(@GetUser('id') userId: string, @Param('ref') ref: string) { return this.saved.saveJob(userId, ref); }
  @Delete('saved-jobs/:ref') @HttpCode(200) unsaveJob(@GetUser('id') userId: string, @Param('ref') ref: string) { return this.saved.unsaveJob(userId, ref); }

  @Get('saved-searches') listSearches(@GetUser('id') userId: string) { return this.saved.listSearches(userId); }
  @Post('saved-searches') createSearch(@GetUser('id') userId: string, @Body() body: any) { return this.saved.createSearch(userId, body); }
  @Patch('saved-searches/:id') updateSearch(@GetUser('id') userId: string, @Param('id') id: string, @Body() body: any) { return this.saved.updateSearch(userId, id, body); }
  @Delete('saved-searches/:id') @HttpCode(200) deleteSearch(@GetUser('id') userId: string, @Param('id') id: string) { return this.saved.deleteSearch(userId, id); }

  @Get('company-follows') listFollows(@GetUser('id') userId: string) { return this.saved.listFollows(userId); }
  /** Body: {company: "name"} or {ref: "imported:<id>" | "native:<id>"}. Idempotent per canonical company. */
  @Put('company-follows') follow(@GetUser('id') userId: string, @Body() body: any) { return this.saved.follow(userId, body); }
  @Delete('company-follows/:id') @HttpCode(200) unfollow(@GetUser('id') userId: string, @Param('id') id: string) { return this.saved.unfollow(userId, id); }
}
