import { Test } from '@nestjs/testing';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ProfileRescoreProcessor } from '../src/matching/profile-rescore.processor';
import { MatchingService } from '../src/matching/matching.service';
import { enqueueRollout, RESCORE_QUEUE } from '../src/matching/rescore';

/** Real BullMQ + Redis and the real decorated processor; only the scoring call is a recorder. */
describe('re-scoring rollout through the real queue', () => {
  const prefix = `aise-rescore-${process.pid}-${Date.now()}`;
  const connection = { host: '127.0.0.1', port: 6379 };
  const runs: { userId: string; silent: string | undefined; start: number; end: number }[] = [];
  let active = 0;
  let maxActive = 0;
  let failFor: Set<string>;
  let queue: Queue;
  let close: () => Promise<void>;

  const matching = {
    runMatchingForProfile: jest.fn(async (userId: string, options: { silentRollout?: string } = {}) => {
      active++; maxActive = Math.max(maxActive, active);
      const start = Date.now();
      try {
        await new Promise((r) => setTimeout(r, 120));
        if (failFor.has(userId)) throw new Error('synthetic scorer failure');
      } finally { active--; }
      runs.push({ userId, silent: options.silentRollout, start, end: Date.now() });
    }),
  };

  beforeAll(async () => {
    failFor = new Set();
    const moduleRef = await Test.createTestingModule({
      imports: [BullModule.forRoot({ prefix, connection }), BullModule.registerQueue({ name: RESCORE_QUEUE })],
      providers: [ProfileRescoreProcessor, { provide: MatchingService, useValue: matching }],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    queue = app.get<Queue>(getQueueToken(RESCORE_QUEUE));
    close = async () => { await queue.obliterate({ force: true }); await app.close(); };
  }, 30000);
  afterAll(async () => { await close(); });

  const waitFor = async (check: () => Promise<boolean> | boolean, ms = 40000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) { if (await check()) return; await new Promise((r) => setTimeout(r, 100)); }
    throw new Error('condition not reached in time');
  };
  const opts = { rollout: 'r-one', silent: true, spacingSeconds: 0.3, minSpacingSeconds: 0 };

  it('runs every profile exactly once, serially, even when all jobs become overdue at once', async () => {
    await queue.pause(); // jobs pile up, then all are due together
    const report = await enqueueRollout(queue, { ...opts, userIds: ['a', 'b', 'c', 'd', 'e'] });
    expect(report).toMatchObject({ added: 5, retried: 0, existing: {} });
    await new Promise((r) => setTimeout(r, 500));
    await queue.resume();
    await waitFor(async () => (await queue.getJobCounts('completed')).completed === 5);
    expect(runs.map((r) => r.userId).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(maxActive).toBe(1);
    expect(runs.every((r) => r.silent === 'r-one')).toBe(true);
    const ordered = [...runs].sort((x, y) => x.start - y.start);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].start).toBeGreaterThanOrEqual(ordered[i - 1].end); // no overlap
      expect(ordered[i].start - ordered[i - 1].start).toBeGreaterThanOrEqual(290); // spacing held
    }
    expect(await queue.getGlobalConcurrency()).toBe(1);
  }, 60000);

  it('repeating the same rollout re-runs nothing, including completed profiles', async () => {
    const before = runs.length;
    const again = await enqueueRollout(queue, { ...opts, userIds: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(again.added).toBe(1); // only the profile that never had a job
    expect(again.existing).toEqual({ completed: 5 });
    await waitFor(async () => (await queue.getJobCounts('completed')).completed === 6);
    expect(runs.length).toBe(before + 1);
    expect(runs.filter((r) => r.userId === 'a')).toHaveLength(1);
  }, 30000);

  it('a failed profile stays failed on replay, is retried only when asked, through the same serial worker, and a new rollout name is a fresh pass', async () => {
    failFor = new Set(['x']);
    const r2 = { ...opts, rollout: 'r-two' };
    await enqueueRollout(queue, { ...r2, userIds: ['x', 'y'] });
    await waitFor(async () => (await queue.getJobCounts('failed')).failed === 1, 60000); // 3 attempts with backoff
    const replay = await enqueueRollout(queue, { ...r2, userIds: ['x', 'y'] });
    expect(replay).toMatchObject({ added: 0, retried: 0, existing: { failed: 1, completed: 1 } });
    failFor = new Set();
    const retry = await enqueueRollout(queue, { ...r2, userIds: ['x', 'y'], retryFailed: true });
    expect(retry).toMatchObject({ added: 0, retried: 1 });
    await waitFor(async () => (await queue.getJobCounts('failed')).failed === 0 && runs.some((r) => r.userId === 'x'));
    expect(maxActive).toBe(1);
    // A deliberate new pass over the same profiles uses a new name.
    const fresh = await enqueueRollout(queue, { ...opts, rollout: 'r-three', silent: false, userIds: ['a'] });
    expect(fresh.added).toBe(1);
    await waitFor(() => runs.some((r) => r.userId === 'a' && r.silent === undefined));
  }, 120000);

  it('rejects unsafe spacing and rollout names before queueing anything', async () => {
    await expect(enqueueRollout(queue, { rollout: 'r-bad', silent: true, spacingSeconds: 5, userIds: ['z'] })).rejects.toThrow(/spacing/);
    await expect(enqueueRollout(queue, { rollout: 'Bad Name', silent: true, spacingSeconds: 60, userIds: ['z'] })).rejects.toThrow(/--rollout/);
    expect(await queue.getJob('rescore-r-bad-z')).toBeUndefined();
  });
});
