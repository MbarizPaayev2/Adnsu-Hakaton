import request from 'supertest';
import { MatchingService } from '../src/matching/matching.service';
import { startPhase2App, fixtureSummary, fixtureDetail } from './support/phase2-local-app';

describe('fixture import → queued matching → authenticated listing and corrected profile', () => {
  let env: Awaited<ReturnType<typeof startPhase2App>>;
  const stamp = `phase2-${Date.now()}`;
  const email = `${stamp}@example.com`, otherEmail = `${stamp}-other@example.com`;
  let token: string, otherToken: string, userId: string;
  const password = 'Local-Phase2-Test!';
  beforeAll(async () => {
    env = await startPhase2App({ requireNoForeignActiveJobs: true });
    for (const address of [email, otherEmail]) {
      await request(env.app.getHttpServer()).post('/auth/register').send({ email: address, password }).expect(201);
      const messages = env.emails.getCapturedEmails();
      const mail = messages.filter((m: any) => m.to === address).pop()!;
      const link = /href="([^"]+)"/.exec(mail.html)![1];
      await request(env.app.getHttpServer()).post('/auth/verify-email').send({ token: new URL(link).searchParams.get('token') }).expect(201);
      const login = await request(env.app.getHttpServer()).post('/auth/login').send({ email: address, password }).expect(201);
      if (address === email) token = login.body.sessionToken; else otherToken = login.body.sessionToken;
    }
    userId = (await env.prisma.user.findUniqueOrThrow({ where: { email } })).id;
    // Profile is written through its authenticated API; no direct match creation.
    await request(env.app.getHttpServer()).patch('/profile').auth(token, { type: 'bearer' }).send({ headline: 'TypeScript engineer', skills: ['TypeScript'], location: 'Bakı' }).expect(200);
    await request(env.app.getHttpServer()).post('/profile/complete-onboarding').auth(token, { type: 'bearer' }).expect(201);
    await env.settle();
  }, 60000);
  afterAll(async () => {
    if (!env) return;
    await env.settle();
    await env.prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    await env.prisma.job.deleteMany({ where: { externalId: { startsWith: `glorri:${stamp}` } } });
    await env.close();
  });
  it('imports beyond a known first job, then updates without duplicates; matching persists and ownership holds', async () => {
    const first = Array.from({ length: 18 }, (_, i) => fixtureSummary(`${stamp}-${i}`));
    const late = fixtureSummary(`${stamp}-late`, 'Late PostgreSQL role', 'Gəncə');
    const details = Object.fromEntries([...first, late].map((j) => [j.slug, fixtureDetail(j.title, 'TypeScript PostgreSQL', j.location)]));
    await env.jobs.upsertJob({ externalId: `glorri:${first[0].slug}`, title: first[0].title, company: 'AISE Test Company', description: 'old', location: 'Bakı', postedAt: first[0].postedDate, url: 'https://jobs.glorri.com/vacancies/aise-fixture/first', rawPayload: first[0] });
    expect((await env.importFixtures([first, [first[0], late]], details)).status).toBe('SUCCEEDED');
    await env.settle();
    const total = await env.prisma.job.count({ where: { externalId: { startsWith: `glorri:${stamp}` } } });
    expect(total).toBe(19);
    expect(await env.prisma.job.findUnique({ where: { externalId: `glorri:${late.slug}` } })).not.toBeNull();
    const matchesBefore = await env.prisma.match.count({ where: { userId } });
    await env.importFixtures([first, [late]], details); await env.settle();
    expect(await env.prisma.job.count({ where: { externalId: { startsWith: `glorri:${stamp}` } } })).toBe(19);
    expect(await env.prisma.match.count({ where: { userId } })).toBe(matchesBefore);
    const list = await request(env.app.getHttpServer()).get('/matches').auth(token, { type: 'bearer' }).expect(200);
    expect(list.body).toHaveLength(3);
    expect(list.body.every((m: any) => m.actionable && m.job.lastSeenAt && m.job.description)).toBe(true);
    await request(env.app.getHttpServer()).patch(`/matches/${list.body[0].id}`).auth(otherToken, { type: 'bearer' }).send({ status: 'APPLIED' }).expect(404);
    await request(env.app.getHttpServer()).get('/matches').expect(401);
  }, 30000);
  it('re-matches a corrected completed profile through the real queue and scoring HTTP adapter', async () => {
    const before = env.scoreRequests.length;
    await request(env.app.getHttpServer()).patch('/profile').auth(token, { type: 'bearer' }).send({ headline: 'PostgreSQL engineer', skills: ['PostgreSQL', 'TypeScript'] }).expect(200);
    await env.settle();
    expect(env.scoreRequests.slice(before).some((r) => r.persona?.summary === 'PostgreSQL engineer')).toBe(true);
    const matches = await env.prisma.match.findMany({ where: { userId } });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.score === 0.91)).toBe(true);
  }, 30000);
  it('retains closed application history while excluding inactive recommendations and dashboard cards', async () => {
    const matches = await env.prisma.match.findMany({ where: { userId }, orderBy: { id: 'asc' } });
    await request(env.app.getHttpServer()).patch(`/matches/${matches[0].id}`).auth(token, { type: 'bearer' }).send({ status: 'APPLIED' }).expect(200);
    await env.prisma.job.update({ where: { id: matches[0].jobId! }, data: { status: 'CLOSED' } });
    await env.prisma.job.update({ where: { id: matches[1].jobId! }, data: { deadline: new Date(0) } });
    const list = await request(env.app.getHttpServer()).get('/matches').auth(token, { type: 'bearer' }).expect(200);
    expect(list.body.find((m: any) => m.id === matches[0].id)).toMatchObject({ status: 'APPLIED', actionable: false });
    expect(list.body.some((m: any) => m.id === matches[1].id)).toBe(false);
    const dashboard = await request(env.app.getHttpServer()).get('/dashboard/summary').auth(token, { type: 'bearer' }).expect(200);
    expect(dashboard.body.recentMatches.every((m: any) => m.job.status === 'ACTIVE' && (!m.job.deadline || new Date(m.job.deadline) > new Date()))).toBe(true);
  });
  it('charges quota once when two real matching passes race on the same new pair', async () => {
    const other = await env.prisma.user.findUniqueOrThrow({ where: { email: otherEmail } });
    const job = await env.prisma.job.findFirstOrThrow({ where: { externalId: { startsWith: `glorri:${stamp}` }, status: 'ACTIVE', deadline: null } });
    // A second completed synthetic profile is fixture setup for this race;
    // the candidate/profile browser flow is covered separately.
    await env.prisma.profile.create({ data: { userId: other.id, headline: 'TypeScript', skills: ['TypeScript'], location: 'Bakı', jobPreferences: {}, onboardingCompletedAt: new Date() } });
    const original = env.prisma.match.findUnique.bind(env.prisma.match);
    let reached = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const spy = jest.spyOn(env.prisma.match, 'findUnique').mockImplementation((async (args: any) => {
      const result = await original(args);
      if (args.where.userId_jobId?.userId === other.id && !result && reached < 2) {
        reached++;
        if (reached === 2) release();
        await barrier;
      }
      return result;
    }) as any);
    try {
      const service = env.app.get(MatchingService);
      await Promise.all([service.runMatching(job.id), service.runMatching(job.id)]);
      expect(reached).toBe(2);
      expect(await env.prisma.match.count({ where: { userId: other.id, jobId: job.id } })).toBe(1);
      expect((await env.prisma.subscription.findUniqueOrThrow({ where: { userId: other.id } })).matchesUsedThisPeriod).toBe(1);
    } finally { release(); spy.mockRestore(); }
  }, 30000);

});
