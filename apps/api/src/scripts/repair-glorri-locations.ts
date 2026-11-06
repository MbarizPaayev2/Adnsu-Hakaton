/**
 * Repairs Glorri jobs whose location is an employment type ("Tam ştat").
 *
 *   node dist/scripts/repair-glorri-locations.js                      # dry run (default): counts and ids only
 *   node dist/scripts/repair-glorri-locations.js --apply --undo-file ./undo.json
 *   node dist/scripts/repair-glorri-locations.js --rollback ./undo.json
 *
 * Changes `Job.location` only, from the source's own listing record, with a
 * compare-and-set per row and an undo file written BEFORE anything changes.
 * Does not touch matches, applications, attachments, lifecycle or moderation.
 * The importer will see the corrected location as a content change on its next
 * run and rescore those postings once. Uses a bare Prisma client (no Nest app,
 * no queue workers) and reads DATABASE_URL from the environment.
 */
import { PrismaClient } from '@prisma/client';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { applyLocationRepair, planLocationRepair, rollbackLocationRepair, type RepairStore, type UndoRecord } from '../jobs/glorri-location-repair';

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function bootstrap() {
  const apply = process.argv.includes('--apply');
  const undoFile = option('--undo-file');
  const rollbackFile = option('--rollback');
  if (apply && rollbackFile) throw new Error('Choose --apply or --rollback, not both');
  if (apply && !undoFile) throw new Error('--apply requires --undo-file <path> so the change can be reversed');
  if (apply && existsSync(undoFile!)) throw new Error(`${undoFile} already exists; refusing to overwrite an undo record`);

  const prisma = new PrismaClient();
  try {
    const store: RepairStore = {
      updateLocation: async (id, expected, next) => (await prisma.job.updateMany({ where: { id, location: expected }, data: { location: next } })).count === 1,
    };

    if (rollbackFile) {
      const records = JSON.parse(readFileSync(rollbackFile, 'utf8')) as UndoRecord[];
      const result = await rollbackLocationRepair(records, store);
      console.log(`Restored ${result.restored} of ${records.length} rows; ${result.skipped.length} left alone because their location changed since.`);
      return;
    }

    const rows = await prisma.job.findMany({
      where: { externalId: { startsWith: 'glorri:' } },
      select: { id: true, externalId: true, location: true, rawPayload: true },
    });
    const plan = planLocationRepair(rows);
    const byPlace = new Map<string, number>();
    for (const item of plan.items) byPlace.set(item.newLocation, (byPlace.get(item.newLocation) ?? 0) + 1);
    console.log(`${plan.items.length} job(s) qualify for repair; ${plan.skipped.length} employment-type location(s) cannot be repaired (left untouched).`);
    for (const [place, n] of [...byPlace.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)} -> ${place}`);
    for (const s of plan.skipped.slice(0, 20)) console.log(`  skipped ${s.id}: ${s.reason}`);

    if (!apply) {
      console.log('Dry run: nothing changed. Re-run with --apply --undo-file <path> to repair.');
      return;
    }
    if (!plan.items.length) {
      console.log('Nothing to repair; no undo record written.');
      return;
    }
    // The undo record is written (owner-only) before the first change.
    writeFileSync(undoFile!, JSON.stringify(plan.items.map((i) => ({ ...i, appliedAt: new Date().toISOString() })), null, 2), { mode: 0o600 });
    chmodSync(undoFile!, 0o600);
    const result = await applyLocationRepair(plan, store);
    // Keep only what actually changed as the authoritative undo record.
    writeFileSync(undoFile!, JSON.stringify(result.applied, null, 2), { mode: 0o600 });
    console.log(`Repaired ${result.applied.length} job(s); ${result.raced.length} changed under us and were skipped. Undo record: ${undoFile}`);
  } finally {
    await prisma.$disconnect();
  }
}

bootstrap().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
