import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../database/database.service';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash } from 'crypto';
import { Prisma, type Job } from '@prisma/client';
import { IngestJobDto } from './dto/ingest-job.dto';
import { backfillDedupKeysBatch } from './job-dedup-backfill';
import { deriveJobFacts } from './job-facts';
import { canonicalizeUrl, compareJobs, normalizeCompany, sourceOf, type DedupJob } from './job-dedup.util';

export type IngestOutcome = 'created' | 'updated' | 'reopened' | 'unchanged';

/**
 * Uses the last confirmed lifecycle state and known deadline (not a live
 * source check), and excludes listings an operator has hidden and postings
 * linked as a duplicate of another open listing (see job-dedup.util.ts).
 */
export function isJobActionable(job: Pick<Job, 'status' | 'deadline'> & { hiddenAt?: Date | null; duplicateOfId?: string | null }, now = new Date()): boolean {
  return job.status === 'ACTIVE' && !job.hiddenAt && !job.duplicateOfId && (!job.deadline || job.deadline.getTime() >= now.getTime());
}

/** Prisma filter equivalent of isJobActionable. */
export function actionableJobWhere(now = new Date()) {
  return { status: 'ACTIVE' as const, hiddenAt: null, duplicateOfId: null, OR: [{ deadline: null }, { deadline: { gte: now } }] };
}

// Listing-activity fields that change without the posting changing (Glorri's
// running view counter, whether the ad is currently promoted). Hashing them
// would mark every job "updated" and re-queue matching on every import.
const VOLATILE_PAYLOAD_KEYS = new Set(['viewCount', 'isProAd']);

function stablePayload(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw ?? {}).filter(([key]) => !VOLATILE_PAYLOAD_KEYS.has(key)));
}

