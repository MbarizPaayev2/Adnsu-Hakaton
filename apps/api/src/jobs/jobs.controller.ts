import { BadRequestException, ConflictException, Controller, Get, Headers, Post, Body, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { COLLECTOR_KEYS } from '../scrapers/public-jobs/collector-registry';
import { extractLinkedInJob, LinkedInAccessReviewRequiredError, LinkedInPublicAccessUnavailableError } from '../scrapers/public-jobs/linkedin-job.service';
import { parsePastedJobText } from '../scrapers/public-jobs/pasted-job.parser';
import { PrismaService } from '../database/database.service';
import { JobsService } from './jobs.service';
import { JobSourceService } from './job-source.service';
import { ApiKeyGuard } from './api-key.guard';
import { IngestJobDto } from './dto/ingest-job.dto';
import { ImportRunReportDto } from './dto/import-run.dto';
import { ConfirmListedDto } from './dto/confirm-listed.dto';

export class SourceLeaseDto {
  @IsString() @Matches(/^[a-z][a-z0-9_-]{0,30}$/) source: string;
  @IsIn(['acquire', 'renew', 'release']) action: 'acquire' | 'renew' | 'release';
  /** The owner token (renew and release). */
  @IsOptional() @IsString() token?: string;
}

/** The header an importer sends with every write to a lease-managed source: the token it got from `source-lease`. */
export const LEASE_HEADER = 'x-source-lease';

@Controller('internal/jobs')
export class JobsController {
  constructor(private jobsService: JobsService, private sources: JobSourceService, private prisma: PrismaService) {}

  @Post('ingest')
  @UseGuards(ApiKeyGuard)
  async ingestJob(@Body() body: IngestJobDto, @Headers(LEASE_HEADER) lease?: string) {
    await this.sources.assertIngestable(body.externalId);
    await this.sources.assertLeaseHeld(body.externalId.split(':')[0], lease);
    const { job, outcome } = await this.jobsService.upsertJob(body);
    return {
      success: true,
      message: 'Job ingested and queued for matching',
      jobId: job.id,
      outcome,
    };
  }

  /** Refreshes lastSeenAt and reopens closed postings for jobs observed in listing without detail fetch. */
  @Post('confirm-listed')
  @UseGuards(ApiKeyGuard)
  async confirmListed(@Body() body: ConfirmListedDto, @Headers(LEASE_HEADER) lease?: string) {
    for (const externalId of body.externalIds) {
      await this.sources.assertIngestable(externalId);
      await this.sources.assertLeaseHeld(externalId.split(':')[0], lease);
    }
    const result = await this.jobsService.confirmListed(
      body.externalIds,
      body.listedAt ? new Date(body.listedAt) : new Date(),
    );
    return {
      success: true,
      ...result,
    };
  }

  /** One collector run summary (no job content); only a verified-complete one can close postings. */
  @Post('import-runs')
  @UseGuards(ApiKeyGuard)
  async recordImportRun(@Body() body: ImportRunReportDto, @Headers(LEASE_HEADER) lease?: string) {
    await this.sources.assertLeaseHeld(body.source, lease);
    return { success: true, ...(await this.sources.recordRun(body)) };
  }

  /**
   * Takes, renews or releases a source's lease for an out-of-process importer (the import CLI). Only reviewed public collectors, enabled and not restricted.
   * The same lease the scheduler and run-now use: while someone else holds it, `acquire` answers 409 and the importer must not collect.
   */
  @Post('source-lease')
  @UseGuards(ApiKeyGuard)
  async sourceLease(@Body() body: SourceLeaseDto) {
    if (!COLLECTOR_KEYS.includes(body.source)) throw new BadRequestException('Only a source with a reviewed collector has a lease');
    await this.sources.assertIngestable(`${body.source}:`);
    if (body.action === 'acquire') {
      const token = await this.sources.lease.acquire(body.source, 'cli');
      if (!token) {
        const holder = await this.sources.lease.describe(body.source);
        throw new ConflictException({ code: 'SOURCE_LEASE_HELD', message: `Source ${body.source} is being collected by another process (${holder?.holder ?? 'unknown'}) until ${holder?.until.toISOString() ?? '?'}` });
      }
      return { success: true, token };
    }
    if (!body.token) throw new BadRequestException('token is required');
    const ok = body.action === 'renew' ? await this.sources.lease.renew(body.source, body.token) : await this.sources.lease.release(body.source, body.token);
    if (!ok && body.action === 'renew') throw new ConflictException({ code: 'SOURCE_LEASE_LOST', message: 'The lease is no longer yours' });
    return { success: true, ok };
  }

  /** The externalIds already stored for a source: the importer's durable record of what it need not fetch again (no temp file). */
  @Get('known-ids')
  @UseGuards(ApiKeyGuard)
  async knownIds(@Query('source') source: string) {
    if (!COLLECTOR_KEYS.includes(source)) throw new BadRequestException('Unknown source');
    const rows = await this.prisma.job.findMany({ where: { externalId: { startsWith: `${source}:` } }, select: { externalId: true } });
    return { success: true, ids: rows.map((r) => r.externalId) };
  }

  /** Extracts complete, structured vacancy data from a public LinkedIn job URL. */
  @Post('extract-url')
  @UseGuards(ApiKeyGuard)
  async extractJobUrl(@Body() body: { url: string }) {
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

  /** Internal parser endpoint; text remains transient and is never ingested here. */
  @Post('parse-text')
  @UseGuards(ApiKeyGuard)
  parseJobText(@Body() body: { text?: string; url?: string }) {
    if (!body || typeof body.text !== 'string') throw new BadRequestException('Vakansiya mətnini yapışdırın');
    return { success: true, job: parsePastedJobText(body.text, { sourceUrl: body.url }) };
  }
}
