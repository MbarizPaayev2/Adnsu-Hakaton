import type { PrismaClient } from '@prisma/client';
import { canonicalizeUrl, normalizeCompany } from './job-dedup.util';

type JobDb = Pick<PrismaClient, 'job'>;

export interface BackfillBatch {
  /** Rows read in this batch. */
  scanned: number;
  /** Rows whose keys were written. */
  filled: number;
  /** Rows left alone because they changed between being read and being written (the importer got there first). */
  skipped: number;
  /** Cursor for the next batch (the last id read), or null when there was nothing to read. */
  lastId: string | null;
}

/**
 * Fills the comparison keys (companyKey, canonicalUrl) of postings that have none — those imported before
 * deduplication existed. It writes ONLY those two columns, never touches content, hashes, lifecycle, matches or
 * moderation, and never deletes a row.
 *
 * Safe next to the live importer: each write is conditional on the row STILL having no key AND still having the
 * company and url that were read, so a key derived from stale text can never overwrite what the importer wrote in
 * the meantime (such a row is counted as skipped and is picked up by the next run). Repeating it is harmless: a
 * row with a key is never selected again.
 */
export async function backfillDedupKeysBatch(db: JobDb, opts: { limit: number; afterId?: string | null }): Promise<BackfillBatch> {
  const rows = await db.job.findMany({
    where: { companyKey: null, ...(opts.afterId ? { id: { gt: opts.afterId } } : {}) },
    select: { id: true, company: true, url: true },
    orderBy: { id: 'asc' },
    take: opts.limit,
  });
  let filled = 0;
  for (const row of rows) {
    const written = await db.job.updateMany({
      where: { id: row.id, companyKey: null, company: row.company, url: row.url },
      data: { companyKey: normalizeCompany(row.company) || '-', canonicalUrl: canonicalizeUrl(row.url) },
    });
    filled += written.count;
  }
  return { scanned: rows.length, filled, skipped: rows.length - filled, lastId: rows.length ? rows[rows.length - 1].id : null };
}

export interface BackfillResult {
  filled: number;
  skipped: number;
  /** Rows still without keys when it stopped (new imports, or rows that kept changing). */
  remaining: number;
  passes: number;
}

/**
 * Runs the batch repeatedly until a pass finds nothing left to fill, at most `maxPasses` passes: a pass walks every
 * keyless row once, so a row that was skipped because it changed gets another attempt in the next pass, and a
 * row that never settles cannot make this loop forever.
 */
export async function backfillAllDedupKeys(
  db: JobDb,
  opts: { batchSize?: number; maxPasses?: number; onBatch?: (b: BackfillBatch & { pass: number }) => void } = {},
): Promise<BackfillResult> {
  const batchSize = opts.batchSize ?? 500;
  const maxPasses = opts.maxPasses ?? 3;
  let filled = 0;
  let skipped = 0;
  let passes = 0;
  while (passes < maxPasses) {
    passes++;
    let afterId: string | null = null;
    let passFilled = 0;
    let passSkipped = 0;
    for (;;) {
      const batch = await backfillDedupKeysBatch(db, { limit: batchSize, afterId });
      if (!batch.scanned) break;
      opts.onBatch?.({ ...batch, pass: passes });
      passFilled += batch.filled;
      passSkipped += batch.skipped;
      afterId = batch.lastId;
    }
    filled += passFilled;
    skipped += passSkipped;
    if (!passSkipped) break; // nothing was contested, so nothing is left to retry
  }
  const remaining = await db.job.count({ where: { companyKey: null } });
  return { filled, skipped, remaining, passes };
}
