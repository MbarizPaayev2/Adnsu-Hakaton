/**
 * Fills the deduplication comparison keys (companyKey, canonicalUrl) of postings imported before deduplication
 * existed, so a posting from a second source can be recognised against them straight away. The hourly importer
 * does the same at the end of each run (500 rows per run); this does it all at once, right after a deploy.
 * It changes only those two columns — not content, hashes, lifecycle, matches, moderation or anything a
 * candidate sees — and never deletes a row. It is safe next to the running importer (each write is conditional
 * on the row being unchanged since it was read; see src/jobs/job-dedup-backfill.ts) and safe to repeat.
 *
 *   node dist/scripts/backfill-dedup-keys.js            # dry run: counts only
 *   node dist/scripts/backfill-dedup-keys.js --apply
 *
 * Bare Prisma client; reads DATABASE_URL from the environment.
 */
import { PrismaClient } from '@prisma/client';
import { backfillAllDedupKeys } from '../jobs/job-dedup-backfill';

async function main() {
  const apply = process.argv.includes('--apply');
  const unknown = process.argv.slice(2).filter((a) => a !== '--apply');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const prisma = new PrismaClient();
  try {
    const total = await prisma.job.count({ where: { companyKey: null } });
    console.log(`${total} posting(s) have no comparison keys yet.`);
    if (!apply) { console.log('Dry run: nothing changed. Re-run with --apply.'); return; }
    let batches = 0;
    const result = await backfillAllDedupKeys(prisma, { onBatch: () => { batches++; } });
    console.log(`Filled ${result.filled} posting(s) in ${batches} batch(es), ${result.passes} pass(es).`);
    if (result.skipped) console.log(`${result.skipped} posting(s) changed while being read and were retried or left for the next run.`);
    if (result.remaining) console.log(`${result.remaining} posting(s) still have no keys (newly imported, or changing right now): run again, or the hourly importer will fill them.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