function contentHash(dto: IngestJobDto): string {
  const fields = [dto.title, dto.company, dto.description, dto.location, dto.url, new Date(dto.postedAt).toISOString(), dto.deadline ?? '', stablePayload(dto.rawPayload)];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

@Injectable()
export class JobsService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('job-ingested') private jobQueue: Queue,
    // New-job alerts fan out from here (alerts/alerts.service.ts). Optional so callers that never alert need no queue.
    @Optional() @InjectQueue('new-job-alert') private alertQueue?: Queue,
  ) {}

  // The HTTP path (jobs.controller.ts) is validated by the global
  // ValidationPipe against IngestJobDto, but in-process callers (e.g.
  // GlorriScraperService) call this method directly and bypass that pipe —
  // validate here too so malformed/oversized data can never reach Prisma
  // regardless of caller.
  async ingestJob(data: any): Promise<Job> {
    return (await this.upsertJob(data)).job;
  }

  /**
   * Creates or refreshes a job seen in its source listing. Queue deduplication
   * suppresses unchanged work for a day, while retrying a failed enqueue
   * even when the database already contains the imported content.
   */
  async upsertJob(data: any, seenAt = new Date()): Promise<{ job: Job; outcome: IngestOutcome }> {
    const dto = plainToInstance(IngestJobDto, data);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
    if (errors.length) {
      throw new BadRequestException(`Invalid job payload: ${errors.map((e) => e.toString()).join('; ')}`);
    }

    // Whatever the source or caller: a posting cannot have been published in the future.
    if (new Date(dto.postedAt).getTime() > seenAt.getTime() + 86_400_000) throw new BadRequestException('Invalid job payload: postedAt is in the future');
    const existing = await this.prisma.job.findUnique({ where: { externalId: dto.externalId } });
    // Employer pages without a publication date use the first observation. A later refresh must not make an old vacancy look newly published.
    if (dto.rawPayload?.postedAtBasis === 'first-observed' && existing) dto.postedAt = existing.postedAt.toISOString();
    const hash = contentHash(dto);
    const content = {
      title: dto.title,
      company: dto.company,
      description: dto.description,
      location: dto.location,
      url: dto.url,
      postedAt: new Date(dto.postedAt),
      deadline: dto.deadline ? new Date(dto.deadline) : null,
      rawPayload: dto.rawPayload || {},
      contentHash: hash,
      contentUpdatedAt: seenAt,
      canonicalUrl: canonicalizeUrl(dto.url),
      companyKey: normalizeCompany(dto.company) || null,
      ...(dto.detailFetchedAt ? { detailFetchedAt: new Date(dto.detailFetchedAt) } : {}),
    };
    // Derived from the same content (so a changed posting re-derives them), and
    // refreshed on every sighting so an improved extractor reaches old rows.
    const facts = deriveJobFacts({ title: dto.title, description: dto.description, rawPayload: dto.rawPayload });
    const seen = { lastSeenAt: seenAt, missedImports: 0, ...facts, applicationEmailEvidence: facts.applicationEmailEvidence ? (facts.applicationEmailEvidence as unknown as Prisma.InputJsonObject) : Prisma.DbNull };

    let job: Job;
    let outcome: IngestOutcome;
    if (!existing) {
      try {
        job = await this.prisma.job.create({ data: { externalId: dto.externalId, ...content, ...seen } });
        outcome = 'created';
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return this.upsertJob(data, seenAt);
        }
        throw error;
      }
    } else {
      // An older overlapping import must not replace more recently observed facts.
      if (existing.lastSeenAt > seenAt) return { job: existing, outcome: 'unchanged' };
      const reopened = existing.status === 'CLOSED';
      const changed = existing.contentHash !== hash;
      const updated = await this.prisma.job.updateMany({
        where: { id: existing.id, lastSeenAt: { lte: seenAt } },
        data: {
          ...seen,
          ...(changed ? content : dto.detailFetchedAt ? { detailFetchedAt: content.detailFetchedAt } : {}),
          ...(reopened ? { status: 'ACTIVE', closedAt: null, closedReason: null, contentUpdatedAt: seenAt } : {}),
        },
      });
      job = await this.prisma.job.findUniqueOrThrow({ where: { id: existing.id } });
      if (!updated.count) return { job, outcome: 'unchanged' };
      outcome = reopened ? 'reopened' : changed ? 'updated' : 'unchanged';
    }

    // Cross-source duplicates are linked (never deleted) before matching is queued,
    // so a posting another source already lists is not scored and mailed twice.
    if (outcome === 'created' || outcome === 'updated' || outcome === 'reopened') job = await this.linkDuplicate(job);

    await this.enqueueMatching(job, seenAt);
    // A posting that is new (or came back) and is itself visible, not a linked duplicate of one already announced, may alert people who saved a
    // matching search or follow its company. The fan-out re-checks everything and deduplicates per user.
    if ((outcome === 'created' || outcome === 'reopened') && isJobActionable(job)) {
      await this.alertQueue?.add('fan-out', { jobId: job.id }, { jobId: `alert-job-${job.id}-${job.contentUpdatedAt.getTime()}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { age: 86_400, count: 10000 }, removeOnFail: { age: 86_400, count: 10000 } }).catch(() => undefined);
    }
    return { job, outcome };
  }

  private async enqueueMatching(job: Job, seenAt: Date): Promise<void> {
    if (!isJobActionable(job)) return;
    await this.jobQueue.add('process-match', { jobId: job.id }, {
      jobId: `${job.id}-${job.contentHash}-${job.contentUpdatedAt.getTime()}-${Math.floor(seenAt.getTime() / 86400000)}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 10000 },
      removeOnFail: { age: 24 * 60 * 60, count: 10000 },
    });
  }

  private toDedupJob(job: Job): DedupJob {
    return { externalId: job.externalId, title: job.title, company: job.company, location: job.location, description: job.description, url: job.url, postedAt: job.postedAt };
  }

  /**
   * Links `job` to an earlier, open posting from ANOTHER source that repeats it
   * (see compareJobs for the conservative rules), or clears a link that no
   * longer holds. Only `duplicateOfId`/`duplicateReason` change: the row, its
   * matches, applications and attachments stay.
   */
  private async linkDuplicate(job: Job): Promise<Job> {
    let primary: Job | null = null;
    let reason: string | null = null;
    if (job.companyKey) {
      const candidates = await this.prisma.job.findMany({
        where: {
          id: { not: job.id },
          companyKey: job.companyKey,
          status: 'ACTIVE',
          hiddenAt: null,
          duplicateOfId: null,
          externalId: { not: { startsWith: `${sourceOf(job.externalId)}:` } },
          ingestedAt: { lte: job.ingestedAt },
        },
        orderBy: { ingestedAt: 'asc' },
        take: 50,
      });
      for (const candidate of candidates) {
        const verdict = compareJobs(this.toDedupJob(job), this.toDedupJob(candidate));
        if (verdict?.autoLink) {
          primary = candidate;
          reason = `${verdict.kind}: ${verdict.reason} (text similarity ${verdict.similarity.toFixed(2)})`;
          break;
        }
      }
    }
    const nextId = primary?.id ?? null;
    if ((job.duplicateOfId ?? null) === nextId) return job;
    return this.prisma.job.update({ where: { id: job.id }, data: { duplicateOfId: nextId, duplicateReason: reason } });
  }

  /**
   * A duplicate only stays hidden while the posting it repeats is open and
   * visible. When that primary closes or an operator hides it, the duplicate
   * stands in for it again and is queued for matching. Idempotent.
   */
  async releaseOrphanedDuplicates(now = new Date()): Promise<number> {
    const orphaned = await this.prisma.job.findMany({
      where: { duplicateOfId: { not: null }, duplicateOf: { OR: [{ status: 'CLOSED' }, { hiddenAt: { not: null } }] } },
      select: { id: true },
    });
    if (!orphaned.length) return 0;
    const ids = orphaned.map((o) => o.id);
    await this.prisma.job.updateMany({ where: { id: { in: ids } }, data: { duplicateOfId: null, duplicateReason: null } });
    for (const released of await this.prisma.job.findMany({ where: { id: { in: ids } } })) await this.enqueueMatching(released, now);
    return ids.length;
  }

  /**
   * Fills the comparison keys of postings imported before deduplication existed: one batch per call, guarded so it
   * cannot overwrite what a concurrent import wrote (see job-dedup-backfill.ts). No content change.
   * Returns how many postings it filled.
   */
  async backfillDedupKeys(limit = 500): Promise<number> {
    return (await backfillDedupKeysBatch(this.prisma, { limit })).filled;
  }

  /**
   * Refreshes lastSeenAt and resets missedImports for already-ACTIVE jobs observed in current listings
   * without re-downloading unchanged detail HTML.
   *
   * Reopens CLOSED postings ONLY when:
   *   - They were closed by the crawler reconciliation (closedReason === 'source_removed_from_complete_listing'),
   *   - They are NOT manually closed or moderated (hiddenAt is null),
   *   - They are NOT expired (deadline is null or in the future: deadline >= seenAt),
   *   - They are NOT a linked duplicate of another primary posting (duplicateOfId is null),
   *   - The observation timestamp is newer than or equal to lastSeenAt.
   *
   * Accurately counts distinct active and reopened postings without double-counting.
   */
  async confirmListed(externalIds: string[], seenAt = new Date()): Promise<{ confirmed: number; reopened: number }> {
    if (!externalIds.length) return { confirmed: 0, reopened: 0 };

    if (seenAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('Observation timestamp cannot be in the future');
    }

    // 1. Update already-ACTIVE postings first
    const active = await this.prisma.job.updateMany({
      where: {
        externalId: { in: externalIds },
        status: 'ACTIVE',
        lastSeenAt: { lte: seenAt },
      },
      data: {
        lastSeenAt: seenAt,
        missedImports: 0,
      },
    });

    // 2. Reopen eligible CLOSED postings (strictly mutually exclusive from active)
    const reopened = await this.prisma.job.updateMany({
      where: {
        externalId: { in: externalIds },
        status: 'CLOSED',
        closedReason: 'source_removed_from_complete_listing',
        hiddenAt: null,
        duplicateOfId: null,
        lastSeenAt: { lte: seenAt },
        OR: [
          { deadline: null },
          { deadline: { gte: seenAt } },
        ],
      },
      data: {
        status: 'ACTIVE',
        closedAt: null,
        closedReason: null,
        lastSeenAt: seenAt,
        missedImports: 0,
      },
    });

    return {
      confirmed: active.count + reopened.count,
      reopened: reopened.count,
    };
  }
}
