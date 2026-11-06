import type { Queue } from 'bullmq';

/**
 * Re-scoring rollouts: re-score existing candidate profiles after the scorer changes,
 * one profile at a time, replay-safe, and (optionally) without announcing anything.
 *
 * Replay policy. A rollout has a name (`--rollout`). Its jobs are kept in the queue
 * after they finish (completed AND failed), keyed `rescore-<rollout>-<userId>`:
 *  - running the same rollout again adds nothing for a profile that already has a job,
 *    whatever state it is in (waiting, running, completed, failed) — so completed
 *    profiles are never re-run;
 *  - a failed profile is retried only when asked (`--retry-failed`), through the same
 *    serial worker;
 *  - a deliberate new rollout is a new name, which is how it is told apart from a replay.
 * Execution is serial: the queue has global concurrency 1 and its worker concurrency 1,
 * and each job holds its slot for at least the rollout's spacing, so delays, overdue jobs
 * and retries can never overlap.
 */
export const RESCORE_QUEUE = 'profile-rescore';

const ROLLOUT_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
export const DEFAULT_SPACING_SECONDS = 120;
export const MIN_SPACING_SECONDS = 30;
export const MAX_SPACING_SECONDS = 3600;

export interface RescoreJobData {
  userId: string;
  rollout: string;
  /** Silent: matches are stored and shown, but nothing is emailed or announced because of this rollout. */
  silent: boolean;
  spacingMs: number;
}

export function rescoreJobId(rollout: string, userId: string): string {
  return `rescore-${rollout}-${userId}`;
}

export function validateRollout(name: string | undefined): string {
  if (!name || !ROLLOUT_RE.test(name)) throw new Error('--rollout must be 3-40 characters: lower-case letters, digits and hyphens, starting with a letter or digit (e.g. scorer-2026-10-silent)');
  return name;
}

export interface RescoreArgs {
  apply: boolean;
  user?: string;
  all: boolean;
  rollout?: string;
  silent?: boolean;
  spacingSeconds: number;
  retryFailed: boolean;
}

/** Strict CLI parsing: unknown flags, duplicates, missing values and bad numbers are errors. */
export function parseRescoreArgs(argv: string[]): RescoreArgs {
  const out: RescoreArgs = { apply: false, all: false, spacingSeconds: DEFAULT_SPACING_SECONDS, retryFailed: false };
  const seen = new Set<string>();
  const valued = new Set(['--user', '--rollout', '--spacing-seconds']);
  const flags = new Set(['--apply', '--all', '--silent', '--notify', '--retry-failed']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!valued.has(arg) && !flags.has(arg)) throw new Error(`Unknown option ${arg}`);
    if (seen.has(arg)) throw new Error(`${arg} given twice`);
    seen.add(arg);
    if (valued.has(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--user') out.user = value;
      if (arg === '--rollout') out.rollout = value;
      if (arg === '--spacing-seconds') {
        if (!/^\d+$/.test(value)) throw new Error('--spacing-seconds must be a whole number of seconds');
        out.spacingSeconds = Number(value);
      }
    } else {
      if (arg === '--apply') out.apply = true;
      if (arg === '--all') out.all = true;
      if (arg === '--silent') out.silent = true;
      if (arg === '--notify') out.silent = false;
      if (arg === '--retry-failed') out.retryFailed = true;
    }
  }
  if (seen.has('--silent') && seen.has('--notify')) throw new Error('Choose --silent or --notify, not both');
  if (out.spacingSeconds < MIN_SPACING_SECONDS || out.spacingSeconds > MAX_SPACING_SECONDS) {
    throw new Error(`--spacing-seconds must be between ${MIN_SPACING_SECONDS} and ${MAX_SPACING_SECONDS}`);
  }
  if (out.user && out.all) throw new Error('Choose --user <id> or --all, not both');
  if (out.apply) {
    if (!out.user && !out.all) throw new Error('--apply needs --user <id> or --all');
    validateRollout(out.rollout);
    if (out.silent === undefined) throw new Error('--apply needs an explicit --silent (no candidate notifications from this rollout) or --notify (normal notification rules)');
  } else if (out.rollout) {
    validateRollout(out.rollout);
  }
  if (out.retryFailed && !out.apply) throw new Error('--retry-failed only makes sense with --apply');
  return out;
}

export interface RolloutReport {
  added: number;
  retried: number;
  /** Profiles that already had a job, by the job's state. Nothing was added for them. */
  existing: Record<string, number>;
}

export async function enqueueRollout(
  queue: Queue,
  opts: { rollout: string; userIds: string[]; silent: boolean; spacingSeconds: number; retryFailed?: boolean; minSpacingSeconds?: number },
): Promise<RolloutReport> {
  validateRollout(opts.rollout);
  const min = opts.minSpacingSeconds ?? MIN_SPACING_SECONDS;
  if (!Number.isFinite(opts.spacingSeconds) || opts.spacingSeconds < min || opts.spacingSeconds > MAX_SPACING_SECONDS) {
    throw new Error(`spacing must be between ${min} and ${MAX_SPACING_SECONDS} seconds`);
  }
  // Global, stored in Redis: no two workers (or restarts, or overdue jobs) may run rollout jobs at once.
  await queue.setGlobalConcurrency(1);
  const report: RolloutReport = { added: 0, retried: 0, existing: {} };
  for (const userId of [...new Set(opts.userIds)]) {
    const id = rescoreJobId(opts.rollout, userId);
    const existing = await queue.getJob(id);
    if (!existing) {
      const data: RescoreJobData = { userId, rollout: opts.rollout, silent: opts.silent, spacingMs: Math.round(opts.spacingSeconds * 1000) };
      await queue.add('rescore-profile', data, {
        jobId: id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        // Kept on purpose: the retained job IS the record that this profile was handled.
        removeOnComplete: false,
        removeOnFail: false,
      });
      report.added++;
      continue;
    }
    const state = await existing.getState();
    if (state === 'failed' && opts.retryFailed) {
      await existing.retry('failed');
      report.retried++;
      continue;
    }
    report.existing[state] = (report.existing[state] ?? 0) + 1;
  }
  return report;
}

/** State of every job of a rollout, without changing anything. */
export async function rolloutStatus(queue: Queue, rollout: string, userIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const userId of new Set(userIds)) {
    const job = await queue.getJob(rescoreJobId(rollout, userId));
    const state = job ? await job.getState() : 'not-queued';
    counts[state] = (counts[state] ?? 0) + 1;
  }
  return counts;
}
