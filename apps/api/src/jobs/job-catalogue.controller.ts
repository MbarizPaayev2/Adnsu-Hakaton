import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { JobCatalogueService, type CatalogueQuery } from './job-catalogue.service';
import { extractLinkedInJob, LinkedInAccessReviewRequiredError, LinkedInPublicAccessUnavailableError } from '../scrapers/public-jobs/linkedin-job.service';
import { parsePastedJobText } from '../scrapers/public-jobs/pasted-job.parser';

@Controller('jobs')
export class JobCatalogueController {
  constructor(private readonly catalogue: JobCatalogueService) {}

  @Get()
  list(@Query() query: CatalogueQuery) { return this.catalogue.list(query); }

  /** Extracts complete, structured vacancy data from a public LinkedIn job URL for candidates. */
  @Post('extract-url')
  @UseGuards(SessionAuthGuard)
  async extractUrl(@Body() body: { url: string }) {
    if (!body?.url || typeof body.url !== 'string') {
      throw new BadRequestException('Vakansiya URL-i tələb olunur');
    }
    try {
      const result = await extractLinkedInJob(body.url);
      return { success: true, job: result.job, method: result.method };
    } catch (error) {
      if (error instanceof LinkedInAccessReviewRequiredError || error instanceof LinkedInPublicAccessUnavailableError) {
        return { success: false, reason: error.code, message: error.message, fallback: 'paste-text' };
      }
      throw error;
    }
  }

  /** Parses candidate-provided job text in memory; it does not publish or persist a vacancy. */
  @Post('parse-text')
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  parseText(@Body() body: { text?: string; url?: string }) {
    if (!body || typeof body.text !== 'string') throw new BadRequestException('Vakansiya mətnini yapışdırın');
    return { success: true, job: parsePastedJobText(body.text, { sourceUrl: body.url }) };
  }

  /** The signed-in candidate's view of what a posting asks for versus what their profile already evidences. Read-only. */
  @Get(':kind/:id/skills')
  @UseGuards(SessionAuthGuard)
  skills(@GetUser('id') userId: string, @Param('kind') kind: string, @Param('id') id: string) { return this.catalogue.skillGuidance(userId, kind, id); }

  @Get(':kind/:id')
  detail(@Param('kind') kind: string, @Param('id') id: string) { return this.catalogue.detail(kind, id); }
}
