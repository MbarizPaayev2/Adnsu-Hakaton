/**
 * Read-only vacancy acquisition metrics from the database named by DATABASE_URL. Writes nothing to the database.
 *
 * Every "actionable" figure uses exactly actionableJobWhere() (jobs.service.ts): ACTIVE, not hidden, not linked as a duplicate, and no elapsed deadline.
 * That is the predicate behind the 1,505-posting / 300-employer baseline, so before/after snapshots are comparable.
 *
 *   npm run script:acquisition-metrics -- [--since <ISO time>] [--out snapshot.json] [--compare before.json]
 *   (in a released API container: node dist/scripts/report-acquisition-metrics.js …)
 *
 * --since   window start for "newly discovered/imported", "closed" and "expired" counts (default: 7 days ago).
 * --out     also write the JSON snapshot to this file (no candidate data: aggregate counts, source keys and employer names only).
 * --compare a snapshot written earlier by this script: prints net growth and the employers/regions/sources that are new or gone.
 *
 * Employers are counted by normalizeCompany() (the value stored in Job.companyKey), as in the baseline. Regions come from explicit place names
 * in the location (az-regions.ts); a location naming no settlement counts as unknown, not Bakı. Segments are heuristics on the posting's own words.
 */
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { actionableJobWhere } from '../jobs/jobs.service';
import { classifyLocation, ECONOMIC_REGIONS } from '../jobs/az-regions';
import { vacancySegments } from '../jobs/vacancy-segments';
import { normalizeCompany } from '../jobs/job-dedup.util';
import { describeEnvironment } from './report-source-coverage';

export interface AcquisitionSnapshot {
  generatedAt: string;
  environment: string;
  predicate: string;
  since: string;
  actionable: {
    postings: number;
    employers: number;
    emailBearing: number;
    emailEmployers: number;
    bySource: Record<string, { postings: number; employers: number; email: number }>;
    byRegion: Record<string, number>;
    byPlace: Record<string, number>;
    byExperience: Record<string, number>;
    bySegment: Record<string, number>;
    freshness: { postedWithin7d: number; postedWithin30d: number; postedOlder: number; seenWithin48h: number; seenOlder: number; withDeadline: number };
    employerNames: string[];
  };
  window: {
    ingested: number;
    ingestedActionable: number;
    ingestedDuplicateLinked: number;
    ingestedAlreadyExpired: number;
    ingestedEmailBearing: number;
    closed: number;
    closedByReason: Record<string, number>;
    deadlinePassed: number;
    newEmployersActionable: number;
  };
}

type Row = { externalId: string; company: string; location: string; title: string; description: string; postedAt: Date; lastSeenAt: Date; deadline: Date | null; applicationMethod: string; applicationEmail: string | null; experienceLevel: string | null };

const bump = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] ?? 0) + n; };
// The same normalisation that fills Job.companyKey (job-dedup.util.ts): the 300-employer baseline counts distinct companyKey values.
const employerKey = (company: string) => normalizeCompany(company) || company.trim().toLocaleLowerCase('tr');
const sourceOf = (externalId: string) => externalId.split(':')[0];
const isEmail = (r: Pick<Row, 'applicationMethod' | 'applicationEmail'>) => r.applicationMethod === 'EMAIL' && !!r.applicationEmail;

/** Pure aggregation, so the arithmetic is unit-tested without a database. */
export function summarize(actionable: Row[], window: { ingested: (Row & { status: string; hiddenAt: Date | null; duplicateOfId: string | null; ingestedAt: Date })[]; closed: { closedReason: string | null }[]; deadlinePassed: number; employersBefore: Set<string> }, now: Date, since: Date, environment: string): AcquisitionSnapshot {
  const day = 86_400_000;
  const employers = new Set<string>(), emailEmployers = new Set<string>(), names = new Map<string, string>();
  const bySource: AcquisitionSnapshot['actionable']['bySource'] = {};
  const sourceEmployers: Record<string, Set<string>> = {};
  const byRegion: Record<string, number> = Object.fromEntries([...ECONOMIC_REGIONS, 'unknown'].map((r) => [r, 0]));
  const byPlace: Record<string, number> = {}, byExperience: Record<string, number> = {}, bySegment: Record<string, number> = {};
  const freshness = { postedWithin7d: 0, postedWithin30d: 0, postedOlder: 0, seenWithin48h: 0, seenOlder: 0, withDeadline: 0 };
  let email = 0;
  for (const r of actionable) {
    const key = employerKey(r.company), src = sourceOf(r.externalId);
    employers.add(key); if (!names.has(key)) names.set(key, r.company.trim());
    bySource[src] ??= { postings: 0, employers: 0, email: 0 }; bySource[src].postings++;
    (sourceEmployers[src] ??= new Set()).add(key);
    if (isEmail(r)) { email++; emailEmployers.add(key); bySource[src].email++; }
    const loc = classifyLocation(r.location);
    bump(byRegion, loc.region ?? 'unknown'); bump(byPlace, loc.place ?? 'unknown');
    bump(byExperience, r.experienceLevel ?? 'unknown');
    for (const s of vacancySegments(r.title, r.description)) bump(bySegment, s);
    const age = now.getTime() - r.postedAt.getTime();
    if (age <= 7 * day) freshness.postedWithin7d++; else if (age <= 30 * day) freshness.postedWithin30d++; else freshness.postedOlder++;
    if (now.getTime() - r.lastSeenAt.getTime() <= 2 * day) freshness.seenWithin48h++; else freshness.seenOlder++;
    if (r.deadline) freshness.withDeadline++;
  }
  for (const [src, set] of Object.entries(sourceEmployers)) bySource[src].employers = set.size;
  const closedByReason: Record<string, number> = {};
  for (const c of window.closed) bump(closedByReason, c.closedReason ?? 'unspecified');
  const ing = window.ingested;
  const isActionableRow = (r: (typeof ing)[number]) => r.status === 'ACTIVE' && !r.hiddenAt && !r.duplicateOfId && (!r.deadline || r.deadline.getTime() >= now.getTime());
  return {
    generatedAt: now.toISOString(),
    environment,
    predicate: "status = 'ACTIVE' AND hiddenAt IS NULL AND duplicateOfId IS NULL AND (deadline IS NULL OR deadline >= now) — actionableJobWhere()",
    since: since.toISOString(),
    actionable: {
      postings: actionable.length, employers: employers.size, emailBearing: email, emailEmployers: emailEmployers.size,
      bySource: Object.fromEntries(Object.entries(bySource).sort((a, b) => b[1].postings - a[1].postings)),
      byRegion, byPlace: Object.fromEntries(Object.entries(byPlace).sort((a, b) => b[1] - a[1])), byExperience, bySegment, freshness,
      employerNames: [...names.values()].sort((a, b) => a.localeCompare(b, 'az')),
    },
    window: {
      ingested: ing.length,
      ingestedActionable: ing.filter(isActionableRow).length,
      ingestedDuplicateLinked: ing.filter((r) => r.duplicateOfId).length,
      ingestedAlreadyExpired: ing.filter((r) => r.deadline && r.deadline.getTime() < now.getTime()).length,
      ingestedEmailBearing: ing.filter((r) => isActionableRow(r) && isEmail(r)).length,
      closed: window.closed.length, closedByReason, deadlinePassed: window.deadlinePassed,
      newEmployersActionable: [...employers].filter((e) => !window.employersBefore.has(e)).length,
    },
  };
}

