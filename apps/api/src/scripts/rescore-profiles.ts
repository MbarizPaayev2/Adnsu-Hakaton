/**
 * Queues a throttled, serial, replay-safe re-score of existing candidate profiles, e.g. after a new
 * scorer goes live. Policy and guarantees: src/matching/rescore.ts. Runs on the API's own worker.
 *
 *   node dist/scripts/rescore-profiles.js --rollout <name>                       # dry run: who, how long, what already exists
 *   node dist/scripts/rescore-profiles.js --apply --rollout <name> --silent --user <id>
 *   node dist/scripts/rescore-profiles.js --apply --rollout <name> --silent --all [--spacing-seconds 120]
 *   node dist/scripts/rescore-profiles.js --apply --rollout <name> --silent --all --retry-failed
 *
 * --silent: matches are stored and shown in the app, but nothing is emailed or announced because of this
 * rollout (marker Match.suppressedRollout; notifiedAt is never faked). --notify keeps the normal rules.
 * Existing matches are refreshed in place; new matches obey each plan's monthly quota (a silent match still
 * uses one) and are created best-first. Usage and quotas are never reset. Uses bare Prisma and BullMQ
 * clients (no Nest app, no workers here). Reads DATABASE_URL, REDIS_HOST, REDIS_PORT from the environment.
 */
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { enqueueRollout, parseRescoreArgs, RESCORE_QUEUE, rolloutStatus } from '../matching/rescore';

async function main() {
  const args = parseRescoreArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const profiles = await prisma.profile.findMany({
      where: { onboardingCompletedAt: { not: null }, ...(args.user ? { userId: args.user } : {}) },
      select: { userId: true },
      orderBy: { createdAt: 'asc' },
    });
    const userIds = profiles.map((p) => p.userId);
    console.log(`${userIds.length} completed profile(s); one at a time, at least ${args.spacingSeconds}s each: about ${Math.ceil((userIds.length * args.spacingSeconds) / 60)} minute(s).`);
    const queue = new Queue(RESCORE_QUEUE, {
      connection: { host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT || '6379', 10) },
    });
    try {
      if (!args.apply) {
        if (args.rollout) console.log(`Rollout "${args.rollout}" today, by job state:`, JSON.stringify(await rolloutStatus(queue, args.rollout, userIds)));
        console.log('Dry run: nothing queued. Add --apply --rollout <name> --silent|--notify and --user <id> or --all.');
        return;
      }
      const report = await enqueueRollout(queue, {
        rollout: args.rollout!, userIds, silent: !!args.silent, spacingSeconds: args.spacingSeconds, retryFailed: args.retryFailed,
      });
      console.log(`Rollout "${args.rollout}" (${args.silent ? 'silent' : 'normal notifications'}): added ${report.added}, retried ${report.retried}, already had a job: ${JSON.stringify(report.existing)}.`);
      console.log('Completed and in-progress profiles are never re-run by repeating this command; use --retry-failed for failed ones, or a new --rollout name for a deliberate new pass.');
    } finally {
      await queue.close();
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
