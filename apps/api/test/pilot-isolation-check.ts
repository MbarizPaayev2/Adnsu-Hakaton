/**
 * Allowlist isolation and pause controls on a COPY of the production source registry (never production): with the scheduler enabled and one source scheduled,
 * only that source can be claimed; the global pause, the per-source pause, a cooldown and a lease each stop it. Uses the real SourceScheduler.
 *   DATABASE_URL=<private copy> SOURCE_SCHEDULE_ENABLED=true npx ts-node -r tsconfig-paths/register --transpile-only test/pilot-isolation-check.ts <source-key>
 */
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../src/database/database.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobSourceService } from '../src/jobs/job-source.service';
import { FeatureFlagsService } from '../src/operations/feature-flags.service';
import { SourceScheduler } from '../src/jobs/source-scheduler.service';

async function main() {
  const key = process.argv[2] || 'xsolla';
  if (!/aise_pilot_check/.test(process.env.DATABASE_URL || '')) throw new Error('Refusing: DATABASE_URL must be the private copy aise_pilot_check');
  const module = await Test.createTestingModule({
    providers: [PrismaService, JobsService, JobSourceService, FeatureFlagsService, SourceScheduler, { provide: getQueueToken('job-ingested'), useValue: { add: async () => ({}) } }],
  }).compile();
  const app = module.createNestApplication(); await app.init();
  const scheduler = module.get(SourceScheduler) as any, prisma = module.get(PrismaService), flags = module.get(FeatureFlagsService);
  const out: Record<string, unknown> = {};
  const claim = async () => { const c = await scheduler.claim(new Date()); if (c) await prisma.jobSource.update({ where: { key: c.key }, data: { leaseUntil: null, leaseOwner: null, leaseHeartbeatAt: null } }); return c ? c.key : null; };
  const scheduledNow = (await prisma.jobSource.findMany({ where: { scheduled: true }, select: { key: true } })).map((s) => s.key);
  out.scheduledInProductionCopy = scheduledNow;
  out.enabled = SourceScheduler.enabled();
  out.claimBeforeScheduling = await claim(); // nothing scheduled except glorri (own importer, excluded by the scheduler)
  await prisma.jobSource.update({ where: { key }, data: { scheduled: true, intervalMinutes: 1440, nextRunAt: null, schedulePausedAt: null } });
  out.claimWithOnlyPilotScheduled = [await claim(), await claim()]; // only the pilot, and only while due (claim does not advance nextRunAt, so it stays claimable here)
  // an unscheduled, enabled source with a collector is never claimed even if due
  out.otherSourcesClaimable = (await prisma.jobSource.findMany({ where: { key: { not: key }, scheduled: false, enabled: true, accessReview: { not: 'RESTRICTED' } }, select: { key: true } })).length;
  await flags.set('import.scheduled', true, 'isolation check', null);
  out.claimWhileGloballyPaused = (await scheduler.tick(new Date())).ran;
  await flags.set('import.scheduled', false, 'isolation check', null);
  await prisma.jobSource.update({ where: { key }, data: { schedulePausedAt: new Date() } });
  out.claimWhileSourcePaused = await claim();
  await prisma.jobSource.update({ where: { key }, data: { schedulePausedAt: null, cooldownUntil: new Date(Date.now() + 3600_000), cooldownReason: 'BLOCKED: test' } });
  out.claimDuringCooldown = await claim();
  await prisma.jobSource.update({ where: { key }, data: { cooldownUntil: null, cooldownReason: null, leaseUntil: new Date(Date.now() + 3600_000), leaseOwner: 'someone-else' } });
  out.claimWhileLeasedElsewhere = await claim();
  console.log(JSON.stringify(out, null, 1));
  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
