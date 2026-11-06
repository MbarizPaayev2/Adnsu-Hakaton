import { isEmploymentTypeLabel, foldText, usableLocation } from './job-location.util';

/**
 * Repair for Glorri postings whose `Job.location` holds an employment type
 * ("Tam ştat") because the detail page's bullet list was read by position.
 *
 * Narrow by construction. A row is repaired only when ALL of these hold:
 *   - it came from the Glorri importer (`externalId` starts with `glorri:`);
 *   - its stored location is an employment-type label;
 *   - the source's own detail block says the same thing (`detail.location`
 *     equals that label), i.e. the misplacement came from the detail parse;
 *   - the listing record (`rawPayload.location`) carries a real place.
 * Only `location` changes, to that listing value. Nothing is guessed, the
 * original source record (`rawPayload`) is untouched, and every change is
 * recorded in an undo file so it can be reversed row by row.
 */
export interface RepairCandidateRow {
  id: string;
  externalId: string;
  location: string;
  rawPayload: unknown;
}

export interface RepairPlanItem {
  id: string;
  externalId: string;
  previousLocation: string;
  newLocation: string;
}

export interface RepairPlan {
  items: RepairPlanItem[];
  /** Rows with an employment-type location that could NOT be repaired, with why. */
  skipped: { id: string; externalId: string; reason: string }[];
}

export function planLocationRepair(rows: RepairCandidateRow[]): RepairPlan {
  const items: RepairPlanItem[] = [];
  const skipped: RepairPlan['skipped'] = [];
  for (const row of rows) {
    if (!row.externalId.startsWith('glorri:')) continue;
    if (!isEmploymentTypeLabel(row.location)) continue;
    const raw = (row.rawPayload ?? {}) as { location?: unknown; detail?: { location?: unknown } | null };
    const detailLocation = typeof raw.detail?.location === 'string' ? raw.detail.location : null;
    if (detailLocation === null || foldText(detailLocation) !== foldText(row.location)) {
      skipped.push({ id: row.id, externalId: row.externalId, reason: 'source detail does not show the misplacement' });
      continue;
    }
    const listing = typeof raw.location === 'string' ? usableLocation(raw.location) : null;
    if (!listing) {
      skipped.push({ id: row.id, externalId: row.externalId, reason: 'no trustworthy location in the listing record' });
      continue;
    }
    items.push({ id: row.id, externalId: row.externalId, previousLocation: row.location, newLocation: listing });
  }
  return { items, skipped };
}

export interface UndoRecord extends RepairPlanItem {
  appliedAt: string;
}

export interface RepairStore {
  /** Compare-and-set: change `location` only when it still equals `expected`. */
  updateLocation(id: string, expected: string, next: string): Promise<boolean>;
}

/** Applies a plan; a row changed by the importer in the meantime is left alone. */
export async function applyLocationRepair(plan: RepairPlan, store: RepairStore, now = new Date()): Promise<{ applied: UndoRecord[]; raced: string[] }> {
  const applied: UndoRecord[] = [];
  const raced: string[] = [];
  for (const item of plan.items) {
    if (await store.updateLocation(item.id, item.previousLocation, item.newLocation)) applied.push({ ...item, appliedAt: now.toISOString() });
    else raced.push(item.id);
  }
  return { applied, raced };
}

/** Reverses recorded changes; a row whose location moved on since is left alone. */
export async function rollbackLocationRepair(records: UndoRecord[], store: RepairStore): Promise<{ restored: number; skipped: string[] }> {
  let restored = 0;
  const skipped: string[] = [];
  for (const record of records) {
    if (await store.updateLocation(record.id, record.newLocation, record.previousLocation)) restored++;
    else skipped.push(record.id);
  }
  return { restored, skipped };
}
