import request from 'supertest';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { MatchingService } from '../src/matching/matching.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { enqueueRollout, RESCORE_QUEUE } from '../src/matching/rescore';
import { startPhase2App, fixtureSummary, fixtureDetail } from './support/phase2-local-app';

/**
 * Silent re-scoring rollout on a real database and queues (fixture scorer): matches are stored, shown and
 * quota-counted, nothing is announced, refreshed matches cannot become emailable through the rollout,
 * notifiedAt is never faked, and normal notifications still work for a normal pass.
 */
describe('silent re-scoring rollout', () => {
  let env: Awaited<ReturnType<typeof startPhase2App>>;
  const stamp = `silent-${Date.now()}`;
  const password = 'Local-Silent-Test!';
  const addr = (n: string) => `${stamp}-${n}@example.com`;
  const users: Record<string, { id: string; token: string }> = {};
  let rescoreQueue: Queue;
  let announced: any[];
  let notifications: NotificationsService;
  let flushQueue: { add: jest.Mock };

  async function createUser(name: string) {
    const server = env.app.getHttpServer();
    await request(server).post('/auth/register').send({ email: addr(name), password }).expect(201);
    const mail = env.emails.getCapturedEmails().filter((m: any) => m.to === addr(name)).pop()!;
    await request(server).post('/auth/verify-email').send({ token: new URL(/href="([^"]+)"/.exec(mail.html)![1]).searchParams.get('token') }).expect(201);
    const login = await request(server).post('/auth/login').send({ email: addr(name), password }).expect(201);
    const token = login.body.sessionToken as string;
    await request(server).patch('/profile').auth(token, { type: 'bearer' }).send({ headline: 'PostgreSQL engineer', skills: ['PostgreSQL', 'TypeScript'], location: 'Bakı' }).expect(200);
    // Onboarded, but with no automatic matching pass: the rollout is what scores them.
    env.failNextProfileEnqueue();
    await request(server).post('/profile/complete-onboarding').auth(token, { type: 'bearer' }).expect(201);
    const user = await env.prisma.user.findUniqueOrThrow({ where: { email: addr(name) } });
    users[name] = { id: user.id, token };
  }
  const emailsTo = (name: string) => env.emails.getCapturedEmails().filter((m: any) => m.to === addr(name)).length;
  const waitCompleted = async (n: number) => {
    for (let i = 0; i < 400; i++) {
      const c = await rescoreQueue.getJobCounts('completed', 'failed');
      if (c.failed) throw new Error('rescore job failed');
      if (c.completed >= n) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('rescore did not finish');
  };

  beforeAll(async () => {
    env = await startPhase2App({ requireNoForeignActiveJobs: true });
    const first = Array.from({ length: 4 }, (_, i) => fixtureSummary(`${stamp}-${i}`));
    const details = Object.fromEntries(first.map((j) => [j.slug, fixtureDetail(j.title, 'TypeScript PostgreSQL', j.location)]));
    await env.importFixtures([first], details);
    await env.settle();
    for (const n of ['a', 'b', 'c', 'd']) await createUser(n);
    await env.settle();
    rescoreQueue = env.app.get<Queue>(getQueueToken(RESCORE_QUEUE));
    announced = [];
    const matchCreated = env.app.get<Queue>(getQueueToken('match-created'));
    const original = matchCreated.add.bind(matchCreated);
    matchCreated.add = (async (...args: any[]) => { announced.push(args[1]); return (original as any)(...args); }) as any;
    flushQueue = { add: jest.fn().mockResolvedValue({}) };
    notifications = new NotificationsService(env.prisma as any, env.emails as any, { capture() {} } as any, { add: jest.fn() } as any, flushQueue as any);
  }, 90000);
  afterAll(async () => {
    if (!env) return;
    await env.prisma.user.deleteMany({ where: { email: { startsWith: stamp } } });
    await env.prisma.job.deleteMany({ where: { externalId: { startsWith: `glorri:${stamp}` } } });
    await env.close();
  });

  it('has no matches before the rollout (the automatic pass was skipped)', async () => {
    for (const n of ['a', 'b', 'c', 'd']) expect(await env.prisma.match.count({ where: { userId: users[n].id } })).toBe(0);
  });

  it('a silent rollout stores and shows matches, consumes quota, and announces nothing', async () => {
    // d has an unsent, low-scoring match: the rollout will lift it over the email floor.
    const job = await env.prisma.job.findFirstOrThrow({ where: { externalId: { startsWith: `glorri:${stamp}` } } });
    const pre = await env.prisma.match.create({ data: { userId: users.d.id, jobId: job.id, score: 0.3 } });
    const before = { a: emailsTo('a'), b: emailsTo('b'), d: emailsTo('d') };
    const report = await enqueueRollout(rescoreQueue, { rollout: 'silent-one', silent: true, spacingSeconds: 0.1, minSpacingSeconds: 0, userIds: [users.a.id, users.b.id, users.d.id] });
    expect(report.added).toBe(3);
    await waitCompleted(3);

    for (const n of ['a', 'b', 'd']) {
      const matches = await env.prisma.match.findMany({ where: { userId: users[n].id } });
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.every((m) => m.suppressedRollout === 'silent-one' && m.notifiedAt === null)).toBe(true); // notifiedAt is never faked
      expect(matches.some((m) => m.score >= 0.5)).toBe(true);
      expect(await env.prisma.notification.count({ where: { userId: users[n].id } })).toBe(0);
      const list = await request(env.app.getHttpServer()).get('/matches').auth(users[n].token, { type: 'bearer' }).expect(200);
      expect(list.body.length).toBeGreaterThan(0); // still shown in the app
    }
    const refreshed = await env.prisma.match.findUniqueOrThrow({ where: { id: pre.id } });
    expect(refreshed.score).toBeGreaterThanOrEqual(0.5);
    expect(refreshed.suppressedRollout).toBe('silent-one');
    expect(announced).toEqual([]);
    // Quota is used as normal: FREE allows 3 and the new matches counted against it.
    const a = await env.prisma.subscription.findUniqueOrThrow({ where: { userId: users.a.id } });
    expect(a.matchesUsedThisPeriod).toBe(await env.prisma.match.count({ where: { userId: users.a.id } }));
    expect(a.matchesUsedThisPeriod).toBeLessThanOrEqual(3);

    // Nothing later emails them: flush, re-arm after a restart, and the paid daily digest.
    await env.prisma.subscription.update({ where: { userId: users.b.id }, data: { plan: 'BASIC', status: 'active', currentPeriodEnd: new Date(Date.now() + 86_400_000) } });
    for (const n of ['a', 'b', 'd']) await notifications.sendMatchEmailDigest(users[n].id);
    await notifications.rescheduleMatchEmailFlushes();
    await notifications.runDailyDigest();
    expect(flushQueue.add.mock.calls.map((c) => c[1].userId)).not.toEqual(expect.arrayContaining([users.a.id]));
    expect(flushQueue.add.mock.calls.some((c) => [users.a.id, users.b.id, users.d.id].includes(c[1].userId))).toBe(false);
    expect({ a: emailsTo('a'), b: emailsTo('b'), d: emailsTo('d') }).toEqual(before);
  }, 90000);

  it('repeating the silent rollout re-runs nothing', async () => {
    const counts = await Promise.all(['a', 'b', 'd'].map((n) => env.prisma.match.count({ where: { userId: users[n].id } })));
    const again = await enqueueRollout(rescoreQueue, { rollout: 'silent-one', silent: true, spacingSeconds: 0.1, minSpacingSeconds: 0, userIds: [users.a.id, users.b.id, users.d.id] });
    expect(again).toMatchObject({ added: 0, existing: { completed: 3 } });
    expect(await Promise.all(['a', 'b', 'd'].map((n) => env.prisma.match.count({ where: { userId: users[n].id } })))).toEqual(counts);
  });

  it('a normal pass still announces and emails as before (future notifications keep working)', async () => {
    const job = await env.prisma.job.findFirstOrThrow({ where: { externalId: { startsWith: `glorri:${stamp}` } } });
    expect(job).toBeTruthy();
    const before = emailsTo('c');
    await enqueueRollout(rescoreQueue, { rollout: 'normal-one', silent: false, spacingSeconds: 0.1, minSpacingSeconds: 0, userIds: [users.c.id] });
    await waitCompleted(4);
    const matches = await env.prisma.match.findMany({ where: { userId: users.c.id } });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.suppressedRollout === null)).toBe(true);
    expect(announced.length).toBe(matches.length); // one announcement job per new match
    await notifications.handleMatchCreated(matches[0].id, users.c.id);
    expect(await env.prisma.notification.count({ where: { userId: users.c.id } })).toBeGreaterThan(0);
    await notifications.sendMatchEmailDigest(users.c.id);
    expect(emailsTo('c')).toBe(before + 1);
  }, 60000);
});
