import request from 'supertest';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { startPhase2App, fixtureSummary, fixtureDetail } from './support/phase2-local-app';

// Real CPU-model rehearsal: the actual apps/matching-service (sentence-
// transformers on CPU) scores through JobMatchingService's HTTP adapter and
// the normal BullMQ queues. There is no fixture scorer in this mode — if
// AISE_REAL_SCORER_URL is unset or the service is unreachable, this suite
// fails. Glorri HTTP is still a fixture here; the live source is checked
// separately. Observed scores are smoke-test evidence, not ranking accuracy.

const SCORER_URL = process.env.AISE_REAL_SCORER_URL;

describe('real CPU scorer → queued matching → persisted, refreshed matches', () => {
  let env: Awaited<ReturnType<typeof startPhase2App>>;
  const stamp = `phase2real-${Date.now()}`;
  const email = `${stamp}@example.com`;
  const password = 'Local-Phase2-Test!';
  let token: string;
  let userId: string;
  const slug = (name: string) => `${stamp}-${name}`;
  const jobs = {
    backend: { title: 'Backend Developer (NestJS)', text: 'NestJS və TypeScript ilə REST API hazırlanması. PostgreSQL, Prisma, Docker. Node.js backend təcrübəsi.' },
    frontend: { title: 'Frontend Developer (React)', text: 'React, TypeScript və CSS ilə istifadəçi interfeysi hazırlanması.' },
    cook: { title: 'Aşpaz', text: 'Restoran mətbəxində yemək hazırlanması, menyu planlaşdırılması və gigiyena qaydalarına əməl olunması.' },
    accountant: { title: 'Mühasib', text: 'Mühasibat uçotu, 1C proqramı, vergi hesabatlarının hazırlanması və maliyyə sənədləri.' },
    closing: { title: 'Senior Backend Engineer (Node.js)', text: 'Node.js, NestJS, PostgreSQL və mikroservis arxitekturası.' },
    expired: { title: 'Backend Engineer (NestJS, müddəti bitib)', text: 'NestJS, TypeScript, PostgreSQL.', deadline: 'January 5, 2026' },
  } as const;
  type Key = keyof typeof jobs;
  const keys = Object.keys(jobs) as Key[];

  function source(include: Key[], gone: Key[] = []) {
    const pages = [include.map((k) => fixtureSummary(slug(k), jobs[k].title, 'Bakı'))];
    const details: Record<string, { html?: string; status?: number }> = {};
    for (const k of include) details[slug(k)] = fixtureDetail(jobs[k].title, jobs[k].text, 'Bakı', (jobs[k] as any).deadline);
    for (const k of gone) details[slug(k)] = { status: 404 };
    return [pages, details] as const;
  }

  const queue = (name: string) => env.app.get<Queue>(getQueueToken(name));
  const jobIdOf = async (k: Key) =>
    (await env.prisma.job.findUniqueOrThrow({ where: { externalId: `glorri:${slug(k)}` } })).id;

  /** Latest real scores per job key from /score (job→profiles) or /score-profile (profile→jobs) exchanges. */
  async function latestScores(path: '/score' | '/score-profile', from = 0): Promise<Partial<Record<Key, number>>> {
    const ids = new Map<string, Key>();
    for (const k of keys) ids.set(await jobIdOf(k), k);
    const out: Partial<Record<Key, number>> = {};
    for (const ex of env.scorerExchanges.slice(from).filter((e) => e.path === path && e.response)) {
      if (path === '/score') {
        const k = [...ids.entries()].find(([, key]) => ex.request.job?.slug === slug(key))?.[1];
        const mine = ex.response.results.find((r: any) => r.profileId === ex.request.profiles.find((p: any) => p.persona)?.profileId);
        if (k && mine) out[k] = mine.score;
      } else {
        for (const r of ex.response.results) {
          const k = ids.get(String(r.jobId).replace(/^job:/, ''));
          if (k) out[k] = r.score;
        }
      }
    }
    return out;
  }

  async function waitForFailedAttempt(reason: RegExp) {
    for (let i = 0; i < 100; i++) {
      const jobsInRetry = [...(await queue('profile-onboarded').getDelayed()), ...(await queue('profile-onboarded').getFailed())];
      const hit = jobsInRetry.find((j) => reason.test(j.failedReason ?? ''));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('profile re-match never recorded the expected failure');
  }

  async function settleSlow() {
    for (let i = 0; i < 6; i++) {
      try {
        return await env.settle();
      } catch (error) {
        if (!String(error).includes('did not settle')) throw error;
      }
    }
    throw new Error('queues did not settle within 120 s');
  }

  const summary = async () => ({
    matches: await env.prisma.match.findMany({ where: { userId }, include: { job: true } }),
    quota: (await env.prisma.subscription.findUniqueOrThrow({ where: { userId } })).matchesUsedThisPeriod,
    notifications: (await queue('match-created').getJobs(['waiting', 'delayed', 'active', 'completed', 'failed'])).filter(
      (j) => j.data.userId === userId,
    ).length,
  });

  beforeAll(async () => {
    if (!SCORER_URL) throw new Error('AISE_REAL_SCORER_URL is required: this suite never falls back to fixture scores');
    const health = await fetch(`${SCORER_URL}/health`).then((r) => r.json());
    expect(health).toEqual({ status: 'ok' });
    env = await startPhase2App({ requireNoForeignActiveJobs: true, scorerUrl: SCORER_URL });

    await request(env.app.getHttpServer()).post('/auth/register').send({ email, password }).expect(201);
    const mail = env.emails.getCapturedEmails().filter((m: any) => m.to === email).pop()!;
    const link = /href="([^"]+)"/.exec(mail.html)![1];
    await request(env.app.getHttpServer()).post('/auth/verify-email').send({ token: new URL(link).searchParams.get('token') }).expect(201);
    token = (await request(env.app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201)).body.sessionToken;
    userId = (await env.prisma.user.findUniqueOrThrow({ where: { email } })).id;

    // Initial saved profile is a frontend developer; it is corrected later.
    await request(env.app.getHttpServer()).patch('/profile').auth(token, { type: 'bearer' })
      .send({ headline: 'Frontend developer', skills: ['React', 'JavaScript', 'CSS'], location: 'Bakı' }).expect(200);
    await request(env.app.getHttpServer()).post('/profile/complete-onboarding').auth(token, { type: 'bearer' }).expect(201);
    await settleSlow();
  }, 180_000);

  afterAll(async () => {
    if (!env) return;
    env.setScorerFault(null);
    await settleSlow().catch(() => undefined);
    await env.prisma.user.deleteMany({ where: { email } });
    await env.prisma.job.deleteMany({ where: { externalId: { startsWith: `glorri:${stamp}` } } });
    await env.close();
  }, 180_000);

  it('scores imported jobs with the real model, ranks unrelated jobs lower and never scores an expired one', async () => {
    const from = env.scorerExchanges.length;
    const [pages, details] = source(keys);
    expect((await env.importFixtures([...pages], details)).status).toBe('SUCCEEDED');
    await settleSlow();

    const scores = await latestScores('/score', from);
    process.stdout.write(`\n[real scorer] import pass (/score, frontend profile): ${JSON.stringify(scores)}\n`);
    // Every actionable job reached the real service; the expired one never did.
    expect(Object.keys(scores).sort()).toEqual(['accountant', 'backend', 'closing', 'cook', 'frontend']);
    expect(env.scorerExchanges.slice(from).some((e) => e.request.job?.slug === slug('expired'))).toBe(false);
    for (const value of Object.values(scores)) expect(value).toBeGreaterThanOrEqual(0);
    // Smoke-level relative ranking for a frontend profile.
    expect(scores.frontend!).toBeGreaterThan(scores.cook!);
    expect(scores.frontend!).toBeGreaterThan(scores.accountant!);

    const { matches, quota, notifications } = await summary();
    const expiredId = await jobIdOf('expired');
    expect(matches.some((m) => m.jobId === expiredId)).toBe(false);
    // Stored scores are exactly the real service's scores.
    for (const m of matches) {
      const key = keys.find((k) => m.job!.externalId === `glorri:${slug(k)}`)!;
      expect(m.score).toBe(scores[key]);
    }
    expect(quota).toBe(matches.length);
    expect(notifications).toBe(matches.length);
  }, 180_000);

  it('re-scores a corrected completed profile, refreshes stored matches and excludes a confirmed-closed job', async () => {
    // A complete listing without `closing`, whose detail page now answers 404: confirmed closure.
    const [pages, details] = source(keys.filter((k) => k !== 'closing'), ['closing']);
    const run = await env.importFixtures([...pages], details);
    expect(run.status).toBe('SUCCEEDED');
    expect((await env.prisma.job.findUniqueOrThrow({ where: { externalId: `glorri:${slug('closing')}` } })).status).toBe('CLOSED');
    await settleSlow();

    const from = env.scorerExchanges.length;
    await request(env.app.getHttpServer()).patch('/profile').auth(token, { type: 'bearer' })
      .send({ headline: 'Backend developer', skills: ['NestJS', 'TypeScript', 'PostgreSQL', 'Node.js'] }).expect(200);
    await settleSlow();

    const sent = env.scorerExchanges.slice(from).filter((e) => e.path === '/score-profile');
    expect(sent.length).toBeGreaterThan(0);
    // The corrected, saved profile is what reached the scorer.
    expect(JSON.stringify(sent[0].request.persona)).toContain('NestJS');
    expect(JSON.stringify(sent[0].request.persona)).not.toContain('React');
    const sentJobIds = sent.flatMap((e) => e.request.jobs.map((j: any) => j.clientId));
    expect(sentJobIds).not.toContain(`job:${await jobIdOf('closing')}`);
    expect(sentJobIds).not.toContain(`job:${await jobIdOf('expired')}`);

    const scores = await latestScores('/score-profile', from);
    process.stdout.write(`[real scorer] corrected profile (/score-profile, backend profile): ${JSON.stringify(scores)}\n`);
    expect(scores.backend!).toBeGreaterThan(scores.cook!);
    expect(scores.backend!).toBeGreaterThan(scores.accountant!);

    const { matches } = await summary();
    for (const m of matches) {
      const key = keys.find((k) => m.job!.externalId === `glorri:${slug(k)}`)!;
      if (key === 'closing') continue; // closed: not re-scored, kept only as a record
      expect(m.score).toBe(scores[key]);
    }
    const listed = await request(env.app.getHttpServer()).get('/matches').auth(token, { type: 'bearer' }).expect(200);
    const closingId = await jobIdOf('closing');
    expect(listed.body.some((m: any) => m.job?.id === closingId)).toBe(false);
    expect(listed.body.every((m: any) => m.actionable)).toBe(true);
  }, 180_000);

  it('does not duplicate matches, quota charges or notifications when the same work runs again', async () => {
    const before = await summary();
    const [pages, details] = source(keys.filter((k) => k !== 'closing'), ['closing']);
    await env.importFixtures([...pages], details);
    await settleSlow();
    for (let i = 0; i < 2; i++) {
      await request(env.app.getHttpServer()).patch('/profile').auth(token, { type: 'bearer' })
        .send({ headline: 'Backend developer', skills: ['NestJS', 'TypeScript', 'PostgreSQL', 'Node.js'] }).expect(200);
    }
    await settleSlow();
    const after = await summary();
    expect(after.matches.map((m) => m.id).sort()).toEqual(before.matches.map((m) => m.id).sort());
    expect(after.quota).toBe(before.quota);
    expect(after.notifications).toBe(before.notifications);
  }, 180_000);

  it.each([
    ['an outage', 'down', /Incomplete profile scoring/],
    ['a malformed response', 'malformed', /Incomplete profile scoring/],
  ] as const)('reports %s as a failed attempt, keeps stored matches and recovers on retry', async (_label, fault, reason) => {
    const before = await summary();
    env.setScorerFault(fault);
    await request(env.app.getHttpServer()).patch('/profile').auth(token, { type: 'bearer' })
      .send({ headline: 'Backend developer', skills: ['NestJS', 'TypeScript', 'PostgreSQL', 'Node.js', 'Docker'] }).expect(200);
    const failed = await waitForFailedAttempt(reason);
    expect(failed.attemptsMade).toBeGreaterThanOrEqual(1);
    const during = await summary();
    expect(during.matches.map((m) => [m.id, m.score])).toEqual(before.matches.map((m) => [m.id, m.score]));

    env.setScorerFault(null);
    const from = env.scorerExchanges.length;
    await settleSlow(); // BullMQ's own backoff retry, now against the healthy scorer
    expect(env.scorerExchanges.slice(from).some((e) => e.path === '/score-profile' && e.response)).toBe(true);
    const after = await summary();
    expect(after.quota).toBe(before.quota);
    expect(after.notifications).toBe(before.notifications);
  }, 180_000);
});