/** Before/after differences between two snapshots taken with this script (same predicate by construction). */
export function compareSnapshots(before: AcquisitionSnapshot, after: AcquisitionSnapshot) {
  const keys = (s: AcquisitionSnapshot) => new Set(s.actionable.employerNames.map(employerKey));
  const b = keys(before), a = keys(after);
  const regionDelta = Object.fromEntries([...new Set([...Object.keys(before.actionable.byRegion), ...Object.keys(after.actionable.byRegion)])].map((r) => [r, (after.actionable.byRegion[r] ?? 0) - (before.actionable.byRegion[r] ?? 0)]));
  const sources = new Set([...Object.keys(before.actionable.bySource), ...Object.keys(after.actionable.bySource)]);
  return {
    postings: { before: before.actionable.postings, after: after.actionable.postings, net: after.actionable.postings - before.actionable.postings },
    employers: { before: before.actionable.employers, after: after.actionable.employers, net: after.actionable.employers - before.actionable.employers, added: after.actionable.employerNames.filter((n) => !b.has(employerKey(n))), gone: before.actionable.employerNames.filter((n) => !a.has(employerKey(n))) },
    emailBearing: { before: before.actionable.emailBearing, after: after.actionable.emailBearing, net: after.actionable.emailBearing - before.actionable.emailBearing },
    regionsWithPostings: { before: ECONOMIC_REGIONS.filter((r) => before.actionable.byRegion[r]).length, after: ECONOMIC_REGIONS.filter((r) => after.actionable.byRegion[r]).length },
    regionDelta,
    sourceDelta: Object.fromEntries([...sources].map((s) => [s, (after.actionable.bySource[s]?.postings ?? 0) - (before.actionable.bySource[s]?.postings ?? 0)]).filter(([, d]) => d !== 0)),
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const now = new Date();
  const since = arg('--since') ? new Date(arg('--since')!) : new Date(now.getTime() - 7 * 86_400_000);
  if (Number.isNaN(since.getTime()) || since > now) throw new Error('--since must be a past ISO time');
  const env = describeEnvironment(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    const select = { externalId: true, company: true, location: true, title: true, description: true, postedAt: true, lastSeenAt: true, deadline: true, applicationMethod: true, applicationEmail: true, experienceLevel: true } as const;
    const actionable = await prisma.job.findMany({ where: actionableJobWhere(now), select });
    const ingested = await prisma.job.findMany({ where: { ingestedAt: { gte: since } }, select: { ...select, status: true, hiddenAt: true, duplicateOfId: true, ingestedAt: true } });
    const closed = await prisma.job.findMany({ where: { closedAt: { gte: since } }, select: { closedReason: true } });
    const deadlinePassed = await prisma.job.count({ where: { status: 'ACTIVE', hiddenAt: null, duplicateOfId: null, deadline: { gte: since, lt: now } } });
    // Employers that already had a posting ingested before the window, to count employers that are genuinely new to the catalogue.
    const earlier = await prisma.job.findMany({ where: { ingestedAt: { lt: since } }, select: { company: true }, distinct: ['company'] });
    const snapshot = summarize(actionable as Row[], { ingested: ingested as never, closed, deadlinePassed, employersBefore: new Set(earlier.map((e) => employerKey(e.company))) }, now, since, `${env.label}${env.isolated ? ' (ISOLATED, not production)' : ''}`);
    const out = arg('--out');
    if (out) fs.writeFileSync(out, JSON.stringify(snapshot, null, 1));
    const { employerNames, ...printable } = snapshot.actionable;
    console.log(JSON.stringify({ ...snapshot, actionable: { ...printable, employerNames: `${employerNames.length} names (in --out file)` } }, null, 1));
    const compare = arg('--compare');
    if (compare) console.log(JSON.stringify({ comparison: compareSnapshots(JSON.parse(fs.readFileSync(compare, 'utf8')), snapshot) }, null, 1));
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((e) => { console.error('Acquisition metrics failed:', e?.message); process.exitCode = 1; });
